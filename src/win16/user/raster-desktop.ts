'use strict';

import { type DeviceBitmap } from '../../raster/device-bitmap.js';
import { Surface } from '../../raster/surface.js';
import { SYSTEM_FONT, stockFontHandle } from '../gdi/stock-fonts.js';
import { GetTextMetrics } from '../gdi/GetTextMetrics.js';

import { Desktop } from './desktop.js';
import { GetSysColor } from './GetSysColor.js';
import { GetSystemMetrics } from './GetSystemMetrics.js';

/**
 * The raster desktop of a running system -- `Win16`, or anything standing in
 * for it -- on its screen: the display's metrics and colours as the system
 * answers them, the System font it hands out, and the display driver's OEM
 * bitmaps, which come from the person's own installation.
 */
export function rasterDesktop(system: any, oem: Map<number, DeviceBitmap>) {
  const font = system.handles.resolve(stockFontHandle(system, SYSTEM_FONT));
  const probe: any = Surface.memory();

  probe.font = font;

  const hdc = system.handles.allocate(probe);
  const metrics: any = {};

  GetTextMetrics.call(system, hdc, metrics);
  system.handles.free?.(hdc);

  const desktop = new Desktop(system.screen.bitmap, {
    display: system.display,
    metric: (index: number) => GetSystemMetrics.call(system, index),
    sysColor: (index: number) => GetSysColor.call(system, index),
    oem,
    font: { height: metrics.tmHeight, ascent: metrics.tmAscent },
    systemFont: font,
  });

  desktop.paintBackground();

  return desktop;
}

/**
 * A class's background brush as a colour: `COLOR_WINDOW + 1` and the other
 * system colours plus one stand for the colour itself, anything else is a
 * brush's handle.
 */
export function backgroundOf(system: any, hbrBackground: number) {
  if (!hbrBackground) {
    return null;
  }

  if (hbrBackground <= 21) {
    return { colorref: GetSysColor.call(system, hbrBackground - 1) };
  }

  const brush = system.handles.resolve(hbrBackground);
  const colour = brush?.color;

  return colour ? { colorref: colour.red | (colour.green << 8) | (colour.blue << 16) } : null;
}
