'use strict';

import { RasterWindow } from './raster-window.js';

/**
 * A class the program registered let go. **Recorded** by `unregcls`:
 *
 * * The program's own class goes, and the answer is 1; `GetClassInfo` finds
 *   it no more. Its name is matched in any case.
 * * A class that is not there, one already gone, one of another instance
 *   and USER's own `BUTTON` answer nought and stay as they are.
 * * While a window of the class is left, the answer is nought; once it is
 *   destroyed, the class goes.
 *
 * @param {Types.LPCSTR} lpszClassName - The class's name.
 * @param {Types.HINSTANCE} hinst - The instance that registered it.
 *
 * @returns {Types.BOOL} Whether it went.
 */
export function UnregisterClass(this: any, lpszClassName: any, hinst: number) {
  if (typeof lpszClassName !== 'string' && !(lpszClassName instanceof String)) {
    return 0;
  }

  const name = String(lpszClassName).toUpperCase();
  const handle = this.handles._names?.[name];
  const windowClass = handle ? this.handles.resolve(handle) : null;

  if (!windowClass?.hInstance || (windowClass.hInstance & 0xffff) !== (hinst & 0xffff)) {
    return 0;
  }

  const inUse = Object.values(this.handles._handles ?? {}).some(
    (entry: any) =>
      entry?.instance instanceof RasterWindow &&
      String(entry.instance.options?.windowClass ?? '').toUpperCase() === name
  );

  if (inUse) {
    return 0;
  }

  this.handles.free(handle);

  return 1;
}

/**
 * Whether input waits in the system's queue: nought where there is none,
 * as `unregcls` records it, a posted `WM_KEYDOWN` being a posted message and
 * not input. winbox.js takes input to its program straight away, so none
 * waits.
 *
 * @returns {Types.BOOL} Nought.
 */
export function GetInputState() {
  return 0;
}
