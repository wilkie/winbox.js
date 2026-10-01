'use strict';

import { type CursorImage } from '../../raster/icon.js';
import { shapeOf } from './update-region.js';
import { Color } from '../../raster/color.js';
import { DeviceBitmap } from '../../raster/device-bitmap.js';
import { ditherTile } from '../../raster/dither.js';
import { type IconData } from '../../raster/icon.js';
import { Surface } from '../../raster/surface.js';

import { focusRect, paintControl, type ControlState } from './controls.js';
import { editState, selection } from './edit.js';
import { paintLines } from './mledit.js';
import { Painter } from './painter.js';
import { barLayout } from './menu-bar.js';
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
const WS_CLIPSIBLINGS = 0x04000000;
const WS_CLIPCHILDREN = 0x02000000;
const COLOR_ACTIVECAPTION = 2;
const COLOR_WINDOWTEXT = 8;
const COLOR_CAPTIONTEXT = 9;

const IDI_APPLICATION = 32512;

const SM_CXICON = 11;
const SM_CYICON = 12;
const SM_CXFRAME = 32;
const SM_CYFRAME = 33;
const SM_CXBORDER = 5;
const SM_CYBORDER = 6;
const WS_THICKFRAME = 0x00040000;
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
  /** USER's string table, by number. */
  userStrings?: Map<number, string>;

  applicationIcon?: IconData;

  /** The standard cursors there are, by id. */
  cursors?: Set<number>;

  /** Their pictures, by id. */
  cursorImages?: Map<number, CursorImage>;

  /** A bitmap a program made, by its handle: a menu item's own (`SetMenuItemBitmaps`). */
  bitmapOf?(handle: number): DeviceBitmap | undefined;

  /** The font icon titles are in, and its height and ascent. */
  titleFont?: any;
  titleMetrics?: { height: number; ascent: number };
};

/**
 * A window's background: a brush's colour, and its pattern of eight by
 * eight device indices when it is a pattern brush; or none.
 */
export type Background = { colorref: number; pattern?: Uint8Array } | null;

/**
 * Whether a window is drawn by its own procedure's messages: one with a
 * handle that is not an icon's title, which the desktop draws itself
 * though it is a window of USER's (`#32772`).
 */
