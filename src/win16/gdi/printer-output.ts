'use strict';

import { GlobalAlloc } from '../kernel/GlobalAlloc.js';
import { GlobalFree } from '../kernel/GlobalFree.js';
import { GlobalLock } from '../kernel/GlobalLock.js';
import { DWORD, UINT } from '../types.js';
import { clipOf } from './clipping.js';
import { handleHeld } from './DeleteObject.js';
import { GetStockObject } from './GetStockObject.js';
import { devicePoint, mapped, mappingOf, scale } from './mapping.js';
import { MulDiv } from './MulDiv.js';
import { deviceFont, type PDevice } from './printer-driver.js';

/**
 * Drawing on a printer driver's device context, as Windows' GDI hands it
 * to the driver: the pens and brushes realized by the driver's
 * `RealizeObject`, the colours by its `ColorInfo`, and the figures and the
 * text by its `Output` and `ExtTextOut`. The twin of
 * `crates/winbox-win16/src/gdi/printer_output.rs`.
 *
 * What GDI keeps of a context in its own heap -- the `DRAWMODE` at +44h,
 * the realized pen and brush, the `TEXTXFORM` -- is kept here in a block
 * of global memory of the context's own, and given to the driver by far
 * pointers as GDI gives its own.
 */

const COLOR_INFO = 2;
const OUTPUT = 8;
const REALIZE_OBJECT = 10;
const EXT_TEXT_OUT = 14;
const STRETCH_DIBITS = 28;

const OBJ_PEN = 1;
const OBJ_BRUSH = 2;

const OS_ARC = 3;
const OS_RECTANGLE = 6;
const OS_ELLIPSE = 7;
const OS_POLYLINE = 0x12;
const OS_WINDPOLYGON = 0x14;
const OS_ALTPOLYGON = 0x16;
const OS_PIE = 0x17;
const OS_CHORD = 0x27;
const OS_CIRCLE = 0x37;
const OS_ROUNDRECT = 0x48;

const PS_SOLID = 0;
const PS_NULL = 5;
const PS_INSIDEFRAME = 6;
const BS_HOLLOW = 1;
const WHITE_BRUSH = 0;
const BLACK_PEN = 7;

/* The `DRAWMODE` and the `TEXTXFORM` in the context's block. */
const DRAWMODE = 0;
const TEXTXFORM = 0x20;
const FT_ACCELERATOR = 0x0f;
const DP_TEXT = 0x22;
const DP_RASTER = 0x26;
const RC_GDI20_OUTPUT = 0x10;
const TC_EA_DOUBLE = 0x200;
const TC_IA_ABLE = 0x400;
const BLOCK_SIZE = 0x40;

interface Realized {
  handle: number;
  far: number;
  /** What it was realized for: a pen's width; a hatched brush's background, a brush's origin. */
  key: string;
  /** The order realizations were made in, which GDI deletes them in, newest first. */
  serial: number;
}

/** What GDI keeps of a driver's context for drawing. */
export interface DriverDrawing {
  handle: number;
  far: number;
  /** The realized pen: its far pointer, and its width and height in device units (+88h, +8Ah). */
  pen: Realized | null;
  penWidth: number;
  penHeight: number;
  /** The realized brush (+36h). */
  brush: Realized | null;
  /** The physical colours `ColorInfo` gave, as the `DRAWMODE` keeps them. */
  bkColor: number;
  textColor: number;
}

function core(system: any) {
  return system.machine.cpu.core;
}

function write16(system: any, far: number, at: number, value: number) {
  core(system).write16((far >>> 16) & 0xffff, ((far & 0xffff) + at) & 0xffff, value & 0xffff);
}

function write32(system: any, far: number, at: number, value: number) {
  write16(system, far, at, value & 0xffff);
  write16(system, far, at + 2, value >>> 16);
}

function offsetBy(far: number, at: number) {
  return ((far & 0xffff0000) | ((far + at) & 0xffff)) >>> 0;
}

function proc(pdevice: PDevice, ordinal: number) {
  return pdevice.driver.procs[ordinal - 1] ?? 0;
}

async function callDriver(system: any, procedure: number, args: [number, number][]) {
  return Number((await system.scheduler.callProc(procedure, args)) ?? 0) >>> 0;
}

/**
 * Bytes laid below the stack for a call, as GDI lays its own on its
 * stack: given to `body` as a far pointer.
 */
async function onStack<T>(system: any, bytes: Uint8Array, body: (far: number) => Promise<T>) {
  const cpu = core(system);
  const saved = cpu.sp;
  const sp = (saved - ((bytes.length + 1) & ~1)) & 0xffff;

  bytes.forEach((byte, step) => cpu.write8(cpu.ss, (sp + step) & 0xffff, byte));
  cpu.sp = (sp - 4) & 0xffff;

  try {
    return await body(((cpu.ss << 16) | sp) >>> 0);
  } finally {
    cpu.sp = saved;
  }
}

/** Bytes laid below the stack, given to `body` as a far pointer. */
export async function onStackBytes<T>(
  system: any,
  bytes: Uint8Array,
  body: (far: number) => Promise<T>
) {
  return onStack(system, bytes, body);
}

/**
 * A `RECT` laid below the stack, as USER lays one on its own for GDI: given
 * to `body` as a far pointer.
 */
