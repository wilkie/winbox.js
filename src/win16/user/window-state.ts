'use strict';

import { deliverActivation } from './activation.js';
import { FALSE, TRUE } from '../consts.js';
import { MINMAXINFO, User, WINDOWPOS } from '../user.js';

import { RasterWindow } from './raster-window.js';
import { GetSystemMetrics } from './GetSystemMetrics.js';
import { eraseDue } from './erase.js';

/**
 * `ShowWindow` on the raster desktop: showing, hiding, maximizing, minimizing
 * and restoring a window, and what the window is told after -- `WM_SIZE` with
 * its client area's size and how it got it, and `WM_MOVE` with where its
 * client area is. How each looks is measured by the `sizing` probe; what a
 * window shown or hidden is sent, and in what order, by `showseq`. Not
 * recorded: the order of `WM_SIZE` and `WM_MOVE` when showing moves it.
 */
export async function showRaster(
  system: any,
  hwnd: number,
  window: RasterWindow,
  show: number,
  told = true,
  made = false
) {
  const desktop = window.desktop;
  const shown = window.window;
  const was = shown.visible;
  const hiding = show === User.SW_HIDE;
  const changes = hiding ? was : !was;
  const windowClass = system.handles.retrieve(window.options.windowClass);
  const send = (message: number, wParam: number, lParam: any) =>
    windowClass
      ? system.scheduler.callWndProc(windowClass, hwnd, message, wParam, lParam)
      : Promise.resolve(0);

  /* A window shown or hidden is told so twice, then asked, as `SetWindowPos`
   * asks: a child, or a window hidden, keeps its place among its siblings and
   * is not made active; a window brought to the top names the window it goes
   * after -- USER's own `#32771` over them all (`showseq`). */
  let flags = SWP_NOSIZE | SWP_NOMOVE | (hiding ? SWP_HIDEWINDOW : SWP_SHOWWINDOW);

  if (hiding || shown.parent) {
    flags |= SWP_NOZORDER | SWP_NOACTIVATE;
  }

  if (show === SW_SHOWNOACTIVATE || show === SW_SHOWNA || show === User.SW_SHOWMINNOACTIVE) {
    flags |= SWP_NOACTIVATE;
  }

  /* Brought to the front, with the family it heads -- its owner at the top
   * and every window that owns shown, those it owns above it -- each asked
   * in turn from the top down, after the one above it: the window shown with
   * its own flags, the rest neither sized, moved nor made active
   * (`showseq`). */
  const family = flags & SWP_NOZORDER ? [shown] : familyOf(desktop, shown);
  const place = (member: any, after: number, how: number) => {
    const at: any = new WINDOWPOS();

    at.hwnd = member.hwnd;
    at.hwndInsertAfter = after;
    at.x = 0;
    at.y = 0;
    at.cx = 0;
    at.cy = 0;
    at.flags = how;

    return at;
  };
  const ask = async (how: number) => {
    let after = flags & SWP_NOZORDER ? 0 : insertAfter(desktop, family[0]);

    for (const member of family) {
      await sendTo(system, member, User.WM_WINDOWPOSCHANGING, 0, [
        place(member, after, member === shown ? how : SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE),
      ]);
      after = member.hwnd ?? 0;
    }
  };
  const inserts = new Map<any, number>();

  {
    let after = flags & SWP_NOZORDER ? 0 : insertAfter(desktop, family[0]);

    for (const member of family) {
      inserts.set(member, after);
      after = member.hwnd ?? 0;
    }
  }

  if (changes) {
    if (told) {
      await send(User.WM_SHOWWINDOW, hiding ? 0 : 1, 0);
      await send(WM_SETVISIBLE, hiding ? 0 : 1, 0);
    }

    await ask(flags);
  }

  const before = [shown.left, shown.top, shown.width, shown.height, shown.state].join();
  const aboveBefore = new Map(family.map((member: any) => [member, above(desktop, member)]));

  switch (show) {
    case User.SW_HIDE:
      desktop.hide(shown);
      break;

    case User.SW_SHOWMINIMIZED:
    case User.SW_MINIMIZE:
    case User.SW_SHOWMINNOACTIVE:
      /* The windows it owns hidden with it; and a window not active, minimized
       * with `SW_MINIMIZE`, keeps its place (`owners`). */
      desktop.hideOwned(shown, true);
      desktop.minimize(shown);

      if (show === User.SW_MINIMIZE && was && !shown.active) {
        desktop.showInPlace(shown);
      } else {
        desktop.show(shown);
      }

      break;

    case User.SW_SHOWMAXIMIZED:
      desktop.maximize(shown);
      desktop.show(shown);
      break;

    case User.SW_SHOWNORMAL:
    case User.SW_RESTORE:
      desktop.restore(shown);
      desktop.hideOwned(shown, false);
      desktop.show(shown);
      break;

    default:
      desktop.show(shown);
      break;
  }

  /* A window shown active: its messages, and the focus they move; put at
   * the front between them if it was not there yet, asked again, not told
   * after (`showseq`). */
  const atFrontAlready = above(desktop, shown) === aboveBefore.get(shown);

  await deliverActivation(
    system,
    changes && !hiding && !(flags & SWP_NOACTIVATE) && !atFrontAlready
      ? () => ask(SWP_NOSIZE | SWP_NOMOVE)
      : undefined
  );

  /* Placed again: told where it is now. */
  const moved = [shown.left, shown.top, shown.width, shown.height, shown.state].join() !== before;

  if (moved && !hiding) {
    await notifySize(system, hwnd, window);
  }

  /* A window at the top shown has its frame drawn and is erased now, with
   * whatever else is due, as `SetWindowPos` ends (`showseq`); and a mouse
   * move where the cursor is (`mousemv`). */
  /* Shown, all of it is due, whatever part was before. */
  if (changes && !hiding) {
    (shown as any).needsNcPaint = true;
    (shown as any).dirtyRect = undefined;
  }

  /* A child made visible: its parent is due a paint where it now lies,
   * unless the parent leaves its children out of its own painting
   * (`showseq`); a hidden child shown later leaves its parent as it was,
   * covered where the child now is (`tutor`: the Tutorial's parent is not
   * painted again over its children). The child's frame and erase wait for
   * its `BeginPaint`. */
  if (
    made &&
    changes &&
    !hiding &&
    shown.parent &&
    showing(shown.parent) &&
    !(shown.parent.style & WS_CLIPCHILDREN)
  ) {
    const parent: any = shown.parent;
    const area = [shown.left, shown.top, shown.left + shown.width, shown.top + shown.height];
    const was = parent.needsPaint ? parent.dirtyRect : null;

    /* Its children are due with it where they lie as it is invalidated,
     * not later as it paints: the child shown paints itself, and a child
     * already painted is not due again (the Tutorial's first screen, `tutor`,
     * keeps what it drew straight into its window). The rectangle is
     * remembered, so that `aboutToPaint` knows it for one of these. */
    if (was !== undefined && (!was || parent.quietDirty === was)) {
      parent.dirtyRect = was
        ? [
            Math.min(was[0], area[0]),
            Math.min(was[1], area[1]),
            Math.max(was[2], area[2]),
            Math.max(was[3], area[3]),
          ]
        : area;
      parent.quietDirty = parent.dirtyRect;
    } else if (was !== undefined) {
      parent.dirtyRect = [
        Math.min(was[0], area[0]),
        Math.min(was[1], area[1]),
        Math.max(was[2], area[2]),
        Math.max(was[3], area[3]),
      ];
    }

    parent.needsPaint = true;
    parent.needsErase = true;
  }

  await eraseDue(system);

  if (changes) {
    for (const member of family) {
      const parent = member.parent;
      const changed: any = new WINDOWPOS();
      const how = member === shown ? flags : SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE;
      /* Not moved among its siblings after all: said so (`showseq`). */
      const still = !(how & SWP_NOZORDER) && above(desktop, member) === aboveBefore.get(member);

      changed.hwnd = member.hwnd;
      changed.hwndInsertAfter = inserts.get(member) ?? 0;
      changed.x = parent ? member.left - parent.left - parent.client.left : member.left;
      changed.y = parent ? member.top - parent.top - parent.client.top : member.top;
      changed.cx = member.width;
      changed.cy = member.height;
      changed.flags = how | SWP_NOCLIENTSIZE | SWP_NOCLIENTMOVE | (still ? SWP_NOZORDER : 0);

      await sendTo(system, member, User.WM_WINDOWPOSCHANGED, 0, [changed]);
    }
  }

  /* What an overlapped window was owed since it was made, told the first
   * time it shows: its size, then its place (`showseq`). */
  if (!hiding && (shown as any).owesSize) {
    (shown as any).owesSize = false;
    await notifySize(system, hwnd, window);
  }

  system.rasterInput?.nudge();

  return was ? TRUE : FALSE;
}

