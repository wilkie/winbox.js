'use strict';

import { GetTextExtent } from '../gdi/GetTextExtent.js';
import { GetTextMetrics } from '../gdi/GetTextMetrics.js';
import { SYSTEM_FONT, stockFontHandle } from '../gdi/stock-fonts.js';
import { TextOut } from '../gdi/TextOut.js';
import { deviceRect, mapped } from '../gdi/mapping.js';

/**
 * Text drawn inside a rectangle, broken into lines, aligned, its prefix
 * character underlined and its tabs expanded: `DrawText`.
 *
 * **Read out of `USER.EXE`** (seg6 `0571`; the prefix, seg1 `10c4`, `1168`)
 * and **recorded** by `drawtext` on four displays.
 *
 * * **Lines** end at CR, LF, CR LF or LF CR. With `DT_WORDBREAK`, the text is
 *   taken a word, a space or a tab at a time, and a line ends before the
 *   piece that would take it past the rectangle's width -- never inside a
 *   word, so a word too long overflows. Left-aligned, a space that would have
 *   gone past is dropped, and after a line end one leading space is too. A
 *   line's height is the font's, and its external leading with
 *   `DT_EXTERNALLEADING`.
 * * **One line**, with `DT_SINGLELINE`: CR and LF are characters, and it goes
 *   at the top, at the bottom with `DT_BOTTOM`, or halfway with
 *   `DT_VCENTER`, the half rounded towards nought.
 * * **Across**, centred lines take half what is left over, rounded down.
 * * **The prefix**: `&` is dropped and the character after it underlined;
 *   `&&` is an `&`. The underline is a row of the text colour, one below the
 *   ascent, as wide as the character less half the overhang.
 * * **Tabs**, with `DT_EXPANDTABS`, go to the next stop past half an average
 *   character on, a stop every eight averages -- `DT_TABSTOP` gives the count
 *   in the format's high byte, and loses the flags there. The average is
 *   USER's own for the System font, and `tmAveCharWidth` for any other.
 * * **Clipped** to the rectangle unless `DT_NOCLIP`, and lines stop once one
 *   would start past its bottom.
 * * **`DT_CALCRECT`** draws nothing: the rectangle's right is set to its left
 *   and the widest line, and its bottom to the last line's. A line wider than
 *   the rectangle lays the text out again at that width.
 *
 * The answer is how far down the last line ends, from the rectangle's top.
 * A rectangle with no width, or a count of nought, draws nothing and answers
 * the top, negated; `DT_CALCRECT` then takes the widest line of the last
 * `DrawText`, as USER keeps it. Not followed: mapping modes other than
 * `MM_TEXT`.
 */

const DT_CENTER = 0x0001;
const DT_RIGHT = 0x0002;
const DT_VCENTER = 0x0004;
const DT_BOTTOM = 0x0008;
const DT_WORDBREAK = 0x0010;
const DT_SINGLELINE = 0x0020;
const DT_EXPANDTABS = 0x0040;
const DT_TABSTOP = 0x0080;
const DT_NOCLIP = 0x0100;
const DT_EXTERNALLEADING = 0x0200;
const DT_CALCRECT = 0x0400;
const DT_NOPREFIX = 0x0800;

/** A string with its prefix characters taken out, and where the underlined one is (seg1 `10c4`). */
function stripPrefix(text: string) {
  let out = '';
  let index = -1;

  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '&') {
      out += text[i];
    } else if (text[i + 1] === '&') {
      out += '&';
      i++;
    } else {
      index = out.length;
    }
  }

  return { out, index, removed: text.length - out.length };
}

/** What laying out text asks of whatever it is drawn on. */
export interface TextOps {
  /** A string's width. */
  extent(text: string): number;
  /** The font's metrics. */
  metrics: { height: number; externalLeading: number; overhang: number; ascent: number; average: number };
  /** Whether the font is the System font, whose tab stops are USER's own average's. */
  isSystem: boolean;
  /** Draws a string with its cell's top left at a point. */
  textOut(x: number, y: number, text: string): void;
  /** Fills a rectangle in the text's colour: a prefix's underline. */
  underline(left: number, top: number, right: number, bottom: number): void;
  /** Runs a drawing clipped to a rectangle. */
  withClip(rect: { left: number; top: number; right: number; bottom: number }, draw: () => void): void;
  /** The widest line of the last layout, kept between calls, as USER keeps it. */
  widest: { value: number };
}

/**
 * Text laid out in a rectangle as `DrawText` lays it out, on whatever `ops`
 * draws on: `DrawText` itself, and the static control's text (`USER.EXE`
 * seg25 `1fe5`). The rectangle is changed in place for `DT_CALCRECT`; the
 * answer is `DrawText`'s.
 */
