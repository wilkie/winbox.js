'use strict';

import { GetDCOrg } from './queries.js';
import { GetTextMetrics } from './GetTextMetrics.js';
import { deviceX, deviceY, logicalX, logicalY, mappingOf } from './mapping.js';

/**
 * The bounds GDI keeps of what is drawn in a device context: the
 * program's, by `SetBoundsRect` and `GetBoundsRect`, and Windows' own, by
 * `IsDCDirty`, `SetDCStatus` and the same two calls with 8000h in the flags.
 *
 * **Read out** of `GDI.EXE`: a context keeps two rectangles in the screen's
 * coordinates, Windows' at BCh and the program's at B4h, and their flags at
 * CCh -- 1 Windows' set, 2 Windows' enabled, 4 the program's set, 8 the
 * program's enabled; a new context has 2 and both rectangles nought (seg1
 * `0136`). Each call that draws gives the rectangle it draws in to seg1
 * `42be` where either set is enabled: a right or bottom of nought is taken
 * as 7FFFh, a rectangle with nothing in it is passed over, and each enabled
 * set is marked set and takes in the rectangle. **Recorded** by `bounds`.
 */

const WINDOWS_SET = 1;
const WINDOWS_ENABLED = 2;
const PROGRAM_SET = 4;
const PROGRAM_ENABLED = 8;

const DCB_RESET = 1;
const DCB_ACCUMULATE = 2;
const DCB_ENABLE = 4;
const DCB_DISABLE = 8;
const WINDOWS = 0x8000;

const EMPTY: [number, number, number, number] = [0x7fff, 0x7fff, -0x8000, -0x8000];

interface Bounds {
  flags: number;
  program: [number, number, number, number];
  windows: [number, number, number, number];
}

/** A device context's bounds, as a new context has them until asked. */
export function boundsOf(surface: any): Bounds {
  return (surface.bounds ??= {
    flags: WINDOWS_ENABLED,
    program: [0, 0, 0, 0],
    windows: [0, 0, 0, 0],
  });
}

/** The context's corner on the screen. */
function originOf(system: any, surface: any): [number, number] {
  const hdc = system.handles.lookup?.(surface) ?? 0;
  const origin = hdc ? GetDCOrg.call(system, hdc) : 0;

  return [(origin << 16) >> 16, origin >> 16];
}

/**
 * What a call drew in, in the device context's own pixels, taken into the
 * enabled bounds (seg1 `42be`): moved to the screen's coordinates, a right
 * or bottom of nought made 7FFFh.
 */
export function accumulate(
  system: any,
  surface: any,
  left: number,
  top: number,
  right: number,
  bottom: number
) {
  const bounds = surface?.bounds as Bounds | undefined;
  const flags = bounds ? bounds.flags : WINDOWS_ENABLED;

  if (!surface || !(flags & (WINDOWS_ENABLED | PROGRAM_ENABLED))) {
    return;
  }

  const [x, y] = originOf(system, surface);

  addTo(boundsOf(surface), left + x, top + y, right + x, bottom + y);
}

function addTo(bounds: Bounds, left: number, top: number, right: number, bottom: number) {
  const r = right || 0x7fff;
  const b = bottom || 0x7fff;

  if (r <= left || b <= top) {
    return;
  }

  const set = (bounds.flags >> 1) & (WINDOWS_SET | PROGRAM_SET);

  bounds.flags |= set;

  for (const which of [
    set & PROGRAM_SET ? bounds.program : null,
    set & WINDOWS_SET ? bounds.windows : null,
  ]) {
    if (which) {
      which[0] = Math.min(which[0], left);
      which[1] = Math.min(which[1], top);
      which[2] = Math.max(which[2], r);
      which[3] = Math.max(which[3], b);
    }
  }
}

const word = (value: number) => (value << 16) >> 16;

function readRect(system: any, far: number): [number, number, number, number] {
  const core = system.machine.cpu.core;
  const segment = (far >>> 16) & 0xffff;
  const offset = far & 0xffff;

  return [0, 2, 4, 6].map((at) => word(core.read16(segment, (offset + at) & 0xffff))) as [
    number,
    number,
    number,
    number,
  ];
}

