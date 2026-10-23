import { OverlayDisk, SECTOR } from './overlay-disk.js';

/**
 * A FAT12 or FAT16 volume read and written as DOSBox 0.74-3's `fatDrive`
 * reads and writes one (`drive_fat.cpp`), over a disk image's sectors with
 * what is written kept apart (`OverlayDisk`). The functions are DOSBox's,
 * by its names, and do what its do, its quirks with them: a file made over
 * one there keeps its clusters lost, a write that fills a cluster to its
 * end takes the next, a file's sector read as it is opened is written back
 * as it is closed. **Recorded** by `imgflop`, `imghdd` and `imgwrite`. As
 * the Rust engine's `files/fat.rs`, line for line.
 */

const READ_ONLY = 0x01;
const HIDDEN = 0x02;
const SYSTEM = 0x04;
const VOLUME = 0x08;
const DIRECTORY = 0x10;

/** A file's open mode, its low four bits, as DOS's 3Dh takes it. */
export const OPEN_READ = 0;
export const OPEN_WRITE = 1;
export const OPEN_READWRITE = 2;

/** A directory's entry, 32 bytes (`direntry`). */
type Slot = Uint8Array;

const word = (slot: Slot, at: number) => slot[at] | (slot[at + 1] << 8);
const firstCluster = (slot: Slot) => word(slot, 26);
const sizeOf = (slot: Slot) =>
  (slot[28] | (slot[29] << 8) | (slot[30] << 16) | (slot[31] << 24)) >>> 0;

/** A slot's bytes as text, each byte a character. */
const textOf = (bytes: Uint8Array) => {
  let text = '';

  for (const byte of bytes) {
    if (byte === 0) {
      break;
    }

    text += String.fromCharCode(byte);
  }

  return text.replace(/^ +| +$/g, '');
};

/**
 * The name DOSBox's search gives an entry (`FindNextInternal` 939-948): the
 * eight characters and the three, each trimmed of spaces at both ends,
 * joined by a dot -- a dot after the name even with no extension, but for a
 * folder.
 */
export function findName(slot: Slot) {
  const name = textOf(slot.subarray(0, 8));
  const extension = textOf(slot.subarray(8, 11));

  return !(slot[11] & DIRECTORY) || extension ? `${name}.${extension}` : name;
}

/**
 * An entry as DOSBox's search answers it: its name (`findName`), size and
 * attributes, its creation stamp as its date and time (957); in the shape
 * the engine's folders list an entry. As `files/fat.rs`'s `slot_entry`.
 */
export function slotEntry(slot: Slot) {
  const time = word(slot, 14);
  const date = word(slot, 16);
  const attributes = slot[11];

  return {
    name: findName(slot),
    attributes,
    directory: (attributes & DIRECTORY) !== 0,
    readOnly: (attributes & READ_ONLY) !== 0,
    hidden: (attributes & HIDDEN) !== 0,
    system: (attributes & SYSTEM) !== 0,
    volume: (attributes & VOLUME) !== 0,
    archive: (attributes & 0x20) !== 0,
    size: sizeOf(slot),
    time: { hour: time >> 11, minute: (time >> 5) & 0x3f, second: (time & 0x1f) * 2 },
    date: { year: (date >> 9) + 1980, month: (date >> 5) & 0x0f, day: date & 0x1f },
  };
}

/**
 * A name and a pattern compared as DOSBox's `WildFileCmp` compares them
 * (`drives.cpp` 27-77): each split at its last dot, the name cut to eight
 * and the extension to three, upper case; `?` any one character, `*` the
 * rest of its part.
 */
export function wildFileCmp(file: string, wild: string) {
  const split = (text: string) => {
    const dot = text.lastIndexOf('.');
    const base = dot >= 0 ? text.substring(0, dot) : text;
    const extension = dot >= 0 ? text.substring(dot + 1) : '';

    return [
      base.substring(0, 8).toUpperCase().padEnd(8, ' '),
      extension.substring(0, 3).toUpperCase().padEnd(3, ' '),
    ];
  };
  const part = (wildPart: string, filePart: string) => {
    for (let at = 0; at < wildPart.length; at++) {
      if (wildPart[at] === '*') {
        return true;
      }

      if (wildPart[at] !== '?' && wildPart[at] !== filePart[at]) {
        return false;
      }
    }

    return true;
  };
  const [fileName, fileExt] = split(file);
  const [wildName, wildExt] = split(wild);

  return part(wildName, fileName) && part(wildExt, fileExt);
}

