/**
 * A CD image's tracks as DOSBox 0.74-3's `CDROM_Interface_Image` holds
 * them (`cdrom_image.cpp`): what `SetDevice` (167-178) makes of an image's
 * file -- a cue sheet first (`LoadCueSheet`, 422-556), else one data track
 * (`LoadIsoFile`, 350-393) -- and the cooked sectors `isoDrive` reads
 * through it (`ReadSector`, 301-313, the track found by `GetTrack`,
 * 287-299). A disc's sector is the image's, counted from its first track's
 * start, whichever track holds the data: `isoDrive` reads sector 16 of the
 * whole disc (`loadImage`, `drive_iso.cpp` 516-526).
 *
 * As the Rust engine's `CdImage` (`crates/winbox-machine/src/files/cue.rs`),
 * function for function: the sheet read a line at a time as
 * `ifstream::getline` reads one into 512 bytes, its words as `>>` reads
 * them, `AddTrack`'s arithmetic as it is, and a file's stream failing for
 * good once a read of it has failed. Audio tracks are kept in the list but
 * never played.
 */

/** A raw sector's bytes, sync and header with them (`RAW_SECTOR_SIZE`). */
export const RAW_SECTOR_SIZE = 2352;

/** A cooked sector's bytes (`COOKED_SECTOR_SIZE`). */
export const COOKED_SECTOR_SIZE = 2048;

/** A line's most bytes, its ending nought among them (`MAX_LINE_LENGTH`). */
const MAX_LINE_LENGTH = 512;

/** A quoted name's most bytes, its ending nought among them (`MAX_FILENAME_LENGTH`). */
const MAX_FILENAME_LENGTH = 256;

/**
 * The file types an audio track's `FILE` may name and DOSBox's SDL_sound
 * take: `WAVE`, `AIFF` and `MP3` by name (515-516), and the first extension
 * each decoder of the oracle's `libSDL_sound` 1.0 lists (517-524). As
 * `cue.rs`'s `AUDIO_TYPES`.
 */
export const AUDIO_TYPES = [
  'WAVE',
  'AIFF',
  'MP3',
  '669',
  'WAV',
  'AU',
  'OGG',
  'VOC',
  'RAW',
  'SHN',
  'FLAC',
  'spx',
];

/**
 * A `BINARY` file's bytes as DOSBox's `BinaryFile` reads them through an
 * `ifstream` (47-72): a read that cannot be done whole fails, and leaves the
 * stream failed, so that every read and length after it fails too.
 */
export class BinaryFile {
  readonly bytes: Uint8Array;
  #failed = false;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  /** `BinaryFile::read` (59-64): `buffer`'s length in bytes from `seek`, or false. */
  read(buffer: Uint8Array, seek: number) {
    if (this.#failed || seek < 0) {
      this.#failed = true;
      return false;
    }

    const got = this.bytes.subarray(seek, seek + buffer.length);

    buffer.fill(0);
    buffer.set(got);

    if (seek + buffer.length > this.bytes.length) {
      this.#failed = true;
      return false;
    }

    return true;
  }

  /** `BinaryFile::getLength` (66-72): the file's size; -1 once failed. */
  getLength() {
    return this.#failed ? -1 : this.bytes.length;
  }
}

/**
 * A track's file (`TrackFile`): a `BINARY` file's, or an audio file's,
 * which SDL_sound decodes -- kept, never read here, and so of no length
 * known.
 */
export type TrackFile = { binary: BinaryFile } | { audio: Uint8Array };

/** `getLength`: null for an audio file, which only SDL_sound measures. */
function lengthOf(file: TrackFile) {
  return 'binary' in file ? file.binary.getLength() : null;
}

/**
 * A track as `CDROM_Interface_Image::Track` holds it (`cdrom.h` 144-153).
 * `known` is false for a track whose start needed an audio file's length.
 * As `cue.rs`'s `CdTrack`.
 */
export interface CdTrack {
  number: number;
  attr: number;
  start: number;
  length: number;
  skip: number;
  sectorSize: number;
  mode2: boolean;
  file: number | null;
  known: boolean;
}

const emptyTrack = (): CdTrack => ({
  number: 0,
  attr: 0,
  start: 0,
  length: 0,
  skip: 0,
  sectorSize: 0,
  mode2: false,
  file: null,
  known: true,
});

