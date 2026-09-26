'use strict';

import { copyText } from '../user/control-classes.js';

/**
 * The Windows directory, or the system directory, into a buffer. **Recorded**
 * by the `sysdirs` probe: the answer is the path's length when it fits with
 * its nought; when it does not, the buffer is left alone and the answer is
 * the size it would take, one more.
 */
function directory(system: any, path: string, far: number, size: number) {
  size &= 0xffff;

  if (size < path.length + 1) {
    return path.length + 1;
  }

  copyText(system, path, far >>> 0, size);

  return path.length;
}

export function GetWindowsDirectory(this: any, lpszSysPath: number, cbSysPath: number) {
  return directory(this, 'C:\\WINDOWS', lpszSysPath, cbSysPath);
}

export function GetSystemDirectory(this: any, lpszSysPath: number, cbSysPath: number) {
  return directory(this, 'C:\\WINDOWS\\SYSTEM', lpszSysPath, cbSysPath);
}
