'use strict';

import { eraseDue } from './erase.js';
import { User } from '../user.js';

import { type DesktopWindow } from './desktop.js';
import {
  handleOf,
  MenuData,
  MF_DISABLED,
  MF_GRAYED,
  MF_POPUP,
  MF_SEPARATOR,
  separated,
} from './menu-data.js';
import { nextMessage, postMessage } from './queue.js';
import { hitTest } from './raster-input.js';
import { WM_SETCURSOR } from './set-cursor.js';
import { messageFilter, MSGF_MENU } from './hooks.js';
import { RasterWindow } from './raster-window.js';

const HTCAPTION = 2;

/**
 * A menu, open: what `DefWindowProc` does when a window's menu bar or system
 * menu box is pressed, or `WM_SYSCOMMAND` asks for its menu from the keyboard,
 * and what `TrackPopupMenu` does.
 *
 * As in Windows, a menu is modal. The loop takes the program's messages
 * itself until the menu closes: the mouse and the keys drive the menu, and
 * everything else -- timers, paints -- is dispatched to its window as the
 * program's own loop would. When an item is chosen, its command is sent once
 * the menu is closed: `WM_COMMAND`, or `WM_SYSCOMMAND` from the system menu.
 *
 * How the menu is drawn open is measured (see `menus.ts`); how it is driven
 * from the keyboard, as far as `WM_MENUSELECT` and Escape, is `altchild`'s;
 * from the mouse, not yet. Where a submenu opens, and how a menu that would
 * leave the screen is moved, are this implementation's.
 */

export const SC_SIZE = 0xf000;
export const SC_MOVE = 0xf010;
export const SC_MINIMIZE = 0xf020;
export const SC_MAXIMIZE = 0xf030;
export const SC_NEXTWINDOW = 0xf040;
export const SC_CLOSE = 0xf060;
export const SC_KEYMENU = 0xf100;
export const SC_RESTORE = 0xf120;
export const SC_TASKLIST = 0xf130;

const WS_CHILD = 0x40000000;
const WS_CAPTION = 0x00c00000;
const WS_DLGFRAME = 0x00400000;
const WS_EX_DLGMODALFRAME = 0x0001;
const WS_THICKFRAME = 0x00040000;
const WS_MINIMIZEBOX = 0x00020000;
const WS_MAXIMIZEBOX = 0x00010000;

const WM_ENTERIDLE = 0x0121;
const WM_MENUCHAR = 0x0120;
const WS_SYSMENU = 0x00080000;
const HTSYSMENU = 3;

/** `MF_MOUSESELECT`, in `WM_MENUSELECT` of a menu the mouse started. */
const MF_MOUSESELECT = 0x8000;

/** `WM_MENUCHAR`'s answers, in its high word. */
const MC_CLOSE = 1;
const MC_EXECUTE = 2;
const MC_SELECT = 3;

const MF_HILITE = 0x0080;
const MF_SYSMENU = 0x2000;

const VK_RETURN = 0x0d;
const VK_MENU = 0x12;
const VK_ESCAPE = 0x1b;
const VK_LEFT = 0x25;
const VK_UP = 0x26;
const VK_RIGHT = 0x27;
const VK_DOWN = 0x28;
const VK_F10 = 0x79;

/** Which of USER's two system menus a window's is made from: its menu resources 1 and 2. */
export type SystemMenuKind = 'standard' | 'document';

/** The system menus made as an MDI document window's. */
const documentMenus = new WeakSet<MenuData>();

/**
 * One of USER's system menus loaded afresh, as its resource has it: the
 * standard one, or an MDI document window's, with Minimize grayed as it
 * comes, Close with Ctrl+F4, and Next in place of Switch To (`mdisys`).
 */
function loadSystemMenu(kind: SystemMenuKind) {
  const menu = new MenuData();
  const add = (id: number, text: string | null, flags = 0) =>
    menu.items.push({ flags: separated(flags | (text === null ? MF_SEPARATOR : 0)), id, text });

  add(SC_RESTORE, '&Restore');
  add(SC_MOVE, '&Move');
  add(SC_SIZE, '&Size');
  add(SC_MINIMIZE, 'Mi&nimize', kind === 'document' ? MF_GRAYED : 0);
  add(SC_MAXIMIZE, 'Ma&ximize');
  add(0, null);
  add(SC_CLOSE, kind === 'document' ? '&Close\tCtrl+F4' : '&Close\tAlt+F4');
  add(0, null);

  if (kind === 'document') {
    add(SC_NEXTWINDOW, 'Nex&t\tCtrl+F6');
    documentMenus.add(menu);
  } else {
    add(SC_TASKLIST, 'S&witch To...\tCtrl+Esc');
  }

  return menu;
}

