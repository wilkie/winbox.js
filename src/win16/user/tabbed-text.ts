'use strict';

import { GetTextExtent } from '../gdi/GetTextExtent.js';
import { GetTextMetrics } from '../gdi/GetTextMetrics.js';
import { TextOut } from '../gdi/TextOut.js';
import { GetBkMode } from '../gdi/queries.js';
import { tabAverage } from './DrawText.js';

/**
 * Text with its tabs expanded to stops: `TabbedTextOut` and
 * `GetTabbedTextExtent`. **Recorded** by `tabtext`, in the System font:
 *
 * * With no stops, there is one every eight average characters, 64 pixels
 *   on the VGA -- the average USER counts `DrawText`'s tabs in.
 * * With one, its distance repeats.
 * * With several, each tab goes to the first stop past where the text has
 *   got to, and past the last to the next of the default stops.
 * * The stops count from the tab origin, not from where the text starts.
 * * Both answer the width from where the text starts to where it ends, and
 *   the font's height above it.
 *
 * Not recorded: another font's stops, taken as `DrawText`'s are, from
 * `tmAveCharWidth`; and what the background between the pieces is painted.
 */

function stringOf(system: any, pointer: number, count: number) {
  const core = system.machine.cpu.core;
  const segment = (pointer >>> 16) & 0xffff;
  let offset = pointer & 0xffff;
  let text = '';

  for (let at = 0; at < count; at++) {
    text += String.fromCharCode(core.read8(segment, offset));
    offset = (offset + 1) & 0xffff;
  }

  return text;
}

function stopsOf(system: any, count: number, pointer: number) {
  if (!pointer || count <= 0) {
    return [];
  }

  const core = system.machine.cpu.core;
  const segment = (pointer >>> 16) & 0xffff;
  const offset = pointer & 0xffff;
  const stops: number[] = [];

  for (let at = 0; at < count; at++) {
    stops.push((core.read16(segment, (offset + at * 2) & 0xffff) << 16) >> 16);
  }

  return stops;
}

/**
 * Lays tabbed text out from `x`, the stops counted from `origin`: each
 * piece's text and where it starts, and where the last ends.
 */
function layout(
  system: any,
  hdc: number,
  x: number,
  text: string,
  stops: number[],
  origin: number
) {
  const spacing = 8 * tabAverage(system, hdc);
  const next = (at: number) => {
    const past = at - origin;

    if (stops.length === 1 && stops[0] > 0) {
      return origin + (Math.floor(past / stops[0]) + 1) * stops[0];
    }

    const stop = stops.length > 1 ? stops.find((one) => one > past) : undefined;

    if (stop !== undefined) {
      return origin + stop;
    }

    return spacing > 0 ? origin + (Math.floor(past / spacing) + 1) * spacing : at;
  };
  const pieces: { text: string; x: number }[] = [];
  let at = x;

  text.split('\t').forEach((piece, index) => {
    if (index > 0) {
      at = next(at);
    }

    pieces.push({ text: piece, x: at });
    at += piece.length ? GetTextExtent.call(system, hdc, piece, piece.length) & 0xffff : 0;
  });

  return { pieces, end: at };
}

function height(system: any, hdc: number) {
  const tm: any = {};

  GetTextMetrics.call(system, hdc, tm);

  return tm.tmHeight ?? 0;
}

export function TabbedTextOut(
  this: any,
  hdc: number,
  x: number,
  y: number,
  lpString: number,
  nCount: number,
  nTabPositions: number,
  lpnTabStopPositions: number,
  nTabOrigin: number
) {
  const surface = this.handles.resolve(hdc);

  if (!surface) {
    return 0;
  }

  if (surface.driverDevice) {
    return driverTabbedTextOut(
      this,
      hdc,
      x,
      y,
      lpString,
      nCount,
      nTabPositions,
      lpnTabStopPositions,
      nTabOrigin
    );
  }

  const text = stringOf(this, lpString, Math.max(nCount, 0));
  const stops = stopsOf(this, nTabPositions, lpnTabStopPositions);
  const { pieces, end } = layout(this, hdc, x, text, stops, nTabOrigin);

  for (const piece of pieces) {
    if (piece.text.length) {
      TextOut.call(this, hdc, piece.x, y, piece.text, piece.text.length);
    }
  }

  return (((end - x) & 0xffff) | ((height(this, hdc) & 0xffff) << 16)) >>> 0;
}

/**
 * USER's average character width (`USER.EXE` seg2 `0410`, `03a4`), here on
 * a printer driver's context: `tmAveCharWidth` for a fixed pitch; for a
 * variable one, the extent of the 26 small and 26 capital letters over 26,
 * plus one, halved.
 */
async function driverAverage(system: any, surface: any) {
  const { deviceFont, deviceTextMetrics } = await import('../gdi/printer-driver.js');
  const { driverTextExtent, onStackBytes } = await import('../gdi/printer-output.js');
  const realized = await deviceFont(system, surface);

  if (!realized) {
    return 0;
  }

  const tm = deviceTextMetrics(realized);

  if (!(tm.tmPitchAndFamily & 1)) {
    return tm.tmAveCharWidth;
  }

  const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const bytes = new Uint8Array([...letters].map((letter) => letter.charCodeAt(0)));
  const extent = await onStackBytes(system, bytes, (far) =>
    driverTextExtent(system, surface, far, letters.length)
  );

  return ((Math.floor((extent & 0xffff) / 26) + 1) << 16) >> 17;
}

