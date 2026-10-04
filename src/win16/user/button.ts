'use strict';

import { User } from '../user.js';
import { askControlColours, CTLCOLOR_MSGBOX } from './ctlcolor.js';
import { drawButtonItem, sendParent } from './control-classes.js';
import { BUTTON_PUSHED, type ControlState } from './controls.js';
import { GetNextDlgGroupItem, setFocus } from './dialogs.js';
import { RasterWindow } from './raster-window.js';
import { ReleaseCapture, SetCapture } from './SetCapture.js';
import { SendMessage } from './SendMessage.js';

/**
 * A button's own messages, as USER's button window procedure takes them
 * (`USER.EXE` seg25 `1a12`, the `BUTTON` class's procedure): the mouse --
 * the press, the pointer moved while it is held, the release, the double
 * click -- the Space bar, the focus gained and lost, being enabled or
 * disabled, the check, and the button's pushed state, which `BM_SETSTATE`
 * sets and `BM_GETSTATE` reads beside the check and the focus.
 *
 * **Read out** of `USER.EXE`, and **recorded** by `btnclick`, `btnkeys` and
 * `btnmore`: each kind of button -- push, default push, check box, automatic check box,
 * radio, automatic radio, three-state and automatic three-state -- sent the
 * mouse's messages at points of its client area, and the keyboard's, with
 * its state, the capture, the focus and its parent's messages after each;
 * `BM_SETCHECK` with each value on every kind; a radio button given the
 * focus; an owner-drawn button pushed and let out; each kind's text set with
 * `WM_SETTEXT`, and its answer to `WM_GETDLGCODE`.
 *
 * The procedure's dispatch (seg25 `1a2a`-`1add`): `WM_SETFOCUS` at `1ae0`,
 * `WM_KILLFOCUS` `1b2c`, `WM_ENABLE` `1bc9`, `WM_SETTEXT` `1b7b`, `WM_PAINT`
 * `1bdf`, `WM_GETDLGCODE` `1cab`, `WM_KEYDOWN`
 * `1f5d`, `WM_KEYUP` and `WM_SYSKEYUP` `1d1f`, `WM_CHAR` `1d57`, the mouse's
 * at `1dae`-`1df7`, `BM_GETCHECK` `1e12`, `BM_SETCHECK` `1e1b`, `BM_GETSTATE`
 * `1e9b`, `BM_SETSTATE` `1ea3`; the rest to `DefWindowProc` (`1f87`).
 *
 * The button keeps a byte of state, its check in the low two bits (seg25
 * `1e9b`, which answers it whole to `BM_GETSTATE`):
 *
 * * `04h`, pushed: drawn pressed in.
 * * `08h`, the focus.
 * * `10h`, the focus being taken by the button's own press, of the mouse or
 *   the Space bar, for the moment `SetFocus` takes (seg25 `11c6`-`11d3`): a
 *   radio button gaining the focus so does not tell its parent it was
 *   clicked.
 * * `20h`, the mouse captured by the button.
 * * `40h`, the left button held down on it: the press is being followed.
 *
 * The check is kept here apart from the byte, and the focus is asked of the
 * desktop.
 *
 * Each time the button draws itself outside `WM_PAINT` -- pushed or let out,
 * checked, gaining or losing the focus, enabled or disabled -- it takes a
 * device context of its own, if it shows, and asks its parent's colours with
 * `WM_CTLCOLOR` (seg25 `103a`, `0fc4`): whatever its kind, an owner-drawn one
 * too, before its `WM_DRAWITEM`; and its `WM_PAINT` asks them once (seg25
 * `1c0d`). `btnkeys` recorded each `CTLCOLOR_BTN` in its order among the
 * notifications.
 */

const WM_GETDLGCODE = 0x0087;
const WM_SYSKEYUP = 0x0105;
const BM_GETCHECK = 0x0400;
const BM_SETCHECK = 0x0401;
export const BM_GETSTATE = 0x0402;
export const BM_SETSTATE = 0x0403;

const BN_CLICKED = 0;
const BN_HILITE = 2;
const BN_UNHILITE = 3;
const BN_PAINT = 1;
const BN_DISABLE = 4;
const BN_DOUBLECLICKED = 5;

const VK_TAB = 0x09;
const VK_SPACE = 0x20;