function writeRect(system: any, far: number, rect: number[]) {
  const core = system.machine.cpu.core;
  const segment = (far >>> 16) & 0xffff;
  const offset = far & 0xffff;

  rect.forEach((value, at) => core.write16(segment, (offset + at * 2) & 0xffff, value & 0xffff));
}

/**
 * Sets, resets, enables or disables a device context's bounds, the
 * program's or, with 8000h, Windows'. **Read out** of seg31 `0526`: the
 * answer is the bounds' state before -- `DCB_SET` where set, `DCB_RESET`
 * where not; `DCB_ENABLE` or `DCB_DISABLE`; and 8000h for Windows' -- then
 * `DCB_RESET` empties the rectangle and clears the set flag; `DCB_ACCUMULATE`
 * with a rectangle takes it in, the program's turned into device units and
 * moved by the context's corner, where it has anything in it; `DCB_ENABLE`
 * enables, and `DCB_DISABLE` disables after it. **Recorded** by `bounds`.
 *
 * @returns {Types.UINT} The state before.
 */
export function SetBoundsRect(this: any, hdc: number, lprcBounds: number, flags: number) {
  const surface = this.handles.resolve(hdc);

  if (!surface || !('font' in surface)) {
    return 0;
  }

  const bounds = boundsOf(surface);
  const windows = (flags & WINDOWS) !== 0;
  const set = windows ? WINDOWS_SET : PROGRAM_SET;
  const enabled = windows ? WINDOWS_ENABLED : PROGRAM_ENABLED;
  const rect = windows ? bounds.windows : bounds.program;
  const before =
    (windows ? WINDOWS : 0) |
    (bounds.flags & set ? DCB_RESET | DCB_ACCUMULATE : DCB_RESET) |
    (bounds.flags & enabled ? DCB_ENABLE : DCB_DISABLE);

  if (flags & DCB_RESET) {
    rect.splice(0, 4, ...EMPTY);
    bounds.flags &= ~set;
  }

  if (flags & DCB_ACCUMULATE && lprcBounds >>> 0) {
    let [left, top, right, bottom] = readRect(this, lprcBounds);

    if (!windows) {
      const m = mappingOf(surface);

      [left, top, right, bottom] = [
        deviceX(m, left),
        deviceY(m, top),
        deviceX(m, right),
        deviceY(m, bottom),
      ];

      const [x, y] = originOf(this, surface);

      left += x;
      right += x;
      top += y;
      bottom += y;
    }

    if (left < right && top < bottom) {
      rect[0] = Math.min(rect[0], left);
      rect[1] = Math.min(rect[1], top);
      rect[2] = Math.max(rect[2], right);
      rect[3] = Math.max(rect[3], bottom);
      bounds.flags |= set;
    }
  }

  if (flags & DCB_ENABLE) {
    bounds.flags |= enabled;
  }

  if (flags & DCB_DISABLE) {
    bounds.flags &= ~enabled;
  }

  return before;
}

/**
 * The bounds of what has been drawn, the program's or, with 8000h,
 * Windows'. **Read out** of seg1 `76e4`: `DCB_RESET`, writing nothing, where
 * none are set. Windows' are written as they are kept, in the screen's
 * coordinates; the program's are cut to the context's visible region's box,
 * moved back by its corner and turned into logical units. `DCB_RESET` in
 * the flags resets them after, and the answer is `DCB_SET`. **Recorded** by
 * `bounds`.
 *
 * @returns {Types.UINT} `DCB_SET`, or `DCB_RESET` where there are none.
 */