export async function withRect<T>(
  system: any,
  rect: { left: number; top: number; right: number; bottom: number },
  body: (far: number) => Promise<T>
) {
  return onStack(system, words(rect.left, rect.top, rect.right, rect.bottom), body);
}

function words(...values: number[]) {
  const bytes = new Uint8Array(values.length * 2);

  values.forEach((value, at) => {
    bytes[at * 2] = value & 0xff;
    bytes[at * 2 + 1] = (value >> 8) & 0xff;
  });

  return bytes;
}

/** The far pointer a string argument was read from (`read-arguments.ts`). */
export function farOf(arg: any) {
  if (arg && typeof arg === 'object' && arg.segment !== undefined) {
    return ((arg.segment << 16) | (arg.offset & 0xffff)) >>> 0;
  }

  return Number(arg ?? 0) >>> 0;
}

/**
 * What a pen or brush is realized for a device by: its handle, a stock
 * object's for one a context starts with, as a context starts with the
 * stock objects themselves.
 */
function objectKey(system: any, object: any, stock: number) {
  if (!object || (object.stock !== undefined && object.stock !== null)) {
    return GetStockObject.call(system, object?.stock ?? stock);
  }

  return handleHeld(system, object) ?? object;
}

function drawingOf(surface: any): DriverDrawing {
  return surface.driverDrawing;
}

/**
 * A driver's context made ready to draw on, as GDI's `CreateDC` makes it
 * (`GDI.EXE` seg1 `0192`-`0231`): the `DRAWMODE`'s `R2_COPYPEN` and
 * `OPAQUE`; the background white and the text black, each through the
 * driver's `ColorInfo`; the white brush, the black pen and the font
 * realized (`022e`), unless realized for the device already.
 */
export async function startDrawing(system: any, surface: any) {
  const handle = GlobalAlloc.call(system, 0x2042, BLOCK_SIZE);
  const far = handle ? GlobalLock.call(system, handle) >>> 0 : 0;
  const drawing: DriverDrawing = {
    handle,
    far,
    pen: null,
    penWidth: 1,
    penHeight: 1,
    brush: null,
    bkColor: 0,
    textColor: 0,
  };

  surface.driverDrawing = drawing;

  if (!far) {
    return;
  }

  write16(system, far, DRAWMODE, 13);
  write16(system, far, DRAWMODE + 2, 2);
  drawing.bkColor = await colorInfo(system, surface, 0xffffff);
  drawing.textColor = await colorInfo(system, surface, 0);
  await realizeBrush(system, surface);
  await realizePen(system, surface);
  await deviceFont(system, surface);
}

/**
 * The context's drawing block let go. What was realized stays with the
 * device (`printer-driver.ts`, `deleteDriverDC`).
 */
export function stopDrawing(system: any, surface: any) {
  const drawing = drawingOf(surface);

  if (!drawing) {
    return;
  }

  if (drawing.handle) {
    GlobalFree.call(system, drawing.handle);
  }

  surface.driverDrawing = null;
}

/**
 * A colour as the driver makes it physical (seg1 `1526`): its
 * `ColorInfo` with the colour and somewhere to write the physical one,
 * which GDI keeps in the `DRAWMODE`.
 */
async function colorInfo(system: any, surface: any, rgb: number) {
  const pdevice: PDevice = surface.driverDevice;
  const procedure = proc(pdevice, COLOR_INFO);
  let physical = 0;

  if (!procedure) {
    return 0;
  }

  await onStack(system, new Uint8Array(4), async (far) => {
    await callDriver(system, procedure, [
      [pdevice.lpPDevice, DWORD],
      [rgb >>> 0, DWORD],
      [far, DWORD],
    ]);

    const cpu = core(system);

    physical =
      (cpu.read16(far >>> 16, far & 0xffff) |
        (cpu.read16(far >>> 16, ((far & 0xffff) + 2) & 0xffff) << 16)) >>>
      0;
  });

  return physical;
}

/**
 * `SetBkColor` or `SetTextColor` on a driver's context (seg1 `1476`,
 * `14dc`): the physical colour the driver's `ColorInfo` makes of it kept
 * for the `DRAWMODE`. A hatched brush selected is selected again where
 * the background's physical colour changed (`1556`-`1575`), and so
 * realized for it.
 */
export async function setDriverColor(system: any, surface: any, which: 'bk' | 'text', rgb: number) {
  const drawing = drawingOf(surface);

  if (!drawing) {
    return;
  }

  const physical = await colorInfo(system, surface, rgb);

  if (which === 'bk') {
    const before = drawing.bkColor;

    drawing.bkColor = physical;

    if (brushStyle(surface) === 2 && physical !== before) {
      await realizeBrush(system, surface);
    }
  } else {
    drawing.textColor = physical;
  }
}

/**
 * The driver's `RealizeObject` for a pen or a brush (seg1 `26e5`,
 * `256f`): asked the size with nought for the object, then given a block
 * that large; nought for none.
 */
