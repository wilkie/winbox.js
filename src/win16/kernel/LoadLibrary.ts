'use strict';

import { freeLibrary, Library, loadLibrary } from '../library.js';

/**
 * A library loaded by a program: its instance handle, or an error number
 * below 32. See `loadLibrary` in `library.ts`.
 */
export async function LoadLibrary(this: any, lpszLibFileName: any) {
  const beside =
    String(this.scheduler?.task?.executable?.path ?? '').replace(/\\[^\\]*$/, '') || null;

  return loadLibrary(this, String(lpszLibFileName ?? ''), beside);
}

/**
 * Lets a library go: its count down by one, and at nought the library, and
 * those it brought, gone. See `freeLibrary`.
 *
 * @param {Types.HINSTANCE} hinst - The library, as `LoadLibrary` gave it.
 */
export async function FreeLibrary(this: any, hinst: number) {
  await freeLibrary(this, hinst);
}

/**
 * A module's count. **Recorded** by the `freelib` probe for a library: one
 * for each load and each import, one fewer for each free. A program's is
 * how many of its instances run, **recorded** by `tasks2`. A module
 * winbox.js keeps itself answers 1; not recorded.
 *
 * @param {Types.HINSTANCE} hinst - The module or instance.
 *
 * @returns {Types.INT} The count.
 */
export function GetModuleUsage(this: any, hinst: number) {
  const item = this.handles.resolve(hinst);

  if (item instanceof Library) {
    return item.usage;
  }

  /* A program's: its instances running (`tasks2`), nought once the last has
   * ended and the module is gone (`fault`). */
  const path = item?.executable?.path;

  if (path && this.scheduler?._tasks) {
    const running = Object.values(this.scheduler._tasks).filter(
      (task: any) =>
        !task.ended &&
        String(task.executable?.path ?? '').toUpperCase() === String(path).toUpperCase()
    ).length;

    return running;
  }

  return item ? 1 : 0;
}
