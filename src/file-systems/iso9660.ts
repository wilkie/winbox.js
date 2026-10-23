import { File, FileSystem } from '../file-system.js';
import { wildFileCmp } from './fat-drive.js';

/**
 * An ISO 9660 disc image as a CD-ROM drive, read as DOSBox 0.74-3's
 * `isoDrive` reads one (`drive_iso.cpp`, its image through
 * `CDROM_Interface_Image`, `cdrom_image.cpp`): the primary volume
 * descriptor at sector 16 alone, no Joliet or Rock Ridge; each record's name
 * as `readDirEntry` makes it (its `;1` and a trailing dot gone, cut to eight
 * before its dot and twelve in all); folders in the disc's order, the root
 * without `.` and `..`; names upper-cased as a search lists them and found
 * without regard to case; nothing written. **Recorded** by `imgcd` and
 * `drvioctl`. As the Rust engine's `IsoVolume` (`files/iso.rs`), function
 * for function: a record is copied over the one before it as `memcpy`
 * copies it, a record DOSBox cannot read ends its folder, and a search's
 * place is one of the drive's 2,048 directory iterators, its number in the
 * search's record.
 */

/** A sector's bytes as a drive reads them, cooked (`ISO_FRAMESIZE`). */
const ISO_FRAMESIZE = 2048;

/** A raw sector's bytes, sync and header with them (`RAW_SECTOR_SIZE`). */
const RAW_SECTOR_SIZE = 2352;

/** The first volume descriptor's sector (`ISO_FIRST_VD`). */
const ISO_FIRST_VD = 16;

/** A record's flags: bit 1 a folder, bit 0 the existence bit, which DOSBox takes for hidden. */
const ISO_DIRECTORY = 2;
const ISO_HIDDEN = 1;

/** How much of two names `lookup` compares (`ISO_MAX_FILENAME_LENGTH`). */
const ISO_MAX_FILENAME_LENGTH = 37;

/** How many directory iterators a drive has (`MAX_OPENDIRS`, `dos_system.h` 124). */
const MAX_OPENDIRS = 2048;

const DOS_ATTR_READ_ONLY = 0x01;
const DOS_ATTR_HIDDEN = 0x02;
const DOS_ATTR_SYSTEM = 0x04;
const DOS_ATTR_VOLUME = 0x08;
const DOS_ATTR_DIRECTORY = 0x10;
const DOS_ATTR_ARCHIVE = 0x20;

/** The disc's one data track as `LoadIsoFile` finds it (`cdrom_image.cpp` 350-382). */
interface Track {
  sectorSize: number;
  skip: number;
  length: number;
}

/**
 * The first layout whose sector 16 is a primary volume descriptor
 * (`CanReadPVD`, 395-404): cooked 2,048-byte sectors, raw 2,352 (their data
 * 16 in), mode 2 of 2,336 or 2,352 (24 in). An image too short to hold it
 * fails the stream's read.
 */
function detectTrack(bytes: Uint8Array): Track | null {
  for (const [sectorSize, skip] of [
    [2048, 0],
    [RAW_SECTOR_SIZE, 16],
    [2336, 24],
    [RAW_SECTOR_SIZE, 24],
  ]) {
    const seek = 16 * sectorSize + skip;

    if (seek + ISO_FRAMESIZE > bytes.byteLength) {
      continue;
    }

    const pvd = bytes.subarray(seek, seek + ISO_FRAMESIZE);

    if (pvd[0] === 1 && String.fromCharCode(...pvd.subarray(1, 6)) === 'CD001' && pvd[6] === 1) {
      return { sectorSize, skip, length: Math.floor(bytes.byteLength / sectorSize) };
    }
  }

  return null;
}

/**
 * A directory record as DOSBox's `isoDirEntry` holds it, its bytes as the
 * disc has them but its name, which `readDirEntry` makes a C string in
 * place: the length (0), the extended attributes' (1), the extent (2) and
 * the data's length (10), little-endian first, the date and time from 1900
 * (18-24), the flags (25), the unit size and gap (26, 27), the name's length
 * (32) and the name (33). As `iso.rs`'s `DirEntry`.
 */
class DirEntry {
  readonly bytes = new Uint8Array(256);

  clone() {
    const copy = new DirEntry();

    copy.bytes.set(this.bytes);

    return copy;
  }

