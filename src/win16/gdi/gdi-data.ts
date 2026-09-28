'use strict';

import { GlobalAlloc } from '../kernel/GlobalAlloc.js';
import { GlobalLock } from '../kernel/GlobalLock.js';

/**
 * A selector standing for GDI's own data segment. GDI calls some of a
 * program's procedures with it in DS -- and in AX, for `EnumObjects` -- not
 * the program's (`enumregs`). winbox.js's GDI keeps its data in its own
 * code, so this is a block of its own, made the first time it is needed,
 * that holds nothing a program should read.
 */
export function gdiDataSelector(system: any): number {
  if (!system._gdiData) {
    system._gdiData = GlobalLock.call(system, GlobalAlloc.call(system, 0x42, 16)) >>> 16;
  }

  return system._gdiData;
}
