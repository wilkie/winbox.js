#!/usr/bin/env node
/**
 * Records what the probes see when they run under real Windows 3.1.
 *
 * This is the stage that makes the whole thing an oracle. Everything before it
 * is scaffolding; what comes out of here is the only description of the
 * Windows API in this repository that was not written by us.
 *
 * Each probe runs as the Windows shell. That sounds drastic and is actually
 * the simplest arrangement available: starting Windows starts the probe and
 * nothing else, with no Program Manager to draw and no desktop to wait for,
 * and when the probe calls `ExitWindows` the shell has exited, so Windows
 * stops and DOS comes back to the script that launched it. The whole run is
 * unattended from `win` to a file on disk.
 *
 * Standard mode (`win /s`) rather than 386 enhanced: enhanced mode wants
 * virtual-8086 machinery that DOSBox does not reliably provide, and nothing
 * being probed depends on which mode Windows booted in.
 *
 *   node scripts/oracle/record.mjs
 *   node scripts/oracle/record.mjs strings      # just one
 *   node scripts/oracle/record.mjs --keep       # leave the scratch drive
 *
 * Writes oracle/fixtures/<probe>.json, which is committed.
 */

import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DISPLAYS, driveFor } from './install-windows.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CACHE = join(ROOT, 'oracle', '.cache');
const BUILD = join(ROOT, 'oracle', 'build');
const PROBES = join(BUILD, 'probes');
const SCRATCH = join(BUILD, 'record-c');
const FIXTURES = join(ROOT, 'oracle', 'fixtures');

/**
 * Probes whose answers belong to a display driver rather than to Windows.
 *
 * `GetDeviceCaps` obviously, but the text metrics too: which stock fonts get
 * installed depends on the resolution, so a VGA reading of them says nothing
 * about an EGA. These get one fixture per display; everything else gets one.
 *
 * `maxwidth` is here because the sizes are the point of it. A height asked for
 * on an EGA is realised at a different pixel size than on a VGA, so the same
 * sweep run on both is two sets of sizes rather than one repeated -- 572 of its
 * 891 metric records differ between them -- and the maximum width is the one
 * thing left that no rule explains.
 */
const PER_DISPLAY = new Set([
  'devcaps',
  'maxwidth',
  'charscal',
  'glyphs',
  'font',
  'hinting',
  'lines',
  'plotter',

  /* Stock glyphs swept in size, which is a question about the pixel as much as
   * about the size. Without this the EGA run overwrites the VGA one and the
   * two look like the same probe disagreeing with itself.
   */
  'stemsize',
  'stemwide',
  'stemedge',
  'stemstyl',
  'plotbig',
  'symbig',
  'strikbig',
  'rules',
  'textbk',
  'textalin',
  'textxtra',
  'scalemem',
  'scalepts',
  'tiepick',
  'symadv',
  'dipcell',
  'tiewide',
  'strikout',
  'groundw',
  'groundbx',
  'groundsc',
  'extout',
  'groundrn',
]);

/** Where a probe writes, on the guest and on the host. */
const OUTPUT_DIR = 'ORACLE';

/** Where `fabricate.mjs` leaves the fonts built to ask a particular question. */
const FONTS = join(BUILD, 'fonts');

/** Long enough for Windows to boot and a probe to finish; short enough to fail. */
const TIMEOUT_SECONDS = 300;

function log(...args) {
  console.log(...args);
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });

    let output = '';
    child.stdout?.on('data', (chunk) => (output += chunk));
    child.stderr?.on('data', (chunk) => (output += chunk));

    const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_SECONDS * 1000);

    child.on('error', (error) =>
      reject(
        error.code === 'ENOENT'
          ? new Error(`${command} is not installed; it is needed to record against real Windows`)
          : error
      )
    );

    child.on('close', (code, signal) => {
      clearTimeout(timer);

      if (signal === 'SIGKILL') {
        reject(new Error(`${command} did not finish within ${TIMEOUT_SECONDS}s`));
      } else if (code === 0) {
        resolvePromise(output);
      } else {
        reject(new Error(`${command} exited ${code}: ${output.trim()}`));
      }
    });
  });
}

