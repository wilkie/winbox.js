/**
 * Files made, written and taken away: INT 21h functions 3Ch (create), 5Bh
 * (create new), 40h (write), 41h (delete), 56h (rename), 43h (attributes),
 * and directories made and taken away, 39h and 3Ah.
 *
 * DOS as it is documented, underneath Windows, and as DOSBox answers where
 * `dirorder` measured it: renaming, removing a directory, and the stamps
 * of a folder and of a file written nought bytes. A path is taken from the drive's current directory when it does
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

/** Whether a drive is a disk image's, which DOSBox's `fatDrive` answers for (`FATImage`). */
function image(dos: any, drive: string) {
  return dos.files.query(drive)?.listing === 'stored';
}

async function make(dos: any, path: string, fresh: boolean, attributes = 0) {
  const { drive, parts, name } = resolveFile(dos, path);

  if (!name || !(await openDirectory(dos, drive, parts))) {
    throw ERROR_PATH_NOT_FOUND;
  }

  if (fresh && (await exists(dos, drive, parts, name))) {
    throw ERROR_FILE_EXISTS;
  }

  const handle = await dos.files.create(fullPath(drive, parts, name), attributes & 0xff);

  /* On a disk image, as DOSBox's `DOS_CreateFile` answers a `FileCreate`
   * that fails, its folder there (`dos_files.cpp` 501-504). As `dos.rs`. */
  if (handle === null || handle === undefined) {
    throw image(dos, drive) ? ERROR_FILE_NOT_FOUND : ERROR_ACCESS_DENIED;
  }

  return handle;
}

/** Creates a file (3Ch), emptying one that is there; answers its handle. */
export function createFile(this: any, path: string, attributes: number) {
  return make(this, path, false, attributes);
}

/** Creates a file that is not there yet (5Bh): error 50h when it is. */
export function createNewFile(this: any, path: string, attributes: number) {
  return make(this, path, true, attributes);
}

/** Writes to a file (40h) at its position; answers how much was written. */
export async function writeFile(this: any, handle: number, address: number, count: number) {
  const file = this.files.resolve(handle);

  if (!file) {
    throw ERROR_INVALID_HANDLE;
  }

  /* A disk image's file opened to read alone (`fatFile::Write`,
   * `drive_fat.cpp` 163-166). */
  if (file.refusesWrite?.()) {
    throw ERROR_ACCESS_DENIED;
  }

  /* Nought bytes make the file end where it is, and stamp it (`end`). As
   * `dos.rs`. */
  if (!count) {
    await file.end?.(file.position);

    return 0;
  }

  const bytes = new Uint8Array(count);

  for (let i = 0; i < count; i++) {
    bytes[i] = this.machine.memory.read8(address + i);
  }

  const written = await file.write(file.position, bytes);

  file.position += written;

  return written;
}

/** Deletes a file (41h). */
export async function deleteFile(this: any, path: string) {
  const { drive, parts, name } = resolveFile(this, path);

  /* A disk image's file deleted as DOSBox's `DOS_UnlinkFile` deletes it:
   * its `FileUnlink` asked, file not found where it will not
   * (`dos_files.cpp` 621-630) -- a folder, or a path not there. As
   * `dos.rs`. */
  if (image(this, drive)) {
    if (!this.files.query(drive).drive.fileUnlink([...parts, name])) {
      throw ERROR_FILE_NOT_FOUND;
    }

    return;
  }
  const folder = await openDirectory(this, drive, parts);

  if (!folder) {
    throw ERROR_PATH_NOT_FOUND;
  }

  const fileSystem = this.files.query(drive);

  if (!(await folder.lookup(name)) || !(await fileSystem.unlink(folder, name))) {
    throw ERROR_FILE_NOT_FOUND;
  }

  await this.files.changed(drive, parts);
}

/** Makes a directory (39h): error 3 when its parent is not there, 5 when the name is. */
export async function makeDirectory(this: any, path: string) {
  const { drive, parts, name } = resolveFile(this, path);

  /* A disk image's folder made as DOSBox's `DOS_MakeDir` makes it
   * (`dos_files.cpp` 217-233): its `MakeDir` asked first, whatever is
   * there, and why it failed told after -- the folder there, access
   * denied; else path not found. As `dos.rs`. */
  if (image(this, drive) && name) {
    const fileSystem = this.files.query(drive);

    if (fileSystem.drive.makeDir([...parts, name])) {
      return;
    }

    throw fileSystem.searchFolder([...parts, name]) !== null
      ? ERROR_ACCESS_DENIED
      : ERROR_PATH_NOT_FOUND;
  }
  const parent = await openDirectory(this, drive, parts);

  if (!name || !parent) {
    throw ERROR_PATH_NOT_FOUND;
  }

  if (await parent.lookup(name)) {
    throw ERROR_ACCESS_DENIED;
  }

  await this.files.query(drive).makeDirectory(parent, name);
  await this.files.changed(drive, parts);
}

/**
 * Takes a directory away (3Ah): one that holds nothing but `.` and `..`,
 * and is not a drive's current directory.
 */
