#!/usr/bin/env node
/**
 * The compatibility catalog's titles, from the programs themselves.
 * archive.org's titles are poor: most carry the collection's prefix
 * ("Windows 3.1 Shareware: ..."), and many are only the program's file
 * name. A title is found here from the program's own files and from a run
 * of it in WinBox, each source tried in turn, the first that gives a real
 * name taken (`chooseTitle`); every candidate is kept beside it, so a
 * choice can be checked. The design is `kb/guides/compatibility.md`,
 * "Titles".
 *
 *   cargo build --release -p winbox-win16 --example trace
 *   node scripts/catalog/titles.mjs --filenames   # fetch and run the items titled by a file name
 *   node scripts/catalog/titles.mjs --fetched     # read the items already fetched, without running
 *   node scripts/catalog/titles.mjs win3__dare    # these
 *   node scripts/catalog/catalog.mjs --titles     # write what was found into catalog/catalog.json
 *
 * The sources, in order (`SOURCES`): the main program's version resource
 * (`ProductName`, else `FileDescription`); the caption of the first window
 * it shows at the top in a run of a few seconds on the survey's clock;
 * `FILE_ID.DIZ`'s first line; the New Executable's module description (the
 * first entry of its non-resident names); a `SETUP.INF`'s Program Manager
 * item or group; archive.org's title with its prefix stripped. Then
 * `catalog/titles.json`'s corrections, by hand, each with its reason.
 *
 * Downloads are untrusted. Each is fetched from archive.org with the
 * User-Agent "WinBox catalog", half a second after the last request,
 * checked against archive.org's SHA-1, and unpacked into a folder of its
 * own, `corpus/programs/catalog/<id>/` (gitignored). Its files are read
 * here as data only, and the program runs inside WinBox alone (`trace`).
 * What is found is kept in `corpus/cache/catalog/titles/<id>.json`;
 * nothing of a program but the short strings found reaches the catalog.
 */

import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CACHE = join(ROOT, 'corpus', 'cache', 'catalog');
const FOUND = join(CACHE, 'titles');
const DOWNLOADS = join(CACHE, 'downloads');
const PROGRAMS = join(ROOT, 'corpus', 'programs');
const TRACE = join(ROOT, 'target', 'release', 'examples', 'trace');
const CORRECTIONS = join(ROOT, 'catalog', 'titles.json');

const USER_AGENT = 'WinBox catalog';
const DELAY = 500;
/** Virtual seconds a program runs for its caption: enough to show a window. */
const SECONDS = 5;
const RATE = 3000;
/** Runs at once. */
const PARALLEL = 4;

/** The sources of a title, in the order they are preferred. */
export const SOURCES = [
  'productName',
  'fileDescription',
  'caption',
  'fileIdDiz',
  'description',
  'setupInf',
  'archiveOrg',
];

/** The collection's prefixes on archive.org's titles. */
const PREFIX = /^(Windows 3\.1 Shareware|Windows 3\.1 Freeware|Windows 3\.1|Windows 3 Game)\s*:\s*/;

/** archive.org's title without its collection's prefix. */
export function stripPrefix(title) {
  return (title ?? '').replace(PREFIX, '').trim();
}

