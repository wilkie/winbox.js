'use strict';

import { TRUE, FALSE } from '../consts.js';
import { DWORD, UINT } from '../types.js';
import { deleteDriverDC } from './printer-driver.js';

/**
 * The **DeleteDC** function deletes the given device context.
 *
 * If the `hdc` parameter identifies the last device context for a given
 * device, the device is notified and all storage and system resources used by
 * the device are released.
 *
 * An application must not delete a device context whose handle was retrieved
 * by calling the {@link User.GetDC GetDC} function. Instead, the application
 * must call the {@link User.ReleaseDC ReleaseDC} function to free the device
 * context.
 *
 * An application should not call **DeleteDC** if the application has selected
 * objects into the device context. Objects must be selected out of the device
 * context before it is deleted.
 *
 * **See also**:
 * {@link Gdi.CreateDC CreateDC}
 * {@link User.GetDC GetDC}
 * {@link User.ReleaseDC ReleaseDC}
 *
 * @static
 * @function DeleteDC
 * @memberof Gdi
 *
 * @param {Types.HDC} hdc - Identifies the device context.
 *
 * @return {Types.BOOL} The return value is nonzero if the function is
 *                      successful. Otherwise, it is zero.
 */
export function DeleteDC(hdc) {
  const surface = this.handles.resolve(hdc);
  if (!surface) {
    return FALSE;
  }

  /* A program's hook is asked first, with `DCHC_DELETEDC`, its flag set or
   * not; answering nought keeps the context (`GDI.EXE` seg1 `0844`-`0866`;
   * `dchkdel`). USER's own answers 1 (`USER.EXE` seg1 `8a0a`-`8a10`). */
  const hook = surface.dcHook;

  /* A hook set to nought, as `SetDCHook` of NULL leaves it (`dchook` ends
   * so), is not called. */
  if (hook && !hook.user && hook.proc) {
    return this.scheduler
      .callProc(
        hook.proc,
        [
          [hdc & 0xffff, UINT],
          [DCHC_DELETEDC, UINT],
          [hook.data >>> 0, DWORD],
          [0, DWORD],
        ],
        this.scheduler.stackRegisters()
      )
      .then((answer: number) => ((answer & 0xffff) === 0 ? FALSE : deleted(this, hdc, surface)));
  }

  return deleted(this, hdc, surface);
}

const DCHC_DELETEDC = 2;

/** The context deleted, its hook having let it go. */
function deleted(system: any, hdc: number, surface: any) {
  system.handles.free(hdc);

  /* A printer driver's from the drive: its `Disable` and its library let
   * go with the last (`printer-driver.ts`). */
  if (surface.driverDevice) {
    return deleteDriverDC(system, surface).then(() => TRUE);
  }

  /* A memory context made compatible with one: its drawing block let go;
   * what was realized for it stays with the device. */
  if (surface.compatibleDevice) {
    return import('./printer-output.js').then(({ stopDrawing }) => {
      stopDrawing(system, surface);
      return TRUE;
    });
  }

  return TRUE;
}