/** A message to a window of the desktop, by its class's procedure. */
function sendTo(system: any, member: any, message: number, wParam: number, lParam: any) {
  const target = member.hwnd ? system.handles.resolve(member.hwnd) : null;
  const windowClass = target && system.handles.retrieve(target.options?.windowClass);

  return windowClass
    ? system.scheduler.callWndProc(windowClass, member.hwnd, message, wParam, lParam)
    : Promise.resolve(0);
}

/**
 * The windows that come to the front with a window at the top: the owner
 * it is under, if any, at the head, and every shown window that owner owns
 * above it, as they lie; top first.
 */
function familyOf(desktop: any, shown: any) {
  let head = shown;

  while (head.owner && !head.owner.parent) {
    head = head.owner;
  }

  const owns = (window: any): boolean => {
    for (let at = window.owner; at; at = at.owner) {
      if (at === head) {
        return true;
      }
    }

    return false;
  };
  const owned = desktop.windows.filter(
    (other: any) => !other.parent && other !== shown && owns(other) && other.visible
  );
  const members = [...owned, ...(shown === head ? [] : [shown])];

  members.sort(
    (one: any, other: any) => desktop.windows.indexOf(one) - desktop.windows.indexOf(other)
  );

  return shown === head ? [...members, head] : [...members.filter((m: any) => m !== head), head];
}