  #long(at: number) {
    return (
      (this.bytes[at] |
        (this.bytes[at + 1] << 8) |
        (this.bytes[at + 2] << 16) |
        (this.bytes[at + 3] << 24)) >>>
      0
    );
  }

  /** `EXTENT_LOCATION`. */
  get extent() {
    return this.#long(2);
  }

  /** `DATA_LENGTH`. */
  get dataLength() {
    return this.#long(10);
  }

  get isDir() {
    return (this.bytes[25] & ISO_DIRECTORY) !== 0;
  }

  get isHidden() {
    return (this.bytes[25] & ISO_HIDDEN) !== 0;
  }

  /** The name as `readDirEntry` left it, to its first nought. */
  get ident() {
    const name = this.bytes.subarray(33);
    const end = name.indexOf(0);

    return name.subarray(0, end < 0 ? name.length : end);
  }

  /** A C string written over the name from a place in it, as `strcpy` writes one. */
  setIdentAt(at: number, text: Uint8Array | number[]) {
    this.bytes.set(text, 33 + at);
    this.bytes[33 + at + text.length] = 0;
  }

  /**
   * The time `DOS_PackTime` and the date `DOS_PackDate(1900 + year, ...)`
   * make of its stamp, each part masked as they mask it (`dos_inc.h`
   * 220-226), the offset from GMT not looked at (`drive_iso.cpp` 312-313).
   */
  get stamp(): [number, number] {
    const b = this.bytes;

    return [
      ((b[21] & 0x1f) << 11) | ((b[22] & 0x3f) << 5) | ((b[23] >> 1) & 0x1f),
      ((((1900 + b[18] - 1980) & 0xffff & 0x7f) << 9) | ((b[19] & 0x3f) << 5) | (b[20] & 0x1f)) &
        0xffff,
    ];
  }

  /**
   * What a search lists it as (`FindNext`, 296-314): its name upper case,
   * its size, 10h a folder or else 20h, 02h with it where it is hidden;
   * its stamp as the two words DOS packs.
   */
  get findInfo() {
    const [time, date] = this.stamp;
    let attributes = this.isDir ? DOS_ATTR_DIRECTORY : DOS_ATTR_ARCHIVE;

    if (this.isHidden) {
      attributes |= DOS_ATTR_HIDDEN;
    }

    return {
      name: String.fromCharCode(...this.ident).replace(/[a-z]/g, (c) => c.toUpperCase()),
      attributes,
      directory: this.isDir,
      hidden: this.isHidden,
      archive: !this.isDir,
      size: this.dataLength,
      time: { hour: time >> 11, minute: (time >> 5) & 0x3f, second: (time & 0x1f) * 2 },
      date: { year: (date >> 9) + 1980, month: (date >> 5) & 0x0f, day: date & 0x1f },
    };
  }
}

/** The bytes of a C string's text. */
function bytesOf(text: string) {
  return Array.from(text, (character) => character.charCodeAt(0) & 0xff);
}

/**
 * `readDirEntry` (476-514): a record copied over `de` -- its first byte's
 * count of bytes, what was there before kept past them -- and its name made
 * DOS's: `.` and `..` for a folder's own two, a file's version from its
 * first `;` and a dot left at its end taken off, the part before its dot
 * cut to eight and the whole to twelve. Its length, or -1 for a record
 * DOSBox does not read: extended attributes, interleaving, a name longer
 * than the record or than 200 bytes.
 */
function readDirEntry(de: DirEntry, data: Uint8Array) {
  const count = Math.min(data[0], data.length);

  de.bytes.set(data.subarray(0, count), 0);

  if (de.bytes[1] !== 0 || de.bytes[26] !== 0 || de.bytes[27] !== 0) {
    return -1;
  }

  const identLength = de.bytes[32];

  if (de.bytes[0] < 33 + identLength) {
    return -1;
  }

  if (de.isDir) {
    if (identLength === 1 && de.bytes[33] === 0) {
      de.setIdentAt(0, bytesOf('.'));
    } else if (identLength === 1 && de.bytes[33] === 1) {
      de.setIdentAt(0, bytesOf('..'));
    } else {
      if (identLength > 200) {
        return -1;
      }

      de.bytes[33 + identLength] = 0;
    }
  } else {
    if (identLength > 200) {
      return -1;
    }

    de.bytes[33 + identLength] = 0;

    /* `strreplace(ident, ';', 0)`: the name ends at its first `;`. */
    const semicolon = de.ident.indexOf(0x3b);

    if (semicolon >= 0) {
      de.bytes[33 + semicolon] = 0;
    }

    const length = de.ident.length;

    if (length > 0 && de.bytes[33 + length - 1] === 0x2e) {
      de.bytes[33 + length - 1] = 0;
    }
  }

  const dot = de.ident.indexOf(0x2e);

  if (dot > 8) {
    de.setIdentAt(8, Array.from(de.ident.subarray(dot)));
  }

  if (de.ident.length > 12) {
    de.bytes[33 + 12] = 0;
  }

  return de.bytes[0];
}

