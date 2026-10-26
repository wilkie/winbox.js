'use strict';

import { GlobalAlloc } from '../kernel/GlobalAlloc.js';
import { GlobalLock } from '../kernel/GlobalLock.js';
import { GlobalUnlock } from '../kernel/GlobalUnlock.js';
import { GetSystemMetrics } from './GetSystemMetrics.js';
import { globalPointer } from '../kernel/GlobalLock.js';
import { CursorData, GetCursor, SetCursor, standardCursor } from './cursor-api.js';
import { iconOf } from './icon-block.js';
import { DestroyIcon } from './icon-api.js';

/**
 * Cursors made from bits, copied and destroyed. **Read out of `USER.EXE`**
 * (seg12) and **recorded** by `curmake`. A cursor made is a block laid out
 * as an icon's (`icon-block.ts`): the hotspot, the size, the mask's bytes a
 * row, the planes and bits a pixel, then the mask and the picture as
 * given. As the Rust engine's `cursor_make.rs`.
 */

const IDC_ARROW = 32512;

function core(system: any) {
  return system.machine.cpu.core;
}

/** A word read as signed. */
const signed = (value: number) => (value << 16) >> 16;

/** A far pointer `at` bytes on, within its segment. */
const on = (far: number, at: number) => ((far & 0xffff0000) | ((far + at) & 0xffff)) >>> 0;

/**
 * An icon or cursor in a block of its own, from its header's twelve bytes
 * and the two sets of bits (`USER.EXE` seg12 `0000`-`00bb`): the mask is the
 * header's height times its bytes a row; the picture its width times its
 * bits a pixel, rounded up to words, times its planes and its height, each
 * in sixteen bits; the block the header and both, copied as they are.
 */
function makeBlock(system: any, header: number[], and: number, xor: number) {
  const memory = core(system);
  const word = (at: number) => header[at] | (header[at + 1] << 8);
  const row = ((signed((header[11] * signed(word(4))) & 0xffff) + 15) >> 3) & 0xfffe;
  const picture = (((row * header[10]) & 0xffff) * word(6)) & 0xffff;
  const mask = (signed(word(6)) * signed(word(8))) & 0xffff;
  const size = (mask + picture + 12) & 0xffff;
  const handle = GlobalAlloc.call(system, 0x0042, size);
  const far = handle ? globalPointer.call(system, handle) >>> 0 : 0;

  if (!far) {
    return 0;
  }

  const put = (at: number, value: number) => memory.write8(far >>> 16, on(far, at) & 0xffff, value);
  const read = (from: number, at: number) => memory.read8(from >>> 16, on(from, at) & 0xffff);

  header.forEach((value, at) => put(at, value));

  for (let at = 0; at < mask; at++) {
    put(12 + at, read(and, at));
  }

  for (let at = 0; at < picture; at++) {
    put(12 + mask + at, read(xor, at));
  }

  (system._iconBlocks ??= new Set<number>()).add(handle);

  return handle;
}

/** `CreateCursorIconIndirect`: the header read from `lpInfo` (seg12 `0000`). */
export function CreateCursorIconIndirect(
  this: any,
  _hInst: number,
  lpInfo: number,
  lpANDbits: number,
  lpXORbits: number
) {
  const memory = core(this);
  const header = Array.from({ length: 12 }, (_, at) =>
    memory.read8(lpInfo >>> 16, on(lpInfo, at) & 0xffff)
  );

  return makeBlock(this, header, lpANDbits, lpXORbits);
}

/**
 * A cursor of a bit a pixel, its hotspot as given (seg12 `00be`-`010d`):
 * the mask's row the width rounded up to words, one plane of one bit.
 */
export function CreateCursor(
  this: any,
  _hInst: number,
  xHotSpot: number,
  yHotSpot: number,
  nWidth: number,
  nHeight: number,
  lpANDbits: number,
  lpXORbits: number
) {
  const width = nWidth & 0xffff;
  const row = (signed((width + 15) & 0xfff7) >> 3) & 0xffff;
  const header = [xHotSpot, yHotSpot, width, nHeight, row].flatMap((value) => [
    value & 0xff,
    (value >> 8) & 0xff,
  ]);

  return makeBlock(this, [...header, 1, 1], lpANDbits, lpXORbits);
}

