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

/** Each module's resources' handles, by entry: made once, for all of them. */
const HANDLES = new WeakMap<object, Map<object, number>>();

/** Where a module's resources' handles may start. */
const FIRST = 0x4000;

/**
 * The handle `FindResource` answers for a resource: where its entry is in
 * its module's resource table, as Windows' is, from a base the module's
 * resources are given the first time one is asked for. **Recorded** by
 * `findres`: one resource found twice answers the same, the next one 12
 * more -- an entry's size -- and one found 20,000 times answers the same
 * every time, never nought. A handle made for each call, as winbox.js once
 * did, ran out after a few thousand, and SimTower read through the nought.
 *
 * The table: a word, then each type's eight bytes and its entries' twelve
 * each. The handle stands for the entry and its executable, which
 * `LoadResource` needs as well.
 */
function resourceHandle(handles: any, executable: any, wanted: object): number {
  let made = HANDLES.get(executable);

  if (!made) {
    const places: [object, number][] = [];
    let at = 2;

    for (const type of executable.resources ?? []) {
      at += 8;

      for (const entry of type.entries ?? []) {
        places.push([entry, at]);
        at += 12;
      }
    }

    /* A base where every entry's handle is free. */
    let base = FIRST;

    while (places.some(([, offset]) => handles.resolve(base + offset) !== undefined)) {
      base += 0x10;
    }

    made = new Map();

    for (const [entry, offset] of places) {
      handles.assign(base + offset, { entry, executable });
      made.set(entry, base + offset);
    }

    HANDLES.set(executable, made);
  }

  return made.get(wanted) ?? NULL;
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
        return resourceHandle(this.handles, task.executable, entry);
      }
    }
  }

  return NULL;
}