/** `strncasecmp(a, b, ISO_MAX_FILENAME_LENGTH) == 0`. */
function strncasecmp(a: Uint8Array, b: string) {
  const cut = (text: string) => text.substring(0, ISO_MAX_FILENAME_LENGTH).toLowerCase();

  return cut(String.fromCharCode(...a)) === cut(b);
}

/**
 * `Set_Label(input, output, cdrom = true)` (`drives.cpp` 80-108): eight
 * characters, a dot, three more, case kept; a dot at its end taken off but
 * where it is the ninth, MSCDEX's way.
 */
export function setLabel(input: string) {
  let output = '';
  let togo = 8;
  let vnamePos = 0;
  let point = false;

  while (togo > 0) {
    if (vnamePos >= input.length || input.charCodeAt(vnamePos) === 0) {
      break;
    }

    if (!point && input[vnamePos] === '.') {
      togo = 4;
      point = true;
    }

    output += input[vnamePos];
    vnamePos++;
    togo--;

    if (togo === 0 && !point) {
      if (input[vnamePos] === '.') {
        vnamePos++;
      }

      output += '.';
      point = true;
      togo = 3;
    }
  }

  if (output.endsWith('.') && output.length !== 9) {
    output = output.substring(0, output.length - 1);
  }

  return output;
}

/**
 * The volume's name as MSCDEX's `GetVolumeName` reads it (`dos_mscdex.cpp`
 * 561-597): sector 16's bytes from 40, at most 31 and to a nought, white
 * space at the end taken off (`rtrim`).
 */
function volumeName(pvd: Uint8Array) {
  let name = '';

  for (const byte of pvd.subarray(40, 71)) {
    if (byte === 0) {
      break;
    }

    name += String.fromCharCode(byte);
  }

  return name.replace(/[ \t\n\v\f\r]+$/, '');
}

/** One of the drive's directory iterators (`dirIterators`). */
interface DirIterator {
  valid: boolean;
  root: boolean;
  currentSector: number;
  endSector: number;
  pos: number;
}

/** The disc as DOSBox's `isoDrive` holds it. As `iso.rs`'s `Disc`. */
export class IsoDrive {
  readonly #bytes: Uint8Array;
  readonly #track: Track;
  rootEntry = new DirEntry();
  /** The label `Set_Label` makes of the volume's name (`discLabel`). */
  discLabel = '';
  readonly dirIterators: DirIterator[] = Array.from({ length: MAX_OPENDIRS }, () => ({
    valid: false,
    root: false,
    currentSector: 0,
    endSector: 0,
    pos: 0,
  }));
  nextFreeDirIterator = 0;

  constructor(bytes: Uint8Array, track: Track) {
    this.#bytes = bytes;
    this.#track = track;
  }

  /**
   * A cooked sector of the data track (`CDROM_Interface_Image::ReadSector`,
   * `cdrom_image.cpp` 301-313); null past the track's whole sectors.
   */
  readSector(sector: number): Uint8Array | null {
    if (sector >= this.#track.length) {
      return null;
    }

    const at = sector * this.#track.sectorSize + this.#track.skip;

    return this.#bytes.subarray(at, at + ISO_FRAMESIZE);
  }

  /** `GetDirIterator` (390-408). */
  getDirIterator(de: DirEntry) {
    const handle = this.nextFreeDirIterator;
    const length = de.dataLength;
    let endSector = (de.extent + Math.floor(length / ISO_FRAMESIZE) - 1) >>> 0;

    if (length % ISO_FRAMESIZE !== 0) {
      endSector = (endSector + 1) >>> 0;
    }

    Object.assign(this.dirIterators[handle], {
      valid: true,
      currentSector: de.extent,
      endSector,
      pos: 0,
    });
    this.nextFreeDirIterator = (this.nextFreeDirIterator + 1) % MAX_OPENDIRS;

    return handle;
  }

