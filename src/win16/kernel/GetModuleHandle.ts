'use strict';

import { wantsFile } from '../library.js';

/**
 * The handle of a module the system has. **Recorded** by the `freelib` probe
 * on `MAIN.CPL`, whose module name is `MAINCPL`: a name alone is a module's
 * name, `MAINCPL`, and the file's name without its extension, `MAIN`, finds
 * nothing; a name with an extension is a file's, `MAIN.CPL`. A directory
 * before the name is passed over, and not recorded. Zero when there is no
 * such module.
 *
 * @param {string} lpszModule - The module's name, or its file's.
 * @returns {number} Its handle, or 0.
 */
export function GetModuleHandle(this: any, lpszModule: any) {
  if (lpszModule === null || lpszModule === undefined || typeof lpszModule === 'number') {
    return 0;
  }

  const name = String(lpszModule)
    .split(/[\\/:]/)
    .pop()!
    .toUpperCase();

  const module = name.includes('.') ? this.modules.fromFileName(name) : this.modules.fromName(name);

  /* A module winbox.js keeps only as names, until its file is loaded, is not
   * loaded: `COMMDLG` is not there until something needs it. */
  if (!module || wantsFile(this, module.name)) {
    return 0;
  }

  return this.modules.handleFromPath(module.path) ?? 0;
}