async function realizeObject(
  system: any,
  surface: any,
  object: any,
  key: string,
  style: number,
  logical: Uint8Array,
  fifth: (out: number) => number
): Promise<Realized | null> {
  const pdevice: PDevice = surface.driverDevice;
  const kept = pdevice.realized.get(object)?.find((each) => each.key === key);

  if (kept) {
    return kept;
  }

  const procedure = proc(pdevice, REALIZE_OBJECT);

  if (!procedure) {
    return null;
  }

  const size =
    (await onStack(system, logical, (lp) =>
      callDriver(system, procedure, [
        [pdevice.lpPDevice, DWORD],
        [style, UINT],
        [lp, DWORD],
        [0, DWORD],
        [fifth(0), DWORD],
      ])
    )) & 0xffff;

  if (!size) {
    return null;
  }

  const handle = GlobalAlloc.call(system, 0x2042, size);

  if (!handle) {
    return null;
  }

  const far = GlobalLock.call(system, handle) >>> 0;
  const done =
    (await onStack(system, logical, (lp) =>
      callDriver(system, procedure, [
        [pdevice.lpPDevice, DWORD],
        [style, UINT],
        [lp, DWORD],
        [far, DWORD],
        [fifth(far), DWORD],
      ])
    )) & 0xffff;

  if (!done) {
    GlobalFree.call(system, handle);
    return null;
  }

  const realized = {
    handle,
    far,
    key,
    serial: (system._realizedSerial = (system._realizedSerial ?? 0) + 1),
  };

  pdevice.realized.set(object, [realized, ...(pdevice.realized.get(object) ?? [])]);
  return realized;
}

/**
 * A pen or brush deleted, as GDI deletes one (`GDI.EXE` seg1 `1a2a`): each
 * realization of it, the newest first, given back to its device's driver,
 * whose `RealizeObject` is called with -`OBJ_PEN` or -`OBJ_BRUSH`, the
 * realized object as the object in, and no object out or `TEXTXFORM`;
 * then let go (`1aa1`).
 */
export async function deleteDriverObject(system: any, handle: number, style: number) {
  const { driverDevices } = await import('./printer-driver.js');
  const found: { pdevice: PDevice; realized: Realized }[] = [];

  for (const pdevice of driverDevices(system)) {
    for (const realized of pdevice.realized.get(handle) ?? []) {
      found.push({ pdevice, realized });
    }

    pdevice.realized.delete(handle);
  }

  found.sort((a, b) => b.realized.serial - a.realized.serial);

  for (const { pdevice, realized } of found) {
    const procedure = proc(pdevice, REALIZE_OBJECT);

    if (procedure) {
      await callDriver(system, procedure, [
        [pdevice.lpPDevice, DWORD],
        [-style & 0xffff, UINT],
        [realized.far, DWORD],
        [0, DWORD],
        [0, DWORD],
      ]);
    }

    GlobalFree.call(system, realized.handle);
  }
}

/**
 * The selected pen realized (seg1 `2640`): its `LOGPEN` with the width
 * made device units, `MulDiv` by the viewport's extent over the window's,
 * its size; the height the width by the device's aspects. GDI keeps a pen
 * realized for each device and width, as here.
 */
export async function realizePen(system: any, surface: any) {
  const drawing = drawingOf(surface);
  const pdevice: PDevice = surface.driverDevice;
  const logpen = surface.pen?.logpen ?? { style: PS_SOLID, width: 0, y: 0, color: 0 };
  const m = mappingOf(surface);
  const width = Math.abs(MulDiv(logpen.width, m.vex, m.wex));
  const info = pdevice.info;
  const aspectX = info[0x28] | (info[0x29] << 8);
  const aspectY = info[0x2a] | (info[0x2b] << 8);
  const realized = await realizeObject(
    system,
    surface,
    objectKey(system, surface.pen?.logpen ? surface.pen : null, BLACK_PEN),
    `${width}`,
    OBJ_PEN,
    words(logpen.style, width, logpen.y, logpen.color & 0xffff, logpen.color >>> 16),
    (out) => out
  );

  if (!realized) {
    return false;
  }

  drawing.pen = realized;
  drawing.penWidth = width;
  drawing.penHeight = MulDiv(width, aspectX, aspectY);
  return true;
}

/**
 * The selected brush realized (seg1 `2304`): its `LOGBRUSH`, and after it
 * the background's physical colour (`23a1`), and the brush's origin as
 * the fifth argument.
 */
export async function realizeBrush(system: any, surface: any) {
  const drawing = drawingOf(surface);
  const logbrush = surface.brush?.logbrush ?? { style: 0, color: 0xffffff, hatch: 0 };
  const origin = surface.brushOrg ?? { x: 0, y: 0 };
  /* A hatched brush is realized again for another background; a pattern's
   * for another origin (seg1 `2345`-`2373`). */
  const key =
    logbrush.style === 2
      ? `${drawing.bkColor}`
      : logbrush.style === 3
        ? `${origin.x},${origin.y}`
        : '';
  const realized = await realizeObject(
    system,
    surface,
    objectKey(system, surface.brush, WHITE_BRUSH),
    key,
    OBJ_BRUSH,
    /* The `LOGBRUSH`, and after it the background's physical colour (`23a1`). */
    words(
      logbrush.style,
      logbrush.color & 0xffff,
      logbrush.color >>> 16,
      logbrush.hatch,
      drawing.bkColor & 0xffff,
      drawing.bkColor >>> 16
    ),
    () => ((origin.x & 0xffff) | ((origin.y & 0xffff) << 16)) >>> 0
  );

  if (!realized) {
    return false;
  }

  drawing.brush = realized;
  return true;
}

