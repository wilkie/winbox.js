'use strict';

/**
 * Whether any of a rectangle, or a point, lies where the device context can
 * draw: its bitmap, as there are no clipping regions here. Documented, not
 * measured. Program Manager asks this of each item before drawing it.
 */
function bounds(system: any, hdc: number) {
  const surface = system.handles.resolve(hdc);
  const bitmap = surface?.bitmap;

  return bitmap ? { width: bitmap.width, height: bitmap.height } : null;
}

export function RectVisible(this: any, hdc: number, far: number) {
  const area = bounds(this, hdc);

  if (!area || !far) {
    return 0;
  }

  const core = this.machine.cpu.core;
  const word = (at: number) => (core.read16((far >>> 16) & 0xffff, ((far & 0xffff) + at) & 0xffff) << 16) >> 16;
  const lprc = { left: word(0), top: word(2), right: word(4), bottom: word(6) };

  return lprc.left < area.width && lprc.right > 0 && lprc.top < area.height && lprc.bottom > 0 ? 1 : 0;
}

export function PtVisible(this: any, hdc: number, x: number, y: number) {
  const area = bounds(this, hdc);
  const px = (x << 16) >> 16;
  const py = (y << 16) >> 16;

  return area && px >= 0 && py >= 0 && px < area.width && py < area.height ? 1 : 0;
}