export function GetBoundsRect(this: any, hdc: number, lprcBounds: number, flags: number) {
  const surface = this.handles.resolve(hdc);

  if (!surface || !('font' in surface)) {
    return 0;
  }

  const bounds = boundsOf(surface);
  const windows = (flags & WINDOWS) !== 0;

  if (!(bounds.flags & (windows ? WINDOWS_SET : PROGRAM_SET))) {
    return DCB_RESET;
  }

  if (windows) {
    writeRect(this, lprcBounds, bounds.windows);
  } else {
    const [x, y] = originOf(this, surface);
    const width = surface.width || 0;
    const height = surface.height || 0;
    const m = mappingOf(surface);
    const left = Math.max(x, bounds.program[0]) - x;
    const top = Math.max(y, bounds.program[1]) - y;
    const right = Math.min(x + width, bounds.program[2]) - x;
    const bottom = Math.min(y + height, bounds.program[3]) - y;

    writeRect(this, lprcBounds, [
      logicalX(m, left),
      logicalY(m, top),
      logicalX(m, right),
      logicalY(m, bottom),
    ]);
  }

  if (flags & DCB_RESET) {
    SetBoundsRect.call(this, hdc, 0, flags & (WINDOWS | DCB_RESET));
  }

  return DCB_RESET | DCB_ACCUMULATE;
}

/**
 * Whether anything has been drawn in a device context since Windows'
 * bounds were last cleared, and where. **Read out** of seg1 `4352`: 1 and
 * Windows' rectangle where they are set, nought and a rectangle of noughts
 * where not, -1 for no context; then `SetDCStatus(hdc, 0, NULL)`. **Recorded**
 * by `bounds`.
 *
 * @returns {Types.INT} 1 where set, nought where not.
 */
export function IsDCDirty(this: any, hdc: number, lprc: number) {
  const surface = hdc ? this.handles.resolve(hdc) : null;

  if (!surface || !('font' in surface)) {
    return hdc ? 0 : -1;
  }

  const bounds = boundsOf(surface);
  const dirty = (bounds.flags & WINDOWS_SET) !== 0;

  writeRect(this, lprc, dirty ? bounds.windows : [0, 0, 0, 0]);
  SetDCStatus.call(this, hdc, 0, 0);

  return dirty ? 1 : 0;
}

/**
 * Sets or clears Windows' bounds. **Read out** of seg1 `439b`: the answer
 * is 1 where they were set, nought where not, -1 for no context. They are
 * cleared; with a word not nought they are set again, and to the rectangle
 * where one is given; with nought they are emptied. **Recorded** by
 * `bounds`.
 *
 * @returns {Types.INT} Whether they were set.
 */
export function SetDCStatus(this: any, hdc: number, fSet: number, lprc: number) {
  const surface = hdc ? this.handles.resolve(hdc) : null;

  if (!surface || !('font' in surface)) {
    return hdc ? 0 : -1;
  }

  const bounds = boundsOf(surface);
  const before = bounds.flags & WINDOWS_SET ? 1 : 0;

  bounds.flags &= ~WINDOWS_SET;

  if (fSet) {
    bounds.flags |= WINDOWS_SET;

    if (lprc >>> 0) {
      bounds.windows = readRect(this, lprc);
    }
  } else {
    bounds.windows = [...EMPTY];
  }

  return before;
}

/**
 * A rectangle, an ellipse or a round rectangle's bounds (`GDI.EXE` seg25
 * `02d1`): the rectangle in device terms, put in order, and but for an
 * inside-frame pen grown by the pen -- half its width rounded down at the
 * left and top, half less a pixel at the right and bottom, so a null pen
 * leaves the right and bottom a pixel in.
 */
export function shapeBounds(
  system: any,
  surface: any,
  left: number,
  top: number,
  right: number,
  bottom: number,
  penWidth: number,
  penHeight: number,
  insideFrame: boolean
) {
  const l = Math.min(left, right);
  const t = Math.min(top, bottom);
  const r = Math.max(left, right);
  const b = Math.max(top, bottom);

  if (insideFrame) {
    accumulate(system, surface, l, t, r, b);
    return;
  }

  accumulate(
    system,
    surface,
    l - (penWidth >> 1),
    t - (penHeight >> 1),
    r + ((penWidth - 1) >> 1),
    b + ((penHeight - 1) >> 1)
  );
}

