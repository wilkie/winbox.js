import { File, FileSystem } from '../file-system.js';
import { FatDrive, FatFile, OPEN_READWRITE, sameName, slotEntry } from './fat-drive.js';
import { OverlayDisk } from './overlay-disk.js';

/**
 * A FAT12 or FAT16 disk image as a drive, read and written as DOSBox
 * 0.74-3's `fatDrive` reads and writes one (`drive_fat.cpp`, `FatDrive`):
 * its folders listed in the order their slots keep them, each entry's
 * creation stamp given as its date and time, its attributes the entry's
 * own, its room counted from the FAT; a file made with a zeroed entry,
 * nothing stamped as it is written or closed. **Recorded** by `imgflop`,
 * `imghdd` and `imgwrite`. As the Rust engine's `FatVolume`
 * (`files/fat.rs`).
 *
 * What is written goes to an `OverlayDisk` over the image's sectors, never
 * to the image itself (the owner's decision of 2026-10-22,
 * `kb/topics/drives-and-disks.md`); `image` gives the image as written.
 */

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

/** The root's entry, which no slot holds. */
const ROOT = {
  name: '',
  attributes: 0x10,
  directory: true,
  size: 0,
  time: { hour: 0, minute: 0, second: 0 },
  date: { year: 1980, month: 0, day: 0 },
};

/**
 * A folder of the image, as the engine's DOS looks one over: its entry,
 * and its entries as the image keeps them, each found by its name.
 */
class ImageFolder {
  readonly info: any;
  readonly parts: string[];
  readonly #image: FATImage;

  constructor(image: FATImage, parts: string[], info: any) {
    this.#image = image;
    this.parts = parts;
    this.info = info;
  }

  get path() {
    return this.parts.join('\\');
  }

  /** Its entries in the order of their slots: a folder's as one, a file's as its entry. */
  async list() {
    const drive = this.#image.drive;
    const folder = drive.getDirClustNum(this.parts, false);

    if (folder === null) {
      return [];
    }

    return drive.listed(folder).map((slot) => {
      const info = slotEntry(slot);

      return info.directory
        ? new ImageFolder(this.#image, [...this.parts, info.name], info)
        : { info };
    });
  }

  /** An entry by its name, a file with no extension named with its dot or without. */
  async lookup(name: string) {
    return (await this.list()).find((entry: any) => sameName(entry.info.name, name)) ?? null;
  }
}

/**
 * A file of the image open, as DOS's handle has it: DOSBox's `fatFile`
 * (`FatFile`) behind the engine's file, whose position the engine moves.
 * A read or write where the engine's position is not DOSBox's seeks there
 * first.
 */
class ImageOpenFile extends File {
  readonly file: FatFile;
  readonly path: string;

  constructor(file: FatFile, parts: string[], info: any) {
    super(info);
    this.file = file;
    this.path = parts.join('\\');
  }

  get size() {
    return this.file.filelength;
  }

  /** The mode DOS's 3Dh opened it in, AL. */
  set mode(mode: number) {
    this.file.flags = mode;
  }

  refusesRead() {
    return this.file.refusesRead();
  }

  refusesWrite() {
    return this.file.refusesWrite();
  }

  /** Its entry's creation stamp as it was opened, which 5700h answers: the time and the date. */
  get dosStamp(): [number, number] {
    return [this.file.time, this.file.date];
  }

  #at(offset: number) {
    if (offset !== this.file.seekpos) {
      this.file.seek(offset, 0);
    }
  }

  /** DOSBox's seek, from the start, where it is or its end: where it is now. */
  dosSeek(position: number, basis: number) {
    this.position = this.file.seek(position, basis);

    return this.position;
  }

  async read(offset: number, length: number) {
    this.#at(offset);

    const bytes = this.file.read(length);

    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }

  async read8(offset: number) {
    return new Uint8Array(await this.read(offset, 1))[0];
  }

  async read16(offset: number, littleEndian = true) {
    return new DataView(await this.read(offset, 2)).getUint16(0, littleEndian);
  }

  async read32(offset: number, littleEndian = true) {
    return new DataView(await this.read(offset, 4)).getUint32(0, littleEndian);
  }

  async write(offset: number, data: any) {
    const bytes =
      data instanceof Uint8Array
        ? data
        : new Uint8Array(data.buffer ?? data, data.byteOffset ?? 0, data.byteLength ?? data.length);

    this.#at(offset);

    return this.file.write(bytes);
  }

  /** DOS's write of nought bytes, which on an image cuts nothing (`fatFile::Write` with nought). */
  async end(at: number) {
    this.#at(at);
    this.file.write(new Uint8Array(0));
  }

  /** Nothing stamped: DOSBox stamps nothing on an image. */
  async stamp(_at: Date) {}

  /** Closed: its sector written back (`fatFile::Close`). */
  close() {
    this.file.close();
  }
}

export class FATImage extends FileSystem {
  readonly drive: FatDrive;
  readonly #floppy: boolean;
  readonly #overlay: OverlayDisk;

  constructor(disk: OverlayDisk, drive: FatDrive, floppy: boolean) {
    super(disk);
    this.#overlay = disk;
    this.drive = drive;
    this.#floppy = floppy;
  }