const DLGC_RADIOBUTTON = 0x0040;

const BS_CHECKBOX = 0x02;
const BS_AUTOCHECKBOX = 0x03;
const BS_RADIOBUTTON = 0x04;
const BS_3STATE = 0x05;
const BS_AUTO3STATE = 0x06;
const BS_GROUPBOX = 0x07;
const BS_USERBUTTON = 0x08;
const BS_AUTORADIOBUTTON = 0x09;
const BS_OWNERDRAW = 0x0b;

const WS_TABSTOP = 0x00010000;
const WS_DISABLED = 0x08000000;

const ODA_DRAWENTIRE = 1;
const ODA_SELECT = 2;
const ODA_FOCUS = 4;

/** Pushed: drawn pressed in. */
const PUSHED = BUTTON_PUSHED;
/** The focus, as `BM_GETSTATE` answers it. */
const FOCUS = 0x08;
/** The focus being taken by the button's own press. */
const OWN_PRESS = 0x10;
/** The mouse captured by the button. */
const CAPTURED = 0x20;
/** The left button held down on it, the press followed. */
const TRACKING = 0x40;

const kindOf = (control: ControlState) => control.style & 0x0f;

const send = (system: any, hwnd: number, message: number, wParam: number, lParam = 0) =>
  SendMessage.call(system, hwnd, message, wParam, lParam);

/** Whether a handle still names the same window. */
const stillThere = (system: any, hwnd: number, window: RasterWindow) =>
  system.handles.resolve(hwnd) === window;

/** The parent told of the button with `WM_COMMAND`: its identifier, and itself and the code in `lParam`. */
async function notifyParent(system: any, window: RasterWindow, code: number) {
  const shown = window.window;

  await sendParent(
    system,
    window,
    User.WM_COMMAND,
    shown.controlId,
    ((shown.hwnd & 0xffff) | (code << 16)) >>> 0
  );
}

/**
 * A button's own answer to a message of the mouse's or the keyboard's, to
 * its focus gained or lost, to being enabled, and to the messages of its
 * check and its pushed state; `undefined` for a message it leaves to the
 * rest of its procedure.
 */
