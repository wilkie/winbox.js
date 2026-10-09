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
 *   node scripts/oracle/record.mjs fault --shoot posted:5  # and take the screen
 *   node scripts/oracle/record.mjs launch --corpus simtower --cycles 20000 ...
 *                                   # DOSBox at a fixed rate, not as fast as it can
 *
 * Writes oracle/fixtures/<probe>.json, which is committed.
 */

import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DISPLAYS, SOUND_BLASTER, driveFor } from './install-windows.mjs';
import { decodeDro, decodeTrace, describeWav, writesJson } from './dro.mjs';
import { fixtureFor } from './per-display.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CACHE = join(ROOT, 'oracle', '.cache');
const BUILD = join(ROOT, 'oracle', 'build');
const PROBES = join(BUILD, 'probes');
const SCRATCH = join(BUILD, 'record-c');
const FIXTURES = join(ROOT, 'oracle', 'fixtures');

/** Where a probe writes, on the guest and on the host. */
const OUTPUT_DIR = 'ORACLE';

/** Where `fabricate.mjs` leaves the fonts built to ask a particular question. */
const FONTS = join(BUILD, 'fonts');

/** Long enough for Windows to boot and a probe to finish; short enough to fail. */
const TIMEOUT_SECONDS = 300;

/* `--cycles <n>`: DOSBox runs a fixed `n` cycles a millisecond rather than
 * as many as the host allows, so a program that paces itself by how much it
 * gets done -- SimTower's game clock -- is recorded at a rate that can be
 * named. */
let CYCLES = 'max';

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

/**
 * The screen, taken while a probe is stuck where nothing of Windows' own can
 * read it -- a system-modal box that lets no program run. DOSBox runs on a
 * virtual X display; once the probe's output holds a record of `after`, and
 * `seconds` more have passed, the display is grabbed at 640 by 480 into
 * `oracle/build/screens/<probe>.png`. Each `--then keys:seconds` presses
 * keys (X keysyms, `+` for held together, `,` between presses; `click=XxY`
 * the left button at a point of the screen, `xclick.py`), waits and
 * takes the screen again as `<probe>-2.png` and on; `--settle seconds` lets
 * the probe run on before DOSBox is stopped.
 */
async function runShooting(config, probe, shoot) {
  const { after, seconds, steps = [], settle = 0 } = shoot;
  const displayName = ':93';
  const name = basename(probe, '.EXE');
  const output = join(SCRATCH, OUTPUT_DIR, `${name}.OUT`);
  const shots = shoot.into ?? join(BUILD, 'screens');
  const shotName = shoot.name ?? name.toLowerCase();
  const xvfb = spawn('Xvfb', [displayName, '-screen', '0', '800x600x24', '-extension', 'GLX'], {
    stdio: 'ignore',
  });

  await mkdir(shots, { recursive: true });
  await new Promise((done) => setTimeout(done, 1000));

  const dosbox = spawn('dosbox', ['-conf', config, '-exit'], {
    stdio: 'ignore',
    env: {
      ...process.env,
      DISPLAY: displayName,
      SDL_VIDEODRIVER: 'x11',
      SDL_AUDIODRIVER: 'dummy',
      SDL_VIDEO_WINDOW_POS: '0,0',
    },
  });

  try {
    const started = Date.now();

    for (;;) {
      const text = await readFile(output, 'latin1').catch(() => '');

      if (text.split(/\r?\n/).some((line) => line.startsWith(`${after}\t`))) {
        break;
      }

      if (Date.now() - started > TIMEOUT_SECONDS * 1000) {
        throw new Error(`${name} never wrote a record of ${after}`);
      }

      await new Promise((done) => setTimeout(done, 500));
    }

    await new Promise((done) => setTimeout(done, seconds * 1000));

    const take = async (suffix) => {
      const shot = join(shots, `${shotName}${suffix}.png`);

      await run('import', [
        '-display',
        displayName,
        '-window',
        'root',
        '-crop',
        '640x480+0+0',
        shot,
      ]);
      log(`  screen -> ${shot}`);
    };

    await take('');

    /* Then keys pressed, a pause, and the screen again, for each step. */
    for (const [index, { keys, seconds: pause }] of steps.entries()) {
      /* `click=410x237` presses the button at that point of the screen,
       * for a box that takes no key (`xclick.py`). */
      const clicks = keys.filter((key) => key.startsWith('click='));
      const pressed = keys.filter((key) => !key.startsWith('click='));

      for (const click of clicks) {
        const [x, y] = click.slice('click='.length).split('x');

        await run('python3', [
          join(ROOT, 'scripts', 'oracle', 'xclick.py'),
          displayName,
          `${x},${y}`,
        ]);
      }

      if (pressed.length) {
        await run('python3', [
          join(ROOT, 'scripts', 'oracle', 'xkeys.py'),
          displayName,
          ...pressed,
        ]);
      }

      await new Promise((done) => setTimeout(done, pause * 1000));
      await take(`-${index + 2}`);
    }

    /* And the probe let run to its end, or to the time allowed. */
    const ending = Date.now();

    while (Date.now() - ending < settle * 1000) {
      if (dosbox.exitCode !== null) {
        break;
      }

      await new Promise((done) => setTimeout(done, 500));
    }
  } finally {
    dosbox.kill('SIGKILL');
    xvfb.kill('SIGKILL');
  }
}