/**
 * `TabbedTextOut` on a printer driver's context, as USER draws it
 * (`USER.EXE` seg6 `1f1d`, its body seg6 `0992`): opaque when the
 * background mode is; the average character width (seg2 `0410`) and the
 * height `GetTextExtent` answers for one character; the tab distance
 * eight averages with no stops, the one stop's (1 for nought) with one,
 * none with several. Each run up to a tab is measured with
 * `GetTextExtent` and drawn with GDI's `ExtTextOut` at the pen, opaque if
 * the mode is, its rectangle from where the last run's ended to where
 * this one ends, the line's top to its height below it. A tab moves the
 * pen to the next multiple of the distance past the run's end counted
 * from the origin (unsigned), or with several stops to the first stop
 * past it, and past the last to the next eighth-average stop, which then
 * serves every tab after it. A tab that ends the string paints its gap,
 * opaque whatever the mode, with an empty `ExtTextOut`. The answer is the
 * width from the start to the last run's end, the height above it.
 */
async function driverTabbedTextOut(
  system: any,
  hdc: number,
  x: number,
  y: number,
  lpString: number,
  nCount: number,
  nTabPositions: number,
  lpnTabStopPositions: number,
  nTabOrigin: number
) {
  const { driverExtTextOut, driverTextExtent, onStackBytes, withRect } =
    await import('../gdi/printer-output.js');
  const surface = system.handles.resolve(hdc);
  const core = system.machine.cpu.core;
  const signed = (value: number) => (value << 16) >> 16;
  const opaque = GetBkMode.call(system, hdc) === 2;
  let string = lpString >>> 0;
  let count = signed(nCount);

  if (!string || count === 0) {
    return 0;
  }

  const average = await driverAverage(system, surface);
  // The height of USER's "0" (seg45 `01f2`).
  const zero = await onStackBytes(system, new Uint8Array([0x30, 0]), (far) =>
    driverTextExtent(system, surface, far, 1)
  );
  const lineHeight = (zero >>> 16) & 0xffff;
  const tabs = lpnTabStopPositions >>> 0;
  const tabAt = (index: number) =>
    signed(core.read16(tabs >>> 16, ((tabs & 0xffff) + index * 2) & 0xffff));
  let spacing = 0;

  if (!tabs) {
    spacing = average * 8;
  } else if (signed(nTabPositions) === 1) {
    spacing = tabAt(0) || 1;
  }

  const rect = { left: x, top: y, right: 0, bottom: y + lineHeight };
  let pen = x;
  let height = lineHeight;

  while (count !== 0) {
    let run = 0;
    let width = 0;

    while (run < count && core.read8(string >>> 16, ((string & 0xffff) + run) & 0xffff) !== 9) {
      run++;
    }

    count -= run;

    if (run) {
      const extent = await driverTextExtent(system, surface, string, run);

      [width, height] = [signed(extent & 0xffff), (extent >>> 16) & 0xffff];
    } else {
      height = lineHeight;
    }

    rect.right = pen + width;
    await withRect(system, rect, (far) =>
      driverExtTextOut(system, surface, pen, y, opaque ? 2 : 0, far, string, run)
    );
    rect.left = rect.right;

    if (count === 0) {
      return (((pen - x + width) & 0xffff) | ((height & 0xffff) << 16)) >>> 0;
    }

    if (spacing) {
      // An unsigned division, a signed product, in sixteen bits.
      const past = (width - nTabOrigin + pen) & 0xffff;
      const times = Math.floor(past / (spacing & 0xffff)) + 1;

      pen = signed(times * spacing + nTabOrigin);
    } else {
      let index = 0;

      pen += width;

      while (index < signed(nTabPositions) && tabAt(index) + nTabOrigin <= pen) {
        index++;
      }

      if (index < signed(nTabPositions)) {
        pen = tabAt(index) + nTabOrigin;
      } else {
        // No average is a division by nought in USER; the pen stays.
        spacing = average * 8;

        if (spacing) {
          pen = (Math.trunc((pen - nTabOrigin) / spacing) + 1) * spacing + nTabOrigin;
        }
      }
    }

    string = (((string >>> 16) << 16) | (((string & 0xffff) + run + 1) & 0xffff)) >>> 0;
    count--;

    if (count === 0) {
      rect.right = pen;
      await withRect(system, rect, (far) =>
        driverExtTextOut(system, surface, rect.left, rect.top, 2, far, string, 0)
      );
    }
  }

  return (((pen - x) & 0xffff) | ((height & 0xffff) << 16)) >>> 0;
}

export function GetTabbedTextExtent(
  this: any,
  hdc: number,
  lpString: number,
  nCount: number,
  nTabPositions: number,
  lpnTabStopPositions: number
) {
  if (!this.handles.resolve(hdc)) {
    return 0;
  }

  const text = stringOf(this, lpString, Math.max(nCount, 0));
  const stops = stopsOf(this, nTabPositions, lpnTabStopPositions);
  const { end } = layout(this, hdc, 0, text, stops, 0);

  return ((end & 0xffff) | ((height(this, hdc) & 0xffff) << 16)) >>> 0;
}