export async function buttonMessage(
  system: any,
  window: RasterWindow,
  control: ControlState,
  message: number,
  wParam: number,
  lParam: any
): Promise<number | undefined> {
  const hwnd = window.window.hwnd;
  const state = control.state ?? 0;
  const kind = kindOf(control);

  switch (message) {
    /* A move counts only while the press is followed; otherwise it is
     * answered at once (seg25 `1dae`). */
    case User.WM_MOUSEMOVE:
      if (state & TRACKING) {
        await press(system, window, control, lParam);
      }
      break;

    case User.WM_LBUTTONDOWN:
      await press(system, window, control, lParam);
      break;

    /* Released: only a press followed is let go (seg25 `1de8`). */
    case User.WM_LBUTTONUP:
      if (state & TRACKING) {
        await release(system, window, control, true);
      }
      break;

    /* A radio button, a user button and an owner-drawn one tell their parent
     * of the double click; any other takes it as another press (seg25
     * `1df7`). A radio button's is recorded: `BN_DOUBLECLICKED`, and neither
     * the capture nor a push. */
    case User.WM_LBUTTONDBLCLK:
      if (kind === BS_RADIOBUTTON || kind === BS_USERBUTTON || kind === BS_OWNERDRAW) {
        await notifyParent(system, window, BN_DOUBLECLICKED);
      } else {
        await press(system, window, control, lParam);
      }
      break;

    /* A key pressed, while the mouse's press is not followed (seg25 `1f5d`):
     * the Space bar takes the capture and the focus as a press does, but
     * follows nothing, and pushes the button with `BM_SETSTATE` -- again as
     * the key repeats, each time asking the parent's colours; any other key
     * lets the button go without a click, as Return does with the Space bar
     * held (`btnkeys`, `space-then-return`). A disabled button is pushed and
     * clicked all the same. */
    case User.WM_KEYDOWN:
      if (!(state & TRACKING)) {
        if (wParam === VK_SPACE) {
          await capture(system, window, control, 0);
          await send(system, hwnd, BM_SETSTATE, 1);
        } else {
          await release(system, window, control, false);
        }
      }
      break;

    /* A key let go (seg25 `1d1f`): left to `DefWindowProc` while the mouse's
     * press is followed, and for Tab; otherwise the button let go, and
     * clicked if it was the Space bar and the button was still pushed -- so
     * the Space bar let go after Return clicks nothing. A system key goes on
     * to `DefWindowProc` after, if the button is still there. */
    case User.WM_KEYUP:
    case WM_SYSKEYUP:
      if (state & TRACKING || wParam === VK_TAB) {
        return undefined;
      }

      await release(system, window, control, wParam === VK_SPACE);

      if (message === WM_SYSKEYUP && stillThere(system, hwnd, window)) {
        return undefined;
      }
      break;

    /* A character (seg25 `1d57`): a check box, plain or automatic, is
     * checked by `+` or `=` and cleared by `-`, its capture taken and let go
     * around it; any other character, and any other kind, goes to
     * `DefWindowProc`, as does one while the mouse's press is followed. Read
     * out only: `btnkeys` sends only the Space bar's character, which every
     * kind leaves. */
    case User.WM_CHAR: {
      const check = wParam === 0x2b || wParam === 0x3d ? 1 : wParam === 0x2d ? 0 : -1;

      if (check < 0 || state & TRACKING || (kind !== BS_CHECKBOX && kind !== BS_AUTOCHECKBOX)) {
        return undefined;
      }

      await capture(system, window, control, 0);
      await send(system, hwnd, BM_SETCHECK, check);
      await release(system, window, control, true);
      break;
    }

    case User.WM_SETFOCUS:
      await focused(system, window, control, kind);
      break;

    case User.WM_KILLFOCUS:
      await unfocused(system, window, control, state, kind);
      break;

    /* Enabled or disabled: drawn again at once, whole (seg25 `1bc9`,
     * `1835`), not left to `WM_PAINT`. */
    case User.WM_ENABLE:
      if (await colours(system, window)) {
        await drawWhole(system, window, control, kind);
      }
      break;

    /* The check, in the low bits of the state (seg25 `1e12`). */
    case BM_GETCHECK:
      return control.checked & 3;

    case BM_SETCHECK:
      await setCheck(system, window, control, kind, wParam);
      break;

    /* The state byte whole, the check in its low bits (seg25 `1e9b`). */
    case BM_GETSTATE: {
      const focus = window.desktop.focus === window.window ? FOCUS : 0;

      return (control.checked & 3) | state | focus;
    }

    case BM_SETSTATE:
      await setState(system, window, control, wParam !== 0);
      break;

    default:
      return undefined;
  }

  return 0;
}

/**
 * New text (seg25 `1b7b`), drawn at once, not left to `WM_PAINT`: the text
 * kept as `DefWindowProc` keeps it (seg1 `6302`), then, as `WM_ENABLE` does,
 * if the button shows, its parent asked its colours and the button drawn
 * whole (`1bc9`, `1835`) -- an owner-drawn one by its owner with
 * `ODA_DRAWENTIRE`, a user button telling its parent `BN_PAINT`. Nothing is
 * left to be painted after.
 *
 * A group box first takes away the caption it had (`1b81`-`1bba`): its
 * parent asked its colours, the rectangle the old caption's ground took
 * (`1097`, type 3; empty without a caption) made to be painted again, and
 * filled with the brush the parent answers as `CTLCOLOR_MSGBOX` --
 * `PaintRect` asking with the type it is given in place of a brush (seg1
 * `76eb`, seg6 `028c`). So it asks three times at once, and once more as it
 * is painted after. USER makes only that rectangle to be painted, with its
 * background erased; here the whole group box is, which paints the same, and
 * its erasing does nothing (`WM_ERASEBKGND` answered at `1c3c`).
 *
 * The answer is nought, as the procedure leaves it (`1b25`).
 *
 * **Recorded** by `btnmore`: each kind's notes at once (`CTLCOLOR_BTN`; then
 * `BN_PAINT` for a user button, `WM_DRAWITEM` for an owner-drawn one; for a
 * group box `CTLCOLOR_BTN`, `CTLCOLOR_MSGBOX`, `CTLCOLOR_BTN`) and as it is
 * next painted (none but the group box's `CTLCOLOR_BTN`).
 */
