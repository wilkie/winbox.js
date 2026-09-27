'use strict';

import { TRUE } from '../consts.js';

import { loadInstallableDrivers } from './drivers.js';

/**
 * A program's first call to USER, made by its start-up code. winbox.js
 * makes a queue for every task already, so there is nothing to make here.
 *
 * The first `InitApp` of all loads the installable drivers `SYSTEM.INI`'s
 * `[boot]` names, as USER does (`USER.EXE` seg5 `484`, after the rest of its
 * start-up): see `drivers.ts`.
 *
 * @returns {Types.BOOL} 1.
 */
export async function InitApp(this: any, _hInstance: number) {
  await loadInstallableDrivers(this);

  return TRUE;
}
