'use strict';

import { Surface } from '../../raster/surface.js';
import { DWORD, HDC, UINT } from '../types.js';

/**
 * GDI calls a device context's hook before a call uses the context, where
 * the flag `SetHookFlags` sets is set (`GDI.EXE` seg1 `4423`, `43f3`: the
 * flag is bit 2 of the context's byte at 0Ah): the context,
 * `DCHC_INVALIDVISRGN` (1), the hook's data and nought. **Recorded** by
 * `dchook`: `GetClipBox`, `GetTextColor` and `Rectangle` each call it once,
 * and again while the flag stays set; none while it is clear or the hook is
 * none. USER's own hook, on the contexts it lends, clears the flag and works
 * the region out again (`dc-entries.ts`): WinBox runs it itself. A
 * program's is called through the processor.
 *
 * Which calls call it: the calls of GDI that take a context and use its
 * state -- the drawing calls, the questions of the context
 * (`GetDCOrg`, `GetTextColor` and the others read through seg1 `5130`-
 * `5193`), `SelectObject` (seg1 `1b32`), the visible-region family,
 * `SetDCOrg`, `SetDCState` (`067f`) [[read out]] at each; the others
 * [[inferred]] from these -- and the calls of USER that take one, which
 * draw through GDI's. Read out as not calling it, the calls that set one
 * attribute and do no more: `SetBkColor` and `SetTextColor` (seg1 `1476`,
 * `14dc`, into `1526`), and `SetBkMode`, `SetROP2`, `SetPolyFillMode`,
 * `SetStretchBltMode`, `SetTextAlign` and `SetRelAbs` (`4e22`-`4ed8`, into
 * `51a6`); and the hook's own calls. `DeleteDC` calls it with
 * `DCHC_DELETEDC` (2), which is not followed.
 */
const UNHOOKED = new Set([
  'SetBkColor',
  'SetTextColor',
  'SetBkMode',
  'SetROP2',
  'SetPolyFillMode',
  'SetStretchBltMode',
  'SetTextAlign',
  'SetRelAbs',
  'SetDCHook',
  'GetDCHook',
  'SetHookFlags',
  'DeleteDC',
  'DCHook',
]);

/**
 * The hook called before a call, if the call is one that calls it and its
 * context's flag is set: USER's at once; a program's as a promise to wait
 * for before the call is made. Null where there is nothing to wait for.
 */
export function hookBefore(
  system: any,
  module: string,
  definition: any[],
  name: string,
  args: any[]
): Promise<unknown> | null {
  if ((module !== 'GDI' && module !== 'USER') || (definition?.[3] ?? [])[0] !== HDC) {
    return null;
  }

  if (UNHOOKED.has(name)) {
    return null;
  }

  return callHook(system, args[0]);
}

/** A context's hook called where its flag is set: USER's now, a program's as a promise. */
export function callHook(system: any, hdc: number): Promise<unknown> | null {
  const surface = hdc ? system.handles.resolve(hdc) : null;

  if (!(surface instanceof Surface) || !surface.dcHookFlag || !surface.dcHook) {
    return null;
  }

  if (surface.dcHook.user) {
    surface.refreshVis();
    return null;
  }

  const { proc, data } = surface.dcHook;

  return system.scheduler.callProc(
    proc,
    [
      [hdc & 0xffff, UINT],
      [1, UINT],
      [data >>> 0, DWORD],
      [0, DWORD],
    ],
    system.scheduler.stackRegisters()
  );
}