/**
 * Points SYSTEM.INI at the probe.
 *
 * Only the `shell=` line in [boot] changes; everything else is left as Setup
 * wrote it, because the configuration is part of what is being recorded
 * against.
 */
async function setShell(probe) {
  const path = join(SCRATCH, 'WINDOWS', 'SYSTEM.INI');

  // A 1992 INI file is not UTF-8 and must not be decoded as if it were.
  const text = await readFile(path, 'latin1');
  const changed = text.replace(/^shell=.*$/im, `shell=${probe}`);

  if (changed === text) {
    throw new Error(`no shell= line in ${path}`);
  }

  await writeFile(path, changed, 'latin1');
}

/** Boots Windows with the probe as its shell and waits for it to finish. */
async function runProbe(probe, display) {
  const config = join(BUILD, 'record.conf');

  await writeFile(
    config,
    [
      '[dosbox]',
      `machine=${DISPLAYS[display].machine}`,
      'memsize=16',
      '[cpu]',
      'core=auto',
      'cycles=max',
      '[sdl]',
      'autolock=false',
      '[autoexec]',
      `mount c ${SCRATCH}`,
      'c:',
      'cd \\WINDOWS',
      'win /s',
      'exit',
      '',
    ].join('\n')
  );

  await run('dosbox', ['-conf', config, '-exit'], {
    env: { ...process.env, SDL_VIDEODRIVER: 'dummy', SDL_AUDIODRIVER: 'dummy' },
  });
}

/**
 * Turns a probe's output into records.
 *
 * Lines are `function <TAB> arguments <TAB> result`, and a function of `#`
 * marks a section rather than a call -- the sections are what give the
 * generated documentation its shape.
 */
function parse(text) {
  const records = [];
  let section = null;

  /* Fields arrive with tabs, newlines and backslashes escaped, since those are
   * what separate the fields and the records in the first place.
   */
  const unescape = (field) =>
    field.replace(/\\([\\trn])/g, (_, code) => ({ '\\': '\\', t: '\t', r: '\r', n: '\n' })[code]);

  for (const line of text.split(/\r?\n/)) {
    if (line === '') {
      continue;
    }

    const [name, args, result] = line.split('\t').map(unescape);

    if (name === undefined || args === undefined || result === undefined) {
      throw new Error(`malformed record: ${JSON.stringify(line)}`);
    }

    if (name === '#') {
      section = result;
      continue;
    }

    records.push({ function: name, args, result, ...(section ? { section } : {}) });
  }

  return records;
}

/** What the fixture should say it was recorded against. */
async function provenance(display) {
  const distribution = await readFile(join(CACHE, 'distribution.json'), 'utf8')
    .then(JSON.parse)
    .catch(() => null);

  return {
    windows: distribution?.label ?? 'unknown',
    sha256: distribution?.sha256 ?? null,
    host: 'dosbox, standard mode',

    /* Which driver was installed. Even a probe that looks display-independent
     * was recorded on one, and saying so costs nothing.
     */
    display: DISPLAYS[display].profile,
    displayDescription: DISPLAYS[display].description,
  };
}

/**
 * Puts a fabricated font on the drive, over the one it was made from.
 *
 * The installed `WIN.INI` already names it, so replacing the file is the whole
 * of installing it -- and replacing rather than adding keeps every other
 * variable fixed, which is the point of fabricating one at all.
 */
async function stageFont(fabrication) {
  const from = join(FONTS, fabrication);

  const files = await readdir(from).catch(() => null);

  if (!files) {
    throw new Error(`no fabricated font named ${fabrication}; run fabricate.mjs first`);
  }

  for (const file of files) {
    await cp(join(from, file), join(SCRATCH, 'WINDOWS', 'SYSTEM', file));
  }

  return files;
}