/** Two names alike as a disk image's lookup takes them: without regard to case, a trailing dot or none. */
export function sameName(listed: string, name: string) {
  return listed.replace(/\.+$/, '').toUpperCase() === name.replace(/\.+$/, '').toUpperCase();
}

/**
 * A name as eleven characters, as a directory's entry holds it
 * (`convToDirFile`, 73-87): up to a dot into the eight, after it into the
 * three, spaces else; upper case, as DOS makes a name.
 */
function convToDirFile(name: string) {
  const eleven = new Uint8Array(11).fill(0x20);
  let at = 0;

  for (const character of name.toUpperCase()) {
    if (at >= 11) {
      break;
    }

    if (character === '.') {
      at = 8;
    } else {
      eleven[at++] = character.charCodeAt(0) & 0xff;
    }
  }

  return eleven;
}

/** The names of a path, without the empty ones DOSBox's `strtok` passes over. */
const namesOf = (parts: string[]) => parts.filter((part) => part !== '');

const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, at) => byte === b[at]);

/** A disk image's FAT volume, as DOSBox's `fatDrive` holds it. */
export class FatDrive {
  readonly disk: OverlayDisk;
  /** The image's sectors before the volume (`partSectOff`). */
  readonly partSectOff: number;
  readonly sectorsPerCluster: number;
  readonly reserved: number;
  readonly fatCopies: number;
  readonly sectorsPerFat: number;
  readonly rootEntries: number;
  readonly firstRootDirSect: number;
  readonly firstDataSector: number;
  /** How many clusters the volume has, as DOSBox counts them (700-706). */
  readonly countOfClusters: number;
  /** FAT12's entries, a cluster count below 4,085; else FAT16's (711-721). */
  readonly twelve: boolean;

  /**
   * The volume an image holds, from a sector of it, read from its boot
   * sector; `not fat` where it has no sectors to a cluster or bytes to a
   * sector, `fat32` where none to a FAT, FAT32's, which DOSBox refuses
   * (687-691). As `FatError`.
   */
  static of(disk: OverlayDisk, first: number): FatDrive | 'not fat' | 'fat32' {
    const boot = disk.sector(first);
    const word16 = (at: number) => boot[at] | (boot[at + 1] << 8);

    if (word16(11) === 0 || boot[13] === 0) {
      return 'not fat';
    }

    if (word16(22) === 0) {
      return 'fat32';
    }

    return new FatDrive(disk, first, boot);
  }

  private constructor(disk: OverlayDisk, first: number, boot: Uint8Array) {
    const word16 = (at: number) => boot[at] | (boot[at + 1] << 8);
    const bytesPerSector = word16(11);
    const total =
      word16(19) || (boot[32] | (boot[33] << 8) | (boot[34] << 16) | (boot[35] << 24)) >>> 0;

    this.disk = disk;
    this.partSectOff = first;
    this.sectorsPerCluster = boot[13];
    this.reserved = word16(14);
    this.fatCopies = boot[16];
    this.rootEntries = word16(17);
    this.sectorsPerFat = word16(22);

    const rootSectors = Math.ceil((this.rootEntries * 32) / bytesPerSector);
    const beforeData = this.reserved + this.fatCopies * this.sectorsPerFat + rootSectors;

    this.countOfClusters = Math.floor(((total - beforeData) >>> 0) / this.sectorsPerCluster);
    this.firstRootDirSect = this.reserved + this.fatCopies * this.sectorsPerFat + first;
    this.firstDataSector = beforeData + first;
    this.twelve = this.countOfClusters < 4085;
  }

  readSector(number: number) {
    return this.disk.sector(number >>> 0);
  }

  writeSector(number: number, bytes: Uint8Array) {
    this.disk.put(number >>> 0, bytes);
  }

