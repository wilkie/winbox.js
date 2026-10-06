'use strict';

import { Brush } from '../../raster/brush.js';
import { Pen } from '../../raster/pen.js';
import { DEFAULT_ENTRIES } from '../../raster/palette-colour.js';
import { LogicalPalette } from './gdi-objects.js';
import { STOCK_FONTS } from './stock-fonts.js';

import { stockHandle } from '../handle-manager.js';
import { formatOf, rowBytes } from './ddb.js';

/**
 * What an object is, put in a program's buffer, as much of it as there is room
 * for: how many bytes. `GDI.EXE` 4:04BB.
 */
export function GetObject(hgdiobj, cbBuffer, lpvObject) {
  const item = this.handles.resolve(hgdiobj);

  // If we could not resolve the handle, fail.
  if (!item) {
    return 0;
  }

  /* As much of what it tells as there is room for, written into the
   * program's buffer: how many bytes. */
  const put = (bytes: ArrayLike<number>) => {
    const size = Math.min(cbBuffer, bytes.length);
    const core = this.machine.cpu.core;

    for (let at = 0; at < size; at++) {
      core.write8((lpvObject >>> 16) & 0xffff, ((lpvObject & 0xffff) + at) & 0xffff, bytes[at]);
    }

    return size;
  };

  /* A bitmap: the first ten bytes of its `BITMAP`, and noughts to fill the
   * room, however much: the answer is the room (`GDI.EXE` 4:0571;
   * **recorded** by `stockdel`, with room for 6, 14, 16 and 20). No pointer
   * to its bits is told; `GetBitmapBits` gives them. */
  if (cbBuffer > 0 && this.handles.isBitmap(item)) {
    /* The planes and bits it was made with, a row a plane's bytes rounded
     * to a word: a sixteen-colour display's colour bitmap is four planes of
     * one bit (`patmono`). */
    const { planes, bits } = formatOf(item);
    const bytes = new Uint8Array(Math.max(cbBuffer, 10));
    const view = new DataView(bytes.buffer);

    view.setInt16(2, item.width, true);
    view.setInt16(4, item.height, true);
    view.setInt16(6, rowBytes(bits, item.width), true);
    bytes[8] = planes;
    bytes[9] = bits;

    return put(bytes);
  }

  /* A palette: its count of entries, a word. **Recorded** by `palette`. */
  if (item instanceof LogicalPalette && cbBuffer > 0) {
    const count = (item.entries ?? DEFAULT_ENTRIES).length;
    const size = Math.min(cbBuffer, 2);
    const core = this.machine.cpu.core;

    core.write8((lpvObject >>> 16) & 0xffff, lpvObject & 0xffff, count & 0xff);

    if (size > 1) {
      core.write8((lpvObject >>> 16) & 0xffff, ((lpvObject & 0xffff) + 1) & 0xffff, (count >> 8) & 0xff);
    }

    return size;
  }

  /* A pen: its `LOGPEN`, as it was given (`penind`). */
  if (item instanceof Pen && item.logpen && cbBuffer > 0) {
    const { style, width, y, color } = item.logpen;
    const words = [style, width, y, color & 0xffff, color >>> 16];
    const size = Math.min(cbBuffer, 10);
    const core = this.machine.cpu.core;

    for (let at = 0; at < size; at++) {
      core.write8(
        (lpvObject >>> 16) & 0xffff,
        ((lpvObject & 0xffff) + at) & 0xffff,
        (words[at >> 1] >> ((at & 1) * 8)) & 0xff
      );
    }

    return size;
  }

  /* A brush: its `LOGBRUSH` -- as it was given, or for a pattern brush,
   * `BS_PATTERN` and the bitmap's handle. */
  if (item instanceof Brush && (item.logbrush || item.pattern) && cbBuffer > 0) {
    const { style, color, hatch } = item.logbrush ?? { style: 3, color: 0, hatch: item.bitmap };
    const bytes = [
      style & 0xff,
      (style >> 8) & 0xff,
      color & 0xff,
      (color >>> 8) & 0xff,
      (color >>> 16) & 0xff,
      (color >>> 24) & 0xff,
      hatch & 0xff,
      (hatch >> 8) & 0xff,
    ];
    const size = Math.min(cbBuffer, 8);
    const core = this.machine.cpu.core;

    for (let at = 0; at < size; at++) {
      core.write8((lpvObject >>> 16) & 0xffff, (lpvObject & 0xffff) + at, bytes[at]);
    }

    return size;
  }

  /* A font: the `LOGFONT` it was made from, or a stock font's
   * (`stockLogfont`), to the face's nought and no further -- eighteen bytes
   * and the name's length and one (`GDI.EXE` 4:04F3), so a font named Helv
   * tells of 23 bytes however much room there is (**recorded** by
   * `stockdel`). */
  const logfont = (item as any).logfont ?? stockLogfont(this, hgdiobj);

  if (logfont && cbBuffer > 0) {
    const face = logfont.face.slice(0, 31);
    const bytes = new Uint8Array(18 + face.length + 1);
    const view = new DataView(bytes.buffer);

    view.setInt16(0, logfont.height, true);
    view.setInt16(2, logfont.width, true);
    view.setInt16(4, logfont.escapement, true);
    view.setInt16(6, logfont.orientation, true);
    view.setInt16(8, logfont.weight, true);
    bytes.set(
      [
        logfont.italic,
        logfont.underline,
        logfont.strikeout,
        logfont.charset,
        logfont.outPrecision,
        logfont.clipPrecision,
        logfont.quality,
        logfont.pitchAndFamily,
      ],
      10
    );

    for (let at = 0; at < face.length; at++) {
      bytes[18 + at] = face.charCodeAt(at) & 0xff;
    }

    return put(bytes);
  }

  // Error out if we don't understand the object
  return 0;
}

