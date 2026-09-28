'use strict';

import { devicePoint, mapped } from './mapping.js';
import { ropOfMode } from './SetROP2.js';
import { BitmapContext } from '../../raster/bitmap-context.js';
import { Brush } from '../../raster/brush.js';
import { Color } from '../../raster/color.js';
import { DeviceBitmap } from '../../raster/device-bitmap.js';
import { DevicePalette } from '../../raster/device-palette.js';
import { rasterOp } from '../../raster/raster-op.js';

import { TRUE, FALSE } from '../consts.js';

/**
 * Draws a line from the current position to a point, and moves the current
 * position there.
 *
 * The line is `Surface.drawLine`'s: on pixels winbox.js owns, the recorded
 * walk, which leaves out the pixel the line stops on. See
 * `kb/gdi/lineto.md` for what `lines` recorded.
 *
 * @param {Types.HDC} hdc - The device context to draw on.
 * @param {Types.INT} x - Where the line ends, across.
 * @param {Types.INT} y - Where the line ends, down.
 *
 * @returns {Types.BOOL} Whether there was a device context to draw on.
 */
export function LineTo(hdc, x, y) {
  const surface = this.handles.resolve(hdc);
  this.debug('LineTo', x, y);

  // Determine if the HDC is valid; bail if not
  if (!surface) {
    return FALSE;
  }

  // Get the current coordinate
  const startX = surface.data.x || 0;
  const startY = surface.data.y || 0;

  // Set the new coordinate
  surface.data.x = x;
  surface.data.y = y;

  // Draw the line, in device terms
  if (mapped(surface)) {
    const [fromX, fromY] = devicePoint(surface, startX, startY);
    const [toX, toY] = devicePoint(surface, x, y);

    line(surface, fromX, fromY, toX, toY);
  } else {
    line(surface, startX, startY, x, y);
  }

  // Return success
  return TRUE;
}

/**
 * A line in the drawing mode `SetROP2` set: the walk's pixels combined with
 * what is there, as a `PatBlt` of the pen's colour would combine them, one
 * by one in the order walked. `R2_NOT` over a pixel drawn before takes it
 * out again (`polyline`). In `R2_COPYPEN` it is the plain walk.
 */
/**
 * The styled pens' dashes, a bit to each stretch, the first the lowest:
 * `PS_DASH`, `PS_DOT`, `PS_DASHDOT` and `PS_DASHDOTDOT`.
 *
 * **Recorded** by `penind` on the VGA, for lines a pixel wide: a stretch is
 * four pixels of a line that runs more across than down, and three of one
 * that runs down as much or more, whose first pixel is drawn before them
 * all; the pattern starts again at each line's start. The gaps are the
 * background colour in `OPAQUE` mode and left alone in `TRANSPARENT`. A pen
 * wider than a pixel draws solid.
 */
const DASHES: Record<number, number> = { 1: 0xe7, 2: 0x55, 3: 0x27, 4: 0x57 };

/** Whether a line's pixel, by its step from the line's start, is a dash's. */
function dashed(bits: number, across: boolean, step: number) {
  if (!across && step === 0) {
    return true;
  }

  const stretch = across ? step >> 2 : Math.floor((step - 1) / 3);

  return !!((bits >> (stretch & 7)) & 1);
}

function line(surface: any, fromX: number, fromY: number, toX: number, toY: number) {
  const mode = surface.rop2 ?? 13;
  const context: any = surface.context;
  const bits = (surface.pen?.width ?? 0) <= 1 ? DASHES[surface.pen?.style] : undefined;

  if ((mode === 13 && bits === undefined) || !(context instanceof BitmapContext)) {
    surface.drawLine(fromX, fromY, toX, toY);
    return;
  }

  if (!surface.pen?.color?.alpha) {
    return;
  }

  const across = Math.abs(toX - fromX) > Math.abs(toY - fromY);

  context.plotted = [];

  try {
    surface.drawLine(fromX, fromY, toX, toY);
  } finally {
    const pixels = context.plotted;
    const display = surface.context.display;

    context.plotted = null;

    /* The pen is a colour the device has, as for an ellipse's outline. */
    const palette =
      surface.bitmap instanceof DeviceBitmap
        ? surface.bitmap.devicePalette
        : DevicePalette.forDisplay(display);
    const inDevice = (colour: any) => {
      const [r, g, b] = palette.colours[palette.index(colour.red, colour.green, colour.blue)] ?? [
        0, 0, 0,
      ];

      return new Brush(new Color(r, g, b));
    };
    const brush = surface.brush;
    const rop = ropOfMode(mode);
    const ink = inDevice(surface.pen.color);
    const gap = surface.backMode === 1 ? null : inDevice(surface.backcolor);

    for (const [x, y, step] of pixels ?? []) {
      const on = bits === undefined || dashed(bits, across, step);

      if (!on && !gap) {
        continue;
      }

      surface.brush = on ? ink : gap;
      rasterOp(display, surface, x, y, 1, 1, rop, null, 0, 0);
    }

    surface.brush = brush;
  }
}
