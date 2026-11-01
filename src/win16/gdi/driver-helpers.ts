'use strict';

import {
  herculesColorInfo,
  herculesExtTextOut,
  herculesGetCharWidth,
  herculesPixel,
  herculesRealizeObject,
  herculesScanLR,
  isHercules,
} from './driver-hercules.js';
import * as vga256 from './driver-vga256.js';
import { isVga256 } from './driver-vga256.js';
import { DevicePalette } from '../../raster/device-palette.js';
import { matchedIndex } from '../../raster/colour-match.js';
import { DeviceBitmap } from '../../raster/device-bitmap.js';
import { DWORD, FARPTR, Struct } from '../types.js';
import { LOGBRUSH, LOGPEN, enumeratedObjects } from './EnumObjects.js';
import { textCapsOf } from './GetDeviceCaps.js';
import { devicePoint } from './mapping.js';
import {
  MONO_WHITE,
  familyOf,
  flagsOf,
  physicalOf,
  bitBlt,
  deviceBitmapBits,
  dibToDevice,
  extTextOut,
  getCharWidth,
  output,
  realizeObject,
} from './driver-bitmap.js';

/**
 * GDI's device-independent helpers for drivers, ordinals 201 to 220: the
 * routines a printer's driver calls when GDI hands it a memory bitmap
 * where it expects its own device, and `DMTranspose`. The twin of
 * `crates/winbox-win16/src/gdi/driver_helpers.rs`.
 *
 * **Read out** of `GDI.EXE` seg13. Each `DM` routine but `DMEnumDFonts`,
 * `DMTranspose`, `DMStrBlt` and `DMExtTextOut` is five bytes, `mov
 * cx,nnnn` and a jump to `Brute` (seg13 `0171`, exported as 213). Of CX,
 * CL is the words on the stack to move (the arguments, the return address
 * and the two words `Brute` pushes) and CH the offset of the routine in a
 * driver's table of entry points, four bytes an entry from `BitBlt` at
 * nought. `Brute` moves its caller's frame down by 20h bytes, finds the
 * device each routine is for -- its first argument, and for `DMBitBlt` its
 * source too (`0212`, `0218`) -- and calls the display driver's own
 * routine at that offset with the same arguments (`01c3`): GDI's handle
 * at `[0012h]` names the display's device, whose word 1Ch is its table.
 * The routine's answer is the helper's, and its arguments are taken off
 * the stack as the display driver's routine takes them.
 *
 * * **A memory bitmap**, a device whose first word is nought: its
 *   `bmlpPDevice` at 12h is set to the display's device for the call (the
 *   offset nought, the segment the display's word 10h) and put back after
 *   (`01d3`-`01fe`).
 * * **A device marked `DI`** (4944h): the table at `[0159h]` -- nought in
 *   Windows 3.1 as it runs, so it goes on as the next.
 * * **Any other device** (`0224`): nothing is called; AX is nought and DX
 *   the routine's offset, which is the answer.
 *
 * **Recorded** by `gdidm` and `gdidmdrw` on the VGA, the Super VGA and the
 * EGA, each helper called on a `BITMAP` of the probe's: what the display
 * driver does there is what each answers. WinBox draws with its own raster
 * code, not a display driver's (`display-driver.ts`), so the display
 * driver's routines for a memory bitmap are here, as `VGA.DRV` has them --
 * `ColorInfo`, `Pixel`, `ScanLR` and `EnumObj` in this file, and
 * `RealizeObject`, `BitBlt`, `Output`, `ExtTextOut`, `StrBlt`,
 * `GetCharWidth`, `DeviceBitmapBits` and `DIBToDevice` in
 * `driver-bitmap.ts`. `StretchBlt` and `StretchDIBits`, which the VGA's
 * driver has not, answer nought; and on the Hercules and the 256-colour
 * display every routine does (`familyOf`).
 */

/** A memory bitmap as a driver is handed it, read from GDI's `BITMAP` for drivers. */
interface DriverBitmap {
  type: number;
  width: number;
  height: number;
  widthBytes: number;
  /** The planes and the bits a pixel, as the word at 8: 104h for the display's four planes. */
  format: number;
  bits: number;
  segmentIndex: number;
  scanSegment: number;
}

/** The word at 8 of a bitmap of the display's four planes of a bit each. */
const FOUR_PLANES = 0x0104;