/** Why a cue sheet was not taken. As `cue.rs`'s `CueFailure`. */
export type CueFailure =
  | { kind: 'not-text' }
  | { kind: 'command'; command: string }
  | { kind: 'track-type'; type: string }
  | { kind: 'file'; name: string; type: string }
  | { kind: 'frame' }
  | { kind: 'layout' };

/**
 * Why a cue sheet was not taken, on which line (from 1), and whether any
 * line before it was read as a cue sheet's.
 */
export class CueError extends Error {
  constructor(
    readonly line: number,
    readonly reason: CueFailure,
    readonly read = false
  ) {
    super(cueMessage(line, reason));
  }
}

function cueMessage(line: number, reason: CueFailure) {
  switch (reason.kind) {
    case 'not-text':
      return `line ${line} is too long for a cue sheet`;
    case 'command':
      return `line ${line}: DOSBox knows no command ${JSON.stringify(reason.command)}`;
    case 'track-type':
      return `line ${line}: DOSBox knows no track type ${JSON.stringify(reason.type)}`;
    case 'file':
      return reason.type === 'BINARY' || AUDIO_TYPES.includes(reason.type)
        ? `line ${line}: ${reason.name} not found`
        : `line ${line}: ${reason.name} is of a type DOSBox does not take (${JSON.stringify(reason.type)})`;
    case 'frame':
      return `line ${line}: a time not mm:ss:ff`;
    case 'layout':
      return `line ${line}: tracks DOSBox does not lay out`;
  }
}

/** `isspace` in the C locale, which `>>` skips. */
const isSpace = (c: number) => c === 0x20 || (c >= 0x09 && c <= 0x0d);

/**
 * A decimal integer as `%d` and `>> int` read one: a sign and digits; null
 * where no digit follows. How many bytes it took.
 */
function scanInt(text: Uint8Array, from: number): [number | null, number] {
  let at = from;
  const negative = text[at] === 0x2d;

  if (text[at] === 0x2d || text[at] === 0x2b) {
    at++;
  }

  const digits = at;

  while (at < text.length && text[at] >= 0x30 && text[at] <= 0x39) {
    at++;
  }

  if (at === digits) {
    return [null, 0];
  }

  let value = 0;

  for (let i = digits; i < at; i++) {
    value = value * 10 + (text[i] - 0x30);
  }

  return [negative ? -value : value, at - from];
}

const latin1 = (bytes: Uint8Array) => String.fromCharCode(...bytes);

/** A line as an `istringstream` of it is read (444): words by `>>`. As `cue.rs`'s `Line`. */
class Line {
  pos = 0;
  failed = false;

  constructor(readonly text: Uint8Array) {}

  /** `>> string`: white space skipped, the word to the next; nothing, and the stream failed, at its end. */
  word() {
    if (this.failed) {
      return '';
    }

    while (this.pos < this.text.length && isSpace(this.text[this.pos])) {
      this.pos++;
    }

    const from = this.pos;

    while (this.pos < this.text.length && !isSpace(this.text[this.pos])) {
      this.pos++;
    }

    if (from === this.pos) {
      this.failed = true;
    }

    return latin1(this.text.subarray(from, this.pos));
  }

  /** `>> int`: nought, and the stream failed, where there are no digits. */
  int() {
    if (this.failed) {
      return 0;
    }

    while (this.pos < this.text.length && isSpace(this.text[this.pos])) {
      this.pos++;
    }

    const [value, used] = scanInt(this.text, this.pos);

    this.pos += used;

    if (value === null) {
      this.failed = true;
      return 0;
    }

    return value;
  }

  /** `GetCueKeyword` (649-655): a word, upper-cased (ASCII alone, as `toupper` in the C locale). */
  keyword() {
    return this.word().replace(/[a-z]+/g, (letters) => letters.toUpperCase());
  }

  /** `GetCueFrame` (657-666): a word read as `%d:%d:%d`, in frames (`MSF_TO_FRAMES`: 75 to a second). */
  frame(): number | null {
    const msf = Uint8Array.from(this.word(), (c) => c.charCodeAt(0));
    const parts = [0, 0, 0];
    let at = 0;

    for (let part = 0; part < 3; part++) {
      if (part > 0) {
        if (msf[at] !== 0x3a) {
          return null;
        }

        at++;
      }

      while (at < msf.length && isSpace(msf[at])) {
        at++;
      }

      const [value, used] = scanInt(msf, at);

      if (value === null) {
        return null;
      }

      parts[part] = value;
      at += used;
    }

    return (parts[0] * 60 + parts[1]) * 75 + parts[2];
  }

