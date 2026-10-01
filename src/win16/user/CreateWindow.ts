'use strict';

import { leastSize, minimizeToBottom, minMaxInfo, notifySize, showRaster } from './window-state.js';

import { GetSystemMetrics } from './GetSystemMetrics.js';
import { segmentSelector } from '../selectors.js';
import { callHooks, HSHELL_WINDOWCREATED, WH_SHELL } from './hooks.js';
import { NULL } from '../consts.js';

import { User, CREATESTRUCT, NCCALCSIZE_PARAMS, RECT, WINDOWPOS } from '../user.js';

import { MenuData } from './menu-data.js';
import { controlState, systemClass } from './control-classes.js';
import { CONTROL_CLASSES, controlRect } from './controls.js';
import { initCombo, initList } from './control-classes.js';
import { createEditBuffer } from './edit-buffer.js';
import { mdiClientClass } from './mdi.js';
import { iconOf } from './icon-block.js';
import { LoadIcon, standardIcon } from './icon-api.js';
import { GlobalAlloc } from '../kernel/GlobalAlloc.js';
import { GlobalLock } from '../kernel/GlobalLock.js';
import { GlobalFree } from '../kernel/GlobalFree.js';
import { RasterWindow } from './raster-window.js';

/**
 * The **InitApp** function creates the application queue and installs
 * application-support routines such as the signal procedure, version-
 * specific resource loaders, and the divide-by-zero interrupt routine.
 *
 * (Our system emulation does not need to really do anything for this)
 *
 * @static
 * @function CreateWindow
 * @memberof User
 *
 * @returns {Types.HWND} The return value is the handle of the new window if
 *                       the function is successful. Otherwise, it is NULL.
 */
/** A modal frame, as a dialog with `DS_MODALFRAME` has. */
const WS_EX_DLGMODALFRAME = 0x0001;