/** Whether a window and every window it is in are shown. */
function showing(window: any) {
  for (let at = window; at; at = at.parent) {
    if (!at.visible) {
      return false;
    }
  }

  return true;
}

/** The window at the top just above a window at the top, or none. */
function above(desktop: any, shown: any) {
  const tops = desktop.windows.filter((other: any) => !other.parent);
  const at = tops.indexOf(shown);

  return at > 0 ? tops[at - 1] : null;
}

/** The window a window at the top goes after: the last of those it goes below. */
function insertAfter(desktop: any, shown: any) {
  const at = desktop.front(shown);
  const above = desktop.windows
    .slice(0, at)
    .filter((other: any) => other !== shown && !other.parent);

  return above.length ? (above[above.length - 1].hwnd ?? 0) : 0;
}

/**
 * What `WM_GETMINMAXINFO` offers a window before it answers, read out of
 * `USER.EXE` (seg6 `18e0`, from the sizes seg3 `242f` keeps) and
 * **recorded** by `showseq`: the reserved point the size of an icon and
 * four borders; maximized, a window with a sizing frame is the screen and a
 * frame beyond it on every side, one without it the screen and four
 * borders more, at a border's width up and to the left; the least it may be dragged to is `SM_CXMINTRACK` by
 * `SM_CYMINTRACK` for a window with a caption, a border each way for one
 * without; and the most, the screen and a frame beyond it.
 */
