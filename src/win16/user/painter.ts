'use strict';

import { type DeviceBitmap } from '../../raster/device-bitmap.js';
import { ditherTile } from '../../raster/dither.js';

/**
 * How USER paints its own parts of the screen -- frames, captions, scroll
 * bars, controls -- into a window: rectangles of a system colour's brush,
 * lines, the display driver's bitmaps, and the raised boxes and scroll bars
 * made of them. Coordinates are the window's; what is outside the window is
 * not painted, and a bitmap that is a view of the screen clips the rest (see
 * `DeviceBitmap.view`).
 */

export const OBM_LFARROW = 32750;
export const OBM_RGARROW = 32751;
export const OBM_DNARROW = 32752;
export const OBM_UPARROW = 32753;

/* The arrows turned off, grayed (`USER.EXE` seg3 `0f4c`). */
export const OBM_LFARROWI = 32734;
export const OBM_RGARROWI = 32735;
export const OBM_DNARROWI = 32736;
export const OBM_UPARROWI = 32737;

const SM_CYVTHUMB = 9;
const SM_CXHTHUMB = 10;
const SM_CYVSCROLL = 20;
const SM_CXHSCROLL = 21;

const COLOR_SCROLLBAR = 0;
const COLOR_WINDOW = 5;
const COLOR_WINDOWFRAME = 6;
const COLOR_BTNFACE = 15;
const COLOR_BTNSHADOW = 16;
const COLOR_BTNHIGHLIGHT = 20;

/** What painting asks of the display. */
export interface PaintEnvironment {
  /** The display mode, whose driver patterns the brushes. */
  display: any;

  /** `GetSystemMetrics`. */
  metric(index: number): number;

  /** `GetSysColor`, as a `COLORREF`. */
  sysColor(index: number): number;

  /** The display driver's OEM bitmaps, by id, at the screen's depth. */
  oem: Map<number, DeviceBitmap>;
}

/** A brush: one index, or a pattern of them by screen pixel. */
export type Paint = number | Uint8Array;

export class Painter {
  readonly screen: DeviceBitmap;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly environment: PaintEnvironment;

  constructor(
    screen: DeviceBitmap,
    left: number,
    top: number,
    width: number,
    height: number,
    environment: PaintEnvironment
  ) {
    this.screen = screen;
    this.left = left;
    this.top = top;
    this.width = width;
    this.height = height;
    this.environment = environment;
  }

  /** A brush of a colour, patterned as the display driver patterns it. */
  solid(colorref: number): Paint {
    const palette = this.screen.devicePalette;
    const [red, green, blue] = [colorref & 0xff, (colorref >> 8) & 0xff, (colorref >> 16) & 0xff];

    return (
      ditherTile(this.environment.display, palette, red, green, blue) ??
      palette.index(red, green, blue)
    );
  }

  /** A brush of a system colour. */
  colour(system: number): Paint {
    return this.solid(this.environment.sysColor(system));
  }

  /** Fills a rectangle, its right and bottom edges outside it. */
  fill(x0: number, y0: number, x1: number, y1: number, paint: Paint) {
    const screen = this.screen;

    /* Marked, so the screen's presenter shows it. */
    screen.context.markRect(this.left + x0, this.top + y0, this.left + x1, this.top + y1);

    for (let y = Math.max(y0, 0); y < Math.min(y1, this.height); y++) {
      for (let x = Math.max(x0, 0); x < Math.min(x1, this.width); x++) {
        const sx = this.left + x;
        const sy = this.top + y;

        screen.put(sx, sy, typeof paint === 'number' ? paint : paint[((sy & 7) << 3) | (sx & 7)]);
      }
    }
  }

  /** Inverts a rectangle: every bit of each pixel's index, as `DSTINVERT` does. */
  invert(x0: number, y0: number, x1: number, y1: number) {
    const screen = this.screen;
    const mask = (1 << screen.depth) - 1;

    screen.context.markRect(this.left + x0, this.top + y0, this.left + x1, this.top + y1);

    for (let y = Math.max(y0, 0); y < Math.min(y1, this.height); y++) {
      for (let x = Math.max(x0, 0); x < Math.min(x1, this.width); x++) {
        const index = screen.indexAt(this.left + x, this.top + y);

        if (index !== null) {
          screen.put(this.left + x, this.top + y, index ^ mask);
        }
      }
    }
  }

  /** A rectangle's edges, a pixel wide, inside it. */
  outline(x0: number, y0: number, x1: number, y1: number, paint: Paint) {
    this.fill(x0, y0, x1, y0 + 1, paint);
    this.fill(x0, y1 - 1, x1, y1, paint);
    this.fill(x0, y0, x0 + 1, y1, paint);
    this.fill(x1 - 1, y0, x1, y1, paint);
  }