/**
 * What DOSBox's sound chips were sent and what they sounded like, captured
 * while a probe plays: `--capture`. DOSBox 0.74 starts its captures only
 * from keys of its mapper -- Ctrl+Alt+F7 for the OPL's register writes, a
 * `.dro` file that begins at the first note played, and Ctrl+F6 for the
 * mixer's output, a `.wav` -- so it runs on a virtual X display, as for
 * `--shoot`, and the keys are pressed (`xkeys.py`) once the probe has
 * written a record of `capture`, which it follows with a pause. Each
 * `--then keys:seconds` is pressed after. The probe then runs to its end;
 * DOSBox closes both files as it exits. They land in
 * `oracle/build/captures/<probe>/`.
 *
 * `--dosbox <path>` runs another build of DOSBox: one that also writes
 * every access to the OPL's ports to `DOSBOX_OPL_TRACE` (`opl-trace.txt`
 * there), which a stock DOSBox ignores; its captures go to
 * `<probe>-traced/`.
 */
async function runCapturing(config, probe, capture) {
  const displayName = ':94';
  const name = basename(probe, '.EXE');
  const output = join(SCRATCH, OUTPUT_DIR, `${name}.OUT`);
  const xvfb = spawn('Xvfb', [displayName, '-screen', '0', '800x600x24', '-extension', 'GLX'], {
    stdio: 'ignore',
  });

  await new Promise((done) => setTimeout(done, 1000));

  const dosbox = spawn(capture.dosbox ?? 'dosbox', ['-conf', config, '-exit'], {
    stdio: 'ignore',
    env: {
      ...process.env,
      DISPLAY: displayName,
      SDL_VIDEODRIVER: 'x11',
      SDL_AUDIODRIVER: 'dummy',
      SDL_VIDEO_WINDOW_POS: '0,0',
      DOSBOX_OPL_TRACE: join(capture.into, 'opl-trace.txt'),
    },
  });
  const exited = new Promise((done) => dosbox.on('exit', done));

  try {
    const started = Date.now();

    for (;;) {
      const text = await readFile(output, 'latin1').catch(() => '');

      if (text.split(/\r?\n/).some((line) => line.startsWith('capture\tready\t'))) {
        break;
      }

      if (dosbox.exitCode !== null || Date.now() - started > TIMEOUT_SECONDS * 1000) {
        throw new Error(`${name} never wrote a record of capture`);
      }

      await new Promise((done) => setTimeout(done, 200));
    }

    /* The X server's keyboard map takes Ctrl+Alt+F7 for switching to the
     * seventh console, and DOSBox would be sent that rather than F7: F7 is
     * made only F7. */
    await run('xmodmap', ['-display', displayName, '-e', 'keysym F7 = F7']);
    await run('python3', [
      join(ROOT, 'scripts', 'oracle', 'xkeys.py'),
      displayName,
      'Control_L+Alt_L+F7',
      'Control_L+F6',
    ]);
    log(`  capturing at ${((Date.now() - started) / 1000).toFixed(1)}s`);

    for (const { keys, seconds } of capture.steps) {
      await new Promise((done) => setTimeout(done, seconds * 1000));

      for (const click of keys.filter((key) => key.startsWith('click='))) {
        const [x, y] = click.slice('click='.length).split('x');

        await run('python3', [
          join(ROOT, 'scripts', 'oracle', 'xclick.py'),
          displayName,
          `${x},${y}`,
        ]);
      }

      const pressed = keys.filter((key) => !key.startsWith('click='));

      if (pressed.length) {
        await run('python3', [
          join(ROOT, 'scripts', 'oracle', 'xkeys.py'),
          displayName,
          ...pressed,
        ]);
      }
    }

    const timeout = new Promise((done) =>
      setTimeout(() => done('timeout'), TIMEOUT_SECONDS * 1000)
    );

    if ((await Promise.race([exited, timeout])) === 'timeout') {
      throw new Error(`${name} did not finish within ${TIMEOUT_SECONDS}s of its capture`);
    }
  } finally {
    dosbox.kill('SIGKILL');
    xvfb.kill('SIGKILL');
  }
}

