'use strict';

import { TRUE } from '../consts.js';

import { loadInstallableDrivers } from './drivers.js';
import { loadParameters } from './system-parameters.js';
import { makeUserWindows } from './user-windows.js';

/**
 * A program's first call to USER, made by its start-up code. winbox.js
 * makes a queue for every task already, so there is nothing to make here;
 * the first program's is the desktop window's.
 *
 * The first `InitApp` of all makes USER's own hidden windows
 * (`user-windows.ts`), and loads the installable drivers `SYSTEM.INI`'s
 * `[boot]` names, as USER does (`USER.EXE` seg5 `484`, after the rest of its
 * start-up): see `drivers.ts`. The settings USER reads from `WIN.INI` as it
 * starts are read then too (`system-parameters.ts`).
 *
 * @returns {Types.BOOL} 1.
 */
export async function InitApp(this: any, _hInstance: number) {
  /* The first program takes the desktop window's queue as its own: the
   * desktop window is its (`USER.EXE` seg5 `03ae`-`03d8`; `tasklist`). */
  const desktop = this._desktopWindow;

  if (desktop && !desktop.data.hInstance) {
    desktop.data.hInstance = this.scheduler.active;
  }

  await makeUserWindows(this);
  await loadParameters(this);
  await loadInstallableDrivers(this);

  return TRUE;
}