/**
 * A copy of a cursor or icon in a block of its own, its bytes as they are
 * (seg12 `0260`-`02c0`, the same for `CopyIcon` and `CopyCursor`); for a
 * cursor kept as data, a block made of it. Nought for anything else.
 */
export function CopyCursor(this: any, _hInst: number, hCursor: number) {
  if (this._iconBlocks?.has(hCursor)) {
    const far = globalPointer.call(this, hCursor) >>> 0;

    if (!far) {
      return 0;
    }

    const memory = core(this);
    const header = Array.from({ length: 12 }, (_, at) =>
      memory.read8(far >>> 16, on(far, at) & 0xffff)
    );
    const mask =
      (signed(header[6] | (header[7] << 8)) * signed(header[8] | (header[9] << 8))) & 0xffff;

    return makeBlock(this, header, on(far, 12), on(far, 12 + mask));
  }

  const cursor = this.handles.resolve(hCursor);

  if (cursor instanceof CursorData && cursor.image) {
    return cursorBlock(this, cursor);
  }

  return 0;
}

/** A cursor kept as data, laid out in a block of one plane of a bit. */
function cursorBlock(system: any, cursor: CursorData) {
  const image = cursor.image!;
  const row = ((image.width + 15) >> 3) & ~1;
  const size = 12 + row * image.height * 2;
  const handle = GlobalAlloc.call(system, 0x0042, size);
  const far = handle ? globalPointer.call(system, handle) >>> 0 : 0;

  if (!far) {
    return 0;
  }

  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);

  [image.hotspot.x, image.hotspot.y, image.width, image.height, row].forEach((value, i) =>
    view.setUint16(i * 2, value, true)
  );
  bytes[10] = 1;
  bytes[11] = 1;

  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const at = y * image.width + x;

      if (image.and[at]) {
        bytes[12 + y * row + (x >> 3)] |= 0x80 >> (x & 7);
      }

      if (image.xor[at]) {
        bytes[12 + row * image.height + y * row + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }

  bytes.forEach((value, i) => core(system).write8(far >>> 16, on(far, i) & 0xffff, value));
  (system._iconBlocks ??= new Set<number>()).add(handle);

  return handle;
}

/**
 * A cursor done with (seg12 `018d`-`01b8`): the arrow made current first
 * where it is the cursor now (`[9A8h]`); then let go as an icon is, 1
 * where its block was freed and nought for anything else.
 */
export function DestroyCursor(this: any, hCursor: number) {
  if (hCursor && GetCursor.call(this) === hCursor) {
    SetCursor.call(this, standardCursor(this, IDC_ARROW));
  }

  return DestroyIcon.call(this, hCursor);
}

/**
 * A cursor made of a block, as the display shows it: its hotspot from the
 * block; for one plane of a bit, each bit of its picture set flipping every
 * bit of the screen's pixel, as a monochrome cursor does.
 */
export function blockCursorImage(system: any, handle: number) {
  if (!system._iconBlocks?.has(handle)) {
    return null;
  }

  const icon = iconOf(system, handle);
  const far = globalPointer.call(system, handle) >>> 0;

  if (!icon || !far) {
    return null;
  }

  const memory = core(system);
  const read = (at: number) => memory.read8(far >>> 16, on(far, at) & 0xffff);
  const mono = read(10) === 1 && read(11) === 1;
  const all = system.display?.bitsPerPixel === 8 ? 0xff : (system.display?.colors ?? 16) - 1;

  return {
    ...icon,
    xor: mono ? icon.xor.map((bit: number) => (bit ? all : 0)) : icon.xor,
    hotspot: { x: signed(read(0) | (read(1) << 8)), y: signed(read(2) | (read(3) << 8)) },
  };
}

