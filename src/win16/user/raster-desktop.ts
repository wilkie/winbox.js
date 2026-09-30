'use strict';

import { noteActivePopup } from './enumerate.js';

import { DeviceBitmap } from '../../raster/device-bitmap.js';
import { Surface } from '../../raster/surface.js';
import { CreateFont } from '../gdi/CreateFont.js';
import { SelectObject } from '../gdi/SelectObject.js';
import { SYSTEM_FONT, stockFontHandle } from '../gdi/stock-fonts.js';
import { GetTextMetrics } from '../gdi/GetTextMetrics.js';

import { Desktop } from './desktop.js';
import { RasterWindow } from './raster-window.js';
import { DefWindowProc } from './DefWindowProc.js';
import { WNDCLASS } from '../user.js';
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
    bitmapOf: (handle: number) => {
      const bitmap = system.handles.resolve(handle);

      return bitmap instanceof DeviceBitmap ? bitmap : undefined;
    },
  });

  desktop.onActivate = (window) => {
    if (window.hwnd) {
      noteActivePopup(system, window.hwnd);
    }
  };

  /* An icon's title is a window of USER's, of its own class, `#32772`: a
   * window, where `SetWindowPos` names it (`showmin`), and drawn by the
   * desktop. */
  desktop.onTitle = (title) => {
    if (!system.handles.retrieve(ICON_TITLE_CLASS)) {
      const windowClass: any = new WNDCLASS();

      windowClass.style = 0;
      windowClass.hbrBackground = 0;
      windowClass.lpszClassName = ICON_TITLE_CLASS;
      windowClass.lpfnWndProc = (hwnd: number, message: number, wParam: number, lParam: any) =>
        DefWindowProc.call(system, hwnd, message, wParam, lParam);
      system.handles.register(system.handles.allocate(windowClass), ICON_TITLE_CLASS);
    }

    const hwnd = system.handles.allocate(
      new RasterWindow(desktop, title, {
        menu: 0,
        caption: '',
        timesShown: 0,
        windowClass: ICON_TITLE_CLASS,
      })
    );

    title.hwnd = hwnd;
  };

  desktop.onTitleGone = (title) => {
    if (title.hwnd) {
      system.handles.free(title.hwnd);
      title.hwnd = 0;
    }
  };

  desktop.paintBackground();

  return desktop;
}

const ICON_TITLE_CLASS = '#32772';

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

  return colour
    ? {
        colorref: colour.red | (colour.green << 8) | (colour.blue << 16),
        hollow: colour.alpha === 0,
      }
    : null;
}