export async function buttonSetText(
  system: any,
  window: RasterWindow,
  control: ControlState,
  text: string
) {
  const kind = kindOf(control);

  if (kind === BS_GROUPBOX && (await colours(system, window))) {
    const captioned = control.text !== '';

    await askControlColours(system, window.window.hwnd, window, [CTLCOLOR_MSGBOX, 1]);
    window.desktop.paintControl(window.window, true);

    if (captioned) {
      window.window.needsPaint = true;
    }
  }

  control.text = text;
  window.window.title = text;

  if (await colours(system, window)) {
    await drawWhole(system, window, control, kind);
  }
}

/**
 * A button drawn whole, in the device context it was asked its colours in
 * (seg25 `1835`): an owner-drawn one by its owner with `ODA_DRAWENTIRE`; any
 * other as it is, and a user button then tells its parent so.
 */
async function drawWhole(system: any, window: RasterWindow, control: ControlState, kind: number) {
  if (kind === BS_OWNERDRAW) {
    await drawButtonItem(system, window, ODA_DRAWENTIRE);
  } else {
    drawNow(window, false);
    await userButtonPainted(system, window, control);
  }
}

/**
 * A user button drawn tells its parent (seg25 `1986`-`19a1`): `BN_PAINT`,
 * then `BN_HILITE` if it is pushed and `BN_DISABLE` if it is disabled. Any
 * other kind tells nothing. **Recorded** by `btnmore` for its text set:
 * `BN_PAINT` alone.
 */
export async function userButtonPainted(system: any, window: RasterWindow, control: ControlState) {
  if (kindOf(control) !== BS_USERBUTTON) {
    return;
  }

  const pushed = ((control.state ?? 0) & PUSHED) !== 0;
  const disabled = (window.window.style & WS_DISABLED) !== 0;

  await notifyParent(system, window, BN_PAINT);

  if (pushed) {
    await notifyParent(system, window, BN_HILITE);
  }

  if (disabled) {
    await notifyParent(system, window, BN_DISABLE);
  }
}

/**
 * The focus gained (seg25 `1ae0`): drawn with it at once -- an owner-drawn
 * button by its owner with `ODA_FOCUS` -- and then a radio button, plain or
 * automatic, that is not checked tells its parent `BN_CLICKED`, unless the
 * focus came by its own press (seg25 `1b00`). It is not checked by it: an
 * automatic one stays clear (`btnkeys`, `radiofocus`). USER also passes over
 * a button marked by the dialog manager's arrow keys (state `80h`, seg25
 * `0dcc`), which is not followed here. Not handed on to `DefWindowProc`.
 */
async function focused(system: any, window: RasterWindow, control: ControlState, kind: number) {
  if (await colours(system, window)) {
    if (kind === BS_OWNERDRAW) {
      await drawButtonItem(system, window, ODA_FOCUS, true);
    } else {
      drawNow(window, false);
    }
  }

  if (
    !((control.state ?? 0) & OWN_PRESS) &&
    (kind === BS_RADIOBUTTON || kind === BS_AUTORADIOBUTTON) &&
    control.checked === 0
  ) {
    await notifyParent(system, window, BN_CLICKED);
  }
}

/**
 * The focus lost (seg25 `1b2c`): a press being followed is let out, and the
 * button let go as its release lets it go -- a button still pushed, by the
 * Space bar or a program's `BM_SETSTATE`, clicked (`btnkeys`,
 * `space-then-focus-away`). Then, if the button is still there, it is drawn
 * at once without the focus -- an owner-drawn one by its owner with
 * `ODA_FOCUS` -- and its whole client area made to be painted again, without
 * erasing: its `WM_PAINT` asks its parent's colours once more. Not handed on
 * to `DefWindowProc`.
 */
async function unfocused(
  system: any,
  window: RasterWindow,
  control: ControlState,
  state: number,
  kind: number
) {
  const hwnd = window.window.hwnd;

  if (state & TRACKING) {
    await send(system, hwnd, BM_SETSTATE, 0);
  }

  await release(system, window, control, true);

  if (!stillThere(system, hwnd, window)) {
    return;
  }

  if (await colours(system, window)) {
    if (kind === BS_OWNERDRAW) {
      await drawButtonItem(system, window, ODA_FOCUS, false);
    } else {
      drawNow(window, true);
    }
  }

  window.window.needsPaint = true;
}

