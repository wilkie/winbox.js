'use strict';

import { ClipRegion } from '../../raster/clip-region.js';
import { Surface } from '../../raster/surface.js';

import { clipOf, originOf, visOf } from './clipping.js';
import { Region } from './gdi-objects.js';
import { deviceX, deviceY, mappingOf } from './mapping.js';
import { PatBlt } from './PatBlt.js';
import { putState, stateOf } from './SaveDC.js';
import { disableAnswer, enableAnswer } from '../display-driver.js';

/**
 * GDI's visible-region family: the calls USER keeps a device context to
 * what shows of its window with, which a program may make too. **Read out**
 * of `GDI.EXE` seg1 and **recorded** by `visfam`, each where it is told;
 * the design they follow is `kb/topics/visible-regions.md`.
 *
 * A context keeps its visible region in the screen's terms (`Surface`'s
 * `visRegion`, `null` for what the surface shows: a window's rectangle, the
 * screen, the bitmap), the copies `SaveVisRgn` saved, and its origin
 * (`dcOrigin`, `null` for its view's corner). What drawing goes through is
 * the clip region within the visible region moved to the context's terms
 * by the origin (`clipOf`, and the surface's own test). A window's context
 * still draws only on its window's pixels as well, through its view of the
 * screen: drawing where `SelectVisRgn` or `SetDCOrg` reach outside it is the
 * design's third phase.
 */

const signed = (value: number) => (value << 16) >> 16;
const pack = (x: number, y: number) => ((x & 0xffff) | ((y & 0xffff) << 16)) >>> 0;

/** The device context a handle stands for, or none. */
function contextOf(system: any, hdc: number): any {
  const surface = hdc ? system.handles.resolve(hdc) : null;

  return surface instanceof Surface ? surface : null;
}

/** The visible region given, its handle's region kept the same. */
function setVis(surface: any, shape: ClipRegion) {
  surface.visRegion = shape;

  if (surface.visObject) {
    surface.visObject.shape = shape;
  }
}

/**
 * A window's context as USER hands it out: its visible region what the
 * window's view covers, and its origin the view's corner -- `SelectVisRgn`
 * of the window's rectangle and `SetDCOrg` from the window (`USER.EXE` seg1
 * `86b2`-`86c8`, `1540`). The copies `SaveVisRgn` saved stay: neither call
 * touches them.
 */
export function resetVisible(surface: any) {
  if (surface instanceof Surface) {
    surface.visRegion = null;
    surface.dcOrigin = null;
  }
}

/**
 * Makes a copy of a region the visible region: its bytes copied into the
 * context's own (seg1 `1635`, `58b3`), the region given staying the
 * program's -- changed after, the context's is not (`visfam`). In the
 * screen's terms, not mapped.
 *
 * @returns {Types.INT} The kind of region drawing is kept to, or nought for
 *                      no device context or no region.
 */
export function SelectVisRgn(this: any, hdc: number, hrgn: number) {
  const surface = contextOf(this, hdc);
  const region = hrgn ? this.handles.resolve(hrgn) : null;

  if (!surface || !(region instanceof Region)) {
    return 0;
  }

  setVis(surface, region.shape);

  return clipOf(surface).kind;
}

/** Narrows the visible region by a rectangle in the screen's terms, its edges as given. */
function visRect(
  system: any,
  hdc: number,
  rect: number[],
  how: (vis: ClipRegion, rect: ClipRegion) => ClipRegion
) {
  const surface = contextOf(system, hdc);

  if (!surface) {
    return 0;
  }

  const [left, top, right, bottom] = rect.map(signed);

  setVis(surface, how(visOf(surface), ClipRegion.rect(left, top, right, bottom)));

  return clipOf(surface).kind;
}

/**
 * Keeps the visible region inside a rectangle in the screen's terms, not
 * mapped: one body with `IntersectClipRect`, told apart by the field it
 * changes (seg1 `16a2`, `16b9`). The wrong way round leaves nothing, and
 * answers 1 (`visfam`).
 *
 * @returns {Types.INT} The kind of region drawing is kept to.
 */
export function IntersectVisRect(
  this: any,
  hdc: number,
  left: number,
  top: number,
  right: number,
  bottom: number
) {
  return visRect(this, hdc, [left, top, right, bottom], (vis, rect) => vis.intersect(rect));
}

/**
 * Takes a rectangle in the screen's terms out of the visible region (seg1
 * `16a5`, `16b9`).
 *
 * @returns {Types.INT} The kind of region drawing is kept to.
 */
