'use strict';

import { segmentSelector } from '../selectors.js';

/**
 * Bytes of another instance's data copied into the caller's, from and to
 * the same offset (`KRNL386.EXE` seg2 `08a9`-`08d6`): the instance's data
 * segment, as `GlobalHandle` finds it from the handle, is read at `pData`,
 * and the caller's DS written there. It answers the count; nought for a
 * handle of no segment. **Recorded** by `locinfo`, a second instance asking
 * of the first.
 *
 * WinBox finds a program's or a library's data segment from its instance;
 * a module it keeps has none here, and answers nought.
 *
 * @param {Types.HINSTANCE} hInstance - The instance.
 * @param {Types.NEARPTR} pData - The offset, in both.
 * @param {Types.INT} cbData - How many bytes.
 *
 * @returns {Types.INT} The count, or nought.
 */
export function GetInstanceData(this: any, hInstance: number, pData: number, cbData: number) {
  const loader = this.handles.resolve(hInstance & 0xffff)?.loader;
  const index = loader?.translate?.(loader.ds);

  if (!index) {
    return 0;
  }

  const core = this.machine.cpu.core;
  const from = segmentSelector(index);
  const count = cbData & 0xffff;

  for (let i = 0; i < count; i++) {
    const at = (pData + i) & 0xffff;

    core.write8(core.ds, at, core.read8(from, at));
  }

  return count;
}
