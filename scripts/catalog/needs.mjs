/**
 * What an item of the compatibility catalog needs, read from its files
 * before anything runs (`kb/guides/compatibility.md`, "What a program
 * needs"): which program it runs, that program's header, the modules it
 * and the libraries of its folder import (from the New Executable's module
 * reference table) and the functions it imports by ordinal (from its
 * segments' relocation records, named by `kb/data/exports-3.1.json`, the
 * export tables read out of Windows' own modules), the Win386 supervisor,
 * Win32s, WinG, Video for Windows, QuickTime, a disc, sound and MIDI, the
 * setup programs and `.INF` files it brings, and the libraries it imports
 * that nothing has.
 *
 * Everything here reads a download's files as data. Nothing of it runs on
 * the host.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runtimeBytes, runtimesFor } from './runtimes.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The Win386 supervisor's refusal in standard mode (`kb/topics/win386.md`). */
export const WIN386 = 'Not running on a 386 DPMI implementation';

/**
 * The modules WinBox has of its own, with no Windows file on disk
 * (`kb/guides/without-windows.md`), as `scripts/catalog/sample.mjs` lists them.
 */
export const OWN = [
  'KERNEL',
  'USER',
  'GDI',
  'MMSYSTEM',
  'SHELL',
  'KEYBOARD',
  'SOUND',
  'SYSTEM',
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

/** Video for Windows' modules (its runtime's `MSVIDEO.DLL` and `AVIFILE.DLL`). */
const VFW = ['MSVIDEO', 'AVIFILE', 'MSACM', 'AVICAP'];

/**
 * QuickTime for Windows' modules: `QTW.DLL` and `QTIM.DLL`, as its 16-bit
 * runtime's files name them. No program of the catalog with a `.MOV` was
 * found to import one (2026-11-14): they play their movies through MCI, so
 * it is the runtime's files, or a `.MOV`, in the download that say so.
 */
const QUICKTIME = ['QTW', 'QTIM'];

/** GDI's and USER's palette functions, by name (`exports-3.1.json` gives their ordinals). */
const PALETTE = [
  'CREATEPALETTE',
  'ANIMATEPALETTE',
  'SETPALETTEENTRIES',
  'SELECTPALETTE',
  'REALIZEPALETTE',
  'GDISELECTPALETTE',
  'GDIREALIZEPALETTE',
];

/** A setup program, by its name. */
const SETUP = /^(_?setup|install|inst|instal|setup16|setup_16)[^\\/]*\.exe$/i;

/** Export names by module and ordinal, from Windows' own tables. */
let exportNames;

function namesByOrdinal() {
  if (!exportNames) {
    const tables = JSON.parse(readFileSync(join(ROOT, 'kb', 'data', 'exports-3.1.json'), 'utf8'));

    exportNames = new Map(
      tables.modules.map((module) => [
        module.name,
        new Map(module.exports.map((each) => [each.ordinal, each.name])),
      ])
    );
  }

  return exportNames;
}

/** WinBox's own exports, by module: each ordinal answered and each name (`kb/data/winbox-exports.json`). */
let winboxExports;

function ownExports() {
  if (!winboxExports) {
    const tables = JSON.parse(
      readFileSync(join(ROOT, 'kb', 'data', 'winbox-exports.json'), 'utf8')
    );

    winboxExports = new Map(
      tables.modules.map((module) => {
        const answered = module.exports.filter((each) => each.implemented);

        return [
          module.name,
          {
            ordinals: new Map(answered.map((each) => [each.ordinal, each.name])),
            names: new Set(answered.map((each) => each.name.toUpperCase())),
          },
        ];
      })
    );
  }

  return winboxExports;
}

/**
 * An import's name as a person reads it: `MODULE.Name`, an ordinal named
 * by WinBox's table, else Windows' (`exports-3.1.json`), else `@ordinal`.
 */
export function importName(each) {
  const [module, rest] = [each.slice(0, each.indexOf('.')), each.slice(each.indexOf('.') + 1)];

  if (!rest.startsWith('@')) {
    return each;
  }

  const ordinal = Number(rest.slice(1));

  return `${module}.${ownExports().get(module)?.ordinals.get(ordinal) ?? namesByOrdinal().get(module)?.get(ordinal) ?? rest}`;
}

/**
 * The imports of WinBox's own modules that WinBox does not export: a
 * call to one goes to `UndefDynLink`, as in Windows, and ends the program.
 */
export function unlinkedOf(functions) {
  return functions
    .filter((each) => {
      const module = each.slice(0, each.indexOf('.'));
      const rest = each.slice(each.indexOf('.') + 1);
      const own = ownExports().get(module);

      if (!own) {
        return false;
      }

      return rest.startsWith('@')
        ? !own.ordinals.has(Number(rest.slice(1)))
        : !own.names.has(rest.toUpperCase());
    })
    .map(importName);
}

/** Every file of a folder, at any depth. */
export function filesOf(folder) {
  const found = [];

  for (const item of existsSync(folder) ? readdirSync(folder, { withFileTypes: true }) : []) {
    const path = join(folder, item.name);

    if (item.isDirectory()) {
      found.push(...filesOf(path));
    } else if (item.isFile()) {
      found.push(path);
    }
  }

  return found;
}

/**
 * What a file is, from its header alone: `NE` a Windows program or
 * library, `PE` a Win32 one, `LE` or `LX` a VxD or OS/2's, `DOS` any other
 * `MZ`, `not MZ` anything else.
 */
export function headerOf(bytes) {
  if (bytes.length < 0x40 || bytes.toString('latin1', 0, 2) !== 'MZ') {
    return 'not MZ';
  }

  const at = bytes.readUInt32LE(0x3c);
  const signature = at + 2 <= bytes.length ? bytes.toString('latin1', at, at + 2) : '';

  return ['NE', 'PE', 'LE', 'LX'].includes(signature) ? signature : 'DOS';
}

/**
 * A New Executable's imports: the modules of its module reference table (a
 * word each, at 28h in the header, their count at 1Eh, each an offset into
 * the imported names at 2Ah, a length and the name), and the functions its
 * segments' relocation records import (the segment table at 22h, 8 bytes a
 * segment, their count at 1Ch, the alignment's shift at 32h; a segment with
 * 0100h in its flags has its records after its data, a count and 8 bytes
 * each: an imported ordinal is type 1, a module's index and the ordinal; an
 * imported name type 2, the index and the name's offset). Null where it is
 * not one, or where its tables run past its end.
 */
export function neImports(bytes) {
  try {
    const ne = bytes.readUInt32LE(0x3c);

    if (bytes.toString('latin1', ne, ne + 2) !== 'NE') {
      return null;
    }

    const count = bytes.readUInt16LE(ne + 0x1e);
    const references = ne + bytes.readUInt16LE(ne + 0x28);
    const names = ne + bytes.readUInt16LE(ne + 0x2a);
    const nameAt = (at) => bytes.toString('latin1', at + 1, at + 1 + bytes[at]);
    const modules = [];

    for (let index = 0; index < count; index++) {
      modules.push(nameAt(names + bytes.readUInt16LE(references + index * 2)).toUpperCase());
    }

    const segments = bytes.readUInt16LE(ne + 0x1c);
    const table = ne + bytes.readUInt16LE(ne + 0x22);
    const shift = bytes.readUInt16LE(ne + 0x32) || 9;
    const functions = new Set();

    for (let index = 0; index < segments; index++) {
      const at = table + index * 8;
      const sector = bytes.readUInt16LE(at);
      const length = bytes.readUInt16LE(at + 2) || 0x10000;
      const flags = bytes.readUInt16LE(at + 4);

      if (!(flags & 0x100) || !sector) {
        continue;
      }

      const records = sector * 2 ** shift + length;

      if (records + 2 > bytes.length) {
        continue;
      }

      const total = bytes.readUInt16LE(records);

      for (let record = 0; record < total; record++) {
        const r = records + 2 + record * 8;

        if (r + 8 > bytes.length) {
          break;
        }

        const kind = bytes[r + 1] & 3;
        const module = modules[bytes.readUInt16LE(r + 4) - 1];

        if (!module) {
          continue;
        }

        if (kind === 1) {
          const ordinal = bytes.readUInt16LE(r + 6);

          functions.add(`${module}.@${ordinal}`);
        } else if (kind === 2) {
          functions.add(`${module}.${nameAt(names + bytes.readUInt16LE(r + 6))}`);
        }
      }
    }

    return { modules: [...new Set(modules)].sort(), functions: [...functions].sort() };
  } catch {
    return null;
  }
}

/** A program's file in its folder: its name, in any case, the shallowest first. */
export function findFile(files, name) {
  const wanted = name.split(/[\\/]/).pop().toUpperCase();

  return (
    files
      .filter((file) => basename(file).toUpperCase() === wanted)
      .sort((a, b) => a.split(/[\\/]/).length - b.split(/[\\/]/).length)[0] ?? null
  );
}

/**
 * The program an item's `run` names. archive.org's DOSBox starts it as a
 * command (`d:\runapp NAILS.EXE`, `c:\run.bat`); a batch file is read as
 * data, and the last program it names that is in the download taken: the
 * word after `win` or `win.com`, or a word ending in `.exe`.
 */
export function programOf(run, files) {
  if (!run) {
    return { error: 'no program named' };
  }

  const words = run.trim().split(/\s+/);
  const last = words[words.length - 1].replace(/^"|"$/g, '');
  const named = /^runapp$/i.test(basename(words[0].replace(/\\/g, '/'))) ? last : words[0];
  const name = named.split(/[\\/]/).pop();

  if (/\.bat$/i.test(name) || !/\./.test(name)) {
    const batch = findFile(files, /\./.test(name) ? name : `${name}.bat`);

    if (!batch) {
      const exe = /\./.test(name) ? null : findFile(files, `${name}.exe`);

      return exe ? { program: exe } : { error: `${named} not in the download` };
    }

    const text = readFileSync(batch, 'latin1');
    const candidates = [];

    for (const line of text.split(/\r?\n/)) {
      const tokens = line
        .trim()
        .split(/\s+/)
        .filter((token) => token && !token.startsWith('/'));

      for (const [index, token] of tokens.entries()) {
        const base = token
          .split(/[\\/]/)
          .pop()
          .replace(/^[A-Za-z]:/, '');

        if (/^win(\.com)?$/i.test(base) && tokens[index + 1]) {
          candidates.push(tokens[index + 1]);
        } else if (/\.exe$/i.test(base) && !/^win\.com$/i.test(base)) {
          candidates.push(token);
        }
      }
    }

    for (const candidate of candidates.reverse()) {
      const base = candidate
        .split(/[\\/]/)
        .pop()
        .replace(/^[A-Za-z]:/, '');
      const found = findFile(files, /\./.test(base) ? base : `${base}.exe`);

      if (found && headerOf(readFileSync(found)) !== 'DOS') {
        return { program: found, batch: relative(dirname(batch), batch) };
      }
    }

    return {
      error: `${basename(batch)} names no Windows program in the download`,
      batch: basename(batch),
      named: candidates.reverse(),
    };
  }

  const program = findFile(files, name);

  return program ? { program } : { error: `${name} not in the download` };
}

/** The modules a folder's libraries are, by their names. */
function moduleNames(folder) {
  return existsSync(folder)
    ? readdirSync(folder).map((name) =>
        name.toUpperCase().replace(/\.(DLL|DRV|EXE|VBX|FON|TLB)$/, '')
      )
    : [];
}

/**
 * A New Executable's module name: the first entry of its resident names
 * (at 26h in the header), as the loader knows it (`VGA.DRV` is `DISPLAY`).
 */
function moduleNameOf(file) {
  try {
    const bytes = readFileSync(file);
    const ne = bytes.readUInt32LE(0x3c);

    if (bytes.toString('latin1', ne, ne + 2) !== 'NE') {
      return null;
    }

    const at = ne + bytes.readUInt16LE(ne + 0x26);

    return bytes.toString('latin1', at + 1, at + 1 + bytes[at]).toUpperCase();
  } catch {
    return null;
  }
}

/**
 * The installation's modules, `WINDOWS` and `SYSTEM` of the oracle's
 * drive: by their files' names and by their module names.
 */
let installed;

function installation() {
  if (!installed) {
    const windows = join(ROOT, 'oracle', 'build', 'drive-c', 'WINDOWS');
    const modules = [windows, join(windows, 'SYSTEM')].flatMap((folder) =>
      readdirSync(folder)
        .filter((name) => /\.(dll|drv|exe)$/i.test(name))
        .map((name) => moduleNameOf(join(folder, name)))
    );

    installed = new Set([
      ...OWN,
      ...moduleNames(windows),
      ...moduleNames(join(windows, 'SYSTEM')),
      ...modules.filter(Boolean),
    ]);
  }

  return installed;
}

/**
 * An item's needs, from its folder and its downloads' images. `item` is
 * the catalog's entry; `images` the disc's and floppies' images among its
 * downloads, kept outside the folder.
 */
export function needsOf(item, folder, images = []) {
  const files = filesOf(folder);
  const names = files.map((file) => basename(file).toUpperCase());
  const has = (pattern) => names.some((name) => pattern.test(name));
  const needs = {};
  const located = programOf(item.run, files);
  const discs = [
    ...images,
    ...files.filter((file) => /\.(iso|cue|bin|img|ima|mdf|nrg|ccd)$/i.test(file)),
  ];

  needs.images = discs.map((file) => basename(file));

  if (located.error) {
    needs.error = located.error;
  }

  if (located.batch) {
    needs.batch = located.batch;
  }

  const program = located.program;

  if (program) {
    needs.program = relative(folder, program);
  }

  const bytes = program ? readFileSync(program) : null;

  needs.header = bytes ? headerOf(bytes) : null;

  /* The modules the program imports, and those its folder's libraries import, in turn. */
  const byModule = new Map();

  for (const file of files) {
    if (/\.(dll|exe|drv|vbx)$/i.test(file) && statSync(file).size < 64 * 2 ** 20) {
      const module = basename(file)
        .toUpperCase()
        .replace(/\.[^.]+$/, '');

      if (!byModule.has(module)) {
        byModule.set(module, file);
      }
    }
  }

  const imports = new Set();
  const functions = new Set();
  const read = new Set();
  const pending = bytes && needs.header === 'NE' ? [bytes] : [];

  while (pending.length) {
    const found = neImports(pending.shift());

    for (const module of found?.modules ?? []) {
      imports.add(module);

      if (!read.has(module) && byModule.has(module)) {
        read.add(module);
        pending.push(readFileSync(byModule.get(module)));
      }
    }

    for (const each of found?.functions ?? []) {
      functions.add(each);
    }
  }

  /*
   * What KERNEL would find for an import: a file of the module's name and
   * `.DLL`, which it adds to the name (`KRNL386.EXE` seg2 `197d`-`1988`).
   * A `VBRUN100.EXE` beside a program, a self-extracting archive of the
   * runtime, is not `VBRUN100`.
   */
  const libraryNames = (list) =>
    list
      .filter((file) => /\.dll$/i.test(file))
      .map((file) => basename(file).toUpperCase().replace(/\.DLL$/, ''));
  const ownFolder = program
    ? new Set(
        libraryNames(
          existsSync(dirname(program))
            ? readdirSync(dirname(program)).map((name) => join(dirname(program), name))
            : []
        )
      )
    : new Set();
  const everywhere = new Set(libraryNames(files));
  const lacking = [...imports].filter(
    (module) => !installation().has(module) && !ownFolder.has(module) && !everywhere.has(module)
  );

  /*
   * The runtimes the pass places for what it lacks (`runtimes.mjs`), as an
   * installed Windows would have them in `SYSTEM`; their own imports and
   * functions are the program's as well (`KNPG` imports `MMSYSTEM`).
   */
  const placed = runtimesFor(lacking, new Set([...ownFolder, ...everywhere]));

  for (const module of placed.runtimes) {
    const found = neImports(runtimeBytes(module));

    for (const each of found?.modules ?? []) {
      imports.add(each);
    }

    for (const each of found?.functions ?? []) {
      functions.add(each);
    }
  }

  needs.imports = [...imports].sort();

  /* Win386: the supervisor's string in the program or a library of its folder. */
  const libraries = program
    ? [
        program,
        ...files.filter((file) => dirname(file) === dirname(program) && /\.dll$/i.test(file)),
      ]
    : [];

  needs.mode = libraries.some(
    (file) => statSync(file).size < 64 * 2 ** 20 && readFileSync(file).includes(WIN386)
  )
    ? 'enhanced'
    : 'standard';

  const flags = [];

  /*
   * A self-loading application: 0800h in the header's flags (at 0Ch), its
   * segments loaded by its own loader in its first segment, which Windows
   * calls in place of loading them.
   */
  if (needs.header === 'NE') {
    const ne = bytes.readUInt32LE(0x3c);

    if (bytes.readUInt16LE(ne + 0x0c) & 0x0800) {
      flags.push('self-loading');
    }
  }

  if (needs.header === 'PE' || has(/^W32SYS\.DLL$/) || has(/^WIN32S/)) {
    flags.push('win32s');
  }

  if (imports.has('WING') || has(/^WING(32)?\.DLL$/)) {
    flags.push('wing');
  }

  if (VFW.some((module) => imports.has(module)) || has(/\.AVI$/) || has(/^MSVIDEO\.DLL$/)) {
    flags.push('vfw');
  }

  if (
    QUICKTIME.some((module) => imports.has(module)) ||
    has(/\.MOV$/) ||
    has(/^(QTW|QTIM)\.DLL$/)
  ) {
    flags.push('quicktime');
  }

  if (discs.some((file) => /\.(iso|cue|bin|mdf|nrg|ccd)$/i.test(file))) {
    flags.push('cd');
  }

  if (imports.has('MMSYSTEM') || imports.has('SOUND') || has(/\.WAV$/)) {
    flags.push('sound');
  }

  if (has(/\.(MID|RMI)$/)) {
    flags.push('midi');
  }

  if (
    [...functions].some((each) =>
      PALETTE.includes(
        importName(each)
          .slice(each.indexOf('.') + 1)
          .toUpperCase()
      )
    )
  ) {
    flags.push('palette');
  }

  needs.unlinked = unlinkedOf([...functions]).sort();

  needs.flags = flags;
  needs.libraries = placed.libraries;
  needs.runtimes = placed.runtimes;

  const setups = files.filter((file) => SETUP.test(basename(file)));

  needs.setup = program && SETUP.test(basename(program)) ? relative(folder, program) : null;
  needs.setups = setups.map((file) => relative(folder, file));
  needs.installer = has(/^SETUP\.LST$/)
    ? 'mssetup'
    : has(/^SETUP\.INS$/) || has(/^_INST16\.EX_$/) || has(/^_SETUP\.LIB$/)
      ? 'installshield'
      : null;
  needs.inf = files.filter((file) => /\.inf$/i.test(file)).map((file) => relative(folder, file));

  /* What a setup's `.INF` names of the runtimes it brings. */
  for (const inf of files.filter((file) => /\.(inf|lst)$/i.test(file))) {
    const text = readFileSync(inf, 'latin1').toUpperCase();

    for (const [flag, pattern] of [
      ['wing', /\bWING\.DLL\b/],
      ['win32s', /\bW32SYS\.DLL\b|\bWIN32S16\.DLL\b/],
      ['vfw', /\bMSVIDEO\.DLL\b|\bAVIFILE\.DLL\b/],
      ['quicktime', /\bQTW\.DLL\b|\bQTIM\.DLL\b/],
    ]) {
      if (pattern.test(text) && !needs.flags.includes(flag)) {
        needs.flags.push(flag);
      }
    }
  }

  return needs;
}
