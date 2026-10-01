'use strict';

/**
 * A byte of a huge pointer's memory: `at` bytes on from `far`, stepping to
 * the next selector, eight on (`__AHINCR`), at each 64 KiB, as a block
 * GlobalAlloc gives of more than a segment is tiled. GDI reads a DIB's bits
 * so: SimTower's title, 640 by 480 at a byte a pixel, is one
 * `SetDIBitsToDevice` of 300 KB, and Windows shows it whole.
 */
export function hugeRead8(core: any, far: number, at: number) {
  const offset = (far & 0xffff) + at;

  return core.read8((((far >>> 16) & 0xffff) + (offset >>> 16) * 8) & 0xffff, offset & 0xffff);
}
