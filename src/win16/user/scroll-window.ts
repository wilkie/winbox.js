'use strict';

import { ClipRegion } from '../../raster/clip-region.js';
import { Surface } from '../../raster/surface.js';
import { BitBlt } from '../gdi/BitBlt.js';
import { clipOf, originOf } from '../gdi/clipping.js';
import { deviceX, deviceY, logicalX, logicalY, mappingOf } from '../gdi/mapping.js';
import { regionOf } from '../gdi/regions.js';
import { selectVis } from '../gdi/visible-region.js';
import { User } from '../user.js';
import { HideCaret, ShowCaret } from './caret.js';
import { makeStale } from './dc-entries.js';
import { GetDCEx } from './get-dc-ex.js';
import {
  clientRect,
  invalidateThrough,
  RDW_ALLCHILDREN,
  RDW_ERASE,
  RDW_INVALIDATE,
} from './invalidate-through.js';
import { lockTouched } from './lock-window-update.js';
import { RasterWindow } from './raster-window.js';
import { ReleaseDC } from './ReleaseDC.js';
import { updateOf } from './update-region.js';
import { DCX_CACHE, DCX_USESTYLE } from './visible-region-rule.js';

/**
 * Scrolling what is drawn: `ScrollWindow`, `ScrollWindowEx` and `ScrollDC`,
 * through the visible region, as `USER.EXE` seg13 does it. Twin of
 * `crates/winbox-win16/src/user_calls/scroll_window.rs`.
 *
 * **Read out**, `ScrollDC`'s body (seg13 `178d`), on a context:
 *
 * * Its clip box is asked (`179f`): nothing visible, an empty update and
 *   1. The scroll rectangle is the one given or the clip box; with the
 *   clip rectangle, all in device terms where the call is `ScrollDC`'s or
 *   `ScrollWindowEx`'s without `SW_INVALIDATE` (`17ea`-`1855`).
 * * Where what shows is one rectangle (cut to the clip rectangle, `18b9`)
 *   and the window has no update region (`1975`), the rectangles alone
 *   (`1984`-`1b62`): the source and destination cut to the clip box, the
 *   pixels moved where both are, and the update the two together less
 *   what was moved -- a rectangle, or a region where the move is both ways
 *   or the two are apart and the source was cut.
 * * Otherwise by regions (`1bc4`-`1def`): what is visible, the clip box's
 *   region within the visible region and the clip region (`1e19`); the
 *   source and destination within it; what moves, the source moved within
 *   the destination, less the window's update region where it is and
 *   where it moves to (`1c94`-`1d09`); the update the source and
 *   destination less what moves. The pixels are blitted through what moves
 *   as the visible region (`1d7d`-`1dea`): **what another window covers is
 *   not copied, and where it would have gone is left to paint**.
 * * It answers the update region's kind, or nonzero for `ScrollDC`.
 *
 * `ScrollWindowEx` (seg13 `12f3`) and `ScrollWindow` (`127a`, which is
 * `ScrollWindowEx` with `SW_INVALIDATE | SW_ERASE`, `SW_SCROLLCHILDREN`
 * where no scroll rectangle is given, and a flag of its own):
 *
 * * Nothing to move, or the window not shown: an empty update, and 1.
 * * The caret hidden while it is in the window or one the window is in
 *   (`1332`-`134e`).
 * * A common context of the window's client area (`1362`-`13d2`); for
 *   `ScrollWindow`, the window's own if its class has one; with
 *   `SW_SCROLLCHILDREN`, `GetDCEx`'s 80000h, which leaves the children in.
 * * `ScrollWindow` first makes due the box of what the window was due,
 *   moved as far as the pixels (`1497`-`14db`), and gives the body no
 *   update region; `ScrollWindowEx` gives it the window's.
 * * With `SW_SCROLLCHILDREN`: the caret moved, if it is the window's and
 *   in the scroll rectangle (`15ab`-`1600`); the children that meet the
 *   scroll rectangle moved with their pixels (seg2 `0a1d`) and the
 *   window's contexts made stale (`1656`-`1666`); each sent `WM_MOVE`
 *   after, if it meets the scroll rectangle moved by the parent's client
 *   area's corner (`16c3`-`1742`), which is the window's own only for a
 *   window at the top.
 * * With `SW_INVALIDATE` the update made due, through the window's
 *   children too, erased with `SW_ERASE` (`166b`-`16af`).
 *
 * **Recorded** by `scrolls` and `visscrl`.
 */