export function layoutText(ops: TextOps, lpsz: any, cch: number, lprc: any, uFormat: number): number {
  const original = uFormat & 0xffff;
  let format = original;
  let tabCount = 8;

  if (format & DT_TABSTOP) {
    tabCount = (format >> 8) & 0xff;
    format &= 0xff;
  }

  const count = (cch << 16) >> 16;
  const left = lprc.left;
  const top = lprc.top;
  const width = lprc.right - lprc.left;

  /* Nothing to lay out: nothing drawn (seg6 `0636`). */
  if (width === 0 || count === 0) {
    if (format & DT_CALCRECT) {
      lprc.right = left + ops.widest.value;
      lprc.bottom = 0;
    }

    return -top;
  }

  const text = String(lpsz ?? '').slice(0, count < 0 ? undefined : count);
  const extent = (s: string) => (s.length ? ops.extent(s) : 0);
  const tm = ops.metrics;
  const lineHeight = tm.height + (format & DT_EXTERNALLEADING ? tm.externalLeading : 0);
  const overhang = tm.overhang ?? 0;
  const average = ops.isSystem
    ? Math.trunc((Math.trunc(extent('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ') / 26) + 1) / 2)
    : tm.average;
  const stop = average * tabCount;
  const calc = (format & DT_CALCRECT) !== 0;
  const noPrefix = (format & DT_NOPREFIX) !== 0;
  const leftAligned = !(format & (DT_CENTER | DT_RIGHT));
  let widest = 0;

  /* A line drawn with its prefix underlined (seg1 `1168`). */
  const prefixTextOut = (x: number, y: number, line: string) => {
    const { out, index } = stripPrefix(line);

    ops.textOut(x, y, out);

    if (index < 0) {
      return;
    }

    const ux = x + (index > 0 ? extent(out.slice(0, index)) - overhang : 0);
    const cw = extent(out[index] ?? '\0');
    const uy = y + tm.ascent + 1;

    ops.underline(ux, uy, ux + cw - Math.trunc(overhang / 2), uy + 1);
  };

  /* A line measured, or drawn, from `x` (seg6 `0360`); where it ends. */
  const drawLine = (x: number, y: number, start: number, end: number, measure: boolean): number => {
    const line = text.slice(start, end);
    const adjust = noPrefix ? 0 : stripPrefix(line).removed * (extent('&') - overhang);
    let origin = left;

    if (!measure && format & (DT_CENTER | DT_RIGHT)) {
      const spare = width - drawLine(0, y, start, end, true);

      origin = (format & DT_CENTER ? Math.floor(spare / 2) : spare) + left;
    }

    const put = (at: number, piece: string) => {
      if (measure || calc) {
        return;
      }

      if (noPrefix) {
        ops.textOut(at, y, piece);
      } else {
        prefixTextOut(at, y, piece);
      }
    };

    if (!measure && !(format & DT_EXPANDTABS)) {
      put(x + origin, line);
      x += extent(line) - adjust;
    } else {
      const pieces = line.split('\t');

      pieces.forEach((piece, i) => {
        put(x + origin, piece);
        x += extent(piece) - overhang - adjust;

        if (i < pieces.length - 1 && stop) {
          x = (Math.trunc((x + Math.trunc(average / 2)) / stop) + 1) * stop;
        }
      });
    }

    x += overhang;

    if (!measure) {
      widest = Math.max(widest, x);
    }

    return x;
  };

  /* The next piece: a word, or a space or a tab by itself (seg6 `0311`). */
  const chunk = (p: number, wordBreak: boolean) => {
    const c = text[p];

    if (c === '\t' || (wordBreak && c === ' ')) {
      return p + 1;
    }

    let q = p;

    while (q < text.length) {
      const d = text[q];

      if (d === '\r' || d === '\n' || d === '\t' || (wordBreak && d === ' ')) {
        break;
      }

      q++;
    }

    return q;
  };

  let y = top;
  const run = () => {
    if (format & DT_SINGLELINE) {
      const where = format & (DT_VCENTER | DT_BOTTOM);

      if (where === DT_VCENTER) {
        y = top + Math.trunc((lprc.bottom - top - tm.height) / 2);
      } else if (where === DT_BOTTOM) {
        y = lprc.bottom - tm.height;
      }

      drawLine(0, y, 0, text.length, false);
      return;
    }

    const wordBreak = (format & DT_WORDBREAK) !== 0;
    let lineStart = 0;
    let lineEnd = 0;
    let p = 0;
    let across = 0;

    while (p < text.length) {
      let q = chunk(p, wordBreak);
      let done = false;

      lineEnd = q;
      across = drawLine(across, 0, p, q, true) - overhang;

      if (wordBreak && across + overhang > width && p !== lineStart) {
        if (leftAligned && text[p] === ' ') {
          p++;
        }

        lineEnd = p;
        done = true;
      } else if (q < text.length && (text[q] === '\r' || text[q] === '\n')) {
        const first = text.charCodeAt(q);

        q++;

        if (q < text.length && text.charCodeAt(q) === (first ^ 7)) {
          q++;
        }

        done = true;

        if (leftAligned && q < text.length && text[q] === ' ') {
          q++;
        }

        p = q;
      } else {
        p = q;
      }

      if (done) {
        drawLine(0, y, lineStart, lineEnd, false);
        across = 0;
        y += lineHeight;
        lineStart = lineEnd = p;

        if (!(format & (DT_NOCLIP | DT_CALCRECT)) && y > lprc.bottom) {
          break;
        }
      }
    }

    drawLine(0, y, lineStart, lineEnd, false);
  };

  if (format & DT_NOCLIP || calc) {
    run();
  } else {
    ops.withClip({ left: lprc.left, top: lprc.top, right: lprc.right, bottom: lprc.bottom }, run);
  }

  ops.widest.value = widest;

  if (calc) {
    lprc.right = left + widest;

    /* Wider than it was given: laid out again at that width (seg6 `0935`). */
    if (widest > width) {
      return layoutText(ops, lpsz, cch, lprc, original);
    }

    lprc.bottom = y + lineHeight;
  }

  return y - top + lineHeight;
}

