'use strict';

/**
 * What kind of drive a drive number is, 0 for A:.
 *
 * The drives here are the ones winbox.js has mounted, and each is a disk
 * image or a volume made in memory: a fixed disk, `DRIVE_FIXED`. Any other
 * letter does not exist, which is 1. The values are the documented ones; no
 * probe has asked a real installation, whose A: and B: would be floppies.
 */
const DRIVE_FIXED = 3;
const DRIVE_NONE = 1;

export function GetDriveType(this: any, nDrive: number) {
  const letter = String.fromCharCode(0x41 + (nDrive & 0xff));

  return this.dos.files.query(letter) ? DRIVE_FIXED : DRIVE_NONE;
}