const SM_CXICON = 11;
const SM_CYICON = 12;
const SM_CXCURSOR = 13;
const SM_CYCURSOR = 14;

/**
 * The member of an icon or cursor group that fits the display: its
 * identifier, the `RT_ICON` or `RT_CURSOR` resource to load (`USER.EXE`
 * seg12 `052b`-`05b6`). The group's directory is locked as a resource is
 * (`LockResource`, `GlobalLock` here); nought where its reserved word is
 * not nought or its type neither 1 nor 2, the block left locked. Its type
 * is an integer name, the low word of a far pointer. **Recorded** by
 * `iconid`.
 *
 * * An icon (seg12 `040c`-`04f4`): one of `SM_CXICON` by `SM_CYICON` with
 *   as many colours as the display has, the first such at once; else the
 *   one of that size with the most colours below that; else of any size,
 *   the one with the most colours not more than the display's; else the
 *   first. A width or height of nought is 256. USER's own choice among
 *   those of the size with more colours than the display's starts from
 *   nought and never takes one (`04b6`): `iconid`'s pair of 200 colours
 *   answers the first.
 * * A cursor (seg12 `04f7`-`0526`): the first `SM_CXCURSOR` wide and
 *   `SM_CYCURSOR` high, its directory's height twice that; else the first.
 * * Any other type: the member at the index of the block's selector, as
 *   USER leaves it (`0541`, `0591`).
 */
export function GetIconID(this: any, hRes: number, lpszType: number) {
  const far = GlobalLock.call(this, hRes) >>> 0;

  if (!far) {
    return 0;
  }

  const core = this.machine.cpu.core;
  const selector = far >>> 16;
  const base = far & 0xffff;
  const byte = (at: number) => core.read8(selector, (base + at) & 0xffff);
  const word = (at: number) => core.read16(selector, (base + at) & 0xffff);

  if (word(0) !== 0 || (word(2) !== 1 && word(2) !== 2)) {
    return 0;
  }

  const count = word(4);
  const type = lpszType & 0xffff;
  let index = selector;

  if (type === 1) {
    index = cursorIndex(this, word, count);
  } else if (type === 3) {
    index = iconIndex(this, byte, count);
  }

  if (index === count) {
    index = 0;
  }

  GlobalUnlock.call(this, hRes);

  return word(6 + ((index * 14) & 0xffff) + 12);
}

/** The icon of a directory's `count` for the display (seg12 `040c`). */
function iconIndex(system: any, byte: (at: number) => number, count: number) {
  const colors = system.display?.colors ?? 16;
  const most = colors >= 0x10000 ? 0x7d00 : colors;
  const width = GetSystemMetrics.call(system, SM_CXICON);
  const height = GetSystemMetrics.call(system, SM_CYICON);
  let fit = 0;
  let fitAt = 0;
  let over = 0;
  let overAt = 0;
  let any = 0;
  let anyAt = 0;

  for (let at = 0; at < count; at++) {
    const entry = 6 + at * 14;
    const colours = byte(entry + 2);

    if (colours <= most && any < colours) {
      any = colours;
      anyAt = at;
    }

    if ((byte(entry) || 0x100) !== width || (byte(entry + 1) || 0x100) !== height) {
      continue;
    }

    if (colours === most) {
      return at;
    }

    if (colours < most) {
      if (fit < colours) {
        fit = colours;
        fitAt = at;
      }
    } else if (fit === 0 && over > colours) {
      over = colours;
      overAt = at;
    }
  }

  return fit ? fitAt : over ? overAt : any ? anyAt : 0;
}

/** The cursor of a directory's `count` for the display (seg12 `04f7`). */
function cursorIndex(system: any, word: (at: number) => number, count: number) {
  const width = GetSystemMetrics.call(system, SM_CXCURSOR);
  const height = GetSystemMetrics.call(system, SM_CYCURSOR);

  for (let at = 0; at < count; at++) {
    const entry = 6 + at * 14;

    if (word(entry) === width && word(entry + 2) >>> 1 === height) {
      return at;
    }
  }

  return 0;
}
