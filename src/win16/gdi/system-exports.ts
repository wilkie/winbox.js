'use strict';

import { SelectObject } from './SelectObject.js';

/**
 * GDI's small exports for USER and the system, as `GDI.EXE` has them
 * (**read out**; **recorded** by `gdimisc`). As the Rust engine's
 * `gdi/system_exports.rs`.
 */

/**
 * An object marked private to the system, or the mark taken off (seg1
 * `0e68`): flag 2000h of the word at +2 of the object's header, set for any
 * `fPrivate` not nought, the flag as it was answered -- 2000h or nought.
 * No handle is checked: WinBox answers nought for one that names no
 * object. The mark changes nothing else here; in Windows it keeps
 * `DeleteObject` and the task's clean-up from the object.
 */
export function MakeObjectPrivate(this: any, hObject: number, fPrivate: number) {
  const object = this.handles.resolve(hObject);

  if (!object || typeof object !== 'object') {
    return 0;
  }

  const before = object.privateToSystem ? 0x2000 : 0;

  object.privateToSystem = (fPrivate & 0xffff) !== 0;
  return before;
}

/** GDI's library exit (seg1 `1ec0`): `mov ax,1` and back, whatever is asked. */
export function WEP(this: any, _code: number) {
  return 1;
}

/**
 * A memory device context's bitmap selected, or with nought the stock
 * bitmap every memory context starts with (seg1 `1ac6`: GDI's word 15Bh
 * for nought, then `SelectObject`'s own selecting of a bitmap at `1be2`):
 * the bitmap before. WinBox makes its stock bitmap's handle the first time
 * a memory context's first bitmap is replaced (`SelectObject`); before
 * that no context holds another, and nought is answered.
 */
export function SelectBitmap(this: any, hdc: number, hbm: number) {
  const bitmap = hbm & 0xffff ? hbm : (this.stockBitmap ?? 0);

  return bitmap ? SelectObject.call(this, hdc, bitmap) : 0;
}

/**
 * A bitmap's bits let move (seg2 `0403`): `GlobalWire` and `GlobalUnWire`
 * of the block its header names at +0Ah, `GlobalUnWire`'s answer --
 * -1, its count back to nought, for a block no one has locked. WinBox's
 * bitmaps keep their bits in no global block: -1.
 */
/**
 * Bytes copied for the spooler (seg28 `0000`): `rep movsb` of `count` bytes
 * from `lpSource` to `lpDestination`, forward a byte at a time, so a copy
 * onto bytes just past its source repeats them. Nothing is answered.
 */
export function Copy(this: any, lpDestination: number, lpSource: number, count: number) {
  const core = this.machine.cpu.core;
  const to = lpDestination >>> 0;
  const from = lpSource >>> 0;

  for (let at = 0; at < (count & 0xffff); at++) {
    core.write8(
      to >>> 16,
      ((to & 0xffff) + at) & 0xffff,
      core.read8(from >>> 16, ((from & 0xffff) + at) & 0xffff)
    );
  }
}

/**
 * A memory bitmap's fonts walked for a driver (seg13 `0163`): `mov ax,1`
 * and `retf 10h` -- a bitmap has no fonts of its own, and none is walked.
 */
export function DMEnumDFonts(
  this: any,
  _lpDestDev: number,
  _lpFaceName: number,
  _lpCallbackFunc: number,
  _lpClientData: number
) {
  return 1;
}

export function GDIMoveBitmap(this: any, _hbm: number) {
  return 0xffff;
}

/**
 * GDI's heap made smaller (seg1 `1fdf`), as USER asks after a task ends:
 * where `LocalCountFree` finds more than 1000h bytes free, `LocalShrink`
 * to what is used and 400h more. WinBox's GDI keeps its objects in itself,
 * with no local heap of GDI's to shrink: nothing is done, and nothing is
 * answered.
 */
export function ShrinkGDIHeap(this: any) {}

/** What USER tells GDI as a task ends (seg1 `7690`): nothing is done. */
export function GDITaskTermination(this: any, _hTask: number) {}

function read16(system: any, segment: number, offset: number) {
  const core = system.machine.cpu.core;

  return core.read16(segment & 0xffff, offset & 0xffff);
}

