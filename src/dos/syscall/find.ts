/**
 * The directory search: INT 21h functions 4Eh and 4Fh, and the disk transfer
 * area they answer into, set by 1Ah and read back by 2Fh.
 *
 * A search is a file name that may hold wildcards, the last part of a path,
 * and a set of attributes. The first call finds the first entry that matches;
 * each next call carries on from there, until DOS answers "no more files",
 * error 12h. The answer goes to the disk transfer area as a 43-byte record:
 *
 * | Offset | Size | What                                          |
 * |--------|------|-----------------------------------------------|
 * | 00h    | 21   | DOS's own: what the next call carries on from |
 * | 15h    | 1    | The attribute byte                            |
 * | 16h    | 2    | The time, as the directory entry holds it     |
 * | 18h    | 2    | The date, as the directory entry holds it     |
 * | 1Ah    | 4    | The size                                      |
 * | 1Eh    | 13   | The name, `NAME.EXT` and a null               |
 *
 * The first 21 bytes here hold the drive, the name as eleven characters
 * with each `*` spread into `?`s, the attributes, and the search's number.
 * DOS keeps the rest, as DOSBox does: the folder, and the names it held as
 * the search began, in the order DOSBox lists a host's folder (`listed`).
 * Each next call looks for the next of those names in the folder as it is
 * now: a file made while a search is open is not found by it, and one
 * deleted is passed over (`DOS_Drive_Cache::FindFirst`, `drive_cache.cpp`
 * 777-826; `localDrive::FindNext`, `drive_local.cpp` 231-280). **Recorded**
 * by `dirorder`. As `dos.rs`.
 *
 * Which entries a search finds goes by the attributes asked for: ordinary
 * files always, and hidden, system and directory entries only when their bit
 * is asked for. The volume label is found only by a search asking for it
 * alone.
 *
 * COMMDLG lists the files for its Open dialog this way, and File Manager
 * its directories.
 */

import { stampOf } from '../../file-systems/fat16.js';
import { segmentSelector } from '../../win16/selectors.js';
import { openDirectory, resolveDirectory } from './directory.js';

const ERROR_PATH_NOT_FOUND = 0x03;
const ERROR_NO_MORE_FILES = 0x12;

const ATTRIBUTE_HIDDEN = 0x02;
const ATTRIBUTE_SYSTEM = 0x04;
const ATTRIBUTE_VOLUME = 0x08;
const ATTRIBUTE_DIRECTORY = 0x10;

/** The most searches open at once: DOSBox's `MAX_OPENDIRS` (`dos_system.h` 124). */
const MAX_SEARCHES = 2048;

interface Search {
  drive: string;
  parts: string[];
  names: string[];
  at: number;
}

/**
 * DOS's searches, by the number a record keeps, as DOSBox keeps them: each
 * begun in the next number free after the last, round from the first, and
 * freed once it is over; with none free, all are let go and the first is
 * taken (`drive_cache.cpp` 783-805).
 */
function searches(dos: any): { open: (Search | null)[]; next: number } {
  if (!dos._searches) {
    dos._searches = { open: new Array(MAX_SEARCHES).fill(null), next: 0 };
  }

  return dos._searches;
}

function begin(dos: any, search: Search) {
  const all = searches(dos);
  let tried = 0;

  while (tried < MAX_SEARCHES && all.open[all.next]) {
    all.next = (all.next + 1) % MAX_SEARCHES;
    tried++;
  }

  let number = all.next;

  all.next = (all.next + 1) % MAX_SEARCHES;

  if (tried === MAX_SEARCHES) {
    all.open.fill(null);
    number = 0;
    all.next = 1;
  }

  all.open[number] = search;

  return number;
}