  /** Where a cluster's FAT entry is: its sector in the image and its offset in it (289-307). */
  fatPlace(cluster: number): [number, number] {
    const offset = (this.twelve ? cluster + Math.floor(cluster / 2) : cluster * 2) >>> 0;

    return [
      (this.reserved + Math.floor(offset / SECTOR) + this.partSectOff) >>> 0,
      offset % SECTOR,
    ];
  }

  /** The FAT's sector and, for FAT12, the next, as DOSBox loads them together (309-315). */
  fatBuffer(sector: number) {
    const buffer = new Uint8Array(2 * SECTOR);

    buffer.set(this.readSector(sector));

    if (this.twelve) {
      buffer.set(this.readSector(sector + 1), SECTOR);
    }

    return buffer;
  }

  /** A cluster's entry in the first FAT (`getClusterValue`, 289-335). */
  getClusterValue(cluster: number) {
    const [sector, at] = this.fatPlace(cluster);
    const buffer = this.fatBuffer(sector);
    const value = buffer[at] | (buffer[at + 1] << 8);

    if (!this.twelve) {
      return value;
    }

    return cluster & 1 ? value >> 4 : value & 0xfff;
  }

  /**
   * A cluster's entry set, and the first FAT's sector it is in written to
   * every copy of the FAT -- the next sector too where a FAT12 entry runs
   * into it (`setClusterValue`, 337-395).
   */
  setClusterValue(cluster: number, value: number) {
    const [sector, at] = this.fatPlace(cluster);
    const buffer = this.fatBuffer(sector);
    const old = buffer[at] | (buffer[at + 1] << 8);
    let next: number;

    if (!this.twelve) {
      next = value & 0xffff;
    } else if (cluster & 1) {
      next = (old & 0x000f) | ((value & 0xfff) << 4);
    } else {
      next = (old & 0xf000) | (value & 0xfff);
    }

    buffer[at] = next & 0xff;
    buffer[at + 1] = next >> 8;

    for (let copy = 0; copy < this.fatCopies; copy++) {
      const atCopy = sector + copy * this.sectorsPerFat;

      this.writeSector(atCopy, buffer.subarray(0, SECTOR));

      if (this.twelve && at >= 511) {
        this.writeSector(atCopy + 1, buffer.subarray(SECTOR));
      }
    }
  }

  endOfChain(value: number) {
    return value >= (this.twelve ? 0xff8 : 0xfff8);
  }

  getClustFirstSect(cluster: number) {
    return (((cluster - 2) >>> 0) * this.sectorsPerCluster + this.firstDataSector) >>> 0;
  }

  /** The sector in the image a chain's logical sector is in; nought where the chain ends first (509-539). */
  getAbsoluteSectFromChain(start: number, logical: number) {
    let skip = Math.floor(logical / this.sectorsPerCluster);
    const within = logical % this.sectorsPerCluster;
    let cluster = start;

    while (skip !== 0) {
      const value = this.getClusterValue(cluster);

      if (this.endOfChain(value)) {
        return 0;
      }

      cluster = value;
      skip--;
    }

    return (this.getClustFirstSect(cluster) + within) >>> 0;
  }

  getAbsoluteSectFromBytePos(start: number, position: number) {
    return this.getAbsoluteSectFromChain(start, Math.floor(position / SECTOR));
  }

  /** A chain freed, an entry at a time, up to its end or a free entry (541-567). */
  deleteClustChain(start: number) {
    let cluster = start;

    for (;;) {
      const value = this.getClusterValue(cluster);

      if (value === 0) {
        break;
      }

      this.setClusterValue(cluster, 0);

      if (this.endOfChain(value)) {
        break;
      }

      cluster = value;
    }
  }

  /** A cluster added at a chain's end, zeroed: its number, nought where none is free (569-600). */
  appendCluster(start: number) {
    let cluster = start;

    for (;;) {
      const value = this.getClusterValue(cluster);

      if (this.endOfChain(value)) {
        break;
      }

      cluster = value;
    }

    const added = this.getFirstFreeClust();

    if (added === 0 || !this.allocateCluster(added, cluster)) {
      return 0;
    }

    this.zeroOutCluster(added);

    return added;
  }