  /**
   * `GetCueString` (668-684): a word; one beginning with a quote taken to
   * the next quote, the quotes dropped -- read again from before the word,
   * by `getline` to the first quote and then to the next, at most 255
   * bytes.
   */
  string() {
    const pos = this.pos;
    const failed = this.failed;
    const word = this.word();

    if (!word.startsWith('"')) {
      return word;
    }

    if (word.length > 1 && word.endsWith('"')) {
      return word.slice(1, -1);
    }

    if (word === '"') {
      return '';
    }

    this.pos = pos;
    this.failed = failed;
    this.getline(0x22);
    return this.getline(0x22);
  }

  /** `getline(buffer, MAX_FILENAME_LENGTH, delimiter)` on the line. */
  getline(delimiter: number) {
    if (this.failed) {
      return '';
    }

    const from = this.pos;
    let extracted = false;

    for (;;) {
      if (this.pos >= this.text.length) {
        if (!extracted) {
          this.failed = true;
        }

        return latin1(this.text.subarray(from, this.pos));
      }

      if (this.text[this.pos] === delimiter) {
        this.pos++;
        return latin1(this.text.subarray(from, this.pos - 1));
      }

      if (this.pos - from === MAX_FILENAME_LENGTH - 1) {
        this.failed = true;
        return latin1(this.text.subarray(from, this.pos));
      }

      this.pos++;
      extracted = true;
    }
  }
}

/** A cue sheet's file found by its name as the sheet gives it, as `GetRealFileName` finds it; null where none. */
export type FindFile = (name: string) => Uint8Array | null;

/** A disc's tracks and their files, as `CDROM_Interface_Image` holds them. As `cue.rs`'s `CdImage`. */
export class CdImage {
  readonly tracks: CdTrack[] = [];
  readonly files: TrackFile[] = [];
  /** The disc's catalogue number, a `CATALOG` line's (`mcn`). */
  mcn = '';

  /**
   * `SetDevice` (167-178): the image's file read as a cue sheet, and where
   * it is none, as one data track. Throws where neither: the sheet's
   * `CueError` where the file read as one at least in part -- a line before
   * it a cue sheet's, or the line itself a command DOSBox knows -- else an error
   * saying it is no disc.
   */
  static setDevice(image: Uint8Array, find: FindFile = () => null): CdImage {
    let sheet: CueError | null = null;

    try {
      return CdImage.loadCueSheet(image, find);
    } catch (error) {
      if (
        error instanceof CueError &&
        (error.read || !['not-text', 'command'].includes(error.reason.kind))
      ) {
        sheet = error;
      }
    }

    const iso = CdImage.loadIsoFile(image);

    if (iso) {
      return iso;
    }

    throw sheet ?? new Error('not an ISO 9660 disc');
  }

  /**
   * `LoadIsoFile` (350-393): the file one data track, its layout the first
   * whose sector 16 is a primary volume descriptor (`CanReadPVD`, 395-404),
   * as many sectors long as the file holds whole, and the lead-out after it.
   */
  static loadIsoFile(bytes: Uint8Array): CdImage | null {
    const file = new BinaryFile(bytes);
    const layout = (
      [
        [COOKED_SECTOR_SIZE, false],
        [RAW_SECTOR_SIZE, false],
        [2336, true],
        [RAW_SECTOR_SIZE, true],
      ] as const
    ).find(([sectorSize, mode2]) => canReadPVD(file, sectorSize, mode2));

    if (!layout) {
      return null;
    }

    const [sectorSize, mode2] = layout;
    const length = Math.trunc(file.getLength() / sectorSize);
    const image = new CdImage();
    const data = { ...emptyTrack(), number: 1, attr: 0x40, length, sectorSize, mode2, file: 0 };

    image.files.push({ binary: file });
    image.tracks.push(data, { ...data, number: 2, attr: 0, start: length, length: 0, file: null });
    return image;
  }