/**
 * A line or a chain of lines' bounds (`GDI.EXE` seg21 `08cc`): the points'
 * box, grown by half the pen's width rounded down all round, and a pixel
 * more at the right and bottom where they are not 7FFFh.
 */
export function lineBounds(
  system: any,
  surface: any,
  points: [number, number][],
  penWidth: number
) {
  if (!points.length) {
    return;
  }

  const grow = penWidth >> 1;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;

  for (const [x, y] of points) {
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }

  right += grow;
  bottom += grow;

  accumulate(
    system,
    surface,
    left - grow,
    top - grow,
    right === 0x7fff ? right : right + 1,
    bottom === 0x7fff ? bottom : bottom + 1
  );
}

/** A filled polygon's bounds (`GDI.EXE` seg24 `03f3`): the points' box. */
export function fillBounds(system: any, surface: any, points: [number, number][]) {
  if (!points.length) {
    return;
  }

  accumulate(
    system,
    surface,
    Math.min(...points.map(([x]) => x)),
    Math.min(...points.map(([, y]) => y)),
    Math.max(...points.map(([x]) => x)),
    Math.max(...points.map(([, y]) => y))
  );
}

/** A rectangle given as two corners, in device terms, put in order. */
export function rectBounds(
  system: any,
  surface: any,
  left: number,
  top: number,
  right: number,
  bottom: number
) {
  accumulate(
    system,
    surface,
    Math.min(left, right),
    Math.min(top, bottom),
    Math.max(left, right),
    Math.max(top, bottom)
  );
}

/**
 * Text's bounds (`GDI.EXE` seg1 `35ed`): with a rectangle given and
 * `ETO_OPAQUE` or `ETO_CLIPPED`, the rectangle; and but for `ETO_CLIPPED`,
 * the text: from where it starts -- the point given moved by the alignment
 * (seg1 `3419`-`3502`), in device terms, or nought across where a spacing
 * was given -- to the right edge, as far down as the font is high.
 *
 * `x` and `y` are the point in logical terms, `rect` the rectangle in
 * device terms, or none.
 */
export function textBounds(
  system: any,
  hdc: number,
  surface: any,
  x: number,
  y: number,
  extent: () => number,
  spaced: boolean,
  rect: { left: number; top: number; right: number; bottom: number } | null,
  options: number
) {
  const ETO_OPAQUE = 2;
  const ETO_CLIPPED = 4;

  if (rect && options & (ETO_OPAQUE | ETO_CLIPPED)) {
    rectBounds(system, surface, rect.left, rect.top, rect.right, rect.bottom);
  }

  if (rect && options & ETO_CLIPPED) {
    return;
  }

  const metrics: any = {};
  const answer = GetTextMetrics.call(system, hdc, metrics);

  /* A printer driver's font is measured by the driver, later: not here. */
  if (answer && typeof answer.then === 'function') {
    return;
  }

  const align = surface.textAlign ?? 0;
  const TA_RIGHT = 2;
  const TA_CENTER = 6;
  const TA_BOTTOM = 8;
  const TA_BASELINE = 24;
  const m = mappingOf(surface);
  /* Each way the mapping turns an axis over turns the step back. */
  const across = (m.wex ^ m.vex) < 0 ? -1 : 1;
  const down = (m.wey ^ m.vey) < 0 ? -1 : 1;
  let left = x;
  let top = y;

  if ((align & TA_CENTER) === TA_CENTER) {
    left -= across * Math.trunc(extent() / 2);
  } else if (align & TA_RIGHT) {
    left -= across * extent();
  }

  if ((align & TA_BASELINE) === TA_BASELINE) {
    top -= down * (metrics.tmAscent ?? 0);
  } else if (align & TA_BOTTOM) {
    top -= down * (metrics.tmHeight ?? 0);
  }

  const deviceLeft = deviceX(m, left);
  const deviceTop = deviceY(m, top);

  accumulate(
    system,
    surface,
    spaced ? 0 : deviceLeft,
    deviceTop,
    0,
    deviceTop + (metrics.tmHeight ?? 0)
  );
}