  /** A cluster made a chain's end, and the one before pointed at it (602-628). */
  allocateCluster(cluster: number, previous: number) {
    if (cluster === 0) {
      return false;
    }

    if (previous !== 0) {
      if (this.getClusterValue(previous) === 0) {
        return false;
      }

      this.setClusterValue(previous, cluster);
    }

    this.setClusterValue(cluster, this.twelve ? 0xfff : 0xffff);

    return true;
  }

  /** The first cluster whose entry is nought; nought where none is (753-761). */
  getFirstFreeClust() {
    for (let at = 0; at < this.countOfClusters; at++) {
      if (this.getClusterValue(at + 2) === 0) {
        return at + 2;
      }
    }

    return 0;
  }

  zeroOutCluster(cluster: number) {
    for (let at = 0; at < this.sectorsPerCluster; at++) {
      this.writeSector(this.getAbsoluteSectFromChain(cluster, at), new Uint8Array(SECTOR));
    }
  }

  /**
   * A folder's slot as DOSBox reads it, nought its cluster for the root:
   * the root's from its first sector on, with no end to them; a folder's
   * along its chain, null past it.
   */
  slot(folder: number, at: number): Slot | null {
    const logical = Math.floor(at / 16);
    const within = (at % 16) * 32;
    let sector: number;

    if (folder === 0) {
      sector = this.firstRootDirSect + logical;
    } else {
      sector = this.getAbsoluteSectFromChain(folder, logical);

      if (sector === 0) {
        return null;
      }
    }

    return this.readSector(sector).slice(within, within + 32);
  }

  /**
   * The next entry a search finds from a slot (`FindNextInternal`,
   * 898-960), and the slot after it: each slot read in turn; a deleted one
   * passed over; one beginning with nought the end; one with the volume
   * label's bit passed over; one hidden, system or a folder passed over
   * unless its bit is asked for; one the pattern does not take passed over.
   */
  findNextInternal(
    folder: number,
    attributes: number,
    pattern: string,
    from: number
  ): [Slot | null, number] {
    let at = from;

    for (;;) {
      const slot = this.slot(folder, at);

      if (!slot) {
        return [null, at];
      }

      at = (at + 1) & 0xffff;

      if (slot[0] === 0xe5) {
        continue;
      }

      if (slot[0] === 0) {
        return [null, at];
      }

      if (
        slot[11] & VOLUME ||
        ~attributes & slot[11] & (DIRECTORY | HIDDEN | SYSTEM) ||
        !wildFileCmp(findName(slot), pattern)
      ) {
        continue;
      }

      return [slot, at];
    }
  }

  /**
   * A file's entry, its folder's cluster and its slot (`getFileDirEntry`,
   * 418-463): the folders of its path found as folders, the search stopping
   * at a name that is not one; then the name looked for there as a file,
   * hidden, system or read-only, not a folder.
   */
  getFileDirEntry(parts: string[]): [Slot, number, number] | null {
    let cluster = 0;
    let findFile = '';

    for (const name of namesOf(parts)) {
      findFile = name;

      const [found] = this.findNextInternal(cluster, DIRECTORY, name, 0);

      if (!found || !(found[11] & DIRECTORY)) {
        break;
      }

      cluster = firstCluster(found);
    }

    const [found, at] = this.findNextInternal(cluster, READ_ONLY | HIDDEN | SYSTEM, findFile, 0);

    return found ? [found, cluster, (at - 1) & 0xffff] : null;
  }

  /**
   * A folder's first cluster, nought the root's, or its parent's with
   * `parent` (`getDirClustNum`, 465-499): each folder of the path found as
   * a search for folders finds it -- a hidden or system one not.
   */
  getDirClustNum(parts: string[], parent: boolean): number | null {
    const names = namesOf(parts);
    let cluster = 0;

    for (let index = 0; index < names.length; index++) {
      if (parent && index + 1 === names.length) {
        break;
      }

      const [found] = this.findNextInternal(cluster, DIRECTORY, names[index], 0);

      if (!found || !(found[11] & DIRECTORY)) {
        return null;
      }

      cluster = firstCluster(found);
    }

    return cluster;
  }