/** What `Pixel` answers for a pixel of a monochrome bitmap (seg7 `01fe`). */
const MONO_BLACK = 0x20000000;
const MONO_WHITE_PHYSICAL = 0x3fffffff;

/** What `Pixel` and `ScanLR` answer for a point off the bitmap. */
const OFF_PIXEL = 0x80000000;
const OFF_SCAN = 0x8000;

function core(system: any) {
  return system.machine.cpu.core;
}

function read16(system: any, far: number, at: number) {
  return core(system).read16((far >>> 16) & 0xffff, ((far & 0xffff) + at) & 0xffff);
}

function read8(system: any, far: number, at: number) {
  return core(system).read8((far >>> 16) & 0xffff, ((far & 0xffff) + at) & 0xffff);
}

function write8(system: any, far: number, at: number, value: number) {
  core(system).write8((far >>> 16) & 0xffff, ((far & 0xffff) + at) & 0xffff, value & 0xff);
}

function write16(system: any, far: number, at: number, value: number) {
  core(system).write16((far >>> 16) & 0xffff, ((far & 0xffff) + at) & 0xffff, value & 0xffff);
}

function write32(system: any, far: number, value: number) {
  core(system).write16((far >>> 16) & 0xffff, far & 0xffff, value & 0xffff);
  core(system).write16((far >>> 16) & 0xffff, ((far & 0xffff) + 2) & 0xffff, value >>> 16);
}

function readBitmap(system: any, far: number): DriverBitmap {
  return {
    type: read16(system, far, 0),
    width: read16(system, far, 2),
    height: read16(system, far, 4),
    widthBytes: read16(system, far, 6),
    format: read16(system, far, 8),
    bits: ((read16(system, far, 0x0c) << 16) | read16(system, far, 0x0a)) >>> 0,
    segmentIndex: read16(system, far, 0x16),
    scanSegment: read16(system, far, 0x18),
  };
}

/** Whether WinBox has the display driver's routines (`familyOf`). */
function vga(system: any) {
  return familyOf(system) !== null;
}

/**
 * Where a row of a bitmap starts (`VGA.DRV` seg7 `00e2`-`011a`): past as
 * many segments as the rows before fill, each `bmSegmentIndex` selectors
 * on from the last, and in its segment four planes' rows a row for the
 * display's format, one for a monochrome bitmap.
 */
function rowOf(bitmap: DriverBitmap, y: number) {
  let segment = bitmap.bits >>> 16;
  let row = y;

  if (bitmap.segmentIndex) {
    const segments = Math.floor(row / bitmap.scanSegment);

    segment = (segment + segments * bitmap.segmentIndex) & 0xffff;
    row -= segments * bitmap.scanSegment;
  }

  const planes = bitmap.format === FOUR_PLANES ? 4 : 1;
  const offset = ((bitmap.bits & 0xffff) + row * planes * bitmap.widthBytes) & 0xffff;

  return ((segment << 16) | offset) >>> 0;
}

/** The bits of a pixel, one a plane: the colour's index, or 1 for white in a monochrome bitmap. */
function pixelOf(system: any, bitmap: DriverBitmap, x: number, y: number) {
  const row = rowOf(bitmap, y);
  const mask = 0x80 >> (x & 7);
  const planes = bitmap.format === FOUR_PLANES ? 4 : 1;
  let value = 0;

  for (let plane = 0; plane < planes; plane++) {
    if (read8(system, row, plane * bitmap.widthBytes + (x >> 3)) & mask) {
      value |= 1 << plane;
    }
  }

  return value;
}

/** What a physical colour is as a pixel's bits: its index, or its flag for white. */
function bitsOfPhysical(bitmap: DriverBitmap, physical: number) {
  const top = physical >>> 24;

  return bitmap.format === FOUR_PLANES ? top & 0xf : top & MONO_WHITE ? 1 : 0;
}

/**
 * `ColorInfo` (`VGA.DRV` seg1 `18f8`): with a buffer, the colour's
 * physical colour written there, as the driver matches a colour
 * (`colour-match.ts`); the answer is the physical colour's red, green and
 * blue -- the colour the device has -- for a bitmap of the display's four
 * planes, and white or black by the flag for a monochrome one. With no
 * buffer the colour is taken as a physical one and answered the same way.
 */
