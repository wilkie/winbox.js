/**
 * Files made, written and taken away: INT 21h functions 3Ch (create), 5Bh
 * (create new), 40h (write), 41h (delete), 56h (rename), 43h (attributes),
 * and directories made and taken away, 39h and 3Ah.
 *
 * DOS as it is documented, underneath Windows; nothing here has been
 * measured. A path is taken from the drive's current directory when it does
 * not begin at the root, as the other calls take it (`directory.ts`).
 */

import { openDirectory, resolveDirectory } from './directory.js';

const ERROR_PATH_NOT_FOUND = 0x03;
const ERROR_INVALID_HANDLE = 0x06;
const ERROR_FILE_NOT_FOUND = 0x02;
const ERROR_ACCESS_DENIED = 0x05;
const ERROR_FILE_EXISTS = 0x50;
const ERROR_CURRENT_DIRECTORY = 0x10;
const ERROR_NOT_SAME_DEVICE = 0x11;

/** The attributes a program may set: read-only, hidden, system and archive. */
const SETTABLE = 0x27;

/** A path taken apart: its drive, its directory's parts and its name. */
export function resolveFile(dos: any, path: string) {
  const slash = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'), path.indexOf(':'));
  const { drive, parts } = resolveDirectory(dos, path.substring(0, slash + 1));

  return { drive, parts, name: path.substring(slash + 1).toUpperCase() };
}

/** The whole path of a file, as the file manager opens it. */
function fullPath(drive: string, parts: string[], name: string) {
  return `${drive}:\\${[...parts, name].join('\\')}`;
}

/** Whether a file is there. */
async function exists(dos: any, drive: string, parts: string[], name: string) {
  const folder = await openDirectory(dos, drive, parts);

  return folder ? !!(await folder.lookup(name)) : false;
}

async function make(dos: any, path: string, fresh: boolean) {
  const { drive, parts, name } = resolveFile(dos, path);

  if (!name || !(await openDirectory(dos, drive, parts))) {
    throw ERROR_PATH_NOT_FOUND;
  }

  if (fresh && (await exists(dos, drive, parts, name))) {
    throw ERROR_FILE_EXISTS;
  }

  const handle = await dos.files.create(fullPath(drive, parts, name));

  if (handle === null || handle === undefined) {
    throw ERROR_ACCESS_DENIED;
  }

  return handle;
}

/** Creates a file (3Ch), emptying one that is there; answers its handle. */
export function createFile(this: any, path: string, _attributes: number) {
  return make(this, path, false);
}

/** Creates a file that is not there yet (5Bh): error 50h when it is. */
export function createNewFile(this: any, path: string, _attributes: number) {
  return make(this, path, true);
}

/** Writes to a file (40h) at its position; answers how much was written. */
export async function writeFile(this: any, handle: number, address: number, count: number) {
  const file = this.files.resolve(handle);

  if (!file) {
    throw ERROR_INVALID_HANDLE;
  }

  const bytes = new Uint8Array(count);

  for (let i = 0; i < count; i++) {
    bytes[i] = this.machine.memory.read8(address + i);
  }

  const written = count ? await file.write(file.position, bytes) : 0;

  file.position += written;

  return written;
}

/** Deletes a file (41h). */
export async function deleteFile(this: any, path: string) {
  const { drive, parts, name } = resolveFile(this, path);
  const folder = await openDirectory(this, drive, parts);

  if (!folder) {
    throw ERROR_PATH_NOT_FOUND;
  }

  const fileSystem = this.files.query(drive);

  if (!(await folder.lookup(name)) || !(await fileSystem.unlink(folder, name))) {
    throw ERROR_FILE_NOT_FOUND;
  }
}

/** Makes a directory (39h): error 3 when its parent is not there, 5 when the name is. */
export async function makeDirectory(this: any, path: string) {
  const { drive, parts, name } = resolveFile(this, path);
  const parent = await openDirectory(this, drive, parts);

  if (!name || !parent) {
    throw ERROR_PATH_NOT_FOUND;
  }

  if (await parent.lookup(name)) {
    throw ERROR_ACCESS_DENIED;
  }

  await this.files.query(drive).makeDirectory(parent, name);
}

/**
 * Takes a directory away (3Ah): one that holds nothing but `.` and `..`,
 * and is not a drive's current directory.
 */
export async function removeDirectory(this: any, path: string) {
  const { drive, parts, name } = resolveFile(this, path);
  const parent = await openDirectory(this, drive, parts);
  const entry = parent && name ? await parent.lookup(name) : null;

  if (!entry || !entry.info.directory) {
    throw ERROR_PATH_NOT_FOUND;
  }

  const current = this.files._pwd?.[drive];

  if (current && current.toUpperCase() === fullPath(drive, parts, name)) {
    throw ERROR_CURRENT_DIRECTORY;
  }

  const held = (await entry.list()).filter(
    (one: any) => one.info.name !== '.' && one.info.name !== '..'
  );

  if (held.length) {
    throw ERROR_ACCESS_DENIED;
  }

  await this.files.query(drive).unlink(parent, name);
}

/**
 * A file's attributes (43h): asked (AL nought), answered in CX; or set (AL
 * 1) from CX. A directory's or a volume label's bit cannot be set.
 */
export async function fileAttributes(this: any, path: string, action: number, attributes: number) {
  const { drive, parts, name } = resolveFile(this, path);
  const parent = await openDirectory(this, drive, parts);
  const entry = parent && name ? await parent.lookup(name) : null;

  if (!parent) {
    throw ERROR_PATH_NOT_FOUND;
  }

  if (!entry) {
    throw ERROR_FILE_NOT_FOUND;
  }

  if (action === 0) {
    return entry.info.attributes;
  }

  if (attributes & ~SETTABLE) {
    throw ERROR_ACCESS_DENIED;
  }

  await parent.write8(entry.info.entryOffset + 11, (entry.info.attributes & 0x10) | attributes);

  return attributes;
}

/**
 * Renames a file (56h), to another name on the same drive, in the same
 * directory or another. A directory keeps its parent. The new name must not
 * be there.
 */
export async function renameFile(this: any, from: string, to: string) {
  const source = resolveFile(this, from);
  const target = resolveFile(this, to);
  const fromFolder = await openDirectory(this, source.drive, source.parts);
  const entry = fromFolder && source.name ? await fromFolder.lookup(source.name) : null;

  if (!fromFolder || !entry) {
    throw ERROR_FILE_NOT_FOUND;
  }

  if (source.drive !== target.drive) {
    throw ERROR_NOT_SAME_DEVICE;
  }

  const toFolder = await openDirectory(this, target.drive, target.parts);

  if (!toFolder || !target.name) {
    throw ERROR_PATH_NOT_FOUND;
  }

  const moved = source.parts.join('\\') !== target.parts.join('\\');

  if ((await toFolder.lookup(target.name)) || (entry.info.directory && moved)) {
    throw ERROR_ACCESS_DENIED;
  }

  await this.files.query(source.drive).rename(fromFolder, entry, toFolder, target.name);
}
