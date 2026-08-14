'use strict';

import { NULL } from '../consts.js';

/**
 * Matches a resource type or name against what a program asked for.
 *
 * A program identifies a resource either by a string or by a small integer
 * wrapped in `MAKEINTRESOURCE`, which is a pointer whose high word is zero.
 * The thunk layer hands the first through as a string and the second as a
 * number, so which kind it is can simply be asked.
 *
 * @param {object} entry - A parsed resource or resource type.
 * @param {string|number} wanted - What the program asked for.
 */
function matches(entry, wanted) {
  if (typeof wanted === 'number') {
    return entry.id === wanted;
  }

  const name = String(wanted);

  // Names are compared without regard to case, as the resource compiler did.
  return (
    String(entry.name ?? entry.id).toUpperCase() === name.toUpperCase() ||
    String(entry.id).toUpperCase() === name.toUpperCase()
  );
}

/**
 * The **FindResource** function locates a resource in an executable.
 *
 * What comes back identifies the resource but is not the resource: it is
 * passed to {@link Kernel.LoadResource LoadResource}, which is what actually
 * reads it. Separating the two is what let Windows leave a resource on disk
 * until something wanted it.
 *
 * **See also**:
 * {@link Kernel.LoadResource LoadResource}
 *
 * @static
 * @function FindResource
 * @memberof Kernel
 *
 * @param {Types.HINSTANCE} hinst - The module to search.
 * @param {Types.LPCSTR} lpszName - The name of the resource, or its integer
 *                                  identifier.
 * @param {Types.LPCSTR} lpszType - The type of the resource, or its integer
 *                                  identifier.
 *
 * @return {Types.HANDLE} A handle identifying the resource, or NULL.
 */
export function FindResource(hinst, lpszName, lpszType) {
  const task = this.handles.resolve(hinst);

  if (!task || !task.executable) {
    return NULL;
  }

  for (const type of task.executable.resources ?? []) {
    if (!matches(type, lpszType)) {
      continue;
    }

    for (const entry of type.entries ?? []) {
      if (matches(entry, lpszName)) {
        /* The handle stands for the entry itself; LoadResource needs the
         * executable it came from as well, so both travel together.
         */
        const found = { entry, executable: task.executable };

        return this.handles.allocate(found);
      }
    }
  }

  return NULL;
}
