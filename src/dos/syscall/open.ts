import { openDirectory } from './directory.js';
import { resolveFile } from './files.js';

export async function open(path, access) {
  const target = resolveFile(this, path);
  const fileSystem = this.files.query(target.drive);

  /* A folder or a label on a disk image is not opened: access denied
   * (`DOS_OpenFile`, `dos_files.cpp` 517-523). As `dos.rs`. */
  if (
    fileSystem?.listing === 'stored' &&
    (fileSystem.attributes([...target.parts, target.name]) ?? 0) & 0x18
  ) {
    throw 0x5; // ACCESS_DENIED
  }

  const handle = await this.files.open(path);
  const file = this.files.resolve(handle);

  // TODO: handle errors
  // TODO: return the error code for the error and set carry flag
  if (!file) {
    /* Not there, on a disk image: "path not found" where its folder is not
     * there either, as DOSBox's `DOS_OpenFile` answers (`PathExists`,
     * `dos_files.cpp` 447-459, 563). As `dos.rs`. */
    const { drive, parts } = resolveFile(this, path);

    if (
      this.files.query(drive)?.listing === 'stored' &&
      !(await openDirectory(this, drive, parts))
    ) {
      throw 0x3; // PATH_NOT_FOUND
    }

    throw 0x2; // FILE_NOT_FOUND
  }

  /* The mode it is opened in, which a disk image's file keeps: one opened
   * to read is not written, one opened to write not read. */
  if ('mode' in file) {
    file.mode = access;
  }

  return handle;
}
