'use strict';

import { NULL } from '../consts.js';
import { topLevel } from './enumerate.js';
import { SYSTEM_NAMES } from './GetWindow.js';
import { lstrcmpi } from './lstrcmpi.js';

/**
 * The **FindWindow** function retrieves the handle of the window whose class
 * name and window name match the specified strings. This function does not
 * search child windows.
 *
 * @static
 * @function FindWindow
 * @memberof User
 *
 * @param {Types.LPCSTR} lpszClassName - Points to a null-terminated string that
 *                                       contains the window's class name. If
 *                                       this parameter is `NULL` all class
 *                                       names match.
 * @param {Types.LPCSTR} lpszWindow - Points to a null-terminated string string
 *                                    that specifies the window name (the
 *                                    window's title). If this parameter is
 *                                    `NULL`, all window names match.
 *
 * @returns {Types.HWND} The return value is the handle of the window that
 *                       has the specified class name and window name if the
 *                       function is successful. Otherwise, it is `NULL`.
 */
export function FindWindow(this: any, lpszClassName: any, lpszWindow: any) {
  /* **Read out of `USER.EXE`** (seg6 `0000`): the windows at the top, front
   * to back, the first whose class is the one named -- by its atom, so in
   * any case -- and whose text is the one named, compared as `lstrcmpi`
   * compares; either left out matches any. */
  const className = lpszClassName === null || lpszClassName === undefined ? null : lpszClassName;
  const title = lpszWindow === null || lpszWindow === undefined ? null : String(lpszWindow);
  const classAtom = typeof className === 'number' ? className : null;
  const wantedClass =
    classAtom === null && className !== null ? String(className).toUpperCase() : null;

  for (const window of topLevel(this)) {
    const own = String(window.options?.windowClass ?? '');
    const shown = (SYSTEM_NAMES[own.toUpperCase()] ?? own).toUpperCase();

    if (wantedClass !== null && shown !== wantedClass) {
      continue;
    }

    if (classAtom !== null && shown !== `#${classAtom}`) {
      continue;
    }

    if (title !== null && lstrcmpi.call(this, String(window.window.title ?? ''), title) !== 0) {
      continue;
    }

    return window.window.hwnd;
  }

  return NULL;
}