  /**
   * `LoadCueSheet` (422-556), line by line. Throws a `CueError`, its `read`
   * whether any line was read as a cue sheet's before the one that failed.
   */
  static loadCueSheet(cue: Uint8Array, find: FindFile): CdImage {
    const image = new CdImage();
    const track = emptyTrack();
    const state = { shift: 0, totalPregap: 0 };
    let currPregap = 0;
    let prestart = 0;
    let canAddTrack = false;
    let at = 0;
    let eof = false;
    let number = 0;
    let read = false;
    const fail = (reason: CueFailure) => new CueError(number, reason, read);

    while (!eof) {
      /* `getline(buf, MAX_LINE_LENGTH)`: at most 511 bytes stored, the fail
       * bit set where the next is not the line's end, or nothing was read. */
      const from = at;
      let failed = false;

      for (;;) {
        if (at >= cue.length) {
          eof = true;
          failed = at === from;
          break;
        }

        if (cue[at] === 0x0a) {
          break;
        }

        if (at - from === MAX_LINE_LENGTH - 1) {
          failed = true;
          break;
        }

        at++;
      }

      let text = cue.subarray(from, at);

      if (!eof && cue[at] === 0x0a) {
        at++;
      }

      number++;

      if (failed && !eof) {
        throw fail({ kind: 'not-text' });
      }

      /* `buf` read as a C string, to its first nought. */
      const nought = text.indexOf(0);

      if (nought >= 0) {
        text = text.subarray(0, nought);
      }

      const line = new Line(text);
      const command = line.keyword();
      let layout = true;

      switch (command) {
        case 'TRACK': {
          if (canAddTrack) {
            layout = image.addTrack(track, state, prestart, currPregap);
          }

          track.start = 0;
          track.skip = 0;
          currPregap = 0;
          prestart = 0;
          track.number = line.int();

          const type = line.keyword();
          const kinds: Record<string, [number, number, boolean]> = {
            AUDIO: [RAW_SECTOR_SIZE, 0, false],
            'MODE1/2048': [COOKED_SECTOR_SIZE, 0x40, false],
            'MODE1/2352': [RAW_SECTOR_SIZE, 0x40, false],
            'MODE2/2336': [2336, 0x40, true],
            'MODE2/2352': [RAW_SECTOR_SIZE, 0x40, true],
          };

          if (!Object.hasOwn(kinds, type)) {
            throw fail({ kind: 'track-type', type });
          }

          [track.sectorSize, track.attr, track.mode2] = kinds[type];
          canAddTrack = true;
          break;
        }
        case 'INDEX': {
          const index = line.int();
          const frame = line.frame();

          if (frame === null) {
            throw fail({ kind: 'frame' });
          }

          if (index === 1) {
            track.start = frame;
          } else if (index === 0) {
            prestart = frame;
          }

          break;
        }
        case 'FILE': {
          if (canAddTrack) {
            layout = image.addTrack(track, state, prestart, currPregap);
          }

          canAddTrack = false;

          const name = line.string();
          const type = line.keyword();

          track.file = null;

          const bytes = type === 'BINARY' || AUDIO_TYPES.includes(type) ? find(name) : null;

          if (!bytes) {
            throw fail({ kind: 'file', name, type });
          }

          image.files.push(
            type === 'BINARY' ? { binary: new BinaryFile(bytes) } : { audio: bytes }
          );
          track.file = image.files.length - 1;
          break;
        }
        case 'PREGAP': {
          const frame = line.frame();

          if (frame === null) {
            throw fail({ kind: 'frame' });
          }

          currPregap = frame;
          break;
        }
        case 'CATALOG':
          image.mcn = line.string();
          break;
        case 'CDTEXTFILE':
        case 'FLAGS':
        case 'ISRC':
        case 'PERFORMER':
        case 'POSTGAP':
        case 'REM':
        case 'SONGWRITER':
        case 'TITLE':
        case '':
          break;
        default:
          throw fail({ kind: 'command', command });
      }

      if (!layout) {
        throw fail({ kind: 'layout' });
      }

      read ||= command !== '';
    }

    /* The last track, and the lead-out after it. */
    if (!image.addTrack(track, state, prestart, currPregap)) {
      throw fail({ kind: 'layout' });
    }

    track.number++;
    track.attr = 0;
    track.start = 0;
    track.length = 0;
    track.file = null;

    if (!image.addTrack(track, state, 0, 0)) {
      throw fail({ kind: 'layout' });
    }

    return image;
  }

