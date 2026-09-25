'use strict';

import { User, WNDCLASS } from '../user.js';

import {
  BM_GETCHECK,
  BM_SETCHECK,
  CONTROL_CLASSES,
  LB_ADDSTRING,
  LB_GETCOUNT,
  type ControlState,
} from './controls.js';
import { DefWindowProc } from './DefWindowProc.js';
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

  switch (message) {
    case User.WM_PAINT:
      window.desktop.paintControl(window.window);
      return 0;

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
    switch (message) {
      case LB_ADDSTRING:
        control.items.push(stringAt(system, lParam));
        invalidate();
        return control.items.length - 1;

      case LB_GETCOUNT:
        return control.items.length;
    }
  }

  return DefWindowProc.call(system, hwnd, message, wParam, lParam);
}

const WM_GETDLGCODE = 0x0087;

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