function colorInfo(system: any, device: number, colour: number, lpPhysical: number) {
  let physical = colour >>> 0;

  if (lpPhysical) {
    const palette = DevicePalette.forDisplay(system.display, 4);

    physical = physicalOf(
      system,
      matchedIndex(
        system.display,
        palette,
        colour & 0xff,
        (colour >>> 8) & 0xff,
        (colour >>> 16) & 0xff
      )
    );
    write32(system, lpPhysical, physical);
  }

  if (read16(system, device, 8) === FOUR_PLANES) {
    return physical & 0x00ffffff;
  }

  return (physical >>> 24) & MONO_WHITE ? 0x00ffffff : 0;
}

/**
 * `Pixel` on a memory bitmap (`VGA.DRV` seg7 `0088`): a point at or past
 * the width or the height, taken unsigned, answers 80000000h. With no
 * `DRAWMODE` the pixel's physical colour is answered: the VGA's for its
 * index, or black or white for a monochrome bitmap. With one, each
 * plane's bit is set by the `DRAWMODE`'s raster operation of the pen's bit
 * -- the colour's index bit, or its white flag -- and the bit there, and
 * nought is answered.
 */
function pixel(
  system: any,
  device: number,
  x: number,
  y: number,
  physical: number,
  lpDrawMode: number
) {
  const bitmap = readBitmap(system, device);

  if ((x & 0xffff) >= bitmap.width || (y & 0xffff) >= bitmap.height) {
    return OFF_PIXEL;
  }

  if (!lpDrawMode) {
    const value = pixelOf(system, bitmap, x, y);

    if (bitmap.format !== FOUR_PLANES) {
      return value ? MONO_WHITE_PHYSICAL : MONO_BLACK;
    }

    return physicalOf(system, value);
  }

  const rop = (read16(system, lpDrawMode, 0) - 1) & 0xf;
  const pen = bitsOfPhysical(bitmap, physical);
  const row = rowOf(bitmap, y);
  const mask = 0x80 >> (x & 7);
  const planes = bitmap.format === FOUR_PLANES ? 4 : 1;

  for (let plane = 0; plane < planes; plane++) {
    const at = plane * bitmap.widthBytes + (x >> 3);
    const byte = read8(system, row, at);
    const there = byte & mask ? 1 : 0;
    const bit = (rop >> ((((pen >> plane) & 1) << 1) | there)) & 1;

    write8(system, row, at, bit ? byte | mask : byte & ~mask);
  }

  return 0;
}

/**
 * `ScanLR` on a memory bitmap (`VGA.DRV` seg5 `02aa`): from the point, the
 * first pixel to the right -- to the left with style bit 1 -- that is not
 * the colour, or with style bit 0 that is, the point itself first. Its x,
 * or -1 where the row ends first; 8000h for a point at or past the width
 * or the height, taken unsigned.
 */
export function scanBitmap(
  system: any,
  bitmap: DriverBitmap,
  x: number,
  y: number,
  physical: number,
  style: number
) {
  if ((y & 0xffff) >= bitmap.height || (x & 0xffff) >= bitmap.width) {
    return OFF_SCAN;
  }

  const colour = bitsOfPhysical(bitmap, physical);
  const equal = (style & 1) !== 0;
  const step = style & 2 ? -1 : 1;

  for (let at = x; at >= 0 && at < bitmap.width; at += step) {
    if ((pixelOf(system, bitmap, at, y) === colour) === equal) {
      return at;
    }
  }

  return 0xffff;
}

/** Where `VGA.DRV`'s `EnumObj` lays each object, up the stack from the procedure's entry (seg5 `01d2`). */
const PEN_AT = 0x16;
const SOLID_AT = 0x14;
const HATCHED_AT = 0x16;

/**
 * `EnumObj` (`VGA.DRV` seg5 `01d2`): the display's pens or brushes, each
 * handed to the procedure with the data, as `EnumObjects` has them
 * (`EnumObjects.ts`); any other style answers 1 and hands none. The
 * answer is the procedure's last, nought where it answered nought.
 */
async function enumObj(system: any, style: number, procedure: number, data: number) {
  const objects = enumeratedObjects(system, style);

  if (!objects.length) {
    return 1;
  }

  let answer = 0;

  for (const object of objects) {
    const at =
      object instanceof LOGPEN ? PEN_AT : (object as any).lbStyle === 0 ? SOLID_AT : HATCHED_AT;

    answer =
      Number(
        await system.scheduler.callProc(
          procedure,
          [
            [[object as Struct, at], FARPTR],
            [data >>> 0, DWORD],
          ],
          system.scheduler.stackRegisters()
        )
      ) & 0xffff;

    if (!answer) {
      return 0;
    }
  }

  return answer;
}

