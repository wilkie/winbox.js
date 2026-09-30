'use strict';

import { NULL } from '../consts.js';

import { resourceBytes } from './resources.js';
import { cursorOf } from './cursor-pos.js';
import { DevicePalette } from '../../raster/device-palette.js';
import { decodeCursor, type CursorImage } from '../../raster/icon.js';

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
const IDC_ARROW = 32512;

export class CursorData {
  readonly id: number;
  readonly hotspot: { x: number; y: number };
  /** Its picture, for one of a program's own. */
  readonly image: CursorImage | null;

  constructor(id: number, hotspot = { x: 0, y: 0 }, image: CursorImage | null = null) {
    this.id = id;
    this.hotspot = hotspot;
    this.image = image;
  }
}

/** The standard cursors' handles, one a cursor, as a program is given the same one each time. */
function standardHandles(system: any): Map<number, number> {
  system._standardCursors ??= new Map();

  return system._standardCursors;
}

/** A standard cursor's handle, the same each time it is asked for. */
function standardHandle(system: any, id: number) {
  const handles = standardHandles(system);

  if (!handles.has(id)) {
    handles.set(id, system.handles.allocate(new CursorData(id)));
  }

  return handles.get(id)!;
}

/** The cursor now: the arrow until one is set, as Windows starts (`setcur`). */
function current(system: any) {
  if (system._cursor === undefined) {
    system._cursor = standardHandle(system, IDC_ARROW);
  }

  return system._cursor;
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

    return standardHandle(this, id);
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

  const image = decodeCursor(cursor, DevicePalette.forDisplay(this.display));

  return this.handles.allocate(new CursorData(id, image.hotspot, image));
}

/** Makes a cursor the current one; the one it replaces is the answer. */
export function SetCursor(this: any, hcursor: number) {
  const previous = current(this);

  this._cursor = hcursor;

  return previous;
}

export function GetCursor(this: any) {
  return current(this);
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

/**
 * The cursor as the display shows it: its picture, and where its top left
 * is. None while `ShowCursor` has it hidden. Before a program sets one, the
 * arrow, as Windows starts with.
 */
export function cursorOnScreen(system: any) {
  if ((system._cursorCount ?? 0) < 0) {
    return null;
  }

  const cursor = system.handles.resolve(current(system));
  const image: CursorImage | undefined =
    cursor instanceof CursorData
      ? (cursor.image ?? system.rasterDesktop?.environment.cursorImages?.get(cursor.id))
      : undefined;

  if (!image) {
    return null;
  }

  const at = cursorOf(system);

  return { image, left: at.x - image.hotspot.x, top: at.y - image.hotspot.y };
}

/**
 * The cursor drawn over a copy of the screen's pixels, as the display driver
 * draws it: kept where its mask is set, then its picture's bits flipped in.
 */
export function withCursor(system: any, indices: Uint8Array, width: number, height: number) {
  const shown = cursorOnScreen(system);
  const out = Uint8Array.from(indices);

  if (!shown) {
    return out;
  }

  const { image, left, top } = shown;

  for (let row = 0; row < image.height; row++) {
    for (let column = 0; column < image.width; column++) {
      const x = left + column;
      const y = top + row;

      if (x < 0 || y < 0 || x >= width || y >= height) {
        continue;
      }

      const at = row * image.width + column;
      const beneath = image.and[at] ? out[y * width + x] : 0;

      out[y * width + x] = beneath ^ image.xor[at];
    }
  }

  return out;
}
