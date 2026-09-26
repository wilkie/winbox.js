'use strict';

/**
 * Mapping modes: how a device context turns the coordinates a program gives
 * it, logical, into its pixels, device.
 *
 * A point is `(logical - window origin) * viewport extent / window extent +
 * viewport origin` on each axis. **Recorded** by `mapmode` on four displays:
 * the division rounds to the nearest, a half away from nought, except that
 * the half added is the divisor shifted right by one, which for a negative
 * odd divisor is the larger half: with a window extent of 7 and a viewport
 * extent of -3, device 1 is logical -3, not -2. Every drawing call maps its
 * points and a rectangle's corners this way.
 *
 * The modes, **recorded**:
 *
 * * `SetMapMode` answers the mode before; 0 and anything past 8 answer
 *   nought and change nothing.
 * * `MM_TEXT` has extents of one. `MM_LOMETRIC` to `MM_TWIPS` have their
 *   display driver's own, with the viewport's y negative. `MM_ISOTROPIC`
 *   starts at `MM_LOMETRIC`'s; `MM_ANISOTROPIC` keeps what the device
 *   context had.
 * * Only those two take new extents. Elsewhere `SetWindowExt` and
 *   `SetViewportExt` answer the extent and change nothing. An extent of
 *   nought answers nought.
 * * `MM_ISOTROPIC` then shrinks the viewport's extent on the axis that
 *   would have the larger scale, keeping its sign, so the two scales agree
 *   in length on the screen.
 * * The origins can be set in every mode. Each call answers what it had,
 *   x in the low word.
 *
 * Not followed: sizes -- a font's height, a pen's width, `ExtTextOut`'s
 * spacing -- and the calls that take lists of points.
 */

export const MM_TEXT = 1;
export const MM_ISOTROPIC = 7;
export const MM_ANISOTROPIC = 8;

export interface Mapping {
  mode: number;
  wox: number;
  woy: number;
  wex: number;
  wey: number;
  vox: number;
  voy: number;
  vex: number;
  vey: number;
}

export const IDENTITY: Mapping = {
  mode: MM_TEXT,
  wox: 0,
  woy: 0,
  wex: 1,
  wey: 1,
  vox: 0,
  voy: 0,
  vex: 1,
  vey: 1,
};

/** A device context's mapping. */
export function mappingOf(surface: any): Mapping {
  return surface?.mapping ?? IDENTITY;
}

/** Whether a mapping leaves every coordinate as it is. */
export function isIdentity(m: Mapping) {
  return (
    m.wox === 0 && m.woy === 0 && m.vox === 0 && m.voy === 0 && m.wex === m.vex && m.wey === m.vey
  );
}

/** `a * b / c`, rounded as GDI rounds a mapped coordinate. */
export function scale(a: number, b: number, c: number) {
  const product = a * b;

  if (!product) {
    return 0;
  }

  const half = Math.abs(c >> 1);

  return Math.trunc((product + (product < 0 ? -half : half)) / c);
}

/** A logical x in device terms. */
export const deviceX = (m: Mapping, x: number) =>
  m.wex === m.vex ? x - m.wox + m.vox : scale(x - m.wox, m.vex, m.wex) + m.vox;

/** A logical y in device terms. */
export const deviceY = (m: Mapping, y: number) =>
  m.wey === m.vey ? y - m.woy + m.voy : scale(y - m.woy, m.vey, m.wey) + m.voy;

/** A device x in logical terms. */
export const logicalX = (m: Mapping, x: number) =>
  m.wex === m.vex ? x - m.vox + m.wox : scale(x - m.vox, m.wex, m.vex) + m.wox;

/** A device y in logical terms. */
export const logicalY = (m: Mapping, y: number) =>
  m.wey === m.vey ? y - m.voy + m.woy : scale(y - m.voy, m.wey, m.vey) + m.woy;

/**
 * A logical rectangle, as an edge and an extent on each axis, in device
 * terms: both of its corners mapped. The extent is negative where the
 * mapping turns the axis over.
 */
export function deviceBox(surface: any, x: number, y: number, width: number, height: number) {
  const m = mappingOf(surface);
  const left = deviceX(m, x);
  const top = deviceY(m, y);

  return {
    x: left,
    y: top,
    width: deviceX(m, x + width) - left,
    height: deviceY(m, y + height) - top,
  };
}

