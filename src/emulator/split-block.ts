'use strict';

/**
 * What answers for a 64 KiB segment of memory whose bytes are not stored
 * but made when read and taken when written: a view of something kept
 * elsewhere, such as GDI's objects, which winbox.js keeps in itself, laid
 * out as Windows lays them out for a program that goes looking.
 */
export interface SegmentHandler {
  read8(offset: number): number;
  write8(offset: number, value: number): void;
}

/**
 * A block of memory some of whose segments have handlers: the bytes of
 * those go to their handler, and the rest are kept as any block's are. It
 * answers the calls `Memory` makes of a block's `DataView`, so only the
 * blocks with a handled segment in them do anything more.
 */
export class SplitBlock {
  /** The block's own bytes: made again when the memory under it grows. */
  view: DataView;
  readonly handlers: (SegmentHandler | undefined)[] = [];

  constructor(view: DataView) {
    this.view = view;
  }

  /** Whether any of these bytes are a handler's. */
  private handled(offset: number, length: number) {
    return (
      this.handlers[offset >>> 16] !== undefined ||
      this.handlers[(offset + length - 1) >>> 16] !== undefined
    );
  }

  /**
   * `length` bytes from `offset` into `target` at `position`: a handled
   * segment's a byte at a time, as `getUint8` reads them, and the rest at
   * once. A bulk copy byte by byte through a block with any handler in it
   * was two fifths of SimTower's time.
   */
  copyOut(offset: number, target: Uint8Array, position: number, length: number) {
    while (length > 0) {
      const run = Math.min(length, 0x10000 - (offset & 0xffff));
      const handler = this.handlers[offset >>> 16];

      if (handler) {
        for (let at = 0; at < run; at++) {
          target[position + at] = handler.read8((offset + at) & 0xffff) & 0xff;
        }
      } else {
        target.set(new Uint8Array(this.view.buffer, this.view.byteOffset + offset, run), position);
      }

      offset += run;
      position += run;
      length -= run;
    }
  }

  /** `source`'s bytes into the block from `offset`, as `setUint8` writes them. See `copyOut`. */
  copyIn(offset: number, source: Uint8Array) {
    let position = 0;
    let length = source.length;

    while (length > 0) {
      const run = Math.min(length, 0x10000 - (offset & 0xffff));
      const handler = this.handlers[offset >>> 16];

      if (handler) {
        for (let at = 0; at < run; at++) {
          handler.write8((offset + at) & 0xffff, source[position + at]);
        }
      } else {
        new Uint8Array(this.view.buffer, this.view.byteOffset + offset, run).set(
          source.subarray(position, position + run)
        );
      }

      offset += run;
      position += run;
      length -= run;
    }
  }

  getUint8(offset: number) {
    const handler = this.handlers[offset >>> 16];

    return handler ? handler.read8(offset & 0xffff) & 0xff : this.view.getUint8(offset);
  }

  setUint8(offset: number, value: number) {
    const handler = this.handlers[offset >>> 16];

    if (handler) {
      handler.write8(offset & 0xffff, value & 0xff);
    } else {
      this.view.setUint8(offset, value);
    }
  }

  getInt8(offset: number) {
    return (this.getUint8(offset) << 24) >> 24;
  }

  /** Bytes read one at a time, as a number `length` bytes wide. */
  private compose(offset: number, length: number, littleEndian: boolean) {
    let value = 0;

    for (let at = 0; at < length; at++) {
      const byte = this.getUint8(offset + (littleEndian ? length - 1 - at : at));

      value = value * 256 + byte;
    }

    return value;
  }

  /** A number written a byte at a time. */
  private decompose(offset: number, length: number, value: number, littleEndian: boolean) {
    for (let at = 0; at < length; at++) {
      const byte = Math.floor(value / 256 ** at) & 0xff;

      this.setUint8(offset + (littleEndian ? at : length - 1 - at), byte);
    }
  }

  getUint16(offset: number, littleEndian = false) {
    return this.handled(offset, 2)
      ? this.compose(offset, 2, littleEndian)
      : this.view.getUint16(offset, littleEndian);
  }

  getInt16(offset: number, littleEndian = false) {
    return (this.getUint16(offset, littleEndian) << 16) >> 16;
  }

  getUint32(offset: number, littleEndian = false) {
    return this.handled(offset, 4)
      ? this.compose(offset, 4, littleEndian)
      : this.view.getUint32(offset, littleEndian);
  }

  getInt32(offset: number, littleEndian = false) {
    return this.getUint32(offset, littleEndian) | 0;
  }

  getBigInt64(offset: number, littleEndian = false) {
    if (!this.handled(offset, 8)) {
      return this.view.getBigInt64(offset, littleEndian);
    }

    const low = BigInt(this.getUint32(offset + (littleEndian ? 0 : 4), littleEndian));
    const high = BigInt(this.getUint32(offset + (littleEndian ? 4 : 0), littleEndian));

    return BigInt.asIntN(64, (high << 32n) | low);
  }

  setUint16(offset: number, value: number, littleEndian = false) {
    if (this.handled(offset, 2)) {
      this.decompose(offset, 2, value & 0xffff, littleEndian);
    } else {
      this.view.setUint16(offset, value, littleEndian);
    }
  }

  setUint32(offset: number, value: number, littleEndian = false) {
    if (this.handled(offset, 4)) {
      this.decompose(offset, 4, value >>> 0, littleEndian);
    } else {
      this.view.setUint32(offset, value, littleEndian);
    }
  }

  setBigInt64(offset: number, value: bigint, littleEndian = false) {
    if (!this.handled(offset, 8)) {
      this.view.setBigInt64(offset, value, littleEndian);
      return;
    }

    const low = Number(BigInt.asUintN(32, value));
    const high = Number(BigInt.asUintN(32, value >> 32n));

    this.setUint32(offset + (littleEndian ? 0 : 4), littleEndian ? low : high, littleEndian);
    this.setUint32(offset + (littleEndian ? 4 : 0), littleEndian ? high : low, littleEndian);
  }
}