async function record(probe, source, display, fabrication) {
  const name = basename(source, '.EXE');

  await setShell(basename(source));
  await cp(source, join(SCRATCH, 'WINDOWS', basename(source)));

  if (fabrication) {
    const staged = await stageFont(fabrication);

    log(`  using fabricated ${fabrication} (${staged.join(', ')})`);
  }
  await rm(join(SCRATCH, OUTPUT_DIR), { recursive: true, force: true });
  await mkdir(join(SCRATCH, OUTPUT_DIR), { recursive: true });

  await runProbe(basename(source), display);

  const output = join(SCRATCH, OUTPUT_DIR, `${name}.OUT`);

  if (!(await stat(output).catch(() => null))) {
    throw new Error(
      `${name} produced no output.\n` +
        'Either Windows did not start, or the probe did not reach probeOpen.'
    );
  }

  const records = parse(await readFile(output, 'latin1'));

  if (records.length === 0) {
    throw new Error(`${name} produced an empty recording`);
  }

  return records;
}

async function main() {
  const args = process.argv.slice(2);
  /* Flag values are not probe names: `--display vga` must not ask for a probe
   * called `vga`.
   */
  const wanted = args.filter(
    (argument, index) => !argument.startsWith('-') && !(args[index - 1] ?? '').startsWith('--')
  );

  const at = args.indexOf('--display');
  const display = at === -1 ? 'vga' : args[at + 1];

  /* A fabricated font puts the recording somewhere else. What comes back is
   * an answer about a font nobody has, so it must not overwrite the fixture
   * describing the one everybody does.
   */
  const fontAt = args.indexOf('--font');
  const fabrication = fontAt === -1 ? null : args[fontAt + 1];

  if (!DISPLAYS[display]) {
    throw new Error(`no display ${display}; try ${Object.keys(DISPLAYS).join(', ')}`);
  }

  const drive = driveFor(display);

  if (!(await stat(drive).catch(() => null))) {
    throw new Error(`nothing installed for ${display}; run scripts/oracle/install-windows.mjs`);
  }

  const executables = (await readdir(PROBES).catch(() => []))
    .filter((entry) => entry.endsWith('.EXE'))
    .filter(
      (entry) => wanted.length === 0 || wanted.includes(basename(entry, '.EXE').toLowerCase())
    )
    .sort();

  if (executables.length === 0) {
    throw new Error('no probes built; run scripts/oracle/build-probes.mjs first');
  }

  /* One scratch drive for the whole run rather than one per probe: the install
   * is nearly eight megabytes and only the shell line differs between runs.
   */
  log(`Preparing a scratch drive from ${display}...`);
  await rm(SCRATCH, { recursive: true, force: true });
  await cp(drive, SCRATCH, { recursive: true });

  await mkdir(FIXTURES, { recursive: true });
  const source = await provenance(display);

  for (const executable of executables) {
    const name = basename(executable, '.EXE').toLowerCase();
    log(`Recording ${name} under Windows (${DISPLAYS[display].description})...`);

    const records = await record(name, join(PROBES, executable), display, fabrication);
    const functions = new Set(records.map((entry) => entry.function));

    /* A probe whose answers belong to the driver gets a fixture per driver;
     * the rest would only be recorded again under a different name.
     */
    let fixture = PER_DISPLAY.has(name) ? `${name}-${display}` : name;

    if (fabrication) {
      /* A fabricated recording carries the display too, or a run on one would
       * overwrite the same fabrication's recording on another -- and that holds
       * for every probe, not only the ones recorded per display unfabricated,
       * since a fabrication may be staged on any of them. The default keeps its
       * plain name, so nothing already recorded moves. */
      const suffix = display !== 'vga' ? `-${display}` : '';

      fixture = `fabricated/${name}-${fabrication}${suffix}`;

      await mkdir(join(FIXTURES, 'fabricated'), { recursive: true });
    }

    await writeFile(
      join(FIXTURES, `${fixture}.json`),
      `${JSON.stringify({ probe: name, display, source, font: fabrication ?? null, records }, null, 2)}\n`
    );

    log(`  ${records.length} records across ${functions.size} functions -> ${fixture}.json`);
  }

  if (!args.includes('--keep')) {
    await rm(SCRATCH, { recursive: true, force: true });
  }

  log(`\nFixtures in ${FIXTURES}`);
}

main().catch((error) => {
  console.error(`record: ${error.message}`);
  process.exitCode = 1;
});
