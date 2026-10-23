'use strict';

import { hasDisk, isCompactDisc } from '../../dos/syscall/ioctl.js';

/**
 * A drive's kind, as KERNEL asks SYSTEM.DRV's `InquireSystem` for it
 * (`SYSTEM.DRV` seg1 `0002`-`0169`, code 1): nought for none,
 * `DRIVE_REMOVABLE` (2), `DRIVE_FIXED` (3) or `DRIVE_REMOTE` (4). As
 * `modules_kernel.rs`'s `drive_type`.
 *
 * * A drive DOS will not select (0Eh then 19h, `0031`-`005c`) is nought:
 *   one not mounted here. (DOSBox selects A: and B: whether or not anything
 *   is mounted, `dos_files.cpp` 56; a session here without A: has no drive
 *   A: at all.)
 * * IOCTL 4409h succeeding with bit 12 of DX, remote: 4 (`0079`-`0090`).
 * * 4408h (`0092`-`00b8`): AX bit 0, fixed, 3; else removable, 2 -- but for
 *   A: or B: only where the BIOS's equipment word says a floppy drive is
 *   there (`[0Bh]` bit 0, from `INT 11h` at `01fe`-`020b`), else nought.
 *   4408h failing (`00e5`-`00f9`): the number of floppy drives less one
 *   (`[0Ah]`, equipment bits 6-7), nought taken as one, below the drive's
 *   number 3, else 2.
 * * Then 440Eh (`00bb`-`00e2`): succeeding with AL nought, the kind as it
 *   stands; failing (`00fb`-`010b`), for B: with `[0Ah]` nought -- B: the
 *   one floppy drive's other letter -- nought, else the kind.
 *
 * The IOCTL answers are DOS's (`ioctl.ts`). DOSBox's BIOS counts a floppy
 * image mounted in its equipment word, none to begin with (`bios.cpp` 1043,
 * `bios_disk.cpp` 219-229): here each floppy disk in its drive. **Recorded**
 * by `drivetyp` and `drvioctl`: A: with nothing in it 2, B: 0, C: and Z: 3;
 * with a floppy image as B: 2, a CD-ROM image as D: 4.
 */
export function GetDriveType(this: any, nDrive: number) {
  const drive = (nDrive << 16) >> 16;

  if (drive < 0 || drive > 25) {
    return 0;
  }

  const files = this.dos.files;
  let floppies = 0;

  for (let other = 0; other < 26; other++) {
    const fileSystem = files.query(String.fromCharCode(0x41 + other));

    if (fileSystem?.removable && !fileSystem.remote && hasDisk(fileSystem)) {
      floppies++;
    }
  }

  const floppiesLessOne = floppies >= 2 ? 1 : 0;
  const fileSystem = files.query(String.fromCharCode(0x41 + drive));

  if (!fileSystem) {
    return 0;
  }

  const dos = hasDisk(fileSystem);
  const compactDisc = isCompactDisc(fileSystem);

  if (dos && fileSystem.remote) {
    return 4;
  }

  /* 4408h. */
  let kind: number;

  if (!dos || (compactDisc && drive >= 2)) {
    kind = Math.max(floppiesLessOne, 1) < drive ? 3 : 2;
  } else if (drive >= 2) {
    kind = 3;
  } else if (floppies === 0) {
    return 0;
  } else {
    kind = 2;
  }

  /* 440Eh. */
  if (dos && !compactDisc) {
    return kind;
  }

  if (drive === 1 && floppiesLessOne === 0) {
    return kind === 2 ? 0 : 1;
  }

  return kind;
}
