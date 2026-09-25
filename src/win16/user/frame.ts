'use strict';

import { DeviceBitmap } from '../../raster/device-bitmap.js';
import { ditherTile } from '../../raster/dither.js';

/**
 * What USER draws around a window: its border or sizing frame, its caption,
 * the system menu, minimize and maximize boxes, its menu bar and its scroll
 * bars -- the non-client area -- into the screen's pixels.
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
 * * A menu bar is `SM_CYMENU` of the menu colour under the caption, then a
 *   line; each item is its text with eight pixels either side, its mnemonic
 *   underlined a row below the font's ascent.
 * * A scroll bar is `SM_CXVSCROLL` or `SM_CYHSCROLL` of the scroll bar colour,
 *   outlined, sharing its edge lines with what is next to it: the driver's
 *   arrow bitmaps at its ends, and a raised thumb overlapping the first. Both
 *   bars fill the box between them.
 * * Every area is filled with a brush of its colour, so a colour the display
 *   lacks is patterned as the driver patterns a brush -- the Hercules's grey
 *   border is a checkerboard. See `ditheredIndex`.
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
export const OBM_LFARROW = 32750;
export const OBM_RGARROW = 32751;
export const OBM_DNARROW = 32752;
export const OBM_UPARROW = 32753;

const SM_CXVSCROLL = 2;
const SM_CYHSCROLL = 3;
const SM_CYVTHUMB = 9;
const SM_CXHTHUMB = 10;
const SM_CYMENU = 15;
const SM_CYVSCROLL = 20;
const SM_CXHSCROLL = 21;
const SM_CXSIZE = 30;
const SM_CYSIZE = 31;
const SM_CXFRAME = 32;
const SM_CYFRAME = 33;
const SM_CYCAPTION = 4;
const SM_CXDLGFRAME = 7;
const SM_CYDLGFRAME = 8;

const COLOR_SCROLLBAR = 0;

/**
 * The space either side of a menu bar item's text. The captures fix it at
 * eight on every display, but every display's System font averages seven
 * pixels a character, so whether it follows the font is not measured.
 */
const MENU_GAP = 8;
const COLOR_ACTIVECAPTION = 2;
const COLOR_INACTIVECAPTION = 3;
const COLOR_MENU = 4;
const COLOR_WINDOWFRAME = 6;
const COLOR_MENUTEXT = 7;
const COLOR_CAPTIONTEXT = 9;
const COLOR_ACTIVEBORDER = 10;
const COLOR_INACTIVEBORDER = 11;
const COLOR_BTNFACE = 15;
const COLOR_BTNSHADOW = 16;
const COLOR_INACTIVECAPTIONTEXT = 19;
const COLOR_BTNHIGHLIGHT = 20;

export interface FrameEnvironment {
  /** The display mode, whose driver patterns the brushes. */
  display: any;

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

  /** The width of a line of text in the System font. */
  measure(text: string): number;

  /** The System font's height and ascent, as `GetTextMetrics` gives them. */
  font: { height: number; ascent: number };

  /** Draws a line of text in the System font, its cell's top left at `x, y`. */
  text(text: string, colour: number, x: number, y: number): void;
}

export interface Frame {
  style: number;
  active: boolean;
  title: string;

  /** The menu bar's items, as `AppendMenu` was given them, `&` and all. */
  menu?: string[];
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

  /* A brush of a system colour: an index, or a pattern by screen pixel. */
  type Paint = number | Uint8Array;

  const colour = (system: number): Paint => {
    const colorref = environment.sysColor(system);
    const [red, green, blue] = [colorref & 0xff, (colorref >> 8) & 0xff, (colorref >> 16) & 0xff];

    return (
      ditherTile(environment.display, palette, red, green, blue) ?? palette.index(red, green, blue)
    );
  };

  const fill = (x0: number, y0: number, x1: number, y1: number, paint: Paint) => {
    for (let y = Math.max(y0, 0); y < Math.min(y1, height); y++) {
      for (let x = Math.max(x0, 0); x < Math.min(x1, width); x++) {
        const sx = left + x;
        const sy = top + y;

        screen.put(
          sx,
          sy,
          typeof paint === 'number'
            ? paint
            : paint[(((sy + screen.originY) & 7) << 3) | ((sx + screen.originX) & 7)]
        );
      }
    }
  };

