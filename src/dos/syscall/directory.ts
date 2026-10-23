/**
 * The current directory: INT 21h functions 3Bh, to change it, and 47h, to
 * ask it. Each drive has its own, and a path without a drive is on the
 * current drive; a path that does not begin at the root begins at the
 * drive's current directory.
 *
 * DOS as it is documented, underneath Windows: nothing here has been
 * measured. `DlgDirList` changes directory this way, and COMMDLG asks where
 * it is.
 */

const ERROR_FILE_NOT_FOUND = 0x02;
const ERROR_PATH_NOT_FOUND = 0x03;
const ERROR_INVALID_DRIVE = 0x0f;

/**
 * A name of a path as DOSBox's `DOS_MakeName` makes it (`dos_files.cpp`
 * 81-117, 168-180) before any drive's function sees it: spaces dropped,
 * and, after its first dot, three characters kept and before it eight;
 * eight with no dot. Followed for the drives that follow `dos_files.cpp`,
 * disk and disc images (`listing` `stored`). **Recorded** by `imgcd`:
 * `A_VERY_LONG_FILE_NAME.TEXT` opens `A_VERY_L.TEX`, and `LONGNAMEDFOLDER`,
 * made `LONGNAME`, finds no `LONGNAMEDFOL`. As `dos.rs`'s `dos_name`.
 */
export function dosName(whole: string) {
  const name = whole.replaceAll(' ', '');

  if (/^\.*$/.test(name)) {
    return name;
  }

  const dot = name.indexOf('.');

  if (dot < 0) {
    return name.substring(0, 8);
  }

  return name.substring(0, Math.min(dot, 8)) + name.substring(dot, dot + 4);
}

/** The characters `DOS_MakeName` takes besides letters and digits (`dos_files.cpp` 84-101). */
const TAKEN = new Set([
  ..."/ \\$#@()!%{}`~_-.*?&'+^",
  ...[246, 255, 0xa0, 0xe5, 0xbd].map((code) => String.fromCharCode(code)),
]);

/**
 * What DOSBox's `DOS_MakeName` refuses of a path (`dos_files.cpp` 58-180):
 * none or a space first, file not found; a character it does not take, path
 * not found; a name with a second dot after its first, file not found for
 * the last name and path not found for a folder's. **Recorded** by `imgcd`:
 * `README.TXT;1` is path not found. As `dos.rs`'s `make_name_error`.
 */
export function makeNameError(path: string): number | null {
  if (!path || path.startsWith(' ')) {
    return ERROR_FILE_NOT_FOUND;
  }

  const rest = path.length >= 2 && path[1] === ':' ? path.substring(2) : path;

  for (const character of rest) {
    if (!/[A-Za-z0-9]/.test(character) && !TAKEN.has(character)) {
      return ERROR_PATH_NOT_FOUND;
    }
  }

  const names = rest.split(/[\\/]/);

  for (let at = 0; at < names.length; at++) {
    const name = names[at].replaceAll(' ', '');
    const dot = name.indexOf('.');

    if (/^\.*$/.test(name)) {
      continue;
    }

    if (dot >= 0 && name.indexOf('.', dot + 1) >= 0) {
      return at + 1 === names.length ? ERROR_FILE_NOT_FOUND : ERROR_PATH_NOT_FOUND;
    }
  }

  return null;
}

/**
 * DOSBox's `DOS_MakeName`'s refusal of a path (`makeNameError`), on a
 * drive that follows `dos_files.cpp`: a disk or disc image. A folder's
 * drive takes any name, as before. As `dos.rs`'s `refused_name`.
 */
export function refusedName(dos: any, path: string) {
  const drive = path.length >= 2 && path[1] === ':' ? path[0].toUpperCase() : dos.files.drive;

  if (dos.files.query(drive)?.listing !== 'stored') {
    return;
  }

  const error = makeNameError(path);

  if (error !== null) {
    throw error;
  }
}

/**
 * A directory path taken apart: its drive letter and its parts from the
 * root, upper case, with `.` and `..` gone.
 */
