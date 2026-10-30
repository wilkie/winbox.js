'use strict';

import { indexFor } from '../selectors.js';
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

/** What `GDISeeGDIDo` is asked (`GDI.EXE` seg21 `19a9`-`19b8`). */
const SEE_ALLOC = 1;
const SEE_FREE = 2;
const SEE_COMPACT = 3;
const SEE_DATA = 0x103;

/**
 * GDI's heap at a debugger's request (`GDI.EXE` seg21 `19a0`-`19e7`), DS
 * GDI's data segment: 1, `LocalAlloc(wParam1, wParam3)`; 2,
 * `LocalFree(wParam1)`; 3, `LocalCompact(wParam3)` -- each answered with
 * nought in DX; 103h, GDI's data segment, DX its sign; anything else
 * FFFFFFFFh. **Recorded** by `ugaps`. WinBox's GDI keeps no local heap in
 * its segment (`ShrinkGDIHeap`): the heap's requests answer what WinBox's
 * KERNEL answers for a segment with none, as USER's `UserSeeUserDo` does
 * (`ugaps:seegdiheap`, a known gap).
 */
export function GDISeeGDIDo(
  this: any,
  wRequest: number,
  wParam1: number,
  _wParam2: number,
  wParam3: number
) {
  const data = this._moduleData?.GDI ?? 0;
  const request = wRequest & 0xffff;

  if (request === SEE_DATA) {
    return ((data & 0x8000 ? 0xffff0000 : 0) | data) >>> 0;
  }

  if (request < SEE_ALLOC || request > SEE_COMPACT) {
    return 0xffffffff;
  }

  const heap = data ? this.allocator.heapOf(indexFor(data)) : null;

  switch (request) {
    case SEE_ALLOC:
      return heap ? heap.localAlloc(wParam1 & 0xffff, wParam3 & 0xffff) & 0xffff : 0;
    case SEE_FREE:
      return heap ? heap.localFree(wParam1 & 0xffff) & 0xffff : wParam1 & 0xffff;
    default:
      return heap ? heap.localCompact(wParam3 & 0xffff) & 0xffff : 0;
  }
}

/** The word of a GDI object `GDIInit2` reads and sets: a bitmap's driver block (seg2 `0437`-`0456`). */
const OBJECT_WORD = 0x0a;

/** `GDIInit2`'s value that clears the word, answering GDI's data segment (seg2 `043f`-`0445`). */
const CLEAR = 0xffff;

/**
 * A word of a GDI object, read or set (`GDI.EXE` seg2 `042a`-`045c`): the
 * handle a local one of GDI's heap, the word at 0Ah of the object it
 * names. A value of nought answers the word; FFFFh makes it nought and
 * answers GDI's data segment (the prologue's AX); any other sets it and
 * answers it. DX is kept. WING.DLL calls it. **Recorded** by `ugaps` on a
 * bitmap of the display's: read, set, read, cleared, read, put back.
 */
export function GDIInit2(this: any, hObject: number, wValue: number) {
  const heap = this._gdiHeap;
  const handle = hObject & 0xffff;
  const value = wValue & 0xffff;
  const address = heap ? (heap.read8(handle) | (heap.read8(handle + 1) << 8)) & 0xffff : 0;
  const at = (address + OBJECT_WORD) & 0xffff;

  if (!heap) {
    return 0;
  }

  if (value === 0) {
    return (heap.read8(at) | (heap.read8(at + 1) << 8)) & 0xffff;
  }

  heap.setWord(at, value === CLEAR ? 0 : value);

  return value === CLEAR ? (this._moduleData?.GDI ?? 0) : value;
}

/**
 * GDI's string 106 (`GDI.EXE`'s string table), which `FinalGDIInit` loads
 * last into its data, with TrueType enabled.
 */
const TRUETYPE_ERROR =
  'An application used a Truetype font that caused an error in Windows.\n\n' +
  'Quit all applications, and then restart Windows.';

/**
 * The end of GDI's start-up, which USER calls as it starts (`GDI.EXE` seg2
 * `012e`-`023d`): GDI marked started, the procedures it uses looked up,
 * its resource 1000 copied into its data and, with TrueType enabled (bit 0
 * of 64Ah, `[TrueType] TTEnable`), its strings 105 and 106 loaded with
 * USER's `LoadString` (`0202`-`022b`). Called again it does it all again,
 * and answers the length of the last string. WinBox's GDI and USER start
 * together, so nothing is left to do. **Recorded** by `ugaps`: 76h.
 */
export function FinalGDIInit(this: any, _hObject: number) {
  return TRUETYPE_ERROR.length;
}
