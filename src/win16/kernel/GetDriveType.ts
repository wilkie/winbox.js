'use strict';

/**
 * What kind of drive a drive number is, 0 for A:.
 *
 * The drives here are the ones winbox.js has mounted: a fixed disk,
 * `DRIVE_FIXED` (3), or `DRIVE_REMOVABLE` (2) for one mounted as removable.
 * Any other number is nought. **Recorded** by `drivetyp`: under DOSBox, where
 * the oracle's Windows ran, A: is removable, C: and Z: are fixed, and every
 * other letter, and every number past Z:, answers nought. File Manager shows
 * a drive for each letter not nought.
 */
const DRIVE_REMOVABLE = 2;
const DRIVE_FIXED = 3;

export function GetDriveType(this: any, nDrive: number) {
  const drive = ((nDrive << 16) >> 16);

  if (drive < 0 || drive > 25) {
    return 0;
  }

  const fileSystem = this.dos.files.query(String.fromCharCode(0x41 + drive));

  if (!fileSystem) {
    return 0;
  }

  return fileSystem.removable ? DRIVE_REMOVABLE : DRIVE_FIXED;
}