export function resolveDirectory(dos: any, path: string) {
  let drive = dos.files.drive;
  let rest = path;

  if (rest.length >= 2 && rest[1] === ':') {
    drive = rest[0].toUpperCase();
    rest = rest.substring(2);
  }

  if (!rest.startsWith('\\') && !rest.startsWith('/')) {
    const current = dos.files._pwd[drive] ?? `${drive}:\\`;
    rest = current.substring(2) + '\\' + rest;
  }

  const parts: string[] = [];

  for (const part of rest.split(/[\\/]/)) {
    if (part === '' || part === '.') {
      continue;
    }

    if (part === '..') {
      parts.pop();
    } else {
      parts.push(part.toUpperCase());
    }
  }

  if (dos.files.query(drive)?.listing === 'stored') {
    return { drive, parts: parts.map(dosName) };
  }

  return { drive, parts };
}

/** The directory a path names, if it is one. */
export async function openDirectory(dos: any, drive: string, parts: string[]) {
  const fileSystem = dos.files.query(drive);
  const folder = fileSystem ? await fileSystem.open(parts) : null;

  return folder?.info?.directory ? folder : null;
}

/** Changes the current directory of the path's drive (3Bh). */
export async function chdir(this: any, path: string) {
  const { drive, parts } = resolveDirectory(this, path);

  if (!(await openDirectory(this, drive, parts))) {
    throw ERROR_PATH_NOT_FOUND;
  }

  this.files._pwd[drive] = `${drive}:\\` + parts.map((part) => part + '\\').join('');
}

/**
 * A drive's current directory as function 47h answers it: without its
 * drive and first backslash. A removable drive with no disk in it answers
 * as no drive, as DOSBox's floppy drive does (**recorded** by `ofnopen`:
 * COMMDLG cannot read drive A:). As `dos.rs`'s `directory_of`.
 */
export function directoryOf(dos: any, letter: string): string {
  const fileSystem = dos.files.query(letter);

  if (!fileSystem || (fileSystem.removable && !fileSystem.space)) {
    throw ERROR_INVALID_DRIVE;
  }

  const current: string = dos.files._pwd[letter] ?? `${letter}:\\`;

  return current.substring(3).replace(/\\$/, '');
}

/**
 * A drive's volume label, as DOS's search for one answers it: none for a
 * removable drive, `DOSBOX` for DOSBox's own drive Z:, and `C_DRIVE` and
 * the like for a folder it mounts, as DOSBox names them. **Recorded** by
 * `ofnopen`: COMMDLG's drives' list shows `c: c_drive` and `z: dosbox`. As
 * `dos.rs`'s `volume_label`.
 */
export function volumeLabel(dos: any, letter: string): string | null {
  const fileSystem = dos.files.query(letter);

  /* A disk's or disc's own (`Volume::label`). */
  if (fileSystem?.label) {
    return fileSystem.label;
  }

  /* A disk image with no label of its own has none: DOSBox's FAT drive
   * answers its label search with no file (`drive_fat.cpp` 857-867),
   * **recorded** by `imgflop` and `imghdd`. */
  if (!fileSystem || fileSystem.removable || fileSystem.listing === 'stored') {
    return null;
  }

  return letter === 'Z' ? 'DOSBOX' : `${letter}_DRIVE`;
}

/**
 * Writes a drive's current directory (47h), 0 for the current drive and 1
 * for A:, at DS:SI: from the root, without the drive or the first `\`, and a
 * null.
 */
export function getCurrentDirectory(this: any, drive: number, address: number) {
  const letter = drive === 0 ? this.files.drive : String.fromCharCode(0x40 + drive);

  if (drive > 26) {
    throw ERROR_INVALID_DRIVE;
  }

  const path = directoryOf(this, letter);

  for (let i = 0; i < path.length; i++) {
    this.machine.memory.write8(address + i, path.charCodeAt(i) & 0xff);
  }

  this.machine.memory.write8(address + path.length, 0);

  /* AX is 0100h on success: DOS leaves it so, and programs rely on AL being
   * nought -- Write finds the end of the path by scanning for AL. */
  this.machine.cpu.core.ax = 0x0100;
}
