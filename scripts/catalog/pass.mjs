#!/usr/bin/env node
/**
 * The compatibility catalog's first pass, after the fetch
 * (`scripts/catalog/fetch.mjs`): each item's needs read from its files
 * (`needs.mjs`), its setup run where it has one, its program run in WinBox
 * for ten seconds of the survey's clock (`trace`), and the run classified.
 * The design is `kb/guides/compatibility.md`, "The automated first pass".
 *
 *   cargo build --release -p winbox-win16 --example trace
 *   node scripts/catalog/pass.mjs                # every item fetched and not yet run at this commit
 *   node scripts/catalog/pass.mjs win3_nails     # these, again
 *   node scripts/catalog/pass.mjs --results      # catalog/results.json, catalog/queue.json, the needs in catalog/catalog.json
 *
 * A program still `running` at its ten seconds is run on, from the start
 * again, for each of `STAGES` (20, 40, 80, 120 virtual seconds) until it is
 * not `running`; its record's `seconds` is the first length at which its
 * state was found, and `stages` the states at each length. A program that
 * polls its input and draws, with no message call among its last thousand,
 * is `playing` (`outcome`). `--stages 20,40` names other lengths;
 * `resultOf(item)` is an item's line of `catalog/results.json`, for
 * splicing a few items' lines in without writing the rest.
 *
 * Each program runs inside WinBox alone, on a drive made for the run with a
 * copy of its item's folder as `C:\CORPUS\<ID>\`, over the oracle's
 * installation (read, never written), on the VGA's 16 colours in standard
 * mode; in enhanced mode where the Win386 supervisor is among its files, or
 * where its run says it needs enhanced mode; on 256 colours where its run
 * says it needs more colours. A setup runs as Program Manager starts it
 * (`trace --shell`), on a drive kept for its program, with Enter pressed
 * every few seconds (`ENTER`), and the program it leaves is found from the
 * Program Manager group it made. A disc's or a floppy's image is mounted as
 * a drive (`trace --mount`), as the corpus mounts a disc.
 *
 * What is kept: each item's state in `corpus/cache/catalog/pass/<id>.json`,
 * its screen and the end of its trace in `corpus/cache/catalog/`
 * (gitignored); in the repository only `catalog/results.json` and
 * `catalog/queue.json`, made by `--results`, and the needs in the catalog.
 */

import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';

import { withoutExcluded } from './excluded.mjs';
import { PROGRAMS, catalogItems, downloadPath, keep, stateOf } from './fetch.mjs';
import { filesOf, findFile, headerOf, needsOf } from './needs.mjs';
import { runtimeBytes } from './runtimes.mjs';
import { classify } from './sample.mjs';
import { applyRun, clean, decode, foundOf, readFolder } from './titles.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CACHE = join(ROOT, 'corpus', 'cache', 'catalog');
const TRACE = join(ROOT, 'target', 'release', 'examples', 'trace');
const DRIVES = join(CACHE, 'drives');
const INSTALLS = join(CACHE, 'installs');
const TITLES = join(CACHE, 'titles');

const SECONDS = 10;
const RATE = 3000;
/**
 * A program still `running` at its ten seconds is run on, from the start
 * again (the clock is instructions, so the same run), for each of these
 * lengths in turn until it is not `running`; the last is the cap.
 */
let STAGES = [20, 40, 80, 120];
/** Virtual seconds a setup is run alone first, to find where it first waits. */
const FIRST_WAIT = 30;
/** Virtual seconds a setup is given. */
const INSTALL_SECONDS = 180;
/** Enter pressed every so many milliseconds of a setup's run, from the first. */
const ENTER = 4000;
/** Runs at once. */
const PARALLEL = Number(process.env.PASS_PARALLEL ?? 12);

/** A image mounted as a drive: a disc's (as the corpus mounts one), a floppy's. */
const DISC = /\.(iso|cue)$/i;
const FLOPPY = /\.(img|ima|dsk|vfd)$/i;

/** The Windows installation beneath the run's drive, for a display. */
function windowsFor(display) {
  return join(ROOT, 'oracle', 'build', display === 'vga' ? 'drive-c' : `drive-c-${display}`);
}

function sha256Of(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');

    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

/** The folder's name as DOS has it under `C:\CORPUS\`: the identifier's letters and digits, eight. */
function shortOf(id) {
  return (
    id
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 8) || 'PROGRAM'
  );
}

/** A path within a folder as DOS names it. */
function dosPath(path) {
  return path.split(/[\\/]/).join('\\').toUpperCase();
}

/** The marks that press Enter every `ENTER` milliseconds of a setup's run. */
function enterMarks() {
  const file = join(CACHE, 'enter-marks.json');
  const stepMarks = [];

  for (let time = ENTER; time < INSTALL_SECONDS * 1000; time += ENTER) {
    for (const [kind, at] of [
      ['down', time],
      ['up', time + 50],
    ]) {
      stepMarks.push({ calls: 0, instructions: 0, time: at, kind, key: '\r', code: 'Enter' });
    }
  }

  writeFileSync(file, JSON.stringify({ stepMarks }));
  return file;
}