export function minMaxInfo(system: any, style: number) {
  const metric = (index: number) => GetSystemMetrics.call(system, index);
  const mmi: any = new MINMAXINFO();
  const thick = (style & WS_THICKFRAME) !== 0;
  const [bx, by] = [metric(SM_CXBORDER), metric(SM_CYBORDER)];
  const [fx, fy] = [metric(SM_CXFRAME), metric(SM_CYFRAME)];
  const [sx, sy] = [metric(SM_CXSCREEN), metric(SM_CYSCREEN)];
  const set = (field: string, x: number, y: number) => {
    mmi[field].x = x;
    mmi[field].y = y;
  };

  set('ptReserved', metric(SM_CXICON) + 4 * bx, metric(SM_CYICON) + 4 * by);

  if (thick) {
    set('ptMaxSize', sx + 2 * fx, sy + 2 * fy);
    set('ptMaxPosition', -fx, -fy);
  } else {
    set('ptMaxSize', sx + 4 * bx, sy + 4 * by);
    set('ptMaxPosition', -bx, -by);
  }

  if ((style & WS_CAPTION) === WS_CAPTION) {
    set('ptMinTrackSize', metric(SM_CXMINTRACK), metric(SM_CYMINTRACK));
  } else {
    set('ptMinTrackSize', bx, by);
  }

  set('ptMaxTrackSize', sx + 2 * fx, sy + 2 * fy);

  return mmi;
}

/**
 * A window's frame changed where it is: a scroll bar of its own added or
 * taken away, by `ShowScrollBar` or `SetScrollRange`. **Recorded** by
 * `showsb`: the window is sent `WM_WINDOWPOSCHANGING`, `WM_NCCALCSIZE`,
 * `WM_WINDOWPOSCHANGED` and `WM_SIZE`, in that order and nothing else, and
 * then painted: its frame by `WM_NCPAINT` from `BeginPaint`, and its
 * background erased only where a bar went away and left client area that
 * had not been. A style that does not change sends nothing.
 */
export async function changeFrame(system: any, hwnd: number, window: RasterWindow, style: number) {
  const shown = window.window;

  if (style === shown.style) {
    return;
  }

  const windowClass = system.handles.retrieve(window.options.windowClass);
  const send = (message: number, wParam: number, lParam: any) =>
    windowClass
      ? system.scheduler.callWndProc(windowClass, hwnd, message, wParam, lParam)
      : Promise.resolve(0);
  const lost = (shown.style & ~style & 0x00300000) !== 0;
  const windowPos: any = new WINDOWPOS();
  const parent = shown.parent;

  windowPos.hwnd = hwnd;
  windowPos.hwndInsertAfter = 0;
  windowPos.x = parent ? shown.left - parent.left - parent.client.left : shown.left;
  windowPos.y = parent ? shown.top - parent.top - parent.client.top : shown.top;
  windowPos.cx = shown.width;
  windowPos.cy = shown.height;
  windowPos.flags = SWP_NOSIZE | SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED;

  await send(User.WM_WINDOWPOSCHANGING, 0, [windowPos]);

  /* Laid out again, which is not itself a reason to erase. */
  const erasing = shown.needsErase;

  shown.style = style;
  window.desktop.place(shown, shown.left, shown.top, shown.width, shown.height);
  await send(User.WM_NCCALCSIZE, 0, 0);
  await send(User.WM_WINDOWPOSCHANGED, 0, [windowPos]);

  const size = (shown.clientWidth & 0xffff) | ((shown.clientHeight & 0xffff) << 16);

  await send(User.WM_SIZE, User.SIZE_RESTORED, size >>> 0);

  shown.needsPaint = true;
  (shown as any).dirtyRect = undefined;
  (shown as any).needsNcPaint = true;
  shown.needsErase = erasing || lost;
}

/**
 * What `DefWindowProc` does with `WM_WINDOWPOSCHANGED`: `WM_MOVE` when the
 * window moved, then `WM_SIZE` when it was sized, as the structure's flags
 * say (`defer`).
 */
