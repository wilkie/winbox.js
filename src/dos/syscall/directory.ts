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

const ERROR_PATH_NOT_FOUND = 0x03;
const ERROR_INVALID_DRIVE = 0x0f;

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
 * Writes a drive's current directory (47h), 0 for the current drive and 1
 * for A:, at DS:SI: from the root, without the drive or the first `\`, and a
 * null.
 */
export function getCurrentDirectory(this: any, drive: number, address: number) {
  const letter = drive === 0 ? this.files.drive : String.fromCharCode(0x40 + drive);

  if (drive > 26 || !this.files.query(letter)) {
    throw ERROR_INVALID_DRIVE;
  }

  const current: string = this.files._pwd[letter] ?? `${letter}:\\`;
  const path = current.substring(3).replace(/\\$/, '');

  for (let i = 0; i < path.length; i++) {
    this.machine.memory.write8(address + i, path.charCodeAt(i) & 0xff);
  }

  this.machine.memory.write8(address + path.length, 0);

  /* AX is 0100h on success: DOS leaves it so, and programs rely on AL being
   * nought -- Write finds the end of the path by scanning for AL. */
  this.machine.cpu.core.ax = 0x0100;
}