export async function CreateWindow(
  lpszClassName,
  lpszWindowName,
  dwStyle,
  x,
  y,
  nWidth,
  nHeight,
  hwndParent,
  hmenu,
  hinst,
  lpvParam,
  dwExStyle = 0
) {
  // Look up the parent (if NULL, the window is a top-level one)
  let parentWindow = null;

  if (hwndParent != NULL) {
    parentWindow = this.handles.resolve(hwndParent);

    // Error if the parent window is not known
    if (!parentWindow) {
      return NULL;
    }
  }

  /* A window is USER's own, drawn on the raster desktop. Without one -- no
   * Windows installation to draw it with -- there is no window. */
  const raster = this.rasterDesktop;

  if (!raster) {
    return NULL;
  }

  const child = (dwStyle & User.WS_CHILD) !== 0 && parentWindow instanceof RasterWindow;
  const parent = child ? parentWindow.window : null;
  const className = String(lpszClassName);
  const control = CONTROL_CLASSES.has(className.toUpperCase());

  /* A class nobody registered makes no window, as Windows answers: the
   * combo box is one of USER's own not done yet. A window made anyway had
   * no procedure to paint it, and was due to be painted for ever. */
  /* USER's own `MDIClient` class, registered when first asked for. */
  if (className.toUpperCase() === 'MDICLIENT' && !this.handles.retrieve(lpszClassName)) {
    mdiClientClass(this, className);
  }

  if (!control && !this.handles.retrieve(lpszClassName)) {
    console.log('CANNOT FIND WINDOW CLASS', className);
    return NULL;
  }

  /* A child's place is in its parent's client area; a control's rectangle
   * may be its own. A child's `hmenu` is its identifier, not a menu. */
  const rect = control
    ? controlRect(className.toUpperCase(), dwStyle, x, y, nWidth, nHeight)
    : { x, y, width: nWidth, height: nHeight };
  /* A top-level window's menu is the one it was given, or its class's. */
  const menuHandle = child ? 0 : hmenu || (this.handles.retrieve(lpszClassName)?._menuHandle ?? 0);
  const menu = menuHandle ? this.handles.resolve(menuHandle) : null;

  /* An edit control takes `WS_BORDER` out of its style and draws the
   * border inside its client area itself (`USER.EXE` seg27 `013e`), so its
   * client area is all of it. */
  const editBorder = className.toUpperCase() === 'EDIT' && (dwStyle & User.WS_BORDER) !== 0;

  if (editBorder) {
    dwStyle &= ~User.WS_BORDER;
  }

  /* The style as the program asked for it, which `CREATESTRUCT` carries
   * (`showseq`), before USER adds its own. */
  const asked = dwStyle >>> 0;

  /* A window that is not a child is kept from drawing over its siblings:
   * USER adds `WS_CLIPSIBLINGS` to its style (`hidwnd`). */
  if (!(dwStyle & User.WS_CHILD)) {
    dwStyle |= WS_CLIPSIBLINGS;
  }

  /* An overlapped window -- neither a child nor a pop-up -- always has a
   * caption, and so a border, whatever it asked for (`ovlstyle`): Jewel
   * Thief of the corpus asks for a system menu and a minimize box alone. */
  if (!(dwStyle & (User.WS_CHILD | WS_POPUP))) {
    dwStyle |= WS_CAPTION;
  }

  /* CW_USEDEFAULT for a window at the top that is not a pop-up: its place
   * the next step of a cascade from the screen's corner, and its size to the
   * screen's right edge less a frame and down to where icons are laid out.
   * **Recorded** by `usedef` on the VGA and the EGA: (0,0), then 22 across
   * and 22 down on the VGA, 20 on the EGA, reaching (636, 408) and
   * (636, 284). The step fits `SM_CXSIZE` and `SM_CYSIZE` with a frame each;
   * `SM_CYCAPTION` and two borders fits the downward one too. A pop-up is
   * put at nought, nought big. */
  if (!child && !(dwStyle & User.WS_CHILD)) {
    const metric = (index: number) => GetSystemMetrics.call(this, index);

    if (dwStyle & User.WS_POPUP) {
      if (unset(rect.x)) {
        rect.x = 0;
        rect.y = 0;
      }

      if (unset(rect.width)) {
        rect.width = 0;
        rect.height = 0;
      }
    } else {
      if (unset(rect.x)) {
        const step = this._cascadeStep ?? 0;

        rect.x = step * (metric(SM_CXSIZE) + metric(SM_CXFRAME));
        rect.y = step * (metric(SM_CYSIZE) + metric(SM_CYFRAME));
        this._cascadeStep = step + 1;
      }

      if (unset(rect.width)) {
        rect.width = metric(SM_CXSCREEN) - metric(SM_CXFRAME) - rect.x;
        rect.height = metric(SM_CYSCREEN) - metric(SM_CYICONSPACING) - rect.y;
      }

      /* No smaller than `SM_CXMIN` by `SM_CYMIN` (`minsize`). */
      [rect.width, rect.height] = leastSize(this, dwStyle, rect.width, rect.height, false);
    }
  }

  const shown = raster.create(
    unset(rect.x) ? 0 : rect.x + (parent ? parent.left + parent.client.left : 0),
    unset(rect.x) ? 0 : rect.y + (parent ? parent.top + parent.client.top : 0),
    unset(rect.width) ? 0 : rect.width,
    unset(rect.width) ? 0 : rect.height,
    dwStyle,
    lpszWindowName ? String(lpszWindowName) : '',
    menu instanceof MenuData ? menu.labels : undefined,
    null,
    parent
  );

  if (menu instanceof MenuData) {
    shown.menuGrayed = menu.grayed;
  }

  /* The extended style, from `CreateWindowEx`, as the window is made: a
   * modal frame -- what a dialog's `DS_MODALFRAME` asks for -- is drawn and
   * sized as a dialog's is. Delphi makes its dialog forms so, and Windows
   * shows Championship Slots' Program Usage box in one. */
  shown.exStyle = dwExStyle >>> 0;

  if (dwExStyle & WS_EX_DLGMODALFRAME) {
    shown.modalFrame = true;
    raster.place(shown, shown.left, shown.top, shown.width, shown.height);
  }

  /* A window at the top given a parent is owned, by the window at the top
   * the parent is in (`owners`). */
  if (!child && parentWindow instanceof RasterWindow) {
    let top = parentWindow.window;

    while (top.parent) {
      top = top.parent;
    }

    shown.owner = top;
  }

  if (control) {
    systemClass(this, className);
    shown.control = controlState(className, dwStyle, lpszWindowName ? String(lpszWindowName) : '');

    if (editBorder) {
      shown.control.border = true;
    }

    /* A static with `SS_ICON` loads the icon its text names: its
     * instance's, else the display driver's standard one; and it is the
     * icon's size, wherever its template put it (`USER.EXE` seg25
     * `23d8`). Its text is then nothing. */
    if (className.toUpperCase() === 'STATIC' && (dwStyle & 0x7f) === 3) {
      const name = String(lpszWindowName ?? '');
      const id = /^#\d+$/.test(name) ? Number(name.slice(1)) : name;
      const block =
        (hinst ? await LoadIcon.call(this, hinst, id) : 0) || (await LoadIcon.call(this, 0, id));

      shown.control.icon = block ? iconOf(this, block) : null;
      shown.control.iconHandle = block;
      shown.control.text = '';
      shown.title = '';
      raster.place(
        shown,
        shown.left,
        shown.top,
        raster.environment.metric(11),
        raster.environment.metric(12)
      );
    }
  }

  if (child) {
    shown.controlId = hmenu & 0xffff;
  }

  const dialog: any = new RasterWindow(raster, shown, {
    menu: menu instanceof MenuData ? menuHandle : 0,
    caption: lpszWindowName,
    timesShown: 0,
    windowClass: lpszClassName,
  });

  const windowClass = this.handles.retrieve(lpszClassName);
  const hWnd = this.handles.allocate(dialog);
  console.log('CREATED WINDOW', hWnd);

  dialog.window.hwnd = hWnd;

  /* The class's icon is what the window shows minimized. */
  const icon = windowClass?.hIcon
    ? (standardIcon(this, windowClass.hIcon) ?? iconOf(this, windowClass.hIcon))
    : null;

  dialog.window.icon = icon?.xor ? icon : null;

  const taskHandle = this.scheduler.active;
  const task = this.handles.resolve(taskHandle);

  this.windows.register(taskHandle, task, hWnd, dialog);

  const createstruct = new CREATESTRUCT();
  createstruct.lpCreateParams = lpvParam;
  /* A window made with no instance is the program's own: USER keeps the
   * calling program's instance, its data segment less one, and calls the
   * window's procedure with that data (`nullinst`). The recording cannot
   * tell it from the class's instance, which was the same there. */
  createstruct.hInstance = hinst || programInstance(this);
  createstruct.hwndParent = hwndParent;
  createstruct.hMenu = hmenu;
  /* The place USER chose for a default one; the size as it was asked for,
   * CW_USEDEFAULT and all, but for a pop-up's, nought (`usedef`). */
  const popup = !child && (dwStyle & User.WS_POPUP) !== 0;

  createstruct.cy = popup ? rect.height : nHeight;
  createstruct.cx = popup ? rect.width : nWidth;
  createstruct.x = child ? x : rect.x;
  createstruct.y = child ? y : rect.y;
  createstruct.style = asked;
  if (lpszWindowName === null || lpszWindowName === undefined) {
    createstruct.lpszName = 0;
  } else if (lpszWindowName.segment !== undefined) {
    createstruct.lpszName = ((lpszWindowName.segment << 16) | lpszWindowName.offset) >>> 0;
  } else {
    /* A name USER itself gave -- a dialog item's text from its template --
     * which on Windows points into the template, empty or not: a program may
     * read it in `WM_CREATE`, as Media Player hands its control's back to
     * `SetWindowText`. Here the text is copied into a block of its own, freed
     * with the window. */
    createstruct.lpszName = nameInMemory(this, dialog, String(lpszWindowName));
  }
  createstruct.lpszClass = (lpszClassName.segment << 16) | lpszClassName.offset;
  createstruct.dwExStyle = dwExStyle >>> 0;

  dialog._createStruct = createstruct;

  /* What a window is sent as it is made, **recorded** by `showseq`: an
   * overlapped window `WM_GETMINMAXINFO` first; then `WM_NCCREATE`,
   * `WM_NCCALCSIZE` with the window's rectangle on the screen, and
   * `WM_CREATE`. */
  const send = (message: number, wParam: number, lParam: any) =>
    this.scheduler.callWndProc(windowClass, hWnd, message, wParam, lParam);

  if (!(dwStyle & (User.WS_CHILD | WS_POPUP))) {
    await send(User.WM_GETMINMAXINFO, 0, [minMaxInfo(this, dwStyle)]);
  }

  /* `WM_NCCREATE` carries the `CREATESTRUCT` as `WM_CREATE` does. Answered
   * with nought, the window is not made: it is sent `WM_NCDESTROY` and
   * nothing more, and `CreateWindow` answers nought; its handle is free for
   * the next window made (`showsq2`). */
  const accepted = await send(User.WM_NCCREATE, 0, [createstruct]);

  if (((accepted ?? 0) & 0xffff) === 0) {
    await send(User.WM_NCDESTROY, 0, 0);

    if (dialog._nameBlock) {
      GlobalFree.call(this, dialog._nameBlock);
      dialog._nameBlock = 0;
    }

    dialog.window.visible = false;
    raster.destroy(shown);
    this.handles.free(hWnd);

    return NULL;
  }

  /* An edit control's memory, taken at its WM_NCCREATE in its instance's
   * heap (`edit-buffer.ts`). */
  if (dialog.window.control?.className === 'EDIT') {
    createEditBuffer(
      this,
      dialog.window.control,
      hinst,
      (dialog.window.control.style & 0x0004) !== 0
    );
  }

  const frame: any = new RECT();

  frame.left = shown.left;
  frame.top = shown.top;
  frame.right = shown.left + shown.width;
  frame.bottom = shown.top + shown.height;

  await send(User.WM_NCCALCSIZE, 0, [frame]);
  await send(User.WM_CREATE, 0, [createstruct]);

  /* A child or a pop-up is told its size and place at once; an overlapped
   * window is owed them, until it is first shown (`showseq`). */
  if (dwStyle & (User.WS_CHILD | WS_POPUP)) {
    await notifySize(this, hWnd, dialog);
  } else {
    shown.owesSize = true;
  }

  /* A list box's own making: its row height, its height, its scroll bar. */
  const made = dialog.window.control?.className;

  if (made === 'LISTBOX' || made === 'COMBOLBOX') {
    await initList(this, hWnd);
  }

  /* A combo box's own making: its parts. */
  if (made === 'COMBOBOX') {
    await initCombo(this, hWnd);
  }

  /* A child's parent is told of it, the child's handle and identifier in
   * `lParam` (`showseq`). */
  if (child && parentWindow instanceof RasterWindow) {
    const parentClass = this.handles.retrieve(parentWindow.options.windowClass);

    await this.scheduler.callWndProc(
      parentClass,
      hwndParent,
      User.WM_PARENTNOTIFY,
      User.WM_CREATE,
      ((hWnd & 0xffff) | ((hmenu & 0xffff) << 16)) >>> 0
    );
  }

  /* An overlapped window made maximized is maximized before it shows, as
   * `SetWindowPos` would place it there, not drawn and not made active:
   * asked `WM_GETMINMAXINFO`, told `WM_WINDOWPOSCHANGING`, asked again,
   * `WM_NCCALCSIZE` with its new rectangle, then `WM_WINDOWPOSCHANGED`,
   * from which `DefWindowProc` tells it its place and size (`showseq`). */
  if (dwStyle & WS_MAXIMIZE && !(dwStyle & (User.WS_CHILD | WS_POPUP))) {
    await maximizeMade(this, hWnd, dialog, send);
  }

  /* One made minimized, likewise, to its place among the icons at the
   * bottom, hidden (`showmin`). */
  if (dwStyle & WS_MINIMIZE && !(dwStyle & (User.WS_CHILD | WS_POPUP))) {
    await minimizeToBottom(this, hWnd, dialog, false);
  }

  /* A window made visible shows at once, a top-level one active, as
   * `ShowWindow` shows it; an overlapped window given `CW_USEDEFAULT` for its
   * place is shown as its `y` says -- `SW_HIDE`, nought, not at all
   * (`showseq`). */
  if (dwStyle & User.WS_VISIBLE) {
    const command = !(dwStyle & (User.WS_CHILD | WS_POPUP)) && unset(x) ? y & 0xffff : User.SW_SHOW;

    if (command !== User.SW_HIDE) {
      await showRaster(this, hWnd, dialog, command, true, true);
    }
  }

  /* A top-level window with no owner is told to the shell hooks, after its
   * `WM_CREATE` (`shlhook`); see `hooks.ts`. */
  if (!hwndParent && !(dwStyle & User.WS_CHILD)) {
    dialog.shellWindow = true;
    await callHooks(this, WH_SHELL, HSHELL_WINDOWCREATED, hWnd, 0);
  }

  console.log('FINISING UP CREATEWINDOW', hWnd);
  return hWnd;
}