/**
 * A window given a system menu of its own, loaded afresh, as USER gives an
 * MDI document window its kind at its making (`USER.EXE` seg15 `0e48`-`0e5b`,
 * `0f62`-`0f79`), unless it has one already.
 */
export function giveSystemMenu(window: DesktopWindow, kind: SystemMenuKind) {
  window.systemMenu ??= loadSystemMenu(kind);

  return window.systemMenu;
}

/**
 * A window's system menu as `GetSystemMenu` answers it: its own, made now from
 * the standard one if it has none, as USER loads it, nothing grayed (`USER.EXE`
 * seg9 `0f00`-`0f1e`; `menuenab`: Restore of a window that shows is not grayed
 * until the menu opens). A menu of that window's open goes on with the new one
 * (`0f21`-`0f41`; `altchild`).
 */
export function systemMenuOf(window: DesktopWindow) {
  return giveSystemMenu(window, 'standard');
}

/** The system menu USER keeps for every window that has none of its own, a desktop's by its screen. */
const defaultSystemMenus = new WeakMap<object, MenuData>();

/** The system menu a window shows: its own, or the one every window without shows (`USER.EXE` seg9 `0d6a`). */
export function displayedSystemMenu(window: DesktopWindow, screen: object) {
  if (window.systemMenu) {
    return window.systemMenu;
  }

  let shared = defaultSystemMenus.get(screen);

  if (!shared) {
    shared = loadSystemMenu('standard');
    defaultSystemMenus.set(screen, shared);
  }

  return shared;
}

/**
 * The system menu a window shows brought up to the window's state, as USER
 * brings it as a menu of the window starts and as an MDI document window is
 * sized (`USER.EXE` seg9 `0d8b`, from seg17 `01ac` and seg15 `1782`):
 * Restore grayed unless it is minimized or maximized; Minimize without its box
 * or minimized; Maximize without its box or maximized; Size without a thick
 * frame, minimized or maximized; Move only when maximized and a child, or as
 * large as the screen. A window with a dialog frame and no border, or
 * `WS_EX_DLGMODALFRAME`, has only Move brought up. USER also grays Move while a
 * state of its own holds (`[0E2h]` set and `[102h]` clear), not followed.
 */
export function systemMenuBroughtUp(
  window: DesktopWindow,
  screen: { width: number; height: number }
) {
  const menu = displayedSystemMenu(window, screen);
  const shared = !window.systemMenu;
  const style = window.style >>> 0;
  const dialogFrame =
    (style & WS_CAPTION) === WS_DLGFRAME || (window.exStyle & WS_EX_DLGMODALFRAME) !== 0;
  /* As wide and as high as the screen, as USER measures it against two sizes
   * of its own (`[988h]`, `[98Ch]`), taken here for the screen's. */
  const covers = window.width >= screen.width && window.height >= screen.height;
  let restore = true;
  let minimize = false;
  let maximize = false;
  let size = false;
  let moving = false;

  if (!(style & WS_MINIMIZEBOX)) {
    minimize = true;
  } else if (window.state === 'minimized') {
    restore = false;
    size = true;
    minimize = true;
  }

  if (!(style & WS_MAXIMIZEBOX)) {
    maximize = true;
  } else if (window.state === 'maximized') {
    restore = false;
    moving = (style & WS_CHILD) !== 0 || covers;
    size = true;
    maximize = true;
  }

  if (!(style & WS_THICKFRAME)) {
    size = true;
  }

  const grays: [number, boolean][] = [[SC_MOVE, moving]];

  /* The menu every window shows that has none of its own has Close and Switch
   * To enabled as well (`0ead`-`0ec4`). */
  if (shared) {
    grays.push([SC_CLOSE, false], [SC_TASKLIST, false]);
  }

  if (!dialogFrame) {
    grays.push(
      [SC_SIZE, size],
      [SC_MINIMIZE, minimize],
      [SC_MAXIMIZE, maximize],
      [SC_RESTORE, restore]
    );
  }

  for (const [id, grayed] of grays) {
    const found = menu.find(id, 0);

    if (found) {
      found.item.flags = (found.item.flags & ~(MF_GRAYED | MF_DISABLED)) | (grayed ? MF_GRAYED : 0);
    }
  }

  return menu;
}

/** Each system menu's holder. */
const holders = new WeakMap<MenuData, MenuData>();

