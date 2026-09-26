'use strict';

import { addFile, fillDirectory, LB_ADDFILE, LB_DIR } from './dlgdir.js';
import { User, WNDCLASS } from '../user.js';

import {
  BM_GETCHECK,
  BM_SETCHECK,
  CONTROL_CLASSES,
  type ControlState,
} from './controls.js';
import { DefWindowProc } from './DefWindowProc.js';
import { HideCaret, ShowCaret, hideCaretFor } from './caret.js';
import { editMessage, editState, type EditHost } from './edit.js';
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
import { enableScrollControl, scrollState, SetScrollPos } from './scroll-bars.js';
import { freeEditBuffer } from './edit-buffer.js';
import { trackScrollBar } from './scroll-track.js';
import { SendMessage } from './SendMessage.js';
import {
  CB,
  CBN_CLOSEUP,
  CBN_DBLCLK,
  CBN_DROPDOWN,
  CBN_EDITCHANGE,
  CBN_EDITUPDATE,
  CBN_KILLFOCUS,
  CBN_SELCHANGE,
  CBN_SETFOCUS,
  CBS_DROPDOWNLIST,
  CBS_HASSTRINGS,
  CBS_OWNERDRAWFIXED,
  CBS_OWNERDRAWVARIABLE,
  CBS_SIMPLE,
  EDIT_ID,
  LIST_ID,
  PASSED_TO_LIST,
  editStyle,
  layout,
  listStyle,
  type ComboState,
} from './combobox.js';
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

  if (kind === 'COMBOBOX' && message !== User.WM_PAINT && message !== User.WM_ERASEBKGND) {
    const answer = await comboMessage(system, window, control, message, wParam, lParam);

    if (answer !== undefined) {
      /* Widened as a list box's are; `CB_GETEDITSEL` and item data are longs. */
      return widened(message, answer, 0x400, 0x410, 0x412);
    }
  }

  /* An edit control's memory, freed as it goes (`edit-buffer.ts`). */
  if (kind === 'EDIT' && message === User.WM_NCDESTROY) {
    freeEditBuffer(system, control);
  }

  /* Whether the text was changed since it was last set, for either kind of
   * edit control: 0 or 1, and set by any nonzero `wParam` (seg26 `0e32`,
   * `0e3e`). */
  if (kind === 'EDIT' && (message === EM_GETMODIFY || message === EM_SETMODIFY)) {
    const edit = editState(control);

    if (message === EM_GETMODIFY) {
      return edit.modified ? 1 : 0;
    }

    edit.modified = wParam !== 0;
    return 0;
  }

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

      if (kind === 'LISTBOX' || kind === 'COMBOLBOX') {
        window.window.needsErase = false;
        window.window.needsPaint = false;
        await paintList(control, listHost(system, window));
      } else if (kind === 'COMBOBOX') {
        window.window.needsErase = false;
        window.window.needsPaint = false;
        await paintComboBox(system, window);
      } else {
        window.desktop.paintControl(window.window);
      }

      if (hidden) {
        ShowCaret.call(system, hwnd);
      }

      (window.window as any).paintClip = undefined;
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
        /* New text is not a change (seg29 `00c0`, seg31 `00b6`). */
        editState(control).modified = false;

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

  /* A press on a scroll bar control, once or twice alike: the focus, if it
   * takes it, then the press followed (`USER.EXE` seg18 `0b63`). */
  if (kind === 'SCROLLBAR' && (message === User.WM_LBUTTONDOWN || message === User.WM_LBUTTONDBLCLK)) {
    if (window.window.style & User.WS_TABSTOP) {
      await setFocus(system, hwnd);
    }

    const origin = window.clientOrigin;

    await trackScrollBar(system, hwnd, 0, origin.x + ((lParam << 16) >> 16), origin.y + (lParam >> 16));
    return 0;
  }

  /* A scroll bar control's arrows go with its being enabled (`USER.EXE` seg18 `0a67`). */
  if (kind === 'SCROLLBAR' && message === User.WM_ENABLE) {
    enableScrollControl(system, hwnd, wParam !== 0);
    return 0;
  }

  if (kind === 'LISTBOX' || kind === 'COMBOLBOX') {
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
const EM_GETMODIFY = 0x0408;
const EM_SETMODIFY = 0x0409;

/** The messages whose `lParam` is a string for a list box that keeps strings. */
const LIST_STRINGS = new Set([LB.ADDSTRING, LB.INSERTSTRING, LB.FINDSTRING, LB.FINDSTRINGEXACT, LB.SELECTSTRING]);

async function listboxMessage(system: any, window: RasterWindow, control: ControlState, message: number, wParam: number, lParam: any) {
  const strings = !(control.style & (LBS_OWNERDRAWFIXED | LBS_OWNERDRAWVARIABLE)) || control.style & LBS_HASSTRINGS;

  /* A directory's entries, or one file's, added as `LB_ADDSTRING` adds, and
   * the drives appended as `LB_INSERTSTRING` at -1 appends (`dlgdir.ts`). */
  if (message === LB_DIR || message === LB_ADDFILE) {
    const host = listHost(system, window);
    const add = async (text: string, append: boolean) => {
      const index = await listMessage(system, control, host, append ? LB.INSERTSTRING : LB.ADDSTRING, append ? 0xffff : 0, text);

      return ((index & 0xffff) << 16) >> 16;
    };
    const spec = stringAt(system, lParam);
    const answer = message === LB_DIR ? await fillDirectory(system, wParam, spec, add) : await addFile(system, spec, add);

    if ((control as any).invalid) {
      (control as any).invalid = false;
      window.window.needsErase = true;
      window.window.needsPaint = true;
    }

    if (message === LB_ADDFILE || answer === -2) {
      return answer & 0xffff;
    }

    return (control.items.length - 1) & 0xffff;
  }

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

  return widened(message, answer, LB.GETITEMDATA);
}

/**
 * A list box's or a combo box's answer as the long `SendMessage` answers:
 * the word it works in, widened with its sign, so that `LB_ERR` is -1 in all
 * 32 bits -- but for item data, which is 32 bits of its own. **Recorded** by
 * `lberr`: every failure answers FFFFFFFFh. File Manager walks a list with
 * `LB_GETTEXT` until it does.
 */
function widened(message: number, answer: any, ...whole: number[]) {
  if (typeof answer !== 'number' || whole.includes(message) || message < 0x400 || message > 0x42f) {
    return answer;
  }

  return ((answer & 0xffff) << 16) >> 16;
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
    visible: () => shown.visible,
    drawText: (index, top, fill, rows) => {
      const list = listState(control);
      const selected = (control.style & (LBS_MULTIPLESEL | LBS_EXTENDEDSEL)) ? !!list.selected[index] : list.sel === index;
      const whole = !!(control.style & (LBS_MULTIPLESEL | LBS_EXTENDEDSEL));

      /* A redraw of one item, as its selection changes, fills its whole row
       * first (`USER.EXE` seg35 `1096`); painting leaves that to the erase. */
      desktop.listText(shown, index, index - top, selected, whole || fill, rows);
    },
    scroll: (dy, from, to) => desktop.scrollClient(shown, dy, from, to),
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
    notify: async (code: number) => {
      await sendParent(system, window, User.WM_COMMAND, shown.controlId, ((hwnd & 0xffff) | (code << 16)) >>> 0);
    },
    keyboardChange: () => {
      const combo = (control as any).comboHwnd;
      const state = combo ? system.handles.resolve(combo)?.window?.control?.combo : null;

      if (state?.dropped) {
        state.keyboard = true;
      }
    },
    scrollBar: (visible, position) => {
      const has = (shown.style & 0x00200000) !== 0;

      /* Kept, with its arrows turned off when there is nothing to scroll
       * (`USER.EXE` seg43 `0088`). */
      if (control.style & LBS_DISABLENOSCROLL) {
        const state = scrollState(shown, 1)!;
        const flags = visible ? 0 : 3;

        if (state.flags !== flags) {
          state.flags = flags;
          desktop.paintFrame(shown);
        }

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

/**
 * A list box made a whole number of rows high (`USER.EXE` seg38 `0457`),
 * unless `LBS_NOINTEGRALHEIGHT`: when its inside, less a border each way, is
 * not a whole number of rows, it is made as many rows as its whole height
 * holds, and the borders -- which is a row more than its inside held when
 * the remainder is more than two borders' worth. A combo box's simple list
 * shows it: 65 pixels become 66.
 */
function integralHeight(window: RasterWindow) {
  const shown = window.window;
  const control = shown.control!;
  const list = listState(control);
  const border = 1;

  if (control.style & (LBS_NOINTEGRALHEIGHT | LBS_OWNERDRAWVARIABLE)) {
    return;
  }

  if ((shown.height - 2 * border) % list.height) {
    window.desktop.place(shown, shown.left, shown.top, shown.width, Math.trunc(shown.height / list.height) * list.height + 2 * border);
  }
}

/** A message to a control's parent, answered as its procedure answers. */
async function sendParent(system: any, window: RasterWindow, message: number, wParam: number, lParam: number) {
  /* A combo box's list tells its combo box, wherever the list lies. */
  const combo = (window.window.control as any)?.comboHwnd;

  if (combo) {
    return await SendMessage.call(system, combo, message, wParam, lParam);
  }

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

  const made = window instanceof RasterWindow ? window.window.control?.className : null;

  if (!(window instanceof RasterWindow) || (made !== 'LISTBOX' && made !== 'COMBOLBOX')) {
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

  integralHeight(window);

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
    case 'COMBOLBOX':
    case 'COMBOBOX':
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

/* ---- The combo box: see `combobox.ts`. ---- */

const WM_MEASUREITEM = 0x002c;
const WM_DRAWITEM = 0x002b;
const WM_DELETEITEM = 0x002d;
const WM_COMPAREITEM = 0x0039;
const EM_GETSEL = 0x0400;
const EM_SETSEL = 0x0401;
const EM_LIMITTEXT = 0x0415;
const VK_F4 = 0x73;
const VK_UP = 0x26;
const VK_DOWN = 0x28;

function comboOf(window: RasterWindow): ComboState {
  return (window.window.control as any).combo;
}

/** The combo box's list and field, as windows. */
function comboParts(system: any, window: RasterWindow) {
  const combo = comboOf(window);

  return {
    list: system.handles.resolve(combo.listBox) as RasterWindow | undefined,
    edit: combo.edit ? (system.handles.resolve(combo.edit) as RasterWindow | undefined) : undefined,
  };
}

/** A combo box's parent told, with `WM_COMMAND`, as its list and edit tell it. */
async function comboNotify(system: any, window: RasterWindow, code: number) {
  const hwnd = window.window.hwnd;

  await sendParent(system, window, User.WM_COMMAND, window.window.controlId, ((hwnd & 0xffff) | (code << 16)) >>> 0);
}

/**
 * A combo box made (`USER.EXE` seg34 `0000`, `005b`, `02ac`): its style with
 * `CBS_HASSTRINGS` unless owner-drawn and without a border or scroll bars of
 * its own; the field's height, asked of an owner-drawn one's parent; its
 * list, and an edit control but for a drop-down list; and a list that drops
 * down taken from it to lie on the desktop, put away, and the combo box made
 * as high as its field.
 */
export async function initCombo(system: any, hwnd: number) {
  const window = system.handles.resolve(hwnd);

  if (!(window instanceof RasterWindow) || window.window.control?.className !== 'COMBOBOX') {
    return;
  }

  const { CreateWindow } = await import('./CreateWindow.js');
  const { GetSystemMetrics } = await import('./GetSystemMetrics.js');
  const { GetDialogBaseUnits } = await import('./dialogs.js');
  const shown = window.window;
  const control = shown.control!;
  const original = control.style;
  const ownerDraw = (original & (CBS_OWNERDRAWFIXED | CBS_OWNERDRAWVARIABLE)) !== 0;

  control.hwnd = hwnd;

  if (!ownerDraw) {
    control.style |= CBS_HASSTRINGS;
  }

  shown.style &= ~(0x00800000 | 0x00200000 | 0x00100000);
  window.desktop.place(shown, shown.left, shown.top, shown.width, shown.height);

  const type = original & 3 || CBS_SIMPLE;
  const height = control.font ? control.font.metrics.height : window.desktop.environment.font.height;
  const systemHeight = window.desktop.environment.font.height;
  let fieldHeight = height + Math.trunc(Math.min(height, systemHeight) / 4) + 4;

  /* An owner-drawn field's height is its parent's to say, six pixels less; the
   * item number is left as it is found, and the width. */
  if (ownerDraw) {
    const core = system.machine.cpu.core;
    const far = ownerBlock(system);
    const segment = (far >>> 16) & 0xffff;
    const offset = far & 0xffff;

    [3, shown.controlId, 0xffff, 0, fieldHeight - 6, 0, 0].forEach((value, at) =>
      core.write16(segment, offset + at * 2, value)
    );
    await sendParent(system, window, WM_MEASUREITEM, shown.controlId, far);
    fieldHeight = core.read16(segment, offset + 8) + 6;
  }

  const metrics = {
    cxVScroll: GetSystemMetrics.call(system, 2),
    cxSysChar: GetDialogBaseUnits.call(system) & 0xffff,
    border: 1,
  };
  const parts = layout(type, shown.width, shown.height, fieldHeight, metrics);
  const combo: ComboState = {
    type,
    ownerDraw,
    fieldHeight,
    field: parts.field,
    button: parts.button,
    list: parts.list,
    edit: 0,
    listBox: 0,
    focused: false,
    dropped: false,
    tracking: false,
    pressed: false,
    keyboard: false,
    height: shown.height,
  };

  (control as any).combo = combo;
  (control as any).cxSysChar = metrics.cxSysChar;


  const [ll, lt, lr, lb] = parts.list;

  combo.listBox = await CreateWindow.call(system, 'ComboLBox', '', listStyle(original), ll + 1, lt + 1, lr - ll - 2, lb - lt - 2, hwnd, LIST_ID, 0, 0);

  const list = system.handles.resolve(combo.listBox) as RasterWindow;

  (list.window.control as any).comboHwnd = hwnd;

  if (type !== CBS_DROPDOWNLIST) {
    const [fl, ft, fr, fb] = parts.field;

    combo.edit = await CreateWindow.call(system, 'Edit', '', editStyle(original), fl, ft, fr - fl, fb - ft, hwnd, EDIT_ID, 0, 0);

    const edit = system.handles.resolve(combo.edit) as RasterWindow;

    (edit.window.control as any).comboHwnd = hwnd;
  } else {
    combo.edit = 0;
  }

  if (type === CBS_SIMPLE) {
    /* Always shown: moved to its place, a pixel short, and made whole rows. */
    combo.dropped = true;
    list.desktop.place(list.window, shown.left + ll, shown.top + lt, lr - ll, lb - lt - 1);
    integralHeight(list);
    return;
  }

  list.desktop.hide(list.window);
  list.desktop.detach(list.window);
  window.desktop.place(shown, shown.left, shown.top, shown.width, fieldHeight);
}

/** The selection's text, or nothing. */
async function selectedText(system: any, window: RasterWindow) {
  const combo = comboOf(window);
  const list = system.handles.resolve(combo.listBox) as RasterWindow;
  const control = list.window.control!;
  const at = listState(control).sel;

  return at >= 0 && at < control.items.length ? String(control.items[at]) : null;
}

/** The field brought up to the selection: its text into the edit control, or the field painted. */
async function refreshField(system: any, window: RasterWindow) {
  const combo = comboOf(window);

  if (combo.type === CBS_DROPDOWNLIST) {
    window.window.needsPaint = true;
    return;
  }

  const text = (await selectedText(system, window)) ?? '';

  (combo as any).setting = true;
  await SendMessage.call(system, combo.edit, User.WM_SETTEXT, 0, text);
  (combo as any).setting = false;
}

/**
 * The list dropped down (seg33 `0c36`): the parent told `CBN_DROPDOWN`; a
 * drop-down list's list scrolled to its selection; the list put a border
 * above the field's bottom, under the field -- a drop-down's the System
 * font's average width in -- or above it where there is no room below, and
 * shown on top without taking the focus.
 */
async function dropDown(system: any, window: RasterWindow) {
  const combo = comboOf(window);
  const { list } = comboParts(system, window);

  if (!list || combo.dropped) {
    return;
  }

  await comboNotify(system, window, CBN_DROPDOWN);
  combo.dropped = true;

  const control = list.window.control!;

  if (combo.type === CBS_DROPDOWNLIST) {
    await SendMessage.call(system, combo.listBox, 0x418, Math.max(listState(control).sel, 0), 0);
    await SendMessage.call(system, combo.listBox, 0x0424, 0, 0);
  }

  const field = combo.edit ? (system.handles.resolve(combo.edit) as RasterWindow).window : window.window;
  const bottom = field.top + field.height;
  const height = list.window.height;
  const x = field.left + (combo.type === CBS_DROPDOWNLIST ? 0 : (window.window.control as any).cxSysChar);
  const screen = window.desktop.screen.height;
  const y = bottom - 1 + height <= screen ? bottom - 1 : Math.max(0, field.top + 1 - height);

  window.desktop.place(list.window, x, y, list.window.width, height);
  window.window.needsPaint = true;
  await paintComboBox(system, window);
  window.desktop.showOnTop(list.window);
}

/**
 * The list put away (seg33 `0b3c`): hidden, the combo box painted again,
 * and the parent told `CBN_CLOSEUP` when it was dropped and told is asked
 * for. A simple combo box's list stays.
 */
async function closeUp(system: any, window: RasterWindow, notify: boolean) {
  const combo = comboOf(window);
  const { list } = comboParts(system, window);

  if (combo.type === CBS_SIMPLE || !list) {
    return;
  }

  const was = combo.dropped;

  if (was) {
    combo.dropped = false;
    list.desktop.hide(list.window);
  }

  window.window.needsPaint = true;
  await paintComboBox(system, window);

  if (notify && was) {
    await comboNotify(system, window, CBN_CLOSEUP);
  }
}

/** The focus arriving (seg33 `115d`). */
async function comboGainFocus(system: any, window: RasterWindow) {
  const combo = comboOf(window);

  if (combo.focused) {
    return;
  }

  if (combo.edit) {
    await SendMessage.call(system, combo.edit, EM_SETSEL, 0, 0xffff0000);
  } else {
    await SendMessage.call(system, combo.listBox, 0x0424, 0, 0);
  }

  combo.focused = true;
  window.window.needsPaint = true;
  await paintComboBox(system, window);
  await comboNotify(system, window, CBN_SETFOCUS);
}

/** The focus leaving for a window not its own (seg33 `11b2`). */
async function comboLoseFocus(system: any, window: RasterWindow, to: number) {
  const combo = comboOf(window);
  const going = system.handles.resolve(to);

  if (!combo.focused) {
    return;
  }

  for (let other = going?.window ?? null; other; other = other.parent) {
    if (other === window.window) {
      return;
    }
  }

  await closeUp(system, window, true);

  if (combo.edit) {
    await SendMessage.call(system, combo.edit, EM_SETSEL, 0, 0);
  } else {
    await SendMessage.call(system, combo.listBox, 0x0425, 0, 0);
  }

  combo.focused = false;
  window.window.needsPaint = true;
  await paintComboBox(system, window);
  await comboNotify(system, window, CBN_KILLFOCUS);
}

/** Paints a combo box (seg33 `0875`), asking an owner to draw its field's item. */
async function paintComboBox(system: any, window: RasterWindow) {
  const combo = comboOf(window);

  if (!combo || !window.window.visible) {
    return;
  }

  window.window.needsPaint = false;

  const text = combo.ownerDraw ? null : await selectedText(system, window);
  const field = window.desktop.paintCombo(window.window, combo, combo.type === CBS_DROPDOWNLIST ? text ?? '' : null);


  if (!field) {
    return;
  }

  if (combo.ownerDraw) {
    const { list } = comboParts(system, window);
    const control = list!.window.control!;
    const state = listState(control);
    const index = state.sel;
    const core = system.machine.cpu.core;
    const far = ownerBlock(system) + 32;
    const segment = (far >>> 16) & 0xffff;
    const offset = far & 0xffff;
    const data = index >= 0 ? state.data[index] ?? 0 : 0xffffffff;
    const values = [
      3,
      window.window.controlId,
      index & 0xffff,
      1,
      field.highlighted ? 0x11 : 0,
      window.window.hwnd,
      itemDC(system, window),
      ...field.item,
    ];

    values.forEach((value, at) => core.write16(segment, offset + at * 2, value & 0xffff));
    core.write16(segment, offset + 22, data & 0xffff);
    core.write16(segment, offset + 24, (data >>> 16) & 0xffff);
    await sendParent(system, window, WM_DRAWITEM, window.window.controlId, far);
  }

  if (field.highlighted) {
    window.desktop.focusRectangle(window.window, field.rc[0], field.rc[1], field.rc[2], field.rc[3], 14, 13);
  }
}

/** A combo box's answer to a message, or `undefined` for one it leaves to the rest (seg33 `0029`). */
async function comboMessage(system: any, window: RasterWindow, control: ControlState, message: number, wParam: number, lParam: any) {
  const combo = comboOf(window);

  if (!combo) {
    return undefined;
  }

  const signed = (value: number) => ((value & 0xffff) << 16) >> 16;
  const list = combo.listBox;

  if (message in PASSED_TO_LIST) {
    return SendMessage.call(system, list, PASSED_TO_LIST[message], wParam, lParam);
  }

  switch (message) {
    case CB.SETCURSEL: {
      const answer = await SendMessage.call(system, list, 0x407, wParam, 0);

      if (signed(wParam) !== -1) {
        await SendMessage.call(system, list, 0x418, wParam, 0);
      }

      await refreshField(system, window);
      return answer;
    }

    case CB.SELECTSTRING: {
      const answer = await SendMessage.call(system, list, 0x40d, wParam, lParam);

      await refreshField(system, window);
      return answer;
    }

    case CB.RESETCONTENT:
      await SendMessage.call(system, list, 0x405, 0, 0);
      await refreshField(system, window);
      return 1;

    case CB.SHOWDROPDOWN:
      if (wParam) {
        await dropDown(system, window);
      } else if (combo.dropped) {
        await closeUp(system, window, true);
      }

      return 1;

    case CB.GETDROPPEDSTATE:
      return combo.dropped ? 1 : 0;

    case CB.GETEDITSEL:
      return combo.edit ? SendMessage.call(system, combo.edit, EM_GETSEL, wParam, lParam) : 0xffffffff;

    case CB.SETEDITSEL:
      return combo.edit ? (await SendMessage.call(system, combo.edit, EM_SETSEL, wParam, lParam), 1) : 0xffff;

    case CB.LIMITTEXT:
      return combo.edit ? SendMessage.call(system, combo.edit, EM_LIMITTEXT, wParam, lParam) : 0xffff;

    case CB.GETITEMHEIGHT:
      return signed(wParam) === -1 ? combo.fieldHeight : SendMessage.call(system, list, 0x422, wParam, 0);

    /* A drop-down list's text is its selection's, and cannot be set. */
    case User.WM_SETTEXT:
      if (!combo.edit) {
        return 0xffff;
      }

      (combo as any).setting = true;
      await SendMessage.call(system, combo.edit, User.WM_SETTEXT, wParam, lParam);
      (combo as any).setting = false;
      return 1;

    case User.WM_GETTEXT: {
      if (combo.edit) {
        return SendMessage.call(system, combo.edit, User.WM_GETTEXT, wParam, lParam);
      }

      return copyText(system, (await selectedText(system, window)) ?? '', lParam, wParam);
    }

    case User.WM_GETTEXTLENGTH:
      return combo.edit ? SendMessage.call(system, combo.edit, User.WM_GETTEXTLENGTH, 0, 0) : 0xffff;

    case User.WM_SETFOCUS:
      if (combo.edit) {
        await setFocus(system, combo.edit);
      } else {
        await comboGainFocus(system, window);
      }

      return 0;

    case User.WM_KILLFOCUS:
      await comboLoseFocus(system, window, wParam);
      return 0;

    /* The keys go to the list of a drop-down list and to the edit control of
     * the others; F4 drops the list down or puts it away. */
    case 0x0100:
    case 0x0102:
      if (message === 0x0100 && wParam === VK_F4 && combo.type !== CBS_SIMPLE) {
        if (combo.dropped) {
          await closeUp(system, window, true);
        } else {
          await dropDown(system, window);
        }

        return 0;
      }

      return SendMessage.call(system, combo.edit || list, message, wParam, lParam);

    /* Alt and an arrow do the same. */
    case 0x0104:
      if ((wParam === VK_UP || wParam === VK_DOWN) && combo.type !== CBS_SIMPLE) {
        if (combo.dropped) {
          await closeUp(system, window, true);
        } else {
          await dropDown(system, window);
        }

        return 0;
      }

      return undefined;

    case User.WM_COMMAND: {
      const code = (lParam >>> 16) & 0xffff;

      if ((wParam & 0xffff) === LIST_ID) {
        if (code === 1 || code === 3) {
          if (!combo.keyboard) {
            await closeUp(system, window, true);
          } else {
            combo.keyboard = false;
          }

          await comboNotify(system, window, CBN_SELCHANGE);
          await refreshField(system, window);
        } else if (code === 2) {
          await comboNotify(system, window, CBN_DBLCLK);
        }

        return 0;
      }

      if ((wParam & 0xffff) === EDIT_ID) {
        if (code === 0x100) {
          await comboGainFocus(system, window);
        } else if (code === 0x200) {
          await comboLoseFocus(system, window, system._focusGoing ?? system.rasterDesktop?.focus?.hwnd ?? 0);
        } else if (!(combo as any).setting && code === 0x300) {
          await comboNotify(system, window, CBN_EDITCHANGE);
        } else if (!(combo as any).setting && code === 0x400) {
          await comboNotify(system, window, CBN_EDITUPDATE);
        }

        return 0;
      }

      return 0;
    }

    /* The list's owner-draw messages, passed to the parent as the combo box's. */
    case WM_MEASUREITEM:
    case WM_DRAWITEM:
    case WM_DELETEITEM:
    case WM_COMPAREITEM: {
      const core = system.machine.cpu.core;
      const segment = (lParam >>> 16) & 0xffff;
      const offset = lParam & 0xffff;

      core.write16(segment, offset, 3);
      core.write16(segment, offset + 2, window.window.controlId);

      if (message === WM_DRAWITEM) {
        core.write16(segment, offset + 10, window.window.hwnd);
      }

      return sendParent(system, window, message, window.window.controlId, lParam);
    }

    case 0x0201:
    case 0x0203: {
      if (!combo.focused) {
        await setFocus(system, window.window.hwnd);
      }

      const x = signed(lParam);
      const inButton = !!combo.button && x >= combo.button[0];

      if (combo.type === CBS_DROPDOWNLIST || inButton) {
        combo.pressed = true;

        if (combo.dropped) {
          await closeUp(system, window, true);
          combo.pressed = false;
        } else {
          combo.tracking = true;
          await dropDown(system, window);
        }
      }

      return 0;
    }

    case 0x0202:
      combo.tracking = false;
      combo.pressed = false;
      window.window.needsPaint = true;
      return 0;
  }

  return undefined;
}
