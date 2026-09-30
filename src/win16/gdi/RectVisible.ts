'use strict';

import { ClipRegion } from '../../raster/clip-region.js';
import { clipOf } from './clipping.js';
import { devicePoint, deviceRect, mapped } from './mapping.js';

/**
 * Whether any of a rectangle, or a point, lies where the device context can
 * draw: inside its clip region, within its bitmap. Program Manager asks this
 * of each item before drawing it. **Recorded** by `updrgn` for a point: one
 * inside what `ExcludeUpdateRgn` cut from the clip is not visible, one
 * outside it is.
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

  return found.clip.intersect(ClipRegion.rect(rect.left, rect.top, rect.right, rect.bottom)).kind >
    1
    ? 1
    : 0;
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
