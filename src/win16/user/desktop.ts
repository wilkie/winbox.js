'use strict';

import { Color } from '../../raster/color.js';
import { DeviceBitmap } from '../../raster/device-bitmap.js';
import { ditherTile } from '../../raster/dither.js';
import { Surface } from '../../raster/surface.js';

import { paintFrame, type FrameEnvironment } from './frame.js';

/**
 * The screen as USER keeps it: one bitmap of the display's pixels, and the
 * windows on it, top first.
 *
 * Windows 3.1 keeps no pixels for a window. What shows of it is on the
 * screen and nowhere else; a window draws there, through a device context
 * that starts at its client area and is clipped to what of it shows; and
 * what another window uncovers is painted again, by USER for the frame and
 * by the window itself, asked with `WM_PAINT`, for the rest. This is that
 * arrangement:
 *
 * * Which window each pixel shows is kept a pixel at a time, in `owners`, so
 *   clipping a window's drawing to what shows of it is one comparison.
 * * A window's client area is a view of the screen's pixels (see
 *   `DeviceBitmap.view`), so everything GDI draws into it lands on the screen
 *   where the window is, and nowhere it is covered.
 * * The frame is painted by `paintFrame`, clipped the same way; the client
 *   area is erased with the class's brush when it is painted.
 *
 * Only top-level windows so far: a child window's place inside its parent
 * and its clipping by its siblings are not here yet.
 */

export const COLOR_BACKGROUND = 1;

/** What the desktop needs of the display: the frame's needs, and the System font to draw text in. */
export type DesktopEnvironment = Omit<FrameEnvironment, 'title' | 'text' | 'measure'> & {
  systemFont: any;
};

/** A window's background: a brush's colour, or none. */
export type Background = { colorref: number } | null;

export class DesktopWindow {
  readonly id: number;

  /** Where the window is on the screen, and its size. */
  left: number;
  top: number;
  width: number;
  height: number;

  style: number;
  title: string;
  menu: string[] | undefined;
  background: Background;

  visible = false;
  active = false;

  /** The client area, relative to the window, as the frame leaves it. */
  client = { left: 0, top: 0, right: 0, bottom: 0 };

  /** What `GetDC` and `BeginPaint` draw through: the client area on the screen. */
  readonly surface: any;

  /** Whether the client area is to be erased and painted, and whether it has asked. */
  needsErase = false;
  needsPaint = false;

  constructor(
    id: number,
    left: number,
    top: number,
    width: number,
    height: number,
    style: number,
    title: string,
    menu: string[] | undefined,
    background: Background
  ) {
    this.id = id;
    this.left = left;
    this.top = top;
    this.width = width;
    this.height = height;
    this.style = style;
    this.title = title;
    this.menu = menu;
    this.background = background;
    this.surface = Surface.memory();
  }

  get clientWidth() {
    return this.client.right - this.client.left;
  }

  get clientHeight() {
    return this.client.bottom - this.client.top;
  }
}

export class Desktop {
  readonly screen: DeviceBitmap;
  readonly environment: DesktopEnvironment;

  /** Every window, the topmost first. */
  readonly windows: DesktopWindow[] = [];

  /** Which window each pixel of the screen shows, by id; 0 for the desktop. */
  readonly owners: Uint16Array;

  #next = 1;

  /** Draws and measures text in the System font. */
  readonly #text: any = Surface.memory();

  constructor(screen: DeviceBitmap, environment: DesktopEnvironment) {
    this.screen = screen;
    this.environment = environment;
    this.owners = new Uint16Array(screen.width * screen.height);
    this.#text.font = environment.systemFont;
    this.#text.backMode = 1;
  }

  /** The frame's environment, with the desktop's text drawn on `bitmap`. */
  #frameEnvironment(bitmap: DeviceBitmap | null): FrameEnvironment {
    const text = this.#text;
    const font = this.environment.font;

