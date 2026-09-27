'use strict';

import { copyText } from './control-classes.js';
import { RasterWindow } from './raster-window.js';

const GW_HWNDFIRST = 0;
const GW_HWNDLAST = 1;
const GW_HWNDNEXT = 2;
const GW_HWNDPREV = 3;
const GW_OWNER = 4;
const GW_CHILD = 5;

/** A window's siblings, itself among them, in the order they lie, the top first. */
function siblings(window: RasterWindow) {
  const desktop = window.desktop;

  return desktop.windows.filter(
    (other: any) => other.parent === window.window.parent && other.hwnd && !other.titleOf
  );
}

/**
 * A window related to another: the first or last of its siblings, the one
 * after or before it, its owner, or its first child -- the siblings in the
 * order they lie, the top one first, as a dialog's controls are in the order
 * they were made.
 *
 * @param {Types.HWND} hwnd - The window.
 * @param {Types.UINT} fuRel - Which: `GW_HWNDFIRST` 0 to `GW_CHILD` 5.
 *
 * @returns {Types.HWND} That window, or `NULL`.
 */
export function GetWindow(hwnd, fuRel) {
  /* The desktop's first child is the top window of the screen. */
  if (fuRel === GW_CHILD && hwnd && hwnd === this.desktopWindow) {
    return GetTopWindow.call(this, 0);
  }

  const window = this.handles.resolve(hwnd);

  if (!(window instanceof RasterWindow)) {
    return 0;
  }

  if (fuRel === GW_CHILD) {
    const child = window.desktop.windows.find(
      (other: any) => other.parent === window.window && other.hwnd && !other.titleOf
    );

    return child?.hwnd ?? 0;
  }

  if (fuRel === GW_OWNER) {
    return window.window.owner?.hwnd ?? 0;
  }

  const list = siblings(window);
  const at = list.indexOf(window.window);

  switch (fuRel) {
    case GW_HWNDFIRST:
      return list[0]?.hwnd ?? 0;
    case GW_HWNDLAST:
      return list[list.length - 1]?.hwnd ?? 0;
    case GW_HWNDNEXT:
      return list[at + 1]?.hwnd ?? 0;
    case GW_HWNDPREV:
      return at > 0 ? list[at - 1].hwnd : 0;
  }

  return 0;
}

/** The window after or before one, as `GetWindow` with `GW_HWNDNEXT` or `GW_HWNDPREV`. */
export function GetNextWindow(hwnd, wFlag) {
  return GetWindow.call(this, hwnd, wFlag === GW_HWNDPREV ? GW_HWNDPREV : GW_HWNDNEXT);
}

/** The names USER registers its own classes under. */
export const SYSTEM_NAMES: Record<string, string> = {
  BUTTON: 'Button',
  STATIC: 'Static',
  EDIT: 'Edit',
  LISTBOX: 'ListBox',
  SCROLLBAR: 'ScrollBar',
  COMBOBOX: 'ComboBox',
  COMBOLBOX: 'ComboLBox',
};

/**
 * A window's class's name, copied into a program's buffer as much as fits;
 * answers how many characters were copied. USER's own classes have their own
 * spelling: `Edit`, `ComboLBox`, as `combobox` records.
 */
export function GetClassName(hwnd, lpClassName, cchClassName) {
  const window = this.handles.resolve(hwnd);
  const name = String(window?.options?.windowClass ?? '');
  const shown = SYSTEM_NAMES[name.toUpperCase()] ?? name;

  return copyText(this, shown, lpClassName, cchClassName);
}

/**
 * The child at the top of a window's children, as `GetWindow` with
 * `GW_CHILD` finds it; with no window, the top window of the screen
 * (documented).
 */
export function GetTopWindow(this: any, hwnd: number) {
  if (!(hwnd & 0xffff)) {
    const desktop = this.rasterDesktop;
    const top = desktop?.windows.find((other: any) => !other.parent && other.hwnd && !other.titleOf);

    return top?.hwnd ?? 0;
  }

  return GetWindow.call(this, hwnd, GW_CHILD);
}
