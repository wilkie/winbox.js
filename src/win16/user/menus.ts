'use strict';

import { type DeviceBitmap } from '../../raster/device-bitmap.js';

import { type MenuData } from './menu-data.js';
import { Painter, type PaintEnvironment } from './painter.js';

/**
 * What USER draws for a menu that is open: a pop-up -- pulled down from the
 * menu bar or the system menu box, or put up by `TrackPopupMenu` -- and the
 * item selected in it.
 *
 * Read off the `menus` probe's captures on four displays, one File menu of
 * every kind of item, a pop-up and the system menu:
 *
 * * A pop-up is outlined in the frame colour, and shadowed a pixel right and
 *   down in `COLOR_GRAYTEXT`, the shadow starting a pixel in from each corner.
 * * Its items are `tmHeight + 2` tall; a separator is `SM_CYMENU / 2 - 2`,
 *   its line at its middle, rounded down.
 * * Every item leaves room at its left for `OBM_CHECK`, which a checked item
 *   shows there, centred on it -- or the bitmap `SetMenuItemBitmaps` gave it
 *   for checked or unchecked, at the same place, cut to the check's size; its text follows; what follows a tab in its
 *   text, its shortcut, is in a column of its own after the longest text and
 *   eight pixels; a pop-up item shows `OBM_MNARROW` against the right edge;
 *   and fifteen pixels close the width.
 * * A selected item is filled with `COLOR_HIGHLIGHT`, its text in
 *   `COLOR_HIGHLIGHTTEXT`. A grayed item's text is `COLOR_GRAYTEXT`; grayed
 *   and selected, it is the highlight's text colour through every other pixel,
 *   as `GrayString` draws it.
 */

export const MF_GRAYED = 0x0001;
export const MF_DISABLED = 0x0002;
export const MF_CHECKED = 0x0008;
export const MF_POPUP = 0x0010;
export const MF_SEPARATOR = 0x0800;

export const OBM_MNARROW = 32739;
export const OBM_CHECK = 32760;

const SM_CYMENU = 15;

const COLOR_MENU = 4;
const COLOR_WINDOWFRAME = 6;
const COLOR_MENUTEXT = 7;
const COLOR_HIGHLIGHT = 13;
const COLOR_HIGHLIGHTTEXT = 14;
const COLOR_GRAYTEXT = 17;

/** The room after the longest text before the shortcuts, and after everything. */
const SHORTCUT_GAP = 8;
const RIGHT = 14;

/** The room between the check mark's column and the text. */
const TEXT_GAP = 1;

/** What painting a menu asks of the display. */
export interface MenuEnvironment extends PaintEnvironment {
  /** The width of a line of text in the System font. */
  measure(text: string): number;

  /** A bitmap a program made, by its handle, as `SetMenuItemBitmaps` gives one. */
  bitmapOf?(handle: number): DeviceBitmap | undefined;

  /** The System font's metrics. */
  font: { height: number; ascent: number };

  /**
   * Draws a line of text in the System font, its cell's top left at `x, y`,
   * with the character after `&` underlined; `grayed`, through every other
   * pixel only.
   */
  label(text: string, colour: number, x: number, y: number, grayed?: boolean): void;
}

/** An item's place in a pop-up, from its top border. */
export interface ItemPlace {
  top: number;
  height: number;
}

/** A pop-up's size, without its shadow, and where each item is. */
export function popupLayout(menu: MenuData, environment: MenuEnvironment) {
  const check = environment.oem.get(OBM_CHECK);
  const checkWidth = check?.width ?? 14;
  const itemHeight = environment.font.height + 2;
  const separator = (environment.metric(SM_CYMENU) >> 1) - 2;
  const places: ItemPlace[] = [];
  let text = 0;
  let shortcut = 0;
  let y = 1;

  for (const item of menu.items) {
    const [left, right] = (item.text ?? '').replace('&', '').split('\t');
    const height = item.flags & MF_SEPARATOR ? separator : itemHeight;

    places.push({ top: y, height });
    y += height;

    if (!(item.flags & MF_SEPARATOR)) {
      text = Math.max(text, environment.measure(left));

      if (right !== undefined) {
        shortcut = Math.max(shortcut, environment.measure(right));
      }
    }
  }

  const textLeft = 1 + checkWidth + TEXT_GAP;
  const shortcutLeft = textLeft + text + SHORTCUT_GAP;
  const width = shortcutLeft + (shortcut ? shortcut : -SHORTCUT_GAP) + RIGHT + 1;

  return { width, height: y + 1, places, textLeft, shortcutLeft, checkWidth };
}