/**
 * `EnumObj` (`SVGA256.DRV` seg4 `0086`): pens of the five styles in each
 * of the driver's twenty colours, last seven first (`00cc`-`00e3`,
 * `00fa`), or a solid brush of each of the twenty (`00ea`), each handed to
 * the procedure with the data, laid 1Ch up the stack from its entry; any
 * other style answers 1. The answer is the procedure's last, nought where
 * it answered nought. **Recorded** by `gdidmpx`.
 */
async function vga256EnumObj(system: any, style: number, procedure: number, data: number) {
  const colours = vga256.enumeratedColours();
  let objects: Struct[];

  if (style === 1) {
    objects = [0, 1, 2, 3, 4].flatMap((penStyle) =>
      colours.map((colour) => {
        const pen: any = new LOGPEN();

        pen.lopnStyle = penStyle;
        pen.lopnWidthX = 0;
        pen.lopnWidthY = 0;
        pen.lopnColor = colour;
        return pen;
      })
    );
  } else if (style === 2) {
    objects = colours.map((colour) => {
      const brush: any = new LOGBRUSH();

      brush.lbStyle = 0;
      brush.lbColor = colour;
      brush.lbHatch = 0;
      return brush;
    });
  } else {
    return 1;
  }

  let answer = 0;

  for (const object of objects) {
    answer =
      Number(
        await system.scheduler.callProc(
          procedure,
          [
            [[object, vga256.ENUMERATED_AT], FARPTR],
            [data >>> 0, DWORD],
          ],
          system.scheduler.stackRegisters()
        )
      ) & 0xffff;

    if (!answer) {
      return 0;
    }
  }

  return answer;
}

/** The display driver's routines `Brute` reaches, by their offset in its table. */
const BIT_BLT = 0x00;
const COLOR_INFO = 0x04;
const ENUM_OBJ = 0x18;
const OUTPUT = 0x1c;
const PIXEL = 0x20;
const REALIZE_OBJECT = 0x24;
const SCAN_LR = 0x2c;
const EXT_TEXT_OUT = 0x34;
const GET_CHAR_WIDTH = 0x38;
const DEVICE_BITMAP_BITS = 0x48;
const DIB_TO_DEVICE = 0x50;
const STRETCH_BLT = 0x68;
const STRETCH_DIBITS = 0x6c;

/**
 * What `Brute` answers for a device that is not a memory bitmap (seg13
 * `0218`-`0224`): AX nought, as the device's check left it, and the
 * routine's offset in DX. **Recorded** by `gdidm` (DX) and `ugaps` (AX).
 */
function notBitmap(_system: any, offset: number) {
  return (offset << 16) >>> 0;
}

/**
 * `Brute`'s choice for a routine of the display driver's (seg13 `0171`):
 * `routine` for a memory bitmap, where WinBox has the VGA's; on the
 * Hercules, `hercules` -- its own, or `'monochrome'` where its drawing on a
 * monochrome bitmap is the VGA's record for record (`gdidmdrw`); on the
 * 256-colour display, `vga256` (`driver-vga256.ts`); else nought.
 */
async function brute(
  system: any,
  device: number,
  offset: number,
  routine: (() => number | Promise<number>) | null,
  hercules: (() => number | Promise<number>) | 'monochrome' | null = null,
  vga256: (() => number | Promise<number>) | null = null
) {
  if (read16(system, device, 0) !== 0) {
    return notBitmap(system, offset);
  }

  if (isHercules(system)) {
    return hercules === 'monochrome' ? (routine?.() ?? 0) : hercules ? hercules() : 0;
  }

  if (isVga256(system)) {
    return vga256 ? vga256() : 0;
  }

  return routine && vga(system) ? routine() : 0;
}

export function DMBitBlt(
  this: any,
  lpDestDev: number,
  wDestX: number,
  wDestY: number,
  lpSrcDev: number,
  wSrcX: number,
  wSrcY: number,
  wXext: number,
  wYext: number,
  rop3: number,
  lpPBrush: number,
  lpDrawMode: number
) {
  return brute(
    this,
    lpDestDev,
    BIT_BLT,
    () =>
      bitBlt(
        this,
        lpDestDev,
        wDestX,
        wDestY,
        lpSrcDev,
        wSrcX,
        wSrcY,
        wXext,
        wYext,
        rop3,
        lpPBrush,
        lpDrawMode
      ),
    'monochrome',
    () =>
      vga256.bitBlt(
        this,
        lpDestDev,
        wDestX,
        wDestY,
        lpSrcDev,
        wSrcX,
        wSrcY,
        wXext,
        wYext,
        rop3,
        lpPBrush,
        lpDrawMode
      )
  );
}