export function ExcludeVisRect(
  this: any,
  hdc: number,
  left: number,
  top: number,
  right: number,
  bottom: number
) {
  return visRect(this, hdc, [left, top, right, bottom], (vis, rect) => vis.subtract(rect));
}

/**
 * Moves the visible region (seg1 `2929`).
 *
 * @returns {Types.INT} The kind of region drawing is kept to.
 */
export function OffsetVisRgn(this: any, hdc: number, x: number, y: number) {
  const surface = contextOf(this, hdc);

  if (!surface) {
    return 0;
  }

  setVis(surface, visOf(surface).offset(signed(x), signed(y)));

  return clipOf(surface).kind;
}

/**
 * Pushes a copy of the visible region on the context's stack (seg1
 * `076c`): Windows keeps the stack in the region's own first word, and
 * answers the copy that was on top before. **Recorded** by `visfam`: the
 * first answers nought, the second a handle.
 *
 * @returns {Types.HRGN} The copy saved before, or nought.
 */
export function SaveVisRgn(this: any, hdc: number) {
  const surface = contextOf(this, hdc);

  if (!surface) {
    return 0;
  }

  const region = new Region(visOf(surface));
  const handle = this.handles.allocateGDI(region);
  const before = surface.visSaved.at(-1)?.handle ?? 0;

  if (handle) {
    surface.visSaved.push({ handle, region });
  }

  return before;
}

/**
 * The copy on top of the stack made the visible region, and the region it
 * was deleted (seg1 `07b2`, the old handle let go at `0805`); it answers
 * the visible region's kind (`0811`). With nothing saved, −1 and nothing
 * changed (`07e3`-`07e9`). **Recorded** by `visfam`: `InquireVisRgn` then
 * answers another handle than before.
 *
 * @returns {Types.INT} The visible region's kind, −1 with none saved.
 */
export function RestoreVisRgn(this: any, hdc: number) {
  const surface = contextOf(this, hdc);

  if (!surface) {
    return 0;
  }

  const top = surface.visSaved.pop();

  if (!top) {
    return 0xffff;
  }

  if (surface.visHandle && this.handles.resolve(surface.visHandle) === surface.visObject) {
    this.handles.free(surface.visHandle);
  }

  surface.visHandle = top.handle;
  surface.visObject = top.region;
  surface.visRegion = top.region.shape;

  return visOf(surface).kind;
}

/**
 * The visible region itself, not a copy: the handle at the context's A0h
 * (seg1 `200a`). **Recorded** by `visfam`: the same handle each time until
 * a restore. A program changing it changes the context's region on
 * Windows; here, the region answered is the visible region as it is when
 * asked, and changing it changes nothing.
 *
 * @returns {Types.HRGN} The region, or nought for no device context.
 */
export function InquireVisRgn(this: any, hdc: number) {
  const surface = contextOf(this, hdc);

  if (!surface) {
    return 0;
  }

  const shape = visOf(surface);

  if (surface.visHandle && this.handles.resolve(surface.visHandle) === surface.visObject) {
    surface.visObject.shape = shape;

    return surface.visHandle;
  }

  surface.visObject = new Region(shape);
  surface.visHandle = this.handles.allocateGDI(surface.visObject) ?? 0;

  return surface.visHandle;
}

/**
 * Sets where the context's (0, 0) is on the screen (seg1 `1118`): the
 * origin exchanged, the clip region moved with it -- here, kept in the
 * context's own terms, it stays as it is -- and **the visible region left
 * where it is**. **Recorded** by `visfam`: the clip box moves the other
 * way, and `GetClipRgn`'s region with the origin.
 *
 * Drawing does not yet move: a window's context draws through its view of
 * the screen from the window's corner (the design's third phase).
 *
 * @returns {Types.DWORD} The origin before, x in the low word.
 */
export function SetDCOrg(this: any, hdc: number, x: number, y: number) {
  const surface = contextOf(this, hdc);

  if (!surface) {
    return 0;
  }

  const [oldX, oldY] = originOf(surface);

  surface.dcOrigin = [signed(x), signed(y)];

  return pack(oldX, oldY);
}

/**
 * A copy of the context's state as `SaveDC` makes one, as a context of its
 * own (seg1 `0601`, `0a46`): not the visible region. USER keeps one of
 * each common context it makes, to give the context back as it was.
 *
 * @returns {Types.HDC} The copy, or nought.
 */