/**
 * The menu that holds a window's system menu as its one item, a pop-up named
 * with a space, or a hyphen for an MDI document window's (USER's menu resources
 * 1 and 2): what `WM_INITMENU` names as the system menu of a window without a
 * menu bar opens, not the pop-up `GetSystemMenu` answers (`iconclk`,
 * `mdisys`). Each system menu has its own, as each is loaded with one.
 */
function systemMenuHolderOf(window: DesktopWindow, screen: object) {
  const menu = displayedSystemMenu(window, screen);
  let holder = holders.get(menu);

  if (!holder) {
    holder = new MenuData();
    holder.items.push({
      flags: MF_POPUP,
      id: 0,
      text: documentMenus.has(menu) ? '-' : ' ',
      popup: menu,
    });
    holders.set(menu, holder);
  }

  return holder;
}

/**
 * The release of a press the menu ended on, taken with it: its window is not
 * sent it, though it may lie there once the menu's command is done
 * (`iconclk`: an icon restored by a double click gets no `WM_NCLBUTTONUP`).
 * Waited for if the button is still down.
 */
async function takeRelease(system: any) {
  const released = (msg: any) =>
    msg?.message === User.WM_NCLBUTTONUP || msg?.message === User.WM_LBUTTONUP;

  for (;;) {
    for (const form of [User.WM_NCLBUTTONUP, User.WM_LBUTTONUP]) {
      const filter = { hwnd: 0, first: form, last: form };

      if (await nextMessage(system, { wait: false, filter })) {
        return;
      }
    }

    if (!(system.rasterInput?.buttons & 1)) {
      return;
    }

    const msg = await nextMessage(system);

    if (!msg || released(msg)) {
      return;
    }

    await dispatch(system, msg);
  }
}

/**
 * Where a menu starts: an item of the bar or the system menu, pressed; a
 * character, as `SC_KEYMENU` gives it, nought for Alt alone; or a pop-up at a
 * place.
 */
export type MenuStart =
  | { kind: 'bar'; index: number; keyboard: boolean; open: boolean }
  | { kind: 'system'; keyboard: boolean }
  | { kind: 'key'; character: number }
  | { kind: 'popup'; menu: MenuData; x: number; y: number };

interface Level {
  menu: MenuData;
  window: DesktopWindow;
}

/**
 * Runs a menu to its end, and sends its command. Returns the command chosen,
 * or 0.
 */