export function DMColorInfo(this: any, lpDestDev: number, dwColorIn: number, lpPColor: number) {
  return brute(
    this,
    lpDestDev,
    COLOR_INFO,
    () => colorInfo(this, lpDestDev, dwColorIn, lpPColor),
    () => herculesColorInfo(this, dwColorIn >>> 0, lpPColor >>> 0),
    () => vga256.colorInfo(this, dwColorIn >>> 0, lpPColor >>> 0)
  );
}

export function DMEnumObj(
  this: any,
  lpDestDev: number,
  wStyle: number,
  lpCallbackFunc: number,
  lpClientData: number
) {
  return brute(
    this,
    lpDestDev,
    ENUM_OBJ,
    () => enumObj(this, wStyle & 0xffff, lpCallbackFunc, lpClientData),
    () => enumObj(this, wStyle & 0xffff, lpCallbackFunc, lpClientData),
    () => vga256EnumObj(this, wStyle & 0xffff, lpCallbackFunc, lpClientData)
  );
}

export function DMOutput(
  this: any,
  lpDestDev: number,
  wStyle: number,
  wCount: number,
  lpPoints: number,
  lpPPen: number,
  lpPBrush: number,
  lpDrawMode: number,
  lpClipRect: number
) {
  return brute(
    this,
    lpDestDev,
    OUTPUT,
    () =>
      output(this, lpDestDev, wStyle, wCount, lpPoints, lpPPen, lpPBrush, lpDrawMode, lpClipRect),
    'monochrome',
    () =>
      vga256.output(
        this,
        lpDestDev,
        wStyle,
        wCount,
        lpPoints,
        lpPPen,
        lpPBrush,
        lpDrawMode,
        lpClipRect
      )
  );
}

export function DMPixel(
  this: any,
  lpDestDev: number,
  x: number,
  y: number,
  dwPhysColor: number,
  lpDrawMode: number
) {
  return brute(
    this,
    lpDestDev,
    PIXEL,
    () => pixel(this, lpDestDev, x, y, dwPhysColor, lpDrawMode),
    () => herculesPixel(this, lpDestDev, x, y, dwPhysColor >>> 0, lpDrawMode),
    () => vga256.pixel(this, lpDestDev, x, y, dwPhysColor >>> 0, lpDrawMode)
  );
}

export function DMRealizeObject(
  this: any,
  lpDestDev: number,
  wStyle: number,
  lpInObj: number,
  lpOutObj: number,
  lpTextXForm: number
) {
  return brute(
    this,
    lpDestDev,
    REALIZE_OBJECT,
    () => realizeObject(this, wStyle, lpInObj, lpOutObj, lpTextXForm),
    () => herculesRealizeObject(this, wStyle, lpInObj, lpOutObj, lpTextXForm),
    () => vga256.realizeObject(this, wStyle, lpInObj, lpOutObj, lpTextXForm)
  );
}

export function DMScanLR(
  this: any,
  lpDestDev: number,
  x: number,
  y: number,
  dwPhysColor: number,
  wStyle: number
) {
  return brute(
    this,
    lpDestDev,
    SCAN_LR,
    () => scanBitmap(this, readBitmap(this, lpDestDev), x, y, dwPhysColor, wStyle),
    () => herculesScanLR(this, lpDestDev, x, y, dwPhysColor >>> 0, wStyle),
    () => vga256.scanLR(this, lpDestDev, x, y, dwPhysColor >>> 0, wStyle)
  );
}

/** The `TEXTXFORM`'s weight, italic flag and accelerator (seg13 `0014`-`0027`). */
const FT_WEIGHT = 0x08;
const FT_ITALIC = 0x0a;
const FT_ACCELERATOR = 0x0f;
const TC_EA_DOUBLE = 0x0200;
const TC_IA_ABLE = 0x0400;