/** The calls of a program that polls its input instead of waiting for a message. */
const POLLS =
  /^USER\.(GetAsyncKeyState|GetKeyState|GetKeyboardState|GetInputState|PeekMessage)[ (]/;
/** The calls that put something on the screen. */
const DRAWS =
  /^(GDI\.(BitBlt|StretchBlt|PatBlt|StretchDIBits|SetDIBitsToDevice|SetDIBits|LineTo|Polygon|Polyline|Rectangle|Ellipse|TextOut|ExtTextOut|SetPixel|FloodFill)|USER\.(DrawText|FillRect|DrawIcon|InvalidateRect|UpdateWindow)|WING\.\w+)[ (]/;

/** The lines of a run's calls kept whole: the last so many. */
const KEPT = 2000;
const CALL = /^[A-Z][A-Z0-9_]*\.\w+[ (]/;
const END = /^(stopped|application fault|window|bytes|registers|DOS)/;

/**
 * One run of `trace`: its output, its errors, and the host's milliseconds.
 * A busy program's calls run to millions of lines, so its calls are
 * counted as they come and only the last `KEPT` kept, with a line saying a
 * window was made or shown before them (what `classify` asks of the
 * earlier calls); every other line is kept.
 */
function trace(args, timeout) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(TRACE, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    /* The captions' JSON is UTF-8, each character one of the caption's bytes. */
    const utf8 = new StringDecoder('utf8');
    const tail = [];
    const other = [];
    let calls = 0;
    let shown = false;
    let partial = '';
    let err = '';
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
    }, timeout);
    const line = (text) => {
      if (CALL.test(text)) {
        calls++;
        tail.push(text);

        if (tail.length > KEPT) {
          const dropped = tail.shift();

          shown ||= /^USER\.(ShowWindow|CreateWindow)/.test(dropped);
        }
      } else {
        other.push(text);
      }
    };

    child.stdout.on('data', (chunk) => {
      const lines = (partial + utf8.write(chunk)).split('\n');

      partial = lines.pop();
      lines.forEach(line);
    });
    child.stderr.on('data', (chunk) => (err = (err + chunk).slice(-4000)));
    child.on('close', () => {
      clearTimeout(timer);

      if (partial) {
        line(partial);
      }

      const out = [
        ...other.filter((text) => !END.test(text)),
        ...(shown ? ['USER.ShowWindow (before the calls kept)'] : []),
        ...tail,
        ...other.filter((text) => END.test(text)),
      ].join('\n');

      resolve({ out, calls, err, killed, ms: Date.now() - started });
    });
  });
}

