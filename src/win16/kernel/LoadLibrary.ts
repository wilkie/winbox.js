'use strict';

import { loadLibrary } from '../library.js';

/**
 * A library loaded by a program: its instance handle, or an error number
 * below 32. See `loadLibrary` in `library.ts`.
 */
export async function LoadLibrary(this: any, lpszLibFileName: any) {
  const beside = String(this.scheduler?.task?.executable?.path ?? '').replace(/\\[^\\]*$/, '') || null;

  return loadLibrary(this, String(lpszLibFileName ?? ''), beside);
}
