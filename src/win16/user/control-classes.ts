'use strict';

import { User, WNDCLASS } from '../user.js';

import {
  BM_GETCHECK,
  BM_SETCHECK,
  CONTROL_CLASSES,
  type ControlState,
} from './controls.js';
import { DefWindowProc } from './DefWindowProc.js';
import { HideCaret, ShowCaret, hideCaretFor } from './caret.js';
import { editMessage, type EditHost } from './edit.js';
import {
  LB,
  LBS_DISABLENOSCROLL,
  LBS_EXTENDEDSEL,
  LBS_HASSTRINGS,
  LBS_MULTIPLESEL,
  LBS_NOINTEGRALHEIGHT,
  LBS_OWNERDRAWFIXED,
  LBS_OWNERDRAWVARIABLE,
  listMessage,
  listState,
  paintList,
  updateScroll,
  type ListHost,
} from './listbox.js';
import { SetScrollPos } from './scroll-bars.js';
import { SYSTEM_FONT, stockFontHandle } from '../gdi/stock-fonts.js';
import { GlobalAlloc } from '../kernel/GlobalAlloc.js';
import { GlobalLock } from '../kernel/GlobalLock.js';
import { buildLines, mlEditMessage, type LinesHost } from './mledit.js';
import { setFocus } from './dialogs.js';
import { ReleaseCapture, SetCapture } from './SetCapture.js';
import { fontOf } from './raster-desktop.js';
import { RasterWindow } from './raster-window.js';

/**
 * The classes USER registers itself, for the raster desktop: `BUTTON`,
 * `STATIC`, `EDIT`, `LISTBOX` and `SCROLLBAR`, their window procedures
 * written here rather than in a program. What each paints is in
 * `controls.ts`; what each does with the messages a program sends it is here,
 * as far as the recordings go: a button's check, a list box's strings.
 *
 * A class is made the first time a window of it is asked for, and registered
 * under the name it was asked for, which is how `CreateWindow` and the
 * functions after it find a class.
 */
export function systemClass(system: any, name: string) {
  const kind = String(name).toUpperCase();

  if (!CONTROL_CLASSES.has(kind)) {
    return null;
  }

  const found = system.handles.retrieve(kind);

  if (found) {
    return found;
  }

  const windowClass: any = new WNDCLASS();

  windowClass.style = 0;
  windowClass.hbrBackground = 0;
  windowClass.lpszClassName = kind;
  windowClass.lpfnWndProc = (hwnd: number, message: number, wParam: number, lParam: any) =>
    controlProc(system, kind, hwnd, message, wParam, lParam);

  const handle = system.handles.allocate(windowClass);

  system.handles.register(handle, kind);

  if (kind !== String(name)) {
    system.handles.register(handle, String(name));
  }

  return windowClass;
}

/** A control's state when it is made: its text, nothing checked, no items. */
export function controlState(className: string, style: number, text: string): ControlState {
  return { className: className.toUpperCase(), style, text, checked: 0, items: [] };
}

/** A string a message carries: given as one, or as a far pointer to one in the program's memory. */
export function stringAt(system: any, value: any) {
  if (typeof value === 'string' || value instanceof String) {
    return String(value);
  }

  if (!value) {
    return '';
  }

  const far = value >>> 0;

  return system.machine.memory.readCString((((far >>> 16) >> 3) << 16) + (far & 0xffff));
}

