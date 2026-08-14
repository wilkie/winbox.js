'use strict';

import { File } from '../../file-system.js';
import { Kernel } from '../kernel.js';

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
export async function _lcreat(lpszFilename, fnAttribute) {
  if (!lpszFilename) {
    return Kernel.HFILE_ERROR;
  }

  const handle = await this.dos.files.create(String(lpszFilename));

  if (!handle) {
    return Kernel.HFILE_ERROR;
  }

  const file = this.dos.files.resolve(handle);

  if (!file || !(file instanceof File)) {
    return Kernel.HFILE_ERROR;
  }

  return handle;
}
