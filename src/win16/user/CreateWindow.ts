'use strict';

import { NULL } from '../consts.js';

import { HWND } from '../types.js';

import { User, MSG, MINMAXINFO, CREATESTRUCT, WNDCLASS } from '../user.js';

import { Bitmap } from '../../raster/bitmap.js';
import { Palette } from '../../raster/palette.js';
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

  let windowClassType = Window;

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
    font: this.fonts.lookup('System'),
    size: 8,
    width: 800,
  });

  // Set default font
  dialog.surface.font = this.fonts.lookup('System');

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

  // Set default bitmap (8bpp)
  const bitmapData = new Uint8Array(dialog.surface.width * dialog.surface.height * 4);
  const bitmapView = new DataView(bitmapData.buffer);
  dialog.surface.bitmap = new Bitmap(
    dialog.surface.width,
    dialog.surface.height,
    32,
    Bitmap.RGBA,
    bitmapView,
    Palette.PALETTEWIN256
  );

  dialog.hide();

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
      defProc = (((defProc.segment << 3) | 0x3) << 16) | defProc.offset;
      windowClass.lpfnWndProc = defProc;
      windowClass.lpszClassName = 'MDICLIENT';

      const handle = this.handles.allocate(windowClass);
      this.handles.register(handle, 'MDICLIENT');
    }
  }

  const hWnd = this.handles.allocate(dialog);
  console.log('CREATED WINDOW', hWnd);

  const taskHandle = this.scheduler.active;
  const task = this.handles.resolve(taskHandle);

  this.windows.register(taskHandle, task, hWnd, dialog);

  if (windowClass && windowClass._menuHandle) {
    const menu = this.handles.resolve(windowClass._menuHandle);
    dialog.append(menu);
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

  console.log('FINISING UP CREATEWINDOW', hWnd);
  return hWnd;
}