/**
 * A press, or a move while it is held (seg25 `1db4`): the press followed,
 * the capture and the focus taken, then the button pushed if the point is
 * inside its client area and let out if not, by `BM_SETSTATE` sent to
 * itself.
 */
async function press(system: any, window: RasterWindow, control: ControlState, lParam: any) {
  await capture(system, window, control, TRACKING);

  const value = typeof lParam === 'number' ? lParam : 0;
  const x = (value << 16) >> 16;
  const y = value >> 16;
  const inside =
    x >= 0 && x < window.window.clientWidth && y >= 0 && y < window.window.clientHeight;

  await send(system, window.window.hwnd, BM_SETSTATE, inside ? 1 : 0);
}

/**
 * The mouse captured and the focus taken, for a press of the mouse or the
 * Space bar (seg25 `11ac`): `bits` set; then, if the button has not the
 * capture already, `SetCapture`, and `SetFocus` with the state's `10h` set
 * around it -- which a disabled button is refused (`btnclick`), though it
 * keeps the capture.
 */
async function capture(system: any, window: RasterWindow, control: ControlState, bits: number) {
  const hwnd = window.window.hwnd;

  control.state = (control.state ?? 0) | bits;

  if (control.state & CAPTURED) {
    return;
  }

  control.state |= CAPTURED | OWN_PRESS;
  SetCapture.call(system, hwnd);

  await setFocus(system, hwnd);

  if (stillThere(system, hwnd, window)) {
    control.state &= ~OWN_PRESS;
  }
}

/**
 * A button let go (seg25 `1255`). If it is pushed, it is let out with
 * `BM_SETSTATE`, and -- where `click` -- an automatic button's check
 * changes: an automatic check box's toggles, an automatic three-state box's
 * steps from unchecked to checked to grayed and round again, and an
 * automatic radio button is checked and every other radio button of its
 * group cleared. Then the capture is let go, if the button has it, and the
 * parent is told `BN_CLICKED`, if it was pushed and `click`.
 */
async function release(system: any, window: RasterWindow, control: ControlState, click: boolean) {
  const hwnd = window.window.hwnd;
  const pushed = ((control.state ?? 0) & PUSHED) !== 0;
  const kind = kindOf(control);
  const checked = control.checked & 3;
  const clicked = pushed && click;

  if (pushed) {
    await send(system, hwnd, BM_SETSTATE, 0);
  }

  if (clicked) {
    if (kind === BS_AUTOCHECKBOX || kind === BS_AUTO3STATE) {
      const limit = kind === BS_AUTO3STATE ? 2 : 1;

      await send(system, hwnd, BM_SETCHECK, checked + 1 > limit ? 0 : checked + 1);
    } else if (kind === BS_AUTORADIOBUTTON) {
      await checkRadioGroup(system, window);
    }
  }

  if ((control.state ?? 0) & CAPTURED) {
    control.state = (control.state ?? 0) & ~(CAPTURED | TRACKING);
    ReleaseCapture.call(system);
  }

  if (clicked) {
    await notifyParent(system, window, BN_CLICKED);
  }
}

/**
 * An automatic radio button checked, and the rest of its group cleared
 * (seg25 `12c3`-`1300`): from the button round its group with
 * `GetNextDlgGroupItem` back to it, each that answers `WM_GETDLGCODE` with
 * `DLGC_RADIOBUTTON` sent `BM_SETCHECK` -- checked for this one, cleared for
 * the others. USER goes round until it comes back; here a window met twice
 * ends it too, where the group skips the button itself, as it skips one
 * disabled or hidden.
 */
async function checkRadioGroup(system: any, window: RasterWindow) {
  const hwnd = window.window.hwnd;
  const parent = window.window.parent?.hwnd ?? 0;
  const met: number[] = [];
  let at = hwnd;

  for (;;) {
    const code = await send(system, at, WM_GETDLGCODE, 0);

    if (code & DLGC_RADIOBUTTON) {
      await send(system, at, BM_SETCHECK, at === hwnd ? 1 : 0);
    }

    met.push(at);
    at = GetNextDlgGroupItem.call(system, parent, at, 0);

    if (at === hwnd || at === 0 || met.includes(at)) {
      return;
    }
  }
}