  /**
   * An image's volume, mounted as a floppy or a hard disk: where it begins
   * DOSBox's choice (`volumeStart`), FAT12 or FAT16 by the count of its
   * clusters. FAT32, with no sectors to a FAT, is refused. The image's
   * bytes are read where they are, never written.
   */
  static async of(bytes: Uint8Array, floppy: boolean) {
    const first = volumeStart(bytes);
    const disk = new OverlayDisk(bytes, first);
    const drive = FatDrive.of(disk, first);

    if (!(drive instanceof FatDrive)) {
      throw new Error(drive === 'fat32' ? 'FAT32 is not mounted' : 'not a FAT volume');
    }

    return new FATImage(disk, drive, floppy);
  }

  /** Whether the volume's FAT has 12-bit entries. */
  get twelve() {
    return this.drive.twelve;
  }

  /** Mounted as a floppy (`imgmount -t floppy`): removable, its media byte F0h. */
  get removable() {
    return this.#floppy;
  }

  /** As the image keeps its folders, `.` and `..` only where it has them. */
  get listing(): 'sorted' | 'stored' {
    return 'stored';
  }

  /** The image as programs have written it: what "Save image..." or `--write-back` keeps. */
  image() {
    return this.#overlay.image();
  }

  /** The sectors written, by their number in the image, each as last written. */
  written() {
    return this.#overlay.written();
  }

  /** Whether programs have written anything to it that it did not hold. */
  get changed() {
    return this.#overlay.changed;
  }

  /**
   * What a path names: a folder a search for folders finds (DOSBox's
   * `TestDir`), else a file as `FileOpen` finds one, opened; null where
   * neither is.
   */
  async open(path: string[], _create = false): Promise<any> {
    const parts = path.filter((part) => part !== '');

    if (!parts.length) {
      return new ImageFolder(this, [], ROOT);
    }

    if (this.drive.getDirClustNum(parts, false) !== null) {
      const parent = await this.open(parts.slice(0, -1));
      const name = parts.at(-1) ?? '';
      const entries = parent ? await parent.list() : [];

      /* The folder of its name, a file of the same name passed over. */
      return (
        entries.find((entry: any) => entry.info.directory && sameName(entry.info.name, name)) ??
        null
      );
    }

    const found = this.drive.getFileDirEntry(parts);

    if (!found) {
      return null;
    }

    const [slot, folder, index] = found;

    return new ImageOpenFile(
      new FatFile(this.drive, slot, folder, index, OPEN_READWRITE),
      parts,
      slotEntry(slot)
    );
  }

  async list(path: string[]) {
    return (await this.open(path))?.list?.() ?? [];
  }

  /**
   * A file made, or emptied where it is there, with the attributes DOS's
   * 3Ch was given (`FileCreate`), and opened.
   */
  async create(path: string[], options: any = {}) {
    const parts = path.filter((part) => part !== '');
    const file = this.drive.fileCreate(parts, options.attributes ?? 0);

    if (!file) {
      return null;
    }

    return new ImageOpenFile(file, parts, slotEntry(this.drive.getFileDirEntry(parts)![0]));
  }

  async map(_path, _data, _options = {}): Promise<any> {
    throw new Error('a disk image is written by DOS alone');
  }

  /** A file deleted (`FileUnlink`): a folder is not found. */
  async unlink(directory: ImageFolder, name: string) {
    return this.drive.fileUnlink([...directory.parts, name]);
  }

  /** An empty folder deleted (`RemoveDir`). */
  async removeDirectory(directory: ImageFolder, name: string) {
    return this.drive.removeDir([...directory.parts, name]);
  }

  /** A folder made (`MakeDir`); error 5 where it is not, as DOS answers. */
  async makeDirectory(parent: ImageFolder, name: string, _modified?: number) {
    if (!this.drive.makeDir([...parent.parts, name])) {
      throw 0x05;
    }
  }

  /** A file renamed (`Rename`); error 2 where it is not -- a folder among them -- as DOS answers. */
  async rename(from: ImageFolder, entry: any, to: ImageFolder, name: string) {
    if (!this.drive.rename([...from.parts, entry.info.name], [...to.parts, name])) {
      throw 0x02;
    }
  }

  /** A file's or folder's attributes, as DOSBox's `GetFileAttr` finds them; null where it does not. */
  attributes(path: string[]) {
    return this.drive.getFileAttr(path.filter((part) => part !== ''));
  }

  /** Whether a search for folders finds a folder there (`TestDir`). */
  testDir(path: string[]) {
    return this.searchFolder(path) !== null;
  }

  /** A folder by its first cluster, nought the root's, as a search keeps it; null where a search for folders does not find it. */
  searchFolder(path: string[]) {
    return this.drive.getDirClustNum(
      path.filter((part) => part !== ''),
      false
    );
  }

  /** A search carried on from a slot (`FindNextInternal`): the entry found, or null, and the slot after. */
  findFrom(folder: number, attributes: number, pattern: string, at: number): [any, number] {
    const [slot, next] = this.drive.findNextInternal(folder, attributes, pattern, at);

    return [slot ? slotEntry(slot) : null, next];
  }

  /** The volume's room (`AllocationInfo`). */
  async space() {
    return this.drive.allocation();
  }
}