export async function trackMenu(system: any, hwnd: number, start: MenuStart) {
  const owner = system.handles.resolve(hwnd);

  if (!(owner instanceof RasterWindow)) {
    return 0;
  }

  const desktop = owner.desktop;
  const window = owner.window;
  const input = system.rasterInput;
  const windowClass = system.handles.retrieve(owner.options.windowClass);
  const send = (message: number, wParam: number, lParam: number) =>
    system.scheduler.callWndProc(windowClass, hwnd, message, wParam, lParam);

  /* The window's menu bar, unless it is a child or an icon, or its bar has no
   * items: then its menu is the system menu's holder (`USER.EXE` seg17
   * `01b1`-`01ec`; `mdisys`: a document window's `WM_INITMENU` names the
   * holder, a frame's its bar, its system menu opening or not). */
  const style = window.style >>> 0;
  const ownMenu =
    start.kind !== 'popup' &&
    !(style & WS_CHILD) &&
    window.state !== 'minimized' &&
    owner.options.menu
      ? system.handles.resolve(owner.options.menu)
      : null;
  const barMenu: MenuData | null =
    ownMenu instanceof MenuData && ownMenu.items.length ? ownMenu : null;
  /* Its window's menu is the system menu's holder, not a menu bar. */
  const systemMode = start.kind !== 'popup' && !barMenu;
  /* Started by the mouse: every `WM_MENUSELECT` says so with `MF_MOUSESELECT`
   * (`USER.EXE` seg10 `0029`-`0030`; `mdisys`). */
  const mouse = (start.kind === 'bar' || start.kind === 'system') && !start.keyboard;
  const mouseFlag = mouse ? MF_MOUSESELECT : 0;
  /* The holder whose item the system menu was last selected in, which keeps it highlighted. */
  let hilited: MenuData | null = null;
  /* Where the mouse last was, as the menu saw it. */
  let lastPoint: { x: number; y: number } | null = input
    ? { x: input.cursor.x, y: input.cursor.y }
    : null;
  const levels: Level[] = [];
  let bar = start.kind === 'bar' ? start.index : -1;
  let keyboard =
    start.kind === 'key' || ((start.kind === 'bar' || start.kind === 'system') && start.keyboard);
  let chosen = 0;
  /* Whether a pop-up was put up. */
  let opened = false;
  let fromSystem = start.kind === 'system';
  let done = false;

  const top = () => levels[levels.length - 1];
  const selected = () => top()?.window.popup?.selected ?? -1;

  const select = async (index: number) => {
    const level = top();

    if (!level || level.window.popup!.selected === index) {
      return;
    }

    level.window.popup!.selected = index;
    desktop.paintPopup(level.window);

    const item = level.menu.items[index];

    if (item) {
      await menuSelect(item, level.menu);
    }
  };

  /**
   * `WM_MENUSELECT` for an item selected: a pop-up's handle or the item's
   * id, its flags as it has them, highlighted, and `MF_SYSMENU` in the
   * system menu, with the menu it is in (`USER.EXE` seg10 `0000`-`0091`:
   * the flags masked with `5fff`, `MF_SYSMENU` added while the system menu
   * is tracked; `altchild`: `90` for File selected on the bar, `80` for
   * its first item, `2090` and `2080` for the system menu and its first).
   */
  const menuSelect = async (item: any, menu: MenuData, flags = MF_HILITE) => {
    await send(
      User.WM_MENUSELECT,
      item.popup ? handleOf(system, item.popup) : item.id,
      (((item.flags | (item.popup ? MF_POPUP : 0) | flags) & 0x5fff) |
        (fromSystem ? MF_SYSMENU : 0) |
        mouseFlag |
        (handleOf(system, menu) << 16)) >>>
        0
    );
  };

  /** The bar's item selected, nothing below it open: `WM_MENUSELECT` for it (`altchild`). */
  const selectBar = async (index: number) => {
    const item = barMenu?.items[index];

    if (item) {
      await menuSelect(item, barMenu!);
    }
  };

  const open = async (menu: MenuData, x: number, y: number, index: number, isSystem: boolean) => {
    await send(
      User.WM_INITMENUPOPUP,
      handleOf(system, menu),
      (index & 0xffff) | (isSystem ? 1 << 16 : 0)
    );

    const popup = desktop.openPopup(menu, x, y, -1);

    opened = true;

    /* Kept on the screen: moved left, or up, as far as it has to be. */
    const left = Math.max(0, Math.min(popup.left, desktop.screen.width - popup.width));
    const topEdge = Math.max(0, Math.min(popup.top, desktop.screen.height - popup.height));

    if (left !== popup.left || topEdge !== popup.top) {
      desktop.destroy(popup);
      levels.push({ menu, window: desktop.openPopup(menu, left, topEdge, -1) });
    } else {
      levels.push({ menu, window: popup });
    }

    if (keyboard) {
      await select(firstSelectable(menu, -1, 1));
    }
  };

  /* Each pop-up closed as `SetWindowPos` hides a window: what it covered,
   * if its bits could not be put back, and whatever else is due an erase,
   * drawn at once (`menuinv`). */
  const closeTo = async (depth: number) => {
    while (levels.length > depth) {
      desktop.destroy(levels.pop()!.window);
      await eraseDue(system);
    }
  };

  const openBar = async (index: number) => {
    const already = window.menuSelected === index;

    await closeTo(0);
    bar = index;
    window.menuSelected = index;
    desktop.paintFrame(window);

    /* The item selected on the bar first, unless it was already
     * (`altchild`: Alt and F is File selected, then opened; Alt alone,
     * then F, opens the File already selected). */
    if (!already) {
      await selectBar(index);
    }

    const item = barMenu?.items[index];

    if (item?.popup) {
      const place = desktop.menuBarItems(window)[index];

      await open(item.popup, place.left, place.bottom, index, false);
    }
  };

  const openSystem = async () => {
    await closeTo(0);
    bar = -1;
    window.menuSelected = undefined;
    window.systemMenuOpen = true;
    fromSystem = true;
    desktop.paintFrame(window);

    /* The system menu selected as the item of its holder, its pop-up the one
     * the window shows, `2090` -- not when it is an icon's (`mdisys`: a
     * document window's Alt and hyphen selects it, its icon's click does
     * not). It shows the window's own, if it has one, else the one every
     * window without shows, whose handle is not one `GetSystemMenu` answers
     * (`altchild`, which asks for the window's own only as it is told). */
    if (window.state !== 'minimized') {
      await selectSystem();
    }

    const place = desktop.systemMenuPlace(window);

    await open(displayedSystemMenu(window, desktop.screen), place.x, place.y, 0, true);
  };

  /**
   * `WM_MENUSELECT` for the system menu as its holder's item: the pop-up the
   * window shows, `MF_SYSMENU` and `MF_POPUP`, and `MF_HILITE` while the
   * holder is the one it was selected in -- a holder put in its place by
   * `GetSystemMenu` meanwhile has it not (`altchild`: `2010` after Escape;
   * `mdisys`: `2090`). Selecting it highlights it.
   */
  const selectSystem = async () => {
    hilited = systemMenuHolderOf(window, desktop.screen);
    await reselectSystem();
  };

  const reselectSystem = async () => {
    const holder = systemMenuHolderOf(window, desktop.screen);

    await send(
      User.WM_MENUSELECT,
      handleOf(system, displayedSystemMenu(window, desktop.screen)),
      (MF_SYSMENU |
        MF_POPUP |
        (hilited === holder ? MF_HILITE : 0) |
        mouseFlag |
        (handleOf(system, holder) << 16)) >>>
        0
    );
  };

  /** An item chosen: a pop-up opens, a grayed item does nothing, anything else is the command. */
  const choose = async (index: number) => {
    const level = top();
    const item = level?.menu.items[index];

    if (!item || item.flags & MF_SEPARATOR) {
      return;
    }

    if (item.popup) {
      const place = desktop.popupPlaces(level.window)[index];

      await select(index);
      await open(
        item.popup,
        level.window.left + level.window.width - 2,
        level.window.top + place.top - 1,
        index,
        false
      );
      return;
    }

    if (!(item.flags & (MF_GRAYED | MF_DISABLED))) {
      chosen = item.id;
    }

    done = true;
  };

  /* Into the menu. */
  const previousCapture = input?.capture ?? null;
  const previousKind = input?.captureKind ?? 'set';

  /* The mouse taken as a menu takes it (`USER.EXE` seg17 `0188`-`0194`): its
   * messages in their client form, at the point on the screen, and a press
   * twice a double click whatever the class says. */
  if (input) {
    input.capture = window;
    input.captureKind = 'menu';
  }

  desktop.menuOwner = window;
  desktop.menuCancelled = false;

  /* The mouse taken, the window asked for the cursor as over its caption,
   * with no mouse message: the arrow, from `DefWindowProc` (`USER.EXE` seg17
   * `0199`; `titledis`, `curerr`). */
  await send(WM_SETCURSOR, hwnd, HTCAPTION);

  /* The window's system menu brought up to its state as the menu starts, and
   * `WM_INITMENU` naming the window's menu: its bar, or the system menu's
   * holder (`USER.EXE` seg17 `01ac`, `0212`; `mdisys`). */
  if (start.kind !== 'popup') {
    systemMenuBroughtUp(window, desktop.screen);
    await send(
      User.WM_INITMENU,
      handleOf(system, barMenu ?? systemMenuHolderOf(window, desktop.screen)),
      0
    );
  }

  if (start.kind === 'bar') {
    if (start.open) {
      await openBar(start.index);
    } else {
      window.menuSelected = start.index;
      desktop.paintFrame(window);
      await selectBar(start.index);
    }
  } else if (start.kind === 'system') {
    await openSystem();
  } else if (start.kind === 'key') {
    await firstKey(start.character);
  } else {
    /* Put up with no button down, the menu is driven from the keyboard, its
     * first item selected: the `menus` probe's pop-up, shown by a program
     * with the mouse at rest, has it. */
    keyboard = !(input?.buttons ?? 0);

    /* `TrackPopupMenu`'s menu is named in `WM_INITMENU` too, as a menu
     * starts (`USER.EXE` seg17 `0213`; `curerr`). */
    await send(User.WM_INITMENU, handleOf(system, start.menu), 0);
    await open(start.menu, start.x, start.y, 0, false);
  }

  /* The message filters are told of the menu, as a `WM_MENUSELECT`, as it
   * starts and as it ends: `hooks` recorded one each side of its messages. */
  await messageFilter(system, { hwnd, message: User.WM_MENUSELECT }, MSGF_MENU);

  while (!done && !desktop.menuCancelled) {
    let msg = await nextMessage(system, { wait: false });

    /* Nothing waiting: its window is told the menu is idle, and may end it
     * with `WM_CANCELMODE` (`iconclk`). */
    if (!msg) {
      await send(WM_ENTERIDLE, MSGF_MENU, top()?.window.hwnd ?? 0);

      if (desktop.menuCancelled) {
        break;
      }

      msg = await nextMessage(system);
    }

    if (!msg) {
      break;
    }

    /* An icon's system menu, the icon clicked twice: the window restored
     * (`iconclk`). */
    if (
      (msg.message === User.WM_NCLBUTTONDBLCLK || msg.message === User.WM_LBUTTONDBLCLK) &&
      fromSystem &&
      window.state === 'minimized' &&
      msg.hwnd === hwnd
    ) {
      chosen = SC_RESTORE;
      done = true;
      await takeRelease(system);
      continue;
    }

    /* The message filters first: one that takes the message ends it. */
    if (await messageFilter(system, msg, MSGF_MENU)) {
      continue;
    }

    if (msg.message === User.WM_KEYDOWN || msg.message === User.WM_SYSKEYDOWN) {
      keyboard = true;
      await key(msg.wParam);
      continue;
    }

    /* The pointer, in either form: the page posts each mouse event as it
     * happens, hit-tested then, so what came before this loop took the
     * capture -- the release of the press that opened the menu -- is still
     * the non-client message it was posted as. Windows hit-tests when a
     * message is taken, and has no such case. */
    const pointed = clientForm(msg.message);

    if (
      pointed === User.WM_MOUSEMOVE ||
      pointed === User.WM_LBUTTONDOWN ||
      pointed === User.WM_LBUTTONUP ||
      pointed === User.WM_RBUTTONDOWN ||
      pointed === User.WM_RBUTTONUP
    ) {
      keyboard = false;
      await pointer(msg, pointed);
      continue;
    }

    if (
      msg.message === User.WM_KEYUP ||
      msg.message === User.WM_SYSKEYUP ||
      msg.message === User.WM_CHAR ||
      msg.message === User.WM_SYSCHAR
    ) {
      continue;
    }

    await dispatch(system, msg);
  }

  await messageFilter(system, { hwnd, message: User.WM_MENUSELECT }, MSGF_MENU);

  /* Out of it: everything it opened closed, its window drawn as it was. */
  await closeTo(0);
  window.menuSelected = undefined;
  window.systemMenuOpen = false;
  desktop.menuOwner = null;
  desktop.paintFrame(window);

  if (input) {
    input.capture = previousCapture;
    input.captureKind = previousKind;

    /* A pop-up gone from the screen is a window hidden: USER makes the
     * mouse move where it is, and the window under it hears of it
     * (`curerr`; `mouse-input`). */
    if (opened) {
      input.nudge();
    }
  }

  await send(User.WM_MENUSELECT, 0, 0xffff);

  /* The command chosen: posted to the window, from its bar or its system menu,
   * as `WM_COMMAND` or `WM_SYSCOMMAND`; sent, from `TrackPopupMenu`'s
   * (`USER.EXE` seg10 `11b0`-`11f4`; `mdisys`: the frame takes `WM_COMMAND`
   * from its queue). */
  if (chosen) {
    const command = fromSystem ? User.WM_SYSCOMMAND : User.WM_COMMAND;

    if (start.kind === 'popup') {
      await send(command, chosen, 0);
    } else {
      postMessage(system, hwnd, command, chosen, 0);
    }
  }

  return chosen;

  async function key(code: number) {
    const level = top();

    switch (code) {
      /* A pop-up closed, back to what opened it; from the bar, or the
       * system menu Alt+Space opened, the menu stays with that selected,
       * told so again, until a second Escape ends it (`altchild`: File's
       * `90` again; the system menu as `GetSystemMenu` answers it, `2010`). */
      case VK_ESCAPE:
        if (
          levels.length > 1 ||
          (levels.length === 1 &&
            (start.kind === 'bar' ||
              start.kind === 'key' ||
              (start.kind === 'system' && start.keyboard)))
        ) {
          await closeTo(levels.length - 1);

          if (!levels.length && fromSystem) {
            await reselectSystem();
          } else if (!levels.length) {
            await selectBar(bar);
          }
        } else {
          done = true;
        }
        return;

      case VK_MENU:
      case VK_F10:
        done = true;
        return;

      case VK_DOWN:
      case VK_UP:
        if (!level && bar >= 0) {
          await openBar(bar);
          return;
        }

        if (!level && fromSystem) {
          await openSystem();
          return;
        }

        if (level) {
          await select(firstSelectable(level.menu, selected(), code === VK_DOWN ? 1 : -1));
        }
        return;

      case VK_RIGHT:
      case VK_LEFT: {
        const item = level?.menu.items[selected()];

        if (code === VK_RIGHT && item?.popup) {
          await choose(selected());
          return;
        }

        if (code === VK_LEFT && levels.length > 1) {
          await closeTo(levels.length - 1);
          return;
        }

        if (barMenu && barMenu.items.length) {
          const count = barMenu.items.length;
          const next = ((bar < 0 ? 0 : bar) + (code === VK_RIGHT ? 1 : -1) + count) % count;
          const wasOpen = levels.length > 0;

          window.systemMenuOpen = false;
          fromSystem = false;

          if (wasOpen) {
            await openBar(next);
          } else {
            bar = next;
            window.menuSelected = next;
            desktop.paintFrame(window);
            await selectBar(next);
          }
        }
        return;
      }

      case VK_RETURN:
        if (level) {
          await choose(selected());
        } else if (bar >= 0) {
          await openBar(bar);
        } else if (fromSystem) {
          await openSystem();
        }
        return;
    }

    await letter(code);
  }

  /**
   * The character `SC_KEYMENU` started the menu with (`USER.EXE` seg19
   * `04fb`): nought selects the bar's first item; a space opens the system
   * menu, and so does a hyphen in a child, an MDI document window; anything
   * else is a letter of the bar, or of the holder.
   */
  async function firstKey(character: number) {
    if (!character) {
      if (barMenu) {
        bar = 0;
        window.menuSelected = 0;
        desktop.paintFrame(window);
        await selectBar(0);
      } else {
        done = true;
      }
      return;
    }

    if (character === 0x20 || (character === 0x2d && style & WS_CHILD)) {
      if (window.style & WS_SYSMENU) {
        await openSystem();
      } else {
        done = true;
      }
      return;
    }

    await letter(character);

    /* Nothing selected by it: the menu ends (`05c2`-`05e2`). */
    if (!levels.length && bar < 0 && !fromSystem) {
      done = true;
    }
  }

  /**
   * A letter: the item of the menu open, or of the bar, whose mnemonic it is;
   * else the window is asked with `WM_MENUCHAR`, its character, the flags --
   * `MF_SYSMENU` when its menu is the system menu's holder, `MF_POPUP` for
   * `TrackPopupMenu`'s -- and the menu (seg10 `0409`, `053f`-`0591`; `mdisys`:
   * a document window's letter is `2000` and its holder, a frame's hyphen `0`
   * and its bar).
   */
  async function letter(code: number) {
    const level = top();
    const menu = level ? level.menu : (barMenu ?? systemMenuHolderOf(window, desktop.screen));
    const wanted = String.fromCharCode(code).toUpperCase();
    const index = menu.items.findIndex(
      (item) => mnemonic(item.text) === wanted && !(item.flags & MF_SEPARATOR)
    );

    if (index >= 0) {
      await takeItem(!!level, index, true);
      return;
    }

    const flags = (systemMode ? MF_SYSMENU : 0) | (start.kind === 'popup' ? MF_POPUP : 0);
    const answer =
      (await send(WM_MENUCHAR, code, (flags | (handleOf(system, menu) << 16)) >>> 0)) >>> 0;
    const item = answer & 0xffff;

    switch (answer >>> 16) {
      /* Closed: the menu ends at once, told twice (`0585`, `05d9`). */
      case MC_CLOSE:
        await send(User.WM_MENUSELECT, 0, 0xffff);
        done = true;
        break;
      case MC_EXECUTE:
        await takeItem(!!level, item, true);
        break;
      case MC_SELECT:
        await takeItem(!!level, item, false);
        break;
      /* Nought: USER beeps, not followed; the menu stays. */
    }
  }

  /**
   * An item a key named: in a pop-up, selected, and chosen if `execute`; on
   * the bar, opened, or selected only; in the holder, the system menu opened.
   */
  async function takeItem(inPopup: boolean, index: number, execute: boolean) {
    if (inPopup) {
      await select(index);

      if (execute) {
        await choose(index);
      }
      return;
    }

    if (!barMenu) {
      await openSystem();
      return;
    }

    if (execute) {
      if (barMenu.items[index]?.popup) {
        await openBar(index);
      } else {
        chooseBar(index);
      }
    } else {
      bar = index;
      window.menuSelected = index;
      desktop.paintFrame(window);
      await selectBar(index);
    }
  }

  /** An item of the bar that opens nothing, chosen: its command, unless it is grayed. */
  function chooseBar(index: number) {
    const item = barMenu?.items[index];

    if (item && !(item.flags & (MF_GRAYED | MF_DISABLED | MF_SEPARATOR))) {
      chosen = item.id;
    }

    done = true;
  }

  /**
   * The first item of the one pop-up open selected, as letting go of the
   * button where it was pressed to open it does (`mdisys`: `f120/a080` after
   * the system menu box is clicked, `f120/8080` after the bar).
   */
  async function selectFirst() {
    const level = top();

    if (level && selected() < 0) {
      await select(firstSelectable(level.menu, -1, 1));
    }
  }

  async function pointer(msg: any, message: number) {
    const x = msg.pt.x;
    const y = msg.pt.y;

    /* The mouse moved nowhere: nothing (`mdisys`: an icon's system menu, put
     * up over the point its click let go at, keeps its first item selected). */
    if (message === User.WM_MOUSEMOVE && lastPoint && lastPoint.x === x && lastPoint.y === y) {
      return;
    }

    lastPoint = { x, y };

    /* Over an open pop-up, the deepest first. */
    for (let depth = levels.length - 1; depth >= 0; depth--) {
      const level = levels[depth];
      const inside =
        x >= level.window.left &&
        y >= level.window.top &&
        x < level.window.left + level.window.width - 1 &&
        y < level.window.top + level.window.height - 1;

      if (!inside) {
        continue;
      }

      await closeTo(depth + 1);

      const places = desktop.popupPlaces(level.window);
      const index = places.findIndex(
        (place) =>
          y - level.window.top >= place.top && y - level.window.top < place.top + place.height
      );

      if (index >= 0 && !(level.menu.items[index].flags & MF_SEPARATOR)) {
        await select(index);

        if (message === User.WM_LBUTTONUP) {
          await choose(index);
        }
      }

      return;
    }

    /* Over the menu bar. */
    if (barMenu) {
      const index = desktop
        .menuBarItems(window)
        .findIndex((item) => x >= item.left && x < item.right && y >= item.top && y < item.bottom);

      if (index >= 0) {
        if (index !== bar || (message === User.WM_LBUTTONDOWN && !levels.length)) {
          await openBar(index);
        } else if (message === User.WM_LBUTTONDOWN && levels.length) {
          done = true;
        } else if (message === User.WM_LBUTTONUP && !levels.length) {
          /* Let go on an item that opens nothing: chosen (`mdisys`: the
           * restore box of a maximized document window). */
          chooseBar(index);
        } else if (message === User.WM_LBUTTONUP && levels.length === 1) {
          await selectFirst();
        }

        return;
      }
    }

    /* Let go on the system menu box whose menu is open: its first item selected (`mdisys`). */
    if (
      message === User.WM_LBUTTONUP &&
      fromSystem &&
      levels.length === 1 &&
      hitTest(desktop, window, x, y) === HTSYSMENU
    ) {
      await selectFirst();
      return;
    }

    /* Anywhere else, a press closes the menu. */
    if (message === User.WM_LBUTTONDOWN || message === User.WM_RBUTTONDOWN) {
      done = true;
    }
  }
}