export function GetDCState(this: any, hdc: number) {
  const surface = contextOf(this, hdc);

  if (!surface) {
    return 0;
  }

  const copy: any = Surface.memory();

  putState(copy, stateOf(surface));

  return this.handles.allocateGDI(copy) ?? 0;
}

/**
 * Puts a state `GetDCState` copied back into a context (seg1 `0615`): its
 * origin set through `SetDCOrg` where it differs, its visible region kept.
 * **Recorded** by `visfam`: the text colour comes back, and a visible
 * region narrowed between stays narrowed.
 */
export function SetDCState(this: any, hdc: number, hSavedDC: number) {
  const surface = contextOf(this, hdc);
  const saved = contextOf(this, hSavedDC);

  if (surface && saved) {
    putState(surface, stateOf(saved));
  }
}

/**
 * Whether a context is the display's: not a memory context, nor a
 * printer's. GDI tests the memory flag, bit 0 of the context's byte at
 * 0Ah, and the driver's `RC_GDI20_OUTPUT` (seg1 `422e`-`423c`), which every
 * display driver Windows 3.1 brings has.
 */
function onDisplay(surface: any) {
  return !surface.memoryContext && !surface.printer && !surface.driverDevice;
}

/**
 * A rectangle's frame, `xWidth` across and `yWidth` down, drawn in one
 * call by the display driver's `FastBorder` (seg1 `420e`): only on a
 * display's context whose region drawing goes through is one rectangle
 * (`4243`-`424c`); nought otherwise, and USER then draws the frame another
 * way. The rectangle is mapped to the device (`427d`). **Read out** of
 * `VGA.DRV` seg1 `2532`: the four sides drawn with the context's brush and
 * the operation, each kept to the clip box, and −1 answered (`280f`).
 * **Recorded** by `visfam`: −1 and the frame on a window's context, nought
 * and nothing drawn with a corner cut out of the visible region, nought on
 * a memory context.
 *
 * @returns {Types.BOOL} −1 where the driver drew it, else nought.
 */
export function FastWindowFrame(
  this: any,
  hdc: number,
  lprc: any,
  xWidth: number,
  yWidth: number,
  rop: number
) {
  const surface = contextOf(this, hdc);

  if (!surface || !lprc || !onDisplay(surface) || clipOf(surface).kind !== 2) {
    return 0;
  }

  const m = mappingOf(surface);
  const left = deviceX(m, signed(lprc.left));
  const top = deviceY(m, signed(lprc.top));
  const right = deviceX(m, signed(lprc.right));
  const bottom = deviceY(m, signed(lprc.bottom));
  const across = signed(xWidth);
  const down = signed(yWidth);
  const width = right - left;
  const height = bottom - top;

  /* The sides in the device's terms: the mapping set aside while they are drawn. */
  const mapping = surface.mapping;

  surface.mapping = undefined;

  try {
    PatBlt.call(this, hdc, left, top, width, down, rop);
    PatBlt.call(this, hdc, left, bottom - down, width, down, rop);
    PatBlt.call(this, hdc, left, top + down, across, height - 2 * down, rop);
    PatBlt.call(this, hdc, right - across, top + down, across, height - 2 * down, rop);
  } finally {
    surface.mapping = mapping;
  }

  return 0xffff;
}

/**
 * The display driver's `Disable`, through the context's driver (seg1
 * `2067`): what it answers, answered. USER calls it as it gives the screen
 * to a full-screen DOS program. WinBox's display is not turned off; the
 * answer is the driver's (`display-driver.ts`, `disableAnswer`). Nought for
 * no device context, and for a printer's, whose driver's is not followed.
 *
 * @returns {Types.INT} What the driver's `Disable` answers.
 */
export function Death(this: any, hdc: number) {
  const surface = contextOf(this, hdc);

  if (!surface || surface.printer || surface.driverDevice) {
    return 0;
  }

  return disableAnswer(this.display?.driverFile);
}

/**
 * The display driver's `Enable`, through the context's driver, the six
 * words given passed on (seg1 `208e`); on a palette device the palette is
 * set again (`20cc`-`2102`), which WinBox's, never turned off, still has.
 *
 * @returns {Types.INT} What the driver's `Enable` answers.
 */
export function Resurrection(this: any, hdc: number) {
  const surface = contextOf(this, hdc);

  if (!surface || surface.printer || surface.driverDevice) {
    return 0;
  }

  return enableAnswer(this.display?.driverFile);
}