export async function windowPosChanged(system: any, hwnd: number, flags: number) {
  const window = system.handles.resolve(hwnd);

  if (!(window instanceof RasterWindow)) {
    return;
  }

  const { size, origin, kind } = placeOf(window);
  const windowClass = system.handles.retrieve(window.options.windowClass);

  if (!(flags & SWP_NOMOVE)) {
    await system.scheduler.callWndProc(windowClass, hwnd, User.WM_MOVE, 0, origin);
  }

  if (!(flags & SWP_NOSIZE)) {
    await system.scheduler.callWndProc(windowClass, hwnd, User.WM_SIZE, kind, size);
  }
}

/** A window's client size, its client area's origin in its parent, and its state, as `WM_SIZE` and `WM_MOVE` carry them. */
function placeOf(window: RasterWindow) {
  const shown = window.window;
  const kind =
    shown.state === 'maximized'
      ? User.SIZE_MAXIMIZED
      : shown.state === 'minimized'
        ? User.SIZE_MINIMIZED
        : User.SIZE_RESTORED;
  const size = ((shown.clientWidth & 0xffff) | ((shown.clientHeight & 0xffff) << 16)) >>> 0;
  const at = shown.parent
    ? {
        x: shown.left - shown.parent.left - shown.parent.client.left + shown.client.left,
        y: shown.top - shown.parent.top - shown.parent.client.top + shown.client.top,
      }
    : { x: shown.left + shown.client.left, y: shown.top + shown.client.top };
  const origin = ((at.x & 0xffff) | ((at.y & 0xffff) << 16)) >>> 0;

  return { size, origin, kind };
}

/** `WM_SIZE` and `WM_MOVE`, for a window whose place or state changed. */
export async function notifySize(system: any, hwnd: number, window: RasterWindow) {
  const { size, origin, kind } = placeOf(window);
  const windowClass = system.handles.retrieve(window.options.windowClass);

  await system.scheduler.callWndProc(windowClass, hwnd, User.WM_SIZE, kind, size);
  await system.scheduler.callWndProc(windowClass, hwnd, User.WM_MOVE, 0, origin);
}

/**
 * A window moved, sized, shown, hidden or brought forward on the raster
 * desktop: what `SetWindowPos` does, and `MoveWindow` through it.
 *
 * A child's place is in its parent's client area, as a program gives it.
 * It is done in two halves, which `EndDeferWindowPos` runs for all its
 * windows in turn, first halves first (`defer`): `WM_WINDOWPOSCHANGING`,
 * and `WM_NCCALCSIZE` when a size is given; then the window is placed,
 * and `WM_WINDOWPOSCHANGED` follows when its place, size or showing
 * changed, from which `DefWindowProc` sends `WM_MOVE` and `WM_SIZE`. Not
 * measured: what `WM_NCCALCSIZE` carries, sent here as creating a window
 * sends it, and what `SWP_NOREDRAW` leaves undrawn -- everything is drawn.
 */
export async function positionRaster(
  system: any,
  hwnd: number,
  window: RasterWindow,
  hwndInsertAfter: number,
  x: number,
  y: number,
  cx: number,
  cy: number,
  flags: number
) {
  const move = await positionChanging(system, hwnd, window, hwndInsertAfter, x, y, cx, cy, flags);

  await positionChanged(system, [move]);

  return TRUE;
}

