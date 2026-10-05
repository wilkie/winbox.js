'use strict';

import { resolveDirectory } from '../../dos/syscall/directory.js';
import { File } from '../../file-system.js';
import { Kernel } from '../kernel.js';
import { tellFileChange } from './FileCdr.js';

/**
 * The **_lcreat** function creates or opens a file.
 *
 * If the file exists it is truncated to nothing. The handle that comes back is
 * open for reading and writing, and is closed with
 * {@link Kernel._lclose _lclose}.
 *
 * **See also**:
 * {@link Kernel._lwrite _lwrite}
 * {@link Kernel._lclose _lclose}
 *
 * @static
 * @function _lcreat
 * @memberof Kernel
 *
 * @param {Types.LPCSTR} lpszFilename - The name of the file to create.
 * @param {Types.INT} fnAttribute - The attributes to give it.
 *
 * @return {Types.HFILE} The open file, or HFILE_ERROR.
 */
export async function _lcreat(lpszFilename, _fnAttribute) {
  if (!lpszFilename) {
    return Kernel.HFILE_ERROR;
  }

  /* A name with no drive placed as DOS's function 3Ch, which KERNEL hands it
   * to, places it: in the current directory, the task's own (`curdir`). */
  const given = String(lpszFilename);
  const handle = await this.dos.files.create(
    given.includes(':') ? given : wholePath(this.dos, given)
  );

  if (!handle) {
    return Kernel.HFILE_ERROR;
  }

  const file = this.dos.files.resolve(handle);

  if (!file || !(file instanceof File)) {
    return Kernel.HFILE_ERROR;
  }

  /* Told to `FileCdr`'s procedure as DOS's create, 3C00h. */
  await tellFileChange(this, 0x3c00, String(lpszFilename));

  return handle;
}

/** A file's path as DOS places it, against the current drive and its directory. */
function wholePath(dos: any, path: string) {
  const at = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')) + 1;
  const { drive, parts } = resolveDirectory(dos, path.slice(0, at));

  return `${drive}:\\${[...parts, path.slice(at)].join('\\')}`;
}