/** The `DRAWMODE` as the context has it now. */
function drawMode(system: any, surface: any) {
  const drawing = drawingOf(surface);
  const far = offsetBy(drawing.far, DRAWMODE);

  const justified = surface.justification;

  write16(system, far, 0, surface.rop2 ?? 13);
  write16(system, far, 2, surface.backMode ?? 2);
  write32(system, far, 4, drawing.bkColor);
  write32(system, far, 8, drawing.textColor);
  write16(system, far, 0x0c, justified ? justified.extra * justified.count + justified.rem : 0);
  write16(system, far, 0x0e, justified?.extra ?? 0);
  write16(system, far, 0x10, justified?.err ?? 0);
  write16(system, far, 0x12, justified?.rem ?? 0);
  write16(system, far, 0x14, justified?.count ?? 0);
  write16(system, far, 0x16, surface.charExtra ?? 0);
  write32(system, far, 0x18, (surface.backcolor?.colorref ?? 0xffffff) >>> 0);
  write32(system, far, 0x1c, (surface.textColor?.colorref ?? 0) >>> 0);

  return far;
}

/** The context's visible region, as GDI keeps it at +1Eh: the page, and the clip within it. */
function visibleRegion(surface: any) {
  return clipOf(surface);
}

type Rect = [number, number, number, number];

/**
 * The rectangles of the visible region within a rectangle, as GDI walks
 * them (seg1 `2b62`): each band's runs cut to the rectangle, the empty
 * left out; the bands from the bottom up, or from the top down.
 */
function regionRects(surface: any, within: Rect, topDown: boolean): Rect[] {
  const bands = [...visibleRegion(surface).bands];
  const rects: Rect[] = [];

  if (!topDown) {
    bands.reverse();
  }

  for (const band of bands) {
    const top = Math.max(band.top, within[1]);
    const bottom = Math.min(band.bottom, within[3]);

    if (top >= bottom) {
      continue;
    }

    for (const [left, right] of band.spans) {
      const l = Math.max(left, within[0]);
      const r = Math.min(right, within[2]);

      if (l < r) {
        rects.push([l, top, r, bottom]);
      }
    }
  }

  return rects;
}

/**
 * Where a figure's bounds are against the visible region (seg18 `0000`):
 * 2 where the region is one rectangle and holds them, else 1.
 */
function placement(surface: any, left: number, top: number, right: number, bottom: number) {
  const region = visibleRegion(surface);

  if (region.kind !== 2) {
    return 1;
  }

  const box = region.box;

  return box.left <= left && box.top <= top && box.right > right && box.bottom > bottom ? 2 : 1;
}

/** The driver's `Output`, once, with the clip rectangle given or none. Its answer, signed. */
async function output(
  system: any,
  surface: any,
  style: number,
  points: number[],
  brush: boolean,
  clip: Rect | null
) {
  const pdevice: PDevice = surface.driverDevice;
  const drawing = drawingOf(surface);
  const procedure = proc(pdevice, OUTPUT);

  if (!procedure) {
    return 0;
  }

  const mode = drawMode(system, surface);
  const answer = await onStack(system, words(...points, ...(clip ?? [0, 0, 0, 0])), (far) =>
    callDriver(system, procedure, [
      [pdevice.lpPDevice, DWORD],
      [style, UINT],
      [points.length / 2, UINT],
      [far, DWORD],
      [drawing.pen?.far ?? 0, DWORD],
      [brush ? (drawing.brush?.far ?? 0) : 0, DWORD],
      [mode, DWORD],
      [clip ? offsetBy(far, points.length * 2) : 0, DWORD],
    ])
  );

  return ((answer & 0xffff) << 16) >> 16;
}

/**
 * A figure GDI hands the driver whole (seg25 `082f`), with the pen and
 * the brush: no clip rectangle where it is inside the visible region;
 * the region's rectangle where that is all the region is; else once for
 * each of the region's rectangles within the figure's bounds, or the
 * region's, out by the pen's width. The last answer.
 */
async function figure(
  system: any,
  surface: any,
  style: number,
  points: number[],
  inside: boolean,
  bounds: Rect | null
) {
  if (inside) {
    return output(system, surface, style, points, true, null);
  }

  const region = visibleRegion(surface);

  if (region.kind === 2) {
    const box = region.box;

    return output(system, surface, style, points, true, [box.left, box.top, box.right, box.bottom]);
  }

  const drawing = drawingOf(surface);
  const box = region.box;
  const base = bounds ?? [box.left, box.top, box.right, box.bottom];
  const within: Rect = [
    base[0] - drawing.penWidth,
    base[1] - drawing.penHeight,
    base[2] + drawing.penWidth,
    base[3] + drawing.penHeight,
  ];
  let answer = 0;

  for (const rect of regionRects(surface, within, true)) {
    answer = await output(system, surface, style, points, true, rect);
  }

  return answer;
}

/** Whether the driver can be given a figure not inside the region (seg25 `0375`). */
function clipsFigures(pdevice: PDevice) {
  const clip = caps(pdevice, 0x24);

  return !!(clip & 2) || (!!(clip & 1) && caps(pdevice, 2) !== 0);
}

function penStyle(surface: any) {
  return surface.pen?.logpen?.style ?? PS_SOLID;
}

function brushStyle(surface: any) {
  return surface.brush?.logbrush?.style ?? 0;
}

function caps(pdevice: PDevice, at: number) {
  return pdevice.info[at] | (pdevice.info[at + 1] << 8);
}

