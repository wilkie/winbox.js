'use strict';

import { segmentSelector } from '../selectors.js';

/**
 * The far address of an export of `COMMDLG`'s that WinBox answers, for its
 * own code to hand out without importing the export table: the module
 * registers itself here as it is read (`index.ts`). See `procAddress`.
 */
let registered: { module: any; ours: (ordinal: number) => boolean } | null = null;

export function registerCommDlg(module: any, ours: (ordinal: number) => boolean) {
  registered = { module, ours };
}

export function procAddressOf(system: any, ordinal: number): number {
  if (!registered || !registered.ours(ordinal)) {
    return 0;
  }

  const info = system._modules.load(registered.module).lookup(ordinal);

  return ((segmentSelector(info.segment) << 16) | info.offset) >>> 0;
}
