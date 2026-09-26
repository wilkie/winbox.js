'use strict';

import { type IconData } from '../../raster/icon.js';
import { GlobalAlloc } from '../kernel/GlobalAlloc.js';
import { GlobalLock } from '../kernel/GlobalLock.js';

/**
 * An icon as USER keeps it: a block of global memory, whose handle is the
 * icon's handle. **Read out of `USER.EXE`** (seg12 `0000`, `01bb`, `1029`):
 *
 *     +0  hotspot x, y           +4  width, height
 *     +8  the mask's bytes a row, a whole number of words
 *     +A  planes, +B bits a pixel: the picture's format
 *     +C  the mask, a bit a pixel, the top row first
 *         then the picture in the display's format: each row, its planes in
 *         turn, each a whole number of words
 *
 * The picture is in the display's own format -- four planes of a bit on the
 * VGA, EGA and Super VGA, one on the Hercules -- and a program may write a
 * picture into the block itself: Program Manager copies each item's icon
 * from its group file into one icon's block and draws it. So the icon is read
 * out of the block each time it is drawn.
 */

/** The display's format: its planes and bits a pixel, as `GetDeviceCaps` answers. */
export function displayFormat(system: any) {
  const colours = system.display?.colors ?? 16;

  return colours <= 2 ? { planes: 1, bits: 1 } : { planes: 4, bits: 1 };
}

const wordRow = (bits: number) => ((bits + 15) >> 3) & ~1;

/** The block's size for an icon of this size and format. */
export function blockSize(width: number, height: number, planes: number, bits: number) {
  return 12 + height * wordRow(width) + wordRow(width * bits) * planes * height;
}

/**
 * The colour index a pixel's planes make: plane `p` is bit `p` of it. From
 * data: Program Manager's group files hold the programs' icons this way, and
 * each decodes to the same picture as the program's own resource.
 */
function indexOf(planeBits: number[]) {
  return planeBits.reduce((index, bit, plane) => index | (bit << plane), 0);
}

/** An icon written into a new block in the display's format; its handle. */
export function iconBlock(system: any, icon: IconData) {
  const { planes, bits } = displayFormat(system);

  return writeBlock(system, icon, planes, bits);
}

function writeBlock(system: any, icon: IconData, planes: number, bits: number) {
  const { width, height } = icon;
  const size = blockSize(width, height, planes, bits);
  const handle = GlobalAlloc.call(system, 0x0042, size);
  const far = GlobalLock.call(system, handle);

  if (!handle || !far) {
    return 0;
  }

  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  const maskRow = wordRow(width);
  const pictureRow = wordRow(width * bits);

  view.setUint16(0, width >> 1, true);
  view.setUint16(2, height >> 1, true);
  view.setUint16(4, width, true);
  view.setUint16(6, height, true);
  view.setUint16(8, maskRow, true);
  bytes[10] = planes;
  bytes[11] = bits;

  const pictureAt = 12 + height * maskRow;

  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const at = row * width + column;

      if (icon.and[at]) {
        bytes[12 + row * maskRow + (column >> 3)] |= 0x80 >> (column & 7);
      }

      const index = icon.xor[at];

      for (let plane = 0; plane < planes; plane++) {
        const value = (index >> (plane * bits)) & ((1 << bits) - 1);
        const bit = column * bits;
        const offset = pictureAt + (row * planes + plane) * pictureRow + (bit >> 3);

        bytes[offset] |= value << (8 - bits - (bit & 7));
      }
    }
  }

  const core = system.machine.cpu.core;

  bytes.forEach((value, i) => core.write8((far >>> 16) & 0xffff, ((far & 0xffff) + i) & 0xffff, value));

  (system._iconBlocks ??= new Set<number>()).add(handle);

  return handle;
}

/**
 * A new block from its parts, as `CreateIcon` makes one (seg12 `0110`): the
 * hotspot in the middle, the format as given.
 */
export function blockFromBits(
  system: any,
  width: number,
  height: number,
  planes: number,
  bits: number,
  and: number,
  xor: number
) {
  const size = blockSize(width, height, planes, bits);
  const handle = GlobalAlloc.call(system, 0x0042, size);
  const far = GlobalLock.call(system, handle);

  if (!handle || !far) {
    return 0;
  }

  const core = system.machine.cpu.core;
  const put = (at: number, value: number) =>
    core.write8((far >>> 16) & 0xffff, ((far & 0xffff) + at) & 0xffff, value & 0xff);
  const read = (source: number, at: number) =>
    core.read8((source >>> 16) & 0xffff, ((source & 0xffff) + at) & 0xffff);
  const maskBytes = height * wordRow(width);

  [width >> 1, height >> 1, width, height, wordRow(width)].forEach((word, i) => {
    put(i * 2, word);
    put(i * 2 + 1, word >> 8);
  });
  put(10, planes);
  put(11, bits);

  for (let i = 0; i < maskBytes; i++) {
    put(12 + i, read(and, i));
  }

  for (let i = 0; i < size - 12 - maskBytes; i++) {
    put(12 + maskBytes + i, read(xor, i));
  }

  (system._iconBlocks ??= new Set<number>()).add(handle);

  return handle;
}

/**
 * An icon as it is now: read out of its block, or, for a handle to an icon
 * kept as data, that. Null for anything else.
 */
export function iconOf(system: any, hicon: number): IconData | null {
  const kept = system.handles.resolve(hicon);

  if (kept?.xor && kept?.and) {
    return kept;
  }

  if (!system._iconBlocks?.has(hicon)) {
    return null;
  }

  const far = GlobalLock.call(system, hicon);

  if (!far) {
    return null;
  }

  const core = system.machine.cpu.core;
  const byte = (at: number) => core.read8((far >>> 16) & 0xffff, ((far & 0xffff) + at) & 0xffff);
  const word = (at: number) => byte(at) | (byte(at + 1) << 8);
  const width = word(4);
  const height = word(6);
  const maskRow = word(8);
  const planes = Math.max(1, byte(10));
  const bits = Math.max(1, byte(11));
  const pictureRow = wordRow(width * bits);
  const pictureAt = 12 + height * maskRow;

  if (!width || !height || width > 256 || height > 256) {
    return null;
  }

  const xor = new Uint8Array(width * height);
  const and = new Uint8Array(width * height);

  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      and[row * width + column] = (byte(12 + row * maskRow + (column >> 3)) >> (7 - (column & 7))) & 1;

      const planeBits: number[] = [];

      for (let plane = 0; plane < planes; plane++) {
        const bit = column * bits;
        const value = byte(pictureAt + (row * planes + plane) * pictureRow + (bit >> 3));

        planeBits.push((value >> (8 - bits - (bit & 7))) & ((1 << bits) - 1));
      }

      xor[row * width + column] = bits === 1 ? indexOf(planeBits) : planeBits.reduce((i, v, p) => i | (v << (p * bits)), 0);
    }
  }

  return { width, height, xor, and };
}