/**
 * `Rectangle` on a driver's context (`GDI.EXE` seg25 `0093`): nothing for
 * one with no width or height, which answers 1; the corners mapped and put
 * in order; the bounds the pen reaches, half its width out on the left and
 * top and the rest on the right and bottom, but for `PS_INSIDEFRAME`. A
 * driver whose `dpPolygonalCaps` has `PC_RECTANGLE` and what the pen and
 * brush need (`PC_INTERIORS`, `PC_WIDE`, `PC_STYLED`) is given
 * `OS_RECTANGLE` with the two corners, inside the frame for
 * `PS_INSIDEFRAME`. 1 where it drew. Not followed: GDI's own drawing for
 * a driver that cannot (`OS_BEGINNSCAN`), and plotters' pens and brushes.
 */
export async function driverRectangle(
  system: any,
  surface: any,
  left: number,
  top: number,
  right: number,
  bottom: number
) {
  if (left === right || top === bottom) {
    return 1;
  }

  const pdevice: PDevice = surface.driverDevice;
  const drawing = drawingOf(surface);
  let [x0, y0] = devicePoint(surface, left, top);
  let [x1, y1] = devicePoint(surface, right, bottom);

  if (x1 < x0) {
    [x0, x1] = [x1, x0];
  }

  if (y1 < y0) {
    [y0, y1] = [y1, y0];
  }

  const pen = penStyle(surface);
  const width = pen === PS_NULL ? 0 : Math.max(drawing.penWidth, 1);
  const height = pen === PS_NULL ? 0 : Math.max(drawing.penHeight, 1);
  let needs = 2;

  if (brushStyle(surface) !== BS_HOLLOW) {
    needs |= 0x80;
  }

  if (pen !== PS_NULL) {
    if (width > 1) {
      needs |= 0x10;
    }

    if (pen !== PS_SOLID && pen !== PS_INSIDEFRAME) {
      needs |= 0x20;
    }
  }

  const bounds: Rect =
    pen === PS_INSIDEFRAME
      ? [x0, y0, x1, y1]
      : [x0 - (width >> 1), y0 - (height >> 1), x1 + ((width - 1) >> 1), y1 + ((height - 1) >> 1)];
  const inside = placement(surface, ...bounds) === 2;

  if ((caps(pdevice, 0x20) & needs) !== needs || (!inside && !clipsFigures(pdevice))) {
    return 0;
  }

  const corners =
    pen === PS_INSIDEFRAME
      ? [x0 + (width >> 1), y0 + (height >> 1), x1 - (width >> 1), y1 - (height >> 1)]
      : [x0, y0, x1, y1];
  const answer = await figure(system, surface, OS_RECTANGLE, corners, inside, bounds);

  return answer === -1 ? 0 : 1;
}

/** What each of the curves gives GDI's routine for them (seg9 `0000`-`014a`). */
const CURVES = {
  ellipse: { flags: 8, style: OS_ELLIPSE, count: 2, needs: 8 },
  arc: { flags: 1, style: OS_ARC, count: 5, needs: 2 },
  chord: { flags: 2, style: OS_CHORD, count: 5, needs: 2 },
  pie: { flags: 4, style: OS_PIE, count: 5, needs: 2 },
  roundRect: { flags: 0x10, style: OS_ROUNDRECT, count: 3, needs: 0x100 },
};

/**
 * The curves on a driver's context (`GDI.EXE` seg9 `02c4`): `Ellipse`,
 * `Arc`, `Chord`, `Pie` and `RoundRect`. The rectangle's corners and the
 * two points mapped -- a round rectangle's corner as a point out from the
 * left and top -- the corners put in order, the right and bottom brought
 * in by one; none left, nothing drawn. A round rectangle's corner is made
 * a size again, no larger than the rectangle; with none it is a
 * rectangle. A driver whose `dpCurveCaps` has what the curve and the pen
 * and brush need is given the curve with the corners and the points
 * (`05ff`): an ellipse whose sides are as long by the aspects is
 * `OS_CIRCLE` where the driver has `CC_CIRCLES`. Not followed: the arcs
 * whose two points meet, GDI's own drawing for a driver that cannot, and
 * the wide frames GDI draws itself.
 */
