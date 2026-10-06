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
import { SendMessage } from './SendMessage.js';
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
    cursorImages: resources.cursorImages,
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
        iconTitleProc(system, hwnd, message, wParam, lParam);
      system.handles.register(system.handles.allocate(windowClass), ICON_TITLE_CLASS);
    }

    const handle = new RasterWindow(desktop, title, {
      menu: 0,
      caption: '',
      timesShown: 0,
      windowClass: ICON_TITLE_CLASS,
    });
    const icon = title.titleOf?.hwnd ? system.handles.resolve(title.titleOf.hwnd) : null;

    /* USER makes it with `CreateWindow` as the window is minimized (`USER.EXE`
     * seg1 `6ab8`), so its messages go to the queue of the task minimizing it
     * -- here, the icon's own: a press on it is the icon's task's to take. */
    if (icon instanceof RasterWindow && icon.data?.hInstance) {
      handle.data.hInstance = icon.data.hInstance;
    }

    title.hwnd = system.handles.allocate(handle);
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

const WM_CLOSE = 0x0010;
const WM_NCHITTEST = 0x0084;
const WM_NCMOUSEMOVE = 0x00a0;
const WM_NCLBUTTONDBLCLK = 0x00a3;
const HTCAPTION = 2;

/**
 * The procedure of an icon's title, class `#32772`, as `USER.EXE` has it (seg1
 * `6ca0`; the class registered with it at seg3 `19c7`): the mouse on the title
 * is all caption (`6dbd`), and its moves, presses, releases and double clicks
 * off the client area are sent on to the icon (`6dc2`), so that a title pressed
 * is its icon pressed, and twice, its icon restored; `WM_CLOSE` is answered
 * nought and nothing more (`6dd9`), so that Alt+F4 never takes a title away
 * from its icon. The rest is `DefWindowProc`'s (`6cdf`). Not followed here:
 * `WM_ACTIVATE` making the icon active instead (`6cf4`), which nothing here
 * asks of a title, since a press on it no longer activates it; and
 * `WM_ERASEBKGND` and `WM_SHOWWINDOW` drawing and placing it (`6d0b`,
 * `6d67`), which the desktop does.
 */
async function iconTitleProc(system: any, hwnd: number, message: number, wParam: number, lParam: any) {
  if (message === WM_CLOSE) {
    return 0;
  }

  if (message === WM_NCHITTEST) {
    return HTCAPTION;
  }

  if (message >= WM_NCMOUSEMOVE && message <= WM_NCLBUTTONDBLCLK) {
    const icon = system.handles.resolve(hwnd)?.window?.titleOf?.hwnd ?? 0;

    return icon ? await SendMessage.call(system, icon, message, wParam, lParam) : 0;
  }

  return DefWindowProc.call(system, hwnd, message, wParam, lParam);
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

  return colour
    ? {
        colorref: colour.red | (colour.green << 8) | (colour.blue << 16),
        hollow: colour.alpha === 0,
        pattern: patternOf(system, brush),
      }
    : null;
}

/**
 * A pattern brush's eight by eight, as the screen's indices: a bitmap of
 * the screen's depth as it is, a monochrome one black and white, as a new
 * device context's colours make it. Roulette's table is a pattern of
 * green and grey rows, which its window's background showed as green.
 */
export function patternOf(system: any, brush: any): Uint8Array | undefined {
  const pattern = brush?.pattern;
  const screen = system.rasterDesktop?.screen ?? system.screen?.bitmap;

  if (!pattern || !screen) {
    return undefined;
  }

  if (pattern.depth === screen.depth) {
    return pattern.indices;
  }

  if (pattern.depth === 1) {
    const palette = screen.devicePalette;
    const black = palette.index(0, 0, 0);
    const white = palette.index(255, 255, 255);

    return Uint8Array.from(pattern.indices, (index: number) => (index ? white : black));
  }

  return undefined;
}