export async function removeDirectory(this: any, path: string) {
  const { drive, parts, name } = resolveFile(this, path);

  /* A disk image's folder removed as DOSBox's `DOS_RemoveDir` removes it
   * (`dos_files.cpp` 235-261): one a search for folders does not find,
   * path not found; the current one, 10h; one its `RemoveDir` will not
   * remove, access denied. As `dos.rs`. */
  if (image(this, drive) && name) {
    const fileSystem = this.files.query(drive);

    if (fileSystem.searchFolder([...parts, name]) === null) {
      throw ERROR_PATH_NOT_FOUND;
    }

    const current = this.files._pwd?.[drive];

    if (current && current.toUpperCase() === `${fullPath(drive, parts, name)}\\`) {
      throw ERROR_CURRENT_DIRECTORY;
    }

    if (!fileSystem.drive.removeDir([...parts, name])) {
      throw ERROR_ACCESS_DENIED;
    }

    return;
  }
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

  /* A drive that will not let it go: error 5, as the Rust engine's
   * answers. A disk image's folder is DOSBox's `RemoveDir`'s to delete,
   * not `FileUnlink`'s. */
  const fileSystem = this.files.query(drive);

  if (!(await (fileSystem.removeDirectory ?? fileSystem.unlink).call(fileSystem, parent, name))) {
    throw ERROR_ACCESS_DENIED;
  }

  await this.files.changed(drive, parts);
}

/**
 * A file's attributes (43h): asked (AL nought), answered in CX; or set (AL
 * 1) from CX. A directory's or a volume label's bit cannot be set.
 */
export async function fileAttributes(this: any, path: string, action: number, attributes: number) {
  const { drive, parts, name } = resolveFile(this, path);
  const fileSystem = this.files.query(drive);

  /* A disk image's found as DOSBox's `GetFileAttr` finds them -- where it
   * finds none, its folder not there among them, error 2
   * (`DOS_GetFileAttr`, `dos_files.cpp` 632-641) -- and set as its
   * `DOS_SetFileAttr` sets them: not at all, the file only looked for
   * (643-656). As `dos.rs`. */
  if (fileSystem?.listing === 'stored') {
    const found = fileSystem.attributes([...parts, name]);

    if (found === null) {
      throw ERROR_FILE_NOT_FOUND;
    }

    return action === 0 ? found : attributes;
  }
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
 * Renames a file or folder (56h), or moves it to another folder, as
 * DOSBox's `DOS_Rename` renames one (`dos_files.cpp` 263-296): another
 * drive is error 11h; a name there already, file or folder, 5; nothing to
 * rename, 2; and a rename the host refuses -- into a folder not there, a
 * folder into itself -- 2 as well. A folder moves with all it holds, its
 * stamp kept. **Recorded** by `dirorder`. As `dos.rs`.
 */
export async function renameFile(this: any, from: string, to: string) {
  const source = resolveFile(this, from);
  const target = resolveFile(this, to);

  /* On a disk image, as `DOS_Rename` asks its drive: the name there, file
   * or folder, access denied; nothing to rename, or a rename
   * `fatDrive::Rename` will not make -- a folder's -- file not found. As
   * `dos.rs`. */
  if (source.drive === target.drive && image(this, source.drive)) {
    const fileSystem = this.files.query(source.drive);

    if (fileSystem.attributes([...target.parts, target.name]) !== null) {
      throw ERROR_ACCESS_DENIED;
    }

    if (
      fileSystem.attributes([...source.parts, source.name]) === null ||
      !fileSystem.drive.rename([...source.parts, source.name], [...target.parts, target.name])
    ) {
      throw ERROR_FILE_NOT_FOUND;
    }

    return;
  }

  if (source.drive !== target.drive) {
    throw ERROR_NOT_SAME_DEVICE;
  }

  const toFolder = await openDirectory(this, target.drive, target.parts);

  if (toFolder && target.name && (await toFolder.lookup(target.name))) {
    throw ERROR_ACCESS_DENIED;
  }

  const fromFolder = await openDirectory(this, source.drive, source.parts);
  const entry = fromFolder && source.name ? await fromFolder.lookup(source.name) : null;

  if (!entry) {
    throw ERROR_FILE_NOT_FOUND;
  }

  const path = [...source.parts, source.name];
  const intoItself =
    entry.info.directory &&
    target.parts.length >= path.length &&
    path.every((part, at) => part === target.parts[at]);

  if (!toFolder || !target.name || intoItself) {
    throw ERROR_FILE_NOT_FOUND;
  }

  await this.files.query(source.drive).rename(fromFolder, entry, toFolder, target.name);
  await this.files.changed(source.drive, source.parts);
  await this.files.changed(target.drive, target.parts);
}

/**
 * When a file open was last written (5700h): the time in CX and the date in
 * DX, as its directory's entry holds them. A handle that names no file on a
 * disk is error 6. `OpenFile` keeps the two in its structure (`openfile`).
 */
export async function fileStamp(this: any, handle: number) {
  const file = this.files.resolve(handle);

  if (!file || file.mount === undefined || file.path === undefined) {
    throw ERROR_INVALID_HANDLE;
  }

  /* A disk image's file keeps its entry's creation stamp as it was opened
   * (`FileOpen`, `drive_fat.cpp` 832-834). */
  if (file.dosStamp) {
    return file.dosStamp;
  }

  const { drive, parts, name } = resolveFile(this, `${file.mount}:${file.path}`);
  const folder = await openDirectory(this, drive, parts);
  const entry = folder && name ? await folder.lookup(name) : null;

  if (!entry?.info?.time || !entry.info.date) {
    throw ERROR_INVALID_HANDLE;
  }

  const { time, date } = entry.info;

  return [
    (time.hour << 11) | (time.minute << 5) | (time.second >> 1),
    ((date.year - 1980) << 9) | (date.month << 5) | date.day,
  ];
}

/**
 * When a file open was last written, set (5701h): DOSBox says it set it
 * and does nothing, whatever the handle -- "DOS:57:Set File Date Time
 * Faked" (`dos.cpp`) -- the file keeping the host's stamp. As `dos.rs`.
 * LZEXPAND's `LZCopy` sets its copy's so (`lzfiles`).
 */
export async function setFileStamp(this: any, _handle: number) {}
