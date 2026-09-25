'use strict';

import { DeviceBitmap } from '../../raster/device-bitmap.js';

/**
 * What USER draws around a window: its border or sizing frame, its caption,
 * and the system menu, minimize and maximize boxes -- the non-client area --
 * into the screen's pixels.
 *
 * Every rule here is read off the `chrome` probe's captures, and a test holds
 * this to them pixel for pixel on each display:
 *
 * * A sizing frame is `SM_CXFRAME` wide: a line in the window frame colour, the
 *   rest in the border colour, and another line inside it. A notch of the frame
 *   colour crosses it `SM_CXFRAME + SM_CXSIZE` from each corner.
 * * A thin border is one line; a dialog frame is one line and `SM_CXDLGFRAME`
 *   in the caption colour.
 * * A caption is `SM_CYCAPTION` tall, its first and last rows lines, on the
 *   frame's inner line or the border itself. The system menu box is the left
 *   half of the display driver's `OBM_CLOSE`, then a line; the maximize box is
 *   `OBM_ZOOM` against the right edge and the minimize box `OBM_REDUCE` beside
 *   it, each 19 wide with its own separating line. The title is centred in
 *   what is left.
 * * Active and inactive windows differ only in colours: the caption, the
 *   caption text and the border.
 *
 * The OEM bitmaps are the display driver's own, read from the installation the
 * person supplied: they are never part of this project.
 */

export const WS_POPUP = 0x80000000;
export const WS_CAPTION = 0x00c00000;
export const WS_BORDER = 0x00800000;
export const WS_DLGFRAME = 0x00400000;
export const WS_VSCROLL = 0x00200000;
export const WS_HSCROLL = 0x00100000;
export const WS_SYSMENU = 0x00080000;
export const WS_THICKFRAME = 0x00040000;
export const WS_MINIMIZEBOX = 0x00020000;
export const WS_MAXIMIZEBOX = 0x00010000;

export const OBM_CLOSE = 32754;
export const OBM_REDUCE = 32749;
export const OBM_ZOOM = 32748;

const SM_CXSIZE = 30;
const SM_CYSIZE = 31;
const SM_CXFRAME = 32;
const SM_CYFRAME = 33;
const SM_CYCAPTION = 4;
const SM_CXDLGFRAME = 7;
const SM_CYDLGFRAME = 8;

const COLOR_ACTIVECAPTION = 2;
const COLOR_INACTIVECAPTION = 3;
const COLOR_WINDOWFRAME = 6;
const COLOR_CAPTIONTEXT = 9;
const COLOR_ACTIVEBORDER = 10;
const COLOR_INACTIVEBORDER = 11;
const COLOR_INACTIVECAPTIONTEXT = 19;

export interface FrameEnvironment {
  /** `GetSystemMetrics`, for the display the window is on. */
  metric(index: number): number;

  /** `GetSysColor`, as a `COLORREF`. */
  sysColor(index: number): number;

  /** The display driver's OEM bitmaps, by id, at the screen's depth. */
  oem: Map<number, DeviceBitmap>;

  /**
   * Draws the title in the caption: the text, the colour as a `COLORREF`, and
   * the rectangle to centre it in, left, top, right and bottom.
   */
  title(text: string, colour: number, box: [number, number, number, number]): void;
}

export interface Frame {
  style: number;
  active: boolean;
  title: string;
}

/**
 * Paints a window's non-client area into `screen` for a window whose outer
 * rectangle is `left, top, width, height` there, and returns its client
 * rectangle, relative to the window.
 */
