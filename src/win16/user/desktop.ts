'use strict';

import { matchedIndex } from '../../raster/colour-match.js';
import { type CursorImage } from '../../raster/icon.js';
import { setUpdate, shapeOf, updateOf } from './update-region.js';
import { ClipRegion } from '../../raster/clip-region.js';
import { Color } from '../../raster/color.js';
import { DeviceBitmap } from '../../raster/device-bitmap.js';
import { ditherTile } from '../../raster/dither.js';
import { type IconData } from '../../raster/icon.js';
import { Surface } from '../../raster/surface.js';

import { eraseGroupCaption, focusRect, paintControl, type ControlState } from './controls.js';
import { editState, selection } from './edit.js';
import { paintLines } from './mledit.js';
import { Painter } from './painter.js';
import { barBitmapWidth, barLayout } from './menu-bar.js';
import { paintFrame, type FrameEnvironment } from './frame.js';
import { type MenuData } from './menu-data.js';
import { type Desk } from './desk.js';
import { layoutText, type TextOps } from './DrawText.js';
import { paintPopup, popupLayout, type MenuEnvironment } from './menus.js';
import {
  DCX_CLIPSIBLINGS,
  DCX_USESTYLE,
  DCX_WINDOW,
  regionFlags,
  windowRegion,
} from './visible-region-rule.js';
import {
  invalidateThrough,
  RDW_ALLCHILDREN,
  RDW_ERASE,
  RDW_FRAME,
  RDW_INVALIDATE,
  RDW_NOCHILDREN,
  madeFor31,
} from './invalidate-through.js';
import { windowDestroyed, windowsChanged } from './dc-entries.js';
import { anyKept, harvestAll } from './lock-window-update.js';
import { discardSaved, discardWithin, hasSaved, restoreUnder, saveUnder } from './save-bits.js';

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
const WS_EX_TOPMOST = 0x00000008;
const WS_DISABLED = 0x08000000;
const WS_POPUP = 0x80000000;
const WS_CHILD = 0x40000000;
const HTERROR = -2;
const HTCLIENT = 1;
const HTCAPTION = 2;
const CS_VREDRAW = 0x0001;
const CS_HREDRAW = 0x0002;

/** The windows `SetWindowPos` puts a window after that are not windows. */
/** A system with no classes and no lock, for a desktop with none given (`Desktop.system`). */
const ALONE = { handles: { resolve: () => null, retrieve: () => null }, _windowLock: null };

export const HWND_TOP = 0;
export const HWND_BOTTOM = 1;
export const HWND_TOPMOST = 0xffff;
export const HWND_NOTOPMOST = 0xfffe;

/** Where a window goes in the order of windows (`Desktop.insertFor`). */
export type Insert =
  | { to: 'stay' | 'top' | 'bottom' | 'topmost' | 'notTopmost' }
  | { to: 'after'; other: DesktopWindow };

const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOZORDER = 0x0004;
const SWP_SHOWWINDOW = 0x0040;
const SWP_HIDEWINDOW = 0x0080;

/** A window of a list `SetWindowPos` places (`Desktop.beginPlacing`), one of USER's entries. */
interface Placing {
  window: DesktopWindow;
  /** Its visible region before anything of the list was placed (`USER.EXE` seg7 `09a0`). */
  old: ClipRegion;
  wasVisible: boolean;
  /** Where it was, and whether it showed (`Desktop.#placingKey`). */
  wasAt: string;
  /** Where its bits go, on the screen (the entry's +16h); null for its whole window. */
  dest: number[] | null;
  /** How far its bits come. */
  dx: number;
  dy: number;
  /** Due all of itself already, by its caller. */
  whole: boolean;
  /** Drawn by its caller already (`placingSkip`). */
  skip: boolean;
  /** What it was asked (`placingFlags`), null for moved or sized. */
  flags: number | null;
  /** More of the screen made due with it: an icon's title where it was and is. */
  extra: ClipRegion | null;
}

/** The windows of a list being placed, and the screen as it was before (`Desktop.beginPlacing`). */
interface PlacingList {
  entries: Placing[];
  screen: Uint8Array;
  depth: number;
}

/** Where two rectangles meet; empty where they do not. */
function cut(a: number[], b: number[]) {
  return [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
}

/** Two regions' union. */
function unite(a: ClipRegion, b: ClipRegion) {
  return ClipRegion.combine(a, b, (x, y) => x || y);
}

const COLOR_ACTIVECAPTION = 2;
const COLOR_WINDOWTEXT = 8;
const COLOR_CAPTIONTEXT = 9;
const COLOR_APPWORKSPACE = 12;

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
 * An icon's title, as USER lays it out and draws it (`USER.EXE` seg1 `6b43`,
 * `6c14`, `6984`): as much of the window's text as `GetWindowText` gives in
 * 80 bytes; measured with `DrawText`'s `DT_CALCRECT` and these flags --
 * `DT_SINGLELINE` too where `IconTitleWrap` is off (`[1B2h]`) -- and drawn
 * with them.
 */
