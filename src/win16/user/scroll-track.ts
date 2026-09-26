'use strict';

import { MulDiv } from '../gdi/MulDiv.js';
import { User } from '../user.js';

import { WM_SYSTIMER } from './caret.js';
import { DispatchMessage } from './DispatchMessage.js';
import { scrollGeometry, type ScrollTrack } from './painter.js';
import { killTimer, nextMessage, setTimer } from './queue.js';
import { RasterWindow } from './raster-window.js';
import { scrollState, SB_CTL, SB_HORZ, SB_VERT } from './scroll-bars.js';
import { TranslateMessage } from './TranslateMessage.js';

/**
 * A press on a scroll bar followed until the button is let go: what
 * `DefWindowProc` does for `SC_VSCROLL` and `SC_HSCROLL`, which a press on a
 * window's own bar becomes, and what a scroll bar control does with a press
 * on itself.
 *
 * **Read out of `USER.EXE`** seg18 `1636`:
 *
 * * **Where the press is.** On an arrow, `SB_LINEUP` or `SB_LINEDOWN`, unless
 *   the arrow is turned off; between the first arrow and the thumb,
 *   `SB_PAGEUP`; after the thumb, `SB_PAGEDOWN`; on the thumb, a drag, if the
 *   track is longer than the thumb. A bar with both arrows off takes no
 *   press. The part held is its run along the bar, a border in each way: an
 *   arrow's, or a page's from the arrow to the thumb.
 * * **A part held.** It is drawn pressed -- the driver's pressed arrow, or
 *   the page inverted -- and its code is sent: `WM_VSCROLL` or `WM_HSCROLL`,
 *   to the window for its own bar and to the control's parent for a control,
 *   `lParam` the control's window in its high word. A system timer, 0xFFFE,
 *   sends it again after 200 milliseconds and then every 50, while the
 *   pointer is on the part (seg18 `110c`). The pressed look follows the
 *   pointer off the part and back, and coming back sends the code again at
 *   once. A page is cut back to the thumb when the program moves the thumb
 *   into it, so paging stops under the pointer (seg18 `042c`).
 * * **The thumb dragged.** `SB_THUMBTRACK` with the position at once, then
 *   whenever the position under the pointer changes; the thumb's outline
 *   follows the pointer, and goes back to where the thumb was when the
 *   pointer leaves the bar, widened by four borders across and one along
 *   (seg18 `14e5`). The position is `min + (max - min) * at / room`, from
 *   where the outline is along the track. Let go, `SB_THUMBPOSITION` with the
 *   last position. The bar itself moves only when the program sets it.
 * * **Let go.** `SB_ENDSCROLL`, after the part is drawn as it was.
 *
 * While it lasts, the mouse is the bar's, keys for the window are dropped,
 * and everything else is dispatched (seg18 `159c`).
 *
 * **Recorded** by `sbtrack` on four displays: a control and a window's own
 * bar pressed on each part and dragged, what the parent is sent, and the bar
 * pressed and after. Not recorded: the repeat, which a probe cannot hold a
 * press long enough to see, and the drag outline, which is not yet drawn when
 * the first `SB_THUMBTRACK` comes; its alternate pixels are counted from the
 * window's corner here.
 */

const WM_HSCROLL = 0x0114;
const WM_VSCROLL = 0x0115;

const SB_THUMBPOSITION = 4;
const SB_THUMBTRACK = 5;
const SB_ENDSCROLL = 8;

const HTHSCROLL = 6;

const REPEAT_TIMER = 0xfffe;
const FIRST_DELAY = 200;
const REPEAT_DELAY = 50;

const SBS_VERT = 0x0001;

/** Whether a message is the mouse's, client or not. */
const isMouse = (message: number) =>
  (message >= 0x0200 && message <= 0x0209) || (message >= 0x00a0 && message <= 0x00a9);
const isKey = (message: number) => message >= 0x0100 && message <= 0x0108;
const isRelease = (message: number) => message === User.WM_LBUTTONUP || message === User.WM_NCLBUTTONUP;