/** Text made one line: control characters to spaces, spaces collapsed. */
export function clean(text) {
  return (
    text
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/* --- Decoding ------------------------------------------------------------ */

/** The code pages a version resource may name, as the WHATWG decoder names them. */
const CODE_PAGES = {
  0: 'windows-1252',
  874: 'windows-874',
  932: 'shift_jis',
  936: 'gbk',
  949: 'euc-kr',
  950: 'big5',
  1250: 'windows-1250',
  1251: 'windows-1251',
  1252: 'windows-1252',
  1253: 'windows-1253',
  1254: 'windows-1254',
  1255: 'windows-1255',
  1256: 'windows-1256',
  1257: 'windows-1257',
  1258: 'windows-1258',
  10000: 'macintosh',
};

/** Bytes in a Windows code page (1252 where the page is not one a decoder knows). */
export function decode(bytes, codePage = 1252) {
  const page = CODE_PAGES[codePage] ?? 'windows-1252';

  /*
   * Text in Windows-1252 never holds the five bytes that page leaves
   * undefined (81h, 8Dh, 8Fh, 90h, 9Dh); text that does was written in a
   * DOS editor, in DOS's page (81h is "ü" there).
   */
  /*
   * Nor, between two letters, one of the punctuation marks it puts at
   * 80h-9Fh ("Cin‚tic" is DOS's "Cinétic").
   */
  const letter = (byte) => /[A-Za-z]/.test(String.fromCharCode(byte));
  const punctuation = (byte) =>
    byte >= 0x80 &&
    byte <= 0x9f &&
    ![0x83, 0x8a, 0x8c, 0x8e, 0x9a, 0x9c, 0x9e, 0x9f].includes(byte);
  const dos = [...bytes].some(
    (byte, at) =>
      [0x81, 0x8d, 0x8f, 0x90, 0x9d].includes(byte) ||
      (punctuation(byte) && letter(bytes[at - 1] ?? 0) && letter(bytes[at + 1] ?? 0))
  );

  if (page === 'windows-1252' && dos) {
    return decode437(bytes);
  }

  return new TextDecoder(page).decode(bytes);
}

/** DOS's code page 437, its upper half: `FILE_ID.DIZ` is a DOS file. */
const CP437 =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u00a0';

function decode437(bytes) {
  return [...bytes]
    .map((byte) => (byte < 0x80 ? String.fromCharCode(byte) : CP437[byte - 0x80]))
    .join('');
}

/* --- The New Executable ---------------------------------------------------- */

/** The New Executable header's offset, or null for anything else. */
function neAt(bytes) {
  if (bytes.length < 0x40 || bytes.toString('latin1', 0, 2) !== 'MZ') {
    return null;
  }

  const at = bytes.readUInt32LE(0x3c);

  return at + 0x40 <= bytes.length && bytes.toString('latin1', at, at + 2) === 'NE' ? at : null;
}

/**
 * The module's name (the first entry of the resident names, at 26h in the
 * header) and its description (the first of the non-resident names, the
 * table at the file offset 2Ch gives, 20h its length): a length byte and
 * the text.
 */
export function namesOf(bytes) {
  const ne = neAt(bytes);

  if (ne === null) {
    return { module: null, description: null };
  }

  const resident = ne + bytes.readUInt16LE(ne + 0x26);
  const nonResident = bytes.readUInt32LE(ne + 0x2c);
  const entry = (at) =>
    at > 0 && at < bytes.length && bytes[at] ? bytes.subarray(at + 1, at + 1 + bytes[at]) : null;
  const module = entry(resident);
  const description = bytes.readUInt16LE(ne + 0x20) ? entry(nonResident) : null;

  return {
    module: module ? module.toString('latin1') : null,
    description: description ? clean(decode(description)) : null,
  };
}

/**
 * A resource of a type, by its type's number, from the New Executable's
 * resource table (at 24h in the header): a shift count, then for each type
 * its number (8000h set for a number), its count and four reserved bytes,
 * and for each resource its offset and length in units of the shift, its
 * flags, its number and four reserved bytes.
 */
function resourceOf(bytes, type) {
  const ne = neAt(bytes);

  if (ne === null || bytes.readUInt16LE(ne + 0x24) === bytes.readUInt16LE(ne + 0x26)) {
    return null;
  }

  let at = ne + bytes.readUInt16LE(ne + 0x24);
  const shift = bytes.readUInt16LE(at);

  at += 2;

  while (at + 8 <= bytes.length) {
    const id = bytes.readUInt16LE(at);

    if (!id) {
      return null;
    }

    const count = bytes.readUInt16LE(at + 2);

    if (id === (0x8000 | type) && count) {
      const offset = bytes.readUInt16LE(at + 8) << shift;
      const length = bytes.readUInt16LE(at + 10) << shift;

      return bytes.subarray(offset, Math.min(bytes.length, offset + length));
    }

    at += 8 + count * 12;
  }

  return null;
}

/**
 * A block of a 16-bit version resource: its length, its value's length,
 * its key (a string ended by a nought), the value at the next four-byte
 * boundary, and its children at the next one after, to its end.
 */
function blockOf(data, at) {
  const length = data.readUInt16LE(at);
  const valueLength = data.readUInt16LE(at + 2);
  const keyEnd = data.indexOf(0, at + 4);
  const key = data.toString('latin1', at + 4, keyEnd);
  const align = (offset) => (offset + 3) & ~3;
  const valueAt = align(keyEnd + 1);
  const value = data.subarray(valueAt, Math.min(at + length, valueAt + valueLength));
  const children = [];
  const end = Math.min(data.length, at + length);

  for (let child = align(valueAt + valueLength); child + 4 < end;) {
    const childLength = data.readUInt16LE(child);

    if (childLength < 4) {
      break;
    }

    children.push(blockOf(data, child));
    child = align(child + childLength);
  }

  return { key, value, children };
}

/**
 * The strings of a program's version resource (type 16), each table's in
 * the code page its key names (`040904E4`: the language 0409, the page
 * 04E4, 1252); the first table's.
 */
export function versionOf(bytes) {
  const data = resourceOf(bytes, 16);

  if (!data || data.length < 8) {
    return null;
  }

  try {
    const root = blockOf(data, 0);
    const info = root.children.find((child) => child.key === 'StringFileInfo');
    const table = info?.children[0];

    if (!table) {
      return null;
    }

    const codePage = parseInt(table.key.slice(4), 16) || 0;
    const strings = { codePage };

    for (const string of table.children) {
      const end = string.value.indexOf(0);

      strings[string.key] = clean(
        decode(end >= 0 ? string.value.subarray(0, end) : string.value, codePage)
      );
    }

    return strings;
  } catch {
    return null;
  }
}

/* --- The other files ------------------------------------------------------ */

/** Every file of a folder, at any depth. */
function filesOf(folder) {
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

/** A program's file in its folder: its name, in any case, the shallowest first. */
function find(files, name) {
  const wanted = name.split(/[\\/]/).pop().toUpperCase();

  return (
    files
      .filter((file) => basename(file).toUpperCase() === wanted)
      .sort((a, b) => a.split(/[\\/]/).length - b.split(/[\\/]/).length)[0] ?? null
  );
}

/** A version written in a title: "v1.2", "1.20a", "Version 2", "ver. 3.1". */
const VERSION =
  /\s*[(,-]?\s*\b(?:v|ver\.?|version)\s*(\d+(?:\.\d+)*[a-z]?)\b\)?|\s+(\d+\.\d+[a-z]?)\b/i;

/** A copyright notice, or a year, and what follows it. */
const NOTICE = /\s*(?:[-,;]\s*)?(?:\(c\)|©|copyright\b|copr\.|\b(?:19[89]\d|20[0-2]\d)\b)/i;

/**
 * A line split into its title and what is written after it: a version, a
 * copyright notice or year, and "by" whom.
 */
export function splitLine(line) {
  let title = line;
  const out = {};
  const notice = NOTICE.exec(title);

  if (notice) {
    out.copyright = clean(title.slice(notice.index).replace(/^[\s,;-]+/, ''));
    title = title.slice(0, notice.index);
  }

  const by = /\s+(?:by|from)\s+(.+)$/i.exec(title);

  if (by && by.index > 0) {
    out.credit = clean(by[1]);
    title = title.slice(0, by.index);
  }

  const version = VERSION.exec(title);

  if (version && version.index > 0) {
    out.version = version[1] ?? version[2];
    title = title.slice(0, version.index) + title.slice(version.index + version[0].length);
  }

  const year = /\b(19[89]\d|20[0-2]\d)\b/.exec(out.copyright ?? '');

  if (year) {
    out.year = Number(year[1]);
  }

  out.title = clean(title).replace(/[\s:,;.-]+$/, '');
  return out;
}

/**
 * `FILE_ID.DIZ`'s first line with words in it, in DOS's code page, its
 * frame and decoration taken off; its version and author split off.
 */
export function dizOf(bytes) {
  const lines = decode437(bytes)
    .split(/\r?\n/)
    .map((line) =>
      clean(
        line
          .replace(/[\u2500-\u25ff■]/g, ' ')
          .replace(/^[\s\-=*~_.:|<>#+[\](){}"'`]+/, '')
          .replace(/[\s\-=*~_.:|<>#+[\](){}"'`]+$/, '')
      )
    );
  const line = lines.find((each) => /[A-Za-z]{2}/.test(each));

  if (!line) {
    return null;
  }

  /* "Title - what it is": the title alone. */
  /* "Title - what it is", "Title: what it is", "Title, what it is": the title alone. */
  const [first] = line.split(/\s+(?:-{1,2}|–)\s+|:\s+|,\s+|\.\s+/);

  return splitLine(first.replace(/\s*[([][^)\]]*$/, ''));
}

/** An `.INF` file's sections, by name in lower case, each its lines. */
function sectionsOf(text) {
  const sections = {};
  let current = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\s*;.*$/, '').trim();
    const header = /^\[([^\]]+)\]/.exec(line);

    if (header) {
      current = header[1].trim().toLowerCase();
      sections[current] = [];
    } else if (current && line) {
      sections[current].push(line);
    }
  }

  return sections;
}

/** The quoted strings of a line, else its fields, comma separated. */
function fieldsOf(line) {
  const value =
    line.includes('=') && !line.startsWith('"') ? line.slice(line.indexOf('=') + 1) : line;

  return value.split(',').map((field) =>
    field
      .trim()
      .replace(/^"(.*)"$/, '$1')
      .trim()
  );
}

/**
 * A setup's Program Manager item for the program, else its group, from the
 * `[progman.groups]` section of Microsoft's setup toolkit: each group a
 * line naming its section and its title, each item in that section its
 * title and its program.
 */
export function setupInfOf(text, program) {
  const sections = sectionsOf(text);
  const groups = sections['progman.groups'];

  if (!groups) {
    return null;
  }

  const want = program.split(/[\\/]/).pop().toUpperCase();
  let firstGroup = null;

  for (const line of groups) {
    const [key] = line.split('=').map((part) => part.trim());
    const fields = fieldsOf(line);
    const title = fields[fields.length > 1 && !line.includes('=') ? 1 : 0] || key;
    const items = sections[key.toLowerCase()] ?? sections[title.toLowerCase()] ?? [];

    firstGroup ??= title;

    for (const item of items) {
      const [name, command] = fieldsOf(item);

      if (
        command &&
        command
          .toUpperCase()
          .split(/[\\/ ]/)
          .includes(want)
      ) {
        return { title: name, group: title };
      }
    }
  }

  /*
   * No item starts the program: the group's name, where the program is
   * the setup that makes it. Another program's folder may hold an `.INF`
   * that is not its own (a copy of Windows' own SETUP.INF, whose group is
   * Main).
   */
  return firstGroup && /^(?:_?setup|install|inst|instal)\w*\.exe$/i.test(want)
    ? { title: firstGroup, group: firstGroup }
    : null;
}

/* --- Choosing ----------------------------------------------------------- */

/** Words that name no program. */
const GENERIC = new Set(
  [
    'setup',
    'install',
    'installer',
    'installation',
    'readme',
    'read me',
    'demo',
    'program',
    'application',
    'windows application',
    'main',
    'untitled',
    'windows',
    'microsoft windows',
    'microsoft windows application',
    'game',
    'games',
    'shareware',
    'freeware',
    'about',
    'window',
    'mainwindow',
    'main window',
    'dialog',
    'test',
    'undetermined',
    'warning',
    'error',
    'welcome',
    'registration',
    'registration information',
    'standard',
    'standard mode',
    'enhanced mode',
  ].map((word) => word.toLowerCase())
);

/**
 * Text that is not a program's name: a shareware notice's or a setup's
 * caption, a compiler sample's description, or the Klik & Play runtime's
 * own description, which every game it made carries.
 */
const NOT_A_NAME = [
  /\b(?:un)?regist(?:er|ered|ration)\b/i,
  /\bshareware (?:notice|information|version|registration)\b/i,
  /^please\b/i,
  /\b(?:setup|installation|initiali[sz]ation)$/i,
  /\b(?:sample|my first)\b.*\b(?:application|program)\b/i,
  /\bmicrosoft windows\b.*\b(?:application|program|game)$/i,
  /^klik & play\b/i,
  /* A program's state in its caption: a time ("Next Break: 01:59"), keys ("HELP = H"). */
  /\d:\d\d/,
  /\s=\s/,
  /*
   * Visual C++'s AppWizard's defaults, the project's name in capitals:
   * "HANOI MFC Application", "GOMOKU Application".
   */
  /^[A-Z0-9_]+ (?:MFC )?Application$/,
  /*
   * Windows' own product name, which programs built from the SDK's
   * version resource carry as their `ProductName` ("Microsoft® Windows(TM)
   * Operating System"); and a settings dialog's caption, which a screen
   * saver run without `/s` shows ("Fishes Settings", "Cows Configuration").
   */
  /^microsoft\W*windows\W*(?:\(tm\))?\s*operating system$/i,
  /\b(?:configuration|settings)$/i,
];

/**
 * A sentence, not a name: most of its longer words begin in lower case
 * ("Concentration game with flags of the world"). Titles are capitalised,
 * or written all in capitals.
 */
function sentence(text) {
  const words = text.split(/\s+/).filter((word) => /^\p{L}{4,}/u.test(word));
  const lower = words.filter((word) => /^\p{Ll}/u.test(word));

  return words.length >= 3 && lower.length * 2 > words.length;
}

/**
 * Why a candidate is not a title, or null if it is one: empty, a file name
 * (with an extension, an all-capitals 8.3 name, or the program's, module's
 * or item's own name), "Microsoft Windows" or another generic word, or no
 * letters at all.
 */
export function rejected(text, names = [], source = 'archiveOrg') {
  if (!text || text.length < 2) {
    return 'empty';
  }

  if ((text.match(/\p{L}/gu) ?? []).length < 2) {
    return 'no letters';
  }

  if (GENERIC.has(text.toLowerCase())) {
    return 'generic';
  }

  if (NOT_A_NAME.some((pattern) => pattern.test(text))) {
    return 'not a name';
  }

  if (/^[A-Za-z]:\\|\\/.test(text)) {
    return 'a path';
  }

  /* archive.org's titles are names, if poor ones; the programs' text may be a description. */
  if (source !== 'archiveOrg' && sentence(text)) {
    return 'a sentence';
  }

  if (/^[^\s.]+\.[A-Za-z0-9]{1,3}$/.test(text)) {
    return 'file name';
  }

  if (/^[A-Z0-9_$~!#&@%'^-]{1,8}$/.test(text)) {
    return 'all-capitals 8.3 name';
  }

  if (!/\s/.test(text) && /_/.test(text)) {
    return 'file name';
  }

  const lower = text.toLowerCase().replace(/\.[a-z0-9]{1,3}$/, '');

  /*
   * The program's own name, as a file or module name is written: all in
   * capitals or all in small letters. Written in mixed case ("DDEWatch"),
   * it is the author's spelling of the name, and taken.
   */
  const fileCase = text === text.toUpperCase() || text === text.toLowerCase();

  if (fileCase && names.some((name) => name && name.toLowerCase() === lower)) {
    return "the program's own name";
  }

  return null;
}

/**
 * The title an item takes. archive.org's, its prefix stripped, where it is
 * already a name (not refused by `rejected`): the owner's decision of
 * 2026-11-14. Else the first candidate from the program, in the sources'
 * order, that is not refused; else archive.org's all the same. A
 * correction of `catalog/titles.json` comes last, and wins.
 */
export function chooseTitle(candidates, names, correction) {
  if (correction?.title) {
    return { title: correction.title, titleSource: 'correction' };
  }

  const archive = stripPrefix(candidates.archiveOrg);

  if (archive && !rejected(archive, names, 'archiveOrg')) {
    return { title: archive, titleSource: 'archiveOrg' };
  }

  for (const source of SOURCES) {
    const text = source === 'archiveOrg' ? stripPrefix(candidates[source]) : candidates[source];

    if (text && !rejected(text, names, source)) {
      return { title: text, titleSource: source };
    }
  }

  return { title: stripPrefix(candidates.archiveOrg) || null, titleSource: 'archiveOrg' };
}

/** The names a title must not merely repeat: the program's, its module's, the item's. */
function namesFor(entry, found) {
  const base = (name) =>
    name
      ? name
          .split(/[\\/]/)
          .pop()
          .replace(/\.[^.]+$/, '')
      : null;

  return [
    base(entry.run),
    found?.module,
    entry.id,
    entry.id.replace(/^win3_/i, ''),
    ...entry.source.archiveOrg.downloads.map((download) => base(download.file)),
  ];
}

/** The corrections kept by hand, by id. */
export function corrections() {
  return existsSync(CORRECTIONS) ? JSON.parse(readFileSync(CORRECTIONS, 'utf8')).corrections : {};
}

/** What was found of an item, if it was read. */
export function foundOf(id) {
  const file = join(FOUND, `${id}.json`);

  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}

/**
 * A catalog's entry with its title chosen: `title`, `titleSource`, every
 * candidate in `titles` (archive.org's as archive.org has it), and the
 * `version`, copyright notice and credit found with them.
 */
export function withTitle(entry, fixes = corrections()) {
  const archive = entry.titles?.archiveOrg ?? entry.title;
  const found = foundOf(entry.id);
  const candidates = { ...found?.candidates, archiveOrg: archive };
  const titles = Object.fromEntries(
    SOURCES.filter((source) => candidates[source]).map((source) => [source, candidates[source]])
  );
  const chosen = chooseTitle(candidates, namesFor(entry, found), fixes[entry.id]);
  const {
    id,
    title: _title,
    titleSource: _source,
    titles: _titles,
    version: _version,
    copyright: _copyright,
    credit: _credit,
    ...rest
  } = entry;
  const extra = found?.extra?.[chosen.titleSource] ?? {};
  const version = extra.version ?? found?.version ?? null;

  return {
    id,
    ...chosen,
    titles,
    version,
    ...((extra.copyright ?? found?.copyright)
      ? { copyright: extra.copyright ?? found.copyright }
      : {}),
    ...(extra.credit ? { credit: extra.credit } : {}),
    ...rest,
  };
}

/* --- Reading a program ---------------------------------------------------- */

/**
 * What an item's files say of its title: the main program's version
 * strings, its module description, its folder's `FILE_ID.DIZ` and setup
 * `.INF` files. Read as data only.
 */
export function readFolder(folder, run) {
  const files = filesOf(folder);
  const exe = run ? find(files, run) : null;
  const found = { candidates: {}, extra: {}, program: exe ? relative(folder, exe) : null };

  if (!exe) {
    found.error = `${run} not in the download`;
  } else {
    const bytes = readFileSync(exe);
    const ne = neAt(bytes);

    found.header =
      ne !== null ? 'NE' : bytes.toString('latin1', 0, 2) === 'MZ' ? 'other' : 'not MZ';

    if (ne !== null) {
      const version = versionOf(bytes);
      const names = namesOf(bytes);

      found.module = names.module;

      if (version) {
        for (const [field, source] of [
          ['ProductName', 'productName'],
          ['FileDescription', 'fileDescription'],
        ]) {
          if (version[field]) {
            found.candidates[source] = version[field];
            found.extra[source] = {};
          }
        }

        found.version = version.ProductVersion || version.FileVersion || null;
        found.copyright = version.LegalCopyright || null;
        found.codePage = version.codePage;
      }

      if (names.description) {
        const split = splitLine(names.description.split(/\s+(?:-{1,2}|–)\s+|:\s+|,\s*/)[0]);

        if (split.title) {
          found.candidates.description = split.title;
        }

        found.extra.description = split;
      }
    }
  }

  const diz = files.find((file) => basename(file).toUpperCase() === 'FILE_ID.DIZ');

  if (diz) {
    const split = dizOf(readFileSync(diz));

    if (split?.title) {
      found.candidates.fileIdDiz = split.title;
      found.extra.fileIdDiz = split;
    }
  }

  for (const inf of files.filter((file) => /\.inf$/i.test(file))) {
    const setup = setupInfOf(decode(readFileSync(inf)), run ?? '');

    if (setup?.title) {
      found.candidates.setupInf = clean(setup.title);
      found.extra.setupInf = { group: setup.group };
      break;
    }
  }

  return found;
}

/* --- Running a program ---------------------------------------------------- */

/** The Win386 supervisor's refusal in standard mode (`kb/topics/win386.md`). */
const WIN386 = 'Not running on a 386 DPMI implementation';

/**
 * A program run in WinBox for a few seconds (`trace --captions`), and the
 * windows at the top it left: each its class, whether shown, whether a
 * message box, and its caption, Latin-1 in the trace, its bytes decoded
 * here as Windows-1252.
 */
function runFor(exe, folder) {
  const short = basename(folder)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);
  const inside = relative(folder, exe).split(/[\\/]/).join('\\').toUpperCase();
  const mode = [exe, ...filesOf(dirname(exe)).filter((file) => /\.dll$/i.test(file))].some((file) =>
    readFileSync(file).includes(WIN386)
  )
    ? 'enhanced'
    : 'standard';

  return new Promise((resolve) => {
    const child = spawn(
      TRACE,
      [
        exe,
        '--path',
        `C:\\CORPUS\\${short}\\${inside}`,
        '--windows',
        join(ROOT, 'oracle', 'build', 'drive-c'),
        '--display',
        'vga',
        '--mode',
        mode,
        '--boxes',
        '3',
        '--seconds',
        String(SECONDS),
        '--budget',
        String(SECONDS * 2 * RATE * 1000),
        '--summary',
        '--captions',
      ],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill(), 60_000);

    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (err += chunk));
    child.on('close', () => {
      clearTimeout(timer);

      const windows = out
        .split('\n')
        .filter((line) => line.startsWith('window: '))
        .map((line) => JSON.parse(line.slice(8)))
        .map((window) => ({
          ...window,
          title: clean(decode(Buffer.from(window.title, 'latin1'))),
        }));
      const stopped = out.split('\n').find((line) => line.startsWith('stopped: ')) ?? '';
      const panicked = /panicked at [^\n]*/.exec(err)?.[0];

      resolve({ windows, mode, stopped: stopped || panicked || 'no output' });
    });
  });
}

/** The caption a run gives: the first window at the top shown, not a message box, with a caption. */
export function captionOf(windows) {
  const titled = windows.filter((window) => !window.box && window.title);
  const dialog = (window) => window.class === '#32770';

  /*
   * A window of the program's own class before a dialog: a shareware
   * notice is often a dialog shown, modal, before the main window is.
   */
  return (
    (
      titled.find((window) => window.visible && !dialog(window)) ??
      titled.find((window) => !dialog(window)) ??
      titled.find((window) => window.visible)
    )?.title ?? null
  );
}

/**
 * A caption made a title: "About " taken off the front, what follows a
 * dash ("Notepad - [Untitled]") and a closing bracket's or parenthesis's
 * part ("(Unregistered)") off the end, then its version split off.
 */
export function captionTitle(caption) {
  const [first] = caption.replace(/^about\s+/i, '').split(/\s+(?:-{1,2}|–|:)\s+/);

  const split = splitLine(first);

  /* And a game's number ("Solit #233"), which is the game's state. */
  split.title = split.title.replace(/\s*[([][^)\]]*[)\]]$/, '').replace(/\s*#\s*\d+$/, '');
  return split;
}

/** A run's windows kept in what was found, and its caption among the candidates. */
export function applyRun(found, run) {
  found.run = run;

  const caption = captionOf(run.windows);

  delete found.candidates.caption;
  delete found.extra.caption;

  if (caption) {
    const split = captionTitle(caption);

    if (split.title) {
      found.candidates.caption = split.title;
    }

    found.extra.caption = split;
  }
}

/* --- Fetching -------------------------------------------------------------- */

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * An item's downloads fetched (each once, kept in the gitignored cache),
 * each held to archive.org's SHA-1, and unpacked into its folder: a zip
 * by the corpus's unpacker, which refuses any member leaving the folder;
 * anything else copied in as it is. Returns the bytes fetched.
 */
async function fetchItem(entry, folder) {
  const { unpack } = await import('../corpus/fetch.mjs');
  const { identifier, downloads } = entry.source.archiveOrg;
  let fetched = 0;

  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });

  for (const download of downloads) {
    const name = download.file.split('/').pop();
    const file = join(DOWNLOADS, identifier, name);

    if (!existsSync(file)) {
      const url = `https://archive.org/download/${encodeURIComponent(identifier)}/${download.file
        .split('/')
        .map(encodeURIComponent)
        .join('/')}`;
      const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });

      await wait(DELAY);

      if (!response.ok) {
        throw new Error(`${download.file}: archive.org answered ${response.status}`);
      }

      const bytes = Buffer.from(await response.arrayBuffer());

      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, bytes);
      fetched += bytes.length;
    }

    const sha1 = createHash('sha1').update(readFileSync(file)).digest('hex');

    if (download.sha1 && sha1 !== download.sha1) {
      throw new Error(`${download.file}: SHA-1 ${sha1}, archive.org says ${download.sha1}`);
    }

    if (/\.zip$/i.test(name)) {
      unpack(file, folder);
    } else {
      copyFileSync(file, join(folder, name));
    }
  }

  return fetched;
}