  /**
   * The slot a number of slots into a folder, null where one before it or
   * it is the end, or past the root's room (`directoryBrowse`, 998-1030);
   * and its sector and offset.
   */
  browse(folder: number, number: number): [Slot, number, number] | null {
    let found: [Slot, number, number] | null = null;

    for (let at = 0; at <= number; at++) {
      if (at > 0xffff || (folder === 0 && at >= this.rootEntries)) {
        return null;
      }

      const slot = this.slot(folder, at);

      if (!slot || slot[0] === 0) {
        return null;
      }

      const logical = Math.floor(at / 16);
      const sector =
        folder === 0
          ? this.firstRootDirSect + logical
          : this.getAbsoluteSectFromChain(folder, logical);

      found = [slot, sector, (at % 16) * 32];
    }

    return found;
  }

  directoryBrowse(folder: number, number: number) {
    return this.browse(folder, number)?.[0] ?? null;
  }

  /** The slot a number of slots into a folder written over (`directoryChange`, 1032-1068). */
  directoryChange(folder: number, slot: Slot, number: number) {
    const place = this.browse(folder, number);

    if (!place) {
      return false;
    }

    const [, sector, within] = place;
    const bytes = this.readSector(sector);

    bytes.set(slot, within);
    this.writeSector(sector, bytes);

    return true;
  }

  /**
   * An entry put in the first slot of a folder deleted or never used, a
   * folder grown by a cluster where its clusters have none; the root not
   * past its room (`addDirectoryEntry`, 1070-1110).
   */
  addDirectoryEntry(folder: number, slot: Slot) {
    for (let at = 0; ; at = (at + 1) & 0xffff) {
      const logical = Math.floor(at / 16);
      const within = (at % 16) * 32;
      let sector: number;

      if (folder === 0) {
        if (at >= this.rootEntries) {
          return false;
        }

        sector = this.firstRootDirSect + logical;
      } else {
        sector = this.getAbsoluteSectFromChain(folder, logical);

        if (sector === 0) {
          if (this.appendCluster(folder) === 0) {
            return false;
          }

          sector = this.getAbsoluteSectFromChain(folder, logical);

          if (sector === 0) {
            return false;
          }
        }
      }

      const bytes = this.readSector(sector);

      if (bytes[within] === 0xe5 || bytes[within] === 0) {
        bytes.set(slot, within);
        this.writeSector(sector, bytes);

        return true;
      }
    }
  }

  /**
   * A file made, or emptied where it is there, and opened read and written
   * (`FileCreate`, 773-814): one there keeps its clusters and attributes,
   * its size nought; one made has a zeroed entry, its name and the
   * attributes asked for alone.
   */
  fileCreate(parts: string[], attributes: number): FatFile | null {
    let entry = this.getFileDirEntry(parts);

    if (entry) {
      const [slot, folder, index] = entry;

      slot.fill(0, 28, 32);
      this.directoryChange(folder, slot, index);
    } else {
      const name = namesOf(parts).at(-1);
      const folder = this.getDirClustNum(parts, true);

      if (name === undefined || folder === null) {
        return null;
      }

      const slot = new Uint8Array(32);

      slot.set(convToDirFile(name));
      slot[11] = attributes & 0xff;
      this.addDirectoryEntry(folder, slot);
      entry = this.getFileDirEntry(parts);

      if (!entry) {
        return null;
      }
    }

    return new FatFile(this, entry[0], entry[1], entry[2], OPEN_READWRITE);
  }

  /** A file deleted: its entry's first byte E5h, its chain freed (`FileUnlink`, 843-855). */
  fileUnlink(parts: string[]) {
    const entry = this.getFileDirEntry(parts);

    if (!entry) {
      return false;
    }

    const [slot, folder, index] = entry;

    slot[0] = 0xe5;
    this.directoryChange(folder, slot, index);

    if (firstCluster(slot) !== 0) {
      this.deleteClustChain(firstCluster(slot));
    }

    return true;
  }

