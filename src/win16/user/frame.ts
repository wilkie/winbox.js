'use strict';

import { DeviceBitmap } from '../../raster/device-bitmap.js';
import { Painter, type PaintEnvironment } from './painter.js';

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
export const OBM_RESTORE = 32747;
export { OBM_DNARROW, OBM_LFARROW, OBM_RGARROW, OBM_UPARROW } from './painter.js';

const SM_CXVSCROLL = 2;
const SM_CYHSCROLL = 3;
const SM_CYMENU = 15;
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
const COLOR_WINDOW = 5;
const COLOR_WINDOWFRAME = 6;
const COLOR_MENUTEXT = 7;
const COLOR_HIGHLIGHT = 13;
const COLOR_HIGHLIGHTTEXT = 14;
const COLOR_CAPTIONTEXT = 9;
const COLOR_ACTIVEBORDER = 10;
const COLOR_INACTIVEBORDER = 11;
const COLOR_INACTIVECAPTIONTEXT = 19;

export interface FrameEnvironment extends PaintEnvironment {
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

  /** The scroll bars' ranges and positions, where the thumbs go; 0 to 100 at 0 without. */
  scroll?: { vertical?: ScrollPlace; horizontal?: ScrollPlace };

  /** The class's background, which a scroll bar with both arrows off shows. */
  background?: { colorref: number } | null;
  active: boolean;
  title: string;

  /** The menu bar's items, as `AppendMenu` was given them, `&` and all. */
  menu?: string[];

  /** The menu bar's item that is selected, while a menu is open from it. */
  menuSelected?: number;

  /** Whether the system menu is open, which shows its box inverted. */
  systemMenuOpen?: boolean;

  /** Whether the window is maximized: its maximize box is then a restore box. */
  zoomed?: boolean;

  /** A dialog's modal frame, `DS_MODALFRAME`: a dialog frame around a caption. */
  modal?: boolean;
}

/**
 * Paints a window's non-client area into `screen` for a window whose outer
 * rectangle is `left, top, width, height` there, and returns its client
 * rectangle, relative to the window.
 */
/** A scroll bar's range and position. */
export interface ScrollPlace {
  min: number;
  max: number;
  pos: number;

  /** The arrows turned off: 1 the top or left, 2 the bottom or right. */
  flags?: number;
}

export function paintFrame(
  screen: DeviceBitmap,
  left: number,
  top: number,
  width: number,
  height: number,
  frame: Frame,
  environment: FrameEnvironment
) {
  const painter = new Painter(screen, left, top, width, height, environment);
  const colour = (system: number) => painter.colour(system);
  const fill = painter.fill.bind(painter);
  const outline = painter.outline.bind(painter);
  const blit = painter.blit.bind(painter);

  const style = frame.style >>> 0;
  const line = colour(COLOR_WINDOWFRAME);
  const hasCaption = (style & WS_CAPTION) === WS_CAPTION;
  const thick = (style & WS_THICKFRAME) !== 0;
  const modal = !!frame.modal && !thick;
  const dialog = modal || (!hasCaption && (style & WS_DLGFRAME) !== 0);
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
    /* The caption: its top row is the frame's inner line, or the border.
     *
     * In a modal frame it is the ring's inner row, and the caption's top row
     * and its two sides are the window colour: measured by the `dialogs`
     * probe, and which colour by `dlgcolor`, which turned each of the white
     * system colours red in turn. What is in the caption starts a pixel in. */
    const captionTop = thick || modal ? insetY - 1 : 0;
    const captionHeight = environment.metric(SM_CYCAPTION);
    const rowTop = captionTop + 1;
    const rowBottom = captionTop + captionHeight - 1;
    const edge = modal ? inset + 1 : inset;

    if (modal) {
      const window = colour(COLOR_WINDOW);

      fill(inset, captionTop, width - inset, captionTop + 1, window);
      fill(inset, captionTop, edge, captionTop + captionHeight, window);
      fill(width - edge, captionTop, width - inset, captionTop + captionHeight, window);
    }

    fill(edge, captionTop + captionHeight - 1, width - edge, captionTop + captionHeight, line);

    let barLeft = edge;
    let barRight = width - edge;

    if (style & WS_SYSMENU) {
      const close = environment.oem.get(OBM_CLOSE);
      const size = close ? close.width / 2 : environment.metric(SM_CXSIZE);

      blit(close, edge, rowTop, size);
      fill(edge + size, rowTop, edge + size + 1, rowBottom, line);

      if (frame.systemMenuOpen) {
        painter.invert(edge, rowTop, edge + size, rowBottom);
      }
      barLeft = edge + size + 1;
    }

    if (style & WS_MAXIMIZEBOX) {
      const zoom = environment.oem.get(frame.zoomed ? OBM_RESTORE : OBM_ZOOM);
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
    let x = inset;

    /* The text's cell, one pixel less than centred in the bar: 0 in the
     * VGA's 18 for a font of 16, 1 in the EGA's 16 for a font of 12. Half the
     * difference less one, or a quarter of it, or centred in the bar less one
     * pixel -- the four displays have only these two, and all three fit. */
    const cell = ((bar - environment.font.height) >> 1) - 1;
    const underline = cell + environment.font.ascent + 1;

    fill(inset, from, width - inset, from + bar, colour(COLOR_MENU));
    fill(inset, from + bar, width - inset, from + bar + 1, line);

    for (const [index, item] of frame.menu!.entries()) {
      const at = item.indexOf('&');
      const text = item.replace('&', '');
      const selected = index === frame.menuSelected;
      const ink = colour(selected ? COLOR_HIGHLIGHTTEXT : COLOR_MENUTEXT);

      /* A selected item: the highlight, the text's width and the space either side. */
      if (selected) {
        fill(
          x,
          from,
          x + environment.measure(text) + 2 * MENU_GAP,
          from + bar,
          colour(COLOR_HIGHLIGHT)
        );
      }

      environment.text(
        text,
        environment.sysColor(selected ? COLOR_HIGHLIGHTTEXT : COLOR_MENUTEXT),
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
    const across = environment.metric(SM_CXVSCROLL);
    const down = environment.metric(SM_CYHSCROLL);

    /* A bar shares its outer line with the window's edge when there is one;
     * a window without edges has its bars at its own edge (`USER.EXE` seg18
     * `0f5f`), as `mledit`'s borderless edit control records. */
    const overlap = inset > 0 || insetY > 0 ? 1 : 0;

    if (vertical) {
      client.right -= across - overlap;
    }

    if (horizontal) {
      client.bottom -= down - overlap;
    }

    if (vertical) {
      painter.scrollBar(
        client.right,
        client.top - overlap,
        client.right + across,
        client.bottom + 1,
        true,
        frame.scroll?.vertical && { ...frame.scroll.vertical, shaft: frame.background?.colorref ?? null }
      );
    }

    if (horizontal) {
      painter.scrollBar(
        client.left - overlap,
        client.bottom,
        client.right + 1,
        client.bottom + down,
        false,
        frame.scroll?.horizontal && { ...frame.scroll.horizontal, shaft: frame.background?.colorref ?? null }
      );
    }

    if (vertical && horizontal) {
      fill(
        client.right + 1,
        client.bottom + 1,
        client.right + across - overlap,
        client.bottom + down - overlap,
        trough
      );
    }
  }
}