/** The first half of a window's move: what it is told before, and where it is to go. */
export async function positionChanging(
  system: any,
  hwnd: number,
  window: RasterWindow,
  hwndInsertAfter: number,
  x: number,
  y: number,
  cx: number,
  cy: number,
  flags: number
) {
  const shown = window.window;
  const windowClass = system.handles.retrieve(window.options.windowClass);
  const parent = shown.parent;
  const offset = parent
    ? { x: parent.left + parent.client.left, y: parent.top + parent.client.top }
    : { x: 0, y: 0 };

  if (!(flags & SWP_NOSIZE)) {
    [cx, cy] = leastSize(system, shown.style, cx, cy, true);
  }

  const windowPos: any = new WINDOWPOS();

  windowPos.hwnd = hwnd;
  windowPos.hwndInsertAfter = hwndInsertAfter;
  windowPos.x = x;
  windowPos.y = y;
  windowPos.cx = cx;
  windowPos.cy = cy;
  windowPos.flags = flags;

  if (windowClass) {
    await system.scheduler.callWndProc(windowClass, hwnd, User.WM_WINDOWPOSCHANGING, 0, [
      windowPos,
    ]);
  }

  /* As the window procedure left the structure: it may move the window
   * elsewhere, or keep it where it is (documented). Towers of the corpus
   * moves itself to CW_USEDEFAULT and puts itself back on the screen here. */
  if (windowClass) {
    x = (windowPos.x << 16) >> 16;
    y = (windowPos.y << 16) >> 16;
    cx = (windowPos.cx << 16) >> 16;
    cy = (windowPos.cy << 16) >> 16;
    flags = windowPos.flags & 0xffff;
  }

  const left = flags & SWP_NOMOVE ? shown.left : x + offset.x;
  const top = flags & SWP_NOMOVE ? shown.top : y + offset.y;
  const width = flags & SWP_NOSIZE ? shown.width : cx;
  const height = flags & SWP_NOSIZE ? shown.height : cy;

  /* Whenever a size is given, even the one the window has (`defer`). */
  if (windowClass && !(flags & SWP_NOSIZE)) {
    await system.scheduler.callWndProc(windowClass, hwnd, User.WM_NCCALCSIZE, 0, 0);
  }

  return { hwnd, window, windowPos, left, top, width, height, flags };
}

/**
 * The second half of the moves begun, each window placed and then told, in
 * the order they were begun.
 */
export async function positionChanged(
  system: any,
  moves: Awaited<ReturnType<typeof positionChanging>>[]
) {
  const placed: {
    move: (typeof moves)[number];
    moved: boolean;
    sized: boolean;
    showing: boolean;
  }[] = [];

  for (const move of moves) {
    const { window, left, top, width, height, flags } = move;
    const shown = window.window;
    const moved = left !== shown.left || top !== shown.top;
    const sized = width !== shown.width || height !== shown.height;
    const visible = shown.visible;

    if (moved || sized) {
      window.desktop.place(shown, left, top, width, height);
    }

    if (flags & SWP_HIDEWINDOW && shown.visible) {
      window.desktop.hide(shown);
    } else if (flags & SWP_SHOWWINDOW && !shown.visible) {
      window.desktop.show(shown);
    } else if (!shown.parent && shown.visible && !(flags & SWP_NOACTIVATE)) {
      /* Activated, and so brought to the top, unless asked not to be: even
       * with its place in the order left alone, the window moved under the
       * cursor is the one there after (`mousemv`). */
      window.desktop.show(shown);
    }

    placed.push({ move, moved, sized, showing: shown.visible !== visible });
  }

  await deliverActivation(system);

  /* Told only when something changed: a window deferred to where it
   * already was is sent `WM_WINDOWPOSCHANGING` and no more (`defer`). */
  for (const { move, moved, sized, showing } of placed) {
    if (!moved && !sized && !showing) {
      continue;
    }

    const { hwnd, window, flags } = move;
    const shown = window.window;
    const parent = shown.parent;
    const windowClass = system.handles.retrieve(window.options.windowClass);

    /* A structure of its own: the first half's is still tied to where it
     * was laid out, on a stack that has moved on. */
    const windowPos: any = new WINDOWPOS();

    windowPos.hwnd = hwnd;
    windowPos.hwndInsertAfter = move.windowPos.hwndInsertAfter;
    windowPos.x = parent ? shown.left - parent.left - parent.client.left : shown.left;
    windowPos.y = parent ? shown.top - parent.top - parent.client.top : shown.top;
    windowPos.cx = shown.width;
    windowPos.cy = shown.height;
    windowPos.flags = (flags | (moved ? 0 : SWP_NOMOVE) | (sized ? 0 : SWP_NOSIZE)) & 0xffff;

    await system.scheduler.callWndProc(windowClass, hwnd, User.WM_WINDOWPOSCHANGED, 0, [windowPos]);
  }

  await eraseDue(system);
  system.rasterInput?.nudge();
}

