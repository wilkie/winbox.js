import { openDirectory, refusedName } from './directory.js';
import { resolveFile } from './files.js';

/**
 * A file opened as DOSBox's `DOS_OpenFile` opens one (`dos_files.cpp`
 * 509-570), in a mode, AL of 3Dh: its handle, or DOS's error. On a disc,
 * `isoDrive::FileOpen` refuses a file opened to write alone (`drive_iso.cpp`
 * 204-208). As `dos.rs`'s `open_path`.
 */
export async function open(path, access) {
  const target = resolveFile(this, path);
  const fileSystem = this.files.query(target.drive);
  const stored = fileSystem?.listing === 'stored';

  /* A folder or a label on a disk image is not opened: access denied
   * (`DOS_OpenFile`, `dos_files.cpp` 517-523). As `dos.rs`. */
  if (
    stored &&
    makesName(this, path) &&
    (fileSystem.attributes([...target.parts, target.name]) ?? 0) & 0x18
  ) {
    throw 0x5; // ACCESS_DENIED
  }

  refusedName(this, path);

  const refused = fileSystem?.removable && fileSystem?.remote && (access & 0x0f) === 1;
  /* On an image, the name `DOS_MakeName` made, as the drive's `FileOpen`
   * is given it. */
  const handle = refused
    ? null
    : await this.files.open(
        stored ? `${target.drive}:\\${[...target.parts, target.name].join('\\')}` : path
      );
  const file = handle === null ? null : this.files.resolve(handle);

  if (!file) {
    throw await openError(this, path, access);
  }

  /* The mode it is opened in, which a disk image's file keeps: one opened
   * to read is not written, one opened to write not read. */
  if ('mode' in file) {
    file.mode = access;
  }

  return handle;
}

/** Whether `DOS_MakeName` takes a path, as `DOS_GetFileAttr` asks it first. */
function makesName(dos: any, path: string) {
  try {
    refusedName(dos, path);

    return true;
  } catch {
    return false;
  }
}

/**
 * Why a file was not opened, as DOSBox's `DOS_OpenFile` tells it
 * (`dos_files.cpp` 560-568), on a disk or disc image: a file there opened
 * other than to read alone, access denied; else "path not found" where its
 * folder is not there either (`PathExists`, 447-459), "file not found"
 * where it is. Another drive's, file not found. As `dos.rs`'s `open_error`.
 */
async function openError(dos: any, path: string, access: number) {
  const { drive, parts, name } = resolveFile(dos, path);
  const fileSystem = dos.files.query(drive);

  if (fileSystem?.listing !== 'stored') {
    return 0x2; // FILE_NOT_FOUND
  }

  const attributes = fileSystem.attributes([...parts, name]);

  if (access & 3 && attributes !== null && !(attributes & 0x10)) {
    return 0x5; // ACCESS_DENIED
  }

  return (await openDirectory(dos, drive, parts)) ? 0x2 : 0x3;
}