export async function driverCurve(
  system: any,
  surface: any,
  kind: keyof typeof CURVES,
  rect: Rect,
  first: [number, number],
  second: [number, number]
) {
  const pdevice: PDevice = surface.driverDevice;
  const drawing = drawingOf(surface);
  const curve = CURVES[kind];
  let [left, top, right, bottom] = rect;
  let p1 = first;

  if (curve.flags & 0x10) {
    const cw = Math.abs(first[0]);
    const ch = Math.abs(first[1]);

    p1 = [left + (left >= right ? -cw : cw), top + (top >= bottom ? -ch : ch)];
  }

  const [dl, dt] = devicePoint(surface, left, top);
  const [dr, db] = devicePoint(surface, right, bottom);
  const d1 = devicePoint(surface, p1[0], p1[1]);
  const d2 = devicePoint(surface, second[0], second[1]);

  left = Math.min(dl, dr);
  right = Math.max(dl, dr) - 1;
  top = Math.min(dt, db);
  bottom = Math.max(dt, db) - 1;

  if (left > right || top > bottom) {
    return 0;
  }

  let radial: number[] = [d1[0], d1[1], d2[0], d2[1]];

  if (curve.flags & 0x10) {
    const across = Math.abs(d1[0] - dl);
    const down = Math.abs(d1[1] - dt);

    if (!across || !down) {
      return driverRectangle(system, surface, ...rect);
    }

    radial = [Math.min(across, right - left), Math.min(down, bottom - top), d2[0], d2[1]];
  }

  const pen = penStyle(surface);
  let needs = curve.needs;
  let style = curve.style;

  if (pen !== PS_NULL) {
    if (drawing.penWidth > 1) {
      needs |= 0x10;
    } else if (pen !== PS_SOLID) {
      needs |= 0x20;
    }
  }

  if (brushStyle(surface) !== BS_HOLLOW) {
    needs |= 0x80;
  }

  const curves = caps(pdevice, 0x1c);

  if (needs & 8 && curves & 1) {
    if ((right - left) * caps(pdevice, 0x28) === (bottom - top) * caps(pdevice, 0x2a)) {
      style = OS_CIRCLE;
      needs &= ~8;
    }
  }

  if ((curves & needs) !== needs) {
    return 0;
  }

  const reachX = (drawing.penWidth >> 1) + 1;
  const reachY = (drawing.penHeight >> 1) + 1;
  const corners = [left, top, right, bottom];

  if (pen === PS_INSIDEFRAME) {
    corners[0] += reachX - 1;
    corners[1] += reachY - 1;
    corners[2] -= reachX - 1;
    corners[3] -= reachY - 1;
  }

  const points = [...corners, ...radial, 0, 0].slice(0, curve.count * 2);
  const inside =
    placement(surface, left - reachX, top - reachY, right + reachX, bottom + reachY) === 2;

  if (!inside && !clipsFigures(pdevice)) {
    return 0;
  }

  const answer = await figure(system, surface, style, points, inside, null);

  return answer === -1 ? 0 : 1;
}

/**
 * A polyline on a driver's context (`GDI.EXE` seg21 `0726`): the points
 * mapped; the bounds of them, out by the pen's reach, their right and
 * bottom made outside, and cut to the visible region; nothing drawn for
 * none left. A pen wider than a pixel needs `LC_WIDE` (and
 * `LC_WIDESTYLED` for a style) and goes as a whole figure (`10cd`); a
 * thin one is given `OS_POLYLINE` with the bounds as the clip rectangle
 * (`0801`), a line of two points along an axis across the region's edge
 * cut to it first. A null pen draws nothing. Not followed: GDI's own lines
 * for a driver that cannot draw them.
 */
export async function driverPolyline(system: any, surface: any, logical: [number, number][]) {
  const pdevice: PDevice = surface.driverDevice;
  const drawing = drawingOf(surface);
  const pen = penStyle(surface);

  if (pen === PS_NULL || pen > PS_INSIDEFRAME || logical.length < 2) {
    return 0;
  }

  const points = logical.map(([x, y]) => devicePoint(surface, x, y));
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const reach = ((drawing.penWidth + 1) >> 1) - drawing.penWidth;
  const bounds: Rect = [
    Math.min(...xs) + reach,
    Math.min(...ys) + reach,
    Math.max(...xs) - reach,
    Math.max(...ys) - reach,
  ];

  if (bounds[3] !== 0x7fff) {
    bounds[3]++;
  }

  if (bounds[2] !== 0x7fff) {
    bounds[2]++;
  }

  const region = visibleRegion(surface);

  if (region.kind === 1) {
    return 1;
  }

  let cut = 0;

  if (region.kind === 2) {
    const box = region.box;

    if (box.left > bounds[0]) {
      bounds[0] = box.left;
      cut++;
    }

    if (box.top > bounds[1]) {
      bounds[1] = box.top;
      cut++;
    }

    if (box.right < bounds[2]) {
      bounds[2] = box.right;
      cut++;
    }

    if (box.bottom < bounds[3]) {
      bounds[3] = box.bottom;
      cut++;
    }

    if (bounds[3] <= bounds[1] || bounds[2] <= bounds[0]) {
      return 1;
    }
  } else {
    cut = 2;
  }

  const lines = caps(pdevice, 0x1e);

  if (drawing.penWidth > 1) {
    const needs = pen === PS_SOLID || pen === PS_INSIDEFRAME ? 0x10 : 0x50;
    const inside =
      placement(
        surface,
        bounds[0] - drawing.penWidth,
        bounds[1] - drawing.penHeight,
        bounds[2] + drawing.penWidth,
        bounds[3] + drawing.penHeight
      ) === 2;

    if ((lines & needs) !== needs || (!inside && !clipsFigures(pdevice))) {
      return 0;
    }

    await figure(system, surface, OS_POLYLINE, points.flat(), inside, bounds);
    return 1;
  }

  if (!lines || (pen !== PS_SOLID && pen !== PS_INSIDEFRAME && !(lines & 0x20))) {
    return 0;
  }

  /* A thin solid line of two points across the region's edge is cut to
   * it, where it runs along an axis: its ends put in order, each a pixel on
   * where they turn round, as the line leaves out its last point (`09c1`). */
  if (cut && points.length === 2 && pen === PS_SOLID) {
    const [[ax, ay], [bx, by]] = points;

    if (ay === by) {
      let [from, to] = ax > bx ? [bx + 1, ax + 1] : [ax, bx];

      to = Math.min(to, bounds[2]);
      from = Math.max(from, bounds[0]);
      points[0] = [from, ay];
      points[1] = [to, by];
      cut = 0;
    } else if (ax === bx) {
      let [from, to] = ay >= by ? [by + 1, ay + 1] : [ay, by];

      to = Math.min(to, bounds[3]);
      from = Math.max(from, bounds[1]);
      points[0] = [ax, from];
      points[1] = [bx, to];
      cut = 0;
    } else {
      cut = 1;
    }
  }

  if (cut > 1 || (cut === 1 && !(caps(pdevice, 0x24) & 1))) {
    return 0;
  }

  await output(system, surface, OS_POLYLINE, points.flat(), false, bounds);
  return 1;
}