  const outline = (x0: number, y0: number, x1: number, y1: number, value: Paint) => {
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

  if (hasCaption) {
    client.top = paintCaption();
  }

  if (frame.menu) {
    client.top = paintMenu(client.top);
  }

  paintScrollBars();

  return client;

  /** The caption and its boxes; returns where the client area would start. */
  function paintCaption() {
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

    return captionTop + captionHeight;
  }

  /** The menu bar, from `from`; returns where the client area starts below it. */
  function paintMenu(from: number) {
    const bar = environment.metric(SM_CYMENU);
    const ink = colour(COLOR_MENUTEXT);
    let x = inset;

    /* The text's cell, one pixel less than centred in the bar: 0 in the
     * VGA's 18 for a font of 16, 1 in the EGA's 16 for a font of 12. Half the
     * difference less one, or a quarter of it, or centred in the bar less one
     * pixel -- the four displays have only these two, and all three fit. */
    const cell = ((bar - environment.font.height) >> 1) - 1;
    const underline = cell + environment.font.ascent + 1;

    fill(inset, from, width - inset, from + bar, colour(COLOR_MENU));
    fill(inset, from + bar, width - inset, from + bar + 1, line);

    for (const item of frame.menu!) {
      const at = item.indexOf('&');
      const text = item.replace('&', '');

      environment.text(
        text,
        environment.sysColor(COLOR_MENUTEXT),
        left + x + MENU_GAP,
        top + from + cell
      );

      /* The mnemonic, underlined. */
      if (at >= 0 && at < text.length) {
        const under = x + MENU_GAP + environment.measure(text.slice(0, at));

        fill(
          under,
          from + underline,
          under + environment.measure(text[at]),
          from + underline + 1,
          ink
        );
      }

      x += environment.measure(text) + 2 * MENU_GAP;
    }

    return from + bar + 1;
  }

  /** The scroll bars, and the box between them. */
  function paintScrollBars() {
    const vertical = (style & WS_VSCROLL) !== 0;
    const horizontal = (style & WS_HSCROLL) !== 0;
    const trough = colour(COLOR_SCROLLBAR);

    if (vertical) {
      client.right -= environment.metric(SM_CXVSCROLL) - 1;
    }

    if (horizontal) {
      client.bottom -= environment.metric(SM_CYHSCROLL) - 1;
    }

    if (vertical) {
      const x0 = client.right;
      const x1 = x0 + environment.metric(SM_CXVSCROLL);
      const y0 = client.top - 1;
      const y1 = client.bottom + 1;
      const arrow = environment.metric(SM_CYVSCROLL);

      fill(x0, y0, x1, y1, trough);
      outline(x0, y0, x1, y1, line);
      blit(environment.oem.get(OBM_UPARROW), x0, y0, x1 - x0);
      blit(environment.oem.get(OBM_DNARROW), x0, y1 - arrow, x1 - x0);
      thumb(x0, y0 + arrow - 1, x1, y0 + arrow - 1 + environment.metric(SM_CYVTHUMB));
    }

    if (horizontal) {
      const x0 = client.left - 1;
      const x1 = client.right + 1;
      const y0 = client.bottom;
      const y1 = y0 + environment.metric(SM_CYHSCROLL);
      const arrow = environment.metric(SM_CXHSCROLL);

      fill(x0, y0, x1, y1, trough);
      outline(x0, y0, x1, y1, line);
      blit(environment.oem.get(OBM_LFARROW), x0, y0, arrow);
      blit(environment.oem.get(OBM_RGARROW), x1 - arrow, y0, arrow);
      thumb(x0 + arrow - 1, y0, x0 + arrow - 1 + environment.metric(SM_CXHTHUMB), y1);
    }

    if (vertical && horizontal) {
      fill(
        client.right + 1,
        client.bottom + 1,
        client.right + environment.metric(SM_CXVSCROLL) - 1,
        client.bottom + environment.metric(SM_CYHSCROLL) - 1,
        trough
      );
    }
  }

  /**
   * The thumb: a raised box in the button face, outlined, lit one pixel
   * along the top and left and shadowed two along the bottom and right.
   */
  function thumb(x0: number, y0: number, x1: number, y1: number) {
    const shadow = colour(COLOR_BTNSHADOW);
    const light = colour(COLOR_BTNHIGHLIGHT);

    fill(x0, y0, x1, y1, colour(COLOR_BTNFACE));
    fill(x0 + 1, y0 + 1, x1 - 2, y0 + 2, light);
    fill(x0 + 1, y0 + 1, x0 + 2, y1 - 2, light);
    fill(x1 - 2, y0 + 1, x1 - 1, y1 - 1, shadow);
    fill(x0 + 1, y1 - 2, x1 - 1, y1 - 1, shadow);
    fill(x1 - 3, y0 + 2, x1 - 2, y1 - 2, shadow);
    fill(x0 + 2, y1 - 3, x1 - 2, y1 - 2, shadow);
    outline(x0, y0, x1, y1, line);
  }
}
