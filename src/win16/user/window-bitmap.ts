'use strict';

import { DeviceBitmap } from '../../raster/device-bitmap.js';
import { DevicePalette } from '../../raster/device-palette.js';
import { Presenter } from '../../raster/presenter.js';

/**
 * Gives a program's window the pixels it draws into: a device-dependent bitmap
 * of palette indices at the display's depth, the size of the window's client
 * area, shown on the window's canvas by a `Presenter` once a frame.
 *
 * The window's device context draws into it as a memory device context draws
 * into its bitmap, so a window and a bitmap are one kind of thing to GDI, and
 * `BitBlt` between them is index arithmetic. When the window is resized the
 * bitmap is made again at the new size, keeping what overlaps; Windows asks
 * the program to repaint what is new.
 *
 * It starts white.
 */
export function attachWindowBitmap(win16: any, dialog: any) {
  const surface = dialog.surface;
  const canvas = dialog.canvas;
  const depth = DevicePalette.depthOf(win16.display);
  let presenter: Presenter | null = null;

  const rebuild = () => {
    const width = Number(canvas?.getAttribute?.('width')) || 0;
    const height = Number(canvas?.getAttribute?.('height')) || 0;
    const old = surface.bitmap instanceof DeviceBitmap ? surface.bitmap : null;

    if (old && old.width === width && old.height === height) {
      return;
    }

    const bitmap = new DeviceBitmap(
      width,
      height,
      depth,
      undefined,
      DevicePalette.forDisplay(win16.display)
    );

    bitmap.indices.fill(bitmap.devicePalette.index(0xff, 0xff, 0xff));

    if (old) {
      for (let y = 0; y < Math.min(old.height, height); y++) {
        bitmap.indices.set(
          old.indices.subarray(y * old.width, y * old.width + Math.min(old.width, width)),
          y * width
        );
      }
    }

    presenter?.detach();
    surface.bitmap = bitmap;
    presenter = new Presenter(bitmap, canvas);
  };

  rebuild();
  dialog.on?.('resize', rebuild);
}
