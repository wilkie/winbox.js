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

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CACHE = join(ROOT, 'oracle', '.cache');
const BUILD = join(ROOT, 'oracle', 'build');
const DRIVE = join(BUILD, 'drive-c');
const PROBES = join(BUILD, 'probes');
const SCRATCH = join(BUILD, 'record-c');
const FIXTURES = join(ROOT, 'oracle', 'fixtures');

/** Where a probe writes, on the guest and on the host. */
const OUTPUT_DIR = 'ORACLE';

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
async function runProbe(probe) {
  const config = join(BUILD, 'record.conf');

  await writeFile(
    config,
    [
      '[dosbox]',
      'machine=svga_s3',
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
async function provenance() {
  const distribution = await readFile(join(CACHE, 'distribution.json'), 'utf8')
    .then(JSON.parse)
    .catch(() => null);

  return {
    windows: distribution?.label ?? 'unknown',
    sha256: distribution?.sha256 ?? null,
    host: 'dosbox, standard mode',
  };
}

async function record(probe, source) {
  const name = basename(source, '.EXE');

  await setShell(basename(source));
  await cp(source, join(SCRATCH, 'WINDOWS', basename(source)));
  await rm(join(SCRATCH, OUTPUT_DIR), { recursive: true, force: true });
  await mkdir(join(SCRATCH, OUTPUT_DIR), { recursive: true });

  await runProbe(basename(source));

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
  const wanted = args.filter((argument) => !argument.startsWith('-'));

  if (!(await stat(DRIVE).catch(() => null))) {
    throw new Error('nothing installed; run scripts/oracle/install-windows.mjs first');
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
  log('Preparing a scratch drive...');
  await rm(SCRATCH, { recursive: true, force: true });
  await cp(DRIVE, SCRATCH, { recursive: true });

  await mkdir(FIXTURES, { recursive: true });
  const source = await provenance();

  for (const executable of executables) {
    const name = basename(executable, '.EXE').toLowerCase();
    log(`Recording ${name} under Windows...`);

    const records = await record(name, join(PROBES, executable));
    const functions = new Set(records.map((entry) => entry.function));

    await writeFile(
      join(FIXTURES, `${name}.json`),
      `${JSON.stringify({ probe: name, source, records }, null, 2)}\n`
    );

    log(`  ${records.length} records across ${functions.size} functions`);
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