/** Logical corners, left, top, right and bottom, as device corners in order. */
export function deviceRect(surface: any, left: number, top: number, right: number, bottom: number) {
  const m = mappingOf(surface);
  const x0 = deviceX(m, left);
  const y0 = deviceY(m, top);
  const x1 = deviceX(m, right);
  const y1 = deviceY(m, bottom);

  return {
    left: Math.min(x0, x1),
    top: Math.min(y0, y1),
    right: Math.max(x0, x1),
    bottom: Math.max(y0, y1),
  };
}

/** A logical point in device terms. */
export function devicePoint(surface: any, x: number, y: number): [number, number] {
  const m = mappingOf(surface);

  return [deviceX(m, x), deviceY(m, y)];
}

const signed = (value: number) => (value << 16) >> 16;
const pack = (x: number, y: number) => ((x & 0xffff) | ((y & 0xffff) << 16)) >>> 0;

/**
 * `MM_ISOTROPIC`'s viewport: the extent on the axis with the larger scale
 * shrunk to the other's. The scales are compared in lengths, not pixels: a
 * pixel is `ASPECTX` wide to `ASPECTY` tall. **Recorded** on the EGA, 38 to
 * 48, where a window of 100 by 100 on a viewport of 640 by -350 makes it 442
 * by -350, and on the Hercules.
 */
function isotropic(m: Mapping, aspectX: number, aspectY: number): Mapping {
  const across = Math.abs(m.vex) * Math.abs(m.wey) * aspectX;
  const down = Math.abs(m.vey) * Math.abs(m.wex) * aspectY;

  if (across > down) {
    const vex = scale(Math.abs(m.vey) * Math.abs(m.wex), aspectY, Math.abs(m.wey) * aspectX);

    return { ...m, vex: m.vex < 0 ? -vex : vex };
  }

  if (down > across) {
    const vey = scale(Math.abs(m.vex) * Math.abs(m.wey), aspectX, Math.abs(m.wex) * aspectY);

    return { ...m, vey: m.vey < 0 ? -vey : vey };
  }

  return m;
}

/** The fixed modes' extents, from the display. */
function extentsFor(system: any, mode: number) {
  const table = system.display?.mappingExtents;
  const [wex, wey, vex, vey] = table?.[mode - 2] ?? [1, 1, 1, 1];

  return { wex, wey, vex, vey };
}

/**
 * Sets the mapping mode.
 *
 * @param {Types.HDC} hdc - The device context.
 * @param {Types.INT} fnMapMode - The mode, 1 to 8.
 *
 * @returns {Types.INT} The mode before, or nought.
 */
export function SetMapMode(hdc, fnMapMode) {
  const surface = this.handles.resolve(hdc);
  const mode = signed(fnMapMode);

  if (!surface || mode < 1 || mode > 8) {
    return 0;
  }

  const m = mappingOf(surface);
  const extents =
    mode === MM_TEXT
      ? { wex: 1, wey: 1, vex: 1, vey: 1 }
      : mode === MM_ANISOTROPIC
        ? { wex: m.wex, wey: m.wey, vex: m.vex, vey: m.vey }
        : extentsFor(this, mode === MM_ISOTROPIC ? 2 : mode);

  surface.mapping = { ...m, ...extents, mode };

  return m.mode;
}

/** @returns {Types.INT} The mapping mode. */
export function GetMapMode(hdc) {
  const surface = this.handles.resolve(hdc);

  return surface ? mappingOf(surface).mode : 0;
}

/** Sets one origin, answering the one before. */
function origin(system: any, hdc: number, which: 'wo' | 'vo', x: number, y: number, add: boolean) {
  const surface = system.handles.resolve(hdc);

  if (!surface) {
    return 0;
  }

  const m: any = mappingOf(surface);
  const oldX = m[`${which}x`];
  const oldY = m[`${which}y`];

  surface.mapping = {
    ...m,
    [`${which}x`]: signed(x) + (add ? oldX : 0),
    [`${which}y`]: signed(y) + (add ? oldY : 0),
  };

  return pack(oldX, oldY);
}

/** Sets one extent, where the mode lets it, answering the one before. */
function extent(system: any, hdc: number, which: 'we' | 've', x: number, y: number) {
  const surface = system.handles.resolve(hdc);

  if (!surface) {
    return 0;
  }

  const m: any = mappingOf(surface);
  const old = pack(m[`${which}x`], m[`${which}y`]);

  if (m.mode !== MM_ISOTROPIC && m.mode !== MM_ANISOTROPIC) {
    return old;
  }

  if (!x || !y) {
    return 0;
  }

  const changed = { ...m, [`${which}x`]: x, [`${which}y`]: y };

  surface.mapping =
    m.mode === MM_ISOTROPIC
      ? isotropic(changed, system.display?.aspectX ?? 1, system.display?.aspectY ?? 1)
      : changed;

  return old;
}