/**
 * What a capture caught, kept as `oracle/fixtures/opl/<probe>.json`: the
 * `.dro` files' writes, decoded (`dro.mjs`), and the `.wav` files
 * described -- the sound itself stays in `oracle/build/captures/<probe>/`.
 * The traced build's run keeps the trace instead, as `<probe>-trace.json`.
 */
async function keepCapture(name, display, source, capture) {
  const files = (await readdir(capture.into)).sort();
  const into = join(FIXTURES, 'opl');
  const chip = {
    dosbox: '0.74-3',
    /* `[sblaster]` as written for recording (`SOUND_BLASTER`), the rest
     * DOSBox's defaults. */
    sbtype: 'sb2',
    oplmode: 'auto',
    oplemu: 'default',
    oplrate: 44100,
    mixerRate: 44100,
  };

  await mkdir(into, { recursive: true });

  if (capture.dosbox) {
    const trace = decodeTrace(await readFile(join(capture.into, 'opl-trace.txt'), 'latin1'));
    const lines = trace.map(
      ({ ms, op, port, value }) =>
        `    {"ms":${ms.toFixed(6)},"op":"${op}","port":${port},"value":${value}}`
    );

    await writeFile(
      join(into, `${name}-trace.json`),
      `{\n  "probe": ${JSON.stringify(name)},\n  "display": ${JSON.stringify(display)},\n` +
        `  "source": ${JSON.stringify({ ...source, ...chip, build: 'traced' })},\n` +
        `  "trace": [\n${lines.join(',\n')}\n  ]\n}\n`
    );
    log(`  ${trace.length} port accesses -> opl/${name}-trace.json`);
    return;
  }

  const dros = [];
  const wavs = [];

  for (const file of files) {
    const bytes = await readFile(join(capture.into, file));

    if (file.endsWith('.dro')) {
      dros.push({ file, ...decodeDro(bytes) });
    } else if (file.endsWith('.wav')) {
      wavs.push({ file, ...describeWav(bytes) });
    }
  }

  if (dros.length === 0) {
    throw new Error(`${name}: DOSBox captured no OPL writes`);
  }

  const body = dros
    .map(
      ({ writes, ...header }) =>
        `    {\n      "header": ${JSON.stringify(header)},\n      "writes": ${writesJson(writes).replace(/\n/g, '\n    ')}\n    }`
    )
    .join(',\n');

  await writeFile(
    join(into, `${name}.json`),
    `{\n  "probe": ${JSON.stringify(name)},\n  "display": ${JSON.stringify(display)},\n` +
      `  "source": ${JSON.stringify({ ...source, ...chip })},\n` +
      `  "wav": ${JSON.stringify(wavs)},\n` +
      `  "dro": [\n${body}\n  ]\n}\n`
  );
  log(
    `  ${dros.map(({ writes }) => writes.length).join('+')} OPL writes, ` +
      `${wavs.map(({ ms }) => `${ms} ms`).join('+')} of sound -> opl/${name}.json`
  );
}