/**
 * `DMExtTextOut` (seg13 `0000`): where the text's `TEXTXFORM` asks for
 * emboldening or italics that the display can make and the device of
 * `[063Eh]` cannot (`TC_EA_DOUBLE` and `TC_IA_ABLE` of each `GDIINFO`'s
 * `dpText`), the request is taken off for the call, the weight made 400 or
 * the italic flag nought (`003b`-`0072`), and the weight, italic flag and
 * accelerator put back after (`00b9`-`00d4`); then the display driver's
 * `ExtTextOut` through `Brute`. `[063Eh]` is GDI's `GDIINFO` of the context
 * it last drew text for (`textCapsOf`); before any, the display's.
 * **Recorded** by `prttstk`: after text on a printer's context whose
 * `dpText` is nought, `AW` drawn as asked for 700 and `TC_EA_DOUBLE` is the
 * plain string; after text on the display's, emboldened.
 */
export async function DMExtTextOut(
  this: any,
  lpDestDev: number,
  x: number,
  y: number,
  lpClipRect: number,
  lpString: number,
  count: number,
  lpFontInfo: number,
  lpDrawMode: number,
  lpTextXForm: number,
  lpCharWidths = 0,
  lpOpaqueRect = 0,
  wOptions = 0
) {
  const form = lpTextXForm >>> 0;
  const accelerator = form >>> 16 ? read16(this, form, FT_ACCELERATOR) : 0;
  const display = this.display?.textCaps ?? 0;
  const text = textCapsOf(this);
  const saved =
    accelerator & (TC_EA_DOUBLE | TC_IA_ABLE)
      ? [read16(this, form, FT_WEIGHT), read8(this, form, FT_ITALIC)]
      : null;

  if (saved) {
    const off = (bit: number) => accelerator & bit && display & bit && !(text & bit);

    if (off(TC_EA_DOUBLE)) {
      write16(this, form, FT_WEIGHT, 400);
      write16(this, form, FT_ACCELERATOR, read16(this, form, FT_ACCELERATOR) & ~TC_EA_DOUBLE);
    }

    if (off(TC_IA_ABLE)) {
      write8(this, form, FT_ITALIC, 0);
      write16(this, form, FT_ACCELERATOR, read16(this, form, FT_ACCELERATOR) & ~TC_IA_ABLE);
    }
  }

  try {
    return await displayExtTextOut.call(
      this,
      lpDestDev,
      x,
      y,
      lpClipRect,
      lpString,
      count,
      lpFontInfo,
      lpDrawMode,
      lpTextXForm,
      lpCharWidths,
      lpOpaqueRect,
      wOptions
    );
  } finally {
    if (saved) {
      write16(this, form, FT_ACCELERATOR, accelerator);
      write16(this, form, FT_WEIGHT, saved[0]);
      write8(this, form, FT_ITALIC, saved[1]);
    }
  }
}

/** The display driver's `ExtTextOut` through `Brute` (seg13 `012a`, CH 34h). */
function displayExtTextOut(
  this: any,
  lpDestDev: number,
  x: number,
  y: number,
  lpClipRect: number,
  lpString: number,
  count: number,
  lpFontInfo: number,
  lpDrawMode: number,
  lpTextXForm: number,
  lpCharWidths = 0,
  lpOpaqueRect = 0,
  wOptions = 0
) {
  return brute(
    this,
    lpDestDev,
    EXT_TEXT_OUT,
    () =>
      extTextOut(
        this,
        lpDestDev,
        x,
        y,
        lpClipRect,
        lpString,
        count,
        lpFontInfo,
        lpDrawMode,
        lpTextXForm,
        lpCharWidths,
        lpOpaqueRect,
        wOptions
      ),
    herculesExtTextOut,
    () =>
      vga256.extTextOut(
        this,
        lpDestDev,
        x,
        y,
        lpClipRect,
        lpString,
        count,
        lpFontInfo,
        lpDrawMode,
        lpTextXForm,
        lpCharWidths,
        lpOpaqueRect,
        wOptions
      )
  );
}

/**
 * `DMStrBlt` (seg13 `00df`): `DMExtTextOut` with its own arguments and
 * five words of nought after them -- no widths, no opaque rectangle, no
 * options.
 */
export function DMStrBlt(
  this: any,
  lpDestDev: number,
  x: number,
  y: number,
  lpClipRect: number,
  lpString: number,
  count: number,
  lpFontInfo: number,
  lpDrawMode: number,
  lpTextXForm: number
) {
  return DMExtTextOut.call(
    this,
    lpDestDev,
    x,
    y,
    lpClipRect,
    lpString,
    count,
    lpFontInfo,
    lpDrawMode,
    lpTextXForm,
    0,
    0,
    0
  );
}

