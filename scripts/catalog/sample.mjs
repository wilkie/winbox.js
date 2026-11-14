#!/usr/bin/env node
/**
 * The compatibility pipeline proved on a sample: games of the catalog
 * (`catalog/catalog.json`) that are not in the corpus, fetched through the
 * corpus's fetch path into the gitignored `corpus/programs/`, each run on
 * the Rust engine's `trace` example as the corpus survey runs a program --
 * from `C:\CORPUS\<ID>`, on the installation's VGA, for ten seconds of the
 * survey's clock -- and its run classified (`classify`). The design is
 * `kb/guides/compatibility.md`.
 *
 *   cargo build --release -p winbox-win16 --example trace
 *   node scripts/catalog/sample.mjs              # the first ten the choice gives
 *   node scripts/catalog/sample.mjs --count 20   # more
 *   node scripts/catalog/sample.mjs win3_nails   # these
 *
 * Downloads are untrusted: each is unpacked into a folder of its own and
 * nothing of it runs on the host. Its files are read here only for the
 * program's header; the program runs inside WinBox alone. The sample's
 * manifest and its results are kept in `corpus/cache/catalog/` (gitignored):
 * nothing of a program, its screen or its calls is committed.
 */

import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CACHE = join(ROOT, 'corpus', 'cache', 'catalog');
const PROGRAMS = join(ROOT, 'corpus', 'programs');
const TRACE = join(ROOT, 'target', 'release', 'examples', 'trace');
const SECONDS = 10;
/** The survey's clock: 3,000 instructions a millisecond (`winbox_machine::Clock`). */
const RATE = 3000;

/** The largest download the sample takes, so the proof stays small. */
const LARGEST = 3 * 2 ** 20;

/**
 * The sample: loose games of DOSBox's, in one zip no larger than
 * `LARGEST`, not in the corpus already (by archive.org identifier), taken in
 * the order of their identifiers' SHA-1 -- a spread over the collection
 * that is the same each time, not chosen by hand.
 */
export function choose(catalog, corpus, count) {
  const known = new Set(
    corpus.programs.map((entry) => entry.source?.archiveOrg?.identifier).filter(Boolean)
  );
  const order = (entry) => createHash('sha1').update(entry.id).digest('hex');

  return catalog
    .filter(
      (entry) =>
        entry.kind === 'game' &&
        entry.form === 'loose' &&
        entry.run &&
        /\.exe$/i.test(entry.run) &&
        entry.source.archiveOrg.downloads.length === 1 &&
        /\.zip$/i.test(entry.source.archiveOrg.downloads[0].file) &&
        entry.size <= LARGEST &&
        !known.has(entry.id)
    )
    .sort((a, b) => order(a).localeCompare(order(b)))
    .slice(0, count);
}

/** A corpus manifest's entry for a catalog's item. */
function manifestEntry(entry) {
  const download = entry.source.archiveOrg.downloads[0];

  return {
    id: entry.id.toLowerCase(),
    title: entry.title,
    year: entry.year,
    source: {
      archiveOrg: {
        identifier: entry.id,
        file: download.file,
        sha1: download.sha1,
        md5: download.md5,
      },
      sha256: '',
      size: download.size,
    },
    run: entry.run,
  };
}

