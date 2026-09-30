'use strict';

import { GetTextExtent } from '../gdi/GetTextExtent.js';
import { GetTextMetrics } from '../gdi/GetTextMetrics.js';
import { TextOut } from '../gdi/TextOut.js';
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
  if (!this.handles.resolve(hdc)) {
    return 0;
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