export function DMGetCharWidth(
  this: any,
  lpDestDev: number,
  lpBuffer: number,
  wFirstChar: number,
  wLastChar: number,
  lpFontInfo: number,
  _lpDrawMode: number,
  lpTextXForm: number
) {
  return brute(
    this,
    lpDestDev,
    GET_CHAR_WIDTH,
    () => getCharWidth(this, lpBuffer, wFirstChar, wLastChar, lpFontInfo, lpTextXForm),
    () => herculesGetCharWidth(this, lpBuffer, wFirstChar, wLastChar, lpFontInfo),
    () => vga256.getCharWidth(this, lpBuffer, wFirstChar, wLastChar, lpFontInfo)
  );
}

export function DMStretchBlt(this: any, lpDestDev: number) {
  return brute(this, lpDestDev, STRETCH_BLT, null);
}

export function DMDibBits(
  this: any,
  lpBitmap: number,
  fGet: number,
  iStart: number,
  cScans: number,
  lpDIBits: number,
  lpBitmapInfo: number,
  lpDrawMode: number,
  lpTranslate: number
) {
  return brute(
    this,
    lpBitmap,
    DEVICE_BITMAP_BITS,
    () =>
      deviceBitmapBits(this, lpBitmap, fGet, iStart, cScans, lpDIBits, lpBitmapInfo, lpDrawMode),
    'monochrome',
    () =>
      vga256.deviceBitmapBits(
        this,
        lpBitmap,
        fGet,
        iStart,
        cScans,
        lpDIBits,
        lpBitmapInfo,
        lpDrawMode,
        lpTranslate
      )
  );
}

export function DMStretchDIBits(this: any, lpDestDev: number) {
  return brute(this, lpDestDev, STRETCH_DIBITS, null);
}

export function DMSetDibToDev(this: any, lpDestDev: number) {
  return brute(
    this,
    lpDestDev,
    DIB_TO_DEVICE,
    () => dibToDevice(),
    'monochrome',
    () => vga256.dibToDevice()
  );
}

/**
 * `DMTranspose` (seg13 `024d`): eight rows of a monochrome bitmap turned
 * into columns. For each of the stride's bytes across, taken without its
 * sign, the eight bytes down a column, a stride apart, are read -- from
 * the eighth row up where the stride is below nought -- and eight bytes
 * written, one for each bit across: bit 7 from the first row, bit 0 from
 * the eighth. A stride of nought still turns one column. Nothing is
 * answered.
 */
export function DMTranspose(this: any, lpSrc: number, lpDst: number, nStride: number) {
  const stride = (nStride << 16) >> 16;
  const columns = Math.abs(stride);
  const from = lpSrc >>> 0;
  const to = lpDst >>> 0;
  const start = stride < 0 ? 7 * columns : 0;
  let written = 0;

  for (let column = 0; column === 0 || column < columns; column++) {
    const rows: number[] = [];

    for (let row = 0; row < 8; row++) {
      rows.push(read8(this, from, start + column + row * stride));
    }

    for (let bit = 7; bit >= 0; bit--) {
      let byte = 0;

      for (let row = 0; row < 8; row++) {
        byte |= ((rows[row] >> bit) & 1) << (7 - row);
      }

      write8(this, to, written++, byte);
    }
  }
}

/**
 * GDI's `ScanLR` (seg15 `087f`), as `FloodFill` would scan: the device
 * context brought up to date, its point taken to device units, the colour
 * made physical by its driver's `ColorInfo`, and the driver's `ScanLR` on
 * its device answered; -1 for a context of nought. WinBox has the VGA's
 * and the EGA's (`familyOf`), which it reads from its own pixels:
 *
 * * A memory context's bitmap of the display's format or of one plane.
 * * A window's context or the screen's: the screen's own `ScanLR`, the
 *   point moved by the context's origin on the screen and the answer the
 *   screen's x. The whole row of the screen is scanned, whatever windows
 *   are over it or the context's region (**recorded** by `scanscr`).
 */