  /**
   * `AddTrack` (558-606): a track put after the others, its start on the
   * disc and where it begins in its file worked out from the one before it.
   */
  addTrack(
    curr: CdTrack,
    state: { shift: number; totalPregap: number },
    prestart: number,
    currPregap: number
  ) {
    /* Frames between index 0 and index 1 are skipped. */
    let skip = 0;

    if (prestart > 0) {
      if (prestart > curr.start) {
        return false;
      }

      skip = curr.start - prestart;
    }

    /* The first track, whose number must be 1. */
    if (!this.tracks.length) {
      if (curr.number !== 1) {
        return false;
      }

      curr.skip = skip * curr.sectorSize;
      curr.start += currPregap;
      state.totalPregap = currPregap;
      this.tracks.push({ ...curr });
      return true;
    }

    const prev = this.tracks[this.tracks.length - 1];
    /* Whether this track's start is known: not after an audio file. */
    let known = prev.known;

    if (prev.file === curr.file) {
      /* The same file as the track before. */
      curr.start += state.shift;
      prev.length = curr.start + state.totalPregap - prev.start - skip;
      curr.skip += prev.skip + prev.length * prev.sectorSize + skip * curr.sectorSize;
      state.totalPregap += currPregap;
      curr.start += state.totalPregap;
    } else {
      /* Another file: the one before's whole length. */
      const length = prev.file === null ? null : lengthOf(this.files[prev.file]);

      if (length === null) {
        known = false;
      } else {
        const tmp = length - prev.skip;

        prev.length = Math.trunc(tmp / prev.sectorSize);

        if (tmp % prev.sectorSize !== 0) {
          prev.length++;
        }
      }

      curr.start += prev.start + prev.length + currPregap;
      curr.skip = skip * curr.sectorSize;
      state.shift += prev.start + prev.length;
      state.totalPregap = currPregap;
    }

    curr.known = known;

    /* DOSBox's checks. */
    if (
      curr.number <= 1 ||
      prev.number + 1 !== curr.number ||
      (known && curr.start < prev.start + prev.length) ||
      curr.length < 0
    ) {
      return false;
    }

    this.tracks.push({ ...curr });
    return true;
  }

  /** `HasDataTrack` (608-615): whether any track is data. */
  hasDataTrack() {
    return this.tracks.some((track) => track.attr === 0x40);
  }

  /** `GetTrack` (287-299): the number of the track a sector is in; -1 for none. */
  getTrack(sector: number) {
    for (let i = 0; i + 1 < this.tracks.length; i++) {
      const [curr, next] = [this.tracks[i], this.tracks[i + 1]];

      if (!curr.known || !next.known) {
        return -1;
      }

      if (curr.start <= sector && sector < next.start) {
        return curr.number;
      }
    }

    return -1;
  }

  /**
   * `ReadSector` (301-313), cooked, as `isoDrive::readSector` asks for it:
   * the sector's 2,048 bytes of data -- 16 into a raw sector, 24 into a
   * mode 2 one -- or null, where no track holds it or its file cannot be
   * read there. An audio file's sectors are not read here.
   */
  readSector(sector: number): Uint8Array | null {
    const number = this.getTrack(sector);

    if (number < 1) {
      return null;
    }

    const track = this.tracks[number - 1];
    let seek = track.skip + (sector - track.start) * track.sectorSize;

    if (track.sectorSize === RAW_SECTOR_SIZE && !track.mode2) {
      seek += 16;
    }

    if (track.mode2) {
      seek += 24;
    }

    const file = track.file === null ? null : this.files[track.file];

    if (!file || !('binary' in file)) {
      return null;
    }

    const buffer = new Uint8Array(COOKED_SECTOR_SIZE);

    return file.binary.read(buffer, seek) ? buffer : null;
  }
}

/** `CanReadPVD` (395-404): whether sector 16 in a layout is a primary volume descriptor. */
function canReadPVD(file: BinaryFile, sectorSize: number, mode2: boolean) {
  let seek = 16 * sectorSize;

  if (sectorSize === RAW_SECTOR_SIZE && !mode2) {
    seek += 16;
  }

  if (mode2) {
    seek += 24;
  }

  const pvd = new Uint8Array(COOKED_SECTOR_SIZE);

  /* The read's result is not looked at: a failed one leaves what it read. */
  file.read(pvd, seek);
  return pvd[0] === 1 && latin1(pvd.subarray(1, 6)) === 'CD001' && pvd[6] === 1;
}