  /** `GetNextDirEntry` (410-439): the next record into `de`; false at the folder's end, or where it cannot be read. */
  getNextDirEntry(handle: number, de: DirEntry) {
    const iterator = this.dirIterators[handle];

    if (!iterator.valid) {
      return false;
    }

    let buffer = this.readSector(iterator.currentSector);

    if (!buffer) {
      return false;
    }

    const pos = iterator.pos;

    if (pos >= ISO_FRAMESIZE || buffer[pos] === 0 || pos + buffer[pos] > ISO_FRAMESIZE) {
      if (iterator.currentSector < iterator.endSector) {
        iterator.pos = 0;
        iterator.currentSector++;
        buffer = this.readSector(iterator.currentSector);

        if (!buffer) {
          return false;
        }
      } else {
        return false;
      }
    }

    const length = readDirEntry(de, buffer.subarray(iterator.pos));

    iterator.pos = (iterator.pos + length) >>> 0;

    return length >= 0;
  }

  /** `FreeDirIterator` (441-452). */
  freeDirIterator(handle: number) {
    this.dirIterators[handle].valid = false;

    if ((handle + 1) % MAX_OPENDIRS === this.nextFreeDirIterator) {
      this.nextFreeDirIterator =
        this.nextFreeDirIterator > 0 ? this.nextFreeDirIterator - 1 : MAX_OPENDIRS - 1;
    }
  }

  /** `lookup` (528-562). */
  lookup(names: string[]): DirEntry | null {
    const de = this.rootEntry.clone();

    for (const whole of names) {
      let found = false;

      if (de.isDir) {
        const name = whole.endsWith('.') ? whole.substring(0, whole.length - 1) : whole;
        const handle = this.getDirIterator(de.clone());

        while (!found && this.getNextDirEntry(handle, de)) {
          found = strncasecmp(de.ident, name);
        }

        this.freeDirIterator(handle);
      }

      if (!found) {
        return null;
      }
    }

    return de;
  }

  /** `FileUnlink`, `RemoveDir`, `MakeDir`, `Rename` (225-243, 325-328): each refused. */
  fileUnlink(_path: string[]) {
    return false;
  }

  removeDir(_path: string[]) {
    return false;
  }

  makeDir(_path: string[]) {
    return false;
  }

  rename(_from: string[], _to: string[]) {
    return false;
  }

  /** `FindNext` (286-323). */
  findNext(handle: number, attributes: number, pattern: string) {
    const isRoot = this.dirIterators[handle].root;
    const de = new DirEntry();

    while (this.getNextDirEntry(handle, de)) {
      const info = de.findInfo;

      if (
        !(isRoot && de.ident[0] === 0x2e) &&
        wildFileCmp(String.fromCharCode(...de.ident), pattern) &&
        (~attributes &
          info.attributes &
          (DOS_ATTR_DIRECTORY | DOS_ATTR_HIDDEN | DOS_ATTR_SYSTEM)) ===
          0
      ) {
        return info;
      }
    }

    this.freeDirIterator(handle);

    return null;
  }
}

/** A path's names, without the empty ones. */
function namesOf(path: string[]) {
  return path.filter((part) => part !== '');
}

/** A folder of the disc, as the engine's DOS looks one over. */
class DiscFolder {
  readonly info: any;
  readonly parts: string[];
  readonly #disc: ISO9660;

  constructor(disc: ISO9660, parts: string[], info: any) {
    this.#disc = disc;
    this.parts = parts;
    this.info = info;
  }

  get path() {
    return this.parts.join('\\');
  }

  /** Its entries in the disc's order: a folder's as one, a file's as its entry. */
  async list() {
    return this.#disc
      .children(this.parts)
      .map((info: any) =>
        info.directory ? new DiscFolder(this.#disc, [...this.parts, info.name], info) : { info }
      );
  }

  /** An entry by its name, without regard to case. */
  async lookup(name: string) {
    return (
      (await this.list()).find(
        (entry: any) => entry.info.name.toUpperCase() === name.replace(/\.$/, '').toUpperCase()
      ) ?? null
    );
  }
}

/**
 * A file of the disc open, as DOSBox's `isoFile` keeps one (31-132): where
 * it begins and ends in the image, where the next read is, and its record's
 * stamp. As `iso.rs`'s `DiscFile`.
 */
class DiscFile extends File {
  readonly path: string;
  readonly #drive: IsoDrive;
  readonly #fileBegin: number;
  readonly #fileEnd: number;
  #filePos: number;
  readonly #stamp: [number, number];