/**
 * Whether a place or size is `CW_USEDEFAULT`, however it arrived: an `INT`
 * reads it as -32768. For `x` it also makes `y` unused, and for the width the
 * height.
 */
function unset(value: number) {
  return (value & 0xffff) === 0x8000;
}

/** A window's name copied into a block of memory of its own, as a far pointer. */
function nameInMemory(system: any, dialog: any, name: string) {
  const handle = GlobalAlloc.call(system, 0x42, name.length + 1);
  const far = GlobalLock.call(system, handle);

  if (!far) {
    return 0;
  }

  const core = system.machine.cpu.core;

  for (let i = 0; i <= name.length; i++) {
    core.write8(
      (far >>> 16) & 0xffff,
      ((far & 0xffff) + i) & 0xffff,
      i < name.length ? name.charCodeAt(i) & 0xff : 0
    );
  }

  dialog._nameBlock = handle;

  return far >>> 0;
}

const WS_CLIPSIBLINGS = 0x04000000;
const WS_MAXIMIZE = 0x01000000;
const WS_MINIMIZE = 0x20000000;

/** A window made with `WS_MAXIMIZE` maximized, hidden. See `CreateWindow`. */
async function maximizeMade(
  system: any,
  hwnd: number,
  dialog: RasterWindow,
  send: (message: number, wParam: number, lParam: any) => Promise<any>
) {
  const shown = dialog.window;
  const desktop = dialog.desktop;
  const mmi = minMaxInfo(system, shown.style);
  const tops = desktop.windows.filter((other: any) => !other.parent);
  const at = desktop.front(shown);
  const after = tops.filter((other: any, index: number) => index < at && other !== shown);

  await send(User.WM_GETMINMAXINFO, 0, [mmi]);

  const place: any = new WINDOWPOS();

  place.hwnd = hwnd;
  place.hwndInsertAfter = after.length ? after[after.length - 1].hwnd : 0;
  place.x = mmi.ptMaxPosition.x;
  place.y = mmi.ptMaxPosition.y;
  place.cx = mmi.ptMaxSize.x;
  place.cy = mmi.ptMaxSize.y;
  place.flags = SWP_NOACTIVATE | SWP_FRAMECHANGED;

  await send(User.WM_WINDOWPOSCHANGING, 0, [place]);
  await send(User.WM_GETMINMAXINFO, 0, [minMaxInfo(system, shown.style)]);

  const old = [shown.left, shown.top, shown.left + shown.width, shown.top + shown.height];
  const oldClient = [
    shown.left + shown.client.left,
    shown.top + shown.client.top,
    shown.left + shown.client.left + shown.clientWidth,
    shown.top + shown.client.top + shown.clientHeight,
  ];

  desktop.maximize(shown);

  const params: any = new NCCALCSIZE_PARAMS();
  const rect = (to: any, [left, top, right, bottom]: number[]) => {
    to.left = left;
    to.top = top;
    to.right = right;
    to.bottom = bottom;
  };

  rect(params.rgrc0, [shown.left, shown.top, shown.left + shown.width, shown.top + shown.height]);
  rect(params.rgrc1, old);
  rect(params.rgrc2, oldClient);
  params.lppos = 0;

  await send(User.WM_NCCALCSIZE, 1, [params]);

  place.x = shown.left;
  place.y = shown.top;
  place.cx = shown.width;
  place.cy = shown.height;
  place.flags = SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_NOZORDER | SWP_NOREDRAW;

  await send(User.WM_WINDOWPOSCHANGED, 0, [place]);
}

const SWP_NOZORDER = 0x0004;
const SWP_NOREDRAW = 0x0008;
const SWP_NOACTIVATE = 0x0010;
const SWP_FRAMECHANGED = 0x0020;
const WS_POPUP = 0x80000000;
const WS_CAPTION = 0x00c00000;

/** The instance of the program that has the processor: its data segment's selector less one. */
function programInstance(system: any) {
  const loader = system.handles.resolve(system.scheduler.active)?.loader;

  return loader?.ds ? segmentSelector(loader.translate(loader.ds)) - 1 : 0;
}

const SM_CXSCREEN = 0;
const SM_CYSCREEN = 1;
const SM_CXSIZE = 30;
const SM_CYSIZE = 31;
const SM_CXFRAME = 32;
const SM_CYFRAME = 33;
const SM_CYICONSPACING = 39;