export function ScanLR(
  this: any,
  hdc: number,
  x: number,
  y: number,
  crColor: number,
  wStyle: number
) {
  if (!(hdc & 0xffff)) {
    return 0xffff;
  }

  const surface = this.handles.resolve(hdc);
  const bitmap = surface?.bitmap;

  if (!(bitmap instanceof DeviceBitmap) || !vga(this)) {
    return 0;
  }

  const [vx, vy] = devicePoint(surface, (x << 16) >> 16, (y << 16) >> 16);
  /* A window's context draws on a view of the screen, which reaches all of
   * it from its origin (`DeviceBitmap.screenView`): the screen's point. */
  const left = bitmap.isView ? bitmap.context.ownerX : 0;
  const top = bitmap.isView ? bitmap.context.ownerY : 0;
  const reach = bitmap.context.reach;
  const width = bitmap.isView ? reach.right + left : bitmap.width;
  const height = bitmap.isView ? reach.bottom + top : bitmap.height;
  const px = vx + left;
  const py = vy + top;
  const mono = bitmap.depth === 1;

  if (!mono && bitmap.depth !== 4) {
    return 0;
  }

  const palette = DevicePalette.forDisplay(this.display, 4);
  const index = matchedIndex(
    this.display,
    palette,
    crColor & 0xff,
    (crColor >>> 8) & 0xff,
    (crColor >>> 16) & 0xff
  );
  const colour = mono ? (flagsOf(this, index) & MONO_WHITE ? 1 : 0) : index;

  if ((py & 0xffff) >= height || (px & 0xffff) >= width) {
    return OFF_SCAN;
  }

  const equal = (wStyle & 1) !== 0;
  const step = wStyle & 2 ? -1 : 1;

  for (let at = px; at >= 0 && at < width; at += step) {
    if ((bitmap.indexAt(at - left, py - top) === colour) === equal) {
      return at;
    }
  }

  return 0xffff;
}

/**
 * The routines `Brute` reaches that WinBox has a helper for, by their
 * offset in the display driver's table: the helper, and the bytes of each
 * of its arguments in the order they are declared, a word marked signed.
 */
const BRUTE_HELPERS: Record<number, { helper: (...args: any[]) => any; sizes: number[] }> = {
  [COLOR_INFO]: { helper: DMColorInfo, sizes: [4, 4, 4] },
  [ENUM_OBJ]: { helper: DMEnumObj, sizes: [4, 2, 4, 4] },
  [PIXEL]: { helper: DMPixel, sizes: [4, -2, -2, 4, 4] },
  [SCAN_LR]: { helper: DMScanLR, sizes: [4, -2, -2, 4, 2] },
};

/** The words `Brute` moves that are not the arguments: the return address and its own two (seg13 `0174`-`0187`). */
const BRUTE_OWN_WORDS = 4;

/**
 * `Brute` called as a helper jumps to it (`GDI.EXE` seg13 `0171`): CH the
 * routine's offset in the display driver's table, CL the words it moves,
 * the arguments among them. The routine chosen as each helper chooses it
 * -- the device the first argument -- and the arguments taken off the
 * stack, as the routine's own return takes them. **Recorded** by `ugaps`:
 * with CX as `DMColorInfo`'s, its answer and its colour.
 */
export async function Brute(this: any) {
  const cpu = core(this);
  const cx = cpu.cx & 0xffff;
  const offset = cx >> 8;
  const bytes = Math.max((cx & 0xff) - BRUTE_OWN_WORDS, 0) * 2;
  const ss = cpu.ss & 0xffff;
  const sp = cpu.sp & 0xffff;
  const word = (at: number) => cpu.read16(ss, (sp + 4 + at) & 0xffff) & 0xffff;
  const known = BRUTE_HELPERS[offset];
  let answer: number;

  if (known) {
    const args: number[] = [];
    let at = bytes;

    for (const size of known.sizes) {
      at -= Math.abs(size);

      if (Math.abs(size) === 4) {
        args.push(((word(at + 2) << 16) | word(at)) >>> 0);
      } else {
        args.push(size < 0 ? (word(at) << 16) >> 16 : word(at));
      }
    }

    answer = await known.helper.apply(this, args);
  } else {
    const device = bytes >= 4 ? ((word(bytes - 2) << 16) | word(bytes - 4)) >>> 0 : 0;

    answer = await brute(this, device, offset, null);
  }

  /* The arguments taken off, the return address moved above them. */
  const ip = cpu.read16(ss, sp);
  const cs = cpu.read16(ss, (sp + 2) & 0xffff);
  const top = (sp + bytes) & 0xffff;

  cpu.write16(ss, top, ip);
  cpu.write16(ss, (top + 2) & 0xffff, cs);
  cpu.sp = top;

  return answer >>> 0;
}