  /**
   * A folder made where none is (`MakeDir`, 1123-1173): the first free
   * cluster taken and zeroed, an entry with its name and the folder's bit
   * alone, then `.` and `..` in it, `..` the parent's cluster.
   */
  makeDir(parts: string[]) {
    const name = namesOf(parts).at(-1);

    if (name === undefined || this.getDirClustNum(parts, false) !== null) {
      return false;
    }

    const cluster = this.getFirstFreeClust();

    if (cluster === 0 || !this.allocateCluster(cluster, 0)) {
      return false;
    }

    this.zeroOutCluster(cluster);

    const parent = this.getDirClustNum(parts, true);

    if (parent === null) {
      return false;
    }

    const entry = (eleven: Uint8Array, target: number) => {
      const slot = new Uint8Array(32);

      slot.set(eleven);
      slot[11] = DIRECTORY;
      slot[20] = (target >>> 16) & 0xff;
      slot[21] = (target >>> 24) & 0xff;
      slot[26] = target & 0xff;
      slot[27] = (target >> 8) & 0xff;

      return slot;
    };
    const dots = (text: string) =>
      convToDirFile('').map((space, at) => text.charCodeAt(at) || space);

    this.addDirectoryEntry(parent, entry(convToDirFile(name), cluster));
    this.addDirectoryEntry(cluster, entry(dots('.'), cluster));
    this.addDirectoryEntry(cluster, entry(dots('..'), parent));

    return true;
  }

  /**
   * An empty folder deleted (`RemoveDir`, 1175-1226): not the root; not one
   * with a slot past `.` and `..` that is not deleted; its entry found in
   * its parent by its eleven characters, E5h put first, its chain freed.
   */
  removeDir(parts: string[]) {
    const name = namesOf(parts).at(-1);
    const cluster = this.getDirClustNum(parts, false);

    if (name === undefined || cluster === null || cluster === 0) {
      return false;
    }

    const eleven = convToDirFile(name);
    const parent = this.getDirClustNum(parts, true);

    if (parent === null) {
      return false;
    }

    for (let index = 2, slot; (slot = this.directoryBrowse(cluster, index)); index++) {
      if (slot[0] !== 0xe5) {
        return false;
      }
    }

    for (
      let index = parent === 0 ? 0 : 2, slot;
      (slot = this.directoryBrowse(parent, index));
      index++
    ) {
      if (sameBytes(slot.subarray(0, 11), eleven)) {
        slot[0] = 0xe5;
        this.directoryChange(parent, slot, index);
        this.deleteClustChain(cluster);

        return true;
      }
    }

    return false;
  }

  /**
   * A file renamed (`Rename`, 1228-1265): a copy of its entry, the new name
   * in it, put in the first slot free of the folder named, and the old
   * entry deleted; a folder is not found, nor a name there already.
   */
  rename(from: string[], to: string[]) {
    const old = this.getFileDirEntry(from);

    if (!old || this.getFileDirEntry(to)) {
      return false;
    }

    const name = namesOf(to).at(-1);
    const folder = this.getDirClustNum(to, true);

    if (name === undefined || folder === null) {
      return false;
    }

    const [slot, oldFolder, oldIndex] = old;
    const renamed = slot.slice();

    renamed.set(convToDirFile(name));
    this.addDirectoryEntry(folder, renamed);

    if (!this.getFileDirEntry(to)) {
      return false;
    }

    slot[0] = 0xe5;
    this.directoryChange(oldFolder, slot, oldIndex);

    return true;
  }

  /**
   * A file's or folder's attributes (`GetFileAttr`, 969-996): a file's
   * entry as it is found, else a folder's, looked for by its eleven
   * characters among its parent's slots.
   */
  getFileAttr(parts: string[]): number | null {
    const entry = this.getFileDirEntry(parts);

    if (entry) {
      return entry[0][11];
    }

    const name = namesOf(parts).at(-1);
    const parent = this.getDirClustNum(parts, true);

    if (name === undefined || parent === null) {
      return null;
    }

    const eleven = convToDirFile(name);

    for (
      let index = parent === 0 ? 0 : 2, slot;
      (slot = this.directoryBrowse(parent, index));
      index++
    ) {
      if (sameBytes(slot.subarray(0, 11), eleven)) {
        return slot[11];
      }
    }

    return null;
  }