async function controlProc(
  system: any,
  kind: string,
  hwnd: number,
  message: number,
  wParam: number,
  lParam: any
) {
  const window = system.handles.resolve(hwnd);

  if (!(window instanceof RasterWindow) || !window.window.control) {
    return DefWindowProc.call(system, hwnd, message, wParam, lParam);
  }

  const control = window.window.control;
  const invalidate = () => {
    window.window.needsPaint = true;
  };

  control.hwnd = hwnd;

  if (kind === 'EDIT' && message !== User.WM_SETTEXT) {
    const answer =
      control.style & ES_MULTILINE
        ? await mlEditMessage(system, control, linesHost(system, window), message, wParam, lParam)
        : await editMessage(system, control, editHost(system, window), message, wParam, lParam);

    if (answer !== undefined) {
      return answer;
    }
  }

  switch (message) {
    /* Painted between `BeginPaint` and `EndPaint`, which take the caret away
     * and put it back. */
    case User.WM_PAINT: {
      const hidden = hideCaretFor(system, hwnd);

      if (kind === 'LISTBOX') {
        window.window.needsErase = false;
        window.window.needsPaint = false;
        await paintList(control, listHost(system, window));
      } else {
        window.desktop.paintControl(window.window);
      }

      if (hidden) {
        ShowCaret.call(system, hwnd);
      }

      return 0;
    }

    case User.WM_ERASEBKGND:
      /* A control paints all of itself. */
      return 1;

    case User.WM_SETFONT:
      control.font = wParam ? { handle: wParam, ...fontOf(system, wParam) } : undefined;

      if (lParam) {
        invalidate();
      }
      return 0;

    case User.WM_GETFONT:
      return control.font?.handle ?? 0;

    case WM_GETDLGCODE:
      return dialogCode(control);

    case User.WM_SETTEXT:
      control.text = stringAt(system, lParam);
      window.window.title = control.text;
      invalidate();

      if (kind === 'EDIT') {
        if (control.style & ES_MULTILINE) {
          await mlEditMessage(system, control, linesHost(system, window), message, wParam, lParam);
        } else {
          await editMessage(system, control, editHost(system, window), message, wParam, lParam);
        }
      }

      return 1;

    case User.WM_GETTEXT:
      return copyText(system, control.text, lParam, wParam);

    case User.WM_GETTEXTLENGTH:
      return control.text.length;
  }

  if (kind === 'BUTTON') {
    switch (message) {
      case BM_GETCHECK:
        return control.checked;

      case BM_SETCHECK:
        control.checked = wParam;
        invalidate();
        return 0;
    }
  }

  if (kind === 'LISTBOX') {
    const answer = await listboxMessage(system, window, control, message, wParam, lParam);

    if (answer !== undefined) {
      return answer;
    }
  }

  return DefWindowProc.call(system, hwnd, message, wParam, lParam);
}

const WM_GETDLGCODE = 0x0087;

/**
 * What an edit control asks of the desktop: its layout for its font, its
 * parent told with `WM_COMMAND` -- the control's identifier, and its window
 * and the code in `lParam` -- and itself painted again at once, the caret
 * kept out of the way.
 */
const ES_MULTILINE = 0x0004;

/** The messages whose `lParam` is a string for a list box that keeps strings. */
const LIST_STRINGS = new Set([LB.ADDSTRING, LB.INSERTSTRING, LB.FINDSTRING, LB.FINDSTRINGEXACT, LB.SELECTSTRING]);

async function listboxMessage(system: any, window: RasterWindow, control: ControlState, message: number, wParam: number, lParam: any) {
  const strings = !(control.style & (LBS_OWNERDRAWFIXED | LBS_OWNERDRAWVARIABLE)) || control.style & LBS_HASSTRINGS;
  const argument = LIST_STRINGS.has(message) && strings ? stringAt(system, lParam) : lParam;
  const answer: any = await listMessage(system, control, listHost(system, window), message, wParam, argument);

  if ((control as any).invalid) {
    (control as any).invalid = false;
    window.window.needsErase = true;
    window.window.needsPaint = true;
  }

  /* `LB_GETTEXT` copies the string and its nought, answering its length. */
  if (answer && typeof answer === 'object' && 'copy' in answer) {
    return copyText(system, answer.copy, lParam, answer.copy.length + 1);
  }

  return answer;
}

/** A device context on a list box, for its owner to draw an item with. */
function itemDC(system: any, window: RasterWindow) {
  const any = window as any;
  const surface: any = window.surface;

  /* With the list box's font in it, or the System font, as `GetDC` gives. */
  const own = window.window.control?.font?.font;

  if (own) {
    surface.font = own;
  } else if (!surface.font) {
    const font = stockFontHandle(system, SYSTEM_FONT);

    if (font) {
      surface.font = system.handles.resolve(font);
    }
  }

  any.itemDC ??= system.handles.allocate(surface);

  return any.itemDC;
}

/** Guest memory for the owner-draw structures, one of each. */
function ownerBlock(system: any) {
  if (!system._ownerBlock) {
    system._ownerBlock = GlobalLock.call(system, GlobalAlloc.call(system, 0x42, 64));
  }

  return system._ownerBlock;
}