/** Scales one extent, where the mode lets it, answering the one before. */
function scaleExtent(
  system: any,
  hdc: number,
  which: 'we' | 've',
  xn: number,
  xd: number,
  yn: number,
  yd: number
) {
  const surface = system.handles.resolve(hdc);
  const m: any = surface ? mappingOf(surface) : null;

  if (!m || !xd || !yd) {
    return 0;
  }

  return extent(
    system,
    hdc,
    which,
    scale(m[`${which}x`], signed(xn), signed(xd)),
    scale(m[`${which}y`], signed(yn), signed(yd))
  );
}

export function SetWindowOrg(hdc, x, y) {
  return origin(this, hdc, 'wo', x, y, false);
}

export function SetViewportOrg(hdc, x, y) {
  return origin(this, hdc, 'vo', x, y, false);
}

export function OffsetWindowOrg(hdc, x, y) {
  return origin(this, hdc, 'wo', x, y, true);
}

export function OffsetViewportOrg(hdc, x, y) {
  return origin(this, hdc, 'vo', x, y, true);
}

export function SetWindowExt(hdc, x, y) {
  return extent(this, hdc, 'we', signed(x), signed(y));
}

export function SetViewportExt(hdc, x, y) {
  return extent(this, hdc, 've', signed(x), signed(y));
}

export function ScaleWindowExt(hdc, xNum, xDenom, yNum, yDenom) {
  return scaleExtent(this, hdc, 'we', xNum, xDenom, yNum, yDenom);
}

export function ScaleViewportExt(hdc, xNum, xDenom, yNum, yDenom) {
  return scaleExtent(this, hdc, 've', xNum, xDenom, yNum, yDenom);
}

/** Answers one of the four, x in the low word. */
function answer(system: any, hdc: number, x: keyof Mapping, y: keyof Mapping) {
  const surface = system.handles.resolve(hdc);
  const m = mappingOf(surface);

  return surface ? pack(m[x], m[y]) : 0;
}

export function GetWindowOrg(hdc) {
  return answer(this, hdc, 'wox', 'woy');
}

export function GetWindowExt(hdc) {
  return answer(this, hdc, 'wex', 'wey');
}

export function GetViewportOrg(hdc) {
  return answer(this, hdc, 'vox', 'voy');
}

export function GetViewportExt(hdc) {
  return answer(this, hdc, 'vex', 'vey');
}

/** Maps points in the program's memory in place. */
function points(
  system: any,
  hdc: number,
  far: number,
  count: number,
  map: (m: Mapping, x: number, y: number) => [number, number]
) {
  const surface = system.handles.resolve(hdc);

  if (!surface || !far) {
    return 0;
  }

  const core = system.machine.cpu.core;
  const segment = (far >>> 16) & 0xffff;
  const offset = far & 0xffff;
  const m = mappingOf(surface);

  for (let i = 0; i < signed(count); i++) {
    const at = (offset + i * 4) & 0xffff;
    const [x, y] = map(
      m,
      signed(core.read16(segment, at)),
      signed(core.read16(segment, (at + 2) & 0xffff))
    );

    core.write16(segment, at, x & 0xffff);
    core.write16(segment, (at + 2) & 0xffff, y & 0xffff);
  }

  return 1;
}

/**
 * Turns logical points into device points, in place.
 *
 * @param {Types.HDC} hdc - The device context.
 * @param {Types.FARPTR} lpPoints - The points.
 * @param {Types.INT} nCount - How many.
 *
 * @returns {Types.BOOL} Whether there was a device context.
 */
export function LPtoDP(hdc, lpPoints, nCount) {
  return points(this, hdc, lpPoints, nCount, (m, x, y) => [deviceX(m, x), deviceY(m, y)]);
}

/**
 * Turns device points into logical points, in place.
 *
 * @param {Types.HDC} hdc - The device context.
 * @param {Types.FARPTR} lpPoints - The points.
 * @param {Types.INT} nCount - How many.
 *
 * @returns {Types.BOOL} Whether there was a device context.
 */
export function DPtoLP(hdc, lpPoints, nCount) {
  return points(this, hdc, lpPoints, nCount, (m, x, y) => [logicalX(m, x), logicalY(m, y)]);
}

/** A device context's mapping, or `null` where it leaves every coordinate as it is. */
export function mapped(surface: any): Mapping | null {
  const m = mappingOf(surface);

  return isIdentity(m) ? null : m;
}
