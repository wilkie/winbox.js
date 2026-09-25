'use strict';

/**
 * The handle of a module the system has, by its name: `KERNEL`, or
 * `C:\\WINDOWS\\SYSTEM\\KRNL386.EXE` -- the path and the extension are not
 * part of a module's name. Zero when there is no such module.
 *
 * @param {string} lpszModule - The module's name.
 * @returns {number} Its handle, or 0.
 */
export function GetModuleHandle(this: any, lpszModule: any) {
  if (lpszModule === null || lpszModule === undefined || typeof lpszModule === 'number') {
    return 0;
  }

  const name = String(lpszModule)
    .split(/[\\/:]/)
    .pop()!
    .replace(/\.[^.]*$/, '')
    .toUpperCase();

  const module = this.modules.fromName(name);

  return module ? (this.modules.handleFromPath(module.path) ?? 0) : 0;
}
