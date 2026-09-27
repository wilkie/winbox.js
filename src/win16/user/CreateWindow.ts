'use strict';

import { callHooks, HSHELL_WINDOWCREATED, WH_SHELL } from './hooks.js';
import { NULL } from '../consts.js';

import { User, MINMAXINFO, CREATESTRUCT } from '../user.js';

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
import { RasterWindow } from './raster-window.js';
import { eraseShown } from './erase.js';

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
  lpvParam
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

  /* Not measured: where a window asked for no place or size goes. */
  if (!child && (unset(x) || unset(nWidth))) {
    if (unset(nWidth)) {
      dialog.resize(400, 300);
    }

    dialog.center();
  }

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

  // TODO: GETMINMAXINFO structure
  // TODO: WM_NCCREATE params
  // TODO: WM_NCCALCSIZE params
  // TODO: WM_CREATE params
  const mmi = new MINMAXINFO();
  const createstruct = new CREATESTRUCT();
  createstruct.lpCreateParams = lpvParam;
  createstruct.hInstance = hinst;
  createstruct.hwndParent = hwndParent;
  createstruct.hMenu = hmenu;
  createstruct.cy = nHeight;
  createstruct.cx = nWidth;
  createstruct.x = x;
  createstruct.y = y;
  createstruct.style = dwStyle;
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
  createstruct.dwExStyle = 0;

  dialog._createStruct = createstruct;

  // We asynchronously halt and call the window message procedure for the
  // initialization messages:
  console.log('WM_GETMINMAXINFO');
  await this.scheduler.callWndProc(windowClass, hWnd, User.WM_GETMINMAXINFO, 0, [mmi]);
  console.log('WM_NCCREATE');
  /* `WM_NCCREATE` carries the `CREATESTRUCT` as `WM_CREATE` does. */
  await this.scheduler.callWndProc(windowClass, hWnd, User.WM_NCCREATE, 0, [createstruct]);
  console.log('WM_NCCALCSIZE');
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

  await this.scheduler.callWndProc(windowClass, hWnd, User.WM_NCCALCSIZE, 0, 0);
  console.log('WM_CREATE');
  await this.scheduler.callWndProc(windowClass, hWnd, User.WM_CREATE, 0, [createstruct]);

  /* A list box's own making: its row height, its height, its scroll bar. */
  const made = dialog.window.control?.className;

  if (made === 'LISTBOX' || made === 'COMBOLBOX') {
    await initList(this, hWnd);
  }

  /* A combo box's own making: its parts. */
  if (made === 'COMBOBOX') {
    await initCombo(this, hWnd);
  }

  // If we have a parent, we notify it of the WM_CREATE
  if (hwndParent) {
    console.log('WM_PARENTNOTIFY');
    const notifyParam = hWnd & 0xffff;
    await this.scheduler.callWndProc(
      windowClass,
      hWnd,
      User.WM_PARENTNOTIFY,
      User.WM_CREATE,
      notifyParam
    );
  }

  /* A window made visible shows at once, a top-level one active. */
  if (dwStyle & User.WS_VISIBLE) {
    dialog.show();

    if (dialog instanceof RasterWindow) {
      await eraseShown(this, dialog);
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