const SW_SCROLLCHILDREN = 0x0001;
const SW_INVALIDATE = 0x0002;
const SW_ERASE = 0x0004;
/** `ScrollWindow`'s own (seg13 `12a7`). */
const SW_SCROLLWINDOW = 0x8000;

const WS_CLIPCHILDREN = 0x02000000;
const CS_OWNDC = 0x0020;
const CS_CLASSDC = 0x0040;
/** `GetDCEx`'s 80000h: the children left in (seg1 `84ff`). */
const DCX_NOCLIPCHILDREN = 0x00080000;

type Rect = [number, number, number, number];

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const asRect = (box: Box): Rect => [box.left, box.top, box.right, box.bottom];
const cut = (a: Rect, b: Rect): Rect => [
  Math.max(a[0], b[0]),
  Math.max(a[1], b[1]),
  Math.min(a[2], b[2]),
  Math.min(a[3], b[3]),
];
const isEmpty = (r: Rect) => r[2] <= r[0] || r[3] <= r[1];
const EMPTY: Rect = [0, 0, 0, 0];
/** `IntersectRect` (seg1 `1e3e`): all nought where nothing is left. */
const intersect = (a: Rect, b: Rect): Rect => {
  const r = cut(a, b);

  return isEmpty(r) ? EMPTY : r;
};
const shift = (r: Rect, dx: number, dy: number): Rect => [
  r[0] + dx,
  r[1] + dy,
  r[2] + dx,
  r[3] + dy,
];
const same = (a: Rect, b: Rect) => a.every((value, at) => value === b[at]);
const regionOfRect = (r: Rect) => ClipRegion.rect(r[0], r[1], r[2], r[3]);
const joined = (a: ClipRegion, b: ClipRegion) => ClipRegion.combine(a, b, (x, y) => x || y);