/**
 * `Polygon` on a driver's context (`GDI.EXE` seg24 `0254`, `0396`): the
 * last point left off where it is the first; fewer than two, nothing, and
 * 1. The points mapped and the first put again at the end; the bounds of
 * them. A driver whose `dpPolygonalCaps` has `PC_POLYGON` for `ALTERNATE`
 * or `PC_WINDPOLYGON` for `WINDING`, and what the pen and brush need, is
 * given `OS_ALTPOLYGON` or `OS_WINDPOLYGON`. 1 where it drew. Not
 * followed: GDI's own drawing for a driver that cannot.
 */
export async function driverPolygon(system: any, surface: any, logical: [number, number][]) {
  const pdevice: PDevice = surface.driverDevice;
  const drawing = drawingOf(surface);
  const given = [...logical];

  if (
    given.length > 1 &&
    given[0][0] === given[given.length - 1][0] &&
    given[0][1] === given[given.length - 1][1]
  ) {
    given.pop();
  }

  if (given.length < 2) {
    return 1;
  }

  const points = given.map(([x, y]) => devicePoint(surface, x, y));

  points.push(points[0]);

  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const bounds: Rect = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const pen = penStyle(surface);
  const winding = surface.polyFillMode === 2;
  let needs = winding ? 4 : 1;

  if (brushStyle(surface) !== BS_HOLLOW) {
    needs |= 0x80;
  }

  if (pen !== PS_NULL) {
    if (drawing.penWidth > 1) {
      needs |= 0x10;
    }

    if (pen !== PS_SOLID) {
      needs |= 0x20;
    }
  }

  const inside = placement(surface, ...bounds) === 2;

  if ((caps(pdevice, 0x20) & needs) !== needs || (!inside && !clipsFigures(pdevice))) {
    return 0;
  }

  const answer = await figure(
    system,
    surface,
    winding ? OS_WINDPOLYGON : OS_ALTPOLYGON,
    points.flat(),
    inside,
    bounds
  );

  return answer === -1 ? 0 : 1;
}

/**
 * `ExtTextOut` on a driver's context, for a font the driver realized
 * (`GDI.EXE` seg1 `3162`, `397a`): the start mapped; with the region one
 * rectangle, the driver's `ExtTextOut` given the start, the region's
 * rectangle as the clip, the string and its count, the realized
 * `FONTINFO`, the `DRAWMODE`, the `TEXTXFORM`, the opaque rectangle GDI
 * was given, mapped, and the options. 1. Not followed: the alignments
 * other than the top left, the current position, the spacing given
 * (`lpDx`) and justification's second call, rotation, a complex region,
 * and GDI's own text for a font it realized itself.
 */
export async function driverExtTextOut(
  system: any,
  surface: any,
  x: number,
  y: number,
  options: number,
  lpRect: number,
  lpString: number,
  count: number
) {
  const pdevice: PDevice = surface.driverDevice;
  const procedure = proc(pdevice, EXT_TEXT_OUT);
  const realized = await deviceFont(system, surface);
  const region = visibleRegion(surface);

  if (!procedure || !realized || region.kind !== 2) {
    return 0;
  }

  const drawing = drawingOf(surface);
  const [dx, dy] = devicePoint(surface, x, y);
  const xform = offsetBy(drawing.far, TEXTXFORM);

  realized.xform.forEach((byte, at) =>
    core(system).write8(xform >>> 16, ((xform & 0xffff) + at) & 0xffff, byte)
  );

  const box = region.box;
  const mode = drawMode(system, surface);
  let opaque: number[] | null = null;

  if (lpRect) {
    const cpu = core(system);
    const word = (at: number) =>
      (cpu.read16(lpRect >>> 16, ((lpRect & 0xffff) + at) & 0xffff) << 16) >> 16;
    const [l, t] = devicePoint(surface, word(0), word(2));
    const [r, b] = devicePoint(surface, word(4), word(6));

    opaque = [Math.min(l, r), Math.min(t, b), Math.max(l, r), Math.max(t, b)];
  }

  await onStack(system, words(box.left, box.top, box.right, box.bottom, ...(opaque ?? [])), (far) =>
    callDriver(system, procedure, [
      [pdevice.lpPDevice, DWORD],
      [dx & 0xffff, UINT],
      [dy & 0xffff, UINT],
      [far, DWORD],
      [lpString >>> 0, DWORD],
      [count & 0xffff, UINT],
      [realized.far, DWORD],
      [mode, DWORD],
      [xform, DWORD],
      [0, DWORD],
      [opaque ? offsetBy(far, 8) : 0, DWORD],
      [options & 0xffff, UINT],
    ])
  );

  return 1;
}