/** Boots Windows with the probe as its shell and waits for it to finish. */
async function runProbe(probe, display, shoot = null, capture = null) {
  const config = join(BUILD, 'record.conf');

  await writeFile(
    config,
    [
      '[dosbox]',
      `machine=${DISPLAYS[display].machine}`,
      'memsize=16',
      /* Where DOSBox writes what it captures (`--capture`). */
      ...(capture ? [`captures=${capture.into}`] : []),
      '[cpu]',
      'core=auto',
      `cycles=${CYCLES}`,
      '[sdl]',
      'autolock=false',
      'output=surface',
      '[render]',
      'scaler=none',
      'aspect=false',
      /* The sound card an installation with sound was set up for. */
      ...(DISPLAYS[display].sound ? SOUND_BLASTER : []),
      '[autoexec]',
      `mount c ${SCRATCH}`,
      'c:',
      'cd \\WINDOWS',
      'win /s',
      'exit',
      '',
    ].join('\n')
  );

  if (capture) {
    await runCapturing(config, probe, capture);
    return;
  }

  if (shoot) {
    await runShooting(config, probe, shoot);
    return;
  }

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

    /* A fixed rate, where `--cycles` gave one: a recording's times are then
     * instructions, DOSBox running that many a millisecond. */
    ...(CYCLES === 'max' ? {} : { cycles: Number(CYCLES.split(' ')[1]) }),
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

/**
 * Makes `setup` the MIDI Mapper's current setup on the scratch drive, as
 * the mapper's own routine for it does: `MIDIMAP.CFG`'s word at 6 is the
 * current setup's number in the file's table of setups (`MIDIMAP.DRV` seg3
 * `15fe`, `16ca`; `kb/topics/midi-mapper.md`). The table is at 0Eh: a word of
 * room (100), a word of setups in use, then each setup's 36h bytes -- its
 * name (16 bytes), description (32), number and place in the file -- the
 * first numbered 1. Only the scratch drive's copy is changed: the
 * installation keeps its own current setup, "Ad Lib".
 *
 * Answers the slug a recording under it is named with: the setup's name in
 * lower case, letters and digits only ("Ad Lib general", `adlibgeneral`).
 */
async function setMidimap(setup) {
  const path = join(SCRATCH, 'WINDOWS', 'SYSTEM', 'MIDIMAP.CFG');
  const bytes = await readFile(path);
  const room = bytes.readUInt16LE(0x0e);

  for (let at = 0; at < room; at++) {
    const entry = 0x12 + at * 0x36;
    const name = bytes.toString('latin1', entry, entry + 16).split('\0')[0];

    if (name.toLowerCase() === setup.toLowerCase()) {
      bytes.writeUInt16LE(at + 1, 6);
      await writeFile(path, bytes);
      log(`  MIDIMAP.CFG: "${name}", setup ${at + 1}, made current`);
      return name.toLowerCase().replace(/[^a-z0-9]/g, '');
    }
  }

  throw new Error(`no MIDI Mapper setup named ${setup} in ${path}`);
}

async function record(
  probe,
  source,
  display,
  fabrication,
  shoot = null,
  corpus = null,
  capture = null
) {
  const name = basename(source, '.EXE');

  /* A program of the corpus, started by the launcher from its own folder
   * on the drive, `C:\CORPUS\<ID>`. */
  if (corpus) {
    const folder = corpus.id.toUpperCase().slice(0, 8);

    await cp(join(ROOT, 'corpus', 'programs', corpus.id), join(SCRATCH, 'CORPUS', folder), {
      recursive: true,
    });
  }

  await setShell(basename(source));

  await cp(source, join(SCRATCH, 'WINDOWS', basename(source)));

  /* And the library a probe brings, beside it: see `build-probes.mjs`. */
  const library = join(dirname(source), `${name.toUpperCase()}D.DLL`);

  if (await stat(library).catch(() => null)) {
    await cp(library, join(SCRATCH, 'WINDOWS', basename(library)));
  }

  /* And the program it starts, beside it. */
  const child = join(dirname(source), `${name.toUpperCase()}C.EXE`);

  if (await stat(child).catch(() => null)) {
    await cp(child, join(SCRATCH, 'WINDOWS', basename(child)));
  }

  if (fabrication) {
    const staged = await stageFont(fabrication);

    log(`  using fabricated ${fabrication} (${staged.join(', ')})`);
  }
  await rm(join(SCRATCH, OUTPUT_DIR), { recursive: true, force: true });
  await mkdir(join(SCRATCH, OUTPUT_DIR), { recursive: true });

  /* Which program the launcher starts: a shell line with arguments starts
   * nothing. */
  if (corpus) {
    const folder = corpus.id.toUpperCase().slice(0, 8);
    const path = `C:\\CORPUS\\${folder}\\${corpus.run.toUpperCase().replace(/\//g, '\\')}`;

    await writeFile(join(SCRATCH, OUTPUT_DIR, 'LAUNCH.TXT'), path, 'latin1');
  }

  if (capture) {
    await rm(capture.into, { recursive: true, force: true });
    await mkdir(capture.into, { recursive: true });
  }

  await runProbe(basename(source), display, shoot, capture);

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

  /* `--corpus <id>`: a program of the corpus, run by the `launch` probe from
   * its own folder, for its screen with `--shoot started:<seconds>`. Its
   * records and screens are kept apart from the probes', under the id. */
  const corpusAt = args.indexOf('--corpus');
  const corpus =
    corpusAt === -1
      ? null
      : [
          ...JSON.parse(await readFile(join(ROOT, 'corpus', 'manifest.json'), 'utf8')).programs,
          /* And those placed by hand, which git ignores (`survey_test.ts`). */
          ...JSON.parse(
            await readFile(join(ROOT, 'corpus', 'manifest.local.json'), 'utf8').catch(
              () => '{"programs":[]}'
            )
          ).programs,
        ].find((entry) => entry.id === args[corpusAt + 1]);

  if (corpusAt !== -1 && !corpus) {
    throw new Error(
      `no program ${args[corpusAt + 1]} in corpus/manifest.json or manifest.local.json`
    );
  }

  /* `--shoot function[:seconds]`: the screen taken once the probe has written
   * a record of that function; see `runShooting`. */
  const shootAt = args.indexOf('--shoot');
  const shoot =
    shootAt === -1
      ? null
      : {
          after: args[shootAt + 1].split(':')[0],
          seconds: Number(args[shootAt + 1].split(':')[1] ?? 5),
          steps: args
            .map((argument, index) => (argument === '--then' ? args[index + 1] : null))
            .filter(Boolean)
            .map((step) => ({
              keys: step.split(':')[0].split(','),
              seconds: Number(step.split(':')[1] ?? 3),
            })),
          settle: args.includes('--settle') ? Number(args[args.indexOf('--settle') + 1]) : 0,
        };
  /* `--capture`: what the sound chips were sent, and the sound, captured
   * while the probe plays; see `runCapturing`. `--dosbox <path>` runs a
   * build of DOSBox that traces the OPL's ports as well, and keeps only the
   * trace: the stock DOSBox's capture stays the reference. */
  const dosboxAt = args.indexOf('--dosbox');
  const capture = args.includes('--capture')
    ? {
        dosbox: dosboxAt === -1 ? null : resolve(args[dosboxAt + 1]),
        steps: args
          .map((argument, index) => (argument === '--then' ? args[index + 1] : null))
          .filter(Boolean)
          .map((step) => ({
            keys: step.split(':')[0].split(','),
            seconds: Number(step.split(':')[1] ?? 3),
          })),
      }
    : null;
  const cyclesAt = args.indexOf('--cycles');
  /* `--midimap <setup>`: the MIDI Mapper's current setup made `setup` for the
   * run (`setMidimap`), on the installation with a sound card. Its
   * recordings are named for it, `<probe>-<setup>`, and say so in their
   * source, so that they sit beside the installation's own. */
  const midimapAt = args.indexOf('--midimap');
  const midimap = midimapAt === -1 ? null : args[midimapAt + 1];

  if (cyclesAt !== -1) {
    CYCLES = `fixed ${Number(args[cyclesAt + 1])}`;
  } else if (DISPLAYS[display]?.sound) {
    /* With a sound card, a fixed 3000 unless told otherwise: the Ad Lib's
     * driver looks for its card by reading its port in a short loop, which
     * on a real ISA bus takes a microsecond a read whatever the processor;
     * DOSBox at its fastest gets through it before the card's timer runs
     * out, and the driver finds no card. At 3000 it finds one, as on a
     * real machine. */
    CYCLES = 'fixed 3000';
  }

  if (corpus && shoot) {
    shoot.into = join(ROOT, 'corpus', 'reports', 'windows');
    shoot.name = cyclesAt === -1 ? corpus.id : `${corpus.id}-c${Number(args[cyclesAt + 1])}`;
  }

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

  if (midimap && !DISPLAYS[display].sound) {
    throw new Error(`--midimap wants an installation with a sound card, not ${display}`);
  }

  const slug = midimap ? await setMidimap(midimap) : null;

  await mkdir(FIXTURES, { recursive: true });
  const source = { ...(await provenance(display)), ...(midimap ? { midimap } : {}) };

  for (const executable of executables) {
    const probe = basename(executable, '.EXE').toLowerCase();
    const name = slug ? `${probe}-${slug}` : probe;
    log(`Recording ${name} under Windows (${DISPLAYS[display].description})...`);

    const caught = capture && {
      ...capture,
      into: join(BUILD, 'captures', capture.dosbox ? `${name}-traced` : name),
    };
    const records = await record(
      name,
      join(PROBES, executable),
      display,
      fabrication,
      shoot,
      corpus,
      caught
    );
    const functions = new Set(records.map((entry) => entry.function));

    /* A probe whose answers belong to the driver gets a fixture per driver;
     * the rest would only be recorded again under a different name.
     */
    let fixture = slug ? name : fixtureFor(name, display);

    /* A program of the corpus: its records beside its screens, not a
     * probe's fixture. */
    if (corpus) {
      const into = join(ROOT, 'corpus', 'reports', 'windows');

      await mkdir(into, { recursive: true });
      await writeFile(
        join(into, `${corpus.id}.json`),
        `${JSON.stringify({ program: corpus.id, display, source, records }, null, 2)}\n`
      );
      log(`  ${records.length} records -> corpus/reports/windows/${corpus.id}.json`);
      continue;
    }

    if (caught) {
      await keepCapture(name, display, source, caught);

      /* The traced build's run keeps its trace, and not its records over
       * the stock DOSBox's. */
      if (capture.dosbox) {
        continue;
      }
    }

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
      `${JSON.stringify({ probe, display, source, font: fabrication ?? null, records }, null, 2)}\n`
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
