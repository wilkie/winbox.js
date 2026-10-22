'use strict';

import { ownInUse, wantsFile } from '../library.js';

/**
 * The handle of a module the system has. **Recorded** by the `freelib` probe
 * on `MAIN.CPL`, whose module name is `MAINCPL`: a name alone is a module's
 * name, `MAINCPL`, and the file's name without its extension, `MAIN`, finds
 * nothing; a name with an extension is a file's, `MAIN.CPL`. A directory
 * before the name is passed over, and not recorded. Zero when there is no
 * such module. A number with no segment is a module's handle or an
 * instance, as `GetExePtr` takes it (**recorded** by `modnum`).
 *
 * @param {string} lpszModule - The module's name, or its file's.
 * @returns {number} Its handle, or 0.
 */
export function GetModuleHandle(this: any, lpszModule: any) {
  if (lpszModule === null || lpszModule === undefined) {
    return 0;
  }

  /* A number in the offset, its segment nought: KERNEL hands it to
   * `GetExePtr` (`KRNL386.EXE` seg2 `07c6`, `082e`), which finds the module
   * of a module's handle or an instance -- a program's, a library's, or one
   * WinBox keeps -- and answers its handle, as its name would find it. A
   * task's handle finds nothing (**recorded** by `modnum`), but a program's
   * task is its instance here. */
  if (typeof lpszModule === 'number') {
    const item = this.handles.resolve(lpszModule);
    const path = item?.executable?.path ?? item?.loader?.path ?? item?.path;

    if (typeof path !== 'string') {
      return 0;
    }

    const module = this.modules.fromFileName(path.split('\\').pop()!);

    if (module && wantsFile(this, module.name) && !ownInUse(this, module.name)) {
      return 0;
    }

    return this.modules.handleFromPath(path) ?? 0;
  }

  const name = String(lpszModule)
    .split(/[\\/:]/)
    .pop()!
    .toUpperCase();

  const module = name.includes('.') ? this.modules.fromFileName(name) : this.modules.fromName(name);

  /* One of WinBox's own libraries that has a file, `COMMDLG` or `DDEML`, is
   * there only while it is in use, its file's or counted as its file would
   * be with no file (`library.ts`): `DDEML` while a program that imports it
   * runs (**recorded** by `ddewep`). */
  if (!module || (wantsFile(this, module.name) && !ownInUse(this, module.name))) {
    return 0;
  }

  return this.modules.handleFromPath(module.path) ?? 0;
}