/**
 * Follows a press on a scroll bar, `hit` being `HTVSCROLL` or `HTHSCROLL` for
 * a window's own bar and 0 for a scroll bar control; `x, y` on the screen.
 */
export async function trackScrollBar(system: any, hwnd: number, hit: number, x: number, y: number) {
  const owner = system.handles.resolve(hwnd);

  if (!(owner instanceof RasterWindow)) {
    return;
  }

  const desktop = owner.desktop;
  const window = owner.window;
  const control = hit === 0;
  const vertical = control ? (window.style & SBS_VERT) !== 0 : hit !== HTHSCROLL;
  const bar = control ? SB_CTL : vertical ? SB_VERT : SB_HORZ;
  const state: any = control ? (window.control as any)?.scroll : scrollState(window, bar);

  if (!state) {
    return;
  }

  const flags = (state.flags ?? 0) & 3;

  if (flags === 3) {
    return;
  }

  const notify = control ? (window.parent?.hwnd ?? 0) : hwnd;
  const ctlHwnd = control ? hwnd : 0;
  const rect = control
    ? {
        left: window.client.left,
        top: window.client.top,
        right: window.client.right,
        bottom: window.client.bottom,
      }
    : desktop.scrollBarRect(window, vertical);
  const length = vertical ? rect.bottom - rect.top : rect.right - rect.left;
  const thickness = vertical ? rect.right - rect.left : rect.bottom - rect.top;
  const geometryNow = () => scrollGeometry(desktop.environment, length, vertical, state);
  const geometry = geometryNow();

  if (!geometry) {
    return;
  }

  const along = (px: number, py: number) => (vertical ? py - window.top - rect.top : px - window.left - rect.left);
  const across = (px: number, py: number) => (vertical ? px - window.left - rect.left : py - window.top - rect.top);
  const send = (code: number, pos = 0) =>
    system.scheduler.callWndProc(
      system.handles.retrieve(system.handles.resolve(notify)?.options?.windowClass),
      notify,
      vertical ? WM_VSCROLL : WM_HSCROLL,
      code,
      (((ctlHwnd & 0xffff) << 16) | (pos & 0xffff)) >>> 0
    );

  /* Which part the press is on. */
  const p = along(x, y);
  const { arrowEnd, downStart, thumbTop, thumb, border } = geometry;
  let track: ScrollTrack;

  if (p < arrowEnd) {
    if (flags & 1) return;
    track = { part: 0, start: border, end: arrowEnd - border, pressed: false };
  } else if (p >= downStart) {
    if (flags & 2) return;
    track = { part: 1, start: downStart + border, end: length - border, pressed: false };
  } else if (p < thumbTop) {
    track = { part: 2, start: arrowEnd, end: thumbTop, pressed: false };
  } else if (p < thumbTop + thumb) {
    if (downStart - arrowEnd <= thumb) return;
    track = { part: 4, start: thumbTop, end: thumbTop + thumb, pressed: true };
  } else {
    track = { part: 3, start: thumbTop + thumb, end: downStart, pressed: false };
  }

  const repaint = () => {
    if (control) {
      desktop.paintControl(window);
    } else {
      desktop.paintFrame(window);
    }
  };
  const painter = () => desktop.windowPainter(window);
  const x0 = rect.left;
  const y0 = rect.top;
  const x1 = rect.right;
  const y1 = rect.bottom;
  const inside = (px: number, py: number) => {
    const a = along(px, py);
    const c = across(px, py);

    return a >= track.start && a < track.end && c >= border && c < thickness - border;
  };

  /* Shows the part pressed or not: an arrow drawn again, a page inverted. */
  const show = (pressed: boolean) => {
    if (pressed === track.pressed) {
      return;
    }

    track.pressed = pressed;

    if (track.part <= 1) {
      repaint();
    } else {
      painter().invertAlong(x0, y0, x1, y1, vertical, track.start, track.end);
    }
  };

  state.track = track;

  const input = system.rasterInput;
  const previousCapture = input?.capture ?? null;

  if (input) {
    input.capture = window;
  }

  let lastPos = state.pos;

  if (track.part <= 3) {
    /* Pressed, sent, and repeated while held. */
    let delay = FIRST_DELAY;
    const arm = () => {
      setTimer(system, hwnd, REPEAT_TIMER, delay, 0);
      system._timers.get(`${hwnd}:${REPEAT_TIMER}`).message = WM_SYSTIMER;
    };

    show(true);
    arm();
    await send(track.part);

    for (;;) {
      const msg = await nextMessage(system);

      if (!msg) {
        break;
      }

      if (msg.message === WM_SYSTIMER && msg.hwnd === hwnd && msg.wParam === REPEAT_TIMER) {
        killTimer(system, hwnd, REPEAT_TIMER);
        delay = REPEAT_DELAY;

        const now = inside(msg.pt.x, msg.pt.y);

        show(now);

        if (now) {
          arm();
          await send(track.part);
        }

        continue;
      }

      if (isMouse(msg.message)) {
        const now = inside(msg.pt.x, msg.pt.y);

        if (now !== track.pressed) {
          show(now);

          if (now) {
            arm();
            await send(track.part);
          }
        }

        if (isRelease(msg.message)) {
          break;
        }

        continue;
      }

      if (isKey(msg.message)) {
        continue;
      }

      await dispatch(system, msg);
    }

    killTimer(system, hwnd, REPEAT_TIMER);
    show(false);
  } else {
    /* The thumb dragged: its outline follows the pointer along the track. */
    const start = arrowEnd - border;
    const room = geometry.room;
    const grab = thumbTop - p;
    const snap = {
      left: x0 - 4 * border,
      right: x1 + 4 * border,
      top: y0 - border,
      bottom: y1 + border,
    };
    let at = thumbTop;

    /* The position first, then the outline: the parent's first
     * `SB_THUMBTRACK` finds the bar as it was (**recorded** by `sbtrack`). */
    await send(SB_THUMBTRACK, lastPos);
    track.outline = at;
    painter().thumbOutline(x0, y0, x1, y1, vertical, at, thumb);

    for (;;) {
      const msg = await nextMessage(system);

      if (!msg) {
        break;
      }

      if (isMouse(msg.message)) {
        const wx = msg.pt.x - window.left;
        const wy = msg.pt.y - window.top;
        const onBar = wx >= snap.left && wx < snap.right && wy >= snap.top && wy < snap.bottom;
        const next = onBar
          ? Math.min(Math.max(along(msg.pt.x, msg.pt.y) + grab, start), start + room)
          : thumbTop;

        if (next !== at) {
          painter().thumbOutline(x0, y0, x1, y1, vertical, at, thumb);
          at = next;
          track.outline = at;

          const span = state.max - state.min;
          const pos =
            at < start
              ? state.min
              : at >= start + room
                ? state.max
                : state.min + MulDiv.call(system, span, at - start, room);

          if (pos !== lastPos) {
            lastPos = pos;
            await send(SB_THUMBTRACK, pos);
          }

          painter().thumbOutline(x0, y0, x1, y1, vertical, at, thumb);
        }

        if (isRelease(msg.message)) {
          break;
        }

        continue;
      }

      if (isKey(msg.message)) {
        continue;
      }

      await dispatch(system, msg);
    }

    painter().thumbOutline(x0, y0, x1, y1, vertical, at, thumb);
    track.outline = undefined;
    await send(SB_THUMBPOSITION, lastPos);
  }

  state.track = undefined;

  if (input) {
    input.capture = previousCapture;
  }

  await send(SB_ENDSCROLL);
}

/** Anything else that comes while a press is followed, handed on as a program's loop would. */
async function dispatch(system: any, msg: any) {
  await TranslateMessage.call(system, msg);
  await DispatchMessage.call(system, msg);
}
