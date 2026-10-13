'use strict';

import { deliverActivation } from './activation.js';
import { setFocus } from './dialogs.js';
import { focusNothing } from './SetFocus.js';
import { FALSE, TRUE } from '../consts.js';
import { MINMAXINFO, NCCALCSIZE_PARAMS, User, WINDOWPOS } from '../user.js';
import { askText } from './DefWindowProc.js';

import { RasterWindow } from './raster-window.js';
import { GetSystemMetrics } from './GetSystemMetrics.js';
import { eraseDue } from './erase.js';
import { type Insert } from './desktop.js';

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

  /* An icon restored is asked first, and stays one if its window says no
   * (`iconclk`; the answer is documented, not recorded). */
  const fromIcon = show === User.SW_RESTORE && shown.state === 'minimized';
  const activeIcon = fromIcon && shown.active;

  if (fromIcon && !(await send(User.WM_QUERYOPEN, 0, 0))) {
    return was ? TRUE : FALSE;
  }

  /* A hidden window minimized and not made active is not told it shows: it
   * is put among the icons, at the bottom, in one move (`showmin`). */
  if (show === User.SW_SHOWMINNOACTIVE && !was && !shown.parent) {
    await minimizeToBottom(system, hwnd, window, true);
    await titleShown(system, hwnd, window, false);
    system.rasterInput?.nudge();

    /* Told its place and size so, it is owed none when it is next shown
     * (`alttab`: restored later, it is sent `WM_SIZE` once). One made
     * minimized, then shown, is told them again (`showmin`). */
    (shown as any).owesSize = false;

    return FALSE;
  }

  /* A window shown or hidden is told so twice, then asked, as `SetWindowPos`
   * asks: a child, or a window hidden, keeps its place among its siblings and
   * is not made active; a window brought to the top names the window it goes
   * after -- USER's own `#32771` over them all (`showseq`). */
  let flags = SWP_NOSIZE | SWP_NOMOVE | (hiding ? SWP_HIDEWINDOW : SWP_SHOWWINDOW);

  /* A child of the desktop window, as a combo box's list dropped down is
   * (`comboact`), is a child still. */
  if (hiding || shown.parent || (shown.style & (WS_CHILD | WS_POPUP)) === WS_CHILD) {
    flags |= SWP_NOZORDER | SWP_NOACTIVATE;
  }

  /* A window at the top whose class saves the bits under it, as the dialog
   * class's does, is made active before it shows, with `SW_SHOWNORMAL` or
   * `SW_SHOW`, and then shown where it is, not made active again (`USER.EXE`
   * seg14 `0d01`-`0d2b`: the class's style, `CS_SAVEBITS`, then seg1 `38e4`
   * with 1, then `SWP_NOZORDER | SWP_NOACTIVATE`). **Recorded** by `enddlg`:
   * a dialog made active hidden, as `DialogBox` makes it, is shown with
   * flags 57h, and nothing else is moved. */
  if (
    (show === User.SW_SHOWNORMAL || show === User.SW_SHOW) &&
    !shown.parent &&
    (shown.style & (WS_CHILD | WS_POPUP)) !== WS_CHILD &&
    (windowClass?.style ?? 0) & CS_SAVEBITS
  ) {
    await activateWindow(system, shown);

    if (!system.handles.resolve(hwnd)) {
      return was ? TRUE : FALSE;
    }

    flags |= SWP_NOZORDER | SWP_NOACTIVATE;
  }

  /* Shown and not made active: where it lies with `SW_SHOWNOACTIVATE`,
   * brought to the front with `SW_SHOWNA` (`showsq2`). */
  if (show === SW_SHOWNOACTIVATE || show === SW_SHOWNA || show === User.SW_SHOWMINNOACTIVE) {
    flags |= SWP_NOACTIVATE;
  }

  if (show === SW_SHOWNOACTIVATE) {
    flags |= SWP_NOZORDER;
  }

  /* Maximized, it is asked `WM_GETMINMAXINFO` and put where that answers,
   * `ptMaxSize` at `ptMaxPosition`, in one `SetWindowPos` with
   * `SWP_FRAMECHANGED` -- and `SWP_SHOWWINDOW` where it was hidden -- whose
   * `WM_WINDOWPOSCHANGING` `DefWindowProc` holds to the tracking sizes
   * (`USER.EXE` seg6 `1ca1`-`1d16`, `1d3d`-`1d81`; `minmax`). */
  const zooming = show === User.SW_SHOWMAXIMIZED && shown.state !== 'maximized';
  let zoom: { x: number; y: number; cx: number; cy: number } | null = null;

  if (zooming) {
    flags = (flags & ~(SWP_NOSIZE | SWP_NOMOVE)) | SWP_FRAMECHANGED;

    if (was) {
      flags &= ~SWP_SHOWWINDOW;
    }
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
  const ask = async (how: number, sized = false) => {
    let after = flags & SWP_NOZORDER ? 0 : insertAfter(desktop, family[0]);

    for (const member of family) {
      const at = place(
        member,
        after,
        member === shown ? how : SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE
      );
      const zoomed = sized && member === shown && zoom;

      if (zoomed) {
        Object.assign(at, zoom);
      }

      await sendTo(system, member, User.WM_WINDOWPOSCHANGING, 0, [at]);

      /* As the window procedure, or `DefWindowProc`, left it. */
      if (zoomed) {
        zoom = { x: signed(at.x), y: signed(at.y), cx: signed(at.cx), cy: signed(at.cy) };
      }

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

  /* A window minimized that has the focus in it loses it first: to its
   * parent, or to none at the top (`USER.EXE` seg6 `1bfa`-`1c25`). */
  const minimizing =
    (show === User.SW_SHOWMINIMIZED ||
      show === User.SW_MINIMIZE ||
      show === User.SW_SHOWMINNOACTIVE) &&
    shown.state !== 'minimized';

  if (minimizing) {
    let inside = desktop.focus;

    while (inside && inside !== shown) {
      inside = inside.parent;
    }

    if (inside) {
      if (shown.parent) {
        await setFocus(system, shown.parent.hwnd);
      } else {
        await focusNothing(system);
      }
    }
  }

  if (changes && told) {
    await send(User.WM_SHOWWINDOW, hiding ? 0 : 1, 0);
    await send(WM_SETVISIBLE, hiding ? 0 : 1, 0);
  }

  if (zooming) {
    const mmi = await askMinMax(system, hwnd, shown.style);

    zoom = {
      x: signed(mmi.ptMaxPosition.x),
      y: signed(mmi.ptMaxPosition.y),
      cx: signed(mmi.ptMaxSize.x),
      cy: signed(mmi.ptMaxSize.y),
    };
    await ask(flags, true);

    const zoomed = zoom as { x: number; y: number; cx: number; cy: number };

    const { params } = await calcSize(system, hwnd, window, [
      zoomed.x,
      zoomed.y,
      zoomed.x + zoomed.cx,
      zoomed.y + zoomed.cy,
    ]);
    const client = sides(params.rgrc0);

    desktop.answerClient(shown, zoomed.cx, zoomed.cy, {
      left: client[0] - zoomed.x,
      top: client[1] - zoomed.y,
      right: client[2] - zoomed.x,
      bottom: client[3] - zoomed.y,
    });
  } else if (changes) {
    await ask(flags);
  }

  const clientBefore = clientInParent(shown);
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

    case User.SW_SHOWMAXIMIZED: {
      const origin = originOf(shown);
      const zoomed = zoom as { x: number; y: number; cx: number; cy: number } | null;

      desktop.maximize(
        shown,
        zoomed
          ? {
              left: zoomed.x + origin.x,
              top: zoomed.y + origin.y,
              width: Math.max(zoomed.cx, 0),
              height: Math.max(zoomed.cy, 0),
            }
          : undefined
      );
      desktop.show(shown);
      break;
    }

    case User.SW_SHOWNORMAL:
    case User.SW_RESTORE:
      desktop.restore(shown);
      desktop.hideOwned(shown, false);
      desktop.show(shown);
      break;

    case SW_SHOWNOACTIVATE:
      desktop.showInPlace(shown);
      break;

    case SW_SHOWNA:
      desktop.showOnTop(shown);
      break;

    default:
      /* Shown already, nothing of it is due but what it came to show of
       * itself: Clock's `SW_SHOW` after its frame changed has it painted once
       * (`swpframe`). */
      desktop.show(shown, !was);
      break;
  }

  /* A window shown active: its messages, and the focus they move; put at
   * the front between them if it was not there yet with the windows it
   * brings, asked again, not told after (`showseq`). */
  const atFrontAlready = above(desktop, shown) === aboveBefore.get(shown);

  await deliverActivation(
    system,
    /* Only a window with others of its family to bring along: an icon made
     * active from the bottom alone is not asked again (`showmin`). */
    changes && !hiding && !(flags & SWP_NOACTIVATE) && !atFrontAlready && family.length > 1
      ? () => ask(SWP_NOSIZE | SWP_NOMOVE)
      : undefined
  );

  /* Placed again: told where it is now. */
  const moved = [shown.left, shown.top, shown.width, shown.height, shown.state].join() !== before;

  /* An icon restored is told its place and then its size, as
   * `WM_WINDOWPOSCHANGED` tells them, and made active again if it was: it had
   * no focus as an icon (`iconclk`). */
  if (moved && !hiding && fromIcon) {
    const place: any = new WINDOWPOS();

    place.hwnd = hwnd;
    place.hwndInsertAfter = 0;
    place.x = shown.parent ? shown.left - shown.parent.left - shown.parent.client.left : shown.left;
    place.y = shown.parent ? shown.top - shown.parent.top - shown.parent.client.top : shown.top;
    place.cx = shown.width;
    place.cy = shown.height;
    place.flags = SWP_FRAMECHANGED;

    /* Asked and told with the window's place and size, its frame changed
     * (`alttab`: flags 20h, then 24h), `DefWindowProc` sending `WM_MOVE` and
     * `WM_SIZE` from the second (`iconclk`). */
    await send(User.WM_WINDOWPOSCHANGING, 0, [place]);
    place.flags = SWP_NOZORDER | SWP_FRAMECHANGED;
    await send(User.WM_WINDOWPOSCHANGED, 0, [place]);
  } else if (moved && !hiding && !zoom) {
    await notifySize(system, hwnd, window);
  }

  /* The active window restored from an icon is given the focus, then told
   * it is active again: it had no focus as an icon (`alttab`, `iconclk`). */
  if (activeIcon && shown.active) {
    await setFocus(system, hwnd);
    await send(User.WM_ACTIVATE, WA_ACTIVE, 0);
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

  if (changes || zoom) {
    for (const member of family) {
      const parent = member.parent;
      const changed: any = new WINDOWPOS();
      const how = member === shown ? flags : SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE;
      /* Not moved among its siblings after all: said so (`showseq`). */
      const still = !(how & SWP_NOZORDER) && above(desktop, member) === aboveBefore.get(member);
      /* Maximized, what of its client area stayed as it was, said so, from
       * which `DefWindowProc` tells it it moved and was sized (seg7 `0fcf`,
       * `0fe6`, `11fc`-`1250`). */
      const client =
        member === shown && zoom
          ? clientFlags(clientBefore, clientInParent(member))
          : SWP_NOCLIENTSIZE | SWP_NOCLIENTMOVE;

      changed.hwnd = member.hwnd;
      changed.hwndInsertAfter = inserts.get(member) ?? 0;
      changed.x = parent ? member.left - parent.left - parent.client.left : member.left;
      changed.y = parent ? member.top - parent.top - parent.client.top : member.top;
      changed.cx = member.width;
      changed.cy = member.height;
      changed.flags = how | client | (still ? SWP_NOZORDER : 0);

      await sendTo(system, member, User.WM_WINDOWPOSCHANGED, 0, [changed]);
    }
  }

  /* What an overlapped window was owed since it was made, told the first
   * time it shows: its size, then its place (`showseq`). */
  if (!hiding && (shown as any).owesSize) {
    (shown as any).owesSize = false;
    await notifySize(system, hwnd, window);
  }

  /* A window at the top minimized so gives the activation to another
   * (`USER.EXE` seg6 `1d96`), brought to the front between the two windows'
   * messages where that moves it (`minact`). */
  if (show === User.SW_MINIMIZE && minimizing && !shown.parent && shown.state === 'minimized') {
    const next = desktop.nextAfterMinimize(shown);

    if (next && next !== shown) {
      const nextFamily = familyOf(desktop, next);
      const nextAbove = above(desktop, next);

      desktop.show(next, false);

      const nextMoved = above(desktop, next) !== nextAbove;

      await deliverActivation(
        system,
        nextMoved
          ? async () => {
              let after = insertAfter(desktop, nextFamily[0]);

              for (const member of nextFamily) {
                await sendTo(system, member, User.WM_WINDOWPOSCHANGING, 0, [
                  place(
                    member,
                    after,
                    member === next
                      ? SWP_NOSIZE | SWP_NOMOVE
                      : SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE
                  ),
                ]);
                after = member.hwnd ?? 0;
              }
            }
          : undefined
      );
    }
  }

  if (changes && !hiding && shown.state === 'minimized') {
    await titleShown(system, hwnd, window, !(flags & SWP_NOACTIVATE));
  }

  /* Hidden, a window that has the focus itself gives it to its parent, or a
   * window at the top to none, once another window has been made active;
   * a focus in a window inside it stays there (`USER.EXE` seg14 `0dd4`,
   * seg2 `090a`). */
  if (hiding && told && desktop.focus === shown) {
    if (shown.parent?.hwnd) {
      await setFocus(system, shown.parent.hwnd);
    } else {
      await focusNothing(system);
    }
  }

  system.rasterInput?.nudge();

  return was ? TRUE : FALSE;
}

/** Where a window's parent's client area is on the screen: the screen's corner for one at the top. */
function originOf(shown: any) {
  const parent = shown.parent;

  return parent
    ? { x: parent.left + parent.client.left, y: parent.top + parent.client.top }
    : { x: 0, y: 0 };
}

/** A window's client area in its parent's client area: left, top, right, bottom. */
function clientInParent(shown: any) {
  const origin = originOf(shown);
  const x = shown.left - origin.x;
  const y = shown.top - origin.y;

  return [
    x + shown.client.left,
    y + shown.client.top,
    x + shown.client.right,
    y + shown.client.bottom,
  ];
}

/** `SWP_NOCLIENTSIZE` and `SWP_NOCLIENTMOVE`, as a client area was and is (seg7 `0fcf`, `0fe6`). */
function clientFlags(was: number[], now: number[]) {
  return (
    (now[2] - now[0] === was[2] - was[0] && now[3] - now[1] === was[3] - was[1]
      ? SWP_NOCLIENTSIZE
      : 0) | (now[0] === was[0] && now[1] === was[1] ? SWP_NOCLIENTMOVE : 0)
  );
}

/**
 * `WM_NCCALCSIZE` as `SetWindowPos` sends it (`USER.EXE` seg7 `0ea4`-`0f50`):
 * `wParam` 1 and `NCCALCSIZE_PARAMS` -- the rectangle the window is to have,
 * the one it has and its client area's, each in its parent's client area.
 * The structure as the window procedure left it, and its answer.
 */
async function calcSize(system: any, hwnd: number, window: RasterWindow, to: number[]) {
  const shown = window.window;
  const windowClass = system.handles.retrieve(window.options.windowClass);
  const params: any = new NCCALCSIZE_PARAMS();
  const origin = originOf(shown);
  const [x, y] = [shown.left - origin.x, shown.top - origin.y];
  const rect = (into: any, [left, top, right, bottom]: number[]) =>
    Object.assign(into, { left, top, right, bottom });

  rect(params.rgrc0, to);
  rect(params.rgrc1, [x, y, x + shown.width, y + shown.height]);
  rect(params.rgrc2, clientInParent(shown));
  params.lppos = 0;

  const answer = windowClass
    ? await system.scheduler.callWndProc(windowClass, hwnd, User.WM_NCCALCSIZE, 1, [params])
    : 0;

  return { params, answer: (answer ?? 0) & 0xffff };
}

/**
 * A window minimized to the first free place among the icons and put at the
 * very bottom, after the last window there, **recorded** by `showmin`:
 * `WM_WINDOWPOSCHANGING` with its place, `WM_GETMINMAXINFO`,
 * `WM_NCCALCSIZE` with the icon's rectangle, then `WM_WINDOWPOSCHANGED`,
 * from which `DefWindowProc` tells it its place and size. Shown, its flags
 * say so, and it is drawn before it is told; hidden, as a window made
 * minimized is, it is not drawn.
 */
export async function minimizeToBottom(
  system: any,
  hwnd: number,
  window: RasterWindow,
  show: boolean
) {
  const desktop = window.desktop;
  const shown = window.window;
  const tops = desktop.windows.filter(
    (other: any) => !other.parent && other !== shown && other.titleOf !== shown
  );
  const after = tops.length ? (tops[tops.length - 1].hwnd ?? 0) : 0;
  const old = [shown.left, shown.top, shown.left + shown.width, shown.top + shown.height];
  const oldClient = [
    shown.left + shown.client.left,
    shown.top + shown.client.top,
    shown.left + shown.client.left + shown.clientWidth,
    shown.top + shown.client.top + shown.clientHeight,
  ];

  desktop.minimize(shown);

  const flags = SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_NOCOPYBITS | (show ? SWP_SHOWWINDOW : 0);
  const place: any = new WINDOWPOS();

  place.hwnd = hwnd;
  place.hwndInsertAfter = after;
  place.x = shown.left;
  place.y = shown.top;
  place.cx = shown.width;
  place.cy = shown.height;
  place.flags = flags;

  /* For which `DefWindowProc` asks `WM_GETMINMAXINFO`, and holds the icon to
   * the reserved size it answers: a window without a minimize box answering
   * 50 by 50 is an icon so big (`minmax`). */
  await sendTo(system, shown, User.WM_WINDOWPOSCHANGING, 0, [place]);

  {
    const [x, y, cx, cy] = [place.x, place.y, place.cx, place.cy].map(signed);

    if (x !== shown.left || y !== shown.top || cx !== shown.width || cy !== shown.height) {
      desktop.place(shown, x, y, Math.max(cx, 0), Math.max(cy, 0));
      place.cx = shown.width;
      place.cy = shown.height;
    }
  }

  const params: any = new NCCALCSIZE_PARAMS();
  const rect = (to: any, [left, top, right, bottom]: number[]) => {
    to.left = left;
    to.top = top;
    to.right = right;
    to.bottom = bottom;
  };

  rect(params.rgrc0, [shown.left, shown.top, shown.left + shown.width, shown.top + shown.height]);
  rect(params.rgrc1, old);
  rect(params.rgrc2, oldClient);
  params.lppos = 0;

  await sendTo(system, shown, User.WM_NCCALCSIZE, 1, [params]);
  desktop.toBottom(shown, show);

  if (show) {
    (shown as any).needsNcPaint = true;
    (shown as any).dirtyRect = undefined;
    await eraseDue(system);
  }

  place.flags = show ? flags : flags | SWP_NOREDRAW;
  await sendTo(system, shown, User.WM_WINDOWPOSCHANGED, 0, [place]);
}

/**
 * An icon's title made and shown: its window asked for its text, 80
 * characters, as the title is made and again as it is drawn; and, when the
 * icon was not made active, the icon asked to go after its title, which it
 * already does -- nothing more is sent (`showmin`).
 */
async function titleShown(system: any, hwnd: number, window: RasterWindow, activated: boolean) {
  const shown = window.window;

  await askText(system, hwnd, window, 0x50);

  if (!activated && shown.iconTitle?.hwnd) {
    const place: any = new WINDOWPOS();

    place.hwnd = hwnd;
    place.hwndInsertAfter = shown.iconTitle.hwnd;
    place.x = 0;
    place.y = 0;
    place.cx = 0;
    place.cy = 0;
    place.flags = SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE;
    await sendTo(system, shown, User.WM_WINDOWPOSCHANGING, 0, [place]);
  }

  await askText(system, hwnd, window, 0x50);
}

/**
 * A window at the top made active, as USER's `ActivateWindow` makes it
 * (`USER.EXE` seg1 `3514`): the window active before told, then, where the
 * first window that shows at the top is not this one -- always, for one
 * hidden -- brought to the front with the windows it brings (`3674`-`3697`),
 * then told itself. Each of them is asked with `WM_WINDOWPOSCHANGING`, the
 * windows it owns first, hidden ones too, then it, with `SWP_NOSIZE |
 * SWP_NOMOVE` and the rest `SWP_NOACTIVATE` besides; and told with
 * `WM_WINDOWPOSCHANGED` where that moved it among the others.
 *
 * **Recorded** by `comboact` -- a dropped list pressed while another window
 * is active -- and by `enddlg`: a dialog made hidden and given the focus as
 * `DialogBox` makes it is asked with 3, its owner with 13h and neither is
 * told; an owner made active again as a dialog ends, with an icon's title
 * above it, is asked with the hidden dialog it owns first.
 *
 * `forFocus`: `SetFocus`'s activation, which gives the focus itself
 * (`3899`; see `deliverActivation`). Otherwise a focus left in another window
 * at the top is moved to this one (`37a3`).
 *
 * `whole`: a window that shows is due whole, as `SetActiveWindow`, `SetFocus`
 * and `EndDialog` have it (`hooks`: the owner of a dialog ended is painted
 * again); otherwise only what it uncovers of itself, as a window made active
 * as another is destroyed (`uncover`: the window under one destroyed is
 * erased once).
 */
export async function activateWindow(system: any, top: any, forFocus = false, whole = true) {
  const desktop = system.rasterDesktop;

  if (!desktop || desktop.activeTop === top) {
    return;
  }

  const first = desktop.windows.find((other: any) => !other.parent && other.visible) ?? null;
  const family = first !== top ? activationFamily(desktop, top) : [];
  const before = new Map(family.map((member: any) => [member, above(desktop, member)]));

  if (top.visible && !whole) {
    desktop.show(top, false);
  } else {
    desktop.activate(top);
  }

  if (forFocus && desktop.pendingActivation) {
    desktop.pendingActivation.forFocus = true;
  }

  await deliverActivation(
    system,
    family.length
      ? async () => {
          let after = insertAfter(desktop, family[0]);

          for (const member of family) {
            const place: any = new WINDOWPOS();

            place.hwnd = member.hwnd;
            place.hwndInsertAfter = after;
            place.flags =
              member === top ? SWP_NOSIZE | SWP_NOMOVE : SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE;
            await sendTo(system, member, User.WM_WINDOWPOSCHANGING, 0, [place]);
            after = member.hwnd ?? 0;
          }

          for (const member of family) {
            if (above(desktop, member) === before.get(member)) {
              continue;
            }

            const place: any = new WINDOWPOS();

            place.hwnd = member.hwnd;
            place.x = member.left;
            place.y = member.top;
            place.cx = member.width;
            place.cy = member.height;
            place.flags =
              (member === top
                ? SWP_NOSIZE | SWP_NOMOVE
                : SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE) |
              SWP_NOCLIENTSIZE |
              SWP_NOCLIENTMOVE;
            await sendTo(system, member, User.WM_WINDOWPOSCHANGED, 0, [place]);
          }
        }
      : undefined
  );
}

/** `SetFocus`'s activation of the window at the top the focus goes into. */
export async function activateForFocus(system: any, top: any) {
  await activateWindow(system, top, true);
}

/**
 * The windows `ActivateWindow` brings to the front with a window at the top:
 * as `familyOf`, with the windows the head owns that are hidden among them
 * (`enddlg`: an owner made active again asks the hidden dialog it owns).
 */
function activationFamily(desktop: any, shown: any) {
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
  const members = desktop.windows.filter(
    (other: any) =>
      !other.parent && !other.titleOf && other !== head && (other === shown || owns(other))
  );

  return [...members, head];
}

/**
 * A window at the top about to be made active by a press: brought to the
 * front between the two windows' messages, as `SetWindowPos` would bring it,
 * its family asked and those of it that moved told (`alttab`: a window
 * pressed under another is sent `WM_WINDOWPOSCHANGING` and
 * `WM_WINDOWPOSCHANGED` after the window losing the activation is told).
 * What to send then; nothing where it was at the front already.
 */
export function bringingForward(system: any, top: any) {
  const desktop = system.rasterDesktop;
  const family = familyOf(desktop, top);
  const before = new Map(family.map((member: any) => [member, above(desktop, member)]));

  return async () => {
    if (family.every((member: any) => above(desktop, member) === before.get(member))) {
      return;
    }

    let after = insertAfter(desktop, family[0]);

    for (const member of family) {
      const place: any = new WINDOWPOS();

      place.hwnd = member.hwnd;
      place.hwndInsertAfter = after;
      place.flags =
        member === top ? SWP_NOSIZE | SWP_NOMOVE : SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE;
      await sendTo(system, member, User.WM_WINDOWPOSCHANGING, 0, [place]);
      after = member.hwnd ?? 0;
    }

    for (const member of family) {
      if (above(desktop, member) === before.get(member)) {
        continue;
      }

      const place: any = new WINDOWPOS();

      place.hwnd = member.hwnd;
      place.x = member.left;
      place.y = member.top;
      place.cx = member.width;
      place.cy = member.height;
      place.flags =
        (member === top ? SWP_NOSIZE | SWP_NOMOVE : SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE) |
        SWP_NOCLIENTSIZE |
        SWP_NOCLIENTMOVE;
      await sendTo(system, member, User.WM_WINDOWPOSCHANGED, 0, [place]);
    }
  };
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

/**
 * The window at the top just above a window at the top, or none -- an
 * icon's title, which goes with its icon, passed over (`showmin`).
 */
/**
 * The windows at the top above a window at the top, the front first, as one
 * key: where it lies in the order, which a window hidden keeps (`mousemsg`),
 * so that one shown again from behind another is moved though the window
 * just above it is the same (`showseq`).
 */
function above(desktop: any, shown: any) {
  const tops = desktop.windows.filter((other: any) => !other.parent && !other.titleOf);
  const at = tops.indexOf(shown);

  return tops
    .slice(0, Math.max(at, 0))
    .map((other: any) => other.id)
    .join(',');
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
 * **recorded** by `showseq` and `minmax`: the reserved point the size of an
 * icon and four borders; maximized, a window with a sizing frame is the
 * screen and a frame beyond it on every side, one without it the screen and
 * four borders more, at a border's width up and to the left; the least it
 * may be dragged to is `SM_CXMINTRACK` by `SM_CYMINTRACK` for a window with
 * `WS_BORDER` or `WS_DLGFRAME` -- either, as `test` asks of them (`1973`) --
 * a border each way for one with neither; and the most, the screen and a
 * frame beyond it.
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

  if (style & WS_CAPTION) {
    set('ptMinTrackSize', metric(SM_CXMINTRACK), metric(SM_CYMINTRACK));
  } else {
    set('ptMinTrackSize', bx, by);
  }

  set('ptMaxTrackSize', sx + 2 * fx, sy + 2 * fy);

  return mmi;
}

/**
 * A window asked `WM_GETMINMAXINFO`, and what it answered held to what USER
 * allows (`USER.EXE` seg6 `1a4f`: `18e0` offers, the message is sent, `19a8`
 * holds). **Read out** of `19a8`, and **recorded** by `minmax`:
 *
 * * A window with a minimize box keeps the reserved point as offered,
 *   whatever it answered; one without has the icon it answers.
 * * With a whole caption, the least it may be tracked to is no narrower
 *   than its caption's boxes -- the system menu's, the minimize box and the
 *   maximize box, each as wide as half the display driver's `OBM_CLOSE`
 *   (seg3 `0f3c`, `1114`) -- and a sizing frame each side, and no lower than
 *   `SM_CYMINTRACK` as offered: 62 by 26 for `WS_OVERLAPPEDWINDOW` answering
 *   1 by 1 on the VGA.
 * * Without one, no smaller than two sizing frames each way with one, two
 *   borders without.
 *
 * The answer as held, a `MINMAXINFO`.
 */
export async function askMinMax(system: any, hwnd: number, style: number) {
  const metric = (index: number) => GetSystemMetrics.call(system, index);
  const offered = minMaxInfo(system, style);
  const mmi = minMaxInfo(system, style);
  const window = system.handles.resolve(hwnd);
  const windowClass = window && system.handles.retrieve(window.options?.windowClass);

  if (windowClass) {
    await system.scheduler.callWndProc(windowClass, hwnd, User.WM_GETMINMAXINFO, 0, [mmi]);
  }

  if (style & WS_MINIMIZEBOX) {
    mmi.ptReserved.x = offered.ptReserved.x;
    mmi.ptReserved.y = offered.ptReserved.y;
  }

  const boxes =
    (style & WS_SYSMENU ? 1 : 0) +
    (style & WS_MAXIMIZEBOX ? 1 : 0) +
    (style & WS_MINIMIZEBOX ? 1 : 0);
  const min = mmi.ptMinTrackSize;

  if ((style & WS_CAPTION) === WS_CAPTION) {
    const close = system.rasterDesktop?.environment?.oem?.get(OBM_CLOSE);
    const box = close ? close.width >> 1 : metric(SM_CXSIZE);

    min.x = Math.max(boxes * box + 2 * metric(SM_CXFRAME), signed(min.x));
    min.y = Math.max(offered.ptMinTrackSize.y, signed(min.y));
  } else {
    const thick = (style & WS_THICKFRAME) !== 0;
    const [ex, ey] = thick
      ? [metric(SM_CXFRAME), metric(SM_CYFRAME)]
      : [metric(SM_CXBORDER), metric(SM_CYBORDER)];

    min.x = Math.max(2 * ex, signed(min.x));
    min.y = Math.max(2 * ey, signed(min.y));
  }

  return mmi;
}

/** A word as the signed number it holds. */
function signed(value: number) {
  return (value << 16) >> 16;
}

/**
 * A size held to what a window may be (`USER.EXE` seg1 `0000`): only an
 * overlapped window, or one with a sizing frame, is held, and asked
 * `WM_GETMINMAXINFO` for it (`askMinMax`). An icon is held between the
 * reserved point and the size maximized; any other window between the least
 * and the most it may be tracked to, the least winning where the most is
 * smaller (`005d`-`007e`). `DefWindowProc` holds the size of
 * `WM_WINDOWPOSCHANGING` so (seg1 `609a`), and `CreateWindow` the size it was
 * given (seg8 `06d9`) -- not `SetWindowPos` itself, so a window that answers
 * `WM_WINDOWPOSCHANGING` itself is not held at all (`minmax`).
 */
export async function holdSize(
  system: any,
  hwnd: number,
  style: number,
  minimized: boolean,
  cx: number,
  cy: number
): Promise<[number, number]> {
  if (style & (WS_POPUP | WS_CHILD) && !(style & WS_THICKFRAME)) {
    return [cx, cy];
  }

  const mmi = await askMinMax(system, hwnd, style | (minimized ? WS_MINIMIZE : 0));
  const [least, most] = minimized
    ? [mmi.ptReserved, mmi.ptMaxSize]
    : [mmi.ptMinTrackSize, mmi.ptMaxTrackSize];

  return [
    Math.max(Math.min(cx, signed(most.x)), signed(least.x)),
    Math.max(Math.min(cy, signed(most.y)), signed(least.y)),
  ];
}

/**
 * A window's frame changed where it is: a scroll bar of its own added or
 * taken away, by `ShowScrollBar` or `SetScrollRange`. **Recorded** by
 * `showsb`: the window is sent `WM_WINDOWPOSCHANGING`, `WM_NCCALCSIZE`,
 * `WM_WINDOWPOSCHANGED` and `WM_SIZE`, in that order and nothing else, and
 * then painted: its frame by `WM_NCPAINT` from `BeginPaint`, and its
 * background erased only where a bar went away and left client area that
 * had not been. A style that does not change sends nothing.
 *
 * **Read out** of `USER.EXE`: `SetWindowPos` marks the structure
 * `SWP_NOCLIENTSIZE` and `SWP_NOCLIENTMOVE` (seg7 `0d66`), sends
 * `WM_NCCALCSIZE`, and clears the first only where the client area's width
 * or height changed (`0fe6`) and the second only where its corner moved
 * (`0fcf`); `DefWindowProc` sends `WM_SIZE` for `WM_WINDOWPOSCHANGED` only
 * without `SWP_NOCLIENTSIZE` (`122d`). So a bar that leaves the client area
 * as it was -- a window with no room below its caption, where no bar is laid
 * out (seg1 `70b7`) -- sends no `WM_SIZE`. Control Panel's window, made
 * empty, sets its vertical bar's range at each `WM_SIZE` from a width that
 * depends on the bar, and went on until its stack ran out.
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
  const was = { ...shown.client };

  shown.style = style;
  window.desktop.place(shown, shown.left, shown.top, shown.width, shown.height);
  await send(User.WM_NCCALCSIZE, 0, 0);

  /* What of the client area stayed as it was, said so. */
  const client = shown.client;
  const sized =
    client.right - client.left !== was.right - was.left ||
    client.bottom - client.top !== was.bottom - was.top;
  const moved = client.left !== was.left || client.top !== was.top;

  windowPos.flags |= (sized ? 0 : SWP_NOCLIENTSIZE) | (moved ? 0 : SWP_NOCLIENTMOVE);

  /* `DefWindowProc` sends `WM_SIZE` for it, the client area sized. */
  await send(User.WM_WINDOWPOSCHANGED, 0, [windowPos]);

  shown.needsPaint = true;
  (shown as any).dirtyRect = undefined;
  (shown as any).needsNcPaint = true;
  shown.needsErase = erasing || lost;
}

/**
 * What `DefWindowProc` does with `WM_WINDOWPOSCHANGED`: `WM_MOVE` when the
 * client area moved, then `WM_SIZE` when it was sized, as the structure's
 * `SWP_NOCLIENTMOVE` and `SWP_NOCLIENTSIZE` say -- which `SetWindowPos`
 * clears as they did -- not `SWP_NOMOVE` and `SWP_NOSIZE` (`USER.EXE` seg7
 * `1203`, `122d`; `defer`, `swpframe`).
 */
export async function windowPosChanged(system: any, hwnd: number, flags: number) {
  const window = system.handles.resolve(hwnd);

  if (!(window instanceof RasterWindow)) {
    return;
  }

  const { size, origin, kind } = placeOf(window);
  const windowClass = system.handles.retrieve(window.options.windowClass);

  if (!(flags & SWP_NOCLIENTMOVE)) {
    await system.scheduler.callWndProc(windowClass, hwnd, User.WM_MOVE, 0, origin);
  }

  if (!(flags & SWP_NOCLIENTSIZE)) {
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
 * changed, from which `DefWindowProc` sends `WM_MOVE` and `WM_SIZE`. Where
 * it goes in the order of windows, and what it keeps of its bits as it
 * moves, is the desktop's (`insertFor`, `reorder`, `moveWithBits`). Not
 * measured: what `WM_NCCALCSIZE` carries, sent here as creating a window
 * sends it. `SWP_NOREDRAW` leaves nothing undrawn: `MoveWindow` without a
 * repaint draws as it does with one (`swpbits`).
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

  if (move) {
    await positionChanged(system, [move]);
  }

  return TRUE;
}

/**
 * The first half of a window's move: what it is told before, and where it
 * is to go. Null where nothing is to be done at all, and nothing is sent.
 */
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

  /* The window it goes after as USER works it out, told so in the
   * structure; asked to go after itself, or a child to be topmost, it is
   * sent nothing at all where nothing else is asked (`swporder`). */
  const activated =
    !(flags & (SWP_NOACTIVATE | SWP_HIDEWINDOW)) && (shown.visible || !!(flags & SWP_SHOWWINDOW));
  let insert: Insert = { to: 'stay' };

  hwndInsertAfter &= 0xffff;

  if (!(flags & SWP_NOZORDER)) {
    const found = window.desktop.insertFor(shown, hwndInsertAfter, activated);

    if (found) {
      [hwndInsertAfter, insert] = found;
    } else if (
      (flags & (SWP_NOMOVE | SWP_NOSIZE)) === (SWP_NOMOVE | SWP_NOSIZE) &&
      !(flags & (SWP_SHOWWINDOW | SWP_HIDEWINDOW))
    ) {
      return null;
    } else {
      flags |= SWP_NOZORDER;
    }
  }

  const windowPos: any = new WINDOWPOS();

  windowPos.hwnd = hwnd;
  windowPos.hwndInsertAfter = hwndInsertAfter;
  windowPos.x = x;
  windowPos.y = y;
  windowPos.cx = cx;
  windowPos.cy = cy;
  windowPos.flags = flags;

  /* A window at the top brought to the front brings the family it heads, as
   * `ShowWindow` does: each asked in turn from the top down, the rest
   * neither sized, moved nor made active (`alttab`: a pop-up and its owner,
   * whichever of them is brought up). */
  const family =
    !parent && !(flags & SWP_NOZORDER) && insert.to === 'top'
      ? familyOf(window.desktop, shown)
      : [shown];
  const at = family.indexOf(shown);
  const askFamily = async (members: any[]) => {
    for (const member of members) {
      const place: any = new WINDOWPOS();

      place.hwnd = member.hwnd;
      place.hwndInsertAfter = 0;
      place.flags = SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE;
      await sendTo(system, member, User.WM_WINDOWPOSCHANGING, 0, [place]);
    }
  };

  await askFamily(family.slice(0, at));

  if (windowClass) {
    await system.scheduler.callWndProc(windowClass, hwnd, User.WM_WINDOWPOSCHANGING, 0, [
      windowPos,
    ]);
  }

  await askFamily(family.slice(at + 1));

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

  /* A size below nought is nought (`USER.EXE` seg7 `0da1`-`0db5`; `minmax`):
   * a window that answers `WM_WINDOWPOSCHANGING` itself is held to nothing
   * else, `DefWindowProc` having held it to its tracking sizes there. */
  if (!(flags & SWP_NOSIZE)) {
    cx = Math.max(cx, 0);
    cy = Math.max(cy, 0);
  }

  /* Put elsewhere by the window procedure, it goes where it was put. */
  const asked = windowPos.hwndInsertAfter & 0xffff;

  if (flags & SWP_NOZORDER) {
    insert = { to: 'stay' };
  } else if (asked !== hwndInsertAfter) {
    insert = window.desktop.insertFor(shown, asked, false)?.[1] ?? { to: 'stay' };
  }

  const left = flags & SWP_NOMOVE ? shown.left : x + offset.x;
  const top = flags & SWP_NOMOVE ? shown.top : y + offset.y;
  const width = flags & SWP_NOSIZE ? shown.width : cx;
  const height = flags & SWP_NOSIZE ? shown.height : cy;

  /* Whenever a size is given, even the one the window has (`defer`), and
   * whenever the frame changed (`USER.EXE` seg7 `0e8f`): with
   * `NCCALCSIZE_PARAMS`, the window's rectangle to be, the one it has and its
   * client area's, each in its parent's client area (`0ea4`-`0f50`;
   * `swpframe`). The first, as the window procedure leaves it, is its client
   * area, and its answer says what of the old client area's bits it keeps
   * (`calcKept`; `nccalc`). The `WINDOWPOS` is not pointed to. */
  const calc =
    windowClass && (!(flags & SWP_NOSIZE) || flags & SWP_FRAMECHANGED)
      ? await calcSize(system, hwnd, window, [
          left - offset.x,
          top - offset.y,
          left - offset.x + width,
          top - offset.y + height,
        ])
      : null;

  return { hwnd, window, windowPos, insert, left, top, width, height, flags, calc, family };
}

/** A rectangle of `NCCALCSIZE_PARAMS`, each side the signed word it is. */
function sides(rect: any) {
  return [rect.left, rect.top, rect.right, rect.bottom].map(signed);
}

/**
 * Which of a window's old client area's bits `SetWindowPos` keeps, from what
 * its procedure answered `WM_NCCALCSIZE` (`USER.EXE` seg7 `0f67`-`0f84`,
 * `10a7`-`1153`): `rect`, where on the screen they go, and `dx`, `dy`, how
 * far they come. Null for what `moveWithBits` keeps of itself, the old
 * client area's corner at the new one's: an answer of nought, or one below
 * 10h or above 400h, which keeps them so and is read as 30h,
 * `WVR_ALIGNTOP | WVR_ALIGNLEFT` (`0f74`-`0f84`); `none` for nothing kept.
 *
 * Otherwise the second rectangle is where they go and the third where they
 * come from, as the procedure left them -- `DefWindowProc` leaves the old
 * window's rectangle and the old client area's. `WVR_HREDRAW` (100h), or
 * the class's `CS_HREDRAW`, with the client area's width changed keeps
 * nothing; likewise `WVR_VREDRAW` (200h), `CS_VREDRAW` and its height. How
 * far they come is from the second rectangle's corner to the third's;
 * `WVR_ALIGNRIGHT` (80h) then moves the second rectangle's left edge by how
 * much wider it is than the third, `WVR_ALIGNBOTTOM` (40h) its top by how
 * much higher, and one larger than the third is cut to its size at the
 * right and the bottom. **Recorded** by `nccalc`: `WVR_ALIGNRIGHT |
 * WVR_ALIGNBOTTOM` from `DefWindowProc`'s rectangles keeps bits from four
 * pixels right of the old client area's left edge and 23 below its top --
 * the old frame among them -- at four in and four down; `WVR_REDRAW` keeps
 * nothing; `WVR_VALIDRECTS` (400h) keeps the third's 40 by 30 at the
 * second's; 800h is nought.
 */
function calcKept(
  move: { window: RasterWindow; width: number; height: number; calc: any },
  classStyle: number,
  origin: { x: number; y: number },
  clientWas: number[]
): { rect: number[]; dx: number; dy: number } | 'none' | null {
  const answer = move.calc?.answer ?? 0;

  if (answer < 0x10 || answer > 0x400) {
    return null;
  }

  const params = move.calc.params;
  const client = sides(params.rgrc0);
  const dest = sides(params.rgrc1);
  const source = sides(params.rgrc2);

  if (
    (client[2] - client[0] !== clientWas[2] - clientWas[0] &&
      (answer & WVR_HREDRAW || classStyle & CS_HREDRAW)) ||
    (client[3] - client[1] !== clientWas[3] - clientWas[1] &&
      (answer & WVR_VREDRAW || classStyle & CS_VREDRAW))
  ) {
    return 'none';
  }

  const [dx, dy] = [dest[0] - source[0], dest[1] - source[1]];
  const [sourceWide, sourceHigh] = [source[2] - source[0], source[3] - source[1]];
  const [destWide, destHigh] = [dest[2] - dest[0], dest[3] - dest[1]];

  if (answer & WVR_ALIGNRIGHT) {
    dest[0] += destWide - sourceWide;
  }

  if (answer & WVR_ALIGNBOTTOM) {
    dest[1] += destHigh - sourceHigh;
  }

  if (destWide > sourceWide) {
    dest[2] = dest[0] + sourceWide;
  }

  if (destHigh > sourceHigh) {
    dest[3] = dest[1] + sourceHigh;
  }

  return {
    rect: [dest[0] + origin.x, dest[1] + origin.y, dest[2] + origin.x, dest[3] + origin.y],
    dx,
    dy,
  };
}

/**
 * The second half of the moves begun, each window placed and then told, in
 * the order they were begun.
 */
export async function positionChanged(
  system: any,
  moves: NonNullable<Awaited<ReturnType<typeof positionChanging>>>[]
) {
  const placed: {
    move: (typeof moves)[number];
    moved: boolean;
    sized: boolean;
    showing: boolean;
    client: number;
  }[] = [];
  const clientInParent = (shown: any) => {
    const parent = shown.parent;
    const x = parent ? shown.left - parent.left - parent.client.left : shown.left;
    const y = parent ? shown.top - parent.top - parent.client.top : shown.top;

    return [
      x + shown.client.left,
      y + shown.client.top,
      x + shown.client.right,
      y + shown.client.bottom,
    ];
  };

  /* Where each of the families brought up lay, to tell those that moved. */
  const aboveBefore = new Map<any, string>();

  for (const move of moves) {
    for (const member of move.family) {
      aboveBefore.set(member, above(move.window.desktop, member));
    }
  }

  /* Whether the windows so far lay where they were asked to go: while they
   * do, the next asked to go somewhere is looked at as well (`USER.EXE`
   * seg7 `0e09`-`0e38`). */
  let inPlaceSoFar = true;

  for (const move of moves) {
    const { window, left, top, width, height, flags } = move;
    const shown = window.window;
    const moved = left !== shown.left || top !== shown.top;
    const sized = width !== shown.width || height !== shown.height;
    const visible = shown.visible;
    const framed = (flags & SWP_FRAMECHANGED) !== 0;
    const clientWas = clientInParent(shown);
    const origin = originOf(shown);
    const windowClass = system.handles.retrieve(window.options.windowClass);

    /* The client area as the window procedure made it (seg7 `0f89`-`0fb9`;
     * `nccalc`). */
    if (move.calc) {
      const client = sides(move.calc.params.rgrc0);
      const [x, y] = [left - origin.x, top - origin.y];

      window.desktop.answerClient(shown, width, height, {
        left: client[0] - x,
        top: client[1] - y,
        right: client[2] - x,
        bottom: client[3] - y,
      });
    }

    if (moved || sized) {
      window.desktop.moveWithBits(
        shown,
        left,
        top,
        width,
        height,
        !(flags & SWP_NOCOPYBITS),
        windowClass?.style ?? 0,
        sized ? calcKept(move, windowClass?.style ?? 0, origin, clientWas) : null
      );

      /* An icon moved keeps that place, minimized again later (`iconclk`). */
      if (moved && shown.state === 'minimized') {
        shown.iconPlace = { left, top };
      }
    } else if (framed) {
      window.desktop.frameChanged(shown);
    }

    /* Sized, its whole frame is due as a region of it (`swpframe`). */
    if (sized) {
      (shown as any).frameRegion = (shown as any).needsNcPaint;
    }

    const lay = !(flags & SWP_NOZORDER) && liesWhereAsked(window.desktop, shown, move.insert);

    /* Put where it was asked to go among its brothers (`mousemsg`,
     * `swporder`); a window shown comes to the front as it shows, and one
     * hidden stays where it is. */
    let reordered =
      !(flags & SWP_HIDEWINDOW) &&
      !(flags & SWP_SHOWWINDOW && !shown.visible) &&
      window.desktop.reorder(shown, move.insert);

    /* Brought to the top, the windows it owns come up above it and the
     * window that owns it beneath, the family it was asked with
     * (`alttab`). Not made active, it is brought up so all the same: a press
     * on a disabled owner puts it on top with `SWP_NOACTIVATE`, and the
     * pop-up it owns comes with it (`USER.EXE` seg1 `59a4`; `curerr`). */
    if (move.family.length > 1 && !(flags & SWP_HIDEWINDOW) && shown.visible) {
      reordered = window.desktop.bringFamilyUp(shown) || reordered;
    }

    if (flags & SWP_HIDEWINDOW && shown.visible) {
      /* The active window hidden so stays active: only `ShowWindow` and
       * `DestroyWindow` ask for another (`USER.EXE` seg14 `0dc2`, seg8
       * `0bb7`); `SetWindowPos` asks for none. */
      window.desktop.hide(shown, false);
    } else if (
      flags & SWP_SHOWWINDOW &&
      !shown.visible &&
      !shown.parent &&
      flags & SWP_NOACTIVATE
    ) {
      /* Shown and not made active: `SetWindowPos` activates only the first
       * window of its list without `SWP_NOACTIVATE` (`USER.EXE` seg7
       * `0cda`-`0ce6`, `0260`-`026f`). It goes where it was asked among the
       * others, or stays where it lay with `SWP_NOZORDER` (`swpshow`). */
      reordered = window.desktop.reorder(shown, move.insert) || reordered;
      window.desktop.showInPlace(shown);
    } else if (flags & SWP_SHOWWINDOW && !shown.visible) {
      window.desktop.show(shown);
    } else if (!shown.parent && shown.visible && !(flags & SWP_NOACTIVATE)) {
      /* Activated, and so brought to the top, unless asked not to be: even
       * with its place in the order left alone, the window moved under the
       * cursor is the one there after (`mousemv`). Only what it uncovered
       * of itself is due. */
      window.desktop.show(shown, false);
    }

    /* A window at the top shown is due whole, its frame with it:
     * `WM_NCPAINT` and `WM_ERASEBKGND` come before `WM_WINDOWPOSCHANGED`, as
     * `ShowWindow` has them (`swpshow`). */
    if (shown.visible && !visible && !shown.parent) {
      (shown as any).needsNcPaint = true;
      (shown as any).dirtyRect = undefined;
    }

    /* Already where it was asked to go, it is told so with `SWP_NOZORDER`
     * (seg7 `0e09`-`0e38`, `1184`; `swpshow`: a window shown after the window
     * it already lay after). */
    let inPlace = 0;

    if (!(flags & SWP_NOZORDER) && inPlaceSoFar) {
      inPlaceSoFar = lay;
      inPlace = lay ? SWP_NOZORDER : 0;
    }

    /* What of the client area stayed as it was, said so (seg7 `0d66`,
     * `0fcf`, `0fe6`). */
    const clientNow = clientInParent(shown);
    const client =
      (clientNow[2] - clientNow[0] === clientWas[2] - clientWas[0] &&
      clientNow[3] - clientNow[1] === clientWas[3] - clientWas[1]
        ? SWP_NOCLIENTSIZE
        : 0) |
      (clientNow[0] === clientWas[0] && clientNow[1] === clientWas[1] ? SWP_NOCLIENTMOVE : 0);

    placed.push({
      move,
      moved,
      sized,
      showing: shown.visible !== visible || reordered || framed,
      client: client | inPlace,
    });
  }

  /* Made active, then erased where it is due, and only then told it moved
   * (`swpbits`, `swporder`, `showseq`). A window made active that is not
   * then the first at the top -- with a window it owns above it, or its
   * icon's title -- is brought to the front again between the two windows'
   * messages, its family asked again (`alttab`). */
  const desktop = moves[0]?.window.desktop;

  await deliverActivation(system, async () => {
    const to = desktop?.activeTop;
    const first = desktop?.windows.find(
      (other: any) => !other.parent && other.visible && !other.switchBox && !other.popup
    );

    if (!to || !first || first === to) {
      return;
    }

    const family = familyOf(desktop, to);
    let after = insertAfter(desktop, family[0]);

    for (const member of family) {
      const place: any = new WINDOWPOS();

      place.hwnd = member.hwnd;
      place.hwndInsertAfter = after;
      place.flags =
        member === to ? SWP_NOSIZE | SWP_NOMOVE : SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE;
      await sendTo(system, member, User.WM_WINDOWPOSCHANGING, 0, [place]);
      after = member.hwnd ?? 0;
    }
  });
  await eraseDue(system);

  /* A frame changed with nothing of its client area to paint is done. */
  for (const { move } of placed) {
    const shown: any = move.window.window;

    if (move.flags & SWP_FRAMECHANGED && !shown.needsPaint) {
      shown.dirtyRect = undefined;
    }
  }

  /* Told only when something changed: a window deferred to where it
   * already was is sent `WM_WINDOWPOSCHANGING` and no more (`defer`). */
  for (const { move, moved, sized, showing, client } of placed) {
    const own = move.window.window;
    const at = move.family.indexOf(own);

    await tellFamily(system, move.family.slice(0, at), aboveBefore);

    if (!moved && !sized && !showing) {
      await tellFamily(system, move.family.slice(at + 1), aboveBefore);
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
    windowPos.flags =
      (flags | (moved ? 0 : SWP_NOMOVE) | (sized ? 0 : SWP_NOSIZE) | client) & 0xffff;

    await system.scheduler.callWndProc(windowClass, hwnd, User.WM_WINDOWPOSCHANGED, 0, [windowPos]);
    await tellFamily(system, move.family.slice(at + 1), aboveBefore);
  }

  system.rasterInput?.nudge();
}

/**
 * Whether a window already lies where it is asked to go, as USER looks before
 * it moves it (`USER.EXE` seg7 `1184`): at the bottom, the last of its
 * brothers; at the top, the first, or for one not topmost the first after the
 * last topmost window; after a window, right after it, topmost as that one
 * is. One made topmost, or topmost no more, does not. An icon's title is not
 * counted as a brother: winbox.js keeps it just in front of its icon, where
 * Windows keeps it among the topmost windows (`swpshow`: an icon brought to
 * `HWND_TOP` goes after its own title, `#32772`, and is not where it was
 * asked to go).
 */
function liesWhereAsked(desktop: any, shown: any, to: Insert): boolean {
  const brothers = desktop.windows.filter(
    (other: any) => other.parent === shown.parent && !other.titleOf
  );
  const at = brothers.indexOf(shown);
  const before = at > 0 ? brothers[at - 1] : null;
  const topmost = !!shown.topmost;
  const lastTopmost = () =>
    brothers.filter((other: any) => other !== shown && other.topmost).pop() ?? null;

  switch (to.to) {
    case 'stay':
      return true;
    case 'bottom':
      return at >= 0 && at === brothers.length - 1;
    case 'top':
      return shown.parent || topmost ? before === null : before === lastTopmost();
    case 'topmost':
      return topmost && before === null;
    case 'notTopmost':
      return !topmost;
    case 'after':
      return before === to.other && !!to.other.topmost === topmost;
  }
}

/** The family brought up with a window told, each that moved among the windows. */
async function tellFamily(system: any, members: any[], aboveBefore: Map<any, string>) {
  for (const member of members) {
    if (above(member.desktop ?? system.rasterDesktop, member) === aboveBefore.get(member)) {
      continue;
    }

    const parent = member.parent;
    const place: any = new WINDOWPOS();

    place.hwnd = member.hwnd;
    place.hwndInsertAfter = 0;
    place.x = parent ? member.left - parent.left - parent.client.left : member.left;
    place.y = parent ? member.top - parent.top - parent.client.top : member.top;
    place.cx = member.width;
    place.cy = member.height;
    place.flags = SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE | SWP_NOCLIENTSIZE | SWP_NOCLIENTMOVE;
    await sendTo(system, member, User.WM_WINDOWPOSCHANGED, 0, [place]);
  }
}

const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOZORDER = 0x0004;
const SWP_NOACTIVATE = 0x0010;
const SWP_FRAMECHANGED = 0x0020;
const SWP_SHOWWINDOW = 0x0040;
const SWP_HIDEWINDOW = 0x0080;
const WA_ACTIVE = 1;
const SWP_NOCOPYBITS = 0x0100;
const SWP_NOREDRAW = 0x0008;
const SWP_NOCLIENTSIZE = 0x0800;
const SWP_NOCLIENTMOVE = 0x1000;
const WVR_ALIGNBOTTOM = 0x0040;
const WVR_ALIGNRIGHT = 0x0080;
const WVR_HREDRAW = 0x0100;
const WVR_VREDRAW = 0x0200;
const CS_VREDRAW = 0x0001;
const CS_HREDRAW = 0x0002;
const CS_SAVEBITS = 0x0800;
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

const SM_CXFRAME = 32;
const SM_CYFRAME = 33;

const WS_THICKFRAME = 0x00040000;
const WS_MINIMIZE = 0x20000000;
const WS_SYSMENU = 0x00080000;
const WS_MINIMIZEBOX = 0x00020000;
const WS_MAXIMIZEBOX = 0x00010000;
const SM_CXSIZE = 30;
const OBM_CLOSE = 32754;
const WS_CLIPCHILDREN = 0x02000000;
const WS_CAPTION = 0x00c00000;
const WS_POPUP = 0x80000000;
const WS_CHILD = 0x40000000;
const SM_CXSCREEN = 0;
const SM_CYSCREEN = 1;
const SM_CXBORDER = 5;
const SM_CYBORDER = 6;
const SM_CXICON = 11;
const SM_CYICON = 12;
const SM_CXMINTRACK = 34;
const SM_CYMINTRACK = 35;