export function paintsItself(window: DesktopWindow) {
  return !!window.hwnd && !window.titleOf;
}

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
  /** Which of the menu bar's items are grayed. */
  menuGrayed?: boolean[];
  background: Background;

  visible = false;
  #active = false;

  /**
   * The caption drawn active or not, as `WM_NCACTIVATE` last had it
   * (`DefWindowProc`), or null to follow the activation. `FlashWindow` turns
   * it without the activation changing; an activation changing sets it back.
   */
  lit: boolean | null = null;

  get active() {
    return this.#active;
  }

  set active(value: boolean) {
    this.#active = value;
    this.lit = null;
  }

  /** Whether the caption is drawn active. */
  get captionLit() {
    return this.lit ?? this.#active;
  }

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

  /** The window at the top that owns it, if it is a window at the top that has one. */
  owner: DesktopWindow | null = null;

  /** Shown when its owner is restored: hidden as its owner was minimized. */
  hiddenWithOwner = false;

  /** `WS_EX_TOPMOST`: kept above every window that is not. */
  topmost = false;

  /** The extended style it was made with. */
  exStyle = 0;

  /** The screen under a pop-up menu, as it was when the menu opened; see `openPopup`. */
  savedBits: Uint8Array | null = null;

  /** The window's own system menu, once a program or a menu asked for it. */
  systemMenu: MenuData | null = null;

  /** Whether the window is as it was made, maximized, or minimized to an icon. */
  state: 'normal' | 'maximized' | 'minimized' = 'normal';

  /** Where a maximized or minimized window goes back to. */
  restoreRect: { left: number; top: number; width: number; height: number } | null = null;

  /** Where its icon was put by a move while it was one: its icon's place from then on. */
  iconPlace: { left: number; top: number } | null = null;

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

    /* Where its client area is on the screen, which a brush's origin is
     * counted from (`brushorg`). */
    (this.surface as any).screenOrigin = () => ({
      x: this.left + this.client.left,
      y: this.top + this.client.top,
    });
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

  /**
   * The window that was active before the last change of active window, until
   * its messages are sent (see `activation.ts`); `click` when a press made it.
   */
  pendingActivation: { from: DesktopWindow | null; click: boolean } | null = null;

  /** The window whose menu is open, while one is. */
  menuOwner: DesktopWindow | null = null;

  /** Set by `WM_CANCELMODE` to the menu's window: the open menu ends. */
  menuCancelled = false;

  /** Which window each pixel of the screen shows, by id; 0 for the desktop. */
  readonly owners: Uint16Array;

  /** Told of each window made active, as it is: USER notes it on its owners (see `enumerate.ts`). */
  onActivate: ((window: DesktopWindow) => void) | null = null;

  /** An icon's title made, and taken away: a window of USER's to the system. */
  onTitle: ((title: DesktopWindow) => void) | null = null;
  onTitleGone: ((title: DesktopWindow) => void) | null = null;

  #next = 1;

  /** Draws and measures text in the System font. */
  readonly #text: any = Surface.memory();

  /** The windows by their `id`, as `owners` holds them; kept by `#own`. */
  #byId = new Map<number, DesktopWindow>();

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
  /**
   * A control's environment: the frame's, with what its parent answered
   * `WM_CTLCOLOR` standing for the system colours it replaces -- the brush
   * for the window colour, or a scroll bar's colour, and the text colour for
   * the window's text -- and the background colour its text is drawn on. A
   * push button and a scroll bar draw no text on it. See `ctlcolor.ts`.
   */
  #controlEnvironment(window: DesktopWindow, bitmap: DeviceBitmap): any {
    const environment: any = this.#frameEnvironment(bitmap);
    const control: any = window.control;
    const colours = control?.colours;

    if (!colours) {
      return environment;
    }

    const system = environment.sysColor;
    const kind = control.style & 0x0f;
    const scrollBar = control.className === 'SCROLLBAR';
    const push = control.className === 'BUTTON' && (kind === 0 || kind === 1);

    environment.sysColor = (index: number) =>
      scrollBar
        ? index === 0
          ? colours.brush
          : system(index)
        : index === 5
          ? colours.brush
          : index === 8
            ? colours.text
            : system(index);

    /* Text on the background colour, unless the mode is transparent; the
     * brush filled, unless it is hollow (`ctltrans`). BWCC answers both for
     * the text on its panels. */
    if (!scrollBar && !push && !colours.transparent) {
      environment.ground = colours.ground;
    }

    environment.hollow = !!colours.hollow;

    return environment;
  }

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
    window.savedBits = this.#saveBits(window);
    window.visible = true;
    this.windows.unshift(window);
    this.#own();
    this.paintPopup(window);

    return window;
  }

  /**
   * A pop-up menu keeps the screen under it and puts it back when it goes,
   * so nothing under it is painted again. **Recorded** by `menubits`: the
   * window under a menu closed by Escape is sent nothing, and the screen
   * shows it at once. By `menuinv`: not when the window was invalidated
   * where the menu is while it was up, which is drawn again instead.
   */
  #saveBits(window: DesktopWindow) {
    const bits = new Uint8Array(window.width * window.height);

    for (let y = 0; y < window.height; y++) {
      for (let x = 0; x < window.width; x++) {
        bits[y * window.width + x] = this.screen.indexAt(window.left + x, window.top + y) ?? 0;
      }
    }

    return bits;
  }

  /** Puts back what a pop-up menu covered, if it still stands; whether it did. */
  #restoreBits(window: DesktopWindow) {
    const bits = window.savedBits;

    window.savedBits = null;

    /* Thrown away when something under it is to be painted again there
     * (`menuinv`): only a part of a window invalidated clear of the menu
     * leaves them standing. */
    const spoiled = this.windows.some((other) => {
      if (other === window || !other.visible || !other.needsPaint || !overlaps(other, window)) {
        return false;
      }

      const dirty = (other as any).dirtyRect;

      return (
        !dirty ||
        (dirty[0] < window.left + window.width &&
          window.left < dirty[2] &&
          dirty[1] < window.top + window.height &&
          window.top < dirty[3])
      );
    });

    if (!bits || spoiled) {
      return false;
    }

    const stride = this.screen.width;

    for (let y = 0; y < window.height; y++) {
      for (let x = 0; x < window.width; x++) {
        const sx = window.left + x;
        const sy = window.top + y;

        if (sx >= 0 && sy >= 0 && sx < stride && sy < this.screen.height) {
          this.screen.put(sx, sy, bits[y * window.width + x]);
        }
      }
    }

    return true;
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
    const { items, rows } = barLayout(
      window.menu ?? [],
      environment.measure,
      window.client.left,
      window.width - window.client.left
    );
    const first = window.top + window.client.top - rows * (bar + 1);

    return items.map((item) => ({
      left: window.left + item.left,
      right: window.left + item.right,
      top: first + item.row * (bar + 1),
      bottom: first + item.row * (bar + 1) + bar,
    }));
  }

  /** Where a window's system menu opens: under its box, on the caption's bottom line. */
  systemMenuPlace(window: DesktopWindow) {
    const rows = window.menu
      ? barLayout(window.menu, this.#frameEnvironment(null).measure, window.client.left, window.width - window.client.left).rows
      : 0;
    const bar = rows * (this.environment.metric(SM_CYMENU) + 1);

    return {
      x: window.left + window.client.left,
      y: window.top + window.client.top - 1 - bar,
    };
  }

  /** Gives a window a menu bar, or takes it away, and paints it. */
  setMenu(window: DesktopWindow, labels: string[] | undefined, grayed?: boolean[]) {
    const had = window.menu !== undefined;

    window.menu = labels;
    window.menuGrayed = grayed;

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

  /** The active top-level window: a document window inside one does not count. */
  get activeTop() {
    return this.windows.find((w) => w.active && w.visible && !w.parent && !w.titleOf) ?? null;
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
      this.windows.splice(this.front(window), 0, window);
    }

    this.#layout(window);

    return window;
  }

  /**
   * A child brought above its siblings, its own children with it, and
   * painted where it now shows.
   */
  raise(window: DesktopWindow) {
    const parent = window.parent;

    if (!parent) {
      return;
    }

    const family = this.windows.filter((other) => this.#within(other, window));

    for (const member of family) {
      this.windows.splice(this.windows.indexOf(member), 1);
    }

    const first = this.windows.findIndex(
      (other) => other !== parent && this.#within(other, parent)
    );

    this.windows.splice(first < 0 ? this.windows.indexOf(parent) : first, 0, ...family);
    this.#own();

    for (const member of family) {
      if (member.visible) {
        this.paintFrame(member);
        member.needsErase = true;
        member.needsPaint = true;
      }
    }
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

      /* Its own children show with it: a document window made in an MDI
       * client not yet shown was drawn nowhere, and is drawn now. */
      for (const other of this.windows) {
        if (other !== window && other.visible && this.#within(other, window)) {
          this.paintFrame(other);
          other.needsErase = true;
          other.needsPaint = true;
        }
      }

      return;
    }

    const was = this.active;
    const wasTop = this.activeTop;
    const shownBefore = this.owners.slice();

    /* To the top, and its children with it, as they were; the windows it
     * owns above it, in their order (`owners`). */
    const family = this.windows.filter(
      (other) =>
        this.#within(other, window) || this.#ownedWithin(other, window) || other === window.iconTitle
    );

    for (const member of family) {
      this.windows.splice(this.windows.indexOf(member), 1);
    }

    const ownedFirst = [
      ...family.filter((member) => !this.#within(member, window)),
      ...family.filter((member) => this.#within(member, window)),
    ];

    /* An owned window brings the window that owns it up beneath it, with the
     * rest of what that one owns, as they were (`showseq`: an owned pop-up
     * shown, its owner told it went after it). */
    let head = window;

    while (head.owner && !head.owner.parent) {
      head = head.owner;
    }

    const owners =
      head === window
        ? []
        : this.windows.filter(
            (other) =>
              !ownedFirst.includes(other) &&
              (this.#within(other, head) || this.#ownedWithin(other, head))
          );

    for (const member of owners) {
      this.windows.splice(this.windows.indexOf(member), 1);
    }

    const beneath = [
      ...owners.filter((member) => !this.#within(member, head)),
      ...owners.filter((member) => this.#within(member, head)),
    ];

    this.windows.splice(this.front(window), 0, ...ownedFirst, ...beneath);

    window.visible = true;
    window.active = true;
    this.onActivate?.(window);

    if (was && was !== window) {
      was.active = false;
    }

    /* Its messages are to be sent; the focus moves with them, as the window
     * procedures move it. */
    if (wasTop !== window) {
      this.pendingActivation ??= { from: wasTop, click: false };
    }

    this.#own();

    /* Any other window brought up where it had been covered is due there --
     * an owner come up beneath the window it owns, where that had lain under
     * another (`showseq`). */
    this.#gained(shownBefore, [window, ...family.filter((member) => this.#within(member, window))]);

    if (was && was !== window) {
      this.paintFrame(was);
    }

    this.paintFrame(window);

    /* Its children show with it: a child made while its parent was hidden --
     * a dialog's controls are -- had nothing to draw its frame on. */
    for (const child of family) {
      if (child !== window && this.#within(child, window) && this.#showing(child)) {
        /* An icon USER draws itself, as below. */
        const icon = child.state === 'minimized' && child.icon !== null;

        this.paintFrame(child);
        child.needsErase = !icon;
        child.needsPaint = !icon;
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
    if (window.titleOf) {
      this.onTitleGone?.(window);
    }

    /* A minimized window's title goes with it. */
    if (window.iconTitle) {
      this.destroy(window.iconTitle);
      window.iconTitle = null;
    }

    if (this.menuOwner === window) {
      this.menuOwner = null;
    }

    if (!this.windows.includes(window)) {
      return;
    }

    this.#takeAway(window, true);
  }

  /**
   * A window taken off the screen, and with `remove` out of the desktop's
   * windows with its children; otherwise it and they are kept, hidden.
   */
  #takeAway(window: DesktopWindow, remove: boolean) {
    /* The next window down becomes the active one, as when a window closes
     * -- or, for one destroyed, its owner, when it is still to be seen: a
     * pop-up Bago shows while it reads its dictionary gives the activation
     * back to the window that owns it, not to its egg timer, the window
     * next down (`actnext`). */
    const owner = remove || (window as any).destroying ? window.owner : null;
    const next =
      window.visible && window.active
        ? owner && owner.visible && this.windows.includes(owner) && !this.#within(owner, window)
          ? owner
          : this.windows.find(
              (other) =>
                other !== window && other.visible && !other.parent && !other.titleOf && !this.#within(other, window)
            )
        : undefined;

    /* A focus inside it goes, unless another window is activated, whose
     * messages move it (see `activation.ts`). */
    if (this.focus && this.#within(this.focus, window) && !next) {
      this.focus = null;
    }

    /* Its children go first, with nothing to paint again: it covers them.
     * Then it: found again, as they may have been above it. */
    if (remove) {
      for (const child of this.windows.filter((other) => other.parent === window)) {
        this.windows.splice(this.windows.indexOf(child), 1);
        child.visible = false;
      }

      this.windows.splice(this.windows.indexOf(window), 1);
    }

    if (!window.visible) {
      return;
    }

    window.visible = false;

    const wasActive = window.active;

    window.active = false;

    const before = this.owners.slice();

    this.#own();

    if (!this.#restoreBits(window)) {
      this.#exposeOwned(window, before);
    }

    if (wasActive && next) {
      next.active = true;
      this.onActivate?.(next);
      this.pendingActivation ??= { from: window, click: false };
      this.paintFrame(next);
    }
  }

  /**
   * Moves or sizes a window. Its client area is worked out again, and if it
   * shows, what it covered and what it now covers are painted again.
   */
  place(window: DesktopWindow, left: number, top: number, width: number, height: number) {
    const was = { ...window } as DesktopWindow;
    const origin = { x: window.left + window.client.left, y: window.top + window.client.top };

    window.left = left;
    window.top = top;
    window.width = width;
    window.height = height;
    this.#layout(window);

    /* Its children keep their places in its client area, so they move as
     * far as that does: they are placed on the screen, not in the parent. */
    const dx = window.left + window.client.left - origin.x;
    const dy = window.top + window.client.top - origin.y;
    const family = this.windows.filter((other) => other !== window && this.#within(other, window));

    if (dx || dy) {
      for (const child of family) {
        child.left += dx;
        child.top += dy;
        this.#layout(child);
      }
    }

    /* An icon's title goes with it, below it. */
    if (window.iconTitle && window.state === 'minimized') {
      this.#placeTitle(window);
    }

    if (!window.visible) {
      return;
    }

    this.#own();

    /* What the move uncovered, as Windows invalidates it: the old place less
     * the new, where that is one rectangle; the old place otherwise. */
    const uncovered = uncoveredBy(was, window);

    if (uncovered) {
      this.#expose(uncovered as DesktopWindow);
    }

    this.paintFrame(window);
    window.needsErase = true;
    window.needsPaint = true;

    for (const child of family) {
      if (this.#showing(child)) {
        this.paintFrame(child);
        child.needsErase = true;
        child.needsPaint = true;
      }
    }
  }

  /** Where the `slot`th icon of a parent's client area goes: its corner. See `minimize`. */
  iconSlot(parent: DesktopWindow | null, slot: number) {
    const cxIcon = this.environment.metric(SM_CXICON);
    const cxSpacing = this.environment.metric(SM_CXICONSPACING);
    const cySpacing = this.environment.metric(SM_CYICONSPACING);
    const originX = parent ? parent.left + parent.client.left : 0;
    const originY = parent ? parent.top + parent.client.top : 0;
    const across = Math.max(1, Math.trunc((parent ? parent.clientWidth : this.screen.width) / cxSpacing));
    const high = parent ? parent.clientHeight : this.screen.height;
    const inset = (cxSpacing >> 1) - (cxIcon >> 1);

    return {
      left: originX + (slot % across) * cxSpacing + inset,
      top: originY + high - (Math.trunc(slot / across) + 1) * cySpacing,
    };
  }

  /**
   * A parent's icons put in their slots again, from the one at the top, any
   * place set for them forgotten: `ArrangeIconicWindows`. Answers how many
   * (`userwin`: of two, the one minimized last, above, takes the first slot).
   */
  arrangeIcons(parent: DesktopWindow | null) {
    const icons = this.windows.filter(
      (other) => other.parent === parent && other.visible && other.state === 'minimized' && !other.titleOf
    );

    icons.forEach((icon, slot) => {
      const { left, top } = this.iconSlot(parent, slot);

      icon.iconPlace = null;
      this.place(icon, left, top, icon.width, icon.height);
    });

    return icons.length;
  }

  /**
   * A window made another's child, keeping its place in its parent's client
   * area, above its new siblings: `SetParent` (`userwin`).
   */
  reparent(window: DesktopWindow, parent: DesktopWindow | null) {
    const originOf = (of: DesktopWindow | null) =>
      of ? { x: of.left + of.client.left, y: of.top + of.client.top } : { x: 0, y: 0 };
    const was = originOf(window.parent);
    const x = window.left - was.x;
    const y = window.top - was.y;
    const family = this.windows.filter((other) => this.#within(other, window));

    for (const member of family) {
      this.windows.splice(this.windows.indexOf(member), 1);
    }

    window.parent = parent;
    this.windows.splice(parent ? this.windows.indexOf(parent) : this.front(window), 0, ...family);

    const now = originOf(parent);

    this.place(window, now.x + x, now.y + y, window.width, window.height);
  }

  /** Hides a window without taking it away: as `destroy`, but it can be shown again. */
  hide(window: DesktopWindow) {
    if (!window.visible) {
      return;
    }

    /* A minimized window's title goes with it. */
    if (window.iconTitle) {
      this.destroy(window.iconTitle);
      window.iconTitle = null;
    }

    if (this.menuOwner === window) {
      this.menuOwner = null;
    }

    /* To the bottom, its children with it and kept: hidden, not gone. */
    const family = this.windows.filter((other) => this.#within(other, window));

    for (const member of family) {
      this.windows.splice(this.windows.indexOf(member), 1);
    }

    this.windows.push(...family);
    this.#takeAway(window, false);
  }

  /** The window that shows at a point of the screen, if any. */
  windowAt(x: number, y: number) {
    if (x < 0 || y < 0 || x >= this.screen.width || y >= this.screen.height) {
      return null;
    }

    const id = this.owners[y * this.screen.width + x];
    const at = this.windows.findIndex((window) => window.id === id);

    /* A group box answers `WM_NCHITTEST` with `HTTRANSPARENT` (`USER.EXE`
     * seg25 `1c9b`): the mouse goes to what lies beneath it. */
    for (let index = at; index >= 0 && index < this.windows.length; index++) {
      const window = this.windows[index];
      const clip = (window as any).clipRect;

      if (index !== at && (!this.#showing(window) || !clip || x < clip[0] || y < clip[1] || x >= clip[2] || y >= clip[3])) {
        continue;
      }

      if (!(window.control?.className === 'BUTTON' && (window.control.style & 0x0f) === 7)) {
        return window;
      }
    }

    return at >= 0 ? this.windows[at] : null;
  }

  /**
   * A window's own scroll bar's rectangle, relative to the window, as the
   * frame lays it out: from its client area's edge, sharing a line with the
   * window's edge when it has one (see `frame.ts`).
   */
  scrollBarRect(window: DesktopWindow, vertical: boolean) {
    const { left, top, right, bottom } = window.client;
    const overlap = left > 0 || top > 0 ? 1 : 0;

    return vertical
      ? { left: right, top: top - overlap, right: right + this.environment.metric(2), bottom: bottom + 1 }
      : { left: left - overlap, top: bottom, right: right + 1, bottom: bottom + this.environment.metric(3) };
  }

  /** Draws on a window, frame and all, where it shows. */
  windowPainter(window: DesktopWindow) {
    return new Painter(
      this.#view(window, 0, 0, window.width, window.height, false),
      0,
      0,
      window.width,
      window.height,
      this.environment as any
    );
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

    /* Not held to a paint's clip, which is the client area's. */
    const whole = this.#view(window, 0, 0, window.width, window.height, false);

    paintFrame(
      whole,
      0,
      0,
      window.width,
      window.height,
      {
        style: window.style,
        scroll: (window as any).scroll,
        active: window.captionLit,
        title: window.title,
        menu: window.menu,
        menuGrayed: window.menuGrayed,
        menuSelected: window.menuSelected,
        systemMenuOpen: window.systemMenuOpen,
        zoomed: window.state === 'maximized',
        modal: window.modalFrame,
      },
      this.#frameEnvironment(whole)
    );
  }

  /** Erases a window's client area with its class's brush, where it shows. */
  erase(
    window: DesktopWindow,
    colorref = window.background?.colorref,
    pattern = colorref === window.background?.colorref ? window.background?.pattern : undefined
  ) {
    window.needsErase = false;

    if (!this.#showing(window) || colorref === undefined) {
      return;
    }

    this.#fill(
      window.surface.bitmap,
      0,
      0,
      window.clientWidth,
      window.clientHeight,
      colorref,
      0,
      0,
      pattern
    );
  }

  /**
   * Everything to be drawn again, as after the system colours change: nothing
   * is drawn at once. **Recorded** by `syscol`: the desktop shows its new
   * colour once a program takes its messages, and each window is sent
   * `WM_PAINT`, its frame drawn by `WM_NCPAINT` in `BeginPaint` before its
   * `WM_ERASEBKGND`.
   */
  repaintAll() {
    this.backgroundDue = true;

    for (const window of [...this.windows].reverse()) {
      if (this.#showing(window) && !paintsItself(window)) {
        /* An icon's title, which has no window procedure: with the desktop. */
        (window as any).needsFrame = true;
      } else if (this.#showing(window)) {
        (window as any).needsNcPaint = true;
        (window as any).dirtyRect = undefined;
        window.needsErase = true;
        window.needsPaint = true;
      }
    }
  }

  /** Whether the desktop itself is to be drawn again, when paints are next looked for. */
  backgroundDue = false;

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
              menuGrayed: window.menuGrayed,
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
  #view(window: DesktopWindow, left: number, top: number, width: number, height: number, clipped = true) {
    const x0 = window.left + left;
    const y0 = window.top + top;
    const stride = this.screen.width;

    return DeviceBitmap.view(this.screen, x0, y0, width, height, (x, y) => {
      const sx = x0 + x;
      const sy = y0 + y;

      if (sx < 0 || sy < 0 || sx >= stride || sy >= this.screen.height) {
        return false;
      }

      /* While it paints, only what was to be painted again: `BeginPaint`'s clip,
       * the region where there is one (`updrgn`). */
      const clip = clipped ? (window as any).paintClip : undefined;

      if (clip && (sx < clip[0] || sy < clip[1] || sx >= clip[2] || sy >= clip[3])) {
        return false;
      }

      const shape = clipped ? (window as any).paintShape : undefined;

      if (shape && !shape.contains(sx, sy)) {
        return false;
      }

      const owner = this.owners[sy * stride + sx];

      return owner === window.id || this.#throughSibling(window, owner, sx, sy);
    });
  }

  /**
   * Whether a window draws at a pixel a sibling above it shows at: a window
   * without `WS_CLIPSIBLINGS` is not clipped by its siblings, only by its
   * ancestors and by what lies over them. **Recorded** by `groupbox`: a
   * dialog's radio buttons draw inside the group box made before them, which
   * lies over them. A parent still does not draw over its children.
   */
  #throughSibling(window: DesktopWindow, owner: number, sx: number, sy: number) {
    const parent = window.parent;
    const clip = (window as any).clipRect;

    if (!owner || !clip || !this.#showing(window)) {
      return false;
    }

    if (sx < clip[0] || sy < clip[1] || sx >= clip[2] || sy >= clip[3]) {
      return false;
    }

    /* A window without `WS_CLIPCHILDREN` draws over its own children, as a
     * dialog's erase reaches under its controls. */
    if (!(window.style & WS_CLIPCHILDREN)) {
      for (let other = this.#byId.get(owner)?.parent ?? null; other; other = other.parent) {
        if (other === window) {
          return true;
        }
      }
    }

    if (!parent || window.style & WS_CLIPSIBLINGS) {
      return false;
    }

    if (sx < clip[0] || sy < clip[1] || sx >= clip[2] || sy >= clip[3]) {
      return false;
    }

    let other = this.#byId.get(owner) ?? null;

    while (other && other.parent !== parent) {
      other = other.parent;
    }

    return !!other && other !== window;
  }

  /** Which window shows at each pixel, the topmost winning. */
  #own() {
    const stride = this.screen.width;

    this.#byId = new Map(this.windows.map((window) => [window.id, window]));

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

      (window as any).clipRect = [left, top, right, bottom];

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
   * The window a `WM_PAINT` is due to next, if any: the windows at the top
   * from the front back, each before its children (`showseq`: an owned
   * pop-up painted before its owner beneath it, the owner before its
   * child); siblings too from the top (`showsq2`: of two children
   * overlapping, the one lying over the other first).
   */
  get unpainted() {
    return this.unpaintedWhere(() => true);
  }

  /** The first window due a paint that also passes `match`, as `unpainted`. */
  unpaintedWhere(match: (window: DesktopWindow) => boolean) {
    if (this.backgroundDue) {
      this.backgroundDue = false;
      this.paintBackground();

      for (const window of this.windows) {
        if (!paintsItself(window) && (window as any).needsFrame) {
          (window as any).needsFrame = false;
          this.paintFrame(window);
        }
      }
    }

    /* Nothing to paint, nothing to look for: a program that polls asks on
     * every call, and the walk below looks at every window for each. */
    if (!this.windows.some((window) => window.needsPaint)) {
      return null;
    }

    const due = (window: DesktopWindow) =>
      paintsItself(window) && window.needsPaint && this.#showing(window) && match(window);
    const walk = (window: DesktopWindow): DesktopWindow | null => {
      if (due(window)) {
        return window;
      }

      for (const child of this.windows) {
        if (child.parent === window) {
          const found = walk(child);

          if (found) {
            return found;
          }
        }
      }

      return null;
    };

    for (const window of this.windows) {
      const found = window.parent ? null : walk(window);

      if (found) {
        this.aboutToPaint(found);
        return found;
      }
    }

    return null;
  }

  /**
   * A window about to be sent `WM_PAINT`: its frame drawn again first if its
   * parent painted over it, and, for a window without `WS_CLIPCHILDREN`, which
   * paints over its children frame and all, its children due to be painted
   * again after it -- as Windows invalidates a parent's children with it.
   */
  aboutToPaint(window: DesktopWindow) {
    if ((window as any).needsFrame) {
      (window as any).needsFrame = false;
      this.paintFrame(window);
    }

    /* Only its children in what is to be painted again, when that is known. */
    const dirty = (window as any).dirtyRect;
    const quiet = !!dirty && (window as any).quietDirty === dirty;

    (window as any).paintShape = shapeOf(window, dirty);
    (window as any).dirtyRect = undefined;
    (window as any).dirtyShape = undefined;
    (window as any).quietDirty = undefined;
    (window as any).paintClip = dirty;

    /* Not when all it is due is where its children were shown: they were
     * due themselves then (see `showRaster`). */
    if (!(window.style & WS_CLIPCHILDREN) && !quiet) {
      for (const other of this.windows) {
        const inside =
          !dirty ||
          (other.left < dirty[2] && dirty[0] < other.left + other.width && other.top < dirty[3] && dirty[1] < other.top + other.height);

        if (other !== window && inside && this.#within(other, window) && this.#showing(other)) {
          /* Due where the parent is: the part of it the parent's due part
           * covers, added to what it was due already (`showseq`: its frame
           * then drawn with a region, not whole). */
          const part = dirty && [
            Math.max(dirty[0], other.left),
            Math.max(dirty[1], other.top),
            Math.min(dirty[2], other.left + other.width),
            Math.min(dirty[3], other.top + other.height),
          ];
          const was = (other as any).dirtyRect;

          (other as any).dirtyRect = !part
            ? undefined
            : !other.needsPaint
              ? part
              : was
                ? [Math.min(was[0], part[0]), Math.min(was[1], part[1]), Math.max(was[2], part[2]), Math.max(was[3], part[3])]
                : undefined;
          other.needsErase = true;
          other.needsPaint = true;

          /* A program's window's frame by `WM_NCPAINT` in its `BeginPaint`
           * (`showseq`); a control of USER's, which paints itself, and an
           * icon's title, which has no window procedure, as it paints. */
          if (other.hwnd && !other.control) {
            (other as any).needsNcPaint = true;
          } else {
            (other as any).needsFrame = true;
          }
        }
      }
    }
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

    /* A child fills its parent's client area, its frame and caption just
     * outside it, where they do not show: an MDI document window
     * (`USER.EXE` seg15 `16ef`). */
    if (window.parent) {
      const parent = window.parent;
      const insets = this.frameInsets(window.style & ~0x00300000, false, false);

      this.place(
        window,
        parent.left + parent.client.left - insets.left,
        parent.top + parent.client.top - insets.top,
        parent.clientWidth + insets.left + insets.right,
        parent.clientHeight + insets.top + insets.bottom
      );
      return;
    }

    /* Where `WM_GETMINMAXINFO` offers it (`minMaxInfo`, `showseq`): with a
     * sizing frame, a frame beyond the screen on every side; without one,
     * a border up and to the left, and four borders more than the screen
     * across and down -- Flak Attack of the corpus, whose caption Windows
     * shows from the screen's top row. */
    if (!(window.style & WS_THICKFRAME)) {
      const bx = this.environment.metric(SM_CXBORDER);
      const by = this.environment.metric(SM_CYBORDER);

      this.place(window, -bx, -by, this.screen.width + 4 * bx, this.screen.height + 4 * by);
      return;
    }

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
   * Minimizes a window to its icon: `SM_CXICON` and four square, in the
   * first free slot of its parent's client area -- the screen's, for a
   * top-level window -- with its title in a window of its own below it.
   *
   * **Read out of `USER.EXE`** (seg4 `0000`, called from seg6 `1bdb`): the
   * slots are `SM_CXICONSPACING` by `SM_CYICONSPACING`, as many across as fit
   * and at least one, filled from the bottom left, along, then up a row. The
   * icon goes half a spacing less half an icon into its slot, at the slot's
   * top. A slot is taken if a visible minimized sibling's slot, worked out the
   * same way back from its icon, overlaps it. A position set for the icon
   * is used instead: winbox.js keeps the one it was moved to, by dragging or
   * `SetWindowPos`, which `iconclk` records minimized again. **Recorded** by
   * the `sizing` probe on four displays for the first slot: (21, 408) on the
   * VGA, (21, 284) on the EGA.
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
    const parent = window.parent;
    const originX = parent ? parent.left + parent.client.left : 0;
    const originY = parent ? parent.top + parent.client.top : 0;
    const across = Math.max(1, Math.trunc((parent ? parent.clientWidth : this.screen.width) / cxSpacing));
    const high = parent ? parent.clientHeight : this.screen.height;
    const inset = (cxSpacing >> 1) - (cxIcon >> 1);
    const taken = this.windows
      .filter((other) => other !== window && other.parent === parent)
      .filter((other) => other.visible && other.state === 'minimized' && !other.titleOf)
      .map((other) => ({ left: other.left - inset, top: other.top }));
    const slotAt = (slot: number) => ({
      left: originX + (slot % across) * cxSpacing,
      top: originY + high - (Math.trunc(slot / across) + 1) * cySpacing,
    });
    const overlaps = (a: { left: number; top: number }, b: { left: number; top: number }) =>
      Math.abs(a.left - b.left) < cxSpacing && Math.abs(a.top - b.top) < cySpacing;
    let slot = 0;

    while (taken.some((other) => overlaps(other, slotAt(slot)))) {
      slot++;
    }

    const { left, top } = slotAt(slot);

    /* An icon moved goes back where it was moved to (`iconclk`). */
    if (window.iconPlace) {
      this.place(window, window.iconPlace.left, window.iconPlace.top, cxIcon + 4, cyIcon + 4);
    } else {
      this.place(window, left + inset, top, cxIcon + 4, cyIcon + 4);
    }

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
    this.onTitle?.(title);

    /* With an icon, USER draws it; without one, the window is erased and
     * painted like any other -- the `icons` probe's bare window shows its
     * class's white. */
    window.needsErase = !window.icon;
    window.needsPaint = !window.icon;
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

  /** An icon: its background, and the icon drawn over it through its mask. */
  #paintIcon(window: DesktopWindow) {
    this.eraseIcon(window);
    this.drawIcon(window);
  }

  /**
   * An icon's background, as `DefWindowProc` erases it for
   * `WM_ICONERASEBKGND` (`USER.EXE` seg1 `5881`): a child's is its parent's
   * class brush, and nothing if the parent has none; a top-level window's is
   * the desktop's.
   */
  eraseIcon(window: DesktopWindow) {
    const whole = this.#view(window, 0, 0, window.width, window.height);
    const parent = window.parent;

    if (!parent) {
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
      return;
    }

    const colorref = parent.background?.colorref;

    if (colorref !== undefined) {
      this.#fill(
        whole,
        0,
        0,
        window.width,
        window.height,
        colorref,
        window.left - parent.left - parent.client.left,
        window.top - parent.top - parent.client.top
      );
    }
  }

  /**
   * A window's icon drawn in the middle of it, as `DefWindowProc` draws it
   * for `WM_PAINTICON` (seg1 `580f`): half of what the window's width and
   * height leave around `SM_CXICON` and `SM_CYICON`.
   */
  drawIcon(window: DesktopWindow) {
    /* `IDI_APPLICATION` is shown as USER's Windows flag. */
    const icon =
      window.icon && window.icon === this.environment.icons?.get(IDI_APPLICATION)
        ? (this.environment.applicationIcon ?? window.icon)
        : window.icon;

    if (!icon) {
      return;
    }

    const whole = this.#view(window, 0, 0, window.width, window.height);
    const left = (window.width - this.environment.metric(SM_CXICON)) >> 1;
    const top = (window.height - this.environment.metric(SM_CYICON)) >> 1;

    for (let y = 0; y < icon.height; y++) {
      for (let x = 0; x < icon.width; x++) {
        const at = y * icon.width + x;
        const beneath = whole.indexAt(left + x, top + y) ?? 0;

        whole.put(left + x, top + y, (icon.and[at] ? beneath : 0) ^ icon.xor[at]);
      }
    }
  }

  /** An icon's title: the caption's colours while its window is active. */
  #paintIconTitle(title: DesktopWindow) {
    const window = title.titleOf!;
    const whole = this.#view(title, 0, 0, title.width, title.height);
    const active = window.captionLit;
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

  /**
   * Whether a window shows: it and every window it is a child of are visible,
   * and none of those it is a child of is minimized -- a minimized window's
   * children stay visible, but its icon is its own (`iconkid`).
   */
  #showing(window: DesktopWindow) {
    for (let at: DesktopWindow | null = window; at; at = at.parent) {
      if (!at.visible || (at !== window && at.state === 'minimized')) {
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
    const environment: any = this.#controlEnvironment(window, bitmap);
    const own = window.control.font;
    const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

    environment.systemAverage = Math.trunc((Math.trunc(this.#text.measureText(letters).width / 26) + 1) / 2);

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

    /* Text on the background colour, the cell it takes. */
    if (environment.ground !== undefined) {
      const draw = environment.text;
      const painter = new Painter(bitmap, 0, 0, window.clientWidth, window.clientHeight, environment);

      environment.text = (line: string, colour: number, x: number, y: number) => {
        painter.fill(x, y, x + environment.measure(line), y + environment.font.height, painter.solid(environment.ground));
        draw(line, colour, x, y);
      };
    }

    if (window.control.className === 'EDIT') {
      if (window.control.style & 0x0004) {
        this.#paintLines(window, bitmap, environment);
      } else {
        this.#paintEdit(window, bitmap, environment);
      }

      return;
    }

    /* A scroll bar with both arrows off shows its parent's class background. */
    if (window.control.className === 'SCROLLBAR') {
      (window.control as any).shaft = window.parent?.background?.colorref ?? null;
    }

    paintControl(bitmap, window.clientWidth, window.clientHeight, window.control, environment);

    /* A push button with the focus: its dotted rectangle. */
    if (this.focus === window) {
      const rect = focusRect(
        window.clientWidth,
        window.clientHeight,
        window.control,
        environment,
        { x: this.environment.metric(5), y: this.environment.metric(6) },
        this.screen.height > 300
      );

      if (rect) {
        this.focusRectangle(window, rect.left, rect.top, rect.right, rect.bottom);
      }
    }
  }

  /**
   * A list box's row of a string item (`USER.EXE` seg35 `069a`): a selected
   * row filled in the highlight colour and its text in the highlight text
   * colour; an unselected one filled in the window colour when `fill` says
   * so, and its text on its own cell. The text is two pixels in.
   */
  listText(window: DesktopWindow, index: number, row: number, selected: boolean, fill: boolean, rows?: [number, number]) {
    const control = window.control!;
    const list = (control as any).list;
    const bitmap = window.surface.bitmap as DeviceBitmap;
    const environment: any = this.#controlEnvironment(window, bitmap);
    const painter = new Painter(bitmap, 0, 0, window.clientWidth, window.clientHeight, environment);
    const y = row * list.height;
    const surface: any = Surface.memory();
    const [low, high] = rows ?? [y, y + list.height];
    const top = Math.max(y, low);
    const bottom = Math.min(y + list.height, high);

    if (selected || fill) {
      painter.fill(0, top, window.clientWidth, bottom, painter.colour(selected ? 13 : 5));
    }

    surface.font = control.font?.font ?? this.environment.systemFont;
    surface.backMode = 2;
    surface.backcolor = colourOf(selected ? environment.sysColor(13) : (environment.ground ?? environment.sysColor(5)));
    surface.bitmap = bitmap;
    surface.textColor = colourOf(environment.sysColor(selected ? 14 : 8));
    surface.withClip({ left: 0, top, right: window.clientWidth, bottom }, () =>
      surface.fillText(2, y, String(control.items[index]))
    );
  }

  /** Moves a window's client pixels down by `dy`, clearing rows `from` to `to` in the window colour, as `ScrollWindow` and the erase after it do. */
  scrollClient(window: DesktopWindow, dy: number, from: number, to: number) {
    const bitmap = window.surface.bitmap as DeviceBitmap;
    const width = window.clientWidth;
    const height = window.clientHeight;
    const rows: (number | null)[][] = [];

    for (let y = 0; y < height; y++) {
      const row: (number | null)[] = [];

      for (let x = 0; x < width; x++) {
        row.push(bitmap.indexAt(x, y) ?? null);
      }

      rows.push(row);
    }

    for (let y = 0; y < height; y++) {
      const source = y - dy;

      if (source < 0 || source >= height) {
        continue;
      }

      for (let x = 0; x < width; x++) {
        const value = rows[source][x];

        if (value !== null) {
          bitmap.put(x, y, value);
        }
      }
    }

    const painter = new Painter(bitmap, 0, 0, width, height, this.#frameEnvironment(bitmap));

    painter.fill(0, from, width, to, painter.colour(5));
    bitmap.context.markRect(0, 0, width, height);
  }

  /**
   * The dotted focus rectangle on a list box's row, as `DrawFocusRect` draws
   * it: each side a line of the grey pattern inverted, so a corner, on two
   * sides, is inverted twice. **Recorded** by `listbox`: the inverted pixels
   * are those whose client coordinates add to an odd number.
   */
  listFocus(window: DesktopWindow, row: number) {
    const list = (window.control as any).list;
    const bitmap = window.surface.bitmap as DeviceBitmap;
    const width = window.clientWidth;
    const top = row * list.height;
    const bottom = top + list.height - 1;
    const mask = (1 << bitmap.depth) - 1;
    const flip = (x: number, y: number) => {
      if ((x + y) & 1) {
        const index = bitmap.indexAt(x, y);

        if (index !== null && index !== undefined) {
          bitmap.put(x, y, index ^ mask);
        }
      }
    };

    for (let x = 0; x < width; x++) {
      flip(x, top);
      flip(x, bottom);
    }

    for (let y = top; y <= bottom; y++) {
      flip(0, y);
      flip(width - 1, y);
    }

    bitmap.context.markRect(0, top, width, bottom + 1);
  }

  /**
   * A combo box's own painting (`USER.EXE` seg33 `0875`): the window colour
   * between its field and its button; the button, raised, with the display
   * driver's combo arrow centred on it in the button text colour; and for a
   * drop-down list its field -- outlined in the frame colour while the list
   * is put away, filled, and while it has the focus and the list is put away
   * the highlight inside a pixel of the window colour, the text a pixel in,
   * and the dotted focus rectangle. Answers the rectangle an owner draws the
   * field's item in, three pixels inside the field.
   */
  paintCombo(window: DesktopWindow, combo: any, text: string | null) {
    const bitmap = window.surface.bitmap as DeviceBitmap;

    const environment: any = this.#frameEnvironment(bitmap);
    const painter = new Painter(bitmap, 0, 0, window.clientWidth, window.clientHeight, environment);
    const [fl, ft, fr, fb] = combo.field;
    const button = combo.button;

    if (button && !combo.dropped) {
      painter.fill(fr, ft, button[2], Math.max(fb, button[3]), painter.colour(5));
    }

    if (button) {
      const [bl, bt, br, bb] = button;
      const arrow = environment.oem?.get(32738);

      painter.thumb(bl, bt, br, bb);

      if (arrow) {
        const x = bl + Math.trunc((br - bl - arrow.width) / 2) + (combo.pressed ? 1 : 0);
        const y = bt + Math.trunc((bb - bt - arrow.height) / 2) + (combo.pressed ? 1 : 0);
        const ink = painter.colour(18);

        for (let row = 0; row < arrow.height; row++) {
          for (let column = 0; column < arrow.width; column++) {
            const colour = arrow.devicePalette.colours[arrow.indexAt(column, row) ?? 0] ?? [0, 0, 0];

            if (colour[0] + colour[1] + colour[2] === 0) {
              painter.fill(x + column, y + row, x + column + 1, y + row + 1, ink);
            }
          }
        }
      }
    }

    if (combo.type !== 3) {
      return null;
    }

    if (!combo.dropped) {
      painter.outline(fl, ft, fr, fb, painter.colour(6));
    }

    const highlighted = combo.focused && !combo.dropped;
    let rc = [fl + 1, ft + 1, fr - 1, fb - 1];

    painter.fill(rc[0], rc[1], rc[2], rc[3], painter.colour(5));
    rc = [rc[0] + 1, rc[1] + 1, rc[2] - 1, rc[3] - 1];

    if (highlighted) {
      painter.fill(rc[0], rc[1], rc[2], rc[3], painter.colour(13));
    }

    if (text !== null) {
      const surface: any = Surface.memory();

      surface.font = window.control?.font?.font ?? this.environment.systemFont;
      surface.backMode = 1;
      surface.bitmap = bitmap;
      surface.textColor = colourOf(environment.sysColor(highlighted ? 14 : 8));
      surface.withClip({ left: rc[0], top: rc[1], right: rc[2], bottom: rc[3] }, () =>
        surface.fillText(rc[0] + 1, rc[1] + 1, text)
      );
    }

    return { rc, highlighted, item: [fl + 3, ft + 3, fr - 3, fb - 3] };
  }

  /**
   * The dotted focus rectangle on a rectangle of a window's client area, as
   * `DrawFocusRect` draws it: a grey pattern in the context's text and
   * background colours, exclusive-ored onto each side -- the background's
   * colour where the client coordinates add to an odd number, the text's
   * where even -- so a corner, on two sides, comes back as it was. Over a
   * list box, black on white, the odd pixels are inverted and the even left;
   * over a combo box's highlighted field, white on dark blue, every pixel
   * changes. **Recorded** by `listbox` and `combobox`.
   */
  focusRectangle(
    window: DesktopWindow,
    left: number,
    top: number,
    right: number,
    bottom: number,
    text = 8,
    back = 5
  ) {
    const bitmap = window.surface.bitmap as DeviceBitmap;
    const environment = this.environment;
    const index = (system: number) => {
      const colour = environment.sysColor(system);

      return bitmap.devicePalette.index(colour & 0xff, (colour >> 8) & 0xff, (colour >> 16) & 0xff);
    };
    const [ink, ground] = [index(text), index(back)];
    const flip = (x: number, y: number) => {
      const was = bitmap.indexAt(x, y);

      if (was !== null && was !== undefined) {
        bitmap.put(x, y, was ^ ((x + y) & 1 ? ground : ink));
      }
    };

    for (let x = left; x < right; x++) {
      flip(x, top);
      flip(x, bottom - 1);
    }

    for (let y = top; y < bottom; y++) {
      flip(left, y);
      flip(right - 1, y);
    }

    bitmap.context.markRect(left, top, right, bottom);
  }

  /** Shows a window at the top without making it active, as `SW_SHOWNA` does a combo box's list. */
  /**
   * Where a window goes to be at the top: below the topmost windows, unless
   * it is one. USER's hidden `#32771` is topmost, and a program's window
   * made after it lies below it (`hidwnd`).
   */
  front(window: DesktopWindow) {
    if (window.topmost) {
      return 0;
    }

    const at = this.windows.findIndex((other) => !other.topmost || other === window);

    return at < 0 ? this.windows.length : at;
  }

  /**
   * A window shown where it lies, not brought to the top nor made active: a
   * window not active minimized with `SW_MINIMIZE` keeps its place
   * (`owners`).
   */
  showInPlace(window: DesktopWindow) {
    window.visible = true;
    this.#own();
    this.paintFrame(window);

    if (window.iconTitle && !window.iconTitle.visible) {
      window.iconTitle.visible = true;
      this.#own();
      this.paintFrame(window.iconTitle);
    }

    const drawn = window.state === 'minimized' && window.icon !== null;

    window.needsErase = !drawn;
    window.needsPaint = !drawn;
  }

  /** Whether a window, or the window at the top it is in, is owned by another, at any remove. */
  #ownedWithin(window: DesktopWindow, owner: DesktopWindow) {
    let top = window;

    while (top.parent) {
      top = top.parent;
    }

    for (let at = top.owner; at; at = at.owner) {
      if (at === owner) {
        return true;
      }
    }

    return false;
  }

  /**
   * The windows a window owns, hidden as it is minimized and shown again as
   * it is restored (`owners`).
   */
  hideOwned(window: DesktopWindow, hide: boolean) {
    for (const other of [...this.windows]) {
      if (other.parent || !this.#ownedWithin(other, window)) {
        continue;
      }

      /* Hidden where it lies: its place is kept for when it shows again. */
      if (hide && other.visible) {
        other.hiddenWithOwner = true;
        other.visible = false;
        other.active = false;

        const before = this.owners.slice();

        this.#own();
        this.#exposeOwned(other, before);
      } else if (!hide && other.hiddenWithOwner) {
        other.hiddenWithOwner = false;
        other.visible = true;
        this.#own();
        this.paintFrame(other);
        other.needsErase = true;
        other.needsPaint = true;
      }
    }
  }

  /**
   * A window put at the very bottom of the windows at the top, its icon's
   * title just above it and its children with it, and shown there if
   * `show` -- not made active, as a window minimized with
   * `SW_SHOWMINNOACTIVE` or made minimized goes (`showmin`).
   */
  toBottom(window: DesktopWindow, show: boolean) {
    const family = this.windows.filter(
      (other) => this.#within(other, window) || other === window.iconTitle
    );

    for (const member of family) {
      this.windows.splice(this.windows.indexOf(member), 1);
    }

    this.windows.push(...family.filter((member) => member === window.iconTitle));
    this.windows.push(...family.filter((member) => member !== window.iconTitle));

    if (show) {
      window.visible = true;

      if (window.iconTitle) {
        window.iconTitle.visible = true;
      }

      this.#own();
      this.paintFrame(window);

      if (window.iconTitle) {
        this.paintFrame(window.iconTitle);
      }

      window.needsErase = true;
      window.needsPaint = true;
    } else {
      this.#own();
    }
  }

  showOnTop(window: DesktopWindow) {
    const family = this.windows.filter((other) => this.#within(other, window));

    for (const member of family) {
      this.windows.splice(this.windows.indexOf(member), 1);
    }

    this.windows.splice(this.front(window), 0, ...family);
    window.visible = true;
    this.#own();
    this.paintFrame(window);
    window.needsErase = true;
    window.needsPaint = true;
  }

  /** Takes a child from its parent to lie on the desktop where it is, as `SetParent` with none does. */
  detach(window: DesktopWindow) {
    window.parent = null;
    this.#own();
  }

  /** A list box's client area cleared in the window colour, as its erase does. */
  listErase(window: DesktopWindow) {
    const bitmap = window.surface.bitmap as DeviceBitmap;
    const painter = new Painter(bitmap, 0, 0, window.clientWidth, window.clientHeight, this.#controlEnvironment(window, bitmap));

    painter.fill(0, 0, window.clientWidth, window.clientHeight, painter.colour(5));
  }

  /**
   * A multi-line edit control (`USER.EXE` seg30 `0ed8`, seg26 `0020`): the
   * window colour, its border inside it, and each line that shows from the
   * first, the selected part of a line on the highlight colour; clipped to
   * the text's rectangle, so a line only partly room for is not drawn at all.
   */
  #paintLines(window: DesktopWindow, bitmap: DeviceBitmap, environment: any) {
    const control = window.control!;
    const layout = this.linesLayout(window);
    const width = window.clientWidth;
    const height = window.clientHeight;
    const painter = new Painter(bitmap, 0, 0, width, height, environment);
    const { rect, rows } = paintLines(control, layout);

    painter.fill(0, 0, width, height, painter.colour(5));

    if (control.border) {
      painter.outline(0, 0, width, height, painter.colour(6));
    }

    const clip = {
      left: rect.clip.left,
      top: rect.clip.top,
      right: width - rect.clip.left,
      bottom: Math.min(height - rect.clip.top, rect.bottom),
    };
    const surface: any = Surface.memory();

    surface.font = control.font?.font ?? this.environment.systemFont;
    surface.backMode = 1;
    surface.bitmap = bitmap;

    surface.withClip(clip, () => {
      for (const row of rows) {
        /* On the background colour, the line's whole width (`ctlcolor`). */
        if (environment.ground !== undefined) {
          painter.fill(
            clip.left,
            Math.max(row.y, clip.top),
            clip.right,
            Math.min(row.y + layout.height1, clip.bottom),
            painter.solid(environment.ground)
          );
        }

        for (const run of row.runs) {
          if (run.selected) {
            let across = 0;

            for (let at = 0; at < run.text.length; at++) {
              across += layout.charWidth(run.text.charCodeAt(at));
            }

            painter.fill(
              Math.max(run.x, clip.left),
              Math.max(row.y, clip.top),
              Math.min(run.x + across, clip.right),
              Math.min(row.y + layout.height1, clip.bottom),
              painter.colour(13)
            );
          }

          surface.textColor = colourOf(environment.sysColor(run.selected ? 14 : 8));
          surface.fillText(run.x, row.y, run.text);
        }
      }
    });
  }

  /**
   * An edit control, as `USER.EXE` paints one (seg28 `1151`, `0280`): its
   * client area in the window colour, its border inside it in the frame
   * colour, and the text from the first character that shows, clipped to the
   * text's rectangle and its margins below. The selection, while the control
   * has the focus or keeps it anyway (`ES_NOHIDESEL`), is a run in the
   * highlight colours on a ground a pixel taller each way than the text's
   * rectangle, which the clip takes back.
   */
  #paintEdit(window: DesktopWindow, bitmap: DeviceBitmap, environment: any) {
    const control = window.control!;
    const edit = editState(control);
    const layout = this.editLayout(window);
    const width = window.clientWidth;
    const height = window.clientHeight;
    const painter = new Painter(bitmap, 0, 0, width, height, environment);
    const COLOR_HIGHLIGHT = 13;
    const COLOR_HIGHLIGHTTEXT = 14;

    painter.fill(0, 0, width, height, painter.colour(5));

    if (control.border) {
      painter.outline(0, 0, width, height, painter.colour(6));
    }

    /* The clip: the client area less the margins, which the text's
     * rectangle is too but for its height. */
    const down = layout.top;
    const clip = { left: layout.left, top: layout.top, right: layout.right, bottom: height - down };
    const surface: any = Surface.memory();

    surface.font = control.font?.font ?? this.environment.systemFont;
    surface.backMode = 1;
    surface.bitmap = bitmap;

    /* Only the characters that fit wholly are drawn (seg28 `0521`): as many
     * from the first that shows as `GetTextExtent` keeps within the width. */
    const text = control.text;
    let last = edit.scroll;

    while (last < text.length && layout.measure(text.slice(edit.scroll, last + 1)) <= layout.width) {
      last++;
    }

    /* The runs either side of the selection and in it, each drawn on its
     * own (seg28 `0568`). */
    const [start, end] = selection(edit);
    const shows = start !== end && (edit.focused || (control.style & 0x0100) !== 0);
    const cut = (at: number) => Math.max(edit.scroll, Math.min(at, last));
    const runs: [number, number, boolean][] = shows
      ? [
          [edit.scroll, cut(start), false],
          [cut(start), cut(end), true],
          [cut(end), last, false],
        ]
      : [[edit.scroll, last, false]];

    surface.withClip(clip, () => {
      for (const [from, to, selected] of runs) {
        if (to <= from) {
          continue;
        }

        /* A run from the first character that shows starts at the text's
         * left; a later one, less the font's overhang (seg28 `02e6`). */
        const x =
          from === edit.scroll
            ? layout.left
            : layout.left + layout.measure(text.slice(edit.scroll, from)) - layout.overhang;
        const run = text.slice(from, to);

        if (selected) {
          const across = layout.measure(run);

          painter.fill(
            Math.max(x, clip.left),
            Math.max(layout.top - 1, clip.top),
            Math.min(x + across, clip.right),
            Math.min(layout.bottom + 1, clip.bottom),
            painter.colour(COLOR_HIGHLIGHT)
          );
        }

        surface.textColor = colourOf(
          environment.sysColor(selected ? COLOR_HIGHLIGHTTEXT : 8)
        );

        /* On the background colour, the cell it takes (`ctlcolor`). */
        surface.backMode = !selected && environment.ground !== undefined ? 2 : 1;
        surface.backcolor = colourOf(environment.ground ?? 0xffffff);
        surface.fillText(x, layout.top, run);
      }
    });
  }

  /**
   * Where an edit control's text and caret go, for its font: **read out of
   * `USER.EXE`**, and recorded by `editctl` on four displays.
   *
   * * The font's average width is its letters' width, `a` to `z` and `A` to
   *   `Z`, over 26, plus one, halved -- the dialog's rule -- or for a fixed
   *   pitch its `tmAveCharWidth` (seg2 `03a4`). The System font's is kept
   *   beside it.
   * * The text's rectangle is the client area; with a border, less half the
   *   smaller of the two average widths across and a quarter of the smaller
   *   of the two heights down, and never taller than a line (seg29 `0000`).
   * * The caret is a pixel wide for a font narrower than the System font and
   *   two otherwise, and a pixel taller than the font (seg28 `1224`).
   */
  editLayout(window: DesktopWindow) {
    const control = window.control!;
    const own = control.font;
    const system = this.environment.font;
    const measure = this.#measureFor(window);
    const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const averageOf = (width: number) => Math.trunc((Math.trunc(width / 26) + 1) / 2);
    const systemAverage = averageOf(this.#text.measureText(letters).width);
    const fixed = !!own?.metrics.fixedPitch;
    const average = own
      ? fixed
        ? own.metrics.average ?? systemAverage
        : averageOf(measure(letters))
      : systemAverage;
    const height = own ? own.metrics.height : system.height;
    const overhang = own ? own.metrics.overhang ?? 0 : 0;
    const border = !!control.border;
    const across = border ? Math.trunc(Math.min(average, systemAverage) / 2) : 0;
    const down = border ? Math.trunc(Math.min(height, system.height) / 4) : 0;
    const left = across;
    const top = down;
    const right = window.clientWidth - across;
    const bottom = Math.min(top + height, window.clientHeight - down);

    return {
      caretWidth: average < systemAverage ? 1 : 2,
      caretHeight: height + 1,
      left,
      top,
      right,
      bottom,
      width: right - left,
      average,
      fixed,
      overhang,
      measure,
    };
  }

  /**
   * What a multi-line edit control lays its lines out by: its client area,
   * its border, and its font's and the System font's average widths and
   * heights, and each character's width (`USER.EXE` seg27 `00df`, a table
   * filled from `GetCharWidth`).
   */
  linesLayout(window: DesktopWindow) {
    const single = this.editLayout(window);
    const control = window.control!;
    const own = control.font;
    const system = this.environment.font;
    const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const systemAverage = Math.trunc((Math.trunc(this.#text.measureText(letters).width / 26) + 1) / 2);
    const widths = new Map<number, number>();

    return {
      width: window.clientWidth,
      height: window.clientHeight,
      border: !!control.border,
      average: single.average,
      height1: own ? own.metrics.height : system.height,
      systemAverage,
      systemHeight: system.height,
      charWidth: (code: number) => {
        let width = widths.get(code);

        if (width === undefined) {
          width = single.measure(String.fromCharCode(code)) - single.overhang;
          widths.set(code, width);
        }

        return width;
      },
    };
  }

  /**
   * How wide a run of text is in a control's font, as `GetTextExtent` says:
   * nothing for no characters, where an emboldened font's extra pixel would
   * otherwise stand. `editctl` records it -- the caret in an empty control
   * in bold MS Sans Serif is a pixel left of the text's rectangle, its
   * overhang taken away and nothing added back.
   */
  #measureFor(window: DesktopWindow) {
    const own = window.control?.font;
    const text: any = own ? Surface.memory() : this.#text;

    if (own) {
      text.font = own.font;
    }

    return (line: string) => (line ? text.measureText(line).width : 0);
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
  /**
   * What a window hidden uncovered, and no more: the desktop where it showed,
   * and each window that shows now where it or its children did, due its
   * frame, an erase and a paint of the rectangle round that part -- a window
   * that lay above it, nothing (`showseq`: a window hidden beneath a
   * maximized one uncovers nothing). A window's parent is due the same
   * part unless it leaves its children out of its painting. `before` is who
   * showed where, as it was.
   */
  /**
   * Each window, but those `except`, that shows now where it did not before
   * -- `before` is who showed where, as it was -- due its frame, an erase and
   * a paint of the rectangle round that part.
   */
  #gained(before: Uint16Array, except: DesktopWindow[]) {
    const skip = new Set(except.map((window) => window.id));
    const areas = new Map<number, number[]>();
    const stride = this.screen.width;

    for (let at = 0; at < this.owners.length; at++) {
      const now = this.owners[at];

      if (!now || now === before[at] || skip.has(now)) {
        continue;
      }

      const x = at % stride;
      const y = (at - x) / stride;
      const area = areas.get(now);

      if (area) {
        area[0] = Math.min(area[0], x);
        area[1] = Math.min(area[1], y);
        area[2] = Math.max(area[2], x + 1);
        area[3] = Math.max(area[3], y + 1);
      } else {
        areas.set(now, [x, y, x + 1, y + 1]);
      }
    }

    for (const [id, area] of areas) {
      const window = this.#byId.get(id);

      if (!window) {
        continue;
      }

      if (!paintsItself(window)) {
        this.paintFrame(window);
      } else {
        (window as any).needsNcPaint = true;
      }

      const was = (window as any).dirtyRect;

      (window as any).dirtyRect = !window.needsPaint
        ? area
        : was
          ? [Math.min(was[0], area[0]), Math.min(was[1], area[1]), Math.max(was[2], area[2]), Math.max(was[3], area[3])]
          : undefined;
      window.needsErase = true;
      window.needsPaint = true;
    }
  }

  #exposeOwned(gone: DesktopWindow, before: Uint16Array) {
    this.paintBackground(gone.left, gone.top, gone.left + gone.width, gone.top + gone.height);

    const stride = this.screen.width;
    const ids = new Set([
      gone.id,
      ...this.windows.filter((other) => this.#within(other, gone)).map((other) => other.id),
    ]);
    const areas = new Map<number, number[]>();
    const [left, top, right, bottom] = [
      Math.max(gone.left, 0),
      Math.max(gone.top, 0),
      Math.min(gone.left + gone.width, stride),
      Math.min(gone.top + gone.height, this.screen.height),
    ];

    for (let y = top; y < bottom; y++) {
      for (let x = left; x < right; x++) {
        const at = y * stride + x;
        const now = this.owners[at];

        if (!now || !ids.has(before[at])) {
          continue;
        }

        const area = areas.get(now);

        if (area) {
          area[0] = Math.min(area[0], x);
          area[1] = Math.min(area[1], y);
          area[2] = Math.max(area[2], x + 1);
          area[3] = Math.max(area[3], y + 1);
        } else {
          areas.set(now, [x, y, x + 1, y + 1]);
        }
      }
    }

    const due = (window: DesktopWindow, area: number[]) => {
      if (!paintsItself(window)) {
        this.paintFrame(window);
      } else {
        (window as any).needsNcPaint = true;
      }

      const was = (window as any).dirtyRect;

      (window as any).dirtyRect = !window.needsPaint
        ? area
        : was
          ? [Math.min(was[0], area[0]), Math.min(was[1], area[1]), Math.max(was[2], area[2]), Math.max(was[3], area[3])]
          : undefined;
      window.needsErase = true;
      window.needsPaint = true;
    };

    for (const [id, area] of areas) {
      const window = this.#byId.get(id);

      if (!window) {
        continue;
      }

      due(window, area);

      for (let child = window; child.parent && !(child.parent.style & WS_CLIPCHILDREN); child = child.parent) {
        due(child.parent, area);
      }
    }
  }

  #expose(gone: DesktopWindow) {
    this.paintBackground(gone.left, gone.top, gone.left + gone.width, gone.top + gone.height);

    const area = [gone.left, gone.top, gone.left + gone.width, gone.top + gone.height];

    for (const window of this.windows) {
      if (window.visible && overlaps(window, gone)) {
        /* Its frame is drawn by `WM_NCPAINT`, even where only its client
         * area was uncovered (`uncovr2`); an icon's title, which has no
         * window procedure, here. It is erased at once, by `eraseDue`. */
        if (!paintsItself(window)) {
          this.paintFrame(window);
        } else {
          (window as any).needsNcPaint = true;
        }

        /* How much of it is to be painted again: this, added to what was
         * already, or all of it when all of it already was. */
        const was = (window as any).dirtyRect;

        (window as any).dirtyRect = !window.needsPaint
          ? area
          : was
            ? [Math.min(was[0], area[0]), Math.min(was[1], area[1]), Math.max(was[2], area[2]), Math.max(was[3], area[3])]
            : undefined;
        window.needsErase = true;
        window.needsPaint = true;
      }
    }
  }

  /**
   * Drawing straight on the screen, over every window, as USER's system
   * error box does through a DC for the whole desktop (see
   * `sys-error-box.ts`): a rectangle filled with a colour's brush, text in
   * the System font, and the width of text in it.
   */
  screenFill(left: number, top: number, width: number, height: number, colorref: number) {
    if (width > 0 && height > 0) {
      this.#fill(this.screen, left, top, width, height, colorref);
    }
  }

  screenText(x: number, y: number, line: string, colorref: number) {
    this.#text.bitmap = this.screen;
    this.#text.textColor = colourOf(colorref);
    this.#text.fillText(x, y, line);
    this.screen.context.markRect(0, 0, this.screen.width, this.screen.height);
  }

  measureSystem(line: string) {
    return this.#text.measureText(line).width;
  }

  /**
   * A rectangle of the screen drawn again: the desktop there, and each window
   * it touches due its frame, an erase and a paint of that part, as
   * `RedrawWindow` on the desktop with its children does.
   */
  redrawArea(left: number, top: number, right: number, bottom: number) {
    this.#expose({ left, top, width: right - left, height: bottom - top } as DesktopWindow);
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
    originY = 0,
    pattern?: Uint8Array
  ) {
    /* The pattern starts at the corner of what it is drawn through, or at
     * `originX, originY` before it -- the screen's corner, for the desktop's
     * own pattern seen through an icon. A pattern brush's own pattern the
     * same. */
    if (pattern) {
      for (let y = top; y < top + height; y++) {
        for (let x = left; x < left + width; x++) {
          bitmap.put(x, y, pattern[(((y + originY) & 7) << 3) | ((x + originX) & 7)]);
        }
      }

      bitmap.context.markRect(left, top, left + width, top + height);
      return;
    }

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

/** The part of a window's old place its new one leaves uncovered, when that is one rectangle; the old place otherwise; nothing when covered. */
function uncoveredBy(was: DesktopWindow, now: DesktopWindow) {
  const [l, t, r, b] = [was.left, was.top, was.left + was.width, was.top + was.height];
  const [nl, nt, nr, nb] = [now.left, now.top, now.left + now.width, now.top + now.height];

  if (nl <= l && nt <= t && nr >= r && nb >= b) {
    return null;
  }

  const rect = (left: number, top: number, right: number, bottom: number) => ({
    left,
    top,
    width: right - left,
    height: bottom - top,
  });

  /* Shrunk, or moved, along one side only. */
  if (nl <= l && nr >= r && nt <= t && nb < b && nb > t) return rect(l, nb, r, b);
  if (nl <= l && nr >= r && nb >= b && nt > t && nt < b) return rect(l, t, r, nt);
  if (nt <= t && nb >= b && nl <= l && nr < r && nr > l) return rect(nr, t, r, b);
  if (nt <= t && nb >= b && nr >= r && nl > l && nl < r) return rect(l, t, nl, b);

  return rect(l, t, r, b);
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
