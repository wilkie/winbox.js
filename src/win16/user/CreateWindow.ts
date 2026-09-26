'use strict';

import { segmentSelector } from '../selectors.js';
import { NULL } from '../consts.js';

import { HWND } from '../types.js';

import { User, MSG, MINMAXINFO, CREATESTRUCT, WNDCLASS } from '../user.js';

import { attachWindowBitmap } from './window-bitmap.js';
import { MenuData } from './menu-data.js';
import { htmlMenu } from './html-menu.js';
import { controlState, systemClass } from './control-classes.js';
import { CONTROL_CLASSES, controlRect } from './controls.js';
import { initCombo, initList } from './control-classes.js';
import { RasterWindow } from './raster-window.js';
import { Window } from '../../window.js';
import { FixedWindow } from '../../windows/fixed-window.js';
import { SizableWindow } from '../../windows/sizable-window.js';

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
  // Look up the parent (if NULL, we create a window in the desktop space)
  let parentWindow = null;
  if (hwndParent == NULL) {
    parentWindow = this._desktop;
  } else {
    parentWindow = this.handles.resolve(hwndParent);

    // Error if the parent window is not known
    if (!parentWindow) {
      return NULL;
    }
  }

  /* On the raster desktop, a window is USER's own, drawn on the screen. */
  const raster = this.rasterDesktop;
  let dialog: any;

  if (raster) {
    const child = (dwStyle & User.WS_CHILD) !== 0 && parentWindow instanceof RasterWindow;
    const parent = child ? parentWindow.window : null;
    const className = String(lpszClassName);
    const control = CONTROL_CLASSES.has(className.toUpperCase());

    /* A class nobody registered makes no window, as Windows answers: the
     * combo box is one of USER's own not done yet. A window made anyway had
     * no procedure to paint it, and was due to be painted for ever. */
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
    const menuHandle = child
      ? 0
      : hmenu || (this.handles.retrieve(lpszClassName)?._menuHandle ?? 0);
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
      shown.control = controlState(
        className,
        dwStyle,
        lpszWindowName ? String(lpszWindowName) : ''
      );

      if (editBorder) {
        shown.control.border = true;
      }
    }

    if (child) {
      shown.controlId = hmenu & 0xffff;
    }

    dialog = new RasterWindow(raster, shown, {
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
  } else {
    dialog = htmlWindow(
      parentWindow,
      lpszClassName,
      lpszWindowName,
      dwStyle,
      x,
      y,
      nWidth,
      nHeight,
      this
    );
  }

  let windowClass = this.handles.retrieve(lpszClassName);
  if (!windowClass) {
    console.log('CANNOT FIND WINDOW CLASS', lpszClassName);

    if (lpszClassName.toUpperCase() === 'MDICLIENT') {
      console.log('loading MDICLIENT');
      windowClass = new WNDCLASS();

      // The default window class for mdiclient is to call DefWindowProc
      const module = this.modules.load(User);

      // Resolve the ordinal for DefWindowProc
      let defProc = module.lookup(107);
      defProc = (segmentSelector(defProc.segment) << 16) | defProc.offset;
      windowClass.lpfnWndProc = defProc;
      windowClass.lpszClassName = 'MDICLIENT';

      const handle = this.handles.allocate(windowClass);
      this.handles.register(handle, 'MDICLIENT');
    }
  }

  const hWnd = this.handles.allocate(dialog);
  console.log('CREATED WINDOW', hWnd);

  if (dialog instanceof RasterWindow) {
    dialog.window.hwnd = hWnd;

    /* The class's icon is what the window shows minimized. */
    const icon = windowClass?.hIcon ? this.handles.resolve(windowClass.hIcon) : null;

    dialog.window.icon = icon?.xor ? icon : null;
  }

  const taskHandle = this.scheduler.active;
  const task = this.handles.resolve(taskHandle);

  this.windows.register(taskHandle, task, hWnd, dialog);

  if (!raster && windowClass && windowClass._menuHandle) {
    const menu = this.handles.resolve(windowClass._menuHandle);

    if (menu instanceof MenuData) {
      dialog.append(htmlMenu(this, menu));
    }
  }

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
  if (!lpszWindowName) {
    createstruct.lpszName = 0;
  } else {
    createstruct.lpszName = (lpszWindowName.segment << 16) | lpszWindowName.offset;
  }
  createstruct.lpszClass = (lpszClassName.segment << 16) | lpszClassName.offset;
  createstruct.dwExStyle = 0;

  dialog._createStruct = createstruct;

  // We asynchronously halt and call the window message procedure for the
  // initialization messages:
  console.log('WM_GETMINMAXINFO');
  await this.scheduler.callWndProc(windowClass, hWnd, User.WM_GETMINMAXINFO, 0, [mmi]);
  console.log('WM_NCCREATE');
  await this.scheduler.callWndProc(windowClass, hWnd, User.WM_NCCREATE, 0, 0);
  console.log('WM_NCCALCSIZE');
  await this.scheduler.callWndProc(windowClass, hWnd, User.WM_NCCALCSIZE, 0, 0);
  console.log('WM_CREATE');
  await this.scheduler.callWndProc(windowClass, hWnd, User.WM_CREATE, 0, [createstruct]);

  /* A list box's own making: its row height, its height, its scroll bar. */
  const made = dialog instanceof RasterWindow ? dialog.window.control?.className : null;

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
  if (dialog instanceof RasterWindow && dwStyle & User.WS_VISIBLE) {
    dialog.show();
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

/** A window as one of the page's own components, where there is no raster desktop. */
function htmlWindow(
  parentWindow,
  lpszClassName,
  lpszWindowName,
  dwStyle,
  x,
  y,
  nWidth,
  nHeight,
  system
) {
  let windowClassType: any = Window;

  if (dwStyle & User.WS_THICKFRAME) {
    windowClassType = SizableWindow;
  } else if (dwStyle & User.WS_OVERLAPPED) {
    windowClassType = FixedWindow;
  } else if (dwStyle & User.WS_DLGFRAME) {
    // TODO: This is a fixed window with a single pixel black border
    windowClassType = FixedWindow;
  }

  // Create a window inside the given parent
  const dialog = new windowClassType({
    caption: lpszWindowName,
    timesShown: 0,
    windowClass: lpszClassName,
    font: system.fonts.lookup('System'),
    size: 8,
    width: 800,
  });

  /* No font goes on the surface here. `lookup` answers with every entry a face
   * has -- an array, not a font -- so what landed here was something nothing
   * could measure or draw with, and it sat in front of the real default:
   * `GetDC` puts the system font in a context that has none, and could not,
   * because this had already filled the slot.
   *
   * A font belongs to a device context rather than to a window in any case.
   */

  dialog.show();
  dialog.resize(400, 300);

  parentWindow.append(dialog);

  /*
    x = User.CW_USEDEFAULT;
    y = User.CW_USEDEFAULT;
    nWidth = 500;
    nHeight = 500;
    //*/

  if (nWidth != User.CW_USEDEFAULT && nHeight != User.CW_USEDEFAULT) {
    dialog.resize(nWidth, nHeight);
  }

  dialog.center();

  if (x != User.CW_USEDEFAULT && y != User.CW_USEDEFAULT) {
    dialog.move(x, y);
  }

  // The pixels the window draws into, shown on its canvas once a frame.
  attachWindowBitmap(system, dialog);

  dialog.hide();

  return dialog;
}