/**
 * A stock font's `LOGFONT`, as `GetObject` tells of it, or none for a handle
 * that is no stock font's. **Recorded** by `stockdel` on four displays.
 *
 * Four are the same on every display, whatever the display's own fonts:
 * `OEM_FIXED_FONT` is Terminal twelve by eight on an EGA too, whose Terminal
 * is eight rows. `DEVICE_DEFAULT_FONT` is nothing but fixed pitch. The system
 * font and the system's fixed font are the display's, GDI's `LOGFONT` for each
 * made, as every recorded value fits, from the header of the font it loads at
 * start-up (inferred: `GDI.EXE` 2:02C5-0335 makes them, not read through): its
 * height and average width in pixels, weight, style and
 * character set, its face; output precision `OUT_STRING_PRECIS`, clipping
 * `CLIP_STROKE_PRECIS`, `PROOF_QUALITY`; and its family with the pitch as a
 * `LOGFONT` says it, 2 variable and 1 fixed, where the header's low bit is set
 * for variable. VGASYS is 16 by 7, bold; EGASYS 12 by 7; VGAFIX 15 by 8,
 * regular; EGAFIX 10 by 8, bold.
 */
function stockLogfont(context: any, handle: number) {
  let index = 0;

  while (index <= 16 && stockHandle(index) !== handle) {
    index++;
  }

  const plain = {
    height: 0,
    width: 0,
    escapement: 0,
    orientation: 0,
    weight: 0,
    italic: 0,
    underline: 0,
    strikeout: 0,
    charset: 0,
    outPrecision: 0,
    clipPrecision: 2,
    quality: 2,
    pitchAndFamily: 0,
    face: '',
  };

  switch (index) {
    case 10:
      return { ...plain, height: 12, width: 8, charset: 0xff, pitchAndFamily: 1, face: 'Terminal' };
    case 11:
      return { ...plain, height: 12, width: 9, pitchAndFamily: 1, face: 'Courier' };
    case 12:
      return { ...plain, height: 12, width: 9, pitchAndFamily: 2, face: 'Helv' };
    case 14:
      return { ...plain, clipPrecision: 0, quality: 0, pitchAndFamily: 1 };
    case 13:
    case 16: {
      const { face, cell } = STOCK_FONTS[index];
      const entry = context.fonts.realize(face, cell)?.entry;

      if (!entry) {
        return null;
      }

      const header = entry.header;

      return {
        ...plain,
        height: header.dfPixHeight,
        width: header.dfAvgWidth,
        weight: header.dfWeight,
        italic: header.dfItalic,
        underline: header.dfUnderline,
        strikeout: header.dfStrikeOut,
        charset: header.dfCharSet,
        outPrecision: 1,
        pitchAndFamily: (header.dfPitchAndFamily & 0xf0) | (header.dfPitchAndFamily & 1 ? 2 : 1),
        face: entry.name,
      };
    }
    default:
      return null;
  }
}
