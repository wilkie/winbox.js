'use strict';

import { File } from '../../file-system.js';
import { Kernel } from '../kernel.js';

/**
 * Opens a file that is there, for reading, writing or both as `fnOpenMode`'s
 * low bits say, positioned at its start; its handle, or `HFILE_ERROR`. The
 * sharing bits are not followed. Documented; Program Manager reads its group
 * files this way.
 */
export async function _lopen(this: any, lpszFilename: any, _fnOpenMode: number) {
  if (!lpszFilename) {
    return Kernel.HFILE_ERROR;
  }

  const handle = await this.dos.files.open(String(lpszFilename));
  const file = handle ? this.dos.files.resolve(handle) : null;

  if (!file || !(file instanceof File)) {
    return Kernel.HFILE_ERROR;
  }

  file.position = 0;

  return handle;
}