  /**
   * Part of a bitmap, from `sx, sy`, `w` by `h`, at `x, y`: `w` defaults to
   * the bitmap's width and `h` to its height.
   */
  blit(
    bitmap: DeviceBitmap | undefined,
    x: number,
    y: number,
    w = bitmap?.width ?? 0,
    sx = 0,
    h = bitmap?.height ?? 0,
    sy = 0
  ) {
    if (!bitmap) {
      return;
    }

    for (let row = 0; row < Math.min(h, bitmap.height - sy); row++) {
      for (let column = 0; column < Math.min(w, bitmap.width - sx); column++) {
        this.fill(
          x + column,
          y + row,
          x + column + 1,
          y + row + 1,
          bitmap.indices[(sy + row) * bitmap.width + sx + column]
        );
      }
    }
  }

  /**
   * A bitmap scaled to `w` by `h` at `x, y`, as USER scales a scroll bar's
   * arrows to the bar: each row and column of the result is one of the
   * bitmap's, by `stretchSource`.
   */
  stretch(bitmap: DeviceBitmap | undefined, x: number, y: number, w: number, h: number) {
    if (!bitmap) {
      return;
    }

    const mono = bitmap.depth === 1 && this.screen.depth === 1;
    const rows = stretchMap(bitmap.height, h, bitmap.width, w, 'rows', mono);
    const columns = stretchMap(bitmap.width, w, bitmap.height, h, 'columns', mono);

    for (let row = 0; row < h; row++) {
      for (let column = 0; column < w; column++) {
        this.fill(
          x + column,
          y + row,
          x + column + 1,
          y + row + 1,
          bitmap.indices[rows[row] * bitmap.width + columns[column]]
        );
      }
    }
  }

  /**
   * A raised box in the button face, outlined in the frame colour, lit one
   * pixel along the top and left and shadowed two along the bottom and right:
   * a scroll bar's thumb.
   */
  thumb(x0: number, y0: number, x1: number, y1: number) {
    const shadow = this.colour(COLOR_BTNSHADOW);
    const light = this.colour(COLOR_BTNHIGHLIGHT);

    this.fill(x0, y0, x1, y1, this.colour(COLOR_BTNFACE));
    this.fill(x0 + 1, y0 + 1, x1 - 2, y0 + 2, light);
    this.fill(x0 + 1, y0 + 1, x0 + 2, y1 - 2, light);
    this.fill(x1 - 2, y0 + 1, x1 - 1, y1 - 1, shadow);
    this.fill(x0 + 1, y1 - 2, x1 - 1, y1 - 1, shadow);
    this.fill(x1 - 3, y0 + 2, x1 - 2, y1 - 2, shadow);
    this.fill(x0 + 2, y1 - 3, x1 - 2, y1 - 2, shadow);
    this.outline(x0, y0, x1, y1, this.colour(COLOR_WINDOWFRAME));
  }

  /**
   * A scroll bar over a rectangle, a window's or a control's: the scroll bar
   * colour, the driver's arrow bitmaps at each end, scaled to the bar, the thumb at the start,
   * and the whole outlined in the frame colour last -- over an arrow's last
   * row, where the bar is shorter than the bitmap.
   */
  /**
   * A scroll bar, its thumb where its position puts it (`USER.EXE` seg18
   * `073c`, `04b7`, `037b`).
   *
   * Along the bar, each arrow is as long as its bitmap, but no longer than
   * half the bar less the border, so the arrows shrink on a short bar; a bar
   * with no room for them draws nothing at all. The thumb starts a border
   * back from the first arrow's inner edge and moves along what is left of
   * the track, `(pos - min) * room / (max - min)` rounded half up, `room`
   * being the bar less both arrows and the thumb, plus two borders. A track
   * shorter than the thumb shows no thumb.
   *
   * **Read out**, and **recorded** by `mledit`: a multi-line edit control's
   * thumbs at 0, 13, 25, 50 and 75 of 0 to 100, and 66 across, on four
   * displays.
   *
   * An arrow turned off (`flags` 1 for the top or left, 2 for the bottom or
   * right) is the driver's grayed bitmap (seg18 `0556`, `05fa`). With both
   * off there is no thumb, and the track is the class background of the
   * control's parent, or of the window whose bar it is, where the scroll bar
   * colour was -- the window colour for a class without one (seg18 `02da`,
   * `03cf`). **Recorded** by `noscroll`.
   */
  scrollBar(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    vertical: boolean,
    place: {
      min: number;
      max: number;
      pos: number;
      flags?: number;
      shaft?: number | null;
    } = { min: 0, max: 100, pos: 0 }
  ) {
    const oem = this.environment.oem;
    const metric = (index: number) => this.environment.metric(index);
    const border = 1;
    const length = vertical ? y1 - y0 : x1 - x0;
    const half = (length >> 1) - border;

    if (half <= 0) {
      return;
    }

    const bitmap = metric(vertical ? SM_CYVSCROLL : SM_CXHSCROLL);
    const arrow = Math.min(half, bitmap);
    const thumb = metric(vertical ? SM_CYVTHUMB : SM_CXHTHUMB);
    const room = length - 2 * arrow - thumb + 2 * border;
    const span = place.max - place.min;
    const offset = span ? Math.floor(((place.pos - place.min) * room + (span >> 1)) / span) : place.pos - place.min;
    const flags = (place.flags ?? 0) & 3;
    const off = flags === 3;
    const shows = length - 2 * arrow >= thumb && !off;
    const pick = (bit: number, normal: number, grayed: number) =>
      (flags & bit && oem.get(grayed)) || oem.get(normal);

    this.fill(
      x0,
      y0,
      x1,
      y1,
      off ? this.solid(place.shaft ?? this.environment.sysColor(COLOR_WINDOW)) : this.colour(COLOR_SCROLLBAR)
    );

    if (vertical) {
      this.stretch(pick(1, OBM_UPARROW, OBM_UPARROWI), x0, y0, x1 - x0, arrow);
      this.stretch(pick(2, OBM_DNARROW, OBM_DNARROWI), x0, y1 - arrow, x1 - x0, arrow);

      if (shows) {
        const top = y0 + arrow - border + offset;

        this.thumb(x0, top, x1, top + thumb);
      }
    } else {
      this.stretch(pick(1, OBM_LFARROW, OBM_LFARROWI), x0, y0, arrow, y1 - y0);
      this.stretch(pick(2, OBM_RGARROW, OBM_RGARROWI), x1 - arrow, y0, arrow, y1 - y0);

      if (shows) {
        const left = x0 + arrow - border + offset;

        this.thumb(left, y0, left + thumb, y1);
      }
    }

    this.outline(x0, y0, x1, y1, this.colour(COLOR_WINDOWFRAME));

    /* An arrow squashed shorter than its bitmap has the frame drawn again
     * from the thumb's start on, a line over its last row. */
    if (bitmap > arrow) {
      if (vertical) {
        this.outline(x0, y0 + arrow - border, x1, y1, this.colour(COLOR_WINDOWFRAME));
      } else {
        this.outline(x0 + arrow - border, y0, x1, y1, this.colour(COLOR_WINDOWFRAME));
      }
    }
  }
}