  /** A folder's entries as a search for everything finds them, in the order of their slots. */
  listed(folder: number): Slot[] {
    const found: Slot[] = [];
    let at = 0;

    for (;;) {
      const [slot, next] = this.findNextInternal(folder, DIRECTORY | HIDDEN | SYSTEM, '*.*', at);

      if (!slot) {
        return found;
      }

      found.push(slot);
      at = next;

      if (at === 0) {
        return found;
      }
    }
  }

  /** The volume's room (`AllocationInfo`, 730-751). */
  allocation() {
    let free = 0;

    for (let at = 0; at < this.countOfClusters; at++) {
      if (this.getClusterValue(at + 2) === 0) {
        free++;
      }
    }

    return {
      sectorsPerCluster: this.sectorsPerCluster,
      bytesPerSector: SECTOR,
      clusters: Math.min(this.countOfClusters, 0xffff),
      free: Math.min(free, 0xffff),
    };
  }
}

/**
 * A file of a disk image open, as DOSBox's `fatFile` keeps one: where it
 * begins and how long it is, where the next read or write is, the sector it
 * is in read into a buffer of its own, and where its entry is. As
 * `files/fat.rs`'s `ImageFile`.
 */
export class FatFile {
  readonly drive: FatDrive;
  firstCluster: number;
  seekpos = 0;
  filelength: number;
  currentSector = 0;
  curSectOff = 0;
  sectorBuffer: Uint8Array = new Uint8Array(SECTOR);
  loadedSector = false;
  readonly dirCluster: number;
  readonly dirIndex: number;
  /** The mode it was opened in: one opened to read is not written, one opened to write not read. */
  flags: number;
  /** Its entry's creation stamp as it was opened, which 5700h answers (832-834). */
  readonly time: number;
  readonly date: number;

  /** A file opened (`fatFile::fatFile`, 89-105): its first sector read, where it has any bytes. */
  constructor(drive: FatDrive, slot: Slot, folder: number, index: number, flags: number) {
    this.drive = drive;
    this.firstCluster = firstCluster(slot);
    this.filelength = sizeOf(slot);
    this.dirCluster = folder;
    this.dirIndex = index;
    this.flags = flags;
    this.time = word(slot, 14);
    this.date = word(slot, 16);

    if (this.filelength > 0) {
      this.seek(0, 0);
      this.sectorBuffer = this.drive.readSector(this.currentSector);
      this.loadedSector = true;
    }
  }

  refusesRead() {
    return (this.flags & 0x0f) === OPEN_WRITE;
  }

  refusesWrite() {
    return (this.flags & 0x0f) === OPEN_READ;
  }

  /** Bytes read from where it is (`fatFile::Read`, 107-158). */
  read(length: number): Uint8Array {
    const data: number[] = [];
    const drive = this.drive;

    if (this.seekpos >= this.filelength) {
      return new Uint8Array(0);
    }

    if (!this.loadedSector) {
      this.currentSector = drive.getAbsoluteSectFromBytePos(this.firstCluster, this.seekpos);

      if (this.currentSector === 0) {
        return new Uint8Array(0);
      }

      this.curSectOff = 0;
      this.sectorBuffer = drive.readSector(this.currentSector);
      this.loadedSector = true;
    }

    while (data.length < length) {
      if (this.seekpos >= this.filelength) {
        break;
      }

      data.push(this.sectorBuffer[this.curSectOff % SECTOR]);
      this.curSectOff++;
      this.seekpos++;

      if (this.curSectOff >= SECTOR) {
        this.currentSector = drive.getAbsoluteSectFromBytePos(this.firstCluster, this.seekpos);

        if (this.currentSector === 0) {
          this.loadedSector = false;
          break;
        }

        this.curSectOff = 0;
        this.sectorBuffer = drive.readSector(this.currentSector);
        this.loadedSector = true;
      }
    }

    return Uint8Array.from(data);
  }