/**
 * The colour of a device's table nearest a colour (seg11 `1015`, seg22
 * `0b2b`), for a driver: the device's first word is the offset of the word
 * to answer in each entry, and a far pointer at 2 is the table -- a count,
 * a word, then 0Ah bytes an entry, with blue, green and red at 6, 7 and 8.
 * The entry whose squares of the three differences add up to the least,
 * the first of any alike, an exact one at once. The colour is the first
 * argument, the device the second. Which entry is counted
 * from the word at the start of the table's segment less the entries left
 * (`0b9e`), so a table at offset nought.
 */
export function DeviceColorMatch(this: any, crColor: number, lpDevice: number) {
  const device = lpDevice >>> 0;
  const field = read16(this, device >>> 16, device);
  const tableOffset = read16(this, device >>> 16, device + 2);
  const tableSegment = read16(this, device >>> 16, device + 4);
  const red = crColor & 0xff;
  const green = (crColor >>> 8) & 0xff;
  const blue = (crColor >>> 16) & 0xff;
  const core = this.machine.cpu.core;
  const byte = (at: number) => core.read8(tableSegment, at & 0xffff);
  let left = read16(this, tableSegment, tableOffset) || 0x10000;
  let entry = tableOffset + 4;
  /* Seventeen bits of a sum, and the best so far beyond any: FFh:FFFFh. */
  let best = 0xffffff;
  let found = 0;

  for (; left > 0; left--, entry += 10) {
    const distance =
      (byte(entry + 6) - blue) ** 2 + (byte(entry + 7) - green) ** 2 + (byte(entry + 8) - red) ** 2;

    if (distance === 0) {
      found = left;
      break;
    }

    if (distance < best) {
      found = left;
      best = distance;
    }
  }

  const index = (read16(this, tableSegment, 0) - found) & 0xffff;

  return read16(this, tableSegment, tableOffset + 4 + ((index * 10) & 0xffff) + field);
}

/**
 * A memory metafile's size checked against its records (seg19 `1862`),
 * as USER does for one on the clipboard: its header's type not 1 answers
 * -2. Otherwise each record's size in words is added to the header's,
 * through a huge pointer, to the record whose function is nought; 1 where
 * the sum is the header's size at 6, else nought and, asked to, the sum
 * written there. A record of no size before the last would have Windows
 * walk for ever; WinBox ends the walk there.
 */
export function FixUpBogusPublisherMetafile(this: any, lpMetaHeader: number, fFix: number) {
  const core = this.machine.cpu.core;
  const far = lpMetaHeader >>> 0;
  let segment = far >>> 16;
  let offset = far & 0xffff;

  if (read16(this, segment, offset) !== 1) {
    return 0xfffe;
  }

  /* A byte through the huge pointer: past a segment's end, 8 selectors on
   * (`__AHINCR`, seg19 `18ad`). */
  const byteAt = (at: number) =>
    core.read8((segment + (at > 0xffff ? 8 : 0)) & 0xffff, at & 0xffff);
  const wordAt = (at: number) => byteAt(at) | (byteAt(at + 1) << 8);
  const words = read16(this, segment, offset + 2);
  let total = words;

  /* The header passed within its segment, as `add bx,di` twice (`1883`). */
  offset = (offset + words * 2) & 0xffff;

  for (;;) {
    const size = (wordAt(offset) | (wordAt(offset + 2) << 16)) >>> 0;
    const fn = wordAt(offset + 4);

    total = (total + size) >>> 0;

    if (fn === 0 || size === 0) {
      break;
    }

    const bytes = size * 2;
    const next = offset + (bytes % 0x10000);

    segment = (segment + 8 * (Math.floor(bytes / 0x10000) + (next > 0xffff ? 1 : 0))) & 0xffff;
    offset = next & 0xffff;
  }

  const sizeAt = far & 0xffff;
  const header = far >>> 16;
  const was = (read16(this, header, sizeAt + 6) | (read16(this, header, sizeAt + 8) << 16)) >>> 0;

  if (was === total) {
    return 1;
  }

  if (fFix & 0xffff) {
    core.write16(header, (sizeAt + 6) & 0xffff, total & 0xffff);
    core.write16(header, (sizeAt + 8) & 0xffff, total >>> 16);
  }

  return 0;
}
