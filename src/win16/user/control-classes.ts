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
function stringAt(system: any, value: any) {
  if (typeof value === 'string' || value instanceof String) {
    return String(value);
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