/** What a list box asks of the desktop and its parent. */
function listHost(system: any, window: RasterWindow): ListHost {
  const desktop = window.desktop;
  const shown = window.window;
  const hwnd = shown.hwnd;
  const control = shown.control!;
  const edit = editHost(system, window);

  return {
    clientWidth: () => shown.clientWidth,
    clientHeight: () => shown.clientHeight,
    drawText: (index, top, fill) => {
      const list = listState(control);
      const selected = (control.style & (LBS_MULTIPLESEL | LBS_EXTENDEDSEL)) ? !!list.selected[index] : list.sel === index;
      const whole = !!(control.style & (LBS_MULTIPLESEL | LBS_EXTENDEDSEL));

      desktop.listText(shown, index, index - top, selected, whole || (fill && index === list.caret));
    },
    focusRect: (row) => desktop.listFocus(shown, row),
    erase: () => desktop.listErase(shown),
    drawItem: async (index, action, state, row) => {
      const list = listState(control);
      const core = system.machine.cpu.core;
      const far = ownerBlock(system) + 32;
      const segment = (far >>> 16) & 0xffff;
      const offset = far & 0xffff;
      const values = [
        2,
        shown.controlId,
        index < control.items.length ? index : 0xffff,
        action,
        state | (shown.style & 0x08000000 ? 4 : 0),
        hwnd,
        itemDC(system, window),
        0,
        row * list.height,
        shown.clientWidth,
        (row + 1) * list.height,
      ];

      values.forEach((value, at) => core.write16(segment, offset + at * 2, value & 0xffff));
      core.write16(segment, offset + 22, (list.data[index] ?? 0) & 0xffff);
      core.write16(segment, offset + 24, ((list.data[index] ?? 0) >>> 16) & 0xffff);
      await sendParent(system, window, 0x002b, shown.controlId, far);
    },
    notify: edit.notify,
    scrollBar: (visible, position) => {
      const has = (shown.style & 0x00200000) !== 0;

      if (control.style & LBS_DISABLENOSCROLL) {
        visible = true;
      }

      if (visible !== has) {
        shown.style = visible ? shown.style | 0x00200000 : shown.style & ~0x00200000;
        desktop.place(shown, shown.left, shown.top, shown.width, shown.height);
      }

      if (position !== null) {
        SetScrollPos.call(system, hwnd, 1, position, 1);
      }
    },
    focus: async () => {
      await setFocus(system, hwnd);
    },
    capture: edit.capture,
  };
}

/** A message to a control's parent, answered as its procedure answers. */
async function sendParent(system: any, window: RasterWindow, message: number, wParam: number, lParam: number) {
  const parent = window.window.parent;
  const owner = parent?.hwnd ? system.handles.resolve(parent.hwnd) : null;
  const windowClass = owner && system.handles.retrieve(owner.options.windowClass);

  return windowClass ? await system.scheduler.callWndProc(windowClass, parent!.hwnd, message, wParam, lParam) : 0;
}

/**
 * A list box made (`USER.EXE` seg38 `0085`): an owner-drawn one of fixed
 * heights asks its parent its row height with `WM_MEASUREITEM` -- offering
 * the font's height, and an item number never set -- and then the list box
 * is made a whole number of rows high unless `LBS_NOINTEGRALHEIGHT`, and its
 * scroll bar hidden while nothing needs it.
 */
export async function initList(system: any, hwnd: number) {
  const window = system.handles.resolve(hwnd);

  if (!(window instanceof RasterWindow) || window.window.control?.className !== 'LISTBOX') {
    return;
  }

  const shown = window.window;
  const control = shown.control!;
  const metrics = control.font ? control.font.metrics : window.desktop.environment.font;
  const list = listState(control, metrics.height);

  /* Its font's height: the state may already have been made, by the messages
   * `CreateWindow` sends before this. */
  list.height = metrics.height;
  control.hwnd = hwnd;

  if (control.style & LBS_OWNERDRAWFIXED) {
    const core = system.machine.cpu.core;
    const far = ownerBlock(system);
    const segment = (far >>> 16) & 0xffff;
    const offset = far & 0xffff;

    [2, shown.controlId, 0, 0, metrics.height, 0, 0].forEach((value, at) =>
      core.write16(segment, offset + at * 2, value)
    );
    await sendParent(system, window, 0x002c, shown.controlId, far);
    list.height = core.read16(segment, offset + 8) || metrics.height;
  }

  if (!(control.style & (LBS_NOINTEGRALHEIGHT | LBS_OWNERDRAWVARIABLE))) {
    const border = 1;
    const inside = shown.height - 2 * border;

    if (inside % list.height) {
      window.desktop.place(shown, shown.left, shown.top, shown.width, Math.trunc(inside / list.height) * list.height + 2 * border);
    }
  }

  updateScroll(control, listHost(system, window));
}

/** A multi-line edit control's host: the same, with its lines' layout, built the first time. */
function linesHost(system: any, window: RasterWindow): LinesHost {
  const host = editHost(system, window);
  const layout = () => window.desktop.linesLayout(window.window);
  const control = window.window.control!;

  if (!(control as any).lines) {
    buildLines(control, layout(), 0, 0, false);
  }

  return { ...host, layout };
}