const ICON_TITLE_LENGTH = 79;
const ICON_TITLE_FORMAT = 0x0811; /* DT_NOPREFIX | DT_WORDBREAK | DT_CENTER */
const DT_SINGLELINE = 0x0020;
const DT_CALCRECT = 0x0400;

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
  titleMetrics?: { height: number; ascent: number; overhang?: number; average?: number };

  /** Whether icon titles are broken into lines: `IconTitleWrap`, `SPI_SETICONTITLEWRAP`. */
  titleWrap?(): boolean;

  /** The desktop's pattern and wallpaper, once the settings are read (`desk.ts`). */
  desk?(): Desk | undefined;
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

  /**
   * The client area its window procedure made of `WM_NCCALCSIZE`, relative
   * to the window, where that is not what `DefWindowProc` makes: kept while
   * the window keeps the size and style it was made for, and moved with
   * the window (`USER.EXE` seg7 `0f89`-`0fb9`; `nccalc`).
   */
  clientAnswer: {
    client: { left: number; top: number; right: number; bottom: number };
    width: number;
    height: number;
    style: number;
  } | null = null;

  /** What `GetDC` and `BeginPaint` draw through: the client area on the screen. */
  readonly surface: any;

  /** Whether the client area is to be erased and painted, and whether it has asked. */
  needsErase = false;
  needsPaint = false;

  /**
   * Due a paint of its own, with nothing to paint: `RedrawWindow`'s
   * `RDW_INTERNALPAINT`, USER's flag 1000h of the word at 24h (`USER.EXE`
   * seg1 `422b`). Taken off as its `WM_PAINT` is taken (`7864`, `446f`), by
   * `BeginPaint` (`7643`) and by `RDW_NOINTERNALPAINT` (`4323`).
   */
  internalPaint = false;

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

  /** USER's switch window, which Alt and Tab show their choice in; see `openSwitch`. */
  switchBox = false;

  /** The screen under a pop-up menu, as it was when the menu opened; see `openPopup`. */
  savedBits: Uint8Array | null = null;

  /** The window's own system menu, once a program or a menu asked for it. */
  systemMenu: MenuData | null = null;
  /** The menu `SetSystemMenu` gave, whose first item's pop-up is the system menu. */
  systemMenuBar: number | undefined = undefined;

  /** Whether the window is as it was made, maximized, or minimized to an icon. */
  state: 'normal' | 'maximized' | 'minimized' = 'normal';

  /** Where a maximized or minimized window goes back to. */
  restoreRect: { left: number; top: number; width: number; height: number } | null = null;

  /** Where its icon was put by a move while it was one: its icon's place from then on. */
  iconPlace: { left: number; top: number } | null = null;

  /**
   * Where its icon was when it last stopped being one, or was set to go,
   * on the screen: `GetInternalWindowPos`'s point (`placement.ts`).
   */
  iconWas: { left: number; top: number } | null = null;
  /** Where it was last maximized, on the screen: `GetWindowPlacement`'s
   * maximized point (`wplace`). */
  maxWas: { left: number; top: number } | null = null;

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
    (this.surface as any).screenOrigin = () => {
      const origin = (this.surface as any).dcOrigin;

      return origin
        ? { x: origin[0], y: origin[1] }
        : { x: this.left + this.client.left, y: this.top + this.client.top };
    };
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
  pendingActivation: { from: DesktopWindow | null; click: boolean; forFocus?: boolean } | null =
    null;

  /**
   * The window that was active before the active one: the second asked, as
   * the active window is hidden or destroyed, for a window to make active
   * in its place (`USER.EXE` seg1 `359e`, `395c`).
   */
  previousActive: DesktopWindow | null = null;
  /**
   * The task whose window was made active last, as USER keeps it apart from
   * the active window (`USER.EXE` seg1 `36b3`-`36ff`, `[0ECh]` of its
   * data): `WM_ACTIVATEAPP` goes out when the task made active is not this
   * one. A dialog with no owner ended leaves no window active and this task
   * noted; the active window destroyed with none to follow it notes none
   * (seg8 `0bc7`).
   */
  activeTask: number | null = null;

  /** The owned window last active of a window at the top's, or null (`GetLastActivePopup`). */
  lastActivePopupOf: ((window: DesktopWindow) => DesktopWindow | null) | null = null;

  /** The window whose menu is open, while one is. */
  menuOwner: DesktopWindow | null = null;

  /** Set by `WM_CANCELMODE` to the menu's window: the open menu ends. */
  menuCancelled = false;

  /** Which window each pixel of the screen shows, by id; 0 for the desktop. */
  readonly owners: Uint16Array;

  /**
   * The system whose windows these are, for USER's rule for a window's
   * visible region (`visible-region-rule.ts`): its classes and its lock.
   * Without one, as a desktop alone in a test, no class has a style.
   */
  system: any = null;

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
    environment.patternOrigin = colours.brushOrigin;

    return environment;
  }

  #frameEnvironment(bitmap: DeviceBitmap | null): FrameEnvironment & MenuEnvironment {
    const text = this.#text;
    const font = this.environment.font;

    return {
      ...this.environment,
      measure: (line) => barBitmapWidth(line, this.environment) ?? text.measureText(line).width,
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
      label: (line, colour, x, y, grayed = false, fromText = false) => {
        if (bitmap) {
          drawLabel(text, font, bitmap, line, colour, x, y, grayed, fromText);
        }
      },
    };
  }

  /**
   * Opens a pop-up menu with its top left at `x, y` on the screen, on top of
   * every window: its own window, a pixel larger each way for its shadow,
   * which never becomes active.
   */
  openPopup(
    menu: MenuData,
    x: number,
    y: number,
    selected = -1,
    reuse: DesktopWindow | null = null,
    owner: DesktopWindow | null = null
  ) {
    const layout = popupLayout(menu, this.#frameEnvironment(null));
    const window =
      reuse ??
      new DesktopWindow(
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

    /* USER's own `#32768`, put where the menu is, topmost and in front of
     * every window, owned by the menu's window (`USER.EXE` seg10 `09b7`-
     * `09eb`, `0d5d`). */
    if (reuse) {
      this.windows.splice(this.windows.indexOf(reuse), 1);
      this.#relocate(reuse, x, y, layout.width + 1, layout.height + 1);
    }

    this.#setTopmost(window, true);
    window.owner = owner;
    window.popup = { menu, selected };
    window.savedBits = this.#saveBits(window);
    window.visible = true;
    this.windows.unshift(window);
    this.#own();
    this.paintPopup(window);

    return window;
  }

  /** The size of a pop-up menu's window: a pixel larger each way than the menu, for its shadow. */
  popupSize(menu: MenuData) {
    const layout = popupLayout(menu, this.#frameEnvironment(null));

    return { width: layout.width + 1, height: layout.height + 1 };
  }

  /**
   * USER's own `#32768` hidden as the menu it showed ends, what it covered
   * put back, its owner gone; it stays where it is among the windows, in
   * front of them all (`USER.EXE` seg10 `0dd9`-`0e15`).
   */
  hidePopup(window: DesktopWindow) {
    this.#takeAway(window, false, false);
    window.popup = null;
    window.owner = null;
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
   * USER's switch window, which Alt and Tab show their choice in: a pop-up of
   * class `8003h`, made disabled (`USER.EXE` seg3 `1a3a`-`1a74`), its class
   * `CS_SAVEBITS` and its procedure erasing nothing (seg1 `62d6`). Put up
   * over every window, keeping the screen under it, which it puts back as it
   * goes, as a pop-up menu does. See `switch-loop.ts`.
   */
  openSwitch(left: number, top: number, width: number, height: number) {
    const window = new DesktopWindow(
      this.#next++,
      left,
      top,
      Math.max(width, 0),
      Math.max(height, 0),
      0x88000000,
      '',
      undefined,
      null
    );

    window.switchBox = true;
    window.topmost = true;
    window.savedBits = this.#saveBits(window);
    window.visible = true;
    this.windows.unshift(window);
    this.#own();

    return window;
  }

  /** A painter over a bitmap, in the desktop's colours. */
  painterOn(bitmap: DeviceBitmap, width: number, height: number) {
    return new Painter(bitmap, 0, 0, width, height, this.environment);
  }

  /** How wide a line is in the System font. */
  systemTextWidth(line: string) {
    this.#text.font = this.environment.systemFont;

    return this.#text.measureText(line).width;
  }

  /**
   * A line in the System font on the screen, in a box at `left, top`: its
   * cell's top left at `x, y` of the box, clipped to a rectangle of it, as
   * `ExtTextOut` with `ETO_CLIPPED` draws.
   */
  systemTextOn(
    left: number,
    top: number,
    clip: { left: number; top: number; right: number; bottom: number },
    x: number,
    y: number,
    line: string,
    colorref: number
  ) {
    const inside = this.#onScreen(
      left + clip.left,
      top + clip.top,
      clip.right - clip.left,
      clip.bottom - clip.top
    );

    this.#text.font = this.environment.systemFont;
    this.#text.bitmap = inside;
    this.#text.textColor = colourOf(colorref);
    this.#text.fillText(x - clip.left, y - clip.top, line);
  }

  /**
   * Where other windows cover a window, as USER works it out for its switch
   * window: the window's rectangle, on the screen, less where it shows -- it
   * or what lies in it (`USER.EXE` seg23 `0187`-`01e1`). Each pixel of it.
   */
  coveredPoints(window: DesktopWindow): [number, number][] {
    const points: [number, number][] = [];

    this.#eachCovered(window, (sx, sy) => points.push([sx, sy]));

    return points;
  }

  /**
   * Pixels a window's others covered filled with its class's brush, as
   * `FillWindow` fills USER's switch window through that region, the brush
   * aligned with the switch window (seg23 `024a`-`027a`). Nothing for a
   * class with none.
   */
  fillCovered(
    points: [number, number][],
    over: DesktopWindow,
    background: { colorref: number; pattern?: Uint8Array; hollow?: boolean } | null
  ) {
    if (!background || background.hollow) {
      return;
    }

    for (const [x, y] of points) {
      this.#fill(
        DeviceBitmap.view(this.screen, x, y, 1, 1),
        0,
        0,
        1,
        1,
        background.colorref ?? 0,
        x - over.left,
        y - over.top,
        background.pattern
      );
    }
  }

  /** Each pixel of a window's rectangle on the screen that something else shows at. */
  #eachCovered(window: DesktopWindow, each: (sx: number, sy: number) => void) {
    const stride = this.screen.width;
    const x0 = Math.max(window.left, 0);
    const y0 = Math.max(window.top, 0);
    const x1 = Math.min(window.left + window.width, stride);
    const y1 = Math.min(window.top + window.height, this.screen.height);

    for (let sy = y0; sy < y1; sy++) {
      for (let sx = x0; sx < x1; sx++) {
        const owner = this.#byId.get(this.owners[sy * stride + sx]);

        if (!owner || !this.#within(owner, window)) {
          each(sx, sy);
        }
      }
    }
  }

  /** An icon's title drawn, lit or not, where it shows or over everything (`switch-loop.ts`). */
  paintIconTitle(title: DesktopWindow, lit: boolean, clipped: boolean) {
    this.#paintIconTitle(title, lit, clipped);
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
    /* An icon's, a pixel in from its corner (`titledbl`). */
    if (window.state === 'minimized') {
      return { x: window.left + 1, y: window.top + 1 };
    }

    const rows = window.menu
      ? barLayout(
          window.menu,
          this.#frameEnvironment(null).measure,
          window.client.left,
          window.width - window.client.left
        ).rows
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

  /**
   * The window made active last: a window at the top, shown or hidden, or a
   * document window shown in it. USER's active window is a word of its own,
   * which nothing in its activation asks the window's showing of (`USER.EXE`
   * seg1 `3514`; `GetActiveWindow`, `818d`, answers it as it is): a window
   * hidden is made active by `SetFocus` (`hidfocus`), and stays active when
   * it is hidden and nothing else can be.
   */
  get active() {
    return (
      this.windows.find((window) => window.active && (window.visible || !window.parent)) ?? null
    );
  }

  /** The active top-level window: a document window inside one does not count. */
  get activeTop() {
    return this.windows.find((w) => w.active && !w.parent && !w.titleOf) ?? null;
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
        this.#dueWhole(member);
      }
    }
  }

  /**
   * A window, its frame, children and all, due everything: whatever part of
   * it was due before is forgotten, all of it is due now. A box left from
   * before would hold the paint to it -- a window moved with one painted
   * only where it had been (`swpbits`).
   */
  #dueWhole(window: DesktopWindow) {
    const shown: any = window;

    this.paintFrame(window);
    shown.dirtyRect = undefined;
    shown.dirtyShape = undefined;
    shown.dirtyShapeFor = undefined;
    shown.quietDirty = undefined;
    window.needsErase = true;
    window.needsPaint = true;
  }

  /**
   * Shows a window, on top, and makes it the active one: its frame painted,
   * and its client area left to be erased and painted when it is asked.
   * Without `whole`, only what it came to show of itself where it was
   * covered is due, as a window already shown is made active by
   * `SetWindowPos` (`swporder`: brought up from beneath one window, it is
   * sent `WM_PAINT` for that window's place, and already at the top,
   * nothing).
   */
  show(window: DesktopWindow, whole = true, allShown?: boolean) {
    /* A child as `SetWindowPos` shows it (`placeShown`): its own children
     * show with it -- a document window made in an MDI client not yet shown
     * was drawn nowhere, and is drawn now. */
    if (window.parent) {
      this.placeShown(
        window,
        () => {
          window.visible = true;
        },
        allShown
      );
      return;
    }

    /* Drawn as `SetWindowPos` draws its list: the window, and the windows
     * brought up with it (`#bringUp`), each where it shows now and did not
     * (`endPlacing`). */
    this.beginPlacing([window]);
    this.placingFlags(
      window,
      window.visible ? SWP_NOMOVE | SWP_NOSIZE : SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW
    );

    if (window.iconTitle && !window.iconTitle.visible) {
      this.#entryOf(window.iconTitle);
      this.#placedWhole(window.iconTitle);
    }

    const was = this.active;
    const wasTop = this.activeTop;
    const family = this.#bringUp(window);

    window.visible = true;
    window.active = true;
    this.onActivate?.(window);

    if (was && was !== window) {
      was.active = false;
    }

    /* Its messages are to be sent; the focus moves with them, as the window
     * procedures move it. */
    if (wasTop !== window) {
      this.previousActive = wasTop;
      this.pendingActivation ??= { from: wasTop, click: false };
    }

    this.#own();

    if (was && was !== window) {
      this.paintFrame(was);
    }

    this.paintFrame(window);

    if (!whole) {
      if (window.iconTitle && !window.iconTitle.visible) {
        window.iconTitle.visible = true;
        this.#own();
        this.paintFrame(window.iconTitle);
      }

      this.endPlacing(allShown);
      return;
    }

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
    this.#placedWhole(window);
    this.endPlacing(allShown);
  }

  /**
   * A window at the top made the active one, hidden as it is: `SetFocus` on
   * a window inside it, or `SetActiveWindow`, makes it so, and nothing in
   * the activation asks whether it shows (`USER.EXE` seg1 `3899`, `38c5`,
   * `3514`; `hidfocus`). It is brought to the top as a window that shows
   * is, no window that shows being above it (`3674`-`3697`), and the window
   * that was active is drawn inactive. A window that shows is shown.
   */
  /**
   * A window at the top that is the first that shows made active where it
   * lies: `ActivateWindow` brings nothing to the front then (`USER.EXE`
   * seg1 `3674`-`3697`). **Recorded** by `sysdlg`: a dialog made active
   * again over the dialog it ran ends, its owner's other windows are not
   * moved. `whole`: it is due whole, as a window shown.
   */
  activateInPlace(window: DesktopWindow, whole: boolean) {
    const was = this.active;
    const wasTop = this.activeTop;

    window.active = true;
    this.onActivate?.(window);

    if (was && was !== window) {
      was.active = false;
      this.paintFrame(was);
    }

    if (whole) {
      this.#dueWhole(window);
    } else {
      this.paintFrame(window);
    }

    if (wasTop !== window) {
      this.previousActive = wasTop;
      this.pendingActivation ??= { from: wasTop, click: false };
    }
  }

  activate(window: DesktopWindow, absolute = false) {
    if (window.visible || window.parent) {
      this.show(window);
      return;
    }

    const was = this.active;
    const wasTop = this.activeTop;

    /* `absolute`: made active by USER's `ActivateWindow`, hidden, it goes to
     * the very front, before the topmost windows too: `SetWindowPos` puts a
     * hidden window brought to the top after none. **Recorded** by
     * `sysdlg`: a dialog made active hidden is asked to go after none, and
     * once made topmost and shown, is the first window that shows, so that
     * made active again it is not brought up. */
    this.#bringUp(window, absolute);
    window.active = true;
    this.onActivate?.(window);

    if (was && was !== window) {
      was.active = false;
      this.paintFrame(was);
    }

    if (wasTop !== window) {
      this.previousActive = wasTop;
      this.pendingActivation ??= { from: wasTop, click: false };
    }
  }

  /**
   * A window at the top brought to the front of the windows, its children
   * with it, as they were; the windows it owns above it, in their order
   * (`owners`); and the window that owns it, with the rest that one owns,
   * beneath it (`showseq`). Answers what moved with it of its own.
   */
  #bringUp(window: DesktopWindow, absolute = false) {
    const family = this.windows.filter(
      (other) =>
        this.#within(other, window) ||
        this.#ownedWithin(other, window) ||
        other === window.iconTitle
    );

    /* The windows at the top it brings, and the family of the window that
     * owns it, are of the list being placed, as they were (`endPlacing`). */
    if (this.#list) {
      let head = window;

      while (head.owner && !head.owner.parent) {
        head = head.owner;
      }

      for (const other of this.windows) {
        if (
          !other.parent &&
          (family.includes(other) ||
            (head !== window &&
              (this.#ownedWithin(other, head) || other === head || other === head.iconTitle)))
        ) {
          this.#entryOf(other).flags ??= SWP_NOMOVE | SWP_NOSIZE;
        }
      }
    }

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
              (this.#within(other, head) ||
                this.#ownedWithin(other, head) ||
                other === head.iconTitle)
          );

    const at = new Map<DesktopWindow, number>();

    for (const member of owners) {
      at.set(member, this.windows.indexOf(member));
    }

    for (const member of owners) {
      this.windows.splice(this.windows.indexOf(member), 1);
    }

    const beneath = [
      ...owners.filter((member) => !this.#within(member, head)),
      ...owners.filter((member) => this.#within(member, head)),
    ];

    /* `absolute`: the window, with what it owns, goes to the very front;
     * its owner's family stays where it lay (`sysdlg`: the owner of a
     * system-modal dialog made active, asked to go after it, is not moved,
     * nor a system-modal dialog under the one run over it, which is moved
     * and told as its owner is made active after). */
    if (absolute) {
      for (const member of owners) {
        this.windows.splice(at.get(member) ?? this.windows.length, 0, member);
      }

      this.windows.splice(0, 0, ...ownedFirst);
    } else {
      this.windows.splice(this.front(window), 0, ...ownedFirst, ...beneath);
    }

    return family;
  }

  /**
   * Takes a window off the screen: what it covered is painted again, the
   * desktop by USER and each window's frame, and each uncovered client area
   * left to be erased and painted.
   */
  destroy(window: DesktopWindow) {
    if (window.titleOf) {
      this.onTitleGone?.(window);

      /* A title destroyed on its own -- its task ended, or a program destroyed
       * it -- is its icon's no more. */
      if (window.titleOf.iconTitle === window) {
        window.titleOf.iconTitle = null;
      }
    }

    /* A minimized window's title goes with it. */
    if (window.iconTitle) {
      this.destroy(window.iconTitle);
      window.iconTitle = null;
    }

    if (this.menuOwner === window) {
      this.menuOwner = null;
    }

    /* A window gone that has the focus: nothing has it. USER takes the focus
     * off each window `DestroyWindow` destroys, to its parent or, for a
     * window at the top, to none (`USER.EXE` seg8 `09e1`, `0a17`, calling
     * seg2 `090a`-`0928`); a pop-up menu's window is destroyed so too. One
     * left on a window going is let go, so that it never names a window that
     * is gone. */
    if (this.focus === window) {
      this.focus = null;
    }

    /* Nor the window active before it (seg8 `0cc8`). */
    if (this.previousActive === window) {
      this.previousActive = null;
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
  #takeAway(window: DesktopWindow, remove: boolean, activateNext = true) {
    /* The active window hidden by `ShowWindow`, or destroyed, shown or not,
     * gives the activation to another, where one can take it (see
     * `#nextActive`). With none, a window destroyed leaves none active, and
     * one hidden stays active, hidden (`USER.EXE` seg8 `0bb7`-`0bc0`, seg14
     * `0dc2`). `SetWindowPos` hiding it makes no other active. */
    const destroying = remove || !!(window as any).destroying;
    /* Hidden, it is drawn as `SetWindowPos` hides it (`endPlacing`): what
     * showed of it made due through its parent, the windows in it too, or
     * the bits it saved put back. USER's own pop-up menus and switch window
     * keep theirs by WinBox's own rule (`#restoreBits`). */
    const listed = window.visible && !window.savedBits;

    if (listed) {
      this.beginPlacing([window]);
      this.placingFlags(window, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_HIDEWINDOW);
    }

    const wasActive = window.active && !window.parent && !window.titleOf;
    const next = wasActive && activateNext ? this.#nextActive(window, destroying) : null;

    /* A focus inside a window destroyed goes, unless another window is
     * activated, whose messages move it (see `activation.ts`). One inside a
     * window hidden stays there: `SetWindowPos` moves no focus, and
     * `ShowWindow` moves it only off the window itself (`USER.EXE` seg2
     * `090a`; `showRaster`). **Recorded** by `enddlg`: a dialog hidden by
     * `EndDialog` keeps the focus `EndDialog` gave it, and its owner made
     * active takes it from the dialog. */
    if (this.focus && this.#within(this.focus, window) && !next && remove) {
      this.focus = null;
    }

    /* Its children go first, with nothing to paint again: it covers them.
     * Then it: found again, as they may have been above it. USER's device
     * context entries of each are let go (`dc-entries.ts`). */
    if (remove) {
      if (this.system) {
        for (const gone of this.windows.filter((other) => this.#within(other, window))) {
          windowDestroyed(this.system, gone.hwnd);
        }
      }

      for (const child of this.windows.filter((other) => other.parent === window)) {
        this.windows.splice(this.windows.indexOf(child), 1);
        child.visible = false;
      }

      this.windows.splice(this.windows.indexOf(window), 1);
    }

    if (window.visible) {
      window.visible = false;

      /* A document window's caption is drawn inactive. */
      if (!wasActive) {
        window.active = false;
      }

      const before = this.owners.slice();

      this.#own();

      if (!listed && !this.#restoreBits(window)) {
        this.#exposeOwned(window, before);
      }
    }

    if (listed) {
      this.endPlacing(false);
    }

    if (remove && this.system) {
      discardWithin(this.system, this, window);
    }

    if (next) {
      window.active = false;
      next.active = true;
      this.onActivate?.(next);
      this.previousActive = remove ? null : window;
      this.pendingActivation ??= { from: window, click: false };
      this.paintFrame(next);
    } else if (destroying) {
      window.active = false;

      if (wasActive) {
        this.activeTask = null;
      }
    }
  }

  /**
   * A window at the top brought up with the family it heads, not made
   * active: the windows it owns above it, its owner beneath (`#bringUp`).
   * Whether the order changed.
   */
  bringFamilyUp(window: DesktopWindow) {
    const order = this.windows.slice();

    /* Drawn as `SetWindowPos` draws its list (`endPlacing`). */
    this.beginPlacing([]);
    this.#bringUp(window);
    this.#own();
    this.endPlacing(false);

    return this.windows.some((other, at) => other !== order[at]);
  }

  /** The window a window at the top destroyed makes active (seg8 `0b95`-`0bb7`). */
  nextActiveOf(window: DesktopWindow) {
    return this.#nextActive(window, true);
  }

  /**
   * No window active and none with the focus, told nothing: the active
   * window destroyed with none to take it (seg8 `0bc0`-`0bcb`), or a dialog
   * with no owner ended (seg25 `262c`). The task that was active is still
   * noted where a dialog ended (`activeTask`), not where a window went.
   */
  leaveNoneActive(window: DesktopWindow, keepTask = false) {
    window.active = false;
    this.focus = null;

    if (!keepTask) {
      this.activeTask = null;
    }
  }

  /**
   * The window USER makes active as the active window is hidden by
   * `ShowWindow` or destroyed, or null (`USER.EXE` seg1 `38e4`, called with
   * 2 and its owner for a pop-up destroyed that has one, seg8 `0b95`, and
   * with 3 and the window otherwise, and by `ShowWindow`). A window can take
   * it that is still one, shows, is enabled, and is not an icon's title
   * (`34dc`). Asked in turn:
   *
   * * a destroyed pop-up's owner (`392b`);
   * * a pop-up's owner (`3934`);
   * * the window active before this one (`395c`);
   * * the next window that can take it after this one, in the order of the
   *   windows at the top with each followed by those it owns, round to the
   *   first (seg13 `0f2b`, `0edd`, `0eb2`) -- or its owned window last
   *   active, where that can (`3984`-`3994`). Bago's dictionary pop-up gives
   *   it back to the window that owns it, not to its egg timer (`actnext`).
   */
  #nextActive(window: DesktopWindow, destroying: boolean): DesktopWindow | null {
    const can = (other: DesktopWindow | null | undefined): other is DesktopWindow =>
      !!other &&
      other !== window &&
      this.windows.includes(other) &&
      other.visible &&
      !(other.style & WS_DISABLED) &&
      !other.titleOf &&
      !this.#within(other, window) &&
      !(destroying && this.#ownedWithin(other, window));
    const popup = (other: DesktopWindow) => (other.style & WS_POPUP) !== 0;

    let from = window;

    if (destroying && popup(window) && window.owner) {
      if (can(window.owner)) {
        return window.owner;
      }

      from = window.owner;
    }

    if (popup(from) && can(from.owner)) {
      return from.owner;
    }

    if (can(this.previousActive)) {
      return this.previousActive;
    }

    /* The windows at the top, as USER walks them: those `owner` owns after
     * `after`, or from the first. */
    const tops = this.windows.filter((other) => !other.parent);
    const ownedBy = (owner: DesktopWindow | null, after: DesktopWindow | null) =>
      tops
        .slice(after ? tops.indexOf(after) + 1 : 0)
        .find((other) => (other.owner ?? null) === owner) ?? null;
    const following = (at: DesktopWindow) => {
      let owner: DesktopWindow | null = at;
      let after: DesktopWindow | null = null;

      for (;;) {
        const found = ownedBy(owner, after);

        if (found || !owner) {
          return found ?? ownedBy(null, null);
        }

        after = owner;
        owner = owner.owner;
      }
    };

    let at = following(from);

    for (let steps = 0; at && at !== from && steps <= tops.length; steps++) {
      if (at !== window && can(at)) {
        const last = this.lastActivePopupOf?.(at);

        return can(last) ? last : at;
      }

      at = following(at);
    }

    return null;
  }

  /**
   * The window USER makes active as a window at the top is minimized with
   * `SW_MINIMIZE`, or none (`USER.EXE` seg6 `1d96`-`1e11`): the window active
   * before, if it shows, is enabled and is no icon; else the first that is
   * from the window after the last of those kept on top (seg7 `02c9`), or
   * after the first window, to the back -- else, as a window hidden, the next
   * that can take it (`#nextActive`, which seg1 `38e4` is asked with 3 for).
   * An icon's title is passed over, as `#nextActive` passes it (`34dc`).
   * Recorded by `minact`.
   */
  nextAfterMinimize(window: DesktopWindow): DesktopWindow | null {
    const suits = (other: DesktopWindow | null | undefined): other is DesktopWindow =>
      !!other &&
      !other.parent &&
      this.windows.includes(other) &&
      other.visible &&
      !(other.style & WS_DISABLED) &&
      other.state !== 'minimized' &&
      !other.titleOf;
    const tops = this.windows.filter((other) => !other.parent);
    let keptOnTop = 0;

    while (keptOnTop < tops.length && tops[keptOnTop].topmost) {
      keptOnTop++;
    }

    const from = Math.max(keptOnTop - 1, 0);
    let start = from;

    if (this.previousActive) {
      if (suits(this.previousActive)) {
        return this.previousActive;
      }

      start = from + 1;
    }

    return tops.slice(start).find(suits) ?? this.#nextActive(window, false);
  }

  /**
   * Moves or sizes a window. Its client area is worked out again, and if it
   * shows, what it covered and what it now covers are painted again.
   */
  place(window: DesktopWindow, left: number, top: number, width: number, height: number) {
    /* Of a list being placed -- a window minimized, maximized or restored,
     * as `MinMaximize` places it with one `SetWindowPos` (`USER.EXE` seg6
     * `1d56`-`1d81`) -- it is moved now and drawn as the list is drawn
     * (`endPlacing`): its old region and its new, nothing of its bits
     * copied, as `SWP_NOCOPYBITS` has it for an icon made or restored
     * (`1c59`, `1cd9`). */
    if (this.#list) {
      const entry = this.#entryOf(window);

      this.#relocate(window, left, top, width, height);
      entry.dest = [0, 0, 0, 0];
      return;
    }

    const { was, family } = this.#relocate(window, left, top, width, height);

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

    this.#dueWhole(window);

    for (const child of family) {
      if (this.#showing(child)) {
        this.#dueWhole(child);
      }
    }
  }

  /**
   * The client area a window would have at a size, as its style and menu
   * leave it, from its corner: what `DefWindowProc` answers `WM_NCCALCSIZE`
   * with (`swpframe`).
   */
  /** A window's client area worked out again as its frame is now, nothing drawn. */
  layOut(window: DesktopWindow) {
    this.#layout(window);
  }

  clientIn(window: DesktopWindow, width: number, height: number) {
    return this.#clientOf(window, width, height);
  }

  /**
   * The client area a window's procedure answered `WM_NCCALCSIZE` with, for
   * the size it is to have, relative to its corner: kept where it is not
   * what `DefWindowProc` makes, for the next time the window is laid out
   * (`nccalc`).
   */
  answerClient(
    window: DesktopWindow,
    width: number,
    height: number,
    client: { left: number; top: number; right: number; bottom: number }
  ) {
    const made = this.#clientOf(window, width, height);
    const same =
      made.left === client.left &&
      made.top === client.top &&
      made.right === client.right &&
      made.bottom === client.bottom;

    window.clientAnswer =
      same || window.state === 'minimized' || window.titleOf
        ? null
        : { client: { ...client }, width, height, style: window.style };
  }

  /** A window's client area at a size, from its frame: an icon, or an icon's title, is all client area. */
  #clientOf(window: DesktopWindow, width: number, height: number) {
    const nowhere = new DeviceBitmap(0, 0, this.screen.depth, undefined, this.screen.devicePalette);

    return window.state === 'minimized' || window.titleOf
      ? { left: 0, top: 0, right: width, bottom: height }
      : paintFrame(
          nowhere,
          0,
          0,
          width,
          height,
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
  }

  /**
   * A window's frame changed where it is: `SWP_FRAMECHANGED` with no move or
   * size (`USER.EXE` seg7 `0e8f`-`0fe6`). Its client area is laid out again
   * for its style; what of the old client area's bits fits is kept at the new
   * one's top left, as `WM_NCCALCSIZE` answered with nought keeps it
   * (`0f67`-`0f84`), and the rest is due an erase and a paint. Its whole
   * frame is due, `WM_NCPAINT` given a region of it, and its erase is due
   * though nothing of it may be (`swpframe`): the box of what is not kept,
   * which the erase's clip and the paint are, a rectangle where only one side
   * grew.
   */
  frameChanged(window: DesktopWindow) {
    const { left, top, width, height } = window;
    const was = window.client;
    const old = [left + was.left, top + was.top, left + was.right, top + was.bottom];
    const across = Math.max(old[2] - old[0], 0);
    const bits: number[] = [];

    for (let y = old[1]; y < old[3]; y++) {
      for (let x = old[0]; x < old[2]; x++) {
        bits.push(this.screen.indexAt(x, y) ?? 0);
      }
    }

    this.#relocate(window, left, top, width, height);

    if (!this.#showing(window)) {
      return;
    }

    this.#own();

    const now = window.client;
    const fresh = [left + now.left, top + now.top, left + now.right, top + now.bottom];
    const kept = [
      fresh[0],
      fresh[1],
      Math.min(fresh[2], fresh[0] + old[2] - old[0]),
      Math.min(fresh[3], fresh[1] + old[3] - old[1]),
    ];
    const view = this.#view(window, 0, 0, width, height, false);

    for (let y = kept[1]; y < kept[3]; y++) {
      for (let x = kept[0]; x < kept[2]; x++) {
        view.put(x - left, y - top, bits[(y - fresh[1]) * across + (x - fresh[0])] ?? 0);
      }
    }

    view.context.markRect(0, 0, width, height);

    const lost =
      kept[2] >= fresh[2] && kept[3] >= fresh[3]
        ? null
        : kept[2] >= fresh[2]
          ? [fresh[0], kept[3], fresh[2], fresh[3]]
          : kept[3] >= fresh[3]
            ? [kept[2], fresh[1], fresh[2], fresh[3]]
            : fresh;
    const shown: any = window;

    shown.needsNcPaint = true;
    shown.frameRegion = true;
    window.needsErase = true;

    if (lost) {
      const before = shown.dirtyRect;

      shown.dirtyRect = !window.needsPaint
        ? lost
        : before
          ? [
              Math.min(before[0], lost[0]),
              Math.min(before[1], lost[1]),
              Math.max(before[2], lost[2]),
              Math.max(before[3], lost[3]),
            ]
          : undefined;
      window.needsPaint = true;
    } else if (!window.needsPaint) {
      shown.dirtyRect = [fresh[0], fresh[1], fresh[0], fresh[1]];
    }
  }

  /**
   * A window put at a new place and size, nothing drawn: its client area
   * worked out again, its children moved as far as its client area did, and
   * an icon's title with it. Where it was, and its children.
   */
  #relocate(window: DesktopWindow, left: number, top: number, width: number, height: number) {
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

    return { was, family };
  }

  /**
   * What `SetWindowPos` reports in `WM_WINDOWPOSCHANGING` as the window a
   * window goes after, and where it goes; null for a request that does
   * nothing at all. `activated` is whether it is made active. See
   * `moveWithBits` for what is recorded.
   */
  insertFor(window: DesktopWindow, after: number, activated: boolean): [number, Insert] | null {
    const child = !!window.parent;

    if (activated && !child && after !== HWND_TOPMOST) {
      after = HWND_TOP;
    }

    if (after === window.hwnd) {
      return null;
    }

    /* The last topmost window at the top but this one. */
    const lastTopmost = () =>
      this.windows.filter((other) => other !== window && !other.parent && other.topmost).at(-1)
        ?.hwnd ?? 0;

    if (after === HWND_TOP) {
      return [child || window.topmost ? HWND_TOP : lastTopmost(), { to: 'top' }];
    }

    if (after === HWND_BOTTOM) {
      return [HWND_BOTTOM, { to: 'bottom' }];
    }

    if (after === HWND_TOPMOST || after === HWND_NOTOPMOST) {
      if (child) {
        return null;
      }

      if (after === HWND_TOPMOST) {
        return [HWND_TOP, { to: 'topmost' }];
      }

      if (window.topmost) {
        return [lastTopmost(), { to: 'notTopmost' }];
      }

      /* Left where it is, after the window in front of it. */
      const at = Math.max(this.windows.indexOf(window), 0);
      const before = this.windows
        .slice(0, at)
        .filter((other) => other.parent === window.parent)
        .at(-1);

      return [before?.hwnd ?? 0, { to: 'stay' }];
    }

    const other = this.windows.find((one) => one.hwnd === after && one.hwnd);

    if (other && other !== window && other.parent === window.parent) {
      return [after, { to: 'after', other }];
    }

    return [after, { to: 'stay' }];
  }

  /** A window made topmost or not, its extended style with it, as `GetWindowLong` reads it (`swporder`). */
  #setTopmost(window: DesktopWindow, topmost: boolean) {
    window.topmost = topmost;
    window.exStyle = topmost ? window.exStyle | WS_EX_TOPMOST : window.exStyle & ~WS_EX_TOPMOST;
  }

  /** A window and its children taken out of the order of windows, as they lay. */
  #takeOut(window: DesktopWindow) {
    const family = this.windows.filter((other) => this.#within(other, window));

    for (const member of family) {
      this.windows.splice(this.windows.indexOf(member), 1);
    }

    return family;
  }

  /**
   * A window put where `to` says among its brothers, its children with it;
   * whether its place in the order, or whether it is topmost, changed. What
   * it uncovers is due where it now shows.
   */
  reorder(window: DesktopWindow, to: Insert) {
    const parent = window.parent;
    const order = this.windows.slice();
    const topmost = window.topmost;

    if (to.to === 'stay') {
      return false;
    }

    /* Drawn as `SetWindowPos` draws its list (`endPlacing`): what it
     * uncovers due where it now shows -- children that draw over their
     * brothers, without `WS_CLIPSIBLINGS`, show as much as before, and
     * nothing is. */
    this.beginPlacing([window]);
    this.placingFlags(window, SWP_NOMOVE | SWP_NOSIZE);

    switch (to.to) {
      case 'top':
      case 'topmost':
      case 'notTopmost': {
        if (!parent && to.to !== 'top') {
          this.#setTopmost(window, to.to === 'topmost');
        }

        /* In front of its brothers: a child in front of its parent's other
         * children, and a window at the top in front of those of its kind,
         * the topmost first. */
        const family = this.#takeOut(window);
        let at = this.front(window);

        if (parent) {
          const first = this.windows.findIndex(
            (other) => other !== parent && this.#within(other, parent)
          );

          at = first < 0 ? this.windows.indexOf(parent) : first;
        }

        this.windows.splice(at, 0, ...family);
        break;
      }
      case 'bottom': {
        if (!parent) {
          this.#setTopmost(window, false);
        }

        const family = this.#takeOut(window);
        const at = parent ? this.windows.indexOf(parent) : -1;

        this.windows.splice(at < 0 ? this.windows.length : at, 0, ...family);
        break;
      }
      case 'after': {
        if (!parent) {
          this.#setTopmost(window, to.other.topmost);
        }

        const family = this.#takeOut(window);
        const at = this.windows.indexOf(to.other);

        this.windows.splice(at < 0 ? this.windows.length : at + 1, 0, ...family);
        break;
      }
    }

    /* A hidden window made topmost where it lies is not moved (`sysdlg`:
     * a system-modal dialog, at the front, hidden, is asked and not told). */
    const changed =
      (window.topmost !== topmost && this.#showing(window)) ||
      this.windows.length !== order.length ||
      this.windows.some((other, at) => other !== order[at]);

    this.endPlacing(false);

    return changed;
  }

  /**
   * A window moved or sized as `SetWindowPos` moves it: its bits, and its
   * children's, taken with it unless `copy` is false; what did not come with
   * it due, and what it uncovered due in the windows that show there now.
   * `classStyle` is its class's style. **Recorded** by `swpbits`:
   *
   * * Moved, its bits go with it: the screen shows it at its new place at
   *   once, and it is sent nothing to paint -- not `WM_NCPAINT`, not
   *   `WM_ERASEBKGND`, not `WM_PAINT`. So is a window with a caption, and a
   *   child in its parent. What could not come with it -- what another
   *   window covered of it -- is due, and erased at once.
   * * With `SWP_NOCOPYBITS`, what of its new place already showed it is
   *   left as it is, and it is due everywhere else -- the copy going
   *   through the rectangle the call before left in USER's entry (`stale`).
   * * Sized, its client area's bits go with the client area, and the rest
   *   of the window is due; made smaller, nothing is. With `CS_HREDRAW` and a
   *   new width, or `CS_VREDRAW` and a new height, all of it is due. Moved
   *   only, the two styles change nothing.
   * * `MoveWindow` with `bRepaint` FALSE does the same as with TRUE.
   * * What it uncovered is due in the windows that show there now, and no
   *   more of them: one above it is not. A window at the top that was
   *   uncovered is sent `WM_NCPAINT` and `WM_ERASEBKGND` at once; a parent a
   *   child was moved in, `WM_ERASEBKGND` only. A parent without
   *   `WS_CLIPCHILDREN` is due where the child is due as well.
   * * The erases come before `WM_WINDOWPOSCHANGED`.
   * * Sized, a window whose procedure answered `WM_NCCALCSIZE` with what
   *   to keep (`calcKept`) keeps what it said, `kept`, in its new client
   *   area: the bits `dx`, `dy` away put in `rect`, or none (`nccalc`).
   *
   * **Recorded** by `swporder`, where it goes in the order of windows
   * (`insertFor`, `reorder`):
   *
   * * `HWND_BOTTOM` puts it behind every other, a hidden one too, and a
   *   topmost window is topmost no more. A window given puts it right after
   *   that one, topmost if that one is.
   * * `HWND_TOPMOST` makes it topmost, in front of all; `HWND_NOTOPMOST`
   *   makes a topmost window not, in front of those that are not, and leaves
   *   any other where it is. A child is never topmost: given either, it is
   *   sent nothing.
   * * Made active -- without `SWP_NOACTIVATE` -- a window at the top comes to
   *   the top whatever it was asked: `HWND_TOP`, unless it was
   *   `HWND_TOPMOST`.
   * * `WM_WINDOWPOSCHANGING` carries the window it goes after as USER has
   *   worked it out: `HWND_TOP` for a window at the top that is not topmost
   *   is the last topmost window, USER's own `#32771`; `HWND_TOPMOST` is
   *   `HWND_TOP`; `HWND_NOTOPMOST` is the last topmost window, or for a
   *   window that is not topmost the one in front of it.
   * * Put after itself, it is sent nothing at all.
   * * `WM_WINDOWPOSCHANGED` follows only where its place in the order, or
   *   whether it is topmost, changed.
   * * What it uncovers of a window at the top is due there; among children
   *   without `WS_CLIPSIBLINGS`, which draw over one another, nothing is.
   */
  moveWithBits(
    window: DesktopWindow,
    left: number,
    top: number,
    width: number,
    height: number,
    copy: boolean,
    classStyle: number,
    kept: { rect: number[]; dx: number; dy: number } | 'none' | null = null,
    allShown?: boolean,
    nccalc = true,
    stale: number[] | null = null
  ): number[] {
    this.beginPlacing([window]);

    const entry = this.#entryOf(window);
    const [oldWidth, oldHeight] = [window.width, window.height];
    const clientOf = (one: DesktopWindow) => [
      one.left + one.client.left,
      one.top + one.client.top,
      one.left + one.client.right,
      one.top + one.client.bottom,
    ];
    const placeOf = (one: DesktopWindow) => [
      one.left,
      one.top,
      one.left + one.width,
      one.top + one.height,
    ];
    const oldClient = clientOf(window);
    const oldPlace = placeOf(window);

    /* The window and its children, whose update regions go with them
     * (seg7 `0b1a`-`0b41`, seg2 `0a1d`); one due all over stays so. */
    const members = [
      window,
      ...this.windows.filter((other) => other !== window && this.#within(other, window)),
    ];
    const was = members.map((member) => ({
      left: member.left,
      top: member.top,
      due:
        member.needsPaint && (member as any).dirtyRect
          ? { region: updateOf(member), erase: member.needsErase, walked: (member as any).walked }
          : null,
    }));
    const title = window.iconTitle;
    const titleWas = title ? placeOf(title) : null;

    this.#relocate(window, left, top, width, height);

    members.forEach((member, k) => {
      const due = was[k].due;

      if (due) {
        const [mx, my] = [member.left - was[k].left, member.top - was[k].top];
        const shown: any = member;

        setUpdate(member, due.region.offset(mx, my), due.erase);
        shown.walked = due.walked instanceof ClipRegion ? due.walked.offset(mx, my) : due.walked;
      }
    });

    const sized = width !== oldWidth || height !== oldHeight;
    const redraw = kept
      ? kept === 'none'
      : (!!(classStyle & CS_HREDRAW) && width !== oldWidth) ||
        (!!(classStyle & CS_VREDRAW) && height !== oldHeight);
    const newClient = clientOf(window);
    const keeps = kept && kept !== 'none' ? kept : null;

    /* Where the bits go and how far they come (seg7 `0e8f`-`1166`). Moved
     * only, with no `WM_NCCALCSIZE`: the whole window (`1028`-`104c`) --
     * or, with `SWP_NOCOPYBITS`, the rectangle left in the entry by the
     * call before that used it, `stale` (`1028`-`102c`). Otherwise its
     * client area as `WM_NCCALCSIZE` kept it, the whole window where the
     * client area moved with it unsized (`1010`); nowhere with
     * `SWP_NOCOPYBITS` or to be drawn again (`0fed`, `10a7`-`10e1`,
     * `1158`). */
    let dest: number[] = [0, 0, 0, 0];
    let [dx, dy] = [left - oldPlace[0], top - oldPlace[1]];

    if (!nccalc) {
      dest = copy ? placeOf(window) : (stale ?? dest);
    } else if (copy && !redraw) {
      if (keeps) {
        [dx, dy] = [keeps.dx, keeps.dy];
        dest = cut(keeps.rect, newClient);
      } else if (sized) {
        [dx, dy] = [newClient[0] - oldClient[0], newClient[1] - oldClient[1]];
        dest = cut(newClient, [
          oldClient[0] + dx,
          oldClient[1] + dy,
          oldClient[2] + dx,
          oldClient[3] + dy,
        ]);
      } else {
        dest = placeOf(window);
      }
    }

    entry.dest = dest;
    entry.dx = dx;
    entry.dy = dy;

    /* An icon's title, a window of its own, is made due where it was and
     * is. */
    if (title && titleWas) {
      const both = unite(
        ClipRegion.rect(titleWas[0], titleWas[1], titleWas[2], titleWas[3]),
        ClipRegion.rect(title.left, title.top, title.left + title.width, title.top + title.height)
      );

      entry.extra = entry.extra ? unite(entry.extra, both) : both;
    }

    this.endPlacing(allShown);

    return dest;
  }

  /**
   * The windows `SetWindowPos` is placing, as one list (`USER.EXE` seg7
   * `0526`), until `endPlacing`: each window's visible region as it was,
   * taken before anything of the list is placed (`09a0`); and the screen as
   * it was, for the bits a `CS_SAVEBITS` window saves as it is shown
   * (`0b75`-`0bde`). Lists begun within a list are of it.
   */
  #list: PlacingList | null = null;

  /**
   * A list of windows begun (`beginPlacing`), its windows' regions as they
   * are. Every context's bounds are taken back first for the records USER
   * keeps (`057a`).
   */
  beginPlacing(windows: DesktopWindow[]) {
    if (this.#list) {
      this.#list.depth++;
    } else {
      if (this.system && anyKept(this.system)) {
        harvestAll(this.system);
      }

      this.#list = { entries: [], screen: this.screen.indices.slice(), depth: 1 };
    }

    for (const window of windows) {
      this.#entryOf(window);
    }
  }

  /**
   * Where a window is, to tell whether the list changed it: its place and
   * size, whether it is shown, and the windows in front of it among its
   * brothers.
   */
  #placingKey(window: DesktopWindow) {
    const front = this.windows
      .slice(0, Math.max(this.windows.indexOf(window), 0))
      .filter((other) => other.parent === window.parent)
      .map((other) => other.id);

    return [window.left, window.top, window.width, window.height, window.visible, ...front].join();
  }

  /** A window's entry in the list, its region as it was taken as it is first named. */
  #entryOf(window: DesktopWindow): Placing {
    const list = this.#list as PlacingList;
    let entry = list.entries.find((one) => one.window === window);

    if (!entry) {
      entry = {
        window,
        old: this.#showing(window) ? this.#placedRegion(window) : ClipRegion.EMPTY,
        wasVisible: window.visible,
        wasAt: this.#placingKey(window),
        dest: null,
        dx: 0,
        dy: 0,
        whole: false,
        flags: null,
        skip: false,
        extra: null,
      };
      list.entries.push(entry);
    }

    return entry;
  }

  /**
   * A window of the list due all of itself by its caller, as a window shown
   * by `ShowWindow` is: not made due again through itself.
   */
  #placedWhole(window: DesktopWindow) {
    if (this.#list) {
      this.#entryOf(window).whole = true;
    }
  }

  /**
   * What a window of the list was asked, `SWP_` flags: where none are
   * given, moved or sized. The bits it kept are let go by them
   * (`088f`-`08b3`).
   */
  placingFlags(window: DesktopWindow, flags: number) {
    if (this.#list) {
      this.#entryOf(window).flags = flags;
    }
  }

  /** A window of the list drawn by its caller already: nothing more for it here. */
  placingSkip(window: DesktopWindow) {
    if (this.#list) {
      this.#entryOf(window).skip = true;
    }
  }

  /**
   * The list drawn as `SetWindowPos` draws it once every window of it is
   * placed (`USER.EXE` seg7 `0526`), at the end of the outermost list.
   * **Read out**, window by window in the list's order (`05c4`-`092e`):
   *
   * * Nothing at all where the parent of the first window does not show
   *   (`0557`-`0560`).
   * * A window shown with `CS_SAVEBITS` keeps the bits beneath it first, as
   *   it is placed (`0b75`-`0bde`; `save-bits.ts`).
   * * Its visible region as it is now (`05e0`); what is copied
   *   (`060b`-`0705`): where its bits go (`dest`), moved back by how far
   *   they come, within its old region, **less what the windows before it
   *   copied** -- taken where its bits come from, which those copies may
   *   have drawn over (`066e`-`068c`) -- moved on, less its update region
   *   and its parents' up to one with `WS_CLIPCHILDREN` (none at all where
   *   one is due all over), within its new region. Nothing where either
   *   region is empty or it is due all over. Blitted from the screen as it
   *   is, the windows before it copied already (`0713`-`0768`).
   * * A window that kept bits, and showed where it does not now, has them
   *   put back there; what is left due is that, with all of its new region
   *   (`076d`-`07f3`), and what was copied counts only outside it. Else
   *   what is due is its old region and its new together (`07f5`-`0828`).
   * * **Less what every window so far copied** (`082a`-`088c`).
   * * The bits a window kept let go where it was placed otherwise than
   *   shown, or than with nothing but `SWP_NOZORDER | SWP_NOMOVE |
   *   SWP_NOSIZE` (`088f`-`08b3`; `placingFlags`).
   * * A window nothing of which was copied, that shows now, due all over
   *   through itself, frame and all (`08de`-`08f0`, 485h).
   * * What is due gathered (`08f5`-`092a`), and made due once through the
   *   parent of the first window (`0939`-`0958`): `RDW_NOCHILDREN` where
   *   every window was shown and is of a program made before 3.10
   *   (`allShown`; counted by the windows themselves where not given),
   *   else `RDW_ALLCHILDREN`.
   */
  endPlacing(allShown?: boolean) {
    const list = this.#list as PlacingList;

    if (--list.depth > 0) {
      return;
    }

    this.#list = null;
    this.#own();

    const system = this.system;
    const entries = list.entries;
    const parent = entries[0]?.window.parent ?? null;

    if (!entries.length || (parent && !this.#showing(parent))) {
      return;
    }

    /* Kept as each is shown, the screen as it was (`0b75`-`0bde`). */
    if (system) {
      for (const entry of entries) {
        if (!entry.wasVisible && entry.window.visible && this.windows.includes(entry.window)) {
          saveUnder(system, this, entry.window, list.screen);
        }
      }
    }

    allShown ??= entries.every(
      (entry) => !entry.wasVisible && entry.window.visible && !madeFor31(this, entry.window)
    );

    const stride = this.screen.width;
    let copiedSoFar: ClipRegion | null = null;
    let gathered: ClipRegion | null = null;

    for (const entry of entries) {
      const { window, old, dx, dy } = entry;

      /* Nothing done to it -- not moved, sized, shown, hidden nor put
       * elsewhere among its brothers -- it is passed over (seg7
       * `0a4f`-`0a96`: its flags against 1807h, or against 1803h where it
       * lies where it was asked, `1184`, marked `SWP_NOREDRAW`; `05c7`). */
      if (entry.skip || entry.wasAt === this.#placingKey(window)) {
        continue;
      }
      const now =
        this.windows.includes(window) && this.#showing(window)
          ? this.#placedRegion(window)
          : ClipRegion.EMPTY;
      const dest = entry.dest ?? [
        window.left,
        window.top,
        window.left + window.width,
        window.top + window.height,
      ];
      const oldShows = old.kind > 1;
      const nowShows = now.kind > 1;

      /* What is copied (`060b`-`0705`). */
      let copied: ClipRegion | null = null;

      if (
        dest[0] < dest[2] &&
        dest[1] < dest[3] &&
        oldShows &&
        nowShows &&
        !(window.needsPaint && !(window as any).dirtyRect)
      ) {
        let part: ClipRegion | null = ClipRegion.rect(
          dest[0] - dx,
          dest[1] - dy,
          dest[2] - dx,
          dest[3] - dy
        ).intersect(old);

        if (part.kind > 1 && copiedSoFar) {
          part = part.subtract(copiedSoFar);
        }

        part = part.kind > 1 ? part.offset(dx, dy) : null;

        for (let up: DesktopWindow | null = window; up && part; up = up.parent) {
          if (up.needsPaint) {
            part = (up as any).dirtyRect ? part.subtract(updateOf(up)) : null;
          }

          if (part && part.kind <= 1) {
            part = null;
          }

          if (up.parent && up.parent.style & WS_CLIPCHILDREN) {
            break;
          }
        }

        copied = part ? part.intersect(now) : null;

        if (copied && copied.kind <= 1) {
          copied = null;
        }
      }

      /* Blitted from the screen as it is (`0727`-`0768`). */
      if (copied && (dx || dy)) {
        const bits = this.screen.indices.slice();

        for (const band of copied.bands) {
          for (let y = Math.max(band.top, 0); y < Math.min(band.bottom, this.screen.height); y++) {
            for (const [l, r] of band.spans) {
              for (let x = Math.max(l, 0); x < Math.min(r, stride); x++) {
                const [fx, fy] = [x - dx, y - dy];

                if (fx >= 0 && fy >= 0 && fx < stride && fy < this.screen.height) {
                  this.screen.put(x, y, bits[fy * stride + fx]);
                }
              }
            }
          }
        }

        const box = copied.box;

        this.screen.context.markRect(box.left, box.top, box.right, box.bottom);
      }

      const nothingCopied = !copied;

      /* What is due: put back where it kept bits (`076d`-`07f3`), else its
       * old region and its new together (`07f5`-`0828`). */
      let due: ClipRegion | null = null;
      const uncovered = oldShows ? (nowShows ? old.subtract(now) : old) : ClipRegion.EMPTY;

      if (system && hasSaved(system, window) && oldShows && uncovered.kind > 1) {
        const put = restoreUnder(system, this, window, uncovered);

        if (put.due || nowShows) {
          due = nowShows ? unite(put.region, now) : put.region;

          if (copied) {
            copied = copied.subtract(due);

            if (copied.kind <= 1) {
              copied = ClipRegion.EMPTY;
            }
          }
        }
      } else if (oldShows || nowShows) {
        due = !oldShows ? now : !nowShows ? old : unite(old, now);
      }

      if (copied) {
        copiedSoFar = copiedSoFar ? unite(copiedSoFar, copied) : copied;
      }

      if (due && copiedSoFar) {
        due = due.subtract(copiedSoFar);
      }

      if (due && entry.extra) {
        due = unite(due, entry.extra);
      }

      /* Placed otherwise than shown, or than with nothing but
       * `SWP_NOZORDER | SWP_NOMOVE | SWP_NOSIZE`, the bits it kept are let go
       * (`088f`-`08b3`). */
      const flags = entry.flags ?? 0;

      if (
        system &&
        hasSaved(system, window) &&
        !(flags & SWP_SHOWWINDOW) &&
        (flags & 0x87) !== (SWP_NOZORDER | SWP_NOMOVE | SWP_NOSIZE)
      ) {
        discardSaved(system, window);
      }

      if (!due || due.kind <= 1) {
        continue;
      }

      if (nothingCopied && nowShows && !entry.whole) {
        invalidateThrough(
          this,
          window,
          null,
          RDW_INVALIDATE | RDW_ERASE | RDW_FRAME | RDW_ALLCHILDREN
        );
      }

      gathered = gathered ? unite(gathered, due) : due;
    }

    if (gathered && gathered.kind > 1) {
      invalidateThrough(
        this,
        parent,
        gathered,
        RDW_INVALIDATE | RDW_ERASE | (allShown ? RDW_NOCHILDREN : RDW_ALLCHILDREN)
      );
    }
  }

  /**
   * A window's visible region as `SetWindowPos` works it out before and
   * after it places it (`USER.EXE` seg7 `0c19`): nothing for a window
   * hidden, else USER's rule for its whole window, with `DCX_CLIPSIBLINGS`
   * where it has `WS_CLIPSIBLINGS` (seg1 `1582`).
   */
  #placedRegion(window: DesktopWindow) {
    if (!window.visible) {
      return ClipRegion.EMPTY;
    }

    return windowRegion(
      this.system ?? ALONE,
      this,
      window,
      window,
      DCX_WINDOW | (window.style & WS_CLIPSIBLINGS ? DCX_CLIPSIBLINGS : 0)
    );
  }

  /**
   * Windows shown, hidden or put elsewhere in the order of windows by
   * `change`, drawn as `SetWindowPos` draws its list (`beginPlacing`,
   * `endPlacing`): `members` the windows of the list.
   */
  #placing(members: DesktopWindow[], change: () => void, allShown?: boolean) {
    this.beginPlacing(members);

    try {
      change();
    } finally {
      this.endPlacing(allShown);
    }
  }

  /**
   * A child shown or hidden as `SetWindowPos` draws it (`USER.EXE` seg7
   * `0526`): what showed of it as it was, or shows as it is, made due
   * through its parent, the windows in it too -- only the parent where
   * every window placed was shown (`allShown`); a window shown made due all
   * over through itself, frame and all (`08de`-`08f0`). `change` shows or
   * hides it, nothing drawn.
   */
  placeShown(window: DesktopWindow, change: () => void, allShown?: boolean) {
    this.#placing([window], change, allShown);
  }
  /**
   * A window's children moved with its pixels by a scroll, as `USER.EXE`
   * seg2 `0a1d` moves them: each child whose rectangle meets `rect` (any,
   * for null), its rectangles and what it is due moved, and then its own
   * children the same way, by the same rectangle. Nothing is drawn or
   * sent; the screen's owners are worked out again after.
   */
  scrollChildren(parent: DesktopWindow, dx: number, dy: number, rect: number[] | null) {
    const shift = (of: DesktopWindow) => {
      for (const child of this.windows.filter((other) => other.parent === of)) {
        if (
          rect &&
          !(
            Math.max(rect[0], child.left) < Math.min(rect[2], child.left + child.width) &&
            Math.max(rect[1], child.top) < Math.min(rect[3], child.top + child.height)
          )
        ) {
          continue;
        }

        const shown: any = child;

        child.left += dx;
        child.top += dy;
        this.#layout(child);

        if (child.needsPaint && shown.dirtyRect) {
          const shape = updateOf(child).offset(dx, dy);

          setUpdate(child, shape, child.needsErase);
        }

        shift(child);
      }
    };

    shift(parent);
    this.#own();
  }

  /**
   * A window given a region of the screen as USER's invalidation gives it
   * (`USER.EXE` seg1 `4202`; `invalidate-through.ts`): all of itself for
   * null, else the region added to what it is due, whole, not cut to the
   * window -- `GetUpdateRect` cuts its box to the client area. One due all
   * of itself stays so. Marked to be erased with `erase`, its frame drawn
   * with `frame`; a window USER draws itself has its frame drawn now.
   */
  dueThrough(window: DesktopWindow, region: ClipRegion | null, erase: boolean, frame: boolean) {
    const shown: any = window;

    /* A control of USER's draws its frame as it paints, as `aboutToPaint`
     * has it: it has no `WM_NCPAINT` of a program's to draw it. */
    if (!paintsItself(window)) {
      this.paintFrame(window);
    } else if (frame && window.control) {
      shown.needsFrame = true;
    } else if (frame) {
      shown.needsNcPaint = true;
    }

    /* What of it the walk made due, which has made the windows in it due
     * itself: `aboutToPaint` does not make them due there again. */
    const was = window.needsPaint ? shown.walked : undefined;
    const walked = !region || was === 'all' ? 'all' : was ? unite(was, region) : region;

    if (window.needsPaint && !shown.dirtyRect) {
      window.needsErase ||= erase;
      shown.walked = walked;
      return;
    }

    if (!region) {
      shown.dirtyRect = undefined;
      shown.dirtyShape = undefined;
      shown.dirtyShapeFor = undefined;
      window.needsPaint = true;
      window.needsErase ||= erase;
      shown.walked = walked;
      return;
    }

    setUpdate(window, window.needsPaint ? unite(updateOf(window), region) : region, erase);
    shown.walked = walked;
  }

  /**
   * A window validated as USER's invalidation walk validates it (`USER.EXE`
   * seg1 `4309`-`43e6`): all of it for null, else what it is due less the
   * region. All of a window whose frame is still to be drawn is its client
   * area (`4353`-`4369`), and all it was due then the whole window
   * (`4371`-`43a6`): what it was due of its frame stays, outside its client
   * area.
   */
  validThrough(window: DesktopWindow, region: ClipRegion | null) {
    const shown: any = window;

    if (!window.needsPaint) {
      return;
    }

    const l = window.left + window.client.left;
    const t = window.top + window.client.top;
    const [r, b] = [l + window.clientWidth, t + window.clientHeight];

    if (!region && shown.needsNcPaint) {
      region = ClipRegion.rect(l, t, r, b);
    }

    if (!region) {
      setUpdate(window, ClipRegion.EMPTY, false);
      return;
    }

    const due = shown.dirtyRect
      ? updateOf(window)
      : shown.needsNcPaint
        ? ClipRegion.rect(
            window.left,
            window.top,
            window.left + window.width,
            window.top + window.height
          )
        : ClipRegion.rect(l, t, r, b);

    setUpdate(window, due.subtract(region), false);
  }

  /** Where the `slot`th icon of a parent's client area goes: its corner. See `minimize`. */
  iconSlot(parent: DesktopWindow | null, slot: number) {
    const cxIcon = this.environment.metric(SM_CXICON);
    const cxSpacing = this.environment.metric(SM_CXICONSPACING);
    const cySpacing = this.environment.metric(SM_CYICONSPACING);
    const originX = parent ? parent.left + parent.client.left : 0;
    const originY = parent ? parent.top + parent.client.top : 0;
    const across = Math.max(
      1,
      Math.trunc((parent ? parent.clientWidth : this.screen.width) / cxSpacing)
    );
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
      (other) =>
        other.parent === parent && other.visible && other.state === 'minimized' && !other.titleOf
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
   * area, above its new siblings: `SetParent` (`userwin`). It is linked
   * first among its new parent's children (`USER.EXE` seg14 `04ab`-`04b2`,
   * after nought), as `GetWindow` with `GW_CHILD` then finds it
   * (`ddemgmt`: DDEML moves a list's conversations into another one by one,
   * and the last moved is the first child).
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

    const first = parent
      ? this.windows.findIndex((other) => other !== parent && this.#within(other, parent))
      : -1;

    this.windows.splice(
      parent ? (first < 0 ? this.windows.indexOf(parent) : first) : this.front(window),
      0,
      ...family
    );

    const now = originOf(parent);

    this.place(window, now.x + x, now.y + y, window.width, window.height);
  }

  /** Hides a window without taking it away: as `destroy`, but it can be shown again. */
  hide(window: DesktopWindow, activateNext = true) {
    /* A window hidden already, destroyed while it is active, gives the
     * activation to another as one that shows does (`USER.EXE` seg8
     * `0b86`-`0bb7`). */
    if (!window.visible) {
      if ((window as any).destroying && window.active) {
        this.#takeAway(window, false, activateNext);
      }

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

    /* Left where it lies in the order of windows, its children with it:
     * hidden, not gone, and not moved (`mousemsg`: hidden at the top, in the
     * middle or among a window's children, it stays there, and shown again
     * with `SW_SHOWNOACTIVATE` it shows there). */
    this.#takeAway(window, false, activateNext);
  }

  /**
   * The steps of USER's hit test for a point of the screen (`USER.EXE` seg1
   * `71b9`, from `WindowFromPoint`'s `713c` and the mouse's scan), in the
   * order it comes to them. **Read out**: it walks the windows by their
   * rectangles alone (seg1 `1dc0`), from the desktop window down, each
   * window's children front to back, no visible region asked. A window
   * hidden, or not holding the point, is passed over (`71bf`-`71e3`); a
   * disabled child is passed over, its children with it, and a disabled
   * window at the top answers `HTERROR` for itself (`71e5`-`71f9`). Under a
   * system-modal window, a window not it nor a child in it is taken for it
   * (`71fc`-`7208`, seg1 `287d`, `1bd3`) -- the desktop window first, so
   * that only it and the windows in it are walked. An icon answers `HTCAPTION`
   * (`720c`-`7217`). Where the point is in its client area, its children
   * are walked first (`7219`-`7256`); then a window of another task answers
   * `HTCLIENT` (`725d`-`726c`), and one of this task is a step that asks it
   * `WM_NCHITTEST`, passed over where it answers `HTTRANSPARENT`
   * (`726e`-`7285`). Past every window the desktop window answers, its task
   * no program's: `hit` given, `window` null. A step with `hit` null asks.
   * Off the screen there are none.
   */
  hitSteps(
    x: number,
    y: number,
    mine: (window: DesktopWindow) => boolean,
    sysModal: DesktopWindow | null = null
  ): { window: DesktopWindow | null; hit: number | null }[] {
    const steps: { window: DesktopWindow | null; hit: number | null }[] = [];

    if (x < 0 || y < 0 || x >= this.screen.width || y >= this.screen.height) {
      return steps;
    }

    const holds = (window: DesktopWindow) =>
      x >= window.left &&
      y >= window.top &&
      x < window.left + window.width &&
      y < window.top + window.height;
    const inClient = (window: DesktopWindow) =>
      x >= window.left + window.client.left &&
      y >= window.top + window.client.top &&
      x < window.left + window.client.right &&
      y < window.top + window.client.bottom;
    const childStyled = (window: DesktopWindow) =>
      (window.style & (WS_CHILD | WS_POPUP)) >>> 0 === WS_CHILD;
    /* Whether a window is the system-modal one, or a child in it through
     * windows styled children (seg1 `287d`, `1bd3`). */
    const underModal = (window: DesktopWindow) => {
      if (!sysModal || window === sysModal) {
        return true;
      }

      for (let at = window; childStyled(at) && at.parent; at = at.parent) {
        if (at.parent === sysModal) {
          return true;
        }
      }

      return false;
    };
    /* A window walked: true where the walk ends at it or in it. */
    const walk = (start: DesktopWindow): boolean => {
      const window = start;

      if (!window.visible || !holds(window)) {
        return false;
      }

      if (window.style & WS_DISABLED) {
        if (childStyled(window)) {
          return false;
        }

        steps.push({ window, hit: HTERROR });
        return true;
      }

      return walkIn(underModal(window) ? window : (sysModal as DesktopWindow));
    };
    /* The rest of a window's walk, once it is found to hold the point. */
    const walkIn = (window: DesktopWindow): boolean => {
      if (window.state === 'minimized') {
        steps.push({ window, hit: HTCAPTION });
        return true;
      }

      const parent = window;

      if (
        inClient(parent) &&
        this.windows.some((child) => child.parent === parent && walk(child))
      ) {
        return true;
      }

      if (!mine(window)) {
        steps.push({ window, hit: HTCLIENT });
        return true;
      }

      steps.push({ window, hit: null });
      return false;
    };

    /* The walk begins at the desktop window, which is no system-modal
     * window's child: with one, it is taken for that one, and nothing
     * outside it is walked (`wfpwalk`: a point over the desktop answers
     * it). */
    if (sysModal) {
      walkIn(sysModal);
    } else if (!this.windows.some((window) => !window.parent && walk(window))) {
      steps.push({ window: null, hit: HTCLIENT });
    }

    return steps;
  }

  /**
   * The window USER's hit test comes to at a point of the screen
   * (`hitSteps`), if any but the desktop window, every window taken for
   * this task's: an icon's title answers `HTCAPTION` (seg1 `6dbd`) and a
   * group box `HTTRANSPARENT` (seg25 `1c9b`), which passes it over; any
   * other window asked is taken to answer for itself.
   */
  windowAt(x: number, y: number) {
    for (const { window, hit } of this.hitSteps(x, y, () => true)) {
      if (
        hit !== null ||
        !window ||
        window.titleOf ||
        !(window.control?.className === 'BUTTON' && (window.control.style & 0x0f) === 7)
      ) {
        return window;
      }
    }

    return null;
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
      ? {
          left: right,
          top: top - overlap,
          right: right + this.environment.metric(2),
          bottom: bottom + 1,
        }
      : {
          left: left - overlap,
          top: bottom,
          right: right + 1,
          bottom: bottom + this.environment.metric(3),
        };
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

  /**
   * Paints a window's frame, where the window shows: active or not as its
   * caption is lit, or as `lit` says (`switch-loop.ts`).
   */
  paintFrame(window: DesktopWindow, lit = window.captionLit) {
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

    this.#frameOnto(whole, window, lit);
  }

  /**
   * A window's frame drawn over everything, where it is on the screen,
   * whatever covers it: as USER draws it in its switch window, through a
   * visible region of the whole window (`USER.EXE` seg23 `0290`-`02c3`).
   */
  paintFrameOver(window: DesktopWindow, lit: boolean) {
    this.#frameOnto(
      this.#onScreen(window.left, window.top, window.width, window.height),
      window,
      lit
    );
  }

  /** A view of the screen at a place, drawn wherever it is on the screen. */
  #onScreen(left: number, top: number, width: number, height: number) {
    return DeviceBitmap.view(this.screen, left, top, width, height, (x, y) => {
      const sx = left + x;
      const sy = top + y;

      return sx >= 0 && sy >= 0 && sx < this.screen.width && sy < this.screen.height;
    });
  }

  #frameOnto(whole: DeviceBitmap, window: DesktopWindow, lit: boolean) {
    paintFrame(
      whole,
      0,
      0,
      window.width,
      window.height,
      {
        style: window.style,
        scroll: (window as any).scroll,
        active: lit,
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
    pattern = colorref === window.background?.colorref ? window.background?.pattern : undefined,
    origin = { x: 0, y: 0 }
  ) {
    window.needsErase = false;

    if (!this.#showing(window) || colorref === undefined) {
      return;
    }

    this.#fill(
      this.clientView(window),
      0,
      0,
      window.clientWidth,
      window.clientHeight,
      colorref,
      -origin.x,
      -origin.y,
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
  repaintAll(frames = true) {
    this.backgroundDue = true;

    for (const window of [...this.windows].reverse()) {
      if (this.#showing(window) && !paintsItself(window)) {
        /* An icon's title, which has no window procedure: with the desktop. */
        (window as any).needsFrame = true;
      } else if (this.#showing(window)) {
        /* Without `frames`, as `RepaintScreen` asks, the frames are left. */
        (window as any).needsNcPaint ||= frames;
        (window as any).dirtyRect = undefined;
        window.needsErase = true;
        window.needsPaint = true;
      }
    }
  }

  /** Whether the desktop itself is to be drawn again, when paints are next looked for. */
  backgroundDue = false;

  /** What of the desktop itself is due, drawn when paints are next looked for, or sooner. */
  backgroundRegion: ClipRegion | null = null;

  /** A region of the desktop itself made due (`invalidateThrough`). */
  backgroundDueIn(region: ClipRegion) {
    if (region.kind > 1) {
      this.backgroundRegion = this.backgroundRegion ? unite(this.backgroundRegion, region) : region;
    }
  }

  /** The desktop itself drawn where it is due, now, nothing of it due after. */
  paintBackgroundDue() {
    const region = this.backgroundRegion;

    this.backgroundRegion = null;

    if (region) {
      this.paintBackgroundIn(region);
    }
  }

  /** The desktop itself drawn in a region of the screen, where no window shows. */
  paintBackgroundIn(region: ClipRegion) {
    for (const band of region.bands) {
      for (const [left, right] of band.spans) {
        this.paintBackground(left, band.top, right, band.bottom);
      }
    }
  }

  /** The desktop itself, where no window shows: its wallpaper or its brush. */
  paintBackground(left = 0, top = 0, right = this.screen.width, bottom = this.screen.height) {
    const desktop = DeviceBitmap.view(
      this.screen,
      0,
      0,
      this.screen.width,
      this.screen.height,
      (x, y) => this.owners[y * this.screen.width + x] === 0
    );

    this.#paintDesk(desktop, 0, 0, left, top, right, bottom);
  }

  /**
   * The desktop's brush (`USER.EXE` seg45 `[52Eh]`) as the screen's indices,
   * eight by eight from the screen's corner: with a pattern, the pattern's
   * bitmap blitted onto one of the screen's (seg41 `090c`) -- its noughts in
   * `COLOR_BACKGROUND` and its ones in `COLOR_WINDOWTEXT`, the text and
   * background colours of that blit, each the nearest the display has,
   * undithered; on a display of a bit a pixel the blit is a copy, its noughts
   * black and its ones white. With none, null: a solid brush of
   * `COLOR_BACKGROUND` (seg41 `0ba6`), patterned as the driver patterns a
   * colour. **Recorded** by `deskwall`.
   */
  #deskBrush(): Uint8Array | null {
    const rows = this.environment.desk?.()?.pattern;

    if (!rows) {
      return null;
    }

    const palette = this.screen.devicePalette;
    const mono = this.screen.depth === 1;
    const [noughts, ones] = (
      [
        [COLOR_BACKGROUND, 0x000000],
        [COLOR_WINDOWTEXT, 0xffffff],
      ] as const
    ).map(([index, copied]) => {
      const colorref = mono ? copied : this.environment.sysColor(index);

      return matchedIndex(
        this.environment.display,
        palette,
        colorref & 0xff,
        (colorref >> 8) & 0xff,
        (colorref >> 16) & 0xff
      );
    });
    const tile = new Uint8Array(64);

    for (let at = 0; at < 64; at++) {
      tile[at] = rows[at >> 3] & (0x80 >> (at & 7)) ? ones : noughts;
    }

    return tile;
  }

  /**
   * The desktop as it shows through `view`, whose corner is at `cornerX`,
   * `cornerY` on the screen, within a rectangle of the view (`USER.EXE` seg1
   * `9e96`): its brush from the screen's corner, as `PatBlt` paints it there;
   * or with a wallpaper, the wallpaper (seg21 `086e`). Tiled, its bitmap is
   * repeated from its origin on the screen, every way (`06e8`); not, it is
   * drawn once at its origin and the brush about it (`07b7`). A bitmap of a
   * bit a pixel is blitted as a new device context blits one: its noughts
   * black and its ones white. **Recorded** by `deskwall`.
   */
  #paintDesk(
    view: DeviceBitmap,
    cornerX: number,
    cornerY: number,
    left: number,
    top: number,
    right: number,
    bottom: number
  ) {
    const wallpaper = this.environment.desk?.()?.wallpaper ?? null;

    if (!wallpaper?.tile) {
      const brush = this.#deskBrush();

      this.#fill(
        view,
        left,
        top,
        right - left,
        bottom - top,
        brush ? 0 : this.environment.sysColor(COLOR_BACKGROUND),
        cornerX,
        cornerY,
        brush ?? undefined
      );
    }

    if (!wallpaper) {
      return;
    }

    const { bitmap, tile, origin } = wallpaper;
    const { width, height } = bitmap;

    if (width <= 0 || height <= 0) {
      return;
    }

    const palette = view.devicePalette;
    const mono =
      bitmap.depth === 1
        ? [0, 255].map((level) =>
            matchedIndex(this.environment.display, palette, level, level, level)
          )
        : null;

    for (let y = top; y < bottom; y++) {
      for (let x = left; x < right; x++) {
        let bx = x + cornerX - origin[0];
        let by = y + cornerY - origin[1];

        if (tile) {
          bx = ((bx % width) + width) % width;
          by = ((by % height) + height) % height;
        } else if (bx < 0 || by < 0 || bx >= width || by >= height) {
          continue;
        }

        const index = bitmap.indexAt(bx, by) ?? 0;

        view.put(x, y, mono ? mono[index ? 1 : 0] : index);
      }
    }

    view.context.markRect(left, top, right, bottom);
  }

  /** Works out a window's client area from its frame, and points its surface at it. */
  #layout(window: DesktopWindow) {
    const answer = window.clientAnswer;

    window.client =
      answer &&
      answer.width === window.width &&
      answer.height === window.height &&
      answer.style === window.style &&
      window.state !== 'minimized' &&
      !window.titleOf
        ? { ...answer.client }
        : this.#clientOf(window, window.width, window.height);

    window.surface.bitmap = this.#screenView(
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

    surface.bitmap = this.#screenView(window, 0, 0, window.width, window.height);

    return surface;
  }

  /**
   * A device context's view of the whole screen from a window's corner, as
   * large as its client area or, `whole`, the whole window, as USER's
   * entries are pointed at the window they are lent for (`dc-entries.ts`).
   */
  dcView(window: DesktopWindow, whole: boolean) {
    return whole
      ? this.#screenView(window, 0, 0, window.width, window.height)
      : this.#screenView(
          window,
          window.client.left,
          window.client.top,
          window.clientWidth,
          window.clientHeight
        );
  }

  /**
   * A surface over a window's client area, as `GetDC` hands out while the
   * window paints: drawn through all of the client area, not only what
   * `BeginPaint` is painting (`choosclr`).
   */
  clientSurface(window: DesktopWindow) {
    const surface: any = Surface.memory();

    surface.bitmap = this.#screenView(
      window,
      window.client.left,
      window.client.top,
      window.clientWidth,
      window.clientHeight
    );

    return surface;
  }

  /**
   * A view of the screen over a window's client area for USER's own
   * drawing of it -- a control's face, a list's rows, its background --
   * drawn only within its region by USER's rule, and while it paints,
   * within what it paints (`#view`). Twin of the Rust engine's
   * `window_view`.
   */
  clientView(window: DesktopWindow) {
    return this.#view(
      window,
      window.client.left,
      window.client.top,
      window.clientWidth,
      window.clientHeight
    );
  }

  /**
   * A device context's view of the whole screen, from a window's corner
   * (`left, top` in from the window's), as large as that part of the window
   * (`DeviceBitmap.screenView`): what it draws is kept to its region by its
   * surface (`Surface`'s `dcClip`), moved with `SetDCOrg`, and nothing else
   * (`kb/topics/visible-regions.md`, decision 2).
   */
  #screenView(window: DesktopWindow, left: number, top: number, width: number, height: number) {
    return DeviceBitmap.screenView(
      this.screen,
      [window.left + left, window.top + top],
      width,
      height
    );
  }

  /**
   * A view of the screen over part of a window, for USER's own drawing:
   * drawn only within the window's region by USER's rule -- its client
   * area's, with `DCX_USESTYLE`, or its whole rectangle's, with
   * `DCX_WINDOW` too, as `GetDC` and `GetWindowDC` work them out
   * (`visible-region-rule.ts`) -- and, `clipped`, while it paints only
   * within what it paints: `BeginPaint`'s clip, the region where there is
   * one (`updrgn`).
   */
  #view(
    window: DesktopWindow,
    left: number,
    top: number,
    width: number,
    height: number,
    clipped = true
  ) {
    const x0 = window.left + left;
    const y0 = window.top + top;
    /* The whole window where the part is all of it -- a minimized window's
     * client area is its whole rectangle too -- else its client area. */
    const whole = left === 0 && top === 0 && width === window.width && height === window.height;
    const system = this.system ?? ALONE;
    const { flags, of } = regionFlags(
      system,
      window,
      whole ? DCX_USESTYLE | DCX_WINDOW : DCX_USESTYLE
    );
    let region = windowRegion(system, this, window, of, flags);
    const clip = clipped ? (window as any).paintClip : undefined;
    const shape = clipped ? (window as any).paintShape : undefined;

    if (clip) {
      region = region.intersect(ClipRegion.rect(clip[0], clip[1], clip[2], clip[3]));
    }

    if (shape) {
      region = region.intersect(shape);
    }

    const own = region.offset(-x0, -y0);

    return DeviceBitmap.view(this.screen, x0, y0, width, height, (x, y) => own.contains(x, y));
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

    /* USER's device context entries the change makes stale (`dc-entries.ts`). */
    if (this.system) {
      windowsChanged(this.system, this);
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
    this.paintBackgroundDue();

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
    if (!this.windows.some((window) => window.needsPaint || window.internalPaint)) {
      return null;
    }

    /* Due where it has an update region or a paint of its own (`USER.EXE`
     * seg1 `77d1`-`77db`). */
    const due = (window: DesktopWindow) =>
      paintsItself(window) &&
      (window.needsPaint || window.internalPaint) &&
      this.#showing(window) &&
      match(window);
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

    /* Another task's making it due looked at as its `WM_PAINT` is taken
     * (`USER.EXE` seg1 `787a`, `4483`). */
    (window as any).otherTask = false;

    /* Its paint of its own taken as its `WM_PAINT` is (`USER.EXE` seg1
     * `7864`-`786a`, `4469`-`446f`). With no update region, `BeginPaint`'s
     * region is empty (`7640`): nothing of it is painted, and nothing of
     * the windows in it made due. */
    const internal = window.internalPaint;

    window.internalPaint = false;

    if (internal && !window.needsPaint) {
      (window as any).paintShape = ClipRegion.EMPTY;
      (window as any).paintClip = undefined;
      (window as any).walked = undefined;
      return;
    }

    /* Only its children in what is to be painted again, when that is known. */
    const dirty = (window as any).dirtyRect;
    const quiet = !!dirty && (window as any).quietDirty === dirty;

    const walked = (window as any).walked;
    const due = walked ? updateOf(window) : null;

    (window as any).paintShape = shapeOf(window, dirty);
    (window as any).dirtyRect = undefined;
    (window as any).dirtyShape = undefined;
    (window as any).quietDirty = undefined;
    (window as any).paintClip = dirty;
    (window as any).walked = undefined;

    /* Not when all it is due is where its children were shown: they were
     * due themselves then (see `showRaster`). Nor where USER's invalidation
     * walk made it due, which made them due as Windows makes them
     * (`invalidate-through.ts`): only where something else did. */
    let shape: ClipRegion | undefined = (window as any).paintShape;
    let part = dirty;

    if (walked && due) {
      shape = walked === 'all' ? ClipRegion.EMPTY : due.subtract(walked);
      part = [shape.box.left, shape.box.top, shape.box.right, shape.box.bottom];
    }

    if (!(window.style & WS_CLIPCHILDREN) && !quiet && !(shape && shape.kind <= 1)) {
      const dirty = part;

      for (const other of this.windows) {
        if (other === window || !this.#within(other, window) || !this.#showing(other)) {
          continue;
        }

        /* Due where the parent is: the part of it the parent's due part
         * covers, added to what it was due already (`showseq`: its frame
         * then drawn with a region, not whole). Where the parent is due as
         * a region, only where the region is: the place a child was moved
         * from is due in its parent, and the child at its new place is not,
         * though the box of what was uncovered reaches over it (`swpbits`). */
        let part: number[] | undefined;

        if (dirty && shape) {
          const covered = shape.intersect(
            ClipRegion.rect(
              other.left,
              other.top,
              other.left + other.width,
              other.top + other.height
            )
          );

          if (covered.kind <= 1) {
            continue;
          }

          const { left, top, right, bottom } = covered.box;

          part = [left, top, right, bottom];
        } else if (dirty) {
          if (!(
            other.left < dirty[2] &&
            dirty[0] < other.left + other.width &&
            other.top < dirty[3] &&
            dirty[1] < other.top + other.height
          )) {
            continue;
          }

          part = [
            Math.max(dirty[0], other.left),
            Math.max(dirty[1], other.top),
            Math.min(dirty[2], other.left + other.width),
            Math.min(dirty[3], other.top + other.height),
          ];
        }

        {
          const was = (other as any).dirtyRect;

          (other as any).dirtyRect = !part
            ? undefined
            : !other.needsPaint
              ? part
              : was
                ? [
                    Math.min(was[0], part[0]),
                    Math.min(was[1], part[1]),
                    Math.max(was[2], part[2]),
                    Math.max(was[3], part[3]),
                  ]
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
  maximize(
    window: DesktopWindow,
    to?: { left: number; top: number; width: number; height: number }
  ) {
    this.#keepIconPlace(window);
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

    /* Where `WM_GETMINMAXINFO` and `WM_WINDOWPOSCHANGING` left it, on the
     * screen (`minmax`). */
    if (to) {
      this.place(window, to.left, to.top, to.width, to.height);
      return;
    }

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

    this.#keepIconPlace(window);
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

    this.#keepIconPlace(window);

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
    const across = Math.max(
      1,
      Math.trunc((parent ? parent.clientWidth : this.screen.width) / cxSpacing)
    );
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

  /**
   * An icon's title under it, centred, as `USER.EXE` places it (seg1
   * `6c14`): its text measured (`6b43`) -- its trailing spaces dropped, all
   * but the first -- with `DrawText`'s `DT_CALCRECT`, broken into lines no
   * wider than `SM_CXICONSPACING` less two borders where wrapping is on, a
   * word wider than that on a line of its own; the window as high as the
   * lines and as wide as the widest and four borders, half that less half
   * the icon to the left of the icon's middle. A title of nothing is
   * measured as the whole width and one line (`6be4`). **Recorded** by
   * `ictwrap`.
   */
  #placeTitle(window: DesktopWindow) {
    const title = window.iconTitle;

    if (!title) {
      return;
    }

    const metric = this.environment.metric;
    const border = metric(SM_CXBORDER);
    const lineHeight = this.environment.titleMetrics?.height ?? this.environment.font.height;
    const limit = metric(SM_CXICONSPACING) - 2 * border;
    const text = window.title.slice(0, ICON_TITLE_LENGTH);
    let length = text.length;
    let width = limit;
    let height = lineHeight;

    if (length) {
      for (let at = length - 1; at !== 0 && text[at] === ' '; at--) {
        length--;
      }

      const rect = { left: 0, top: 0, right: limit, bottom: 2 };

      layoutText(
        this.#titleOps(() => {}),
        text,
        length,
        rect,
        this.#titleFormat() | DT_CALCRECT
      );
      width = rect.right - rect.left;
      height = rect.bottom - rect.top;
    }

    title.title = window.title;
    title.visible = window.visible;
    this.place(
      title,
      window.left + (window.width >> 1) - (width >> 1) - 2 * border,
      window.top + window.height,
      width + 4 * border,
      height
    );
  }

  /** The flags an icon's title is measured and drawn with. */
  #titleFormat() {
    return ICON_TITLE_FORMAT | (this.environment.titleWrap?.() === false ? DT_SINGLELINE : 0);
  }

  /** Laying out text in the icon title's font, each piece drawn by `draw`. */
  #titleOps(draw: (x: number, y: number, text: string) => void): TextOps {
    const text = this.#titleText;
    const metrics = this.environment.titleMetrics;

    return {
      extent: (piece) => text.measureText(piece).width,
      metrics: {
        height: metrics?.height ?? this.environment.font.height,
        externalLeading: 0,
        overhang: metrics?.overhang ?? 0,
        ascent: metrics?.ascent ?? 0,
        average: metrics?.average ?? 0,
      },
      isSystem: false,
      textOut: draw,
      underline: () => {},
      withClip: (_rect, run) => run(),
      widest: { value: 0 },
    };
  }

  /** Takes a window's icon title away, as it stops being an icon. */
  /**
   * Where an icon was, kept as it stops being one: **recorded** by
   * `intpos`, whose window restored answers the point its icon was at.
   */
  #keepIconPlace(window: DesktopWindow) {
    if (window.state === 'minimized') {
      window.iconWas = { left: window.left, top: window.top };
    }

    /* And where it was maximized, kept as it stops being so (`wplace`). */
    if (window.state === 'maximized') {
      window.maxWas = { left: window.left, top: window.top };
    }
  }

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
   * the desktop's, its wallpaper or its brush from the screen's corner
   * (`58d4`).
   */
  eraseIcon(window: DesktopWindow) {
    const whole = this.#view(window, 0, 0, window.width, window.height);
    const parent = window.parent;

    if (!parent) {
      this.#paintDesk(whole, window.left, window.top, 0, 0, window.width, window.height);
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

  /**
   * An icon's title (`USER.EXE` seg1 `6984`): while its window is active,
   * `COLOR_ACTIVECAPTION`'s brush and `COLOR_CAPTIONTEXT`. While it is not,
   * a window at the top's is the desktop's brush -- never the wallpaper --
   * and a child's its parent's class brush, or `COLOR_APPWORKSPACE`'s where
   * it has none; and the text black where the brush's colour, red, green and
   * blue added, is past 381, white where it is not (`69c7`-`69f9`). A
   * pattern brush's is white (`deskwall`). The brush aligned with the
   * desktop, or the parent's client area, as `FillWindow` aligns it.
   */
  #paintIconTitle(title: DesktopWindow, lit = title.titleOf!.captionLit, clipped = true) {
    const window = title.titleOf!;
    const whole = clipped
      ? this.#view(title, 0, 0, title.width, title.height)
      : this.#onScreen(title.left, title.top, title.width, title.height);
    const active = lit;
    const text = this.#titleText;
    const parent = window.parent;
    let ground: number;
    let pattern: Uint8Array | undefined;
    let originX = title.left;
    let originY = title.top;

    if (active) {
      ground = this.environment.sysColor(COLOR_ACTIVECAPTION);
    } else if (parent) {
      const background = parent.background;

      originX = title.left - parent.left - parent.client.left;
      originY = title.top - parent.top - parent.client.top;
      ground = background?.colorref ?? this.environment.sysColor(COLOR_APPWORKSPACE);
      pattern = background?.pattern;
    } else {
      pattern = this.#deskBrush() ?? undefined;
      ground = pattern ? 0 : this.environment.sysColor(COLOR_BACKGROUND);
    }

    this.#fill(whole, 0, 0, title.width, title.height, ground, originX, originY, pattern);

    const sum = (ground & 0xff) + ((ground >> 8) & 0xff) + ((ground >> 16) & 0xff);

    /* The text in the client area less a border on the left and two on the
     * right, which it is clipped to (`6a76`-`6aaa`), as it was measured;
     * its trailing spaces kept, so that a line of them falls below. */
    const border = this.environment.metric(SM_CXBORDER);
    const right = title.width - 2 * border;
    const lines = clipped
      ? this.#view(title, border, 0, right - border, title.height)
      : this.#onScreen(title.left + border, title.top, right - border, title.height);

    text.bitmap = lines;
    text.textColor = colourOf(
      active ? this.environment.sysColor(COLOR_CAPTIONTEXT) : sum > 0x17d ? 0 : 0xffffff
    );

    const shown = window.title.slice(0, ICON_TITLE_LENGTH);

    layoutText(
      this.#titleOps((x, y, piece) => text.fillText(x - border, y, piece)),
      shown,
      shown.length,
      { left: border, top: 0, right, bottom: title.height },
      this.#titleFormat()
    );
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
   * In its own font, when it has been given one. Where `caption`, only a
   * group box's caption's ground is filled, as its text is set, and its
   * marks are left as they are (`button.ts`).
   */
  paintControl(window: DesktopWindow, caption = false) {
    if (!caption) {
      window.needsErase = false;
      window.needsPaint = false;
    }

    if (!window.control || !this.#showing(window)) {
      return;
    }

    const bitmap = this.clientView(window);
    const environment: any = this.#controlEnvironment(window, bitmap);
    const own = window.control.font;

    /* The focus in the colours the parent answered `WM_CTLCOLOR` with, as the
     * control's device context has them: Caribbean Treasure answers a grey
     * background, and its button's dots show black on grey. */
    const colours = (window.control as any).colours;
    const focus = (left: number, top: number, right: number, bottom: number) =>
      colours
        ? this.focusIn(window, left, top, right, bottom, colours.text, colours.ground)
        : this.focusRectangle(window, left, top, right, bottom);

    environment.disabled = (window.style & 0x08000000) !== 0;
    environment.focused = this.focus === window;
    environment.focus = focus;
    const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

    environment.systemAverage = Math.trunc(
      (Math.trunc(this.#text.measureText(letters).width / 26) + 1) / 2
    );

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
      /* Grayed in the control's own font, as `GrayString` draws it through
       * the context's (`choosclr`, `findrepl`). */
      environment.label = (
        line: string,
        colour: number,
        x: number,
        y: number,
        grayed = false,
        fromText = false
      ) => drawLabel(text, own.metrics, bitmap, line, colour, x, y, grayed, fromText);
    }

    /* Text on the background colour, the cell it takes. */
    if (environment.ground !== undefined) {
      const draw = environment.text;
      const painter = new Painter(
        bitmap,
        0,
        0,
        window.clientWidth,
        window.clientHeight,
        environment
      );

      environment.text = (line: string, colour: number, x: number, y: number) => {
        painter.fill(
          x,
          y,
          x + environment.measure(line),
          y + environment.font.height,
          painter.solid(environment.ground)
        );
        draw(line, colour, x, y);
      };
    }

    if (caption) {
      eraseGroupCaption(
        bitmap,
        window.clientWidth,
        window.clientHeight,
        window.control,
        environment
      );
      return;
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
        focus(rect.left, rect.top, rect.right, rect.bottom);
      }
    }
  }

  /**
   * A list box's row of a string item (`USER.EXE` seg35 `069a`): a selected
   * row filled in the highlight colour and its text in the highlight text
   * colour; an unselected one filled in the window colour when `fill` says
   * so, and its text on its own cell. The text is two pixels in.
   */
  listText(
    window: DesktopWindow,
    index: number,
    row: number,
    selected: boolean,
    fill: boolean,
    rows?: [number, number]
  ) {
    const control = window.control!;
    const list = (control as any).list;
    const bitmap = this.clientView(window);
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
    surface.backcolor = colourOf(
      selected ? environment.sysColor(13) : (environment.ground ?? environment.sysColor(5))
    );
    surface.bitmap = bitmap;
    surface.textColor = colourOf(environment.sysColor(selected ? 14 : 8));
    surface.withClip({ left: 0, top, right: window.clientWidth, bottom }, () =>
      surface.fillText(2, y, String(control.items[index]))
    );
  }

  /** Moves a window's client pixels down by `dy`, clearing rows `from` to `to` in the window colour, as `ScrollWindow` and the erase after it do. */
  scrollClient(window: DesktopWindow, dy: number, from: number, to: number) {
    const bitmap = this.clientView(window);
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
    const bitmap = this.clientView(window);
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
    const bitmap = this.clientView(window);

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
            const colour = arrow.devicePalette.colours[arrow.indexAt(column, row) ?? 0] ?? [
              0, 0, 0,
            ];

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
    const environment = this.environment;

    this.focusIn(
      window,
      left,
      top,
      right,
      bottom,
      environment.sysColor(text),
      environment.sysColor(back)
    );
  }

  /** `focusRectangle` in a text and a background colour, as `COLORREF`s. */
  focusIn(
    window: DesktopWindow,
    left: number,
    top: number,
    right: number,
    bottom: number,
    text: number,
    back: number
  ) {
    const bitmap = this.clientView(window);
    /* As the display's driver matches a colour, the static colours only on
     * the 256-colour display (`palsys`): a white a palette put at 10 is not
     * the white the dots are drawn in. */
    const index = (colour: number) =>
      matchedIndex(
        this.environment.display,
        bitmap.devicePalette,
        colour & 0xff,
        (colour >> 8) & 0xff,
        (colour >> 16) & 0xff
      );
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

    /* After the last topmost window and its children, whatever lies among
     * them (`sysdlg`: with a hidden dialog made active at the very front and
     * made topmost there, a window made active goes after USER's topmost
     * `#32771`, the last of them). */
    const topOf = (other: DesktopWindow) => {
      while (other.parent) {
        other = other.parent;
      }

      return other;
    };
    let at = 0;

    this.windows.forEach((other, index) => {
      if (other !== window && topOf(other) !== window && topOf(other).topmost) {
        at = index + 1;
      }
    });

    return at;
  }

  /**
   * A window shown where it lies, not brought to the top nor made active: a
   * window not active minimized with `SW_MINIMIZE` keeps its place
   * (`owners`).
   */
  showInPlace(window: DesktopWindow) {
    /* Drawn as `SetWindowPos` draws its list (`endPlacing`). */
    this.beginPlacing([window]);
    this.placingFlags(
      window,
      SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | (window.visible ? 0 : SWP_SHOWWINDOW)
    );
    this.#placedWhole(window);

    if (window.iconTitle && !window.iconTitle.visible) {
      this.#entryOf(window.iconTitle);
      this.#placedWhole(window.iconTitle);
    }

    window.visible = true;
    this.#own();
    this.paintFrame(window);

    if (window.iconTitle && !window.iconTitle.visible) {
      window.iconTitle.visible = true;
      this.#own();
      this.paintFrame(window.iconTitle);
    }

    const drawn = window.state === 'minimized' && window.icon !== null;

    /* Shown, it is due all over through itself, frame and all, the windows
     * in it too (`USER.EXE` seg7 `08de`-`08f0`): a child shown while it was
     * hidden was due nothing (`0557`; `swpunc`). */
    if (!drawn) {
      invalidateThrough(
        this,
        window,
        null,
        RDW_INVALIDATE | RDW_ERASE | RDW_FRAME | RDW_ALLCHILDREN
      );
    }

    window.needsErase = !drawn;
    window.needsPaint = !drawn;
    this.endPlacing();
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

      /* Hidden where it lies: its place is kept for when it shows again.
       * Drawn as `SetWindowPos` draws its list (`endPlacing`). */
      if (hide && other.visible) {
        this.beginPlacing([other]);
        this.placingFlags(other, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_HIDEWINDOW);
        other.hiddenWithOwner = true;
        other.visible = false;
        other.active = false;
        this.#own();
        this.endPlacing(false);
      } else if (!hide && other.hiddenWithOwner) {
        this.beginPlacing([other]);
        this.placingFlags(other, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_SHOWWINDOW);
        this.#placedWhole(other);
        other.hiddenWithOwner = false;
        other.visible = true;
        this.#own();
        this.#dueWhole(other);
        this.endPlacing();
      }
    }
  }

  /**
   * A window put at the very bottom of the windows at the top, its icon's
   * title just above it and its children with it, and shown there if
   * `show` -- not made active, as a window minimized with
   * `SW_SHOWMINNOACTIVE` or made minimized goes (`showmin`).
   */
  toBottom(window: DesktopWindow, show: boolean, after: DesktopWindow | null = null) {
    const family = this.windows.filter(
      (other) => this.#within(other, window) || other === window.iconTitle
    );

    /* `after`: put after that window instead, as `MinMaximize` puts an icon
     * after the last of its brothers beneath it owned as it is (`USER.EXE`
     * seg6 `1e58`). */
    if (after) {
      for (const member of family) {
        this.windows.splice(this.windows.indexOf(member), 1);
      }

      const at = this.windows.indexOf(after) + 1;

      this.windows.splice(
        at,
        0,
        ...family.filter((member) => member === window.iconTitle),
        ...family.filter((member) => member !== window.iconTitle)
      );
    } else {
      for (const member of family) {
        this.windows.splice(this.windows.indexOf(member), 1);
      }

      this.windows.push(...family.filter((member) => member === window.iconTitle));
      this.windows.push(...family.filter((member) => member !== window.iconTitle));
    }

    /* Of a list being placed, it is drawn as the list is (`endPlacing`). */
    if (this.#list) {
      if (show) {
        window.visible = true;

        if (window.iconTitle) {
          window.iconTitle.visible = true;
        }
      }

      return;
    }

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

    /* Drawn as `SetWindowPos` draws its list (`endPlacing`). */
    this.beginPlacing([window]);
    this.placingFlags(window, SWP_NOMOVE | SWP_NOSIZE | (window.visible ? 0 : SWP_SHOWWINDOW));
    this.#placedWhole(window);

    for (const member of family) {
      this.windows.splice(this.windows.indexOf(member), 1);
    }

    this.windows.splice(this.front(window), 0, ...family);
    window.visible = true;
    this.#own();
    this.#dueWhole(window);
    this.endPlacing();
  }

  /** Takes a child from its parent to lie on the desktop where it is, as `SetParent` with none does. */
  detach(window: DesktopWindow) {
    window.parent = null;
    this.#own();
  }

  /** A list box's client area cleared in the window colour, as its erase does. */
  listErase(window: DesktopWindow) {
    const bitmap = this.clientView(window);
    const painter = new Painter(
      bitmap,
      0,
      0,
      window.clientWidth,
      window.clientHeight,
      this.#controlEnvironment(window, bitmap)
    );

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

    while (
      last < text.length &&
      layout.measure(text.slice(edit.scroll, last + 1)) <= layout.width
    ) {
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

        surface.textColor = colourOf(environment.sysColor(selected ? COLOR_HIGHLIGHTTEXT : 8));

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
        ? (own.metrics.average ?? systemAverage)
        : averageOf(measure(letters))
      : systemAverage;
    const height = own ? own.metrics.height : system.height;
    const overhang = own ? (own.metrics.overhang ?? 0) : 0;
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
    const systemAverage = Math.trunc(
      (Math.trunc(this.#text.measureText(letters).width / 26) + 1) / 2
    );
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
          ? [
              Math.min(was[0], area[0]),
              Math.min(was[1], area[1]),
              Math.max(was[2], area[2]),
              Math.max(was[3], area[3]),
            ]
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

      for (
        let child = window;
        child.parent && !(child.parent.style & WS_CLIPCHILDREN);
        child = child.parent
      ) {
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
            ? [
                Math.min(was[0], area[0]),
                Math.min(was[1], area[1]),
                Math.max(was[2], area[2]),
                Math.max(was[3], area[3]),
              ]
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

/**
 * A label, as the desktop and its controls draw one: its first `&` dropped
 * and the character after it underlined a row below the ascent -- from the
 * overhang of an emboldened font to the left, as `DrawText` measures it --
 * and, grayed, what was there put back through every other pixel, as
 * `GrayString` draws through a gray brush.
 */
function drawLabel(
  text: any,
  font: any,
  bitmap: DeviceBitmap,
  line: string,
  colour: number,
  x: number,
  y: number,
  grayed: boolean,
  fromText: boolean
) {
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
    const under = x + text.measureText(plain.slice(0, at)).width - (font.overhang ?? 0);
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

        /* A control's text is grayed from where the text starts, as
         * `GrayString` draws it into a bitmap of its own (`btndis`). */
        const parity = fromText ? (column + row) & 1 : (px + py) & 1;

        if (parity === GRAY_PHASE && was !== null) {
          bitmap.put(px, py, was);
        }
      }
    }
  }
}
