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
 * The next call needs nothing but the record, which is what lets a program
 * keep several searches going in several records. The first 21 bytes here
 * hold the drive, the name as eleven characters with each `*` spread into
 * `?`s, the attributes, how far through the directory the search has gone,
 * and which directory it is.
 *
 * Which entries a search finds goes by the attributes asked for: ordinary
 * files always, and hidden, system and directory entries only when their bit
 * is asked for. The volume label is found only by a search asking for it
 * alone.
 *
 * This is DOS as it is documented, underneath Windows: nothing here has been
 * measured. COMMDLG lists the files for its Open dialog this way, and File
 * Manager its directories.
 */

import { segmentSelector } from '../../win16/selectors.js';
import { openDirectory, resolveDirectory } from './directory.js';

const ERROR_PATH_NOT_FOUND = 0x03;
const ERROR_NO_MORE_FILES = 0x12;

const ATTRIBUTE_HIDDEN = 0x02;
const ATTRIBUTE_SYSTEM = 0x04;
const ATTRIBUTE_VOLUME = 0x08;
const ATTRIBUTE_DIRECTORY = 0x10;

/** The directories searched so far, which a record names by their place here. */
function searchedDirectories(dos: any): string[] {
  if (!dos._searched) {
    dos._searched = [];
  }

  return dos._searched;
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
 * Carries a search on from the entry at `from`, answering with the first
 * that matches, or failing with "no more files".
 */
async function carryOn(dos: any, state: Uint8Array) {
  const view = new DataView(state.buffer);
  const drive = String.fromCharCode(state[0] + 0x40);
  const pattern = String.fromCharCode(...state.subarray(1, 12));
  const asked = state[12];
  const from = view.getUint16(13, true);
  const directory = searchedDirectories(dos)[view.getUint16(15, true)];

  const fileSystem = dos.files.query(drive);
  const parts = directory === '' ? [] : directory.split('\\');
  const folder = fileSystem ? await fileSystem.open(parts) : null;
  const entries = folder?.list ? await folder.list() : [];

  for (let at = from; at < entries.length; at++) {
    const info = entries[at].info;

    if (admits(asked, info.attributes ?? 0) && matches(pattern, info.name)) {
      view.setUint16(13, at + 1, true);
      answer(dos, state, info);

      return;
    }
  }

  view.setUint16(13, entries.length, true);

  throw ERROR_NO_MORE_FILES;
}

/** Finds the first entry a search takes (4Eh). */
export async function findFirst(this: any, spec: string, attributes: number) {
  const { drive, parts, name } = split(this, spec);
  const folder = await openDirectory(this, drive, parts);

  if (!folder) {
    throw ERROR_PATH_NOT_FOUND;
  }

  const searched = searchedDirectories(this);
  const directory = parts.join('\\');
  let index = searched.indexOf(directory);

  if (index < 0) {
    index = searched.push(directory) - 1;
  }

  const state = new Uint8Array(21);
  const view = new DataView(state.buffer);
  const pattern = elevenOf(name === '' ? '*.*' : name);

  state[0] = drive.charCodeAt(0) - 0x40;

  for (let i = 0; i < 11; i++) {
    state[1 + i] = pattern.charCodeAt(i);
  }

  state[12] = attributes & 0xff;
  view.setUint16(13, 0, true);
  view.setUint16(15, index, true);

  await carryOn(this, state);
}

/** Finds the next entry a search takes (4Fh), from the record left by the last. */
export async function findNext(this: any) {
  await carryOn(this, stateOf(this));
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
  const entries = await folder.list();

  return entries
    .map((entry: any) => entry.info)
    .filter((info: any) => admits(attributes & 0xff, info.attributes ?? 0) && matches(pattern, info.name));
}