/** A non-client mouse message as the client-area one it stands for here; any other as itself. */
function clientForm(message: number) {
  switch (message) {
    case User.WM_NCMOUSEMOVE:
      return User.WM_MOUSEMOVE;
    case User.WM_NCLBUTTONDOWN:
      return User.WM_LBUTTONDOWN;
    case User.WM_NCLBUTTONUP:
      return User.WM_LBUTTONUP;
    case User.WM_NCRBUTTONDOWN:
      return User.WM_RBUTTONDOWN;
    case User.WM_NCRBUTTONUP:
      return User.WM_RBUTTONUP;
  }

  return message;
}

/** The next item from `from` in a direction that is not a separator, wrapping. */
function firstSelectable(menu: MenuData, from: number, step: number) {
  const count = menu.items.length;

  for (let tried = 1; tried <= count; tried++) {
    const index = (((from + step * tried) % count) + count) % count;

    if (!(menu.items[index].flags & MF_SEPARATOR)) {
      return index;
    }
  }

  return -1;
}

/** The letter after an item's `&`, upper case. */
function mnemonic(text: string | null) {
  const at = (text ?? '').indexOf('&');

  return at >= 0 && at + 1 < (text ?? '').length ? text![at + 1].toUpperCase() : '';
}

/** A message the menu does not take, sent on to its window's procedure. */
async function dispatch(system: any, msg: any) {
  const target = system.handles.resolve(msg.hwnd);

  if (!target) {
    return;
  }

  const windowClass = system.handles.retrieve(target.options.windowClass);

  await system.scheduler.callWndProc(windowClass, msg.hwnd, msg.message, msg.wParam, msg.lParam);
}