function editHost(system: any, window: RasterWindow): EditHost {
  const desktop = window.desktop;
  const hwnd = window.window.hwnd;

  return {
    layout: () => desktop.editLayout(window.window),
    focus: async () => {
      await setFocus(system, hwnd);
    },
    capture: (on: boolean) => {
      if (on) {
        SetCapture.call(system, hwnd);
      } else {
        ReleaseCapture.call(system);
      }
    },
    repaint: () => {
      HideCaret.call(system, hwnd);
      desktop.paintControl(window.window);
      ShowCaret.call(system, hwnd);
    },
    notify: async (code: number) => {
      const parent = window.window.parent;
      const owner = parent?.hwnd ? system.handles.resolve(parent.hwnd) : null;
      const windowClass = owner && system.handles.retrieve(owner.options.windowClass);

      if (windowClass) {
        await system.scheduler.callWndProc(
          windowClass,
          parent!.hwnd,
          User.WM_COMMAND,
          window.window.controlId,
          ((hwnd & 0xffff) | (code << 16)) >>> 0
        );
      }
    },
  };
}

/**
 * What a control wants of the keyboard in a dialog, as `WM_GETDLGCODE`
 * answers: an edit control its characters and arrows, a multi-line one every
 * key; a button that it is one, and which kind; static text nothing.
 */
function dialogCode(control: ControlState) {
  const kind = control.style & 0x0f;

  switch (control.className) {
    case 'EDIT':
      return 0x0080 | 0x0008 | 0x0001 | (control.style & 0x0004 ? 0x0004 : 0);
    case 'LISTBOX':
      return 0x0080 | 0x0001;
    case 'STATIC':
      return 0x0100;
    case 'BUTTON':
      /* A group box is static to the dialog manager (`USER.EXE` seg25 `1cab`). */
      if (kind === 7) {
        return 0x0100;
      }

      if (kind === 1) {
        return 0x2000 | 0x0010;
      }

      if (kind === 0) {
        return 0x2000 | 0x0020;
      }

      if (kind === 4 || kind === 9) {
        return 0x2000 | 0x0040;
      }

      return 0x2000;
  }

  return 0;
}

/**
 * A button pressed, as a click or its mnemonic presses it: an automatic check
 * box toggles, an automatic radio button is checked and the others in its
 * group cleared, and the parent is told with `BN_CLICKED`.
 */
export async function clickControl(system: any, hwnd: number) {
  const window = system.handles.resolve(hwnd);

  if (!(window instanceof RasterWindow) || window.window.control?.className !== 'BUTTON') {
    return;
  }

  const control = window.window.control;
  const kind = control.style & 0x0f;

  if (kind === 3) {
    control.checked = control.checked ? 0 : 1;
  } else if (kind === 6) {
    control.checked = (control.checked + 1) % 3;
  } else if (kind === 9) {
    control.checked = 1;

    /* The rest of its group: the radio buttons around it back to one with
     * `WS_GROUP`, and up to the next. */
    const siblings = window.desktop.windows.filter(
      (other: any) => other.parent === window.window.parent && other.hwnd
    );
    const at = siblings.indexOf(window.window);
    let start = at;

    while (start > 0 && !(siblings[start].style & 0x00020000)) {
      start--;
    }

    for (let index = start; index < siblings.length; index++) {
      const other = siblings[index];

      if (index > start && other.style & 0x00020000) {
        break;
      }

      if (
        other !== window.window &&
        other.control?.className === 'BUTTON' &&
        (other.style & 0x0f) === 9
      ) {
        other.control.checked = 0;
        other.needsPaint = true;
      }
    }
  }

  window.window.needsPaint = true;

  const parent = window.window.parent;

  if (parent?.hwnd) {
    const owner = system.handles.resolve(parent.hwnd);
    const windowClass = owner && system.handles.retrieve(owner.options.windowClass);

    if (windowClass) {
      await system.scheduler.callWndProc(
        windowClass,
        parent.hwnd,
        User.WM_COMMAND,
        window.window.controlId,
        (hwnd & 0xffff) >>> 0
      );
    }
  }
}

/**
 * Text copied into a program's buffer, as `WM_GETTEXT` copies it: as much as
 * fits with its zero -- `LoadString`'s rule, which the `loadstr` probe
 * measured -- answering how many characters it copied.
 */
export function copyText(system: any, text: string, far: number, size: number) {
  if (!far || size <= 0) {
    return 0;
  }

  const core = system.machine.cpu.core;
  const segment = (far >>> 16) & 0xffff;
  const offset = far & 0xffff;
  const count = Math.min(text.length, size - 1);

  for (let at = 0; at < count; at++) {
    core.write8(segment, offset + at, text.charCodeAt(at) & 0xff);
  }

  core.write8(segment, offset + count, 0);

  return count;
}