/** The windows at the top a run left (`--captions`), their captions and a box's text decoded. */
function windowsOf(out) {
  return out
    .split('\n')
    .filter((line) => line.startsWith('window: '))
    .map((line) => {
      try {
        return JSON.parse(line.slice(8));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .map((window) => ({
      ...window,
      title: clean(decode(Buffer.from(window.title ?? '', 'latin1'))),
      ...(window.text !== undefined
        ? { text: clean(decode(Buffer.from(window.text, 'latin1'))) }
        : {}),
    }));
}

/** The box a run left shown, if one: its caption and its text. */
function boxOf(windows) {
  const box = windows.find((window) => window.box && window.visible);

  return box ? { title: box.title, text: box.text ?? '' } : null;
}

/**
 * A run classified (`sample.mjs`'s `classify`), its box's text the
 * signature of `box`, a panic of the engine's a fault of WinBox's own, and
 * a run the host stopped `running`.
 */
function outcome(run, seconds = SECONDS) {
  const windows = windowsOf(run.out);
  const box = boxOf(windows);
  const { calls } = run;
  const instructions = Number(/after (\d+) instructions/.exec(run.out)?.[1] ?? 0);
  let result = classify(run.out, seconds);

  if (result.status === 'no-output') {
    const panic = /panicked at [^\n]*\n([^\n]*)/.exec(run.err);

    result = run.killed
      ? { status: 'running', signature: 'the host stopped it' }
      : panic
        ? {
            status: 'fault',
            signature: `WinBox: ${panic[1]
              .trim()
              .replace(/\/\S*\//g, '')
              .slice(0, 160)}`,
          }
        : { status: 'fault', signature: `WinBox: no output (${run.err.trim().split('\n').pop()})` };
  }

  if (result.status === 'box' && box) {
    result.signature = `${box.title}: ${box.text}`.slice(0, 240);
  }

  /*
   * A window shown that the program did not make with `CreateWindow` or
   * show with `ShowWindow`: a dialog of `DialogBox`, whose loop is USER's
   * and makes no call of the program's. Waiting there is `idle` by the
   * same rule: a message call among its last thousand calls, or under a
   * tenth of its seconds' instructions run.
   */
  if (result.status === 'running' && windows.some((window) => window.visible && !window.box)) {
    const recent = run.out
      .split('\n')
      .filter((line) => CALL.test(line))
      .slice(-1000);

    if (
      recent.some((line) => /^USER\.(GetMessage|WaitMessage|PeekMessage)[ (]/.test(line)) ||
      instructions < seconds * RATE * 1000 * 0.1
    ) {
      result = { status: 'idle', signature: '' };
    }
  }

  /*
   * `playing`: the program is polling its input, with something up on the
   * screen, instead of waiting for a message: among its last thousand
   * calls a poll (`GetAsyncKeyState`, `GetKeyState`, `GetKeyboardState`,
   * `GetInputState`, `PeekMessage`) and either a call that draws or a
   * window of its own shown. A program that draws to the screen's own DC
   * has no window of its own to show. A dialog of `DialogBox` up means the
   * program is waiting for its user there, not playing, and a program
   * still loading polls nothing: both stay as they were.
   */
  if (
    result.status === 'running' &&
    !windows.some((window) => window.visible && window.class === '#32770')
  ) {
    const recent = run.out
      .split('\n')
      .filter((line) => CALL.test(line))
      .slice(-1000);

    if (
      recent.some((line) => POLLS.test(line)) &&
      (recent.some((line) => DRAWS.test(line)) ||
        windows.some((window) => window.visible && !window.box))
    ) {
      result = { status: 'playing', signature: '' };
    }
  }

  /* The DOS functions the run asked that WinBox did not answer (AX, as `trace` prints them). */
  const dos = /^DOS functions not answered: \[(.*)\]/m.exec(run.out)?.[1];

  return {
    ...result,
    box,
    windows,
    answered: answeredOf(run.out),
    calls,
    instructions,
    ms: run.ms,
    ...(dos ? { dos: [...new Set(dos.split(', '))] } : {}),
  };
}

/**
 * USER's system error boxes a run brought up, answered or not (`trace`'s
 * `answered:` lines): a box a program shows and then ends after.
 */
function answeredOf(out) {
  return out
    .split('\n')
    .filter((line) => line.startsWith('answered: '))
    .map((line) => {
      try {
        const box = JSON.parse(line.slice(10));

        return {
          title: clean(decode(Buffer.from(box.title ?? '', 'latin1'))),
          text: clean(decode(Buffer.from(box.text ?? '', 'latin1'))),
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/** What a run's boxes or windows say it needs: enhanced mode, or more colours. */
function askedFor(result) {
  const said = [
    result.box?.text,
    result.box?.title,
    ...result.windows.flatMap((w) => [w.title, w.text]),
    ...(result.answered ?? []).flatMap((box) => [box.title, box.text]),
  ]
    .filter(Boolean)
    .join(' \n ');

  return {
    enhanced: /enhanced mode|386 enhanced|386-enhanced/i.test(said),
    colours: /256[- ]colou?r|256 colou?r|more colou?rs|colou?r palette|SVGA|super ?vga/i.test(said),
  };
}

/**
 * A program that needs sound or MIDI: run with WinBox's own sound card
 * installed (`trace --sound`, as winbox-native's), as a person running it
 * with sound would.
 */
function wantsSound(needs) {
  return Boolean(needs.flags?.some((flag) => flag === 'sound' || flag === 'midi'));
}

/** The arguments of a run of a program. */
function runArgs({ exe, path, drive, mounts, mode, display, sound, seconds, screen, extra = [] }) {
  return [
    ...(exe ? [exe] : []),
    '--path',
    path,
    '--drive',
    drive,
    '--windows',
    windowsFor(display),
    ...(sound ? ['--sound'] : []),
    '--display',
    display,
    '--mode',
    mode,
    '--boxes',
    '3',
    '--seconds',
    String(seconds + 0.1),
    '--budget',
    String(seconds * 2 * RATE * 1000),
    '--captions',
    ...mounts.flatMap(([letter, image]) => ['--mount', `${letter}:${image}`]),
    ...(screen ? ['--screen', screen] : []),
    ...extra,
  ];
}

/**
 * The images an item's downloads hold, and the drive each is mounted as: a
 * disc's always, as D:, as the corpus mounts one; a floppy's, as A:, only
 * where `floppies` asks (the program is on it).
 */
function mountsOf(item, folder, floppies = false) {
  const images = [
    ...item.source.archiveOrg.downloads.map((each) => downloadPath(item.id, each.file)),
    ...filesOf(folder),
  ].filter((file) => existsSync(file));
  const disc =
    images.find((file) => /\.cue$/i.test(file)) ?? images.find((file) => DISC.test(file));
  const floppy = images.find((file) => FLOPPY.test(file) && statSync(file).size <= 2_949_120);
  const mounts = [];

  if (disc) {
    mounts.push(['D', disc]);
  }

  if (floppy && floppies) {
    mounts.push(['A', floppy]);
  }

  return mounts;
}

/**
 * The runtimes a program needs and does not bring (`needs.runtimes`,
 * `runtimes.mjs`), put in the drive's `WINDOWS\SYSTEM`, over the
 * installation beneath it, as an installed Windows would have them.
 */
function placeRuntimes(drive, needs) {
  if (!needs?.runtimes?.length) {
    return;
  }

  const system = join(drive, 'WINDOWS', 'SYSTEM');

  mkdirSync(system, { recursive: true });

  for (const module of needs.runtimes) {
    const bytes = runtimeBytes(module);

    if (!bytes) {
      throw new Error(`the runtime ${module} is not fetched: scripts/catalog/runtimes.mjs --fetch`);
    }

    writeFileSync(join(system, `${module}.DLL`), bytes);
  }
}

/**
 * The files an item's batch file copies into Windows' folders, placed in
 * the drive's: archive.org's DOSBox mounts the item as C:, the current
 * drive, and Windows as D:, and a batch puts the libraries and settings a
 * setup would have installed where Windows finds them before it starts
 * the program (`COPY WAVEMIX\WAVMIX16.DLL D:\WINDOWS\SYSTEM`,
 * `copy C:\WINDOWS\SYSTEM\*.* D:\WINDOWS\SYSTEM`). Only a copy from the
 * item (C: or no drive) into a `\WINDOWS` or `\WINDOWS\SYSTEM` folder, of a
 * name or `*.*`; the batch is read as data.
 */
function placeBatchCopies(drive, folder, needs) {
  const batch = needs?.batch && findFile(filesOf(folder), basename(needs.batch));

  if (!batch) {
    return;
  }

  for (const line of readFileSync(batch, 'latin1').split(/\r?\n/)) {
    const [command, from, to] = line.trim().split(/\s+/);

    if (!/^copy$/i.test(command ?? '') || !from || !to || /^[a-bd-z]:/i.test(from)) {
      continue;
    }

    const place = /^[a-z]:\\windows(\\system)?\\?$/i.exec(to);

    if (!place) {
      continue;
    }

    const target = join(drive, 'WINDOWS', ...(place[1] ? ['SYSTEM'] : []));
    const parts = from.replace(/^c:/i, '').split('\\').filter(Boolean);
    const name = parts.pop();
    const source = parts.length ? onDrive(folder, parts.join('\\')) : folder;

    if (!name || !source || !statSync(source).isDirectory()) {
      continue;
    }

    mkdirSync(target, { recursive: true });

    for (const each of readdirSync(source)) {
      const file = join(source, each);
      const wanted = name === '*.*' || each.toUpperCase() === name.toUpperCase();

      if (wanted && statSync(file).isFile()) {
        cpSync(file, join(target, each.toUpperCase()));
      }
    }
  }
}

/**
 * A drive made for a run: the item's folder copied as `C:\CORPUS\<ID>\`,
 * the runtimes it needs in `WINDOWS\SYSTEM`, and what its batch file copies
 * into Windows' folders.
 */
function driveFor(item, folder, at, needs) {
  rmSync(at, { recursive: true, force: true });
  mkdirSync(join(at, 'CORPUS'), { recursive: true });
  cpSync(folder, join(at, 'CORPUS', shortOf(item.id)), { recursive: true });
  placeRuntimes(at, needs);
  placeBatchCopies(at, folder, needs);
  return at;
}

/** A file on a drive by its DOS path, its names matched in any case. */
function onDrive(drive, path) {
  let at = drive;

  for (const part of path
    .replace(/^[A-Za-z]:\\?/, '')
    .split('\\')
    .filter(Boolean)) {
    const found = existsSync(at)
      ? readdirSync(at).find((name) => name.toUpperCase() === part.toUpperCase())
      : null;

    if (!found) {
      return null;
    }

    at = join(at, found);
  }

  return at;
}

/**
 * The items of Program Manager's group files (`.GRP`, "PMCC"): the header's
 * item count at 20h and their offsets from 22h; each item's name at 12h and
 * command line at 14h, offsets into the file of strings ending in nought.
 * The format is Windows 3.1's `PROGMAN.EXE`'s, as WinBox's
 * `progman/loaded.rs` writes it.
 */
export function groupItems(bytes) {
  if (bytes.toString('latin1', 0, 4) !== 'PMCC') {
    return [];
  }

  const string = (at) => {
    const end = bytes.indexOf(0, at);

    return bytes.toString('latin1', at, end < 0 ? bytes.length : end);
  };
  const count = bytes.readUInt16LE(0x20);
  const items = [];

  for (let index = 0; index < count; index++) {
    const at = bytes.readUInt16LE(0x22 + index * 2);

    if (!at || at + 0x18 > bytes.length) {
      continue;
    }

    items.push({
      name: string(bytes.readUInt16LE(at + 0x12)),
      command: string(bytes.readUInt16LE(at + 0x14)),
    });
  }

  return { group: string(bytes.readUInt16LE(0x16)), items };
}

/**
 * Windows' own programs' windows, which Program Manager opens when Enter
 * reaches it after a setup has ended: not where the setup stopped.
 */
const WINDOWS_OWN =
  /^(Program Manager|File Manager|Control Panel|Notepad|Write|Paintbrush|Clock|Calculator|Cardfile|Calendar|Terminal|Recorder|Character Map|Media Player|Sound Recorder|Windows Setup|PIF Editor|Clipboard Viewer|Windows Help|Task List|Print Manager|Main|Accessories|Games|StartUp)\b/;

/** An item of a group that is not a program to try: a setup, a help file, a text. */
const NOT_THE_PROGRAM =
  /setup|install|uninst|remove|read ?me|help|register|order|readme|\.(hlp|txt|wri|doc|bat|pif|ini)\b/i;

/**
 * A setup run as Program Manager starts it, Enter pressed every few
 * seconds, on a drive kept for the program it leaves. The program is the
 * first item of the groups it made that is not a setup, a help or a text;
 * else the one Windows program it put on the drive outside `CORPUS` and
 * `WINDOWS`. Where it leaves none, the classification is `installer`, with
 * where it stopped.
 */
async function install(item, folder, needs, mounts) {
  const setupPath = needs.setup
    ? `C:\\CORPUS\\${shortOf(item.id)}\\${dosPath(needs.setup)}`
    : needs.onImage;

  /*
   * First the setup alone for `FIRST_WAIT` seconds, nothing pressed: where
   * it first waits (a box's text, or its window's caption), which Enter
   * would answer and so hide, on a drive thrown away after.
   */
  const probeDrive = driveFor(item, folder, join(DRIVES, `${item.id}.setup`), needs);
  const probe = outcome(
    await trace(
      runArgs({
        exe: needs.setup ? join(probeDrive, 'CORPUS', shortOf(item.id), needs.setup) : null,
        path: setupPath,
        drive: probeDrive,
        mounts,
        mode: needs.mode,
        display: needs.display ?? 'vga',
        sound: wantsSound(needs),
        seconds: FIRST_WAIT,
        screen: join(CACHE, 'screens', `${item.id}.setup-first.png`),
        extra: ['--shell'],
      }),
      5 * 60_000
    )
  );

  rmSync(probeDrive, { recursive: true, force: true });

  const ownWindows = (windows) =>
    windows
      .filter((window) => window.visible && !window.box && !WINDOWS_OWN.test(window.title))
      .map((window) => (window.text ? `${window.title}: ${window.text}` : window.title))
      .filter(Boolean);
  const first = probe.box
    ? `${probe.box.title}: ${probe.box.text}`
    : (ownWindows(probe.windows).slice(-1)[0] ?? `${probe.status} ${probe.signature}`.trim());
  const drive = driveFor(item, folder, join(INSTALLS, item.id), needs);
  const run = await trace(
    runArgs({
      exe: needs.setup ? join(folder, needs.setup) : null,
      path: setupPath,
      drive,
      mounts,
      mode: needs.mode,
      display: needs.display ?? 'vga',
      sound: wantsSound(needs),
      seconds: INSTALL_SECONDS,
      screen: join(CACHE, 'screens', `${item.id}.setup.png`),
      extra: ['--shell', '--marks', enterMarks()],
    }),
    15 * 60_000
  );
  const result = outcome(run);
  const windows = join(drive, 'WINDOWS');
  const groups = (existsSync(windows) ? readdirSync(windows) : [])
    .filter((name) => /\.grp$/i.test(name))
    .map((name) => groupItems(readFileSync(join(windows, name))))
    .filter((group) => group.items);
  const record = {
    status: result.status,
    signature: result.signature,
    ms: run.ms,
    groups: groups.map((group) => ({ group: group.group, items: group.items })),
    shown: result.windows
      .filter((window) => window.visible && !WINDOWS_OWN.test(window.title))
      .map((window) => (window.text ? `${window.title}: ${window.text}` : window.title)),
    box: result.box,
    first,
    firstBox: Boolean(probe.box),
    /*
     * The DOS functions not answered while the setup ran alone: once Enter
     * has taken it through, Program Manager's and File Manager's own ask
     * theirs as well (Enter opens Main's items when the setup has gone).
     */
    ...(probe.dos ? { dos: probe.dos } : {}),
  };
  writeFileSync(
    join(CACHE, 'traces', `${item.id}.setup.txt`),
    run.out.split('\n').slice(-300).join('\n')
  );

  /* The items that are not a setup's, a help's or a text's first; then a program named as a setup. */
  const commands = groups.flatMap((group) =>
    group.items.map((each) => ({ ...each, command: each.command.trim().split(/\s+/)[0] }))
  );
  const ordered = [
    ...commands.filter(
      (each) => !NOT_THE_PROGRAM.test(each.name) && !NOT_THE_PROGRAM.test(each.command)
    ),
    ...commands.filter((each) => /\.exe$/i.test(each.command) && !/uninst/i.test(each.command)),
  ];

  for (const group of [{ items: ordered }]) {
    for (const { command } of group.items) {
      if (!command) {
        continue;
      }

      const path = /^[A-Za-z]:/.test(command) ? command : `C:\\${command}`;

      if (/^[Cc]:/.test(path)) {
        const file = onDrive(drive, path);

        if (file && headerOf(readFileSync(file)) === 'NE') {
          return { ...record, drive, program: { path: path.toUpperCase(), file, from: 'group' } };
        }
      } else if (mounts.some(([letter]) => path.toUpperCase().startsWith(`${letter}:`))) {
        return {
          ...record,
          drive,
          program: { path: path.toUpperCase(), file: null, from: 'group' },
        };
      }
    }
  }

  /*
   * No group: the one Windows program it put on the drive, outside a
   * setup's own folders of the moment (Microsoft's toolkit's `~MSSTFQF.T`)
   * and its own files (`_MSTEST.EXE`).
   */
  const made = filesOf(drive)
    .filter((file) => !/^(CORPUS|WINDOWS|TEMP|TMP)[\\/]/i.test(relative(drive, file)))
    .filter((file) => !/(^|[\\/])[~_]/.test(relative(drive, file)))
    .filter((file) => /\.exe$/i.test(file) && !NOT_THE_PROGRAM.test(basename(file)))
    .filter((file) => headerOf(readFileSync(file)) === 'NE');

  if (made.length === 1) {
    return {
      ...record,
      drive,
      program: { path: `C:\\${dosPath(relative(drive, made[0]))}`, file: made[0], from: 'files' },
    };
  }

  return { ...record, drive, program: null };
}

/**
 * A run that ended in `UndefDynLink`, which a call to an import not linked
 * goes to, is `missing` where the program imports functions of WinBox's
 * modules that WinBox does not export (`needs.unlinked`): those are the
 * signature.
 */
function refined(result, needs) {
  if (
    result.status === 'ended' &&
    /KERNEL\.UndefDynLink$/.test(result.signature) &&
    needs.unlinked?.length
  ) {
    return { status: 'missing', signature: needs.unlinked.join(', ') };
  }

  return {};
}

/** An item's needs and its run, classified; its state kept. */
async function pass(item, commit) {
  const state = stateOf(item.id);
  const folder = join(PROGRAMS, item.id);
  const date = new Date().toLocaleDateString('sv');
  /* The runtimes placed for it, where any were (`placeRuntimes`). */
  const placed = () => (state.needs?.runtimes?.length ? { runtimes: state.needs.runtimes } : {});
  const done = (result) =>
    keep(item.id, {
      result: { ...result, ...placed(), commit, date },
      needs: state.needs ?? null,
    });

  if (item.emulator && item.emulator !== 'dosbox') {
    return done({ status: 'not-windows', signature: `archive.org runs it in ${item.emulator}` });
  }

  if (!state.fetch?.ok) {
    return done({ status: 'fetch', signature: state.fetch?.error ?? 'not fetched' });
  }

  let needs;

  try {
    needs = needsOf(item, folder, []);
  } catch (error) {
    needs = { error: `reading it: ${error.message}` };
  }

  /* A program not in the download: on an image, a floppy's among them. */
  const fromImage = Boolean(needs.error && item.run && !/\.bat$/i.test(item.run));
  const mounts = mountsOf(item, folder, fromImage);

  needs.images = mounts.map(([letter, image]) => `${letter}: ${basename(image)}`);

  if (!needs.flags?.includes('cd') && mounts.some(([letter]) => letter === 'D')) {
    needs.flags = [...(needs.flags ?? []), 'cd'];
  }

  state.needs = needs;

  /* Each download's SHA-256, as the corpus records one (`fetch.mjs --hash`). */
  if (!state.sha256) {
    const sha256 = {};

    for (const download of item.source.archiveOrg.downloads) {
      sha256[download.file] = await sha256Of(downloadPath(item.id, download.file));
    }

    keep(item.id, { sha256 });
  }

  /* A program not in the download: on an image, where one is mounted. */
  let onImage = null;

  if (fromImage && mounts.length) {
    const name = item.run
      .trim()
      .split(/\s+/)
      .pop()
      .replace(/^[A-Za-z]:\\?/, '');

    onImage = `${mounts[0][0]}:\\${dosPath(name)}`;
  }

  if (needs.error && !onImage) {
    return done({ status: 'fetch', signature: needs.error });
  }

  if (!onImage && needs.header !== 'NE') {
    return done(
      needs.header === 'PE'
        ? { status: 'win32s', signature: 'PE' }
        : { status: 'not-windows', signature: needs.header ?? 'no program' }
    );
  }

  if (needs.libraries?.length) {
    return done({ status: 'library', signature: needs.libraries.join(', ') });
  }

  let drive;
  let program;
  let installed = null;

  if (needs.setup || (onImage && /\\_?(setup|install)[^\\]*\.exe$/i.test(onImage))) {
    installed = await install(item, folder, { ...needs, onImage }, mounts);

    /* A setup that says it needs enhanced mode or more colours: again so. */
    const asked = askedFor({
      box: installed.box,
      windows: [{ title: installed.first }, ...installed.shown.map((title) => ({ title }))],
    });

    if (!installed.program && (asked.enhanced || asked.colours)) {
      needs.mode = asked.enhanced ? 'enhanced' : needs.mode;
      needs.display = asked.colours ? 'vga256' : needs.display;
      installed = await install(item, folder, { ...needs, onImage }, mounts);
    }

    if (!installed.program) {
      /*
       * Where it stopped: the box it was left in, else the last window of
       * its own it showed; where it showed none at the end, where it first
       * waited (a box Enter then answered).
       */
      const where = installed.box
        ? `${installed.box.title}: ${installed.box.text}`
        : (installed.shown.filter(Boolean).slice(-1)[0] ?? '');
      const how = `${installed.status}${installed.signature ? ` (${installed.signature})` : ''}`;
      const signature = `${how}, ${where ? `at "${where}"` : `first waited at "${installed.first}"`}${installed.dos ? `; DOS functions not answered: AX=${installed.dos.join(', ')}` : ''}`;

      return done({
        status: 'installer',
        signature: signature.slice(0, 240),
        install: installed,
      });
    }

    drive = installed.drive;
    program = installed.program;
  } else if (onImage) {
    drive = join(DRIVES, item.id);
    rmSync(drive, { recursive: true, force: true });
    mkdirSync(drive, { recursive: true });
    placeRuntimes(drive, needs);
    program = { path: onImage, file: null };
  } else {
    drive = driveFor(item, folder, join(DRIVES, item.id), needs);
    program = {
      path: `C:\\CORPUS\\${shortOf(item.id)}\\${dosPath(needs.program)}`,
      file: join(folder, needs.program),
    };
  }

  let mode = needs.mode ?? 'standard';
  let display = needs.display ?? 'vga';
  let result;
  const tries = [];

  /* The run, and again in enhanced mode or on 256 colours where it says it needs them. */
  for (let attempt = 0; attempt < 3; attempt++) {
    const run = await trace(
      runArgs({
        exe: program.file,
        path: program.path,
        drive,
        mounts,
        mode,
        display,
        sound: wantsSound(needs),
        seconds: SECONDS,
        screen: join(CACHE, 'screens', `${item.id}.png`),
      }),
      3 * 60_000
    );

    result = outcome(run);
    writeFileSync(
      join(CACHE, 'traces', `${item.id}.txt`),
      run.out.split('\n').slice(-300).join('\n')
    );
    tries.push({ mode, display, status: result.status, signature: result.signature });

    const asked = askedFor(result);

    if (asked.enhanced && mode === 'standard' && result.status !== 'idle') {
      mode = 'enhanced';
    } else if (asked.colours && display === 'vga' && result.status !== 'idle') {
      display = 'vga256';
    } else {
      break;
    }
  }

  /*
   * Still `running` at its ten seconds: run on, from the start again, for
   * each of the `STAGES` until it is not. The seconds are those of the
   * first stage it was found in (`seconds`), so a state is reached at or
   * before them and after the stage before; the history is kept (`stages`).
   */
  let seconds = SECONDS;
  let ms = result.ms;
  const stages = [];

  /* A run the host had to stop is not run longer: its ten seconds were not reached. */
  if (result.status === 'running' && result.signature !== 'the host stopped it') {
    for (const length of STAGES) {
      const run = await trace(
        runArgs({
          exe: program.file,
          path: program.path,
          drive,
          mounts,
          mode,
          display,
          sound: wantsSound(needs),
          seconds: length,
          screen: join(CACHE, 'screens', `${item.id}.png`),
        }),
        3 * 60_000 + length * 5000
      );

      result = outcome(run, length);
      seconds = length;
      ms += run.ms;
      stages.push({ seconds: length, status: result.status, signature: result.signature });
      writeFileSync(
        join(CACHE, 'traces', `${item.id}.txt`),
        run.out.split('\n').slice(-300).join('\n')
      );

      if (result.status !== 'running' || run.killed) {
        break;
      }
    }
  }

  if (!installed) {
    rmSync(drive, { recursive: true, force: true });
  }

  needs.mode = mode;
  needs.display = display;
  result = { ...result, ...refined(result, needs) };

  /* A title from the run, for the items not titled from their program yet. */
  if ((!foundOf(item.id) || foundOf(item.id).by === 'pass') && program.file) {
    try {
      const found = installed
        ? readFolder(dirname(program.file), basename(program.file))
        : readFolder(folder, needs.program);

      applyRun(found, {
        mode,
        stopped: result.status,
        windows: result.windows.filter((window) => !window.box),
      });
      found.by = 'pass';
      mkdirSync(TITLES, { recursive: true });
      writeFileSync(join(TITLES, `${item.id}.json`), JSON.stringify(found, null, 1));
    } catch {
      /* A title is not the pass's to fail on. */
    }
  }

  return keep(item.id, {
    needs,
    result: {
      status: result.status,
      signature: result.signature,
      mode,
      display,
      calls: result.calls,
      instructions: result.instructions,
      ms,
      ...(seconds !== SECONDS ? { seconds, stages } : {}),
      ...(result.box ? { box: result.box } : {}),
      ...(result.dos ? { dos: result.dos } : {}),
      ...(tries.length > 1 ? { tries } : {}),
      ...placed(),
      ...(installed
        ? {
            install: {
              program: program.path,
              from: program.from,
              status: installed.status,
              ms: installed.ms,
            },
          }
        : {}),
      commit,
      date,
    },
  });
}

/* --- Results ---------------------------------------------------------------- */

/** A fault's group: its kind and the module it was in, without the address. */
function faultGroup(signature, program) {
  const match = /caused (.+?) in module (\S*?)(?: at |)([0-9A-F]{4}:[0-9A-F]{4})/.exec(signature);
  const own = (program ?? '').split(/[\\/]/).pop().toUpperCase();

  /*
   * A fault keeps its place: the same place in a library, or in programs
   * built with the same compiler's code, is one piece of work. A program's
   * own module is named as such, so programs of one runtime meet.
   */
  return match
    ? `${match[1]} in ${match[2] && match[2] !== own ? match[2] : 'the program'} at ${match[3]}`
    : signature.replace(/[0-9a-f]{4}:[0-9a-f]{4}/gi, '….');
}

/** The work queue's groups an item's result belongs to. */
export function groupsOf(result) {
  const { status, signature = '' } = result;

  /* A self-loading application's run stops where its own loader's work was not done. */
  if (
    result.needs?.flags?.includes('self-loading') &&
    ['fault', 'ended', 'unsupported', 'running', 'missing'].includes(status)
  ) {
    return [`${status}: a self-loading application (NE flag 0800h)`];
  }

  switch (status) {
    case 'idle':
    case 'playing':
      return [];
    case 'missing':
      return [`missing ${signature}`];
    case 'library':
      return signature.split(', ').map((module) => `library ${module}`);
    case 'fault':
      return [`fault: ${faultGroup(signature, result.needs?.program)}`];
    case 'box':
      return [`box: ${signature.replace(/[A-Z]:\\[^\s"]*/gi, '<path>')}`];
    case 'installer':
      /* Where it stopped is its own, but where it first waited may be a runtime's (a path made general). */
      return [
        `installer: ${signature
          .replace(/, at ".*?"(;|$)/, '$1')
          .replace(/[A-Z]:\\[^\s"]*/gi, '<path>')
          .replace(/[0-9a-f]{4}:[0-9a-f]{4}/gi, '….')}`,
      ];
    case 'fetch':
      return [
        `fetch: ${signature
          .replace(/^.*?: (archive\.org answered \d+)/, '$1')
          .replace(/^\S+ not in the download$/, 'program not in the download')
          .replace(
            /^\S+ names no Windows program in the download$/,
            'its batch file names no Windows program in the download'
          )}`,
      ];
    default:
      return [`${status}: ${signature.replace(/[0-9a-f]{4}:[0-9a-f]{4}/gi, '….')}`];
  }
}

/** An item's line of `catalog/results.json`, from its state; null where it has not been run. */
export function resultOf(item) {
  const state = stateOf(item.id);

  if (!state.result) {
    return null;
  }

  const { needs } = state;

  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    titleSource: item.titleSource,
    status: state.result.status,
    signature: state.result.signature ?? '',
    ...(state.result.seconds ? { seconds: state.result.seconds } : {}),
    ...(state.result.runtimes ? { runtimes: state.result.runtimes } : {}),
    ...(state.result.box ? { box: state.result.box } : {}),
    ...((state.result.dos ?? state.result.install?.dos)
      ? { dos: state.result.dos ?? state.result.install.dos }
      : {}),
    needs: needs
      ? {
          program: needs.program ?? null,
          header: needs.header ?? null,
          mode: needs.mode ?? null,
          display: needs.display ?? null,
          flags: needs.flags ?? [],
          imports: needs.imports ?? [],
          libraries: needs.libraries ?? [],
          runtimes: needs.runtimes ?? [],
          setup: needs.setup ?? null,
          installer: needs.installer ?? null,
          images: needs.images ?? [],
        }
      : null,
    ...(state.result.install
      ? {
          /* The setup's run: what it left, never the host's paths. */
          install: {
            status: state.result.install.status,
            ...(state.result.install.program ? { program: state.result.install.program } : {}),
            ...(state.result.install.from ? { from: state.result.install.from } : {}),
            ...(state.result.install.groups
              ? { groups: state.result.install.groups.map((group) => group.group) }
              : {}),
          },
        }
      : {}),
    commit: state.result.commit,
    date: state.result.date,
  };
}

function writeResults(items) {
  const results = withoutExcluded(items.map(resultOf).filter(Boolean));

  const lines = results.map((result) => `  ${JSON.stringify(result)}`);

  writeFileSync(
    join(ROOT, 'catalog', 'results.json'),
    `{\n "about": "The compatibility catalog's first pass: each item's status, signature and needs, the WinBox commit it ran on and the date (kb/guides/compatibility.md). Made by scripts/catalog/pass.mjs --results.",\n "items": [\n${lines.join(',\n')}\n ]\n}\n`
  );

  const groups = new Map();

  for (const result of results) {
    for (const group of groupsOf(result)) {
      if (!groups.has(group)) {
        groups.set(group, {
          signature: group,
          status: result.status,
          count: 0,
          games: 0,
          items: [],
        });
      }

      const entry = groups.get(group);

      entry.count++;
      entry.games += result.kind === 'game' ? 1 : 0;
      entry.items.push(result.id);
    }
  }

  const queue = [...groups.values()].sort(
    (a, b) => b.count - a.count || a.signature.localeCompare(b.signature)
  );

  writeFileSync(
    join(ROOT, 'catalog', 'queue.json'),
    `{\n "about": "The work queue: the first pass's failures grouped by signature, most programs first (kb/guides/compatibility.md). Made by scripts/catalog/pass.mjs --results from catalog/results.json; never edited by hand.",\n "groups": [\n${queue.map((group) => `  ${JSON.stringify(group)}`).join(',\n')}\n ]\n}\n`
  );

  /* The needs into the catalog. */
  const catalog = JSON.parse(readFileSync(join(ROOT, 'catalog', 'catalog.json'), 'utf8'));
  const byId = new Map(results.map((result) => [result.id, result]));

  for (const entry of catalog.items) {
    const result = byId.get(entry.id);

    if (result?.needs) {
      const { program, header, mode, display, flags, libraries, runtimes, setup, installer } =
        result.needs;

      entry.needs = {
        program,
        header,
        mode,
        display,
        flags,
        libraries,
        ...(runtimes.length ? { runtimes } : {}),
        setup,
        installer,
      };
    }

    const sha256 = stateOf(entry.id).sha256;

    if (sha256) {
      for (const download of entry.source.archiveOrg.downloads) {
        download.sha256 = sha256[download.file] ?? download.sha256;
      }

      entry.sha256 = sha256[entry.source.archiveOrg.downloads[0]?.file] ?? null;
    }
  }

  return { results, queue, catalog };
}

function counts(results) {
  const table = {};

  for (const result of results) {
    table[result.status] ??= { game: 0, application: 0 };
    table[result.status][result.kind]++;
  }

  return table;
}

async function main() {
  const args = process.argv.slice(2);
  const items = catalogItems();

  /* The needs read again without a run, the run's mode and display kept. */
  if (args.includes('--needs')) {
    for (const item of items) {
      const state = stateOf(item.id);

      if (!state.fetch?.ok || !state.needs || !state.result) {
        continue;
      }

      const folder = join(PROGRAMS, item.id);
      const needs = { ...needsOf(item, folder, []), mode: state.needs.mode };
      const mounts = mountsOf(item, folder);

      needs.images = mounts.map(([letter, image]) => `${letter}: ${basename(image)}`);
      needs.flags = [
        ...new Set([...(needs.flags ?? []), ...(mounts.some(([l]) => l === 'D') ? ['cd'] : [])]),
      ];

      if (state.needs.display) {
        needs.display = state.needs.display;
      }

      keep(item.id, { needs, result: { ...state.result, ...refined(state.result, needs) } });
    }

    return;
  }

  if (args.includes('--results')) {
    const { results, queue, catalog } = writeResults(items);
    const { write } = await import('./catalog.mjs');

    write(catalog.items);
    console.log(counts(results));
    console.log(
      queue
        .slice(0, 30)
        .map((group) => `${group.count}\t${group.signature}`)
        .join('\n')
    );
    return;
  }

  if (!existsSync(TRACE)) {
    throw new Error(`${relative(ROOT, TRACE)} is not built`);
  }

  /* The engine's commit: the last that changed what runs the programs. */
  const commit = execFileSync(
    'git',
    ['log', '-1', '--format=%h', '--abbrev=10', '--', 'crates', 'Cargo.lock'],
    {
      cwd: ROOT,
      encoding: 'utf8',
    }
  ).trim();
  /* `--status running`: the items whose last run had that status, run again. */
  const stagesAt = args.indexOf('--stages');

  if (stagesAt >= 0) {
    STAGES = args.splice(stagesAt, 2)[1].split(',').map(Number);
  }

  const statusAt = args.indexOf('--status');
  const status = statusAt >= 0 ? args.splice(statusAt, 2)[1] : null;
  const ids = args.filter((arg) => !arg.startsWith('--'));
  const chosen = ids.length
    ? items.filter((item) => ids.includes(item.id))
    : items.filter((item) => {
        const state = stateOf(item.id);

        return status
          ? state.result?.status === status
          : state.fetch && state.result?.commit !== commit;
      });

  mkdirSync(join(CACHE, 'traces'), { recursive: true });
  mkdirSync(join(CACHE, 'screens'), { recursive: true });
  mkdirSync(DRIVES, { recursive: true });
  console.error(`${chosen.length} items to run at ${commit}`);

  const started = Date.now();
  let done = 0;
  const worker = async () => {
    while (chosen.length) {
      const item = chosen.shift();
      let state;

      try {
        state = await pass(item, commit);
      } catch (error) {
        state = keep(item.id, {
          result: {
            status: 'fault',
            signature: `the pass: ${error.message}`.slice(0, 200),
            commit,
            date: new Date().toLocaleDateString('sv'),
          },
        });
      }

      done++;
      console.log(
        `${item.id}\t${state.result.status}\t${state.result.signature ?? ''}\t${state.result.ms ?? ''}`
      );

      if (done % 50 === 0) {
        console.error(
          `${done} run, ${chosen.length} left, ${Math.round((Date.now() - started) / 1000)} s`
        );
      }
    }
  };

  await Promise.all(Array.from({ length: PARALLEL }, worker));
  console.error(`done: ${done} in ${Math.round((Date.now() - started) / 1000)} s`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
