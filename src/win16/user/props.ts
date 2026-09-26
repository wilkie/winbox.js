'use strict';

import { stringAt } from './control-classes.js';

/**
 * A window's properties: handles kept under names, which a program -- or a
 * library such as `COMMDLG.DLL`, which keeps each of its dialogs' data this
 * way -- sets, reads and takes away again.
 *
 * A name is a string, compared without regard to case, or an atom, given
 * with nought in the pointer's upper word. Not measured: whether a string and
 * the atom Windows makes of it find the same property, which they do on
 * Windows by the documentation and do not here.
 */

function propsOf(system: any, hwnd: number): Map<string, number> | null {
  const window = system.handles.resolve(hwnd);

  if (!window) {
    return null;
  }

  window.props ??= new Map();

  return window.props;
}

function keyOf(system: any, lpsz: number) {
  const far = lpsz >>> 0;

  return far >>> 16 ? `name:${stringAt(system, far).toUpperCase()}` : `atom:${far & 0xffff}`;
}

/** Keeps a handle under a name; whether it was kept. */
export function SetProp(hwnd, lpsz, hData) {
  const props = propsOf(this, hwnd);

  if (!props) {
    return 0;
  }

  props.set(keyOf(this, lpsz), hData & 0xffff);

  return 1;
}

/** The handle kept under a name, or nought. */
export function GetProp(hwnd, lpsz) {
  return propsOf(this, hwnd)?.get(keyOf(this, lpsz)) ?? 0;
}

/** Takes a property away, answering the handle it kept. */
export function RemoveProp(hwnd, lpsz) {
  const props = propsOf(this, hwnd);
  const key = keyOf(this, lpsz);
  const value = props?.get(key) ?? 0;

  props?.delete(key);

  return value;
}
