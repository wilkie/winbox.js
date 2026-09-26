'use strict';

import { GetFreeSpace } from './GetFreeSpace.js';

/**
 * What a program is told of memory it could have. **Recorded** by the
 * `freemem` probe, under DOSBox: `GlobalCompact` answers the largest block
 * there could be, a little less than `GetFreeSpace` -- 14,480K of 15,086K.
 * The numbers are the machine's; here there is no limit, and the largest
 * block is all of the free space. Write asks, and answering nought -- no
 * memory at all -- made it say it had not enough.
 */
export function GlobalCompact(this: any, _dwMinFree: number) {
  return GetFreeSpace.call(this, 0);
}

/**
 * How many handles a local heap makes room for at a time: 32 until it is
 * set, and nought asks without setting. Recorded by `freemem`. Kept for the
 * data segment the program is running with.
 */
export function LocalHandleDelta(this: any, wDelta: number) {
  const ds = this.machine.cpu.core.ds & 0xffff;

  this._handleDeltas ??= new Map<number, number>();

  if (wDelta & 0xffff) {
    this._handleDeltas.set(ds, wDelta & 0xffff);
  }

  return this._handleDeltas.get(ds) ?? 32;
}