    return {
      ...this.environment,
      measure: (line) => text.measureText(line).width,
      title: (caption, colour, [left, top, right, bottom]) => {
        if (!bitmap) {
          return;
        }

        text.bitmap = bitmap;
        text.textColor = colourOf(colour);
        text.fillText(
          left + Math.floor((right - left - text.measureText(caption).width) / 2),
          top + Math.floor((bottom - top - font.height) / 2),
          caption
        );
      },
      text: (line, colour, x, y) => {
        if (!bitmap) {
          return;
        }

        text.bitmap = bitmap;
        text.textColor = colourOf(colour);
        text.fillText(x, y, line);
      },
    };
  }

  /** The window made active last, if it is still showing. */
  get active() {
    return this.windows.find((window) => window.active && window.visible) ?? null;
  }

  /**
   * A window, not yet shown: its client area worked out from its frame, and
   * its surface a view of the screen there.
   */
  create(
    left: number,
    top: number,
    width: number,
    height: number,
    style: number,
    title: string,
    menu: string[] | undefined,
    background: Background
  ) {
    const window = new DesktopWindow(
      this.#next++,
      left,
      top,
      width,
      height,
      style,
      title,
      menu,
      background
    );

    this.windows.unshift(window);
    this.#layout(window);

    return window;
  }

  /**
   * Shows a window, on top, and makes it the active one: its frame painted,
   * and its client area left to be erased and painted when it is asked.
   */
  show(window: DesktopWindow) {
    const was = this.active;

    this.windows.splice(this.windows.indexOf(window), 1);
    this.windows.unshift(window);

    window.visible = true;
    window.active = true;

    if (was && was !== window) {
      was.active = false;
    }

    this.#own();

    if (was && was !== window) {
      this.paintFrame(was);
    }

    this.paintFrame(window);
    window.needsErase = true;
    window.needsPaint = true;
  }

  /**
   * Takes a window off the screen: what it covered is painted again, the
   * desktop by USER and each window's frame, and each uncovered client area
   * left to be erased and painted.
   */
  destroy(window: DesktopWindow) {
    const index = this.windows.indexOf(window);

    if (index < 0) {
      return;
    }

    this.windows.splice(index, 1);

    if (!window.visible) {
      return;
    }

    window.visible = false;

    const wasActive = window.active;

    this.#own();
    this.#expose(window);

    /* The next window down becomes the active one, as when a window closes. */
    if (wasActive) {
      const next = this.windows.find((other) => other.visible);

      if (next) {
        next.active = true;
        this.paintFrame(next);
      }
    }
  }

  /**
   * Moves or sizes a window. Its client area is worked out again, and if it
   * shows, what it covered and what it now covers are painted again.
   */
  place(window: DesktopWindow, left: number, top: number, width: number, height: number) {
    const was = { ...window } as DesktopWindow;

    window.left = left;
    window.top = top;
    window.width = width;
    window.height = height;
    this.#layout(window);

    if (!window.visible) {
      return;
    }

    this.#own();
    this.#expose(was);
    this.paintFrame(window);
    window.needsErase = true;
    window.needsPaint = true;
  }

  /** Hides a window without taking it away: as `destroy`, but it can be shown again. */
  hide(window: DesktopWindow) {
    if (!window.visible) {
      return;
    }

    this.destroy(window);
    this.windows.push(window);
  }

  /** The window that shows at a point of the screen, if any. */
  windowAt(x: number, y: number) {
    if (x < 0 || y < 0 || x >= this.screen.width || y >= this.screen.height) {
      return null;
    }

    const id = this.owners[y * this.screen.width + x];

    return this.windows.find((window) => window.id === id) ?? null;
  }

  /** Paints a window's frame, where the window shows. */
  paintFrame(window: DesktopWindow) {
    if (!window.visible) {
      return;
    }

    const whole = this.#view(window, 0, 0, window.width, window.height);

    paintFrame(
      whole,
      0,
      0,
      window.width,
      window.height,
      { style: window.style, active: window.active, title: window.title, menu: window.menu },
      this.#frameEnvironment(whole)
    );
  }

  /** Erases a window's client area with its class's brush, where it shows. */
  erase(window: DesktopWindow, colorref = window.background?.colorref) {
    window.needsErase = false;

    if (!window.visible || colorref === undefined) {
      return;
    }

    this.#fill(window.surface.bitmap, 0, 0, window.clientWidth, window.clientHeight, colorref);
  }

  /** The desktop itself, where no window shows, in `COLOR_BACKGROUND`. */
  paintBackground(left = 0, top = 0, right = this.screen.width, bottom = this.screen.height) {
    const desktop = DeviceBitmap.view(
      this.screen,
      0,
      0,
      this.screen.width,
      this.screen.height,
      (x, y) => this.owners[y * this.screen.width + x] === 0
    );

    this.#fill(
      desktop,
      left,
      top,
      right - left,
      bottom - top,
      this.environment.sysColor(COLOR_BACKGROUND)
    );
  }

  /** Works out a window's client area from its frame, and points its surface at it. */
  #layout(window: DesktopWindow) {
    const nowhere = new DeviceBitmap(0, 0, this.screen.depth, undefined, this.screen.devicePalette);

    window.client = paintFrame(
      nowhere,
      0,
      0,
      window.width,
      window.height,
      { style: window.style, active: window.active, title: window.title, menu: window.menu },
      this.#frameEnvironment(null)
    );

    window.surface.bitmap = this.#view(
      window,
      window.client.left,
      window.client.top,
      window.clientWidth,
      window.clientHeight
    );
  }

  /** A view of the screen over part of a window, drawn only where the window shows. */
  #view(window: DesktopWindow, left: number, top: number, width: number, height: number) {
    const x0 = window.left + left;
    const y0 = window.top + top;
    const stride = this.screen.width;

    return DeviceBitmap.view(this.screen, x0, y0, width, height, (x, y) => {
      const sx = x0 + x;
      const sy = y0 + y;

      return (
        sx >= 0 &&
        sy >= 0 &&
        sx < stride &&
        sy < this.screen.height &&
        this.owners[sy * stride + sx] === window.id
      );
    });
  }

  /** Which window shows at each pixel, the topmost winning. */
  #own() {
    const stride = this.screen.width;

    this.owners.fill(0);

    for (let at = this.windows.length - 1; at >= 0; at--) {
      const window = this.windows[at];

      if (!window.visible) {
        continue;
      }

      for (
        let y = Math.max(window.top, 0);
        y < Math.min(window.top + window.height, this.screen.height);
        y++
      ) {
        this.owners.fill(
          window.id,
          y * stride + Math.max(window.left, 0),
          y * stride + Math.min(window.left + window.width, stride)
        );
      }
    }
  }

  /** Paints again what a window no longer covers. */
  #expose(gone: DesktopWindow) {
    this.paintBackground(gone.left, gone.top, gone.left + gone.width, gone.top + gone.height);

    for (const window of this.windows) {
      if (window.visible && overlaps(window, gone)) {
        this.paintFrame(window);
        window.needsErase = true;
        window.needsPaint = true;
      }
    }
  }

  /** Fills a rectangle of a bitmap with a brush of a colour, patterned as the driver patterns it. */
  #fill(
    bitmap: DeviceBitmap,
    left: number,
    top: number,
    width: number,
    height: number,
    colorref: number
  ) {
    const palette = bitmap.devicePalette;
    const [red, green, blue] = [colorref & 0xff, (colorref >> 8) & 0xff, (colorref >> 16) & 0xff];
    const tile = ditherTile(this.environment.display, palette, red, green, blue);
    const solid = palette.index(red, green, blue);

    for (let y = top; y < top + height; y++) {
      for (let x = left; x < left + width; x++) {
        bitmap.put(
          x,
          y,
          tile ? tile[(((y + bitmap.originY) & 7) << 3) | ((x + bitmap.originX) & 7)] : solid
        );
      }
    }

    bitmap.context.markRect(left, top, left + width, top + height);
  }
}

function overlaps(a: DesktopWindow, b: DesktopWindow) {
  return (
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height
  );
}

function colourOf(colorref: number) {
  return new Color(colorref & 0xff, (colorref >> 8) & 0xff, (colorref >> 16) & 0xff);
}
