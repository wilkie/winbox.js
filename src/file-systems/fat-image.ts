import { Disk } from '../emulator/disk.js';
import { FAT16 } from './fat16.js';

/**
 * A FAT12 or FAT16 disk image as a drive, read as DOSBox 0.74-3's
 * `fatDrive` reads one (`drive_fat.cpp`): its folders listed in the order
 * the image keeps them, each entry's creation stamp given as its date and
 * time, its attributes the entry's own, and its room counted from the FAT.
 * **Recorded** by `imgflop` and `imghdd`. As the Rust engine's `FatVolume`
 * (`files/fat.rs`).
 *
 * Nothing is written to it yet: a file made, written, renamed or deleted, a
 * folder made, or attributes set, is refused. What a program writes is to
 * be kept apart from the image, the image itself never changed (the owner's
 * decision of 2026-10-22, `kb/topics/drives-and-disks.md`).
 */

const ERROR_FILE_NOT_FOUND = 0x02;
const ERROR_ACCESS_DENIED = 0x05;

/** The largest image DOSBox takes for a floppy, in whole KB (`drive_fat.cpp` 645-654). */
const FLOPPY_KB = 2880;

/** Whether DOSBox takes an image for a floppy: 2,880 KB or less, in whole KB. */
export function isFloppyImage(bytes: Uint8Array) {
  return Math.floor(bytes.byteLength / 1024) <= FLOPPY_KB;
}

/**
 * The sector a FAT volume begins at in an image, as DOSBox's `fatDrive`
 * finds it (`drive_fat.cpp` 654-679): nought for a floppy; for a hard disk,
 * the first of the master boot record's four partition entries at 1BEh
 * with a size other than nought, its first sector (an entry's bytes 8-11,
 * its size 12-15); with none, 63. DOSBox only logs a table without 55AAh.
 * As `mbr.rs`'s `volume_start`.
 */
export function volumeStart(bytes: Uint8Array) {
  if (isFloppyImage(bytes)) {
    return 0;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  for (let entry = 0x1be; entry < 0x1fe && entry + 16 <= bytes.byteLength; entry += 16) {
    if (view.getUint32(entry + 12, true) !== 0) {
      return view.getUint32(entry + 8, true);
    }
  }

  return 63;
}

export class FATImage extends FAT16 {
  declare _floppy: boolean;
  /** Each entry's creation stamp is its date and time, as DOSBox gives them. */
  listsCreation = true;

  constructor(disk: any, floppy: boolean) {
    super(disk);
    this._floppy = floppy;
  }

  /**
   * An image's volume, mounted as a floppy or a hard disk: where it begins
   * DOSBox's choice (`volumeStart`), FAT12 or FAT16 by the count of its
   * clusters (`FAT16.mount`). FAT32, with no sectors to a FAT, is refused.
   */
  static async of(bytes: Uint8Array, floppy: boolean) {
    const volume = bytes.subarray(Math.min(volumeStart(bytes) * 512, bytes.byteLength));
    const blockSize = 32 * 1024;
    const disk = new Disk(
      Math.max(1, Math.ceil(volume.byteLength / blockSize)) * blockSize,
      512,
      blockSize
    );

    disk.load(volume);

    const image = new FATImage(disk, floppy);

    await image.mount({ byClusters: true });

    return image;
  }

  /** Mounted as a floppy (`imgmount -t floppy`): removable, its media byte F0h. */
  get removable() {
    return this._floppy;
  }

  /** As the image keeps its folders, `.` and `..` only where it has them. */
  get listing(): 'sorted' | 'stored' {
    return 'stored';
  }

  /** Not written to yet. */
  get readOnly() {
    return true;
  }

  async map(_path, _data, _options = {}): Promise<any> {
    throw ERROR_ACCESS_DENIED;
  }

  async unlink(_directory, _name) {
    return false;
  }

  async makeDirectory(_parent, _name, _modified?: number): Promise<any> {
    throw ERROR_ACCESS_DENIED;
  }

  /** Refused as a rename the host refuses, error 2, as the Rust engine's drive answers it. */
  async rename(_from, _entry, _to, _name): Promise<any> {
    throw ERROR_FILE_NOT_FOUND;
  }
}
