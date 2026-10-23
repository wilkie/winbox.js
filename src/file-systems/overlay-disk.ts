/**
 * What a program writes to a disk image, kept apart from it a sector at a
 * time: the image itself is never changed (the owner's decision of
 * 2026-10-22, `kb/topics/drives-and-disks.md`). DOSBox writes straight into
 * the image's file (`fopen(..., "rb+")`, `drive_fat.cpp` 642;
 * `imageDisk::Write_AbsoluteSector`, `bios_disk.cpp` 169-181); here the
 * sectors it would write are held over the image's, and the image as
 * written is given back only when asked (`image`). As the Rust engine's
 * `files/overlay.rs`.
 *
 * Sectors are numbered in the image; `first` is where the volume begins,
 * which the `Disk`-like methods below (`read16(sector, offset)` and the
 * rest, as `FAT16` and `INT 25h` use a disk) count from.
 */

/** The bytes of a sector, as DOSBox's `imageDisk` reads and writes them (`sector_size`). */
export const SECTOR = 512;

export class OverlayDisk {
  readonly #base: Uint8Array;
  readonly #first: number;
  /** The sectors written, by their number in the image; one written as it already was is not kept. */
  readonly #written = new Map<number, Uint8Array>();
  fileSystem: any = null;

  /**
   * @param base - The image's bytes, never written to.
   * @param first - The sector of the image the volume begins at.
   */
  constructor(base: Uint8Array, first = 0) {
    this.#base = base;
    this.#first = first;
  }

  get sectorSize() {
    return SECTOR;
  }

  /** The volume's bytes, from where it begins to the image's end. */
  get size() {
    return Math.max(0, this.#base.byteLength - this.#first * SECTOR);
  }

  /** A sector of the image, as last written or as the image holds it; noughts past its end. */
  sector(number: number): Uint8Array {
    const written = this.#written.get(number);

    if (written) {
      return written.slice();
    }

    const bytes = new Uint8Array(SECTOR);
    const at = number * SECTOR;

    if (at < this.#base.byteLength) {
      bytes.set(this.#base.subarray(at, Math.min(at + SECTOR, this.#base.byteLength)));
    }

    return bytes;
  }

  /** A sector of the image written, over the image's. */
  put(number: number, bytes: Uint8Array) {
    const now = this.sector(number);

    if (now.every((byte, at) => byte === bytes[at])) {
      return;
    }

    this.#written.set(number, bytes.slice(0, SECTOR));
  }

  /** Whether anything has been written that the image did not hold. */
  get changed() {
    return this.#written.size > 0;
  }

  /** The sectors written, by their number in the image, in order. */
  written(): [number, Uint8Array][] {
    return [...this.#written.entries()]
      .sort(([a], [b]) => a - b)
      .map(([number, bytes]) => [number, bytes.slice()]);
  }

  /**
   * The image as written: its bytes, each sector written put over them,
   * longer where a sector past its end was written, as DOSBox's `fwrite`
   * past the end of the file makes it.
   */
  image(): Uint8Array {
    const end = Math.max(0, ...[...this.#written.keys()].map((number) => (number + 1) * SECTOR));
    const bytes = new Uint8Array(Math.max(this.#base.byteLength, end));

    bytes.set(this.#base);

    for (const [number, sector] of this.#written) {
      bytes.set(sector, number * SECTOR);
    }

    return bytes;
  }

  /** Bytes of the volume from an address, its sector and an offset that may run past it. */
  readAt(index: number, offset: number, length: number): Uint8Array {
    const out = new Uint8Array(length);
    let at = (this.#first + index) * SECTOR + offset;
    let done = 0;

    while (done < length) {
      const number = Math.floor(at / SECTOR);
      const within = at % SECTOR;
      const count = Math.min(SECTOR - within, length - done);

      out.set(this.sector(number).subarray(within, within + count), done);
      done += count;
      at += count;
    }

    return out;
  }

  /** Bytes of the volume written from an address. */
  writeAt(index: number, offset: number, data: Uint8Array) {
    let at = (this.#first + index) * SECTOR + offset;
    let done = 0;

    while (done < data.length) {
      const number = Math.floor(at / SECTOR);
      const within = at % SECTOR;
      const count = Math.min(SECTOR - within, data.length - done);
      const bytes = this.sector(number);

      bytes.set(data.subarray(done, done + count), within);
      this.put(number, bytes);
      done += count;
      at += count;
    }
  }

  /* As `Disk`'s, for what reads or writes a disk by the volume's sectors. */

  async read(index: number, offset: number, length: number) {
    return this.readAt(index, offset, length);
  }

  async write(index: number, offset: number, data: Uint8Array | DataView) {
    this.writeAt(
      index,
      offset,
      data instanceof Uint8Array
        ? data
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    );
  }

  async read8(index: number, offset: number) {
    return this.readAt(index, offset, 1)[0];
  }

  async read16(index: number, offset: number, littleEndian = true) {
    return new DataView(this.readAt(index, offset, 2).buffer).getUint16(0, littleEndian);
  }

  async read32(index: number, offset: number, littleEndian = true) {
    return new DataView(this.readAt(index, offset, 4).buffer).getUint32(0, littleEndian);
  }

  async write8(index: number, offset: number, value: number) {
    this.writeAt(index, offset, Uint8Array.of(value));
  }

  async write16(index: number, offset: number, value: number, littleEndian = true) {
    const bytes = new Uint8Array(2);

    new DataView(bytes.buffer).setUint16(0, value, littleEndian);
    this.writeAt(index, offset, bytes);
  }

  async write32(index: number, offset: number, value: number, littleEndian = true) {
    const bytes = new Uint8Array(4);

    new DataView(bytes.buffer).setUint32(0, value, littleEndian);
    this.writeAt(index, offset, bytes);
  }
}