function node(args) {
  return execFileSync(process.execPath, [join(ROOT, 'scripts', 'corpus', 'fetch.mjs'), ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * Fetched as the corpus fetches: its SHA-256 taken first (`--hash`), the
 * download held to archive.org's SHA-1, then unpacked. A failure is the
 * classification `fetch`.
 */
function fetchAll(manifestFile, manifest) {
  const failed = new Map();
  let hashes;

  try {
    hashes = node([
      '--manifest',
      manifestFile,
      '--hash',
      ...manifest.programs.map((entry) => entry.id),
    ]);
  } catch (error) {
    hashes = error.stdout ?? '';
  }

  for (const entry of manifest.programs) {
    const line = hashes.split('\n').find((each) => each.startsWith(`${entry.id}\t`));

    if (!line) {
      failed.set(entry.id, 'not downloaded');
      continue;
    }

    const archive = join(ROOT, 'corpus', 'cache', `${entry.id}.zip`);
    const sha1 = createHash('sha1').update(readFileSync(archive)).digest('hex');

    if (sha1 !== entry.source.archiveOrg.sha1) {
      failed.set(entry.id, `SHA-1 ${sha1}, archive.org says ${entry.source.archiveOrg.sha1}`);
      continue;
    }

    entry.source.sha256 = line.split('\t')[1];
  }

  writeFileSync(manifestFile, JSON.stringify(manifest, null, 1));

  for (const entry of manifest.programs.filter((each) => !failed.has(each.id))) {
    try {
      node(['--manifest', manifestFile, entry.id]);
    } catch (error) {
      failed.set(
        entry.id,
        String(error.stderr ?? error.message)
          .trim()
          .split('\n')[0]
      );
    }
  }

  return failed;
}

/** Where a program is in its folder: its name, in any case, at any depth. */
function find(folder, name) {
  for (const item of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, item.name);

    if (item.isDirectory()) {
      const found = find(path, name);

      if (found) {
        return found;
      }
    } else if (item.name.toUpperCase() === name.toUpperCase()) {
      return path;
    }
  }

  return null;
}

/**
 * What a program's file is, from its header alone: `MZ` with a new header
 * whose signature is `NE` a Windows program, `PE` a Win32 one (Win32s),
 * anything else a DOS program.
 */
export function headerOf(bytes) {
  if (bytes.length < 0x40 || bytes.toString('latin1', 0, 2) !== 'MZ') {
    return 'not MZ';
  }

  const at = bytes.readUInt32LE(0x3c);
  const signature = at + 2 <= bytes.length ? bytes.toString('latin1', at, at + 2) : '';

  return signature === 'NE' || signature === 'PE' ? signature : 'DOS';
}

/**
 * The modules a Windows program imports from, from its New Executable's
 * module reference table (a word each, at 28h in its header, their count at
 * 1Eh) into its imported names (at 2Ah), each a length and its name: what
 * it needs, without running it (`kb/guides/compatibility.md`, "What it
 * needs").
 */
export function importsOf(bytes) {
  const ne = bytes.readUInt32LE(0x3c);
  const count = bytes.readUInt16LE(ne + 0x1e);
  const references = ne + bytes.readUInt16LE(ne + 0x28);
  const names = ne + bytes.readUInt16LE(ne + 0x2a);
  const modules = [];

  for (let index = 0; index < count; index++) {
    const at = names + bytes.readUInt16LE(references + index * 2);

    modules.push(bytes.toString('latin1', at + 1, at + 1 + bytes[at]));
  }

  /* A linker may list a module twice. */
  return [...new Set(modules)].sort();
}

/**
 * The modules WinBox has of its own, with no Windows file on disk
 * (`kb/guides/without-windows.md`): a program importing one needs nothing
 * more.
 */
const OWN = [
  'KERNEL',
  'USER',
  'GDI',
  'MMSYSTEM',
  'SHELL',
  'KEYBOARD',
  'SOUND',
  'WIN87EM',
  'WING',
  'TOOLHELP',
  'TIMER',
  'COMMDLG',
  'DDEML',
  'VER',
  'LZEXPAND',
  'OLECLI',
  'OLESVR',
];

/**
 * The modules a program imports that neither WinBox, nor the installation
 * (its WINDOWS and SYSTEM folders), nor the program's own folder has: the
 * libraries it needs and does not bring.
 */
export function unfound(modules, folder) {
  const names = (at) =>
    existsSync(at)
      ? readdirSync(at).map((name) => name.toUpperCase().replace(/\.(DLL|DRV|EXE)$/, ''))
      : [];
  const windows = join(ROOT, 'oracle', 'build', 'drive-c', 'WINDOWS');
  const found = new Set([
    ...OWN,
    ...names(windows),
    ...names(join(windows, 'SYSTEM')),
    ...names(folder),
  ]);

  return modules.filter((module) => !found.has(module.toUpperCase()));
}

/** The share of its seconds' instructions below which a run spent its time waiting. */
const WAITED = 0.1;

/**
 * A run's outcome, from what the trace printed: the line saying why it
 * stopped, the faults KERNEL reported, the instructions it ran and the
 * calls it made.
 *
 * - `idle`: its seconds passed, a window made and shown, and the program
 *   waiting for messages: a message call among its last thousand calls, or
 *   so few instructions run that it spent its time in one (a `GetMessage`
 *   not yet answered is not in the trace);
 * - `box`: its seconds passed in a `MessageBox` of its own, unanswered (the
 *   survey answers only USER's boxes that let no program run);
 * - `running`: its seconds passed otherwise (busy, or no window shown);
 * - `missing`: it called a function WinBox does not answer yet (which);
 * - `unsupported`: an interrupt, a DOS function or something the engine
 *   does not do yet;
 * - `fault`: the processor stopped, or KERNEL reported a fault (where);
 * - `ended`: its task ended within its seconds (done, or a refusal);
 * - `no-output`: the trace printed nothing (it did not load).
 */
export function classify(out, seconds = SECONDS) {
  const lines = out.split('\n');
  const stopped = lines.find((line) => line.startsWith('stopped: ')) ?? '';
  const faults = lines.filter((line) => line.startsWith('application fault: '));
  const calls = lines.filter((line) => /^[A-Z][A-Z0-9_]*\.\w+[ (]/.test(line));
  const named = (line) => line.split(/[ (]/)[0];
  const last = () => `last ${calls.slice(-3).map(named).join(', ')}`;
  const at = /at ([0-9a-f]{4}:[0-9a-f]{4})/.exec(stopped)?.[1] ?? '';
  const missing = /Missing \{ module: "(\w+)", name: "(\w+)" \}/.exec(stopped);
  const instructions = Number(/after (\d+) instructions/.exec(stopped)?.[1] ?? 0);

  if (!stopped) {
    return { status: 'no-output', signature: '' };
  }

  if (missing) {
    return { status: 'missing', signature: `${missing[1]}.${missing[2]}` };
  }

  if (faults.length) {
    return { status: 'fault', signature: faults[0].slice('application fault: '.length) };
  }

  if (/^stopped: (Interrupt|Dos|Unsupported)/.test(stopped)) {
    return { status: 'unsupported', signature: stopped.slice(9).split(' after ')[0] };
  }

  if (/^stopped: Processor/.test(stopped)) {
    return { status: 'fault', signature: `${stopped.slice(9).split(' after ')[0]} at ${at}` };
  }

  if (/^stopped: Ended/.test(stopped)) {
    return { status: 'ended', signature: last() };
  }

  /* A box's call with no answer yet: the run's time passed in it. */
  if (calls.length && /^USER\.MessageBox = {2}@/.test(calls[calls.length - 1])) {
    return { status: 'box', signature: last() };
  }

  const shown = calls.some((line) => /^USER\.(ShowWindow|CreateWindow)/.test(line));
  const waiting =
    calls
      .slice(-1000)
      .some((line) => /^USER\.(GetMessage|WaitMessage|PeekMessage)$/.test(named(line))) ||
    instructions < seconds * RATE * 1000 * WAITED;

  return shown && waiting
    ? { status: 'idle', signature: '' }
    : { status: 'running', signature: last() };
}

/** The Win386 supervisor's refusal in standard mode (`kb/topics/win386.md`). */
const WIN386 = 'Not running on a 386 DPMI implementation';

/** A trace's run, the host's milliseconds it took, and its output. */
function trace(exe, path, screen, mode) {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    const child = spawn(
      TRACE,
      [
        exe,
        '--path',
        path,
        '--windows',
        join(ROOT, 'oracle', 'build', 'drive-c'),
        '--display',
        'vga',
        '--mode',
        mode,
        '--boxes',
        '3',
        '--seconds',
        String(SECONDS + 0.1),
        '--budget',
        String(SECONDS * 2 * RATE * 1000),
        '--screen',
        screen,
      ],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }
    );
    let out = '';
    const timer = setTimeout(() => child.kill(), (60 + SECONDS * 2) * 1000);

    child.stdout.on('data', (chunk) => (out += chunk));
    child.on('close', () => {
      clearTimeout(timer);
      resolve({ out, ms: Number((process.hrtime.bigint() - started) / 1_000_000n) });
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const at = args.indexOf('--count');
  const count = at >= 0 ? Number(args.splice(at, 2)[1]) : 10;
  const catalog = JSON.parse(readFileSync(join(ROOT, 'catalog', 'catalog.json'), 'utf8')).items;
  const corpus = JSON.parse(readFileSync(join(ROOT, 'corpus', 'manifest.json'), 'utf8'));
  const chosen = args.length
    ? catalog.filter((entry) => args.includes(entry.id))
    : choose(catalog, corpus, count);
  const manifestFile = join(CACHE, 'sample-manifest.json');
  const manifest = { programs: chosen.map(manifestEntry) };

  if (!existsSync(TRACE)) {
    throw new Error(`${relative(ROOT, TRACE)} is not built`);
  }

  mkdirSync(CACHE, { recursive: true });
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 1));

  const failed = fetchAll(manifestFile, manifest);
  const results = [];

  for (const entry of manifest.programs) {
    const row = { id: entry.source.archiveOrg.identifier, title: entry.title };

    if (failed.has(entry.id)) {
      results.push({ ...row, status: 'fetch', signature: failed.get(entry.id) });
      continue;
    }

    const exe = find(join(PROGRAMS, entry.id), entry.run);

    if (!exe) {
      results.push({ ...row, status: 'fetch', signature: `${entry.run} not in the download` });
      continue;
    }

    const bytes = readFileSync(exe);
    const header = headerOf(bytes);

    if (header !== 'NE') {
      results.push({
        ...row,
        status: header === 'PE' ? 'win32s' : 'not-windows',
        signature: header,
      });
      continue;
    }

    const imports = importsOf(bytes);
    const lacking = unfound(imports, dirname(exe));

    if (lacking.length) {
      results.push({ ...row, status: 'library', signature: lacking.join(', '), imports });
      continue;
    }

    /* A Win386 program or library of its folder's needs 386 enhanced mode. */
    const folder = dirname(exe);
    const mode = [exe, ...readdirSync(folder).filter((name) => /\.dll$/i.test(name))].some((file) =>
      readFileSync(join(folder, basename(file))).includes(WIN386)
    )
      ? 'enhanced'
      : 'standard';

    /* As the survey starts it: C:\CORPUS\<ID>\, its own folder's files with it. */
    const short = entry.id
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 8);
    const inside = relative(join(PROGRAMS, entry.id), exe).split(/[\\/]/).join('\\').toUpperCase();
    const { out, ms } = await trace(
      exe,
      `C:\\CORPUS\\${short}\\${inside}`,
      join(CACHE, 'screens', `${entry.id}.png`),
      mode
    );

    mkdirSync(join(CACHE, 'screens'), { recursive: true });
    writeFileSync(join(CACHE, 'traces', `${entry.id}.txt`), out, { flag: 'w' });

    const calls = out.split('\n').filter((line) => /^[A-Z][A-Z0-9_]*\.\w+[ (]/.test(line)).length;

    results.push({ ...row, ...classify(out), mode, imports, calls, ms });
  }

  writeFileSync(join(CACHE, 'sample-results.json'), JSON.stringify(results, null, 1));

  for (const result of results) {
    console.log(
      [
        result.id,
        result.status,
        result.signature,
        result.mode ?? '',
        (result.imports ?? []).join(','),
        result.calls ?? '',
        result.ms ?? '',
      ].join('\t')
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mkdirSync(join(CACHE, 'traces'), { recursive: true });
  mkdirSync(join(CACHE, 'screens'), { recursive: true });
  await main();
}
