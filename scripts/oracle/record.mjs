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
 * Standard mode (`win /s`), the mode WinBox runs in. `--mode enhanced`
 * starts 386 enhanced mode (`win /3`) instead, which DOSBox runs with the
 * same settings, and keeps its recordings apart (`MODES`).
 *
 *   node scripts/oracle/record.mjs
 *   node scripts/oracle/record.mjs strings      # just one
 *   node scripts/oracle/record.mjs --keep       # leave the scratch drive
 *   node scripts/oracle/record.mjs fault --shoot posted:5  # and take the screen
 *   node scripts/oracle/record.mjs launch --corpus simtower --cycles 20000 ...
 *                                   # DOSBox at a fixed rate, not as fast as it can
 *   node scripts/oracle/record.mjs dpmiver --mode enhanced
 *                                   # in 386 enhanced mode, as enhanced/dpmiver.json
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
import { mergeIni, parsePreset, presetCopies, presetShell } from './ini-preset.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CACHE = join(ROOT, 'oracle', '.cache');
const BUILD = join(ROOT, 'oracle', 'build');
const PROBES = join(BUILD, 'probes');
/* The Win386 probes, built apart (`build-probes.mjs`, `buildWin386`): read
 * only in 386 enhanced mode. In standard mode the Win386 supervisor shows
 * "Not running on a 386 DPMI implementation" and waits for its box, so a
 * plain run of every probe never sees them, and one named is refused. A
 * 16-bit probe whose source defines `PROBE_EITHER_MODE` answers that box
 * itself, and is read in both modes. */
const WIN386 = join(BUILD, 'win386');
const WIN386_SOURCES = join(ROOT, 'oracle', 'probes', 'win386');
const SCRATCH = join(BUILD, 'record-c');
const FIXTURES = join(ROOT, 'oracle', 'fixtures');

/** Where a probe writes, on the guest and on the host. */
const OUTPUT_DIR = 'ORACLE';

/* The shell a probe's preset keeps in place of the probe (`--ini`, its
 * `[oracle shell]`): `pmshell` is started by Program Manager, the shell. */
let presetShellProgram = null;

/** Where `fabricate.mjs` leaves the fonts built to ask a particular question. */
const FONTS = join(BUILD, 'fonts');

/**
 * Libraries of the corpus's programs a probe uses, by the probe: each put in
 * `C:\WINDOWS\SYSTEM` before it runs. Not Windows' own and not in the
 * repository: SimTower's WaveMix, `wavemix`'s whole subject.
 */
export const FROM_CORPUS = { wavemix: ['simtower/WAVMIX16.DLL'] };

/**
 * Probes recorded on a machine without a coprocessor: the BIOS's equipment
 * word's coprocessor bit (bit 1 of the word at 0040:0010) cleared before
 * Windows starts, by `NOFPU.COM`, which `noCoprocessor` lays out. KERNEL
 * takes whether there is one from that word (`INT 11h`, `KRNL386.EXE` seg1
 * `aa67`), and DOSBox's `INT 11h` answers it from there; DOSBox's own unit
 * still runs, but a program's floating-point instructions never reach it,
 * the OS fixups having made them WIN87EM's emulator's interrupts. Their
 * recordings say so in their source (`coprocessor: false`).
 */
export const WITHOUT_COPROCESSOR = ['fpemu', 'fptask'];

/** `NOFPU.COM`, a DOS program of four instructions. */
function noCoprocessor() {
  const BIOS_DATA = 0x0040;
  const EQUIPMENT = 0x0010;
  const COPROCESSOR = 0x02;

  return Buffer.from([
    /* mov ax, BIOS_DATA */ 0xb8,
    BIOS_DATA & 0xff,
    BIOS_DATA >> 8,
    /* mov ds, ax */ 0x8e,
    0xd8,
    /* and byte [EQUIPMENT], ~COPROCESSOR */ 0x80,
    0x26,
    EQUIPMENT & 0xff,
    EQUIPMENT >> 8,
    ~COPROCESSOR & 0xff,
    /* int 20h */ 0xcd,
    0x20,
  ]);
}

/** Long enough for Windows to boot and a probe to finish; short enough to fail. */
const TIMEOUT_SECONDS = 300;

/* `--cycles <n>`: DOSBox runs a fixed `n` cycles a millisecond rather than
 * as many as the host allows, so a program that paces itself by how much it
 * gets done -- SimTower's game clock -- is recorded at a rate that can be
 * named. */