/**
 * Which source row (or column) each of `size` rows of a `from`-row bitmap
 * stretched shows, `other` and `otherSize` being the other axis: GDI's own
 * `StretchBlt`, as none of the display drivers stretches (`GDI.EXE` seg32
 * `03ba`).
 *
 * * **Within a pixel on both axes** (seg32 `0504`): copied as it is, and on
 *   enlarging, the last row and column shown once more.
 * * **Colour** (seg32 `099e`, EGA and VGA): through a device-independent
 *   copy. Its error terms start at the larger size less half the smaller;
 *   rows advance on reaching nought and columns only on passing it, so
 *   enlarging, row `d` shows `(d * from + from / 2) / size` and column `d`
 *   `(d * from + from / 2 - 1) / size`, rounded down.
 * * **Monochrome** (seg32 `0000`, the Hercules): row `d` shows
 *   `(d * from + ceil(from / 2) - 1) / size`; columns are dealt out from the
 *   source, each `size / from` times, the remainder spread one more at a time
 *   from the second.
 *
 * **Read out**, and **recorded** by `chrome` and `noscroll`: the EGA's arrow
 * rows 14 made 16 repeat 3 and 10 and its grayed arrow's 17 columns made 18
 * repeat 7; the Hercules's 11 rows made 16 repeat 1, 3, 5, 7 and 9, and its 15
 * columns made 16 by 11 repeat the last. Reducing by more than a pixel shows
 * `d * from / size`, rounded down, which is not read out: only a last row
 * under the bar's outline has shown it.
 */
export function stretchMap(
  from: number,
  size: number,
  other: number,
  otherSize: number,
  axis: 'rows' | 'columns',
  mono: boolean
) {
  const map: number[] = [];

  if (Math.abs(from - size) <= 1 && Math.abs(other - otherSize) <= 1) {
    for (let d = 0; d < size; d++) {
      map.push(Math.min(d, from - 1));
    }

    return map;
  }

  if (size < from) {
    for (let d = 0; d < size; d++) {
      map.push(Math.floor((d * from) / size));
    }

    return map;
  }

  if (mono && axis === 'columns') {
    const each = Math.floor(size / from);
    const extra = size % from;
    let balance = 0;

    for (let s = 0; s < from; s++) {
      let count = each;

      if (balance > 0) {
        count++;
        balance -= from;
      }

      balance += extra;

      for (let n = 0; n < count && map.length < size; n++) {
        map.push(s);
      }
    }

    return map;
  }

  const offset = mono
    ? Math.ceil(from / 2) - 1
    : axis === 'rows'
      ? from >> 1
      : (from >> 1) - 1;

  for (let d = 0; d < size; d++) {
    map.push(Math.min(Math.floor((d * from + offset) / size), from - 1));
  }

  return map;
}
