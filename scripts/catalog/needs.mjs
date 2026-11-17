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

import { expand } from '../oracle/szdd.mjs';
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

/** A file `COMPRESS.EXE` made (`SZDD`), expanded; null for another. */
function expandedOf(file) {
  const bytes = readFileSync(file);

  return bytes.toString('latin1', 0, 4) === 'SZDD' ? Buffer.from(expand(bytes)) : null;
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
        .map((token) => token.replace(/^"|"$/g, ''))
        .filter((token) => token && !token.startsWith('/'));
      /* The words after the program: its command line (`tbook.exe C:\artshow\art91.ctb`). */
      const after = (index) => tokens.slice(index + 1).join(' ');

      for (const [index, token] of tokens.entries()) {
        const base = token
          .split(/[\\/]/)
          .pop()
          .replace(/^[A-Za-z]:/, '');

        if (/^win(\.com)?$/i.test(base) && tokens[index + 1]) {
          candidates.push({ name: tokens[index + 1], args: after(index + 1) });
        } else if (/\.exe$/i.test(base) && !/^win\.com$/i.test(base)) {
          candidates.push({ name: token, args: after(index) });
        }
      }
    }

    for (const { name: candidate, args } of candidates.reverse()) {
      const base = candidate
        .split(/[\\/]/)
        .pop()
        .replace(/^[A-Za-z]:/, '');
      const found = findFile(files, /\./.test(base) ? base : `${base}.exe`);

      if (found && headerOf(readFileSync(found)) !== 'DOS') {
        return { program: found, batch: relative(dirname(batch), batch), args };
      }
    }

    return {
      error: `${basename(batch)} names no Windows program in the download`,
      batch: basename(batch),
      named: candidates.reverse().map((each) => each.name),
    };
  }

  const program = findFile(files, name);

  return program ? { program } : { error: `${name} not in the download` };
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
 * How many resources a New Executable has: its resource table (at 24h in
 * the header, up to the resident names at 26h) is a shift, then for each
 * type its id, its count and four bytes, and twelve bytes a resource.
 */
function resourceCount(bytes) {
  try {
    const ne = bytes.readUInt32LE(0x3c);
    const end = ne + bytes.readUInt16LE(ne + 0x26);
    let at = ne + bytes.readUInt16LE(ne + 0x24) + 2;
    let count = 0;

    while (at + 8 <= end && bytes.readUInt16LE(at)) {
      const each = bytes.readUInt16LE(at + 2);

      count += each;
      at += 8 + each * 12;
    }

    return count;
  } catch {
    return 0;
  }
}

/**
 * Windows' own installation in a download, where one is: the folder that
 * holds `WIN.COM` with `SYSTEM` beneath it (`C:\WINDOWS`, `WIN92`,
 * `WINDOWS3`).
 */
export function installationIn(files) {
  const win = files.find(
    (file) =>
      /^win\.com$/i.test(basename(file)) &&
      files.some(
        (other) =>
          dirname(dirname(other)) === dirname(file) && /^system$/i.test(basename(dirname(other)))
      )
  );

  return win ? dirname(win) : null;
}

/** A word of an item's id or title, for finding its program by its name. */
const NAME_WORDS = /[a-z0-9]{4,}/gi;
/** Words that name no program of their own. */
const COMMON_WORDS =
  /^(windows|win31|game|games|version|demo|shareware|browser|playable|via|edition|test|software|collection)$/i;

/**
 * The Windows program of a download whose `run` names none -- a DOS
 * program, `WIN.COM` or a batch file that starts Windows -- as a person
 * would find it: none where the download is a copy of Windows itself (its
 * installation, and the item's title naming Windows: `windows`); else of
 * the New Executable applications outside Windows' installation and
 * MS-DOS's `DOS` folder (Windows' own programs, a runtime's and MS-DOS's
 * tools), the one Windows starts (`WIN.INI`'s `load=` or `run=`,
 * `SYSTEM.INI`'s `shell=`, the StartUp group's); else one a batch file
 * starts with `win`; else one whose path or group has a word of the item's
 * id or title; else, in an installation, none (`windows` again: Windows
 * with programs of its own for its person to choose from); else one a
 * Program Manager group names; else the one with the most resources, a
 * setup last.
 * `from` says which, `args` is the command line its group or batch file
 * gives it, `root` that the download is a drive's root (its programs at
 * `C:\` as its groups name them). Null where it holds none.
 */