const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOZORDER = 0x0004;
const SWP_NOACTIVATE = 0x0010;
const SWP_FRAMECHANGED = 0x0020;
const SWP_SHOWWINDOW = 0x0040;
const SWP_HIDEWINDOW = 0x0080;
const SWP_NOCLIENTSIZE = 0x0800;
const SWP_NOCLIENTMOVE = 0x1000;
const SW_SHOWNOACTIVATE = 4;
const SW_SHOWNA = 8;
/** Sent with `WM_SHOWWINDOW`, before a window shows or hides: undocumented. */
const WM_SETVISIBLE = 0x0009;

export async function SetWindowPos(
  this: any,
  hwnd: number,
  hwndInsertAfter: number,
  x: number,
  y: number,
  cx: number,
  cy: number,
  fuFlags: number
) {
  const window = this.handles.resolve(hwnd);

  /* A window of the raster desktop: one with a desktop and a place on it. */
  if (!window?.desktop || !window.window) {
    return FALSE;
  }

  return positionRaster(this, hwnd, window, hwndInsertAfter, x, y, cx, cy, fuFlags);
}

/**
 * Brings a window above the others: a top-level window to the top, made
 * the active one with the focus; a child above its siblings, the focus left
 * where it was. It answers `TRUE`. **Recorded** by `minis`, over two
 * top-level windows and two children.
 *
 * @param {Types.HWND} hwnd - The window.
 *
 * @returns {Types.BOOL} Whether there was such a window.
 */
export async function BringWindowToTop(this: any, hwnd: number) {
  const window = this.handles.resolve(hwnd);

  if (!(window instanceof RasterWindow)) {
    return FALSE;
  }

  if (window.window.parent) {
    window.desktop.raise(window.window);

    return TRUE;
  }

  return positionRaster(this, hwnd, window, 0, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE);
}

/**
 * A window's size held to the least it may be. **Recorded** by `minsize`:
 * an overlapped window -- neither a pop-up nor a child -- is at least
 * `SM_CXMIN` by `SM_CYMIN`, 102 by 26 on the VGA, as it is made, and as it
 * is moved or sized; a pop-up or child with a thick frame is at least two
 * frames each way as it is moved or sized, and as it is made any size; any
 * other window any size. Whether the program sees the size before it is
 * held, in `WM_WINDOWPOSCHANGING`, is not recorded: here it sees it held.
 */
export function leastSize(system: any, style: number, cx: number, cy: number, moving: boolean) {
  const metric = (index: number) => GetSystemMetrics.call(system, index);

  if (!(style & (User.WS_POPUP | User.WS_CHILD))) {
    return [Math.max(cx, metric(SM_CXMIN)), Math.max(cy, metric(SM_CYMIN))];
  }

  if (moving && style & User.WS_THICKFRAME) {
    return [Math.max(cx, 2 * metric(SM_CXFRAME)), Math.max(cy, 2 * metric(SM_CYFRAME))];
  }

  return [cx, cy];
}

const SM_CXFRAME = 32;
const SM_CYFRAME = 33;
const SM_CXMIN = 28;
const SM_CYMIN = 29;

const WS_THICKFRAME = 0x00040000;
const WS_CLIPCHILDREN = 0x02000000;
const WS_CAPTION = 0x00c00000;
const SM_CXSCREEN = 0;
const SM_CYSCREEN = 1;
const SM_CXBORDER = 5;
const SM_CYBORDER = 6;
const SM_CXICON = 11;
const SM_CYICON = 12;
const SM_CXMINTRACK = 34;
const SM_CYMINTRACK = 35;