export function paintFrame(
  screen: DeviceBitmap,
  left: number,
  top: number,
  width: number,
  height: number,
  frame: Frame,
  environment: FrameEnvironment
) {
  const palette = screen.devicePalette;
  const index = (colorref: number) =>
    palette.index(colorref & 0xff, (colorref >> 8) & 0xff, (colorref >> 16) & 0xff);
  const colour = (system: number) => index(environment.sysColor(system));

  const fill = (x0: number, y0: number, x1: number, y1: number, value: number) => {
    for (let y = Math.max(y0, 0); y < Math.min(y1, height); y++) {
      for (let x = Math.max(x0, 0); x < Math.min(x1, width); x++) {
        const sx = left + x;
        const sy = top + y;

        if (sx >= 0 && sy >= 0 && sx < screen.width && sy < screen.height) {
          screen.indices[sy * screen.width + sx] = value;
        }
      }
    }
  };

  const outline = (x0: number, y0: number, x1: number, y1: number, value: number) => {
    fill(x0, y0, x1, y0 + 1, value);
    fill(x0, y1 - 1, x1, y1, value);
    fill(x0, y0, x0 + 1, y1, value);
    fill(x1 - 1, y0, x1, y1, value);
  };

  const blit = (bitmap: DeviceBitmap | undefined, x: number, y: number, w: number, sx = 0) => {
    if (!bitmap) {
      return;
    }

    for (let row = 0; row < bitmap.height; row++) {
      for (let column = 0; column < w; column++) {
        fill(
          x + column,
          y + row,
          x + column + 1,
          y + row + 1,
          bitmap.indices[row * bitmap.width + sx + column]
        );
      }
    }
  };

  const style = frame.style >>> 0;
  const line = colour(COLOR_WINDOWFRAME);
  const hasCaption = (style & WS_CAPTION) === WS_CAPTION;
  const thick = (style & WS_THICKFRAME) !== 0;
  const dialog = !hasCaption && (style & WS_DLGFRAME) !== 0;
  const bordered = hasCaption || (style & WS_BORDER) !== 0;

  /* The edges, and where inside them the window's own area starts. */
  let inset = 0;
  let insetY = 0;

  if (thick) {
    inset = environment.metric(SM_CXFRAME);
    insetY = environment.metric(SM_CYFRAME);

    const border = colour(frame.active ? COLOR_ACTIVEBORDER : COLOR_INACTIVEBORDER);

    fill(0, 0, width, insetY, border);
    fill(0, height - insetY, width, height, border);
    fill(0, 0, inset, height, border);
    fill(width - inset, 0, width, height, border);
    outline(0, 0, width, height, line);
    outline(inset - 1, insetY - 1, width - inset + 1, height - insetY + 1, line);

    /* The notches, where a drag on the frame sizes a corner rather than an edge. */
    const across = inset + environment.metric(SM_CXSIZE);
    const down = insetY + environment.metric(SM_CYSIZE);

    for (const x of [across, width - 1 - across]) {
      fill(x, 1, x + 1, insetY - 1, line);
      fill(x, height - insetY + 1, x + 1, height - 1, line);
    }

    for (const y of [down, height - 1 - down]) {
      fill(1, y, inset - 1, y + 1, line);
      fill(width - inset + 1, y, width - 1, y + 1, line);
    }
  } else if (dialog) {
    const edge = environment.metric(SM_CXDLGFRAME);
    const edgeY = environment.metric(SM_CYDLGFRAME);

    const ring = colour(frame.active ? COLOR_ACTIVECAPTION : COLOR_INACTIVECAPTION);

    inset = edge + 1;
    insetY = edgeY + 1;
    fill(0, 0, width, insetY, ring);
    fill(0, height - insetY, width, height, ring);
    fill(0, 0, inset, height, ring);
    fill(width - inset, 0, width, height, ring);
    outline(0, 0, width, height, line);
  } else if (bordered) {
    outline(0, 0, width, height, line);
    inset = 1;
    insetY = 1;
  }

  const client = { left: inset, top: insetY, right: width - inset, bottom: height - insetY };

  if (!hasCaption) {
    return client;
  }

  /* The caption: its top row is the frame's inner line, or the border. */
  const captionTop = thick ? insetY - 1 : 0;
  const captionHeight = environment.metric(SM_CYCAPTION);
  const rowTop = captionTop + 1;
  const rowBottom = captionTop + captionHeight - 1;

  fill(inset, captionTop + captionHeight - 1, width - inset, captionTop + captionHeight, line);

  let barLeft = inset;
  let barRight = width - inset;

  if (style & WS_SYSMENU) {
    const close = environment.oem.get(OBM_CLOSE);
    const size = close ? close.width / 2 : environment.metric(SM_CXSIZE);

    blit(close, inset, rowTop, size);
    fill(inset + size, rowTop, inset + size + 1, rowBottom, line);
    barLeft = inset + size + 1;
  }

  if (style & WS_MAXIMIZEBOX) {
    const zoom = environment.oem.get(OBM_ZOOM);
    const size = zoom?.width ?? environment.metric(SM_CXSIZE) + 1;

    barRight -= size;
    blit(zoom, barRight, rowTop, size);
  }

  if (style & WS_MINIMIZEBOX) {
    const reduce = environment.oem.get(OBM_REDUCE);
    const size = reduce?.width ?? environment.metric(SM_CXSIZE) + 1;

    barRight -= size;
    blit(reduce, barRight, rowTop, size);
  }

  fill(
    barLeft,
    rowTop,
    barRight,
    rowBottom,
    colour(frame.active ? COLOR_ACTIVECAPTION : COLOR_INACTIVECAPTION)
  );

  environment.title(
    frame.title,
    environment.sysColor(frame.active ? COLOR_CAPTIONTEXT : COLOR_INACTIVECAPTIONTEXT),
    [left + barLeft, top + rowTop, left + barRight, top + rowBottom]
  );

  client.top = captionTop + captionHeight;

  return client;
}
