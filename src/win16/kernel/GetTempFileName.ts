'use strict';

import { getTime } from '../../dos/syscall/getTime.js';
import { createNewFile } from '../../dos/syscall/files.js';
import { segmentSelector } from '../selectors.js';
import { GetDriveType } from './GetDriveType.js';

/**
 * Where temporary files go, and a name for one.
 *
 * **Read out of `KRNL386.EXE`** (seg3 `0508`, `056a`).
 */

const TF_FORCEDRIVE = 0x80;
const DRIVE_FIXED = 3;

/**
 * The drive temporary files go on: the one given, with `TF_FORCEDRIVE`;
 * otherwise the first fixed disk, whatever was given, or the given drive --
 * the current one for nought -- when there is none. The letter is the low
 * byte and a colon the high. `TEMP` is not looked at.
 */
export function GetTempDrive(this: any, bDriveLetter: number) {
  let letter = bDriveLetter & 0x7f;

  if (letter === 0) {
    letter = this.dos.files.drive.charCodeAt(0);
  }

  letter &= 0x5f;

  if (!(bDriveLetter & TF_FORCEDRIVE)) {
    for (let drive = 0; drive <= 25; drive++) {
      if (GetDriveType.call(this, drive) === DRIVE_FIXED) {
        return (0x3a << 8) | (0x41 + drive);
      }
    }
  }

  return (0x3a << 8) | letter;
}

/** A variable of the task's DOS environment, or null. */
function environmentVariable(system: any, name: string) {
  const task = system.scheduler?.task;
  const segment = task?.environmentSegment;

  if (!segment) {
    return null;
  }

  const core = system.machine.cpu.core;
  const selector = segmentSelector(segment);
  let at = 0;

  for (;;) {
    let entry = '';

    for (let byte = core.read8(selector, at); byte; byte = core.read8(selector, ++at)) {
      entry += String.fromCharCode(byte);
    }

    at++;

    if (!entry) {
      return null;
    }

    /* Matched as the words it compares, case and all. */
    if (entry.startsWith(`${name}=`)) {
      return entry.substring(name.length + 1);
    }
  }
}

/**
 * A temporary file's name, written to `lpszTempFileName`: `TEMP`'s directory,
 * or else the Windows directory -- or with `TF_FORCEDRIVE` the drive alone --
 * then `~`, three characters of the prefix, four hexadecimal digits and
 * `.TMP`. With `uUnique` nought, the digits are the time's seconds and
 * hundredths exclusive-ored with its hours and minutes, and the file is
 * made, empty, to be sure of it: one there already moves the number on by
 * one until one is not. Answers the number, or nought when the file could
 * not be made; the name is written either way.
 */
export async function GetTempFileName(
  this: any,
  bDriveLetter: number,
  lpszPrefixString: any,
  uUnique: number,
  lpszTempFileName: number
) {
  const drive = String.fromCharCode(GetTempDrive.call(this, bDriveLetter) & 0xff);
  let path: string;

  if (bDriveLetter & TF_FORCEDRIVE) {
    path = `${drive}:~`;
  } else {
    const temp = environmentVariable(this, 'TEMP');
    let directory: string;

    if (temp !== null) {
      directory = temp[1] === ':' ? temp : `${drive}:${temp}`;
    } else {
      directory = this.dos.files.systemRootPath.replace(/\\$/, '');
    }

    path = `${directory}${directory.endsWith('\\') ? '' : '\\'}~`;
  }

  path += String(lpszPrefixString ?? '').substring(0, 3);

  let n = uUnique & 0xffff;

  if (n === 0) {
    const [hour, minute, second, hundredth] = getTime.call(this.dos);

    n = ((second << 8) | hundredth) ^ ((hour << 8) | minute);
  }

  const named = () => `${path}${(n || 1).toString(16).toUpperCase().padStart(4, '0')}.TMP`;

  if (n === 0) {
    n = 1;
  }

  let name = named();

  if ((uUnique & 0xffff) === 0) {
    for (;;) {
      try {
        const handle = await createNewFile.call(this.dos, name, 0);

        this.dos.files.close(handle);
        break;
      } catch (error) {
        if (error !== 0x50) {
          n = 0;
          break;
        }

        n = (n + 1) & 0xffff || 1;
        name = named();
      }
    }
  }

  const core = this.machine.cpu.core;

  for (let i = 0; i <= name.length; i++) {
    core.write8(
      (lpszTempFileName >>> 16) & 0xffff,
      ((lpszTempFileName & 0xffff) + i) & 0xffff,
      i < name.length ? name.charCodeAt(i) : 0
    );
  }

  return n;
}