/**
 * `BM_SETCHECK` (seg25 `1e1b`, by a table of the kinds at `1e30`): a check
 * box, plain or automatic, is checked by any value but nought; a radio
 * button too, which also takes `WS_TABSTOP` with its check and loses it
 * cleared, whether the check changed or not (`1e7b`); a three-state box
 * takes the value up to 2, grayed. A push button, a default one, a group
 * box, a user button and an owner-drawn one keep none: `BM_GETCHECK`
 * answers them nought (`btnkeys`, `check`). A check changed is drawn at once
 * (`1e4a`-`1e75`), asking the parent's colours; one the same is not drawn,
 * nor asked.
 */
async function setCheck(
  system: any,
  window: RasterWindow,
  control: ControlState,
  kind: number,
  wParam: number
) {
  let check: number;

  switch (kind) {
    case BS_CHECKBOX:
    case BS_AUTOCHECKBOX:
      check = wParam ? 1 : 0;
      break;

    case BS_RADIOBUTTON:
    case BS_AUTORADIOBUTTON: {
      const shown = window.window;

      shown.style = (wParam ? shown.style | WS_TABSTOP : shown.style & ~WS_TABSTOP) >>> 0;
      control.style = (wParam ? control.style | WS_TABSTOP : control.style & ~WS_TABSTOP) >>> 0;
      check = wParam ? 1 : 0;
      break;
    }

    case BS_3STATE:
    case BS_AUTO3STATE:
      check = Math.min(wParam & 0xffff, 2);
      break;

    default:
      return;
  }

  if ((control.checked & 3) === check) {
    return;
  }

  control.checked = check;

  if (await colours(system, window)) {
    drawNow(window, false);
  }
}

/**
 * `BM_SETSTATE` (seg25 `1ea3`): pushed or let out, and, where the button
 * shows, drawn at once in a device context of its own after asking its
 * parent's colours (seg25 `103a`, `0fc4`) -- not left to `WM_PAINT`, and
 * asked though nothing changed (`btnkeys`, `space-repeat`). A user button
 * tells its parent `BN_HILITE` or `BN_UNHILITE`, changed or not; an
 * owner-drawn one is drawn by its owner with `ODA_SELECT`, and any other
 * drawn pressed in or out (seg25 `17ac`), each only if the state changed.
 */
async function setState(system: any, window: RasterWindow, control: ControlState, pushed: boolean) {
  const was = ((control.state ?? 0) & PUSHED) !== 0;
  const kind = kindOf(control);

  control.state = pushed ? (control.state ?? 0) | PUSHED : (control.state ?? 0) & ~PUSHED;

  if (!(await colours(system, window))) {
    return;
  }

  if (kind === BS_USERBUTTON) {
    await notifyParent(system, window, pushed ? BN_HILITE : BN_UNHILITE);
  } else if (was !== pushed) {
    if (kind === BS_OWNERDRAW) {
      await drawButtonItem(system, window, ODA_SELECT);
    } else {
      drawNow(window, false);
    }
  }
}

/**
 * The device context a button draws itself in at once, outside `WM_PAINT`
 * (seg25 `103a`): none if the button does not show, and false; otherwise its
 * parent asked its colours with `WM_CTLCOLOR`, `CTLCOLOR_BTN`, whatever its
 * kind (seg25 `0fc4`), and true.
 */
async function colours(system: any, window: RasterWindow) {
  if (!window.window.visible) {
    return false;
  }

  await askControlColours(system, window.window.hwnd, window);
  return true;
}

/**
 * A button drawn now, as it is, a part of it waiting to be painted still
 * waiting -- drawn without the focus where `unfocused`, as it is drawn
 * losing it while the desktop still names it.
 */
function drawNow(window: RasterWindow, unfocused: boolean) {
  const desktop = window.desktop;
  const shown = window.window;
  const waiting = [shown.needsPaint, shown.needsErase];
  const focus = desktop.focus;

  if (unfocused && focus === shown) {
    desktop.focus = null;
  }

  try {
    desktop.paintControl(shown);
  } finally {
    desktop.focus = focus;
    [shown.needsPaint, shown.needsErase] = waiting;
  }
}