/* --- The items ------------------------------------------------------------ */

/** An item titled by its program's file name: archive.org's title, stripped, is its `run`'s name. */
export function titledByFileName(entry) {
  const base = entry.run
    ? entry.run
        .split(/[\\/]/)
        .pop()
        .replace(/\.[^.]+$/, '')
    : null;

  return Boolean(base) && stripPrefix(entry.titles?.archiveOrg ?? entry.title) === base;
}

/**
 * The folders items are already in: this script's own, the sample's
 * (`corpus/programs/<id in lower case>`), and the corpus's by its
 * manifest's archive.org identifier.
 */
function fetchedFolders() {
  const folders = new Map();
  const manifest = JSON.parse(readFileSync(join(ROOT, 'corpus', 'manifest.json'), 'utf8'));

  for (const program of manifest.programs) {
    const identifier = program.source?.archiveOrg?.identifier;

    if (identifier && existsSync(join(PROGRAMS, program.id))) {
      folders.set(identifier, join(PROGRAMS, program.id));
    }
  }

  for (const name of existsSync(PROGRAMS) ? readdirSync(PROGRAMS) : []) {
    folders.set(name, join(PROGRAMS, name));
  }

  for (const name of existsSync(join(PROGRAMS, 'catalog'))
    ? readdirSync(join(PROGRAMS, 'catalog'))
    : []) {
    folders.set(name, join(PROGRAMS, 'catalog', name));
  }

  return folders;
}