/**
 * The average character width tab stops are counted in: USER's own for the
 * System font, from the extent of the alphabet, and `tmAveCharWidth` for any
 * other. `DrawText` and `TabbedTextOut` both use it.
 */
export function tabAverage(system: any, hdc: number) {
  const surface = system.handles.resolve(hdc);
  const tm: any = {};

  GetTextMetrics.call(system, hdc, tm);

  const systemFont = system.handles.resolve(stockFontHandle(system, SYSTEM_FONT));
  const isSystem =
    !!surface?.font &&
    (surface.font === systemFont ||
      (!!surface.font.entry && surface.font.entry === systemFont?.entry && !surface.font.outline));

  if (!isSystem) {
    return tm.tmAveCharWidth;
  }

  const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const width = GetTextExtent.call(system, hdc, letters, letters.length) & 0xffff;

  return Math.trunc((Math.trunc(width / 26) + 1) / 2);
}

export function DrawText(this: any, hdc: number, lpsz: any, cch: number, lprc: any, uFormat: number) {
  const surface = this.handles.resolve(hdc);

  if (!surface || !lprc) {
    return 0;
  }

  const system = this;
  const tm: any = {};

  GetTextMetrics.call(system, hdc, tm);

  const systemFont = system.handles.resolve(stockFontHandle(system, SYSTEM_FONT));
  /* The System font as selected: a font realised on its strike, unscaled.
   * Each realising makes a new font object, so the strike is what compares. */
  const isSystem =
    !!surface.font &&
    (surface.font === systemFont ||
      (!!surface.font.entry && surface.font.entry === systemFont?.entry && !surface.font.outline));

  system._drawTextWidest ??= { value: 0 };

  /* The rectangle is logical, as the text is: where a mapping moves it, so
   * does what the text is clipped to. Delphi draws each of a form's labels
   * with the viewport's origin moved to the label and a rectangle at (0,0);
   * Championship Slots of the corpus lost all its labels to a clip left at
   * the form's corner. */
  const inDevice = (rect: { left: number; top: number; right: number; bottom: number }) =>
    mapped(surface) ? deviceRect(surface, rect.left, rect.top, rect.right, rect.bottom) : rect;

  return layoutText(
    {
      extent: (s) => GetTextExtent.call(system, hdc, s, s.length) & 0xffff,
      metrics: {
        height: tm.tmHeight,
        externalLeading: tm.tmExternalLeading,
        overhang: tm.tmOverhang ?? 0,
        ascent: tm.tmAscent,
        average: tm.tmAveCharWidth,
      },
      isSystem,
      textOut: (x, y, s) => TextOut.call(system, hdc, x, y, s, s.length),
      underline: (left, top, right, bottom) => {
        const ground = surface.backcolor;

        surface.backcolor = surface.textColor;
        surface.paintGround(inDevice({ left, top, right, bottom }));
        surface.backcolor = ground;
      },
      withClip: (rect, draw) => surface.withClip(inDevice(rect), draw),
      widest: system._drawTextWidest,
    },
    lpsz,
    cch,
    lprc,
    uFormat
  );
}