/**
 * Paints a pop-up with its top left at `x, y` of `bitmap`: its border, its
 * shadow, and each item, `selected` highlighted.
 */
export function paintPopup(
  bitmap: DeviceBitmap,
  x: number,
  y: number,
  menu: MenuData,
  selected: number,
  environment: MenuEnvironment
) {
  const layout = popupLayout(menu, environment);
  const { width, height } = layout;
  const painter = new Painter(bitmap, x, y, width + 1, height + 1, environment);
  const oem = environment.oem;

  painter.fill(0, 0, width, height, painter.colour(COLOR_MENU));
  painter.outline(0, 0, width, height, painter.colour(COLOR_WINDOWFRAME));

  /* The shadow, a pixel right and down, a pixel in from each corner. */
  const shadow = painter.colour(COLOR_GRAYTEXT);

  painter.fill(width, 1, width + 1, height + 1, shadow);
  painter.fill(1, height, width + 1, height + 1, shadow);

  menu.items.forEach((item, at) => {
    const place = layout.places[at];

    if (item.flags & MF_SEPARATOR) {
      const line = place.top + (place.height >> 1);

      painter.fill(1, line, width - 1, line + 1, painter.colour(COLOR_WINDOWFRAME));
      return;
    }

    const isSelected = at === selected;
    const grayed = (item.flags & MF_GRAYED) !== 0;

    if (isSelected) {
      painter.fill(
        1,
        place.top,
        width - 1,
        place.top + place.height,
        painter.colour(COLOR_HIGHLIGHT)
      );
    }

    const own = (item as any).bitmaps;

    if (own && (own.checked || own.unchecked)) {
      /* The program's own, checked or not, where the check mark would be and
       * cut to its size; a monochrome one in the item's text colour and its
       * background, as `BitBlt` copies one (`menubmp`). */
      const handle = item.flags & MF_CHECKED ? own.checked : own.unchecked;
      const bitmap = handle ? environment.bitmapOf?.(handle) : undefined;
      const check = oem.get(OBM_CHECK);
      const w = check?.width ?? 14;
      const h = check?.height ?? 14;
      const remap =
        bitmap?.depth === 1
          ? new Map([
              [0, painter.colour(isSelected ? COLOR_HIGHLIGHTTEXT : COLOR_MENUTEXT)],
              [1, painter.colour(isSelected ? COLOR_HIGHLIGHT : COLOR_MENU)],
            ])
          : undefined;

      painter.blit(bitmap, 1, place.top + ((place.height - h) >> 1), w, 0, h, 0, remap);
    } else if (item.flags & MF_CHECKED) {
      const check = oem.get(OBM_CHECK);

      painter.blit(check, 1, place.top + ((place.height - (check?.height ?? 0)) >> 1));
    }

    if (item.flags & MF_POPUP) {
      const arrow = oem.get(OBM_MNARROW);

      painter.blit(
        arrow,
        width - 2 - (arrow?.width ?? 0),
        place.top + ((place.height - (arrow?.height ?? 0)) >> 1)
      );
    }

    /* Grayed text is `COLOR_GRAYTEXT`, unless that is 0 -- a display with no
     * solid grey, as the Hercules -- or the item is selected: then it is the
     * text's own colour through every other pixel, as `GrayString` draws it. */
    const grayText = environment.sysColor(COLOR_GRAYTEXT);
    const dithered = grayed && (isSelected || grayText === 0);
    const colour = isSelected
      ? environment.sysColor(COLOR_HIGHLIGHTTEXT)
      : grayed && !dithered
        ? grayText
        : environment.sysColor(COLOR_MENUTEXT);
    const [left, right] = (item.text ?? '').split('\t');

    environment.label(left, colour, x + layout.textLeft, y + place.top, dithered);

    if (right !== undefined) {
      environment.label(
        right,
        colour,
        x + layout.shortcutLeft,
        y + place.top,
        grayed && isSelected
      );
    }
  });

  return layout;
}
