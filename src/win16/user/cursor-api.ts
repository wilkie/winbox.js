'use strict';

import { NULL } from '../consts.js';

import { resourceBytes } from './resources.js';

/**
 * Cursors: what `LoadCursor` hands out and `SetCursor` makes current.
 *
 * The standard cursors -- `IDC_ARROW`, the I-beam, the hourglass and the rest
 * -- are the display driver's, as its icons are; a program's own are cursor
 * groups among its resources. The page draws the browser's pointer, so a
 * cursor here is what it is and where its hotspot is, and nothing draws it.
 */

const RT_CURSOR = 1;
const RT_GROUP_CURSOR = 12;

export class CursorData {
  readonly id: number;
  readonly hotspot: { x: number; y: number };

  constructor(id: number, hotspot = { x: 0, y: 0 }) {
    this.id = id;
    this.hotspot = hotspot;
  }
}

/** The standard cursors' handles, one a cursor, as a program is given the same one each time. */
function standardHandles(system: any): Map<number, number> {
  system._standardCursors ??= new Map();

  return system._standardCursors;
}

export async function LoadCursor(this: any, hinst: number, lpszCursor: any) {
  if (!hinst) {
    const id = typeof lpszCursor === 'number' ? lpszCursor : Number(lpszCursor);
    const known = this.rasterDesktop?.environment.cursors;

    /* Without the driver to ask, every standard cursor is taken to be there:
     * Windows always has them. */
    if (known ? !known.has(id) : !(id >= 32512 && id <= 32650)) {
      return NULL;
    }

    const handles = standardHandles(this);

    if (!handles.has(id)) {
      handles.set(id, this.handles.allocate(new CursorData(id)));
    }

    return handles.get(id);
  }

  const module = this.handles.resolve(hinst);
  const executable = module?.executable;
  const group = await resourceBytes(executable, RT_GROUP_CURSOR, lpszCursor);

  if (!group || group.length < 6 + 14) {
    return NULL;
  }

  /* The group's first cursor: a directory entry's last word is its id. */
  const id = group[6 + 12] | (group[6 + 13] << 8);
  const cursor = await resourceBytes(executable, RT_CURSOR, id);

  if (!cursor || cursor.length < 4) {
    return NULL;
  }

  return this.handles.allocate(
    new CursorData(id, { x: cursor[0] | (cursor[1] << 8), y: cursor[2] | (cursor[3] << 8) })
  );
}

/** Makes a cursor the current one; the one it replaces is the answer. */
export function SetCursor(this: any, hcursor: number) {
  const previous = this._cursor ?? NULL;

  this._cursor = hcursor;

  return previous;
}

export function GetCursor(this: any) {
  return this._cursor ?? NULL;
}

/**
 * Counts the cursor shown or hidden: one more for `TRUE`, one less for
 * `FALSE`, the cursor showing while the count is nought or more. It answers
 * the new count. **Recorded** by `minis`: from nought, hiding, showing twice
 * and hiding three times and showing answer -1, 0, 1, 0, -1, -2, -1.
 *
 * Nothing draws the cursor here yet; only the count is kept.
 *
 * @param {Types.BOOL} fShow - Whether to show it.
 *
 * @returns {Types.INT} The count.
 */
export function ShowCursor(this: any, fShow: number) {
  this._cursorCount = (this._cursorCount ?? 0) + (fShow ? 1 : -1);

  return this._cursorCount;
}