  constructor(drive: IsoDrive, parts: string[], de: DirEntry) {
    super(de.findInfo);
    this.#drive = drive;
    this.path = parts.join('\\');
    this.#fileBegin = Math.imul(de.extent, ISO_FRAMESIZE) >>> 0;
    this.#filePos = this.#fileBegin;
    this.#fileEnd = (this.#fileBegin + de.dataLength) >>> 0;
    this.#stamp = de.stamp;
  }

  get size() {
    return (this.#fileEnd - this.#fileBegin) >>> 0;
  }

  /** Its record's stamp as it was opened, which 5700h answers: the time and the date. */
  get dosStamp(): [number, number] {
    return this.#stamp;
  }

  /** A write is refused: `isoFile::Write` fails (100-102). */
  refusesWrite() {
    return true;
  }

  refusesRead() {
    return false;
  }

  /** A disc's file has bit 6 of its device information set (`isoFile::GetInformation`, 130-132). */
  get onDisc() {
    return true;
  }

  /** `isoFile::Seek` (104-123): past its end, or before its start, its end. */
  dosSeek(position: number, basis: number) {
    const pos = position >>> 0;

    this.#filePos =
      basis === 0
        ? (this.#fileBegin + pos) >>> 0
        : basis === 1
          ? (this.#filePos + pos) >>> 0
          : (this.#fileEnd + pos) >>> 0;

    if (this.#filePos > this.#fileEnd || this.#filePos < this.#fileBegin) {
      this.#filePos = this.#fileEnd;
    }

    this.position = this.#filePos - this.#fileBegin;

    return this.position;
  }

  /**
   * Bytes read from where it is (`isoFile::Read`, 63-98): no more than is
   * left of it, a sector at a time, stopping at a sector the image does not
   * hold.
   */
  readHere(count: number) {
    const length = Math.min(count & 0xffff, (this.#fileEnd - this.#filePos) >>> 0);
    const data = new Uint8Array(length);
    let done = 0;
    let sector = Math.floor(this.#filePos / ISO_FRAMESIZE);
    let sectorPos = this.#filePos % ISO_FRAMESIZE;

    while (done < length) {
      const buffer = this.#drive.readSector(sector);

      if (!buffer) {
        break;
      }

      const take = Math.min(ISO_FRAMESIZE - sectorPos, length - done);

      data.set(buffer.subarray(sectorPos, sectorPos + take), done);
      done += take;
      sectorPos = 0;
      sector++;
    }

    this.#filePos = (this.#filePos + done) >>> 0;

    return data.subarray(0, done);
  }

  async read(offset: number, length: number) {
    if (offset !== (this.#filePos - this.#fileBegin) >>> 0) {
      this.dosSeek(offset, 0);
    }

    const bytes = this.readHere(length);

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

  async write(_offset: number, _data: any) {
    return 0;
  }

  /** DOS's write of nought bytes: nothing on a disc. */
  async end(_at: number) {}

  /** Nothing stamped. */
  async stamp(_at: Date) {}

  close() {}
}

/** An ISO 9660 disc image mounted as a CD-ROM drive. As `iso.rs`'s `IsoVolume`. */
export class ISO9660 extends FileSystem {
  readonly drive: IsoDrive;

  constructor(drive: IsoDrive) {
    super({});
    this.drive = drive;
  }

  /**
   * The disc an image holds, as `isoDrive`'s constructor mounts it
   * (141-177): its track found, sector 16 a primary volume descriptor whose
   * root record is read (`loadImage`), its label from the volume's name.
   */
  static of(bytes: Uint8Array) {
    const track = detectTrack(bytes);

    if (!track) {
      throw new Error('not an ISO 9660 disc');
    }

    const drive = new IsoDrive(bytes, track);
    const pvd = drive.readSector(ISO_FIRST_VD)!;
    const root = new DirEntry();

    if (readDirEntry(root, pvd.subarray(156)) <= 0) {
      throw new Error('a corrupt disc image');
    }

    drive.rootEntry = root;
    drive.discLabel = setLabel(volumeName(pvd));

    return new ISO9660(drive);
  }

  /** `isRemovable` (378-380). */
  get removable() {
    return true;
  }

  /** `isRemote` (374-376). */
  get remote() {
    return true;
  }

  get label() {
    return this.drive.discLabel || null;
  }

  /** `imgmount -t iso`'s (`dos_programs.cpp` 1102-1104). */
  get mediaByte() {
    return 0xf8 as const;
  }

  get listing(): 'sorted' | 'stored' {
    return 'stored';
  }

  /** The record a path names, as `lookup` finds it. */
  #lookup(path: string[]) {
    return this.drive.lookup(namesOf(path));
  }

  /** The folder's records as a search for everything lists them, the root's `.` and `..` left out. */
  children(path: string[]) {
    const de = this.#lookup(path);

    if (!de) {
      return [];
    }

    const handle = this.drive.getDirIterator(de);
    const entries: any[] = [];
    let info: any;

    this.drive.dirIterators[handle].root = namesOf(path).length === 0;

    while ((info = this.drive.findNext(handle, 0xff, '????????.???'))) {
      entries.push(info);
    }

    return entries;
  }

  /** What a path names: a folder, else a file as `FileOpen` finds one, opened; null where neither is. */
  async open(path: string[], _create = false): Promise<any> {
    const parts = namesOf(path);
    const de = this.#lookup(parts);

    if (!de) {
      return null;
    }

    if (!parts.length) {
      return new DiscFolder(this, [], { ...de.findInfo, name: '' });
    }

    if (de.isDir) {
      return new DiscFolder(this, parts, de.findInfo);
    }

    return new DiscFile(this.drive, parts, de);
  }

  async list(path: string[]) {
    return (await this.open(path))?.list?.() ?? [];
  }

  /** `FileCreate` (225-228): access denied. */
  async create(_path: string[], _options: any = {}) {
    return null;
  }

  async map(_path, _data, _options = {}): Promise<any> {
    throw new Error('a disc is not written');
  }

  /** `TestDir` (245-248). */
  testDir(path: string[]) {
    return Boolean(this.#lookup(path)?.isDir);
  }

  /** `GetFileAttr` (330-340): 21h, 02h with it where hidden, 10h where a folder; null where not found. */
  attributes(path: string[]) {
    const de = this.#lookup(path);

    if (!de) {
      return null;
    }

    let attributes = DOS_ATTR_ARCHIVE | DOS_ATTR_READ_ONLY;

    if (de.isHidden) {
      attributes |= DOS_ATTR_HIDDEN;
    }

    if (de.isDir) {
      attributes |= DOS_ATTR_DIRECTORY;
    }

    return attributes;
  }

  /**
   * `FindFirst` (250-284): the folder looked up, folder or not; an iterator
   * taken for it, whose number the search's record keeps; the label alone
   * asked for, the label or no more files; the label with other
   * attributes, in the root, where the pattern takes it, the label first;
   * else `FindNext`. The iterator and the entry, null where none; or DOS's
   * error.
   */
  findFirst(path: string[], attributes: number, pattern: string): [number, any] | number {
    const de = this.#lookup(path);

    if (!de) {
      return 3;
    }

    const handle = this.drive.getDirIterator(de);
    const isRoot = namesOf(path).length === 0;
    const label = {
      name: this.drive.discLabel,
      attributes: DOS_ATTR_VOLUME,
      size: 0,
      time: { hour: 0, minute: 0, second: 0 },
      date: { year: 1980, month: 0, day: 0 },
    };

    this.drive.dirIterators[handle].root = isRoot;

    if (attributes === DOS_ATTR_VOLUME) {
      return [handle, this.drive.discLabel ? label : null];
    }

    if (attributes & DOS_ATTR_VOLUME && isRoot && wildFileCmp(label.name, pattern)) {
      return [handle, label];
    }

    return [handle, this.drive.findNext(handle, attributes, pattern)];
  }

  /** `FindNext` from the iterator the search's record names: the entry, or null, and the iterator. */
  findFrom(_folder: number, attributes: number, pattern: string, at: number): [any, number] {
    return [this.drive.findNext(at % MAX_OPENDIRS, attributes, pattern), at];
  }

  /** `AllocationInfo` (342-348): 2,048 bytes to a sector, a sector to a cluster, 60,000 clusters, none free. */
  async space() {
    return { sectorsPerCluster: 1, bytesPerSector: ISO_FRAMESIZE, clusters: 60000, free: 0 };
  }
}