/** `UnionRect` (seg1 `1ea6`). */
function unite(a: Rect, b: Rect): Rect {
  if (isEmpty(a)) {
    return isEmpty(b) ? EMPTY : b;
  }

  if (isEmpty(b)) {
    return a;
  }

  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

/** `SubtractRect` (seg1 `20b8`): cut only where `b` spans the whole of `a` one way. */
function subtract(a: Rect, b: Rect): Rect {
  const r: Rect = [...a];

  if (isEmpty(a) || isEmpty(intersect(a, b))) {
    return isEmpty(a) ? EMPTY : r;
  }

  if (b[1] <= a[1] && b[3] >= a[3]) {
    if (b[0] <= a[0]) {
      r[0] = Math.min(b[2], a[2]);
    } else if (b[2] >= a[2]) {
      r[2] = Math.max(b[0], a[0]);
    }
  }

  if (b[0] <= a[0] && b[2] >= a[2]) {
    if (b[1] <= a[1]) {
      r[1] = Math.min(b[3], a[3]);
    } else if (b[3] >= a[3]) {
      r[3] = Math.max(b[1], a[1]);
    }
  }

  return isEmpty(r) ? EMPTY : r;
}

/** A logical rectangle in device terms, its points mapped as they are (`LPtoDP`). */
function toDevice(surface: any, r: Rect): Rect {
  const m = mappingOf(surface);

  return [deviceX(m, r[0]), deviceY(m, r[1]), deviceX(m, r[2]), deviceY(m, r[3])];
}

function toLogical(surface: any, r: Rect): Rect {
  const m = mappingOf(surface);

  return [logicalX(m, r[0]), logicalY(m, r[1]), logicalX(m, r[2]), logicalY(m, r[3])];
}

/**
 * Where a scroll's body hands its update: the program's rectangle and
 * region, either of which may be none; `region` asks for the region even
 * with no handle -- USER's own, at [14Eh] (seg13 `13f2`) -- and gets it.
 */
interface Told {
  rect: Box | null;
  hrgn: number;
  region: boolean;
  shape?: ClipRegion;
}

const wanted = (told: Told) => told.region || !!told.hrgn || !!told.rect;

/** The update into the program's rectangle and region (`1a7f`-`1aaa`, `1d27`-`1d72`). */
function tell(system: any, told: Told, shape: ClipRegion, rect: Rect) {
  told.shape = shape;

  if (told.hrgn) {
    const region = regionOf(system, told.hrgn);

    if (region) {
      region.shape = shape;
    }
  }

  if (told.rect) {
    Object.assign(told.rect, { left: rect[0], top: rect[1], right: rect[2], bottom: rect[3] });
  }
}

/**
 * `ScrollDC`'s body (seg13 `178d`) on a context: its answer, the update's
 * kind (nought for no context). `update` is the window's update region on
 * the screen, `'whole'` for all of it, null for none; `convert` takes what
 * is given in logical terms.
 */
function scrollBody(
  system: any,
  hdc: number,
  dx: number,
  dy: number,
  scroll: Rect | null,
  clip: Rect | null,
  update: ClipRegion | 'whole' | null,
  told: Told,
  convert: boolean
) {
  const surface = system.handles.resolve(hdc);

  if (!(surface instanceof Surface)) {
    return 0;
  }

  /* What can be drawn on, and its box in logical terms (`179f`). */
  const visible = clipOf(surface);
  let kind = visible.kind;
  let box: Rect = kind === 1 ? EMPTY : toLogical(surface, asRect(visible.box));
  let source: Rect = scroll ?? box;
  let within: Rect | null = clip;
  let [ddx, ddy] = [dx, dy];

  if (convert) {
    box = toDevice(surface, box);
    source = toDevice(surface, source);
    within = within && toDevice(surface, within);

    const [x0, y0, x1, y1] = toDevice(surface, [0, 0, dx, dy]);

    [ddx, ddy] = [x1 - x0, y1 - y0];
  }

  const empty = () => {
    tell(system, told, ClipRegion.EMPTY, EMPTY);

    return 1;
  };

  if (kind === 1) {
    return empty();
  }

  /* What shows, in device terms, where it is more than a rectangle (`1e19`). */
  let shows: ClipRegion | null = kind === 3 ? visible : null;
  let target = shift(source, ddx, ddy);
  const plain = update === null || update === 'whole';

  if (within) {
    if (kind === 2 && plain) {
      box = intersect(box, within);

      if (isEmpty(box)) {
        return empty();
      }
    } else {
      shows = (shows ?? visible).intersect(regionOfRect(within));
      kind = shows.kind;

      if (kind === 1) {
        return empty();
      }

      if (kind === 2) {
        box = asRect(shows.box);
      }
    }
  }

  let moved: Rect = EMPTY;
  let answer = kind;
  /* What moves, where the pixels go through it alone, on the screen. */
  let through: ClipRegion | null = null;

  if (kind === 2 && plain) {
    /* The rectangles alone (`1984`-`1b62`). */
    const given = source;

    target = intersect(target, box);
    source = intersect(source, box);
    moved = update === 'whole' ? EMPTY : intersect(shift(source, ddx, ddy), target);

    let left: Rect | null = null;

    if (isEmpty(source)) {
      left = target;
    } else if (!isEmpty(intersect(source, target))) {
      if (!(ddx && ddy)) {
        left = subtract(unite(source, target), moved);
      }
    } else if (same(source, given)) {
      left = source;
    }

    if (left) {
      tell(system, told, regionOfRect(left), left);
      answer = isEmpty(left) ? 1 : 2;
    } else if (wanted(told)) {
      const shape = joined(regionOfRect(target), regionOfRect(source)).subtract(
        regionOfRect(moved)
      );

      tell(system, told, shape, asRect(shape.box));
      answer = shape.kind;
    }
  } else {
    /* By regions (`1bc4`-`1def`). */
    const [ox, oy] = originOf(surface);
    const now = shows ?? visible;
    const from = regionOfRect(source).intersect(now);
    const to = regionOfRect(target).intersect(now);
    let moves = ClipRegion.EMPTY;

    if (update !== 'whole') {
      moves = from.offset(ddx, ddy).intersect(to);

      if (update && moves.kind > 1) {
        const due = update.offset(-ox, -oy);

        moves = moves.subtract(due);

        if (moves.kind > 1) {
          moves = moves.subtract(due.offset(ddx, ddy));
        }
      }
    }

    if (wanted(told)) {
      let shape = joined(to, from);

      if (moves.kind !== 1) {
        shape = shape.subtract(moves);
      }

      tell(system, told, shape, asRect(shape.box));
      answer = shape.kind;
    }

    if (moves.kind !== 1) {
      through = moves.offset(ox, oy);
      moved = target;
    }
  }

  if (!isEmpty(moved)) {
    const at = convert ? toLogical(surface, moved) : moved;
    const blit = () =>
      BitBlt.call(
        system,
        hdc,
        at[0],
        at[1],
        at[2] - at[0],
        at[3] - at[1],
        hdc,
        at[0] - dx,
        at[1] - dy,
        0xcc0020
      );

    if (through) {
      /* `SaveVisRgn`, `SelectVisRgn` of what moves, `RestoreVisRgn`. */
      const vis = surface.visRegion;
      const object = surface.visObject?.shape;

      selectVis(surface, through);
      blit();
      surface.visRegion = vis;

      if (surface.visObject) {
        surface.visObject.shape = object;
      }
    } else {
      blit();
    }
  }

  if (convert && told.rect) {
    const [l, t, r, b] = toLogical(surface, asRect(told.rect));

    Object.assign(told.rect, { left: l, top: t, right: r, bottom: b });
  }

  return answer;
}

/** A window's class's style. */
function classStyleOf(system: any, owner: RasterWindow): number {
  const name = owner.options?.windowClass;

  return (name ? system.handles.retrieve(name)?.style : 0) ?? 0;
}

/** Whether `ancestor` is the window or one it is in (seg1 `1c12`). */
function within(window: any, ancestor: any) {
  for (let at = window; at; at = at.parent) {
    if (at === ancestor) {
      return true;
    }
  }

  return false;
}

/** Whether a window's client area shows, for USER (seg1 `1c5f`). */
function shows(system: any, window: any) {
  for (let at = window; at; at = at.parent) {
    if (!at.visible || (at !== window && at.state === 'minimized')) {
      return false;
    }
  }

  if (window.state === 'minimized') {
    const owner = system.handles.resolve(window.hwnd);
    const name = owner?.options?.windowClass;

    return !(name && system.handles.retrieve(name)?.hIcon);
  }

  return true;
}

/** `ScrollWindowEx`'s body (seg13 `12f3`), which `ScrollWindow` calls too: its answer. */
async function scrollWindow(
  system: any,
  hwnd: number,
  dx: number,
  dy: number,
  scroll: Box | null,
  clip: Box | null,
  told: Told,
  flags: number
) {
  const owner = system.handles.resolve(hwnd);

  if (!(owner instanceof RasterWindow)) {
    return 0;
  }

  const window: any = owner.window;
  const desktop = owner.desktop;

  if ((!dx && !dy) || !shows(system, window)) {
    tell(system, told, ClipRegion.EMPTY, EMPTY);

    return 1;
  }

  /* The caret hidden while it is in the window or one the window is in. */
  const caret = system._caret;
  const caretOwner = caret ? system.handles.resolve(caret.hwnd) : null;
  const caretHidden = caretOwner instanceof RasterWindow && within(window, caretOwner.window);

  if (caretHidden) {
    HideCaret.call(system, caret.hwnd);
  }

  let dcFlags = DCX_CACHE | DCX_USESTYLE;

  if (flags & SW_SCROLLWINDOW) {
    dcFlags = DCX_USESTYLE;

    if (!(classStyleOf(system, owner) & (CS_OWNDC | CS_CLASSDC))) {
      dcFlags |= DCX_CACHE;
    }

    if (flags & SW_SCROLLCHILDREN && window.style & WS_CLIPCHILDREN) {
      dcFlags |= DCX_CACHE | DCX_NOCLIPCHILDREN;
    }
  } else if (flags & SW_SCROLLCHILDREN) {
    dcFlags |= DCX_NOCLIPCHILDREN;
  }

  const hdc = GetDCEx.call(system, hwnd, 0, dcFlags);
  const surface = system.handles.resolve(hdc);
  const context = surface instanceof Surface ? surface : null;
  const [ox, oy] = context ? originOf(context) : [0, 0];
  const own = !(dcFlags & DCX_CACHE) ? context : null;

  /* The scroll rectangle: the client area where none is given, in the
   * window's own context's logical terms (`13f8`-`1421`); in device terms,
   * with the amount, for the children and the caret (`1447`-`148e`). */
  let given: Rect = scroll ? asRect(scroll) : [0, 0, window.clientWidth, window.clientHeight];

  if (!scroll && own) {
    given = toLogical(own, given);
  }

  let device = given;
  let [ddx, ddy] = [dx, dy];

  if (own) {
    device = toDevice(own, given);

    const [x0, y0, x1, y1] = toDevice(own, [0, 0, dx, dy]);

    [ddx, ddy] = [x1 - x0, y1 - y0];
  }

  /* What the window was due: `ScrollWindow` makes its box due again where
   * it moves to and gives the body none; `ScrollWindowEx` gives it. */
  let update: ClipRegion | 'whole' | null = null;

  if (window.needsPaint) {
    update = window.dirtyRect ? updateOf(window) : 'whole';
  }

  if (flags & SW_SCROLLWINDOW) {
    if (update && update !== 'whole') {
      const box = update.box;
      const moved: Rect = [box.left + ddx, box.top + ddy, box.right + ddx, box.bottom + ddy];

      /* Through `RedrawWindow`'s own body, which tells the lock (seg1 `3e1e`, `3f41`). */
      lockTouched(system, window, intersect(moved, clientRect(window)), 0);
      invalidateThrough(
        desktop,
        window,
        regionOfRect(moved),
        RDW_INVALIDATE | RDW_ERASE | RDW_ALLCHILDREN
      );
    }

    update = null;
  }

  const body: Told = { rect: told.rect, hrgn: told.hrgn, region: !!(flags & SW_INVALIDATE) };
  const answer = scrollBody(
    system,
    hdc,
    dx,
    dy,
    given,
    clip ? asRect(clip) : null,
    update,
    body,
    !(flags & SW_INVALIDATE)
  );

  ReleaseDC.call(system, hwnd, hdc);

  const [cx, cy] = [window.left + window.client.left, window.top + window.client.top];

  /* What the pixels moved over, to the lock (seg13 `151f`-`159d`). */
  lockTouched(
    system,
    window,
    scroll ? unite(shift(device, cx, cy), shift(device, cx + ddx, cy + ddy)) : clientRect(window),
    0
  );

  if (flags & SW_SCROLLCHILDREN) {
    /* The caret, if it is the window's and in what moves (`15ab`-`1600`). */
    if (caret && caret.hwnd === hwnd) {
      const at: Rect = [caret.x, caret.y, caret.x + caret.width, caret.y + caret.height];

      if (!scroll || !isEmpty(intersect(at, device))) {
        caret.x += ddx;
        caret.y += ddy;
      }
    }

    desktop.scrollChildren(window, ddx, ddy, scroll ? shift(device, cx, cy) : null);

    if (desktop.windows.some((other: any) => other.parent === window)) {
      makeStale(system, hwnd, window.style & WS_CLIPCHILDREN ? 4 : 2);
    }
  }

  if (flags & SW_INVALIDATE && body.shape && body.shape.kind > 1) {
    invalidateThrough(
      desktop,
      window,
      body.shape.offset(ox, oy),
      RDW_INVALIDATE | RDW_ALLCHILDREN | (flags & SW_ERASE ? RDW_ERASE : 0)
    );
  }

  if (flags & SW_SCROLLCHILDREN) {
    /* `WM_MOVE` to each child that meets the scroll rectangle moved by the
     * parent's client area's corner (`16c9`-`1742`). */
    const parent = window.parent;
    const [px, py] = parent
      ? [parent.left + parent.client.left, parent.top + parent.client.top]
      : [0, 0];
    const area = scroll ? shift(device, px + ddx, py + ddy) : null;

    for (const child of desktop.windows.filter((other: any) => other.parent === window)) {
      const rect: Rect = [
        child.left,
        child.top,
        child.left + child.width,
        child.top + child.height,
      ];

      if (area && isEmpty(intersect(area, rect))) {
        continue;
      }

      const target = system.handles.resolve(child.hwnd);

      if (target instanceof RasterWindow) {
        const x = child.left + child.client.left - cx;
        const y = child.top + child.client.top - cy;
        const windowClass = system.handles.retrieve(target.options.windowClass);

        await system.scheduler.callWndProc(
          windowClass,
          child.hwnd,
          User.WM_MOVE,
          0,
          ((x & 0xffff) | ((y & 0xffff) << 16)) >>> 0
        );
      }
    }
  }

  if (caretHidden) {
    ShowCaret.call(system, caret.hwnd);
  }

  return answer;
}

export async function ScrollWindow(
  this: any,
  hwnd: number,
  dx: number,
  dy: number,
  lprcScroll: Box | null,
  lprcClip: Box | null
) {
  await scrollWindow(
    this,
    hwnd,
    (dx << 16) >> 16,
    (dy << 16) >> 16,
    lprcScroll,
    lprcClip,
    { rect: null, hrgn: 0, region: false },
    SW_SCROLLWINDOW | SW_INVALIDATE | SW_ERASE | (lprcScroll ? 0 : SW_SCROLLCHILDREN)
  );
}

export async function ScrollWindowEx(
  this: any,
  hwnd: number,
  dx: number,
  dy: number,
  prcScroll: Box | null,
  prcClip: Box | null,
  hrgnUpdate: number,
  prcUpdate: Box | null,
  flags: number
) {
  return scrollWindow(
    this,
    hwnd,
    (dx << 16) >> 16,
    (dy << 16) >> 16,
    prcScroll,
    prcClip,
    { rect: prcUpdate, hrgn: hrgnUpdate, region: false },
    flags & (SW_SCROLLCHILDREN | SW_INVALIDATE | SW_ERASE)
  );
}

export function ScrollDC(
  this: any,
  hdc: number,
  dx: number,
  dy: number,
  lprcScroll: Box | null,
  lprcClip: Box | null,
  hrgnUpdate: number,
  lprcUpdate: Box | null
) {
  const answer = scrollBody(
    this,
    hdc,
    (dx << 16) >> 16,
    (dy << 16) >> 16,
    lprcScroll ? asRect(lprcScroll) : null,
    lprcClip ? asRect(lprcClip) : null,
    null,
    { rect: lprcUpdate, hrgn: hrgnUpdate, region: false },
    true
  );

  return answer ? 1 : 0;
}
