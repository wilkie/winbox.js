'use strict';

import { Color } from '../../raster/color.js';
import { DeviceBitmap } from '../../raster/device-bitmap.js';
import { ditherTile } from '../../raster/dither.js';
import { type IconData } from '../../raster/icon.js';
import { Surface } from '../../raster/surface.js';

import { paintControl, type ControlState } from './controls.js';
import { paintFrame, type FrameEnvironment } from './frame.js';
import { type MenuData } from './menu-data.js';
import { paintPopup, popupLayout, type MenuEnvironment } from './menus.js';

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
 * A child window lies on its parent's client area, clipped to it, and above
 * it; a newer child is below the older ones, as a dialog's controls are in
 * the order they were made. A child is never the active window.
 */

export const COLOR_BACKGROUND = 1;
const COLOR_ACTIVECAPTION = 2;
const COLOR_WINDOWTEXT = 8;
const COLOR_CAPTIONTEXT = 9;

const IDI_APPLICATION = 32512;

const SM_CXICON = 11;
const SM_CYICON = 12;
const SM_CXFRAME = 32;
const SM_CYFRAME = 33;
const SM_CXICONSPACING = 38;
const SM_CYICONSPACING = 39;

/**
 * An icon's title's box is its text's width and two pixels either side; the
 * text starts one pixel in. Measured on the `sizing` probe's "Probe" on four
 * displays; a title that wraps is not measured.
 */
const ICON_TITLE_PAD = 2;
const ICON_TITLE_TEXT = 1;

const SM_CYMENU = 15;

/** The space either side of a menu bar item's text. See `frame.ts`. */
const MENU_GAP = 8;

/**
 * Which pixels a grayed label keeps what was there: those whose x and y add
 * to an odd number, from the corner of what the label is drawn on. Measured
 * on the VGA's selected, grayed Restore and the Hercules's grayed Paste.
 */
const GRAY_PHASE = 1;