async function main() {
  const args = process.argv.slice(2);
  const catalog = JSON.parse(readFileSync(join(ROOT, 'catalog', 'catalog.json'), 'utf8')).items;
  const fetchedOnly = args.includes('--fetched');
  const ids = args.filter((arg) => !arg.startsWith('--'));
  const folders = fetchedFolders();
  const folderOf = (entry) => folders.get(entry.id) ?? folders.get(entry.id.toLowerCase());
  let chosen;

  if (args.includes('--filenames')) {
    chosen = catalog.filter((entry) => titledByFileName(entry) || ids.includes(entry.id));
  } else if (fetchedOnly) {
    chosen = catalog.filter((entry) => folderOf(entry));
  } else {
    chosen = catalog.filter((entry) => ids.includes(entry.id));
  }

  const toFetch = chosen.filter((entry) => !folderOf(entry));
  const bytes = toFetch.reduce((total, entry) => total + entry.size, 0);

  console.error(`${chosen.length} items, ${toFetch.length} to fetch, ${bytes} bytes`);

  if (bytes > 2 ** 30 && !args.includes('--over-a-gigabyte')) {
    throw new Error('over a gigabyte to fetch: asked first');
  }

  if (!fetchedOnly && !existsSync(TRACE)) {
    throw new Error(`${relative(ROOT, TRACE)} is not built`);
  }

  mkdirSync(FOUND, { recursive: true });

  const started = Date.now();
  let fetchedBytes = 0;
  const running = new Set();

  for (const [index, entry] of chosen.entries()) {
    let folder = folderOf(entry);
    let found;

    try {
      if (!folder) {
        folder = join(PROGRAMS, 'catalog', entry.id);
        fetchedBytes += await fetchItem(entry, folder);
      }

      found = readFolder(folder, entry.run);
    } catch (error) {
      found = { candidates: {}, extra: {}, error: error.message };
    }

    const save = () =>
      writeFileSync(join(FOUND, `${entry.id}.json`), JSON.stringify(found, null, 1));

    if (!fetchedOnly && found.header === 'NE') {
      const exe = join(folder, found.program);
      const run = runFor(exe, folder).then((result) => {
        applyRun(found, { mode: result.mode, stopped: result.stopped, windows: result.windows });
        save();
        running.delete(run);
      });

      running.add(run);

      if (running.size >= PARALLEL) {
        await Promise.race(running);
      }
    } else {
      /* Read again without a run: the last run's windows kept. */
      const last = foundOf(entry.id)?.run;

      if (last) {
        applyRun(found, last);
      }

      save();
    }

    if (index % 25 === 24) {
      console.error(
        `${index + 1} of ${chosen.length}, ${fetchedBytes} bytes, ${Math.round((Date.now() - started) / 1000)} s`
      );
    }
  }

  await Promise.all(running);
  console.error(
    `done: ${fetchedBytes} bytes fetched in ${Math.round((Date.now() - started) / 1000)} s`
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