  /**
   * Bytes written where it is (`fatFile::Write`, 160-236): a file of none
   * given the first free cluster, one at its chain's end another, each
   * sector written as it is left and the last as the write ends; then its
   * entry's size and first cluster -- and nothing else, no stamp. How many
   * were written.
   */
  write(bytes: Uint8Array): number {
    const drive = this.drive;
    let count = 0;

    write: {
      for (const byte of bytes) {
        if (this.seekpos >= this.filelength) {
          if (this.filelength === 0) {
            this.firstCluster = drive.getFirstFreeClust();
            drive.allocateCluster(this.firstCluster, 0);
            this.currentSector = drive.getAbsoluteSectFromBytePos(this.firstCluster, this.seekpos);
            this.sectorBuffer = drive.readSector(this.currentSector);
            this.loadedSector = true;
          }

          this.filelength = this.seekpos + 1;

          if (!this.loadedSector) {
            this.currentSector = drive.getAbsoluteSectFromBytePos(this.firstCluster, this.seekpos);

            if (this.currentSector === 0) {
              drive.appendCluster(this.firstCluster);
              this.currentSector = drive.getAbsoluteSectFromBytePos(
                this.firstCluster,
                this.seekpos
              );

              if (this.currentSector === 0) {
                break write;
              }
            }

            this.curSectOff = 0;
            this.sectorBuffer = drive.readSector(this.currentSector);
            this.loadedSector = true;
          }
        }

        this.sectorBuffer[this.curSectOff % SECTOR] = byte;
        this.curSectOff++;
        count++;
        this.seekpos++;

        if (this.curSectOff >= SECTOR) {
          if (this.loadedSector) {
            drive.writeSector(this.currentSector, this.sectorBuffer);
          }

          this.currentSector = drive.getAbsoluteSectFromBytePos(this.firstCluster, this.seekpos);

          if (this.currentSector === 0) {
            drive.appendCluster(this.firstCluster);
            this.currentSector = drive.getAbsoluteSectFromBytePos(this.firstCluster, this.seekpos);

            if (this.currentSector === 0) {
              this.loadedSector = false;
              break write;
            }
          }

          this.curSectOff = 0;
          this.sectorBuffer = drive.readSector(this.currentSector);
          this.loadedSector = true;
        }
      }

      if (this.curSectOff > 0 && this.loadedSector) {
        drive.writeSector(this.currentSector, this.sectorBuffer);
      }
    }

    /* `finalizeWrite`: the entry read again, its size and first cluster
     * set, written back. */
    const slot = drive.directoryBrowse(this.dirCluster, this.dirIndex);

    if (slot) {
      new DataView(slot.buffer, slot.byteOffset).setUint32(28, this.filelength >>> 0, true);
      slot[26] = this.firstCluster & 0xff;
      slot[27] = (this.firstCluster >> 8) & 0xff;
      drive.directoryChange(this.dirCluster, slot, this.dirIndex);
    }

    return count;
  }

  /**
   * DOSBox's `fatFile::Seek` (238-268): from the start (0), from where it
   * is (1) or from its end (2); no further than its end, nor before its
   * start; the sector there read. Where it is now.
   */
  seek(position: number, basis: number) {
    let to: number;

    if (basis === 0) {
      to = position | 0;
    } else if (basis === 1) {
      to = ((position | 0) + (this.seekpos | 0)) | 0;
    } else {
      to = ((this.filelength | 0) + (position | 0)) | 0;
    }

    if (to >>> 0 > this.filelength) {
      to = this.filelength;
    }

    if (to < 0) {
      to = 0;
    }

    this.seekpos = to >>> 0;
    this.currentSector = this.drive.getAbsoluteSectFromBytePos(this.firstCluster, this.seekpos);

    if (this.currentSector === 0) {
      this.loadedSector = false;
    } else {
      this.curSectOff = this.seekpos % SECTOR;
      this.sectorBuffer = this.drive.readSector(this.currentSector);
    }

    return this.seekpos;
  }

  /** Closed: its sector written back where one is read, written to or not (`fatFile::Close`, 270-275). */
  close() {
    if (this.loadedSector) {
      this.drive.writeSector(this.currentSector, this.sectorBuffer);
    }
  }
}
