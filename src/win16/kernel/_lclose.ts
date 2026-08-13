'use strict';

import { File } from '../../file-system.js';
import { Kernel } from '../kernel.js';

import { NULL } from '../consts.js';

/**
 * The **_lclose** function closes the given file. As a result, the file is no
 * longer available for reading or writing.
 *
 * **See also**:
 * {@link Kernel._lopen _lopen}
 * {@link Kernel.OpenFile OpenFile}
 *
 * @static
 * @function _lclose
 * @memberof Kernel
 *
 * @param {Types.HFILE} hf - Identifies the file to be closed. This handle is
 *                           returned by the function that created or last
 *                           opened the file.
 *
 * @returns {Types.HFILE} The return value is zero if the function is
 *                        successful. Otherwise, it is `HFILE_ERROR`.
 */
export function _lclose(hf) {
  const file = this.dos.files.resolve(hf);

  if (!file || !(file instanceof File)) {
    return Kernel.HFILE_ERROR;
  }

  this.dos.files.close(hf);

  return NULL;
}
