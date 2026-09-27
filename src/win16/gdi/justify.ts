'use strict';

import { BitmapFont } from '../../raster/bitmap-font.js';
import { LogicalFont } from '../../raster/logical-font.js';

import { deviceX, mappingOf } from './mapping.js';

/**
 * Text justification: `SetTextJustification`'s extra pixels spread over a
 * line's break characters, as Write justifies a paragraph.
 *
 * **Read out** of `GDI.EXE` (seg1 `0fef`, `6bb3`, `374d`, `3bcf`, `6a65`)
 * and `VGA.DRV` (seg2 `0462`, `0542`, `0c3c`, `0c82`), and **recorded** by
 * `justify`, MS Sans Serif and Arial with extras over one to three breaks,
 * uneven, negative, with character extra, a line in two parts and
 * `ExtTextOut`'s own spacing:
 *
 * * The extra is divided by the count, truncating: each break gets that,
 *   and the remainder, with the extra's sign, is spread by an error term that
 *   starts at `count >> 1` plus one. A positive remainder comes off the term
 *   at each break, and where the term reaches nought the break gets one pixel
 *   more and the count goes back on.
 * * A negative remainder: GDI, which draws TrueType, adds it to the term and
 *   takes a pixel off where the term reaches nought, so −3 over 2 is −1 and
 *   −2. The display driver, which draws the bitmap fonts, takes it off the
 *   term, which only grows it, and takes a pixel off where the term is nought
 *   or more, so −3 over 2 is −2 and −2.
 * * A break is the font's break character: a character outside the font is
 *   its default character first. `ExtTextOut`'s own spacing is justified too.
 * * The term is kept in the device context. A bitmap font's `TextOut` moves
 *   it on once and its `GetTextExtent` not at all; a TrueType `TextOut` moves
 *   it on twice, once as it draws and once as GDI measures after, and its
 *   `GetTextExtent` once.
 *
 * Not followed: an extra with a count of nought, which divides by nought in
 * GDI; GDI keeping a negative advance from going below nought; vector fonts,
 * taken to be GDI's as TrueType is.
 */

interface Justification {
  extra: number;
  rem: number;
  count: number;
  err: number;
}

function justificationOf(surface: any): Justification | null {
  const state = surface?.justification;

  return state && state.extra !== undefined && (state.extra || state.rem) ? state : null;
}

/** Whether GDI draws the surface's font itself, rather than the display driver. */
function gdiDraws(surface: any) {
  const font = surface.font;

  return font instanceof LogicalFont && (!!font.outline || !!font.isVector);
}

/** Whether a character is the font's break character. */
function isBreak(surface: any, code: number) {
  const font = surface.font;

  if (gdiDraws(surface) || !(font instanceof LogicalFont || font instanceof BitmapFont)) {
    return code === 32;
  }

  const header = (font instanceof LogicalFont ? font.entry : font.fontFor(12)).header;
  const first = header.dfFirstChar;
  const last = header.dfLastChar;
  const character = code < first || code > last ? header.dfDefaultChar + first : code;

  return character - first === header.dfBreakChar;
}

/** One break's extra, the error term moved on. */
function step(state: Justification, gdi: boolean) {
  let extra = state.extra;

  if (state.rem > 0) {
    state.err -= state.rem;

    if (state.err <= 0) {
      state.err += state.count;
      extra++;
    }
  } else if (state.rem < 0) {
    if (gdi) {
      state.err += state.rem;

      if (state.err <= 0) {
        state.err += state.count;
        extra--;
      }
    } else {
      state.err -= state.rem;

      if (state.err >= 0) {
        state.err -= state.count;
        extra--;
      }
    }
  }

  return extra;
}

/** Each character's break extra over a string, from an error term. */
function extras(surface: any, text: string, state: Justification) {
  const gdi = gdiDraws(surface);

  return Array.from(text, (character) =>
    isBreak(surface, character.charCodeAt(0) & 0xff) ? step(state, gdi) : 0
  );
}

/**
 * The spacing a string is drawn with when justification is set: `dx`, or
 * each character's own advance, with each break's extra; the error term
 * moved on as drawing moves it. `null` when none is set.
 */
export function justifiedSpacing(surface: any, text: string, dx: number[] | null) {
  const state = justificationOf(surface);

  if (!state) {
    return null;
  }

  const drawn = { ...state };
  const added = extras(surface, text, drawn);
  const spacing = Array.from(
    text,
    (character, index) => (dx ? dx[index] : surface.font.measure(character).width) + added[index]
  );

  /* What the term is left at: once more over the string after the draw for
   * GDI's fonts, and once over it for the driver's, whose draw keeps nothing. */
  if (gdiDraws(surface)) {
    extras(surface, text, drawn);
    surface.justification = { ...state, err: drawn.err };
  } else {
    const measured = { ...state };

    extras(surface, text, measured);
    surface.justification = { ...state, err: measured.err };
  }

  return spacing;
}

/** What justification adds to a string's extent, the term moved on as measuring moves it. */
export function justifiedExtent(surface: any, text: string) {
  const state = justificationOf(surface);

  if (!state) {
    return 0;
  }

  const measured = { ...state };
  const added = extras(surface, text, measured).reduce((sum, extra) => sum + extra, 0);

  if (gdiDraws(surface)) {
    surface.justification = measured;
  }

  return added;
}

/**
 * Sets the extra to spread over the break characters of the text drawn
 * next, and the count of breaks to spread it over. Both nought turns it off.
 *
 * @param {Types.HDC} hdc - The device context.
 * @param {Types.INT} nBreakExtra - The extra, in logical units.
 * @param {Types.INT} nBreakCount - How many breaks.
 *
 * @returns {Types.INT} 1, or nought for no device context.
 */
export function SetTextJustification(
  this: any,
  hdc: number,
  nBreakExtra: number,
  nBreakCount: number
) {
  const surface = this.handles.resolve(hdc);

  if (!surface) {
    return 0;
  }

  const m = mappingOf(surface);
  const total = deviceX(m, (nBreakExtra << 16) >> 16) - deviceX(m, 0);
  const count = (nBreakCount << 16) >> 16;

  if (!count) {
    surface.justification = null;
    return 1;
  }

  surface.justification = {
    extra: Math.trunc(total / count),
    rem: total % count,
    count,
    err: (count >> 1) + 1,
  };

  return 1;
}
