/**
 * Files made, written and taken away: INT 21h functions 3Ch (create), 5Bh
 * (create new), 40h (write) and 41h (delete).
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
