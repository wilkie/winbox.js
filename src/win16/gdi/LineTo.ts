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
function line(surface: any, fromX: number, fromY: number, toX: number, toY: number) {
  const mode = surface.rop2 ?? 13;
  const context: any = surface.context;

  if (mode === 13 || !(context instanceof BitmapContext)) {
    surface.drawLine(fromX, fromY, toX, toY);
    return;
  }

  if (!surface.pen?.color?.alpha) {
    return;
  }

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
    const { red, green, blue } = surface.pen.color;
    const [r, g, b] = palette.colours[palette.index(red, green, blue)] ?? [0, 0, 0];
    const brush = surface.brush;
    const rop = ropOfMode(mode);

    surface.brush = new Brush(new Color(r, g, b));

    for (const [x, y] of pixels ?? []) {
      rasterOp(display, surface, x, y, 1, 1, rop, null, 0, 0);
    }

    surface.brush = brush;
  }
}
