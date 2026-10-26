'use strict';

import { ClipRegion } from '../../raster/clip-region.js';
import { clipOf } from './clipping.js';
import { segmentSelector } from '../selectors.js';
import { devicePoint, deviceRect, mapped } from './mapping.js';

/**
 * Whether any of a rectangle, or a point, lies where the device context can
 * draw: inside its clip region, within its bitmap. Program Manager asks this
 * of each item before drawing it. **Recorded** by `updrgn` for a point: one
 * inside what `ExcludeUpdateRgn` cut from the clip is not visible, one
 * outside it is. *
 * A rectangle (`GDI.EXE` seg1 `29b7`, which `RectVisible` at `4d06` jumps
 * to once its handle is checked) is mapped to the device, put in order, and
 * for a caller made for Windows 3.00 or before grown a pixel at its right
 * and bottom (`grownForOld`); 101h where any of it is in the clip, nought
 * where none (**recorded** by `gdimisc`).
 */
function clipOfDC(system: any, hdc: number) {
  const surface = system.handles.resolve(hdc);

  return surface?.bitmap ? { surface, clip: clipOf(surface) } : null;
}

const signed = (value: number) => (value << 16) >> 16;

export function RectVisible(this: any, hdc: number, far: number) {
  const found = clipOfDC(this, hdc);

  if (!found || !far) {
    return 0;
  }

  const core = this.machine.cpu.core;
  const word = (at: number) =>
    signed(core.read16((far >>> 16) & 0xffff, ((far & 0xffff) + at) & 0xffff));
  let rect = { left: word(0), top: word(2), right: word(4), bottom: word(6) };

  if (mapped(found.surface)) {
    rect = deviceRect(found.surface, rect.left, rect.top, rect.right, rect.bottom);
  }

  const [left, top, right, bottom] = grownForOld(
    this,
    Math.min(rect.left, rect.right),
    Math.min(rect.top, rect.bottom),
    Math.max(rect.left, rect.right),
    Math.max(rect.top, rect.bottom)
  );

  return found.clip.intersect(ClipRegion.rect(left, top, right, bottom)).kind > 1 ? 0x101 : 0;
}

/**
 * A rectangle in order, its right and bottom moved on a pixel where the
 * module whose code called was made for Windows 3.00 or before, as
 * `RectVisible` and `RectInRegion` do (`GDI.EXE` seg1 `29fc`-`2a0b`,
 * `2aab`-`2abd`, `2af6`).
 */
export function grownForOld(system: any, left: number, top: number, right: number, bottom: number) {
  const version = callerExpectedVersion(system);
  const more = version !== undefined && version <= 0x300 ? 1 : 0;

  return [left, top, right + more, bottom + more];
}

/**
 * The Windows version the module whose code called was made for, as
 * `RectVisible` and `RectInRegion` ask `GetExpWinVer` of their caller's
 * code segment (`GDI.EXE` seg1 `29fc`, `2aad`): the return address's
 * segment found among the running task's program and its libraries.
 * Undefined for a caller of no module of them -- WinBox's own code.
 */
export function callerExpectedVersion(system: any): number | undefined {
  const core = system.machine.cpu.core;
  const cs = core.read16(core.ss, (core.sp + 2) & 0xffff) & 0xfff8;
  const handle = system.scheduler?.active;
  const task = handle ? system.handles.resolve(handle) : null;

  for (const module of task ? [task, ...(task.libraries ?? [])] : []) {
    const loader = module?.loader;
    const segments = loader?.segments ?? [];

    for (let index = 0; index < segments.length; index++) {
      if ((segmentSelector(loader.translate(index + 1)) & 0xfff8) === cs) {
        return module.executable?.neHeader?.expectedWindowsVersion;
      }
    }
  }

  return undefined;
}

export function PtVisible(this: any, hdc: number, x: number, y: number) {
  const found = clipOfDC(this, hdc);

  if (!found) {
    return 0;
  }

  let [px, py] = [signed(x), signed(y)];

  if (mapped(found.surface)) {
    [px, py] = devicePoint(found.surface, px, py);
  }

  return found.clip.contains(px, py) ? 1 : 0;
}