/**
 * `GetTextExtent` on a driver's context, for a font the driver realized
 * (`GDI.EXE` seg1 `3c57`, `3ba3`): nought for no characters (`3c75`); else
 * the driver's `ExtTextOut` (its `dpRaster` having
 * `RC_GDI20_OUTPUT`) given no start, no clip, the string, its count
 * negated, the realized `FONTINFO`, the `DRAWMODE`, the `TEXTXFORM` and no
 * spacing, rectangle or options, which answers the extent, the height
 * above the width. What the driver cannot simulate of the font's
 * accelerators, `ftAccelerator` less `dpText`, adds to the width: one
 * more than the count for `TC_EA_DOUBLE`, half the height less one for
 * `TC_IA_ABLE`. Under a mapping mode each is scaled back to logical units.
 * Not followed: the driver's `StrBlt` for one without `RC_GDI20_OUTPUT`,
 * the justification, and GDI's own measure for a font it realized itself.
 */
export async function driverTextExtent(system: any, surface: any, lpString: number, count: number) {
  if (!count) {
    return 0;
  }

  const pdevice: PDevice = surface.driverDevice;
  const procedure = proc(pdevice, EXT_TEXT_OUT);
  const realized = await deviceFont(system, surface);

  if (!procedure || !realized || !(caps(pdevice, DP_RASTER) & RC_GDI20_OUTPUT)) {
    return 0;
  }

  const xformBytes = realized.xform;
  const xformWord = (at: number) => xformBytes[at] | (xformBytes[at + 1] << 8);
  const drawing = drawingOf(surface);
  const xform = offsetBy(drawing.far, TEXTXFORM);

  xformBytes.forEach((byte, at) =>
    core(system).write8(xform >>> 16, ((xform & 0xffff) + at) & 0xffff, byte)
  );

  const answer = await callDriver(system, procedure, [
    [pdevice.lpPDevice, DWORD],
    [0, UINT],
    [0, UINT],
    [0, DWORD],
    [lpString >>> 0, DWORD],
    [-count & 0xffff, UINT],
    [realized.far, DWORD],
    [drawMode(system, surface), DWORD],
    [xform, DWORD],
    [0, DWORD],
    [0, DWORD],
    [0, UINT],
  ]);

  let width = answer & 0xffff;
  let height = (answer >>> 16) & 0xffff;

  const simulated = ~caps(pdevice, DP_TEXT) & xformWord(FT_ACCELERATOR);

  if (simulated & TC_EA_DOUBLE) {
    width = (width + 1 + count) & 0xffff;
  }

  if (simulated & TC_IA_ABLE) {
    width = (width + ((xformWord(0) - 1) >>> 1)) & 0xffff;
  }

  const m = mapped(surface);

  if (m) {
    width = Math.abs(scale(signed(width), Math.abs(m.wex), Math.abs(m.vex))) & 0xffff;
    height = Math.abs(scale(signed(height), Math.abs(m.wey), Math.abs(m.vey))) & 0xffff;
  }

  return (width | (height << 16)) >>> 0;
}

function signed(value: number) {
  return (value << 16) >> 16;
}

/**
 * `StretchDIBits` on a driver's context whose `dpRaster` has
 * `RC_STRETCHDIB` (`GDI.EXE` seg11 `1058`): the destination's corners
 * mapped, its size their difference; for each of the visible region's
 * rectangles within the destination, put in order, from the bottom up,
 * the driver's `StretchDIBits` given the destination, the source, the
 * bits and the header as the program gave them, no conversion, the
 * raster operation, the brush, the `DRAWMODE` and the rectangle as the
 * clip. The answer is the source's height. Not followed: a header GDI
 * converts (a core header, `DIB_PAL_COLORS`, a palette device), and GDI's
 * own drawing where the driver answers -1 or has no `RC_STRETCHDIB`.
 */
export async function driverStretchDIBits(
  system: any,
  surface: any,
  args: {
    x: number;
    y: number;
    width: number;
    height: number;
    srcX: number;
    srcY: number;
    srcWidth: number;
    srcHeight: number;
    bits: number;
    info: number;
    usage: number;
    rop: number;
  }
) {
  const pdevice: PDevice = surface.driverDevice;
  const procedure = proc(pdevice, STRETCH_DIBITS);

  if (!procedure || !(caps(pdevice, 0x26) & 0x2000) || args.usage) {
    return 0;
  }

  const drawing = drawingOf(surface);
  const [x0, y0] = devicePoint(surface, args.x, args.y);
  const [x1, y1] = devicePoint(surface, args.x + args.width, args.y + args.height);
  const within: Rect = [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];

  for (const rect of regionRects(surface, within, false)) {
    const mode = drawMode(system, surface);
    const answer = await onStack(system, words(...rect), (far) =>
      callDriver(system, procedure, [
        [pdevice.lpPDevice, DWORD],
        [0, UINT],
        [x0 & 0xffff, UINT],
        [y0 & 0xffff, UINT],
        [(x1 - x0) & 0xffff, UINT],
        [(y1 - y0) & 0xffff, UINT],
        [args.srcX & 0xffff, UINT],
        [args.srcY & 0xffff, UINT],
        [args.srcWidth & 0xffff, UINT],
        [args.srcHeight & 0xffff, UINT],
        [args.bits >>> 0, DWORD],
        [args.info >>> 0, DWORD],
        [0, DWORD],
        [args.rop >>> 0, DWORD],
        [drawing.brush?.far ?? 0, DWORD],
        [mode, DWORD],
        [far, DWORD],
      ])
    );

    if ((answer & 0xffff) === 0xffff) {
      return 0;
    }
  }

  return args.srcHeight;
}
