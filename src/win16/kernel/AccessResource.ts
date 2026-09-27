'use strict';

import { File } from '../../file-system.js';
import { Kernel } from '../kernel.js';

/**
 * A resource read from its module's file rather than loaded: `AccessResource`
 * and `SizeofResource`.
 *
 * **Recorded** by `accres`, on raw data of 1, 17 and 300 bytes and one by
 * name, in a program whose resources are aligned to 2 bytes:
 *
 * * `SizeofResource` answers the length the resource table gives, in bytes:
 *   rounded up to the alignment, 2 for the one byte.
 * * `AccessResource` opens the module's file anew each time, two calls making
 *   two handles, and leaves the pointer at the resource's start: its offset
 *   in the table, in bytes. What is read there is what `LockResource` gives.
 */

/**
 * Opens the file a resource is in, at the resource.
 *
 * @param {Types.HINSTANCE} hinst - The module.
 * @param {Types.HANDLE} hrsrc - The resource, from `FindResource`.
 *
 * @returns {Types.INT} A file handle, or -1.
 */
export async function AccessResource(this: any, _hinst: number, hrsrc: number) {
  const found = this.handles.resolve(hrsrc);
  const path = found?.entry ? found.executable?.path : null;

  if (!path) {
    return Kernel.HFILE_ERROR;
  }

  const handle = await this.dos.files.open(String(path));
  const file = handle ? this.dos.files.resolve(handle) : null;

  if (!(file instanceof File)) {
    return Kernel.HFILE_ERROR;
  }

  file.position = found.entry.offset;

  return handle;
}

/**
 * The size of a resource, as its module's resource table gives it.
 *
 * @param {Types.HINSTANCE} hinst - The module.
 * @param {Types.HANDLE} hrsrc - The resource, from `FindResource`.
 *
 * @returns {Types.DWORD} Its size in bytes, or nought.
 */
export function SizeofResource(this: any, _hinst: number, hrsrc: number) {
  const found = this.handles.resolve(hrsrc);

  return found?.entry ? found.entry.length : 0;
}