let CYCLES = 'max';

/* `--mode <mode>`: the mode Windows is started in, `win /s` or `win /3`,
 * DOSBox's settings the same for both. Standard mode is the oracle's own,
 * every recording but those made with `--mode`; a recording in another mode
 * is kept apart from them, as `oracle/fixtures/<mode>/<fixture>.json`, which
 * no replay reads (`loadFixtures` takes the top level alone), and says its
 * mode in its source (`kb/guides/enhanced-mode.md`). */
export const MODES = {
  standard: { switch: '/s', host: 'dosbox, standard mode' },
  enhanced: { switch: '/3', host: 'dosbox, 386 enhanced mode' },
};
let MODE = 'standard';

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

    /* `start`: no record waited for -- a program of the corpus started
     * as an install is, with no probe -- but the seconds from Windows'
     * start. */
    for (;;) {
      const text = await readFile(output, 'latin1').catch(() => '');

      if (after === 'start' || text.split(/\r?\n/).some((line) => line.startsWith(`${after}\t`))) {
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
 * A probe with a set of discs on a drive (`<probe>.mounts`), run on a
 * virtual X display as for `--shoot`: each time it writes a record of
 * `swap` whose result is `request`, DOSBox's swap key is pressed --
 * Ctrl+F4, the mapper's `swapimg` (`bios_disk.cpp` 124-135, 527), which
 * puts the next disc in each drive with a set (`DriveManager::
 * CycleAllDisks`, `drives.cpp` 173-191). The probe waits for the disc
 * itself, by a file of it (`imgswap.c`), so when the key comes does not
 * change what it records.
 */
async function runSwapping(config, probe) {
  const displayName = ':95';
  const name = basename(probe, '.EXE');
  const output = join(SCRATCH, OUTPUT_DIR, `${name}.OUT`);
  const xvfb = spawn('Xvfb', [displayName, '-screen', '0', '800x600x24', '-extension', 'GLX'], {
    stdio: 'ignore',
  });

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
  const exited = new Promise((done) => dosbox.on('exit', done));
  let pressed = 0;

  try {
    const started = Date.now();

    while (dosbox.exitCode === null) {
      const text = await readFile(output, 'latin1').catch(() => '');
      const requests = text
        .split(/\r?\n/)
        .filter((line) => line.startsWith('swap\t') && line.endsWith('\trequest')).length;

      while (pressed < requests) {
        await run('python3', [
          join(ROOT, 'scripts', 'oracle', 'xkeys.py'),
          displayName,
          'Control_L+F4',
        ]);
        pressed++;
        log(`  swap key pressed (${pressed}) at ${((Date.now() - started) / 1000).toFixed(1)}s`);
      }

      if (Date.now() - started > TIMEOUT_SECONDS * 1000) {
        throw new Error(`${name} did not finish within ${TIMEOUT_SECONDS}s`);
      }

      await Promise.race([exited, new Promise((done) => setTimeout(done, 250))]);
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

/**
 * The images a probe has mounted beside C:, as `oracle/probes/<probe>.mounts`
 * lists them, a line each: a drive, an image of `oracle/probes/images/`, and
 * its kind -- `floppy`, `iso` or `hdd` -- as `a:imgflop.img floppy`. Each is
 * copied into the build first, since DOSBox writes a disk image's changes
 * straight into its file (`drive_fat.cpp`), and mounted with `imgmount`
 * before Windows starts. `#` starts a comment. Several images joined by
 * commas are one drive's set, as `d: imgsw1.iso,imgsw2.iso iso`: DOSBox
 * takes a set only of discs (`dos_programs.cpp` 1204-1207), and swaps in
 * the next as its swap key is pressed (`runSwapping`).
 */
async function mountsOf(probe) {
  const text = await readFile(join(ROOT, 'oracle', 'probes', `${probe}.mounts`), 'latin1').catch(
    () => ''
  );

  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*/, '').trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^([a-z]):\s*(\S+)\s+(floppy|iso|hdd)$/i);

      if (!match) {
        throw new Error(`${probe}.mounts: cannot read ${JSON.stringify(line)}`);
      }

      const images = match[2].split(',');

      return {
        letter: match[1].toUpperCase(),
        image: images[0],
        images,
        kind: match[3].toLowerCase(),
      };
    });
}

/** The `imgmount` lines for a probe's images, each copied into the build. */
async function imgmountLines(probe) {
  const lines = [];
  const into = join(BUILD, 'record-images');

  await rm(into, { recursive: true, force: true });

  for (const { letter, images, kind } of await mountsOf(probe)) {
    const copies = [];

    for (const image of images) {
      const copy = join(into, `${letter}-${image}`);

      await mkdir(into, { recursive: true });
      await cp(join(ROOT, 'oracle', 'probes', 'images', image), copy);
      copies.push(copy);

      /* A cue sheet's files beside it, by their own names, where DOSBox
       * looks for them after the working folder (`GetRealFileName`,
       * `cdrom_image.cpp` 618-647). */
      if (/\.cue$/i.test(image)) {
        const sheet = await readFile(join(ROOT, 'oracle', 'probes', 'images', image), 'latin1');

        for (const [, quoted, bare] of sheet.matchAll(/^\s*FILE\s+(?:"([^"]*)"|(\S+))/gim)) {
          const file = quoted ?? bare;

          await cp(join(ROOT, 'oracle', 'probes', 'images', file), join(into, file));
          log(`  ${letter}: ${file} (the cue sheet's)`);
        }
      }
    }
    /* An `hdd` is sized from its file, whole cylinders of 16 heads and 63
     * sectors (`dos_programs.cpp` 1213-1236). */
    lines.push(`imgmount ${letter.toLowerCase()} ${copies.join(' ')} -t ${kind}`);
    log(`  ${letter}: ${images.join(', ')} (${kind})`);
  }

  return lines;
}

/**
 * A program of the corpus on a disc of its own (`disc` in its entry): its
 * image, as `scripts/corpus/fetch.mjs` keeps it, mounted with `imgmount` at
 * the letter its entry gives, as a probe's `.mounts` are. DOSBox reads a
 * disc and never writes it, so the image is mounted where it is.
 */
function corpusMounts(corpus) {
  if (!corpus?.disc) {
    return [];
  }

  const image = join(ROOT, 'corpus', 'cache', corpus.id, `${corpus.id}.${corpus.source.image}`);

  return [`imgmount ${corpus.disc.toLowerCase()} ${image} -t ${corpus.source.image}`];
}

/** Boots Windows with the probe as its shell and waits for it to finish. */
async function runProbe(probe, display, shoot = null, capture = null, corpus = null) {
  const config = join(BUILD, 'record.conf');
  const mounts = [
    ...(await imgmountLines(basename(probe, '.EXE').toLowerCase())),
    ...corpusMounts(corpus),
  ];
  const swapping = (await mountsOf(basename(probe, '.EXE').toLowerCase())).some(
    ({ images }) => images.length > 1
  );
  const withoutCoprocessor = WITHOUT_COPROCESSOR.includes(basename(probe, '.EXE').toLowerCase());

  if (withoutCoprocessor) {
    await writeFile(join(SCRATCH, 'NOFPU.COM'), noCoprocessor());
  }

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
      ...mounts,
      'c:',
      ...(withoutCoprocessor ? ['nofpu'] : []),
      'cd \\WINDOWS',
      /* A program of the corpus started as an install is (`install` in its
       * entry): as Windows started as `WIN SETUP.EXE` runs one, Program
       * Manager the shell, given the program as its command line. */
      corpus?.install ? `win ${MODES[MODE].switch} ${corpus.run}` : `win ${MODES[MODE].switch}`,
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

  if (swapping) {
    await runSwapping(config, probe);
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
    host: MODES[MODE].host,
    ...(MODE === 'standard' ? {} : { mode: MODE }),

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

/**
 * Sets `WIN.INI` on the scratch drive as a probe's preset says, and makes
 * its copies (`ini-preset.mjs`). Answers the slug a recording under it is
 * named with: the preset's name.
 */
async function setIni(probe, preset) {
  const sections = parsePreset(
    await readFile(join(ROOT, 'oracle', 'probes', `${probe}.${preset}.ini`), 'latin1')
  );
  const onDrive = (path) => join(SCRATCH, ...path.replace(/^C:\\/i, '').split('\\'));

  for (const [to, from] of presetCopies(sections)) {
    await mkdir(dirname(onDrive(to)), { recursive: true });
    await cp(onDrive(from), onDrive(to));
    log(`  ${from} copied to ${to}`);
  }

  const path = join(SCRATCH, 'WINDOWS', 'WIN.INI');

  await writeFile(path, mergeIni(await readFile(path, 'latin1'), sections), 'latin1');
  log(`  WIN.INI set as ${probe}.${preset}.ini says`);
  presetShellProgram = presetShell(sections);
  return preset;
}

/**
 * What a run changed of the drive: each folder made, each file made or
 * written, by its path (DOS's, upper case, back slashes) with its size and
 * its SHA-256, and each file or folder of the installation that is gone --
 * the drive set beside the installation it was copied from, `C:\ORACLE`
 * left out. An installer's work, as Windows did it, for a layer to be held
 * to.
 */
async function driveChanges(base, drive) {
  const { createHash } = await import('node:crypto');
  const list = async (root, at = '') => {
    const out = new Map();
    const entries = (await readdir(join(root, at), { withFileTypes: true })).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0
    );

    for (const entry of entries) {
      const path = at ? `${at}/${entry.name}` : entry.name;

      if (!at && entry.name.toUpperCase() === OUTPUT_DIR) {
        continue;
      }

      if (entry.isDirectory()) {
        out.set(path, null);

        for (const [inner, value] of await list(root, path)) {
          out.set(inner, value);
        }
      } else {
        out.set(path, await readFile(join(root, path)));
      }
    }

    return out;
  };
  const before = await list(base);
  const after = await list(drive);
  const dos = (path) => path.toUpperCase().replace(/\//g, '\\');
  const changes = [];

  for (const [path, bytes] of after) {
    const was = before.get(path);

    if (bytes === null) {
      if (!before.has(path)) {
        changes.push({ kind: 'folder', path: dos(path) });
      }
    } else if (!was || !was.equals(bytes)) {
      changes.push({
        kind: 'file',
        path: dos(path),
        size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    }
  }

  for (const path of before.keys()) {
    if (!after.has(path)) {
      changes.push({ kind: 'removed', path: dos(path) });
    }
  }

  return changes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
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

  /* A program of the corpus started as an install is, from its disc:
   * Program Manager, the installation's shell, starts it (`runProbe`), and
   * no probe runs. What it changed of the drive is its record. */
  if (corpus?.install) {
    await rm(join(SCRATCH, OUTPUT_DIR), { recursive: true, force: true });
    await runProbe(basename(source), display, shoot, capture, corpus);

    return { records: [], changes: await driveChanges(driveFor(display), SCRATCH) };
  }

  /* A program of the corpus, started by the launcher from its own folder
   * on the drive, `C:\CORPUS\<ID>`. */
  if (corpus) {
    const folder = corpus.id.toUpperCase().slice(0, 8);

    await cp(join(ROOT, 'corpus', 'programs', corpus.id), join(SCRATCH, 'CORPUS', folder), {
      recursive: true,
    });
  }

  await setShell(presetShellProgram ?? basename(source));

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

  /* And a library of a program of the corpus it uses, in Windows' system
   * folder, where that program's installation puts it. */
  for (const file of FROM_CORPUS[name.toLowerCase()] ?? []) {
    await cp(
      join(ROOT, 'corpus', 'programs', ...file.split('/')),
      join(SCRATCH, 'WINDOWS', 'SYSTEM', basename(file))
    );
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

  await runProbe(basename(source), display, shoot, capture, corpus);

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
          /* And those placed by hand, which git ignores. */
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
  /* `--ini <preset>`: `WIN.INI` set as `oracle/probes/<probe>.<preset>.ini`
   * says before Windows starts (`ini-preset.mjs`), for one probe. Its
   * recording is named for it, `<probe>-<preset>`, and says so in its
   * source. */
  const iniAt = args.indexOf('--ini');
  const ini = iniAt === -1 ? null : args[iniAt + 1];
  const modeAt = args.indexOf('--mode');

  if (modeAt !== -1) {
    MODE = args[modeAt + 1];

    if (!MODES[MODE]) {
      throw new Error(`no mode ${MODE}; try ${Object.keys(MODES).join(', ')}`);
    }

    /* Their records and captures have no place of a mode's own yet. */
    if (MODE !== 'standard' && (corpus || capture)) {
      throw new Error('--mode is for probes; not with --corpus or --capture');
    }
  }

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

  /* Installed for winbox.js to run on, but for a card DOSBox has not got:
   * Windows would stop starting. */
  if (DISPLAYS[display].change) {
    throw new Error(
      `${display} cannot be recorded: DOSBox emulates no ${DISPLAYS[display].change}`
    );
  }

  const drive = driveFor(display);

  if (!(await stat(drive).catch(() => null))) {
    throw new Error(`nothing installed for ${display}; run scripts/oracle/install-windows.mjs`);
  }

  const win386 = (await readdir(WIN386_SOURCES).catch(() => []))
    .filter(
      (entry) => entry.endsWith('.c') && !entry.endsWith('.dll.c') && !entry.endsWith('.child.c')
    )
    .map((entry) => entry.slice(0, -2));
  /* Those read in standard mode as well: 16-bit probes that answer the
   * supervisor's box themselves. */
  const eitherMode = [];

  for (const name of win386) {
    const text = await readFile(join(WIN386_SOURCES, `${name}.c`), 'latin1');

    if (text.includes('#define PROBE_EITHER_MODE')) {
      eitherMode.push(name);
    }
  }

  const enhancedOnly = win386.filter((name) => !eitherMode.includes(name));

  if (MODE !== 'enhanced' && wanted.some((name) => enhancedOnly.includes(name))) {
    throw new Error(
      `${wanted.filter((name) => enhancedOnly.includes(name)).join(', ')}: a Win386 probe, ` +
        "recorded with --mode enhanced only (in standard mode it stops at the supervisor's box)"
    );
  }

  const readable = MODE === 'enhanced' ? win386 : eitherMode;
  const executables = [
    ...(await readdir(PROBES).catch(() => [])).map((entry) => join(PROBES, entry)),
    ...(await readdir(WIN386).catch(() => [])).map((entry) => join(WIN386, entry)),
  ]
    .filter((entry) => entry.endsWith('.EXE'))
    /* A program of the Win386 folder's own library or child is not a probe,
     * nor, in standard mode, one recorded in enhanced mode only. */
    .filter(
      (entry) =>
        !(dirname(entry) === WIN386 && !readable.includes(basename(entry, '.EXE').toLowerCase()))
    )
    .filter(
      (entry) => wanted.length === 0 || wanted.includes(basename(entry, '.EXE').toLowerCase())
    )
    .sort((a, b) => (basename(a) < basename(b) ? -1 : basename(a) > basename(b) ? 1 : 0));

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

  if (ini && wanted.length !== 1) {
    throw new Error('--ini is for one probe at a time');
  }

  const slug = midimap ? await setMidimap(midimap) : ini ? await setIni(wanted[0], ini) : null;

  await mkdir(FIXTURES, { recursive: true });
  const source = {
    ...(await provenance(display)),
    ...(midimap ? { midimap } : {}),
    ...(ini ? { ini } : {}),
  };

  for (const executable of executables) {
    const probe = basename(executable, '.EXE').toLowerCase();
    const name = slug ? `${probe}-${slug}` : probe;
    log(`Recording ${name} under Windows (${DISPLAYS[display].description})...`);

    const caught = capture && {
      ...capture,
      into: join(BUILD, 'captures', capture.dosbox ? `${name}-traced` : name),
    };
    const recorded = await record(name, executable, display, fabrication, shoot, corpus, caught);
    /* A program started as an install is answers what it changed of the
     * drive, with no records. */
    const records = Array.isArray(recorded) ? recorded : recorded.records;
    const changes = Array.isArray(recorded) ? null : recorded.changes;
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
        `${JSON.stringify({ program: corpus.id, display, source, records, ...(changes ? { changes } : {}) }, null, 2)}\n`
      );
      log(
        changes
          ? `  ${changes.length} changes of the drive -> corpus/reports/windows/${corpus.id}.json`
          : `  ${records.length} records -> corpus/reports/windows/${corpus.id}.json`
      );
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

    if (MODE !== 'standard') {
      fixture = `${MODE}/${fixture}`;
      await mkdir(dirname(join(FIXTURES, fixture)), { recursive: true });
    }

    await writeFile(
      join(FIXTURES, `${fixture}.json`),
      `${JSON.stringify(
        {
          probe,
          display,
          source: WITHOUT_COPROCESSOR.includes(probe) ? { ...source, coprocessor: false } : source,
          font: fabrication ?? null,
          records,
        },
        null,
        2
      )}\n`
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