/** What the desktop needs of the display: the frame's needs, and the System font to draw text in. */
export type DesktopEnvironment = Omit<FrameEnvironment, 'title' | 'text' | 'measure'> & {
  systemFont: any;

  /** The display driver's standard icons, by `IDI_` identifier. */
  icons?: Map<number, IconData>;

  /** What a minimized window whose class's icon is `IDI_APPLICATION` shows. See `driverResources`. */
  applicationIcon?: IconData;

  /** The standard cursors there are, by id. */
  cursors?: Set<number>;

  /** The font icon titles are in, and its height and ascent. */
  titleFont?: any;
  titleMetrics?: { height: number; ascent: number };
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

  /** The window it is a child of, if it is one; its place is in the parent's client area. */
  parent: DesktopWindow | null = null;

  /** What a standard control keeps, if the window is one. */
  control: ControlState | null = null;

  /** The handle the system gave it, for asking it to paint. */
  hwnd = 0;

  /** A child's identifier, what `CreateWindow` was given as its menu. */
  controlId = 0;

  /** The menu bar's item that is selected while a menu is open from it. */
  menuSelected: number | undefined = undefined;

  /** Whether the window's system menu is open. */
  systemMenuOpen = false;

  /** For a pop-up menu's own window: the menu, and the item selected in it. */
  popup: { menu: MenuData; selected: number } | null = null;

  /** The window's own system menu, once a program or a menu asked for it. */
  systemMenu: MenuData | null = null;

  /** Whether the window is as it was made, maximized, or minimized to an icon. */
  state: 'normal' | 'maximized' | 'minimized' = 'normal';

  /** Where a maximized or minimized window goes back to. */
  restoreRect: { left: number; top: number; width: number; height: number } | null = null;

  /** A minimized window's icon, and the window its title is shown in. */
  icon: IconData | null = null;
  iconTitle: DesktopWindow | null = null;

  /** A dialog's modal frame, from `DS_MODALFRAME` in its template. */
  modalFrame = false;

  /** For an icon's title window: the window whose title it shows. */
  titleOf: DesktopWindow | null = null;

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

  /** The window keys go to: the active window, or one of its children. */
  focus: DesktopWindow | null = null;

  /** The window whose menu is open, while one is. */
  menuOwner: DesktopWindow | null = null;

  /** Which window each pixel of the screen shows, by id; 0 for the desktop. */
  readonly owners: Uint16Array;

  #next = 1;

  /** Draws and measures text in the System font. */
  readonly #text: any = Surface.memory();

  /** Draws and measures in the icon title's font. */
  readonly #title: any = Surface.memory();

  constructor(screen: DeviceBitmap, environment: DesktopEnvironment) {
    this.screen = screen;
    this.environment = environment;
    this.owners = new Uint16Array(screen.width * screen.height);
    this.#text.font = environment.systemFont;
    this.#text.backMode = 1;
    this.#title.backMode = 1;
  }

  /** The frame's environment, with the desktop's text drawn on `bitmap`. */
  #frameEnvironment(bitmap: DeviceBitmap | null): FrameEnvironment & MenuEnvironment {
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
      label: (line, colour, x, y, grayed = false) => {
        if (!bitmap) {
          return;
        }

        const at = line.indexOf('&');
        const plain = line.replace('&', '');
        const width = text.measureText(plain).width;
        const height = font.height;

        /* What was there, to put back through a grayed label's gaps. */
        const kept: (number | null)[] = [];

        if (grayed) {
          for (let row = 0; row < height; row++) {
            for (let column = 0; column < width; column++) {
              kept.push(bitmap.indexAt(x + column, y + row));
            }
          }
        }

        text.bitmap = bitmap;
        text.textColor = colourOf(colour);
        text.fillText(x, y, plain);

        /* The mnemonic, underlined a row below the ascent. */
        if (at >= 0 && at < plain.length) {
          const under = x + text.measureText(plain.slice(0, at)).width;
          const index = bitmap.devicePalette.index(
            colour & 0xff,
            (colour >> 8) & 0xff,
            (colour >> 16) & 0xff
          );
          const across = text.measureText(plain[at]).width;

          for (let column = 0; column < across; column++) {
            bitmap.put(under + column, y + font.ascent + 1, index);
          }

          bitmap.context.markRect(under, y + font.ascent + 1, under + across, y + font.ascent + 2);
        }

        /* Grayed: only every other pixel, as `GrayString` draws through a gray brush. */
        if (grayed) {
          for (let row = 0; row < height; row++) {
            for (let column = 0; column < width; column++) {
              const px = x + column;
              const py = y + row;
              const was = kept[row * width + column];

              if (((px + py) & 1) === GRAY_PHASE && was !== null) {
                bitmap.put(px, py, was);
              }
            }
          }
        }
      },
    };
  }

  /**
   * Opens a pop-up menu with its top left at `x, y` on the screen, on top of
   * every window: its own window, a pixel larger each way for its shadow,
   * which never becomes active.
   */
  openPopup(menu: MenuData, x: number, y: number, selected = -1) {
    const layout = popupLayout(menu, this.#frameEnvironment(null));
    const window = new DesktopWindow(
      this.#next++,
      x,
      y,
      layout.width + 1,
      layout.height + 1,
      0x80000000,
      '',
      undefined,
      null
    );

    window.popup = { menu, selected };
    window.visible = true;
    this.windows.unshift(window);
    this.#own();
    this.paintPopup(window);

    return window;
  }

  /** Paints a pop-up menu's window again: its selection may have moved. */
  paintPopup(window: DesktopWindow) {
    if (!window.popup) {
      return;
    }

    const whole = this.#view(window, 0, 0, window.width, window.height);

    paintPopup(
      whole,
      0,
      0,
      window.popup.menu,
      window.popup.selected,
      this.#frameEnvironment(whole)
    );
  }

  /**
   * Where each item of a window's menu bar is on the screen: its text's width
   * and the space either side, the bar's height.
   */
  menuBarItems(window: DesktopWindow) {
    const environment = this.#frameEnvironment(null);
    const bar = this.environment.metric(SM_CYMENU);
    const top = window.top + window.client.top - 1 - bar;
    let x = window.left + window.client.left;

    return (window.menu ?? []).map((label) => {
      const width = environment.measure(label.replace('&', '')) + 2 * MENU_GAP;
      const item = { left: x, right: x + width, top, bottom: top + bar };

      x += width;

      return item;
    });
  }

  /** Where a window's system menu opens: under its box, on the caption's bottom line. */
  systemMenuPlace(window: DesktopWindow) {
    const bar = window.menu ? this.environment.metric(SM_CYMENU) + 1 : 0;

    return {
      x: window.left + window.client.left,
      y: window.top + window.client.top - 1 - bar,
    };
  }

  /** Gives a window a menu bar, or takes it away, and paints it. */
  setMenu(window: DesktopWindow, labels: string[] | undefined) {
    const had = window.menu !== undefined;

    window.menu = labels;

    if (had !== (labels !== undefined)) {
      this.place(window, window.left, window.top, window.width, window.height);
    } else {
      this.paintFrame(window);
    }
  }

  /** Where each item of an open pop-up is, from its window's top. */
  popupPlaces(window: DesktopWindow) {
    return window.popup ? popupLayout(window.popup.menu, this.#frameEnvironment(null)).places : [];
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
    background: Background,
    parent: DesktopWindow | null = null
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

    window.parent = parent;

    /* Above its parent, below its older siblings. */
    if (parent) {
      this.windows.splice(this.windows.indexOf(parent), 0, window);
    } else {
      this.windows.unshift(window);
    }

    this.#layout(window);

    return window;
  }

  /**
   * Shows a window, on top, and makes it the active one: its frame painted,
   * and its client area left to be erased and painted when it is asked.
   */
  show(window: DesktopWindow) {
    if (window.parent) {
      window.visible = true;
      this.#own();
      this.paintFrame(window);
      window.needsErase = true;
      window.needsPaint = true;
      return;
    }

    const was = this.active;

    /* To the top, and its children with it, as they were. */
    const family = this.windows.filter((other) => this.#within(other, window));

    for (const member of family) {
      this.windows.splice(this.windows.indexOf(member), 1);
    }

    this.windows.unshift(...family);

    window.visible = true;
    window.active = true;

    if (was && was !== window) {
      was.active = false;
    }

    /* Activating a window gives it the focus, unless one of its own has it. */
    if (!this.focus || !this.#within(this.focus, window)) {
      this.focus = window;
    }

    this.#own();

    if (was && was !== window) {
      this.paintFrame(was);
    }

    this.paintFrame(window);

    /* Its children show with it: a child made while its parent was hidden --
     * a dialog's controls are -- had nothing to draw its frame on. */
    for (const child of family) {
      if (child !== window && this.#showing(child)) {
        this.paintFrame(child);
        child.needsErase = true;
        child.needsPaint = true;
      }
    }

    /* An icon's title shows with it. */
    if (window.iconTitle && !window.iconTitle.visible) {
      window.iconTitle.visible = true;
      this.#own();
      this.paintFrame(window.iconTitle);
    }

    /* An icon USER draws itself; anything else is erased and painted. */
    const drawn = window.state === 'minimized' && window.icon !== null;

    window.needsErase = !drawn;
    window.needsPaint = !drawn;
  }

  /**
   * Takes a window off the screen: what it covered is painted again, the
   * desktop by USER and each window's frame, and each uncovered client area
   * left to be erased and painted.
   */
  destroy(window: DesktopWindow) {
    /* A minimized window's title goes with it. */
    if (window.iconTitle) {
      this.destroy(window.iconTitle);
      window.iconTitle = null;
    }

    if (this.menuOwner === window) {
      this.menuOwner = null;
    }

    const index = this.windows.indexOf(window);

    if (index < 0) {
      return;
    }

    if (this.focus && this.#within(this.focus, window)) {
      this.focus = null;
    }

    /* Its children go first, with nothing to paint again: it covers them. */
    for (const child of this.windows.filter((other) => other.parent === window)) {
      this.windows.splice(this.windows.indexOf(child), 1);
      child.visible = false;
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
        this.focus = next;
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
    if (!this.#showing(window)) {
      return;
    }

    if (window.state === 'minimized') {
      this.#paintIcon(window);

      /* Its title's colours follow its activation. */
      if (window.iconTitle?.visible) {
        this.#paintIconTitle(window.iconTitle);
      }

      return;
    }

    if (window.titleOf) {
      this.#paintIconTitle(window);
      return;
    }

    const whole = this.#view(window, 0, 0, window.width, window.height);

    paintFrame(
      whole,
      0,
      0,
      window.width,
      window.height,
      {
        style: window.style,
        active: window.active,
        title: window.title,
        menu: window.menu,
        menuSelected: window.menuSelected,
        systemMenuOpen: window.systemMenuOpen,
        zoomed: window.state === 'maximized',
        modal: window.modalFrame,
      },
      this.#frameEnvironment(whole)
    );
  }

  /** Erases a window's client area with its class's brush, where it shows. */
  erase(window: DesktopWindow, colorref = window.background?.colorref) {
    window.needsErase = false;

    if (!this.#showing(window) || colorref === undefined) {
      return;
    }

    this.#fill(window.surface.bitmap, 0, 0, window.clientWidth, window.clientHeight, colorref);
  }

  /** The desktop itself, where no window shows, in `COLOR_BACKGROUND`. */
  /** Everything drawn again, as after the system colours change: the desktop, and every window marked. */
  repaintAll() {
    this.paintBackground();

    for (const window of [...this.windows].reverse()) {
      if (this.#showing(window)) {
        this.paintFrame(window);
        window.needsErase = true;
        window.needsPaint = true;
      }
    }
  }

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

    /* An icon, or an icon's title, is all client area. */
    window.client =
      window.state === 'minimized' || window.titleOf
        ? { left: 0, top: 0, right: window.width, bottom: window.height }
        : paintFrame(
            nowhere,
            0,
            0,
            window.width,
            window.height,
            {
              style: window.style,
              active: window.active,
              title: window.title,
              menu: window.menu,
              menuSelected: window.menuSelected,
              systemMenuOpen: window.systemMenuOpen,
              zoomed: window.state === 'maximized',
              modal: window.modalFrame,
            },
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

  /**
   * A surface over the whole of a window, frame and all, as `GetWindowDC`
   * hands out: a view of the screen from the window's corner, drawn only
   * where the window shows.
   */
  windowSurface(window: DesktopWindow) {
    const surface: any = Surface.memory();

    surface.bitmap = this.#view(window, 0, 0, window.width, window.height);

    return surface;
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

      if (!this.#showing(window)) {
        continue;
      }

      /* The window, cut to each ancestor's client area. */
      let [left, top, right, bottom] = [
        Math.max(window.left, 0),
        Math.max(window.top, 0),
        Math.min(window.left + window.width, stride),
        Math.min(window.top + window.height, this.screen.height),
      ];

      for (let parent = window.parent; parent; parent = parent.parent) {
        left = Math.max(left, parent.left + parent.client.left);
        top = Math.max(top, parent.top + parent.client.top);
        right = Math.min(right, parent.left + parent.client.right);
        bottom = Math.min(bottom, parent.top + parent.client.bottom);
      }

      /* A pop-up's shadow leaves its two outer corners to what is beneath. */
      const corners = window.popup
        ? [
            [window.left + window.width - 1, window.top],
            [window.left, window.top + window.height - 1],
          ].filter(([cx, cy]) => cx >= 0 && cy >= 0 && cx < stride && cy < this.screen.height)
        : [];
      const beneath = corners.map(([cx, cy]) => this.owners[cy * stride + cx]);

      for (let y = top; y < bottom; y++) {
        if (right > left) {
          this.owners.fill(window.id, y * stride + left, y * stride + right);
        }
      }

      corners.forEach(([cx, cy], index) => {
        this.owners[cy * stride + cx] = beneath[index];
      });
    }
  }

  /**
   * The window a `WM_PAINT` is due to next, if any: the lowest first, so a
   * parent is painted before its children.
   */
  get unpainted() {
    for (let at = this.windows.length - 1; at >= 0; at--) {
      const window = this.windows[at];

      if (window.hwnd && window.needsPaint && this.#showing(window)) {
        return window;
      }
    }

    return null;
  }

  /**
   * Maximizes a window: its frame just off the screen's edges, its client
   * area the screen below its caption and menu. Recorded by the `sizing`
   * probe on four displays.
   */
  maximize(window: DesktopWindow) {
    this.#leaveIcon(window);

    if (window.state === 'normal') {
      window.restoreRect = {
        left: window.left,
        top: window.top,
        width: window.width,
        height: window.height,
      };
    }

    window.state = 'maximized';

    const cx = this.environment.metric(SM_CXFRAME);
    const cy = this.environment.metric(SM_CYFRAME);

    this.place(window, -cx, -cy, this.screen.width + 2 * cx, this.screen.height + 2 * cy);
  }

  /** Puts a maximized or minimized window back where it was. */
  restore(window: DesktopWindow) {
    if (window.state === 'normal' || !window.restoreRect) {
      return;
    }

    this.#leaveIcon(window);
    window.state = 'normal';

    const { left, top, width, height } = window.restoreRect;

    this.place(window, left, top, width, height);
  }

  /**
   * Minimizes a window to its icon: `SM_CXICON` and four square, at the
   * bottom left of the screen -- `(SM_CXICONSPACING - SM_CXICON) / 2` in and
   * `SM_CYICONSPACING` up, then along -- with its title in a window of its
   * own below it. Recorded by the `sizing` probe on four displays: (21, 408)
   * on the VGA, (21, 284) on the EGA. Where the second icon goes, and the
   * rest of arranging, is not measured.
   */
  minimize(window: DesktopWindow) {
    if (window.state === 'minimized') {
      return;
    }

    if (window.state === 'normal') {
      window.restoreRect = {
        left: window.left,
        top: window.top,
        width: window.width,
        height: window.height,
      };
    }

    window.state = 'minimized';

    const cxIcon = this.environment.metric(SM_CXICON);
    const cyIcon = this.environment.metric(SM_CYICON);
    const cxSpacing = this.environment.metric(SM_CXICONSPACING);
    const cySpacing = this.environment.metric(SM_CYICONSPACING);
    const taken = this.windows.filter((other) => other !== window && other.state === 'minimized');
    let slot = 0;

    while (taken.some((other) => other.left === this.#slotLeft(slot, cxSpacing, cxIcon))) {
      slot++;
    }

    this.place(
      window,
      this.#slotLeft(slot, cxSpacing, cxIcon),
      this.screen.height - cySpacing,
      cxIcon + 4,
      cyIcon + 4
    );

    const title = new DesktopWindow(
      this.#next++,
      0,
      0,
      0,
      0,
      0x80000000,
      window.title,
      undefined,
      null
    );

    title.titleOf = window;
    window.iconTitle = title;
    this.windows.splice(this.windows.indexOf(window), 0, title);
    this.#placeTitle(window);

    /* With an icon, USER draws it; without one, the window is erased and
     * painted like any other -- the `icons` probe's bare window shows its
     * class's white. */
    window.needsErase = !window.icon;
    window.needsPaint = !window.icon;
  }

  #slotLeft(slot: number, cxSpacing: number, cxIcon: number) {
    return slot * cxSpacing + ((cxSpacing - cxIcon) >> 1);
  }

  /** An icon's title under it, as wide as its text and a little more, centred. */
  #placeTitle(window: DesktopWindow) {
    const title = window.iconTitle;

    if (!title) {
      return;
    }

    const text = this.#titleText;
    const width = text.measureText(window.title).width + 2 * ICON_TITLE_PAD;
    const height = this.environment.titleMetrics?.height ?? this.environment.font.height;

    title.title = window.title;
    title.visible = window.visible;
    this.place(
      title,
      window.left + (window.width >> 1) - (width >> 1),
      window.top + window.height,
      width,
      height
    );
  }

  /** Takes a window's icon title away, as it stops being an icon. */
  #leaveIcon(window: DesktopWindow) {
    if (window.iconTitle) {
      this.destroy(window.iconTitle);
      window.iconTitle = null;
    }
  }

  /** An icon: the desktop beneath, the icon drawn over it through its mask. */
  #paintIcon(window: DesktopWindow) {
    const whole = this.#view(window, 0, 0, window.width, window.height);

    this.#fill(
      whole,
      0,
      0,
      window.width,
      window.height,
      this.environment.sysColor(COLOR_BACKGROUND),
      window.left,
      window.top
    );

    /* `IDI_APPLICATION` is shown as USER's Windows flag. */
    const icon =
      window.icon && window.icon === this.environment.icons?.get(IDI_APPLICATION)
        ? (this.environment.applicationIcon ?? window.icon)
        : window.icon;

    if (!icon) {
      return;
    }

    for (let y = 0; y < icon.height; y++) {
      for (let x = 0; x < icon.width; x++) {
        const at = y * icon.width + x;
        const beneath = whole.indexAt(2 + x, 2 + y) ?? 0;

        whole.put(2 + x, 2 + y, (icon.and[at] ? beneath : 0) ^ icon.xor[at]);
      }
    }
  }

  /** An icon's title: the caption's colours while its window is active. */
  #paintIconTitle(title: DesktopWindow) {
    const window = title.titleOf!;
    const whole = this.#view(title, 0, 0, title.width, title.height);
    const active = window.active;
    const text = this.#titleText;

    this.#fill(
      whole,
      0,
      0,
      title.width,
      title.height,
      this.environment.sysColor(active ? COLOR_ACTIVECAPTION : COLOR_BACKGROUND),
      title.left,
      title.top
    );

    text.bitmap = whole;
    text.textColor = colourOf(
      this.environment.sysColor(active ? COLOR_CAPTIONTEXT : COLOR_WINDOWTEXT)
    );
    text.fillText(ICON_TITLE_TEXT, 0, window.title);
  }

  /** Draws and measures in the icon title's font. */
  get #titleText() {
    this.#title.font = this.environment.titleFont ?? this.environment.systemFont;

    return this.#title;
  }

  /** Whether a window shows: it and every window it is a child of are visible. */
  #showing(window: DesktopWindow) {
    for (let at: DesktopWindow | null = window; at; at = at.parent) {
      if (!at.visible) {
        return false;
      }
    }

    return true;
  }

  /** Whether a window is `ancestor` or one of its children, however deep. */
  #within(window: DesktopWindow, ancestor: DesktopWindow) {
    for (let at: DesktopWindow | null = window; at; at = at.parent) {
      if (at === ancestor) {
        return true;
      }
    }

    return false;
  }

  /**
   * Paints a standard control's client area, where it shows, and marks it
   * painted: what the control's own window procedure does with `WM_PAINT`.
   * In its own font, when it has been given one.
   */
  paintControl(window: DesktopWindow) {
    window.needsErase = false;
    window.needsPaint = false;

    if (!window.control || !this.#showing(window)) {
      return;
    }

    const bitmap = window.surface.bitmap as DeviceBitmap;
    const environment = this.#frameEnvironment(bitmap);
    const own = window.control.font;

    if (own) {
      const text: any = Surface.memory();

      text.font = own.font;
      text.backMode = 1;
      environment.font = own.metrics;
      environment.measure = (line: string) => text.measureText(line).width;
      environment.text = (line: string, colour: number, x: number, y: number) => {
        text.bitmap = bitmap;
        text.textColor = colourOf(colour);
        text.fillText(x, y, line);
      };
    }

    paintControl(bitmap, window.clientWidth, window.clientHeight, window.control, environment);
  }

  /**
   * How far in a window's client area starts from each edge, for a style: what
   * `AdjustWindowRect` works out, from the frame as this desktop draws it.
   */
  frameInsets(style: number, modal: boolean, menu: boolean) {
    const nowhere = new DeviceBitmap(0, 0, this.screen.depth, undefined, this.screen.devicePalette);
    const size = 1000;
    const client = paintFrame(
      nowhere,
      0,
      0,
      size,
      size,
      { style, active: true, title: '', menu: menu ? [''] : undefined, modal },
      this.#frameEnvironment(null)
    );

    return {
      left: client.left,
      top: client.top,
      right: size - client.right,
      bottom: size - client.bottom,
    };
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
    colorref: number,
    originX = 0,
    originY = 0
  ) {
    /* The pattern starts at the corner of what it is drawn through, or at
     * `originX, originY` before it -- the screen's corner, for the desktop's
     * own pattern seen through an icon. */
    const palette = bitmap.devicePalette;
    const [red, green, blue] = [colorref & 0xff, (colorref >> 8) & 0xff, (colorref >> 16) & 0xff];
    const tile = ditherTile(this.environment.display, palette, red, green, blue);
    const solid = palette.index(red, green, blue);

    for (let y = top; y < top + height; y++) {
      for (let x = left; x < left + width; x++) {
        bitmap.put(x, y, tile ? tile[(((y + originY) & 7) << 3) | ((x + originX) & 7)] : solid);
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
