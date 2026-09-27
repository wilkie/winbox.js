'use strict';

import { noteActivePopup } from './enumerate.js';

import { Surface } from '../../raster/surface.js';
import { CreateFont } from '../gdi/CreateFont.js';
import { SelectObject } from '../gdi/SelectObject.js';
import { SYSTEM_FONT, stockFontHandle } from '../gdi/stock-fonts.js';
import { GetTextMetrics } from '../gdi/GetTextMetrics.js';

import { Desktop } from './desktop.js';
import { type DriverResources } from './driver-resources.js';
import { GetSysColor } from './GetSysColor.js';
import { GetSystemMetrics } from './GetSystemMetrics.js';

/**
 * The raster desktop of a running system -- `Win16`, or anything standing in
 * for it -- on its screen: the display's metrics and colours as the system
 * answers them, the System font it hands out, the icon title's font, and the
 * display driver's bitmaps and icons, which come from the person's own
 * installation.
 */
export function rasterDesktop(system: any, resources: DriverResources) {
  const system_ = fontOf(system, stockFontHandle(system, SYSTEM_FONT));
  const title = fontOf(system, iconTitleFont(system));

  const desktop = new Desktop(system.screen.bitmap, {
    display: system.display,
    metric: (index: number) => GetSystemMetrics.call(system, index),
    sysColor: (index: number) => GetSysColor.call(system, index),
    oem: resources.oem,
    icons: resources.icons,
    applicationIcon: resources.applicationIcon,
    userStrings: resources.userStrings,
    cursors: resources.cursors,
    font: system_.metrics,
    systemFont: system_.font,
    titleFont: title.font,
    titleMetrics: title.metrics,
  });

  desktop.onActivate = (window) => {
    if (window.hwnd) {
      noteActivePopup(system, window.hwnd);
    }
  };

  desktop.paintBackground();

  return desktop;
}

/**
 * The font an icon's title is in: MS Sans Serif, eight points on the
 * display's vertical resolution, normal weight. Recorded by the `sizing`
 * probe, from `SPI_GETICONTITLELOGFONT`: -11 on the VGA and Super VGA, -8 on
 * the EGA and Hercules, 400.
 */
export function iconTitleFont(system: any) {
  const logical = system.display?.logicalPixelsY ?? 96;

  return CreateFont.call(
    system,
    -Math.round((8 * logical) / 72),
    0,
    0,
    0,
    400,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    'MS Sans Serif'
  );
}

/** A font, realized in a device context, and its height and ascent. */
export function fontOf(system: any, handle: number) {
  const surface: any = Surface.memory();
  const hdc = system.handles.allocate(surface);
  const metrics: any = {};

  SelectObject.call(system, hdc, handle);
  GetTextMetrics.call(system, hdc, metrics);
  system.handles.free?.(hdc);

  return {
    font: surface.font,
    metrics: {
      height: metrics.tmHeight,
      ascent: metrics.tmAscent,
      overhang: metrics.tmOverhang ?? 0,
      /* Bit 0 set is a font whose characters differ in width. */
      fixedPitch: !((metrics.tmPitchAndFamily ?? 1) & 1),
      average: metrics.tmAveCharWidth ?? 0,
    },
  };
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