/** Names compared byte by byte, as DOSBox's `strcmp`. */
function byBytes(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * A folder's entries as DOSBox lists a folder of the host's: `.` and `..`
 * in every folder, the root's too, `.` with the folder's own stamp and `..`
 * with the one above's; folders first, then files, each by its name byte by
 * byte (`drive_cache.cpp` 52-56, `SortByDirName`, the order
 * `DIRALPHABETICAL` its constructor sets at 71, 82). A name starting with a
 * byte below `.`, `!D`, comes before `.`. **Recorded** by `dirorder`. As
 * `files.rs`'s `list`.
 */
export async function listed(dos: any, drive: string, parts: string[], folder: any) {
  /* A disk image's folder as the image keeps it: its entries in the order
   * of their slots, `.` and `..` only where it has them, none in the root
   * (`fatDrive::FindNextInternal`, `drive_fat.cpp` 898-960). **Recorded**
   * by `imgflop` and `imghdd`. As `files.rs`'s `Listing::AsStored`. */
  if (stored(dos, drive)) {
    return (await folder.list()).map((entry: any) => entry.info);
  }

  return [...(await held(folder)), ...(await dots(dos, drive, parts, folder))].sort(
    (a: any, b: any) =>
      ((b.attributes ?? 0) & ATTRIBUTE_DIRECTORY) - ((a.attributes ?? 0) & ATTRIBUTE_DIRECTORY) ||
      byBytes(String(a.name), String(b.name))
  );
}

/** Whether a drive lists its folders as a disk image keeps them. */
function stored(dos: any, drive: string) {
  return dos.files.query(drive)?.listing === 'stored';
}

/** What a folder holds, less the `.` and `..` a FAT folder keeps. */
async function held(folder: any) {
  return (await folder.list())
    .map((entry: any) => entry.info)
    .filter((info: any) => info.name !== '.' && info.name !== '..');
}

/** A folder's `.`, with its own stamp, and `..`, with the one above's. */
async function dots(dos: any, drive: string, parts: string[], folder: any) {
  const rootStamp = dos.files.query(drive)?.rootStamp ?? stampOf();
  const own = parts.length ? folder.info : rootStamp;
  let above = rootStamp;

  if (parts.length > 1) {
    above = (await openDirectory(dos, drive, parts.slice(0, -1)))?.info ?? own;
  } else if (!parts.length) {
    above = own;
  }

  return [
    ['.', own],
    ['..', above],
  ].map(([name, stamp]) => ({
    name,
    attributes: ATTRIBUTE_DIRECTORY,
    directory: true,
    size: 0,
    time: stamp.time,
    date: stamp.date,
  }));
}

/**
 * The disk transfer area. KERNEL keeps one for each task, starting at 80h in
 * the task's program segment prefix, as DOS starts a program's; File Manager
 * searches without setting its own.
 */
function transferArea(dos: any): [number, number] {
  const task = dos.currentTask?.();

  if (task) {
    return task.dta ?? [segmentSelector(task.programSegment), 0x80];
  }

  return dos._dta ?? [0, 0x80];
}

/** Sets the disk transfer area (1Ah), the running task's. */
export function setTransferArea(this: any, segment: number, offset: number) {
  const task = this.currentTask?.();

  if (task) {
    task.dta = [segment, offset];
  } else {
    this._dta = [segment, offset];
  }
}

/** Returns the disk transfer area (2Fh), to ES:BX. */
export function getTransferArea(this: any) {
  return transferArea(this);
}

/** The eleven characters a name part is matched in: each `*` spread into `?`s. */
function elevenOf(name: string) {
  const dot = name.indexOf('.');
  const base = dot >= 0 ? name.substring(0, dot) : name;
  const extension = dot >= 0 ? name.substring(dot + 1) : '';

  const field = (part: string, width: number) => {
    let out = '';

    for (const character of part.toUpperCase()) {
      if (out.length >= width) {
        break;
      }

      if (character === '*') {
        return out.padEnd(width, '?');
      }

      out += character;
    }

    return out.padEnd(width, ' ');
  };

  return field(base, 8) + field(extension, 3);
}

/** Whether a name, as eleven characters, is one the pattern takes. */
function matches(pattern: string, name: string) {
  // '.' and '..' are not split at their dots.
  const eleven = name === '.' || name === '..' ? name.padEnd(11, ' ') : elevenOf(name);

  for (let i = 0; i < 11; i++) {
    if (pattern[i] !== '?' && pattern[i] !== eleven[i]) {
      return false;
    }
  }

  return true;
}

/** Whether the attributes asked for take an entry with these. */
function admits(asked: number, attributes: number) {
  if (asked === ATTRIBUTE_VOLUME) {
    return (attributes & ATTRIBUTE_VOLUME) !== 0;
  }

  if (attributes & ATTRIBUTE_VOLUME) {
    return false;
  }

  const special = attributes & (ATTRIBUTE_HIDDEN | ATTRIBUTE_SYSTEM | ATTRIBUTE_DIRECTORY);

  return (special & ~asked) === 0;
}

/**
 * Splits a search into its drive, the directory as its parts from the root,
 * and the name to match.
 */
function split(dos: any, spec: string) {
  const slash = Math.max(spec.lastIndexOf('\\'), spec.lastIndexOf('/'), spec.indexOf(':'));
  const name = spec.substring(slash + 1);
  const { drive, parts } = resolveDirectory(dos, spec.substring(0, slash + 1));

  return { drive, parts, name };
}

/** Writes the record for an entry into the disk transfer area. */
function answer(dos: any, state: Uint8Array, info: any) {
  const [segment, offset] = transferArea(dos);
  const record = new Uint8Array(43);
  const view = new DataView(record.buffer);

  record.set(state, 0);

  view.setUint8(0x15, info.attributes ?? 0);
  view.setUint16(
    0x16,
    (info.time.hour << 11) | (info.time.minute << 5) | (info.time.second >> 1),
    true
  );
  view.setUint16(
    0x18,
    ((info.date.year - 1980) << 9) | (info.date.month << 5) | info.date.day,
    true
  );
  view.setUint32(0x1a, info.size >>> 0, true);

  const name = String(info.name).toUpperCase().substring(0, 12);

  for (let i = 0; i < name.length; i++) {
    record[0x1e + i] = name.charCodeAt(i) & 0xff;
  }

  const address = dos.machine.cpu.core.translateAddress(segment, offset);
  dos.machine.memory.write(address, view);
}

/** Reads DOS's own part of the record back out of the disk transfer area. */
function stateOf(dos: any) {
  const [segment, offset] = transferArea(dos);
  const address = dos.machine.cpu.core.translateAddress(segment, offset);
  const state = new Uint8Array(21);

  for (let i = 0; i < 21; i++) {
    state[i] = dos.machine.memory.read8(address + i);
  }

  return state;
}

/**
 * Carries a search on through the names it began with: each that matches
 * looked for again as the folder is now, one gone passed over. Its last
 * name passed, the search is over, and "no more files".
 */
async function carryOn(dos: any, state: Uint8Array) {
  const view = new DataView(state.buffer);
  const pattern = String.fromCharCode(...state.subarray(1, 12));
  const asked = state[12];
  const number = view.getUint16(13, true);
  const all = searches(dos);
  const search = all.open[number];

  if (!search) {
    throw ERROR_NO_MORE_FILES;
  }

  /* The folder as it is now; its `.` and `..` made only when a search
   * comes to them, which takes looking at the folder above. */
  const folder = await openDirectory(dos, search.drive, search.parts);
  const asStored = stored(dos, search.drive);
  const entries = folder
    ? asStored
      ? await listed(dos, search.drive, search.parts, folder)
      : await held(folder)
    : [];
  const now = new Map(entries.map((info: any) => [info.name, info]));

  const lookup = async (name: string) => {
    if (folder && !asStored && (name === '.' || name === '..')) {
      return (await dots(dos, search.drive, search.parts, folder))[name === '.' ? 0 : 1];
    }

    return now.get(name);
  };

  while (search.at < search.names.length) {
    const name = search.names[search.at++];

    if (!matches(pattern, name)) {
      continue;
    }

    const info: any = await lookup(name);

    if (info && admits(asked, info.attributes ?? 0)) {
      answer(dos, state, info);

      return;
    }
  }

  all.open[number] = null;

  throw ERROR_NO_MORE_FILES;
}

/**
 * A disk image's search carried on from the slot its record keeps, the
 * folder read again as it is now, as DOSBox's `FindNextInternal` reads it
 * (`drive_fat.cpp` 898-960): an entry made in a slot it has not come to is
 * found, one made in a slot it has passed is not, and one deleted is passed
 * over. The pattern is the record's eleven characters, a dot between, as
 * `GetSearchParams` makes it. The slot it has come to is kept in the
 * record, the word at 0Dh, whether anything is found or not; the folder's
 * cluster is the word at 0Fh (`sDTA`'s `dirID` and `dirCluster`). As
 * `dos.rs`'s `carry_on_image`.
 */
function carryOnImage(dos: any, state: Uint8Array) {
  const view = new DataView(state.buffer);
  const fileSystem = dos.files.query(String.fromCharCode(state[0] + 0x40));
  const pattern =
    String.fromCharCode(...state.subarray(1, 9)) +
    '.' +
    String.fromCharCode(...state.subarray(9, 12));
  const [info, at] = fileSystem.findFrom(
    view.getUint16(15, true),
    state[12],
    pattern,
    view.getUint16(13, true)
  );

  view.setUint16(13, at, true);

  if (info) {
    answer(dos, state, info);

    return;
  }

  const [segment, offset] = transferArea(dos);
  const address = dos.machine.cpu.core.translateAddress(segment, offset);

  dos.machine.memory.write(address, new DataView(state.buffer));

  throw ERROR_NO_MORE_FILES;
}

/** Finds the first entry a search takes (4Eh). */
export async function findFirst(this: any, spec: string, attributes: number) {
  const { drive, parts, name } = split(this, spec);
  const state = new Uint8Array(21);
  const view = new DataView(state.buffer);
  const pattern = elevenOf(name === '' ? '*.*' : name);

  state[0] = drive.charCodeAt(0) - 0x40;

  for (let i = 0; i < 11; i++) {
    state[1 + i] = pattern.charCodeAt(i);
  }

  state[12] = attributes & 0xff;

  /* A disk image's search, as DOSBox's `fatDrive::FindFirst` begins it
   * (857-878): the label alone asked for, none -- no more files; else from
   * the folder's first slot. */
  if (stored(this, drive)) {
    if (state[12] === ATTRIBUTE_VOLUME) {
      throw ERROR_NO_MORE_FILES;
    }

    const folder = this.files.query(drive).searchFolder(parts);

    if (folder === null) {
      throw ERROR_PATH_NOT_FOUND;
    }

    view.setUint16(15, folder & 0xffff, true);
    carryOnImage(this, state);

    return;
  }

  const folder = await openDirectory(this, drive, parts);

  if (!folder) {
    throw ERROR_PATH_NOT_FOUND;
  }

  const names = (await listed(this, drive, parts, folder)).map((info: any) => info.name);
  const number = begin(this, { drive, parts, names, at: 0 });

  view.setUint16(13, number, true);

  await carryOn(this, state);
}

/** Finds the next entry a search takes (4Fh), from the record left by the last. */
export async function findNext(this: any) {
  const state = stateOf(this);

  if (state[0] >= 1 && state[0] <= 26 && stored(this, String.fromCharCode(state[0] + 0x40))) {
    carryOnImage(this, state);

    return;
  }

  await carryOn(this, state);
}

/** The current drive (19h), 0 for A:. */
export function getCurrentDisk(this: any) {
  return this.files.drive.charCodeAt(0) - 0x41;
}

/**
 * Every entry a search finds, in the order the calls above would find them,
 * for a caller in winbox.js itself rather than a program: `null` when the
 * directory is not there.
 */
export async function searchDirectory(dos: any, spec: string, attributes: number) {
  const { drive, parts, name } = split(dos, spec);
  const folder = await openDirectory(dos, drive, parts);

  if (!folder) {
    return null;
  }

  const pattern = elevenOf(name === '' ? '*.*' : name);
  const entries = await listed(dos, drive, parts, folder);

  return entries.filter(
    (info: any) => admits(attributes & 0xff, info.attributes ?? 0) && matches(pattern, info.name)
  );
}