export function windowsProgramOf(item, folder, files) {
  const installation = installationIn(files);
  const inside = (file, at) => at && (file === at || file.startsWith(`${at}/`));
  const dosFolder = files
    .map((file) => dirname(file))
    .find((dir) => dirname(dir) === folder && /^dos$/i.test(basename(dir)));

  if (installation && /\bwindows\b/i.test(item.title ?? '')) {
    return { windows: `a copy of Windows: ${relative(folder, installation) || '.'}\\WIN.COM` };
  }

  const candidates = files
    .filter(
      (file) => /\.exe$/i.test(file) && !inside(file, installation) && !inside(file, dosFolder)
    )
    .filter((file) => statSync(file).size < 64 * 2 ** 20)
    .map((file) => ({ file, bytes: readFileSync(file) }))
    .filter(
      ({ bytes }) =>
        headerOf(bytes) === 'NE' && !(bytes.readUInt16LE(bytes.readUInt32LE(0x3c) + 0x0c) & 0x8000)
    )
    .map(({ file, bytes }) => ({ file, resources: resourceCount(bytes) }));

  if (!candidates.length) {
    return null;
  }

  const byName = (name) => {
    const wanted = name.replace(/^"|"$/g, '').split(/[\\/]/).pop().toUpperCase();

    return candidates.find((each) => basename(each.file).toUpperCase() === wanted) ?? null;
  };
  const pick = (each, from, args = '') => ({
    program: each.file,
    from,
    args: args.trim(),
    root: Boolean(installation),
  });

  /* The groups' items, each with its command line. */
  const grouped = files
    .filter((file) => /\.grp$/i.test(file))
    .flatMap((file) => {
      const group = groupItems(readFileSync(file));

      return (group.items ?? []).map((each) => ({ ...each, group: group.group }));
    })
    .map((each) => {
      const [command, ...rest] = each.command.trim().split(/\s+/);

      return { ...each, found: byName(command ?? ''), args: rest.join(' ') };
    })
    .filter((each) => each.found);

  /*
   * What Windows itself starts: `WIN.INI`'s `load=` and `run=`, a shell
   * of `SYSTEM.INI`'s not Program Manager, and the items of the group
   * Program Manager starts (`PROGMAN.INI`'s `Startup=`, else StartUp).
   */
  if (installation) {
    const startup =
      files
        .filter((file) => /^progman\.ini$/i.test(basename(file)))
        .map((file) => /^\s*startup\s*=\s*(.+?)\s*$/im.exec(readFileSync(file, 'latin1'))?.[1])
        .find(Boolean) ?? 'StartUp';
    const started = grouped.find((each) => each.group.toLowerCase() === startup.toLowerCase());

    if (started) {
      return pick(started.found, `group "${started.group}"`, started.args);
    }

    for (const file of files.filter((each) => /^(win|system)\.ini$/i.test(basename(each)))) {
      for (const line of readFileSync(file, 'latin1').split(/\r?\n/)) {
        const started = /^\s*(load|run|shell)\s*=\s*(.*)$/i.exec(line);

        for (const word of started ? started[2].split(/[\s,]+/).filter(Boolean) : []) {
          const found = !/^progman(\.exe)?$/i.test(basename(word)) && byName(word);

          if (found) {
            return pick(found, basename(file).toUpperCase());
          }
        }
      }
    }
  }

  /* What a batch file starts Windows with: `win \FMEDIA\MTB30RUN \FMEDIA\FM.TBK`. */
  for (const batch of files.filter((file) => /\.bat$/i.test(file))) {
    for (const line of readFileSync(batch, 'latin1').split(/\r?\n/)) {
      const words = line.trim().split(/\s+/);
      const at = words.findIndex((word) => /^(.*[\\/])?win(\.com)?$/i.test(word));
      const found =
        at >= 0 &&
        words[at + 1] &&
        byName(/\./.test(words[at + 1]) ? words[at + 1] : `${words[at + 1]}.exe`);

      if (found) {
        return { ...pick(found, basename(batch), words.slice(at + 2).join(' ')), root: true };
      }
    }
  }

  const words = [...`${item.id} ${item.title ?? ''}`.matchAll(NAME_WORDS)]
    .map(([word]) => word.toLowerCase())
    .filter((word) => !COMMON_WORDS.test(word) && !/^\d+$/.test(word));
  const named = (text) => words.some((word) => text.toLowerCase().includes(word));
  const setupLast = (a, b) =>
    Number(SETUP.test(basename(a.file))) - Number(SETUP.test(basename(b.file))) ||
    b.resources - a.resources;

  const byWord =
    grouped.find((each) => named(each.group) || named(relative(folder, each.found.file))) ??
    [...candidates].sort(setupLast).find((each) => named(relative(folder, each.file)));

  if (byWord) {
    return byWord.found
      ? pick(byWord.found, `group "${byWord.group}"`, byWord.args)
      : pick(byWord, 'its name');
  }

  /*
   * An installation that starts none of its programs, none of them named
   * as the item is: Windows, with programs of its own beside it, for its
   * person to choose from (a collection's games, a sound card's tools).
   */
  if (installation) {
    return {
      windows: `a copy of Windows with programs of its own, none started with it: ${relative(folder, installation) || '.'}\\WIN.COM`,
    };
  }

  if (grouped.length) {
    const first = [...grouped].sort((a, b) => setupLast(a.found, b.found))[0];

    return pick(first.found, `group "${first.group}"`, first.args);
  }

  return pick([...candidates].sort(setupLast)[0], 'most resources');
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
  let located = programOf(item.run, files);
  const header = located.program ? headerOf(readFileSync(located.program)) : null;

  /*
   * The program `run` names is not a Windows one: the Windows program the
   * download holds (`windowsProgramOf`), or that it is Windows itself.
   */
  if (!['NE', 'PE'].includes(header)) {
    const found = windowsProgramOf(item, folder, files);

    if (found?.windows) {
      needs.windows = found.windows;
    } else if (found) {
      located = { program: found.program };
      needs.chosen = found.from;

      if (found.args) {
        needs.args = found.args;
      }

      if (found.root) {
        needs.root = true;
      }
    }
  }

  const discs = [
    ...images,
    ...files.filter((file) => /\.(iso|cue|bin|img|ima|mdf|nrg|ccd)$/i.test(file)),
  ];

  needs.images = discs.map((file) => basename(file));

  if (located.error) {
    needs.error = located.error;
  }

  /*
   * A download with a `WINDOWS` folder of its own at its top is a drive's
   * root, as archive.org's DOSBox mounts it: its batch file copies that
   * folder over Windows' (a runtime's libraries and drivers, the `.INI`
   * files naming them), and its programs are at `C:\` (`pass.mjs`'s
   * `rootDrive`).
   */
  if (
    existsSync(folder) &&
    readdirSync(folder).some(
      (name) => /^windows$/i.test(name) && statSync(join(folder, name)).isDirectory()
    )
  ) {
    needs.root = true;
  }

  if (located.batch) {
    needs.batch = located.batch;
  }

  /*
   * A command line a batch file gives its program names its files where
   * archive.org's DOSBox has them, the download as `C:\`: the program is
   * run so (`root`).
   */
  if (located.args) {
    needs.args = located.args;
    needs.root = true;
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

  /*
   * A setup's payload, as Microsoft's `COMPRESS.EXE` leaves a file
   * (`SZDD`, the extension's last letter `_`): its programs and libraries
   * are what the setup installs and starts, and their imports are needed
   * as the setup runs (a Visual Basic setup kit's bootstrap starts the
   * `SETUP1.EXE` it expands, which imports `VBRUN300`); a module so
   * compressed is one the download brings.
   */
  const payload = [];

  if (program && SETUP.test(basename(program))) {
    for (const file of files) {
      if (/\.(ex|dl|dr|vb)_$/i.test(file) && statSync(file).size < 64 * 2 ** 20) {
        const expanded = expandedOf(file);

        if (!expanded) {
          continue;
        }

        const module = basename(file)
          .toUpperCase()
          .replace(/\.[^.]+$/, '');

        if (!byModule.has(module)) {
          byModule.set(module, file);
        }

        if (/\.ex_$/i.test(file)) {
          payload.push(expanded);
        }
      }
    }
  }

  /* The modules some executables import, and those their libraries in the download import, in turn. */
  const walk = (start) => {
    const imports = new Set();
    const functions = new Set();
    const read = new Set();
    const pending = [...start];

    while (pending.length) {
      const found = neImports(pending.shift());

      for (const module of found?.modules ?? []) {
        imports.add(module);

        if (!read.has(module) && byModule.has(module)) {
          read.add(module);
          pending.push(expandedOf(byModule.get(module)) ?? readFileSync(byModule.get(module)));
        }
      }

      for (const each of found?.functions ?? []) {
        functions.add(each);
      }
    }

    return { imports, functions };
  };
  const { imports, functions } = walk(bytes && needs.header === 'NE' ? [bytes] : []);

  const ownFolder = program ? new Set(moduleNames(dirname(program))) : new Set();
  const everywhere = new Set(byModule.keys());
  const lacks = (modules) =>
    [...modules].filter(
      (module) => !installation().has(module) && !ownFolder.has(module) && !everywhere.has(module)
    );
  const lacking = lacks(imports);
  /* What the setup's payload lacks: only a runtime the pass has is placed for it. */
  const payloadLacking = lacks(walk(payload).imports).filter((module) => !lacking.includes(module));

  /*
   * The runtimes the pass places for what it lacks (`runtimes.mjs`), as an
   * installed Windows would have them in `SYSTEM`; their own imports and
   * functions are the program's as well (`KNPG` imports `MMSYSTEM`).
   */
  const placed = runtimesFor(lacking, new Set([...ownFolder, ...everywhere]));
  const forPayload = runtimesFor(payloadLacking, new Set([...ownFolder, ...everywhere]));

  for (const module of forPayload.runtimes) {
    if (!placed.runtimes.includes(module)) {
      placed.runtimes.push(module);
    }
  }

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
