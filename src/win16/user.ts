'use strict';

/** @namespace User */

import { RealizePalette, SelectPalette } from './gdi/palettes.js';
import {
  ChangeClipboardChain,
  CloseClipboard,
  CountClipboardFormats,
  EmptyClipboard,
  EnumClipboardFormats,
  GetClipboardData,
  GetClipboardOwner,
  GetClipboardViewer,
  GetOpenClipboardWindow,
  IsClipboardFormatAvailable,
  OpenClipboard,
  SetClipboardData,
  SetClipboardViewer,
} from './user/clipboard.js';
import { CalcChildScroll, ScrollChildren } from './user/mdi-scroll.js';
import {
  CallMsgFilter,
  CallNextHookEx,
  DefHookProc,
  SetWindowsHook,
  SetWindowsHookEx,
  UnhookWindowsHook,
  UnhookWindowsHookEx,
} from './user/hooks.js';
import { Module } from './module.js';

import {
  BYTE,
  UBYTE,
  INT,
  UINT,
  LONG,
  ULONG,
  DWORD,
  HLOCAL,
  HGLOBAL,
  HANDLE,
  ATOM,
  LRESULT,
  HMENU,
  HACCEL,
  HINSTANCE,
  WPARAM,
  LPARAM,
  HDC,
  HRGN,
  HBRUSH,
  HICON,
  HCURSOR,
  WNDPROC,
  VARIADIC,
  HBITMAP,
  BOOL,
  NEARPTR,
  FARPTR,
  LPCSTR,
  HWND,
  Struct,
  COLORREF,
} from './types.js';

import { AnsiLower, AnsiLowerBuff } from './user/AnsiLower.js';
import { AnsiNext } from './user/AnsiNext.js';
import { AnsiPrev } from './user/AnsiPrev.js';
import { AnsiUpper, AnsiUpperBuff } from './user/AnsiUpper.js';
import { BeginPaint } from './user/BeginPaint.js';
import { CopyRect } from './user/CopyRect.js';
import { CreateWindowEx } from './user/CreateWindowEx.js';
import { CreateWindow } from './user/CreateWindow.js';
import { CreateMenu, CreatePopupMenu } from './user/CreateMenu.js';
import {
  CheckMenuItem,
  DeleteMenu,
  DestroyMenu,
  DrawMenuBar,
  EnableMenuItem,
  GetMenuItemCount,
  GetMenuItemID,
  GetMenuState,
  GetMenuString,
  GetSubMenu,
  GetSystemMenu,
  RemoveMenu,
  SetMenu,
} from './user/menu-api.js';
import { TrackPopupMenu } from './user/TrackPopupMenu.js';
import { SystemParametersInfo } from './user/SystemParametersInfo.js';
import { DrawIcon, IsIconic, IsZoomed, LoadIcon, CreateIcon, CopyIcon, DestroyIcon } from './user/icon-api.js';
import { CloseWindow, OpenIcon } from './user/ShowWindow.js';
import { AppendMenu, InsertMenu } from './user/AppendMenu.js';
import { ClientToScreen } from './user/ClientToScreen.js';
import { GetCursorPos, SetCursorPos } from './user/cursor-pos.js';
import { ScreenToClient } from './user/ScreenToClient.js';
import {
  CreateCaret,
  DestroyCaret,
  GetCaretBlinkTime,
  GetCaretPos,
  HideCaret,
  SetCaretBlinkTime,
  SetCaretPos,
  ShowCaret,
} from './user/caret.js';
import { GetClassName, GetNextWindow, GetTopWindow, GetWindow } from './user/GetWindow.js';
import { InvertRect } from './user/InvertRect.js';
import { GetProp, RemoveProp, SetProp } from './user/props.js';
import {
  EnableScrollBar,
  GetScrollPos,
  GetScrollRange,
  SetScrollPos,
  SetScrollRange,
  ShowScrollBar,
} from './user/scroll-bars.js';
import { GetDlgItem } from './user/GetDlgItem.js';
import { GetFocus } from './user/GetFocus.js';
import { ReleaseCapture, SetCapture } from './user/SetCapture.js';
import { SendDlgItemMessage } from './user/SendDlgItemMessage.js';
import { DefWindowProc } from './user/DefWindowProc.js';
import { DestroyWindow } from './user/DestroyWindow.js';
import { DispatchMessage } from './user/DispatchMessage.js';
import { ExitWindows } from './user/ExitWindows.js';
import { EndPaint } from './user/EndPaint.js';
import { FillRect } from './user/FillRect.js';
import { FindWindow } from './user/FindWindow.js';
import { FrameRect } from './user/FrameRect.js';
import { GetCursor, LoadCursor, SetCursor, ShowCursor } from './user/cursor-api.js';
import {
  CreateDialog,
  CreateDialogIndirect,
  CreateDialogIndirectParam,
  CreateDialogParam,
  DefDlgProc,
  DialogBox,
  DialogBoxIndirect,
  DialogBoxIndirectParam,
  DialogBoxParam,
  EndDialog,
  GetDialogBaseUnits,
  GetDlgCtrlID,
  GetNextDlgGroupItem,
  GetNextDlgTabItem,
  IsDialogMessage,
  MapDialogRect,
} from './user/dialogs.js';
import {
  CheckDlgButton,
  CheckRadioButton,
  GetDlgItemInt,
  GetDlgItemText,
  GetWindowText,
  GetWindowTextLength,
  IsDlgButtonChecked,
  SetDlgItemInt,
  SetDlgItemText,
} from './user/dialog-items.js';
import { GetDC } from './user/GetDC.js';
import { BringWindowToTop, SetWindowPos } from './user/window-state.js';
import { WinHelp } from './user/WinHelp.js';
import {
  CallWindowProc,
  GetClassLong,
  GetClassWord,
  GetWindowLong,
  GetWindowWord,
  SetClassLong,
  SetClassWord,
  SetWindowLong,
  SetWindowWord,
} from './user/window-words.js';
import {
  EnableWindow,
  GetParent,
  IsChild,
  IsWindow,
  IsWindowEnabled,
  IsWindowVisible,
  GetWindowTask,
} from './user/window-queries.js';
import { GetWindowDC } from './user/GetWindowDC.js';
import { GetDesktopWindow } from './user/GetDesktopWindow.js';
import { GetMessage } from './user/GetMessage.js';
import { GetSystemMetrics } from './user/GetSystemMetrics.js';
import { GetSysColor, SetSysColors } from './user/GetSysColor.js';
import { GetTickCount } from './user/GetTickCount.js';
import { GetClientRect } from './user/GetClientRect.js';
import { GetMenu } from './user/GetMenu.js';
import { GetWindowRect } from './user/GetWindowRect.js';
import { InitApp } from './user/InitApp.js';
import { InvalidateRect } from './user/InvalidateRect.js';
import { DrawText } from './user/DrawText.js';
import { GetUpdateRect } from './user/GetUpdateRect.js';
import {
  GetActiveWindow,
  SetActiveWindow,
  GetWindowPlacement,
  SetWindowPlacement,
  WINDOWPLACEMENT,
} from './user/placement.js';
import { WNetGetCaps, WNetGetConnection } from './user/wnet.js';
import { AdjustWindowRect, AdjustWindowRectEx } from './user/AdjustWindowRect.js';
import { DefFrameProc, DefMDIChildProc, TranslateMDISysAccel } from './user/mdi.js';
import { DrawFocusRect } from './user/DrawFocusRect.js';
import {
  DlgDirList,
  DlgDirListComboBox,
  DlgDirSelect,
  DlgDirSelectComboBox,
  DlgDirSelectComboBoxEx,
  DlgDirSelectEx,
} from './user/dlgdir.js';
import { LoadBitmap } from './user/LoadBitmap.js';
import { LoadMenu } from './user/LoadMenu.js';
import { LoadString } from './user/LoadString.js';
import { lstrcmp } from './user/lstrcmp.js';
import { lstrcmpi } from './user/lstrcmpi.js';
import { MessageBox } from './user/MessageBox.js';
import { MoveWindow } from './user/MoveWindow.js';
import { PeekMessage } from './user/PeekMessage.js';
import { PtInRect } from './user/PtInRect.js';
import {
  EqualRect,
  InflateRect,
  IntersectRect,
  IsRectEmpty,
  OffsetRect,
  SetRectEmpty,
  SubtractRect,
  UnionRect,
} from './user/rect-api.js';
import { RegisterClass } from './user/RegisterClass.js';
import { RedrawWindow } from './user/RedrawWindow.js';
import { ReleaseDC } from './user/ReleaseDC.js';
import { SendMessage } from './user/SendMessage.js';
import { SetFocus } from './user/SetFocus.js';
import { PostQuitMessage } from './user/PostQuitMessage.js';
import { GetClipboardFormatName, RegisterWindowMessage } from './user/RegisterWindowMessage.js';
import { GlobalAddAtom, GlobalDeleteAtom, GlobalFindAtom, GlobalGetAtomName } from './atoms.js';
import { ValidateRect } from './user/ValidateRect.js';
import { KillTimer, SetTimer } from './user/SetTimer.js';
import { PostMessage } from './user/PostMessage.js';
import { SetRect } from './user/SetRect.js';
import { SetWindowText } from './user/SetWindowText.js';
import { ShowWindow } from './user/ShowWindow.js';
import { GetKeyState, LoadAccelerators, TranslateAccelerator } from './user/accelerators.js';
import { TranslateMessage } from './user/TranslateMessage.js';
import { UpdateWindow } from './user/UpdateWindow.js';
import { wsprintf } from './user/wsprintf.js';

/**
 * The Win16 User library.
 *
 * @memberof Win16
 */
export class User extends Module {
  declare static BM_GETCHECK: any;
  declare static BM_GETSTATE: any;
  declare static BM_SETCHECK: any;
  declare static BM_SETSTATE: any;
  declare static BM_SETSTYLE: any;
  declare static BN_CLICKED: any;
  declare static BN_DISABLE: any;
  declare static BN_DOUBLECLICKED: any;
  declare static BN_HILITE: any;
  declare static BN_PAINT: any;
  declare static BN_UNHILITE: any;
  declare static BS_3STATE: any;
  declare static BS_AUTO3STATE: any;
  declare static BS_AUTOCHECKBOX: any;
  declare static BS_AUTORADIOBUTTON: any;
  declare static BS_CHECKBOX: any;
  declare static BS_DEFPUSHBUTTON: any;
  declare static BS_GROUPBOX: any;
  declare static BS_LEFTTEXT: any;
  declare static BS_OWNERDRAW: any;
  declare static BS_PUSHBUTTON: any;
  declare static BS_RADIOBUTTON: any;
  declare static BS_USERBUTTON: any;
  declare static CW_USEDEFAULT: any;
  declare static DEFBUTTON1: any;
  declare static DEFBUTTON2: any;
  declare static DEFBUTTON3: any;
  declare static DM_GETDEFID: any;
  declare static DM_SETDEFID: any;
  declare static DS_ABSALIGN: any;
  declare static DS_LOCALEDIT: any;
  declare static DS_MODALFRAME: any;
  declare static DS_NOIDLEMSG: any;
  declare static DS_SETFONT: any;
  declare static DS_SYSMODAL: any;
  declare static HWND_BOTTOM: any;
  declare static HWND_NOTOPMOST: any;
  declare static HWND_TOP: any;
  declare static HWND_TOPMOST: any;
  declare static ICONEXCLAMATION: any;
  declare static ICONINFORMATION: any;
  declare static ICONQUESTION: any;
  declare static ICONSTOP: any;
  declare static IDABORT: any;
  declare static IDCANCEL: any;
  declare static IDIGNORE: any;
  declare static IDNO: any;
  declare static IDOK: any;
  declare static IDRETRY: any;
  declare static IDYES: any;
  declare static KF_ALTDOWN: any;
  declare static KF_DLGMODE: any;
  declare static KF_EXTENDED: any;
  declare static KF_MENUMODE: any;
  declare static KF_REPEAT: any;
  declare static KF_UP: any;
  declare static MB_ABORTRETRYIGNORE: any;
  declare static MB_APPLMODAL: any;
  declare static MB_DEFBUTTON1: any;
  declare static MB_DEFBUTTON2: any;
  declare static MB_DEFBUTTON3: any;
  declare static MB_DEFMASK: any;
  declare static MB_ICONASTERISK: any;
  declare static MB_ICONEXCLAMATION: any;
  declare static MB_ICONHAND: any;
  declare static MB_ICONINFORMATION: any;
  declare static MB_ICONMASK: any;
  declare static MB_ICONQUESTION: any;
  declare static MB_ICONSTOP: any;
  declare static MB_NOFOCUS: any;
  declare static MB_OK: any;
  declare static MB_OKCANCEL: any;
  declare static MB_RETRYCANCEL: any;
  declare static MB_SYSTEMMODAL: any;
  declare static MB_TASKMODAL: any;
  declare static MB_TYPEMASK: any;
  declare static MB_YESNO: any;
  declare static MB_YESNOCANCEL: any;
  declare static MK_CONTROL: any;
  declare static MK_LBUTTON: any;
  declare static MK_MBUTTON: any;
  declare static MK_RBUTTON: any;
  declare static MK_SHIFT: any;
  declare static PM_NOREMOVE: any;
  declare static PM_NOYIELD: any;
  declare static PM_REMOVE: any;
  declare static RDW_ALLCHILDREN: any;
  declare static RDW_ERASE: any;
  declare static RDW_ERASENOW: any;
  declare static RDW_FRAME: any;
  declare static RDW_INTERNALPAINT: any;
  declare static RDW_INVALIDATE: any;
  declare static RDW_NOCHILDREN: any;
  declare static RDW_NOERASE: any;
  declare static RDW_NOFRAME: any;
  declare static RDW_NOINTERNALPAINT: any;
  declare static RDW_UPDATENOW: any;
  declare static RDW_VALIDATE: any;
  declare static SIZE_MAXHIDE: any;
  declare static SIZE_MAXIMIZED: any;
  declare static SIZE_MAXSHOW: any;
  declare static SIZE_MINIMIZED: any;
  declare static SIZE_RESTORED: any;
  declare static SWP_DEFERERASE: any;
  declare static SWP_DRAWFRAME: any;
  declare static SWP_FRAMECHANGED: any;
  declare static SWP_HIDEWINDOW: any;
  declare static SWP_NOACTIVATE: any;
  declare static SWP_NOCOPYBITS: any;
  declare static SWP_NOMOVE: any;
  declare static SWP_NOOWNERZORDER: any;
  declare static SWP_NOREDRAW: any;
  declare static SWP_NOREPOSITION: any;
  declare static SWP_NOSENDCHANGING: any;
  declare static SWP_NOSIZE: any;
  declare static SWP_NOZORDER: any;
  declare static SWP_SHOWWINDOW: any;
  declare static SW_HIDE: any;
  declare static SW_MAXIMIZE: any;
  declare static SW_MAXIMIZED: any;
  declare static SW_MINIMIZE: any;
  declare static SW_NORMAL: any;
  declare static SW_OTHERMAXIMIZED: any;
  declare static SW_OTHERRESTORED: any;
  declare static SW_PARENTCLOSING: any;
  declare static SW_PARENTOPENING: any;
  declare static SW_RESTORE: any;
  declare static SW_SHOW: any;
  declare static SW_SHOWMAXIMIZED: any;
  declare static SW_SHOWMINIMIZED: any;
  declare static SW_SHOWMINNOACTIVE: any;
  declare static SW_SHOWNA: any;
  declare static SW_SHOWNOACTIVATE: any;
  declare static SW_SHOWNORMAL: any;
  declare static VIRTUAL_KEY_TRANSLATE: any;
  declare static VK_ADD: any;
  declare static VK_BACK: any;
  declare static VK_CANCEL: any;
  declare static VK_CAPITAL: any;
  declare static VK_CLEAR: any;
  declare static VK_CONTROL: any;
  declare static SM_CXBORDER: any;
  declare static SM_CXFRAME: any;
  declare static SM_CXICON: any;
  declare static SM_CXSCREEN: any;
  declare static SM_CYBORDER: any;
  declare static SM_CYCAPTION: any;
  declare static SM_CYFRAME: any;
  declare static SM_CYICON: any;
  declare static SM_CYMENU: any;
  declare static SM_CXFULLSCREEN: any;
  declare static SM_CYFULLSCREEN: any;
  declare static SM_CYSCREEN: any;
  declare static VK_DECIMAL: any;
  declare static VK_DELETE: any;
  declare static VK_DIVIDE: any;
  declare static VK_DOWN: any;
  declare static VK_END: any;
  declare static VK_ESCAPE: any;
  declare static VK_EXECUTE: any;
  declare static VK_F1: any;
  declare static VK_F10: any;
  declare static VK_F11: any;
  declare static VK_F12: any;
  declare static VK_F13: any;
  declare static VK_F14: any;
  declare static VK_F15: any;
  declare static VK_F16: any;
  declare static VK_F17: any;
  declare static VK_F18: any;
  declare static VK_F19: any;
  declare static VK_F2: any;
  declare static VK_F20: any;
  declare static VK_F21: any;
  declare static VK_F22: any;
  declare static VK_F23: any;
  declare static VK_F24: any;
  declare static VK_F3: any;
  declare static VK_F4: any;
  declare static VK_F5: any;
  declare static VK_F6: any;
  declare static VK_F7: any;
  declare static VK_F8: any;
  declare static VK_F9: any;
  declare static VK_HELP: any;
  declare static VK_HOME: any;
  declare static VK_INSERT: any;
  declare static VK_LBUTTON: any;
  declare static VK_LEFT: any;
  declare static VK_MBUTTON: any;
  declare static VK_MENU: any;
  declare static VK_MULTIPLY: any;
  declare static VK_NEXT: any;
  declare static VK_NUMLOCK: any;
  declare static VK_NUMPAD0: any;
  declare static VK_NUMPAD1: any;
  declare static VK_NUMPAD2: any;
  declare static VK_NUMPAD3: any;
  declare static VK_NUMPAD4: any;
  declare static VK_NUMPAD5: any;
  declare static VK_NUMPAD6: any;
  declare static VK_NUMPAD7: any;
  declare static VK_NUMPAD8: any;
  declare static VK_NUMPAD9: any;
  declare static VK_PAUSE: any;
  declare static VK_PRINT: any;
  declare static VK_PRIOR: any;
  declare static VK_RBUTTON: any;
  declare static VK_RETURN: any;
  declare static VK_RIGHT: any;
  declare static VK_SCROLL: any;
  declare static VK_SELECT: any;
  declare static VK_SEPARATOR: any;
  declare static VK_SHIFT: any;
  declare static VK_SNAPSHOT: any;
  declare static VK_SPACE: any;
  declare static VK_SUBTRACT: any;
  declare static VK_TAB: any;
  declare static VK_UP: any;
  declare static WA_ACTIVE: any;
  declare static WA_CLICKACTIVE: any;
  declare static WA_INACTIVE: any;
  declare static WM_ACTIVATE: any;
  declare static WM_ACTIVATEAPP: any;
  declare static WM_CHAR: any;
  declare static WM_CLEAR: any;
  declare static WM_CLOSE: any;
  declare static WM_COMMAND: any;
  declare static WM_COMPAREITEM: any;
  declare static WM_COPY: any;
  declare static WM_CREATE: any;
  declare static WM_CUT: any;
  declare static WM_DEADCHAR: any;
  declare static WM_DELETEITEM: any;
  declare static WM_DESTROY: any;
  declare static WM_DESTROYCLIPBOARD: any;
  declare static WM_DRAWITEM: any;
  declare static WM_DROPFILES: any;
  declare static WM_ENABLE: any;
  declare static WM_ERASEBKGND: any;
  declare static WM_GETFONT: any;
  declare static WM_GETMINMAXINFO: any;
  declare static WM_GETTEXT: any;
  declare static WM_GETTEXTLENGTH: any;
  declare static WM_HSCROLL: any;
  declare static WM_ICONERASEBKGND: any;
  declare static WM_INITDIALOG: any;
  declare static WM_INITMENU: any;
  declare static WM_INITMENUPOPUP: any;
  declare static WM_KEYDOWN: any;
  declare static WM_KEYUP: any;
  declare static WM_KILLFOCUS: any;
  declare static WM_LBUTTONDBLCLK: any;
  declare static WM_LBUTTONDOWN: any;
  declare static WM_LBUTTONUP: any;
  declare static WM_MBUTTONDBLCLK: any;
  declare static WM_MBUTTONDOWN: any;
  declare static WM_MBUTTONUP: any;
  declare static WM_MDIACTIVATE: any;
  declare static WM_MDICASCADE: any;
  declare static WM_MDICREATE: any;
  declare static WM_MDIDESTROY: any;
  declare static WM_MDIGETACTIVE: any;
  declare static WM_MDIICONARRANGE: any;
  declare static WM_MDIMAXIMIZE: any;
  declare static WM_MDINEXT: any;
  declare static WM_MDIRESTORE: any;
  declare static WM_MDISETMENU: any;
  declare static WM_MDITILE: any;
  declare static WM_MEASUREITEM: any;
  declare static WM_MENUCHAR: any;
  declare static WM_MENUSELECT: any;
  declare static WM_MOUSEACTIVATE: any;
  declare static WM_MOUSEMOVE: any;
  declare static WM_MOVE: any;
  declare static WM_NCACTIVATE: any;
  declare static WM_NCCALCSIZE: any;
  declare static WM_NCCREATE: any;
  declare static WM_NCDESTROY: any;
  declare static WM_NCHITTEST: any;
  declare static WM_NCLBUTTONDBLCLK: any;
  declare static WM_NCLBUTTONDOWN: any;
  declare static WM_NCLBUTTONUP: any;
  declare static WM_NCMBUTTONDOWN: any;
  declare static WM_NCMBUTTONUP: any;
  declare static WM_NCMOUSEMOVE: any;
  declare static WM_NCPAINT: any;
  declare static WM_NCRBUTTONDBLCLK: any;
  declare static WM_NCRBUTTONDOWN: any;
  declare static WM_NCRBUTTONUP: any;
  declare static WM_PAINT: any;
  declare static WM_PALETTECHANGED: any;
  declare static WM_PALETTEISCHANGING: any;
  declare static WM_PARENTNOTIFY: any;
  declare static WM_PASTE: any;
  declare static WM_QUERYDRAGICON: any;
  declare static WM_CHARTOITEM: any;
  declare static WM_VKEYTOITEM: any;
  declare static WM_CTLCOLOR: any;
  declare static WM_QUERYNEWPALETTE: any;
  declare static WM_QUERYOPEN: any;
  declare static WM_QUIT: any;
  declare static WM_RBUTTONDBLCLK: any;
  declare static WM_RBUTTONDOWN: any;
  declare static WM_RBUTTONUP: any;
  declare static WM_RENDERALLFORMATS: any;
  declare static WM_RENDERFORMAT: any;
  declare static WM_SETFOCUS: any;
  declare static WM_SETFONT: any;
  declare static WM_SETREDRAW: any;
  declare static WM_SETTEXT: any;
  declare static WM_SHOWWINDOW: any;
  declare static WM_SIZE: any;
  declare static WM_SYSCHAR: any;
  declare static WM_SYSCOMMAND: any;
  declare static WM_SYSDEADCHAR: any;
  declare static WM_SYSKEYDOWN: any;
  declare static WM_SYSKEYUP: any;
  declare static WM_TIMER: any;
  declare static WM_UNDO: any;
  declare static WM_USER: any;
  declare static WM_VSCROLL: any;
  declare static WM_WINDOWPOSCHANGED: any;
  declare static WM_WINDOWPOSCHANGING: any;
  declare static WS_BORDER: any;
  declare static WS_CAPTION: any;
  declare static WS_CHILD: any;
  declare static WS_CHILDWINDOW: any;
  declare static WS_CLIPCHILDREN: any;
  declare static WS_CLIPSIBLINGS: any;
  declare static WS_DISABLED: any;
  declare static WS_DLGFRAME: any;
  declare static WS_EX_ACCEPTFILES: any;
  declare static WS_EX_DLGMODALFRAME: any;
  declare static WS_EX_NOPARENTNOTIFY: any;
  declare static WS_EX_TOPMOST: any;
  declare static WS_EX_TRANSPARENT: any;
  declare static WS_GROUP: any;
  declare static WS_HSCROLL: any;
  declare static WS_ICONIC: any;
  declare static WS_MAXIMIZE: any;
  declare static WS_MAXIMIZEBOX: any;
  declare static WS_MINIMIZE: any;
  declare static WS_MINIMIZEBOX: any;
  declare static WS_OVERLAPPED: any;
  declare static WS_OVERLAPPEDWINDOW: any;
  declare static WS_POPUP: any;
  declare static WS_POPUPWINDOW: any;
  declare static WS_SIZEBOX: any;
  declare static WS_SYSMENU: any;
  declare static WS_TABSTOP: any;
  declare static WS_THICKFRAME: any;
  declare static WS_TILED: any;
  declare static WS_TILEDWINDOW: any;
  declare static WS_VISIBLE: any;
  declare static WS_VSCROLL: any;
  static get name(): string {
    return 'USER';
  }

  static get path() {
    return 'C:\\WINDOWS\\SYSTEM\\USER.EXE';
  }

  static get exports() {
    return [
      // 0 //
      null,
      [MessageBox, 'MessageBox', 12, [HWND, LPCSTR, LPCSTR, UINT], INT],
      [User.stub, 'OldExitWindows', 0],
      [User.stub, 'EnableOEMLayer', 0],
      [User.stub, 'DisableOEMLayer', 0],
      [InitApp, 'InitApp', 2, [HANDLE], BOOL],
      [PostQuitMessage, 'PostQuitMessage', 2, [INT]],
      [ExitWindows, 'ExitWindows', 6, [DWORD, UINT], BOOL],
      [User.stub, 'Unknown', 2],
      [User.stub, 'Unknown'],
      // 10 //
      [SetTimer, 'SetTimer', 10, [HWND, UINT, UINT, FARPTR], UINT],
      [User.stub, 'Bear11', 10],
      [KillTimer, 'KillTimer', 4, [HWND, UINT], BOOL],
      [GetTickCount, 'GetTickCount', 0, [], DWORD],
      [User.stub, 'GetTimerResolution', 0],
      [User.stub, 'GetCurrentTime', 0],
      [User.stub, 'ClipCursor', 4],
      [GetCursorPos, 'GetCursorPos', 4, [[POINT]]],
      [SetCapture, 'SetCapture', 2, [HWND], HWND],
      [ReleaseCapture, 'ReleaseCapture', 0, []],
      // 20 //
      [User.stub, 'SetDoubleClickTime', 2],
      [User.stub, 'GetDoubleClickTime', 0],
      [SetFocus, 'SetFocus', 2, [HWND], HWND],
      [GetFocus, 'GetFocus', 0, [], HWND],
      [RemoveProp, 'RemoveProp', 6, [HWND, FARPTR], HANDLE],
      [GetProp, 'GetProp', 6, [HWND, FARPTR], HANDLE],
      [SetProp, 'SetProp', 8, [HWND, FARPTR, HANDLE], BOOL],
      [User.stub, 'EnumProps', 6],
      [ClientToScreen, 'ClientToScreen', 6, [HWND, [POINT]]],
      [ScreenToClient, 'ScreenToClient', 6, [HWND, [POINT]]],
      // 30 //
      [User.stub, 'WindowFromPoint', 4],
      [IsIconic, 'IsIconic', 2, [HWND], BOOL],
      [GetWindowRect, 'GetWindowRect', 6, [HWND, [RECT]]],
      [GetClientRect, 'GetClientRect', 6, [HWND, [RECT]]],
      [EnableWindow, 'EnableWindow', 4, [HWND, BOOL], BOOL],
      [IsWindowEnabled, 'IsWindowEnabled', 2, [HWND], BOOL],
      [GetWindowText, 'GetWindowText', 8, [HWND, FARPTR, INT], INT],
      [SetWindowText, 'SetWindowText', 6, [HWND, LPCSTR]],
      [GetWindowTextLength, 'GetWindowTextLength', 2, [HWND], INT],
      [BeginPaint, 'BeginPaint', 6, [HWND, [PAINTSTRUCT]], HDC],
      // 40 //
      [EndPaint, 'EndPaint', 6, [HWND, [PAINTSTRUCT]]],
      [
        CreateWindow,
        'CreateWindow',
        30,
        [LPCSTR, LPCSTR, DWORD, INT, INT, INT, INT, HWND, HMENU, HINSTANCE, FARPTR],
        HWND,
      ],
      [ShowWindow, 'ShowWindow', 4, [HWND, INT], BOOL],
      [CloseWindow, 'CloseWindow', 2, [HWND]],
      [OpenIcon, 'OpenIcon', 2, [HWND], BOOL],
      [BringWindowToTop, 'BringWindowToTop', 2, [HWND], BOOL],
      [GetParent, 'GetParent', 2, [HWND], HWND],
      [IsWindow, 'IsWindow', 2, [HWND], BOOL],
      [IsChild, 'IsChild', 4, [HWND, HWND], BOOL],
      [IsWindowVisible, 'IsWindowVisible', 2, [HWND], BOOL],
      // 50 //
      [FindWindow, 'FindWindow', 8, [LPCSTR, LPCSTR], HWND],
      [User.stub, 'Bear51', 2],
      [User.stub, 'AnyPopUp', 0],
      [DestroyWindow, 'DestroyWindow', 2, [HWND], BOOL],
      [User.stub, 'EnumWindows', 8],
      [User.stub, 'EnumChildWindows', 10],
      [MoveWindow, 'MoveWindow', 12, [HWND, INT, INT, INT, INT, BOOL], BOOL],
      [RegisterClass, 'RegisterClass', 4, [WNDCLASS], ATOM],
      [GetClassName, 'GetClassName', 8, [HWND, FARPTR, INT], INT],
      [SetActiveWindow, 'SetActiveWindow', 2, [HWND], HWND],
      // 60 //
      [GetActiveWindow, 'GetActiveWindow', 0, [], HWND],
      [User.stub, 'ScrollWindow', 14],
      [SetScrollPos, 'SetScrollPos', 8, [HWND, INT, INT, BOOL], INT],
      [GetScrollPos, 'GetScrollPos', 4, [HWND, INT], INT],
      [SetScrollRange, 'SetScrollRange', 10, [HWND, INT, INT, INT, BOOL]],
      [GetScrollRange, 'GetScrollRange', 12, [HWND, INT, FARPTR, FARPTR]],
      [GetDC, 'GetDC', 2, [HWND], HDC],
      [GetWindowDC, 'GetWindowDC', 2, [HWND], HDC],
      [ReleaseDC, 'ReleaseDC', 4, [HWND, HDC], INT],
      [SetCursor, 'SetCursor', 2, [HCURSOR], HCURSOR],
      // 70 //
      [SetCursorPos, 'SetCursorPos', 4, [INT, INT]],
      [ShowCursor, 'ShowCursor', 2, [BOOL], INT],
      [SetRect, 'SetRect', 12, [[RECT], INT, INT, INT, INT]],
      [SetRectEmpty, 'SetRectEmpty', 4, [[RECT]]],
      [CopyRect, 'CopyRect', 8, [[RECT], [RECT]]],
      [IsRectEmpty, 'IsRectEmpty', 4, [[RECT]], BOOL],
      [PtInRect, 'PtInRect', 8, [[RECT], [POINT]], BOOL],
      [OffsetRect, 'OffsetRect', 8, [[RECT], INT, INT]],
      [InflateRect, 'InflateRect', 8, [[RECT], INT, INT]],
      [IntersectRect, 'IntersectRect', 12, [[RECT], [RECT], [RECT]], BOOL],
      // 80 //
      [UnionRect, 'UnionRect', 12, [[RECT], [RECT], [RECT]], BOOL],
      [FillRect, 'FillRect', 8, [HDC, [RECT], HBRUSH], INT],
      [InvertRect, 'InvertRect', 6, [HDC, [RECT]]],
      [FrameRect, 'FrameRect', 8, [HDC, [RECT], HBRUSH], INT],
      [DrawIcon, 'DrawIcon', 8, [HDC, INT, INT, HICON], BOOL],
      [DrawText, 'DrawText', 14, [HDC, LPCSTR, INT, [RECT], UINT], INT],
      [User.stub, 'Bear86', 0],
      [DialogBox, 'DialogBox', 12, [HINSTANCE, LPCSTR, HWND, FARPTR], INT],
      [EndDialog, 'EndDialog', 4, [HWND, INT]],
      [CreateDialog, 'CreateDialog', 12, [HINSTANCE, LPCSTR, HWND, FARPTR], HWND],
      // 90 //
      [IsDialogMessage, 'IsDialogMessage', 6, [HWND, [MSG]], BOOL],
      [GetDlgItem, 'GetDlgItem', 4, [HWND, INT], HWND],
      [SetDlgItemText, 'SetDlgItemText', 8, [HWND, INT, LPCSTR]],
      [GetDlgItemText, 'GetDlgItemText', 10, [HWND, INT, FARPTR, INT], INT],
      [SetDlgItemInt, 'SetDlgItemInt', 8, [HWND, INT, UINT, BOOL]],
      [GetDlgItemInt, 'GetDlgItemInt', 10, [HWND, INT, FARPTR, BOOL], UINT],
      [CheckRadioButton, 'CheckRadioButton', 8, [HWND, INT, INT, INT]],
      [CheckDlgButton, 'CheckDlgButton', 6, [HWND, INT, UINT]],
      [IsDlgButtonChecked, 'IsDlgButtonChecked', 4, [HWND, INT], UINT],
      [DlgDirSelect, 'DlgDirSelect', 8, [HWND, FARPTR, INT], BOOL],
      // 100 //
      [DlgDirList, 'DlgDirList', 12, [HWND, FARPTR, INT, INT, UINT], INT],
      [SendDlgItemMessage, 'SendDlgItemMessage', 12, [HWND, INT, UINT, WPARAM, LPARAM], LRESULT],
      [AdjustWindowRect, 'AdjustWindowRect', 10, [[RECT], DWORD, BOOL]],
      [MapDialogRect, 'MapDialogRect', 6, [HWND, [RECT]]],
      [User.stub, 'MessageBeep', 2],
      [User.stub, 'FlashWindow', 4],
      [GetKeyState, 'GetKeyState', 2, [INT], INT],
      [DefWindowProc, 'DefWindowProc', 10, [HWND, UINT, WPARAM, LPARAM], LONG],
      [GetMessage, 'GetMessage', 10, [[MSG], HWND, UINT, UINT], BOOL],
      [PeekMessage, 'PeekMessage', 12, [[MSG], HWND, UINT, UINT, UINT], BOOL],
      // 110 //
      [PostMessage, 'PostMessage', 10, [HWND, UINT, WPARAM, LPARAM], BOOL],
      [SendMessage, 'SendMessage', 10, [HWND, UINT, WPARAM, LPARAM], LRESULT],
      [User.stub, 'WaitMessage', 0],
      [TranslateMessage, 'TranslateMessage', 4, [[MSG]], BOOL],
      [DispatchMessage, 'DispatchMessage', 4, [[MSG]], LONG],
      [User.stub, 'ReplyMessage', 4],
      [User.stub, 'PostAppMessage', 10],
      [User.stub, 'Unknown'],
      [RegisterWindowMessage, 'RegisterWindowMessage', 4, [LPCSTR], UINT],
      [User.stub, 'GetMessagePos', 0],
      // 120 //
      [User.stub, 'GetMessageTime', 0],
      [SetWindowsHook, 'SetWindowsHook', 6, [INT, FARPTR], DWORD],
      [CallWindowProc, 'CallWindowProc', 14, [FARPTR, HWND, UINT, WPARAM, LPARAM], LRESULT],
      [CallMsgFilter, 'CallMsgFilter', 6, [FARPTR, INT], BOOL],
      [UpdateWindow, 'UpdateWindow', 2, [HWND]],
      [InvalidateRect, 'InvalidateRect', 8, [HWND, [RECT], BOOL]],
      [User.stub, 'InvalidateRgn', 6],
      [ValidateRect, 'ValidateRect', 6, [HWND, FARPTR]],
      [User.stub, 'ValidateRgn', 4],
      [GetClassWord, 'GetClassWord', 4, [HWND, INT], UINT],
      // 130 //
      [SetClassWord, 'SetClassWord', 6, [HWND, INT, UINT], UINT],
      [GetClassLong, 'GetClassLong', 4, [HWND, INT], DWORD],
      [SetClassLong, 'SetClassLong', 8, [HWND, INT, DWORD], DWORD],
      [GetWindowWord, 'GetWindowWord', 4, [HWND, INT], UINT],
      [SetWindowWord, 'SetWindowWord', 6, [HWND, INT, UINT], UINT],
      [GetWindowLong, 'GetWindowLong', 4, [HWND, INT], DWORD],
      [SetWindowLong, 'SetWindowLong', 8, [HWND, INT, DWORD], DWORD],
      [OpenClipboard, 'OpenClipboard', 2, [HWND], BOOL],
      [CloseClipboard, 'CloseClipboard', 0, [], BOOL],
      [EmptyClipboard, 'EmptyClipboard', 0, [], BOOL],
      // 140 //
      [GetClipboardOwner, 'GetClipboardOwner', 0, [], HWND],
      [SetClipboardData, 'SetClipboardData', 4, [UINT, HANDLE], HANDLE],
      [GetClipboardData, 'GetClipboardData', 2, [UINT], HANDLE],
      [CountClipboardFormats, 'CountClipboardFormats', 0, [], INT],
      [EnumClipboardFormats, 'EnumClipboardFormats', 2, [UINT], UINT],
      [RegisterWindowMessage, 'RegisterClipboardFormat', 4, [LPCSTR], UINT],
      [GetClipboardFormatName, 'GetClipboardFormatName', 8, [UINT, FARPTR, INT], INT],
      [SetClipboardViewer, 'SetClipboardViewer', 2, [HWND], HWND],
      [GetClipboardViewer, 'GetClipboardViewer', 0, [], HWND],
      [ChangeClipboardChain, 'ChangeClipboardChain', 4, [HWND, HWND], BOOL],
      // 150 //
      [LoadMenu, 'LoadMenu', 6, [HINSTANCE, LPCSTR], HMENU],
      [CreateMenu, 'CreateMenu', 0, [], HMENU],
      [DestroyMenu, 'DestroyMenu', 2, [HMENU], BOOL],
      [User.stub, 'ChangeMenu', 12],
      [CheckMenuItem, 'CheckMenuItem', 6, [HMENU, UINT, UINT], INT],
      [EnableMenuItem, 'EnableMenuItem', 6, [HMENU, UINT, UINT], BOOL],
      [GetSystemMenu, 'GetSystemMenu', 4, [HWND, BOOL], HMENU],
      [GetMenu, 'GetMenu', 2, [HWND], HMENU],
      [SetMenu, 'SetMenu', 4, [HWND, HMENU], BOOL],
      [GetSubMenu, 'GetSubMenu', 4, [HMENU, INT], HMENU],
      // 160 //
      [DrawMenuBar, 'DrawMenuBar', 2, [HWND]],
      [GetMenuString, 'GetMenuString', 12, [HMENU, UINT, FARPTR, INT, UINT], INT],
      [User.stub, 'HiliteMenuItem', 8],
      [CreateCaret, 'CreateCaret', 8, [HWND, HANDLE, INT, INT]],
      [DestroyCaret, 'DestroyCaret', 0, [], BOOL],
      [SetCaretPos, 'SetCaretPos', 4, [INT, INT]],
      [HideCaret, 'HideCaret', 2, [HWND]],
      [ShowCaret, 'ShowCaret', 2, [HWND]],
      [SetCaretBlinkTime, 'SetCaretBlinkTime', 2, [UINT]],
      [GetCaretBlinkTime, 'GetCaretBlinkTime', 0, [], UINT],
      // 170 //
      [User.stub, 'ArrangeIconicWindows', 2],
      [WinHelp, 'WinHelp', 12, [HWND, LPCSTR, UINT, DWORD], BOOL],
      [User.stub, 'SwitchToThisWindow', 4],
      [LoadCursor, 'LoadCursor', 6, [HINSTANCE, LPCSTR], HCURSOR],
      [LoadIcon, 'LoadIcon', 6, [HINSTANCE, LPCSTR], HICON],
      [LoadBitmap, 'LoadBitmap', 6, [HINSTANCE, LPCSTR], HBITMAP],
      [LoadString, 'LoadString', 10, [HINSTANCE, UINT, FARPTR, INT], INT],
      [LoadAccelerators, 'LoadAccelerators', 6, [HINSTANCE, LPCSTR], HACCEL],
      [TranslateAccelerator, 'TranslateAccelerator', 8, [HWND, HACCEL, [MSG]], BOOL],
      [GetSystemMetrics, 'GetSystemMetrics', 2, [INT], INT],
      // 180 //
      [GetSysColor, 'GetSysColor', 2, [INT], COLORREF],
      [SetSysColors, 'SetSysColors', 10, [INT, FARPTR, FARPTR]],
      [User.stub, 'Bear182', 4],
      [GetCaretPos, 'GetCaretPos', 4, [[POINT]]],
      [User.stub, 'QuerySendMessage', 10],
      [User.stub, 'GrayString', 22],
      [User.stub, 'SwapMouseButton', 2],
      [User.stub, 'EndMenu', 0],
      [User.stub, 'SetSysModalWindow', 2],
      [User.stub, 'GetSysModalWindow', 0],
      // 190 //
      [GetUpdateRect, 'GetUpdateRect', 8, [HWND, [RECT], BOOL], BOOL],
      [User.stub, 'ChildWindowFromPoint', 6],
      [User.stub, 'InSendMessage', 0],
      [IsClipboardFormatAvailable, 'IsClipboardFormatAvailable', 2, [UINT], BOOL],
      [DlgDirSelectComboBox, 'DlgDirSelectComboBox', 8, [HWND, FARPTR, INT], BOOL],
      [DlgDirListComboBox, 'DlgDirListComboBox', 12, [HWND, FARPTR, INT, INT, UINT], INT],
      [User.stub, 'TabbedTextOut', 20],
      [User.stub, 'GetTabbedTextExtent', 14],
      [User.stub, 'CascadeChildWindows', 4],
      [User.stub, 'TileChildWindows', 4],
      // 200 //
      [User.stub, 'OpenComm', 8],
      [User.stub, 'SetCommState', 4],
      [User.stub, 'GetCommState', 6],
      [User.stub, 'GetCommError', 6],
      [User.stub, 'ReadComm', 8],
      [User.stub, 'WriteComm', 8],
      [User.stub, 'TransmitCommChar', 4],
      [User.stub, 'CloseComm', 2],
      [User.stub, 'SetCommEventMask', 4],
      [User.stub, 'GetCommEventMask', 4],
      // 210 //
      [User.stub, 'SetCommBreak', 2],
      [User.stub, 'ClearCommBreak', 2],
      [User.stub, 'UngetCommChar', 4],
      [User.stub, 'BuildCommDCB', 8],
      [User.stub, 'EscapeCommFunction', 4],
      [User.stub, 'FlushComm', 4],
      [User.stub, 'UserSeeUserDo', 8],
      [User.stub, 'LookupMenuHandle', 4],
      [DialogBoxIndirect, 'DialogBoxIndirect', 10, [HINSTANCE, HGLOBAL, HWND, FARPTR], INT],
      [CreateDialogIndirect, 'CreateDialogIndirect', 12, [HINSTANCE, FARPTR, HWND, FARPTR], HWND],
      // 220 //
      [User.stub, 'LoadMenuIndirect', 4],
      [User.stub, 'ScrollDC', 20],
      [User.stub, 'GetKeyboardState', 4],
      [User.stub, 'SetKeyboardState', 4],
      [GetWindowTask, 'GetWindowTask', 2, [HWND], HANDLE],
      [User.stub, 'EnumTaskWindows', 10],
      [User.stub, 'LockInput', 6],
      [GetNextDlgGroupItem, 'GetNextDlgGroupItem', 6, [HWND, HWND, BOOL], HWND],
      [GetNextDlgTabItem, 'GetNextDlgTabItem', 6, [HWND, HWND, BOOL], HWND],
      [GetTopWindow, 'GetTopWindow', 2, [HWND], HWND],
      // 230 //
      [GetNextWindow, 'GetNextWindow', 4, [HWND, UINT], HWND],
      [User.stub, 'GetSystemDebugState', 0],
      [SetWindowPos, 'SetWindowPos', 14, [HWND, HWND, INT, INT, INT, INT, UINT], BOOL],
      [User.stub, 'SetParent', 4],
      [UnhookWindowsHook, 'UnhookWindowsHook', 6, [INT, FARPTR], BOOL],
      [DefHookProc, 'DefHookProc', 12, [INT, WPARAM, LPARAM, FARPTR], DWORD],
      [User.stub, 'GetCapture', 0],
      [User.stub, 'GetUpdateRgn', 6],
      [User.stub, 'ExcludeUpdateRgn', 4],
      [DialogBoxParam, 'DialogBoxParam', 16, [HINSTANCE, LPCSTR, HWND, FARPTR, LPARAM], INT],
      // 240 //
      [
        DialogBoxIndirectParam,
        'DialogBoxIndirectParam',
        14,
        [HINSTANCE, HGLOBAL, HWND, FARPTR, LPARAM],
        INT,
      ],
      [CreateDialogParam, 'CreateDialogParam', 16, [HINSTANCE, LPCSTR, HWND, FARPTR, LPARAM], HWND],
      [
        CreateDialogIndirectParam,
        'CreateDialogIndirectParam',
        16,
        [HINSTANCE, FARPTR, HWND, FARPTR, LPARAM],
        HWND,
      ],
      [GetDialogBaseUnits, 'GetDialogBaseUnits', 0, [], DWORD],
      [EqualRect, 'EqualRect', 8, [[RECT], [RECT]], BOOL],
      [User.stub, 'EnableCommNotification', 8],
      [User.stub, 'ExitWindowsExec', 8],
      [GetCursor, 'GetCursor', 0, [], HCURSOR],
      [GetOpenClipboardWindow, 'GetOpenClipboardWindow', 0, [], HWND],
      [User.stub, 'GetAsyncKeyState', 2],
      // 250 //
      [GetMenuState, 'GetMenuState', 6, [HMENU, UINT, UINT], UINT],
      [User.stub, 'SendDriverMessage', 12],
      [User.stub, 'OpenDriver', 12],
      [User.stub, 'CloseDriver', 10],
      [User.stub, 'GetDriverModuleHandle', 2],
      [User.stub, 'DefDriverProc', 16],
      [User.stub, 'GetDriverInfo', 6],
      [User.stub, 'GetNextDriver', 6],
      [User.stub, 'MapWindowPoints', 10],
      [User.stub, 'BeginDeferWindowPos', 2],
      // 260 //
      [User.stub, 'DeferWindowPos', 16],
      [User.stub, 'EndDeferWindowPos', 2],
      [GetWindow, 'GetWindow', 4, [HWND, UINT], HWND],
      [GetMenuItemCount, 'GetMenuItemCount', 2, [HMENU], INT],
      [GetMenuItemID, 'GetMenuItemId', 4, [HMENU, INT], UINT],
      [User.stub, 'ShowOwnedPopups', 4],
      [User.stub, 'SetMessageQueue', 2],
      [ShowScrollBar, 'ShowScrollBar', 6, [HWND, INT, BOOL]],
      [GlobalAddAtom, 'GlobalAddAtom', 4, [FARPTR], ATOM],
      [GlobalDeleteAtom, 'GlobalDeleteAtom', 2, [ATOM], ATOM],
      // 270 //
      [GlobalFindAtom, 'GlobalFindAtom', 4, [FARPTR], ATOM],
      [GlobalGetAtomName, 'GlobalGetAtomName', 8, [ATOM, FARPTR, INT], UINT],
      [IsZoomed, 'IsZoomed', 2, [HWND], BOOL],
      [User.stub, 'ControlPanelInfo', 8],
      [User.stub, 'GetNextQueueWindow', 4],
      [User.stub, 'RepaintScreen', 0],
      [User.stub, 'LockMyTask', 2],
      [GetDlgCtrlID, 'GetDlgCtrlId', 2, [HWND], INT],
      [User.stub, 'GetDesktopHWnd', 0],
      [User.stub, 'OldSetDeskPattern', 0],
      // 280 //
      [User.stub, 'SetSystemMenu', 4],
      [User.stub, 'Unknown'],
      [SelectPalette, 'SelectPalette', 6, [HDC, HANDLE, BOOL], HANDLE],
      [RealizePalette, 'RealizePalette', 2, [HDC], UINT],
      [User.stub, 'GetFreeSystemResources', 2],
      [User.stub, 'Bear285', 4],
      [GetDesktopWindow, 'GetDesktopWindow', 0, [], HWND],
      [User.stub, 'GetLastActivePopup', 2],
      [User.stub, 'GetMessageExtraInfo', 0],
      [User.stub, 'Keybd_Event', 0],
      // 290 //
      [RedrawWindow, 'RedrawWindow', 10, [HWND, [RECT], HRGN, UINT], BOOL],
      [SetWindowsHookEx, 'SetWindowsHookEx', 10, [INT, FARPTR, HINSTANCE, HANDLE], DWORD],
      [UnhookWindowsHookEx, 'UnhookWindowsHookEx', 4, [DWORD], BOOL],
      [CallNextHookEx, 'CallNextHookEx', 12, [DWORD, INT, WPARAM, LPARAM], LRESULT],
      [User.stub, 'LockWindowUpdate', 2],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Mouse_Event', 0],
      // 300 //
      [User.stub, 'Unknown'],
      [User.stub, 'BozosLiveHere', 10],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Bear306', 10],
      [User.stub, 'Unknown'],
      [DefDlgProc, 'DefDlgProc', 10, [HWND, UINT, WPARAM, LPARAM], LRESULT],
      [User.stub, 'GetClipCursor', 4],
      // 310 //
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'SignalProc', 10],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'ScrollWindowEx', 22],
      // 320 //
      [User.stub, 'SysErrorBox', 14],
      [User.stub, 'SetEventHook', 4],
      [User.stub, 'WinOldAppHackomatic', 4],
      [User.stub, 'GetMessage2', 14],
      [User.stub, 'FillWindow', 8],
      [User.stub, 'PaintRect', 12],
      [User.stub, 'GetControlBrush', 6],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      // 330 //
      [User.stub, 'Unknown'],
      [User.stub, 'EnableHardwareInput', 2],
      [User.stub, 'UserYield', 0],
      [User.stub, 'IsUserIdle', 0],
      [User.stub, 'GetQueueStatus', 2],
      [User.stub, 'GetInputState', 0],
      [User.stub, 'LoadCursorIconHandler', 6],
      [User.stub, 'GetMouseEventProc', 0],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      // 340 //
      [User.stub, 'Unknown'],
      [User.stub, '_FFFE_FARFRAME', 2],
      [User.stub, 'Unknown'],
      [User.stub, 'GetFilePortName', 4],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      // 350 //
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'LoadDibCursorHandler', 6],
      [User.stub, 'LoadDibIconHandler', 6],
      [User.stub, 'IsMenu', 2],
      [User.stub, 'GetDCEx', 8],
      // 360 //
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'DCHook', 12],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [CopyIcon, 'CopyIcon', 4, [HINSTANCE, HICON], HICON],
      [User.stub, 'CopyCursor', 4],
      // 370 //
      [GetWindowPlacement, 'GetWindowPlacement', 6, [HWND, [WINDOWPLACEMENT]], BOOL],
      [SetWindowPlacement, 'SetWindowPlacement', 6, [HWND, [WINDOWPLACEMENT]], BOOL],
      [User.stub, 'GetInternalIconHeader', 8],
      [SubtractRect, 'SubtractRect', 12, [[RECT], [RECT], [RECT]], BOOL],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      // 380 //
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      // 390 //
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      // 400 //
      [User.stub, 'FinalUserInit', 0],
      [User.stub, 'Unknown'],
      [User.stub, 'GetPriorityClipboardFormat', 6],
      [User.stub, 'UnregisterClass', 6],
      [User.stub, 'GetClassInfo', 10],
      [User.stub, 'Unknown'],
      [User.stub, 'CreateCursor', 18],
      [CreateIcon, 'CreateIcon', 18, [HINSTANCE, INT, INT, BYTE, BYTE, FARPTR, FARPTR], HICON],
      [User.stub, 'CreateCursorIconIndirect', 14],
      [User.stub, 'Unknown'],
      // 410 //
      [InsertMenu, 'InsertMenu', 12, [HMENU, UINT, UINT, UINT, LPCSTR], BOOL],
      [AppendMenu, 'AppendMenu', 10, [HMENU, UINT, UINT, LPCSTR], BOOL],
      [RemoveMenu, 'RemoveMenu', 6, [HMENU, UINT, UINT], BOOL],
      [DeleteMenu, 'DeleteMenu', 6, [HMENU, UINT, UINT], BOOL],
      [User.stub, 'ModifyMenu', 12],
      [CreatePopupMenu, 'CreatePopupMenu', 0, [], HMENU],
      [TrackPopupMenu, 'TrackPopupMenu', 16, [HMENU, UINT, INT, INT, INT, HWND, FARPTR], BOOL],
      [User.stub, 'GetMenuCheckmarkDimensions', 0],
      [User.stub, 'SetMenuItemBitmaps', 10],
      [User.stub, 'Unknown'],
      // 420 //
      [wsprintf, '_WSPRINTF', 0, [FARPTR, LPCSTR, VARIADIC], INT],
      [wsprintf, 'WVSPRINTF', 12, [FARPTR, LPCSTR, FARPTR], INT],
      [DlgDirSelectEx, 'DlgDirSelectEx', 10, [HWND, FARPTR, INT, INT], BOOL],
      [DlgDirSelectComboBoxEx, 'DlgDirSelectComboBoxEx', 10, [HWND, FARPTR, INT, INT], BOOL],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      // 430 //
      [lstrcmp, 'lstrcmp', 8, [LPCSTR, LPCSTR], INT],
      [AnsiUpper, 'AnsiUpper', 4, [FARPTR], FARPTR],
      [AnsiLower, 'AnsiLower', 4, [FARPTR], FARPTR],
      [User.stub, 'IsCharAlpha', 2],
      [User.stub, 'IsCharAlphanumeric', 2],
      [User.stub, 'IsCharUpper', 2],
      [User.stub, 'IsCharLower', 2],
      [AnsiUpperBuff, 'AnsiUpperBuff', 6, [FARPTR, UINT], UINT],
      [AnsiLowerBuff, 'AnsiLowerBuff', 6, [FARPTR, UINT], UINT],
      [User.stub, 'Unknown'],
      // 440 //
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [DefFrameProc, 'DefFrameProc', 12, [HWND, HWND, UINT, WPARAM, LPARAM], LONG],
      [User.stub, 'Unknown'],
      [DefMDIChildProc, 'DefMDIChildProc', 10, [HWND, UINT, WPARAM, LPARAM], LONG],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      // 450 //
      [User.stub, 'Unknown'],
      [TranslateMDISysAccel, 'TranslateMDISysAccel', 6, [HWND, [MSG]], BOOL],
      [
        CreateWindowEx,
        'CreateWindowEx',
        34,
        [DWORD, LPCSTR, LPCSTR, DWORD, INT, INT, INT, INT, HWND, HMENU, HINSTANCE, FARPTR],
        HWND,
      ],
      [User.stub, 'Unknown'],
      [AdjustWindowRectEx, 'AdjustWindowRectEx', 14, [[RECT], DWORD, BOOL, DWORD]],
      [User.stub, 'GetIconID', 6],
      [User.stub, 'LoadIconHandler', 4],
      [DestroyIcon, 'DestroyIcon', 2, [HICON], BOOL],
      [User.stub, 'DestroyCursor', 2],
      [User.stub, 'DumpIcon', 16],
      // 460 //
      [User.stub, 'GetInternalWindowPos', 10],
      [User.stub, 'SetInternalWindowPos', 12],
      [CalcChildScroll, 'CalcChildScroll', 4, [HWND, INT]],
      [ScrollChildren, 'ScrollChildren', 10, [HWND, UINT, WPARAM, LPARAM]],
      [User.stub, 'DragObject', 12],
      [User.stub, 'DragDetect', 6],
      [DrawFocusRect, 'DrawFocusRect', 6, [HDC, [RECT]]],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      // 470 //
      [User.stub, 'StringFunc', 8],
      [lstrcmpi, 'lstrcmpi', 8, [LPCSTR, LPCSTR], INT],
      [AnsiNext, 'AnsiNext', 4, [FARPTR], FARPTR],
      [AnsiPrev, 'AnsiPrev', 8, [FARPTR, FARPTR], FARPTR],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      // 480 //
      [User.stub, 'GetUserLocalObjType', 2],
      [User.stub, 'Hardware_Event', 0],
      [EnableScrollBar, 'EnableScrollBar', 6, [HWND, UINT, UINT], BOOL],
      [SystemParametersInfo, 'SystemParametersInfo', 10, [UINT, UINT, FARPTR, UINT], BOOL],
      [User.stub, 'Unknown', 0],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      // 490 //
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'Unknown'],
      [User.stub, 'WNetErrorText', 8],
      // 500 //
      [User.stub, 'Unknown'],
      [User.stub, 'WNetOpenJob', 14],
      [User.stub, 'WNetCloseJob', 10],
      [User.stub, 'WNetAbortJob', 6],
      [User.stub, 'WNetHoldJob', 6],
      [User.stub, 'WNetReleaseJob', 6],
      [User.stub, 'WNetCancelJob', 6],
      [User.stub, 'WNetSetJobCopies', 8],
      [User.stub, 'WNetWatchQueue', 12],
      [User.stub, 'WNetUnwatchQueue', 4],
      // 510 //
      [User.stub, 'WNetLockQueueData', 12],
      [User.stub, 'WNetUnlockQueueData', 4],
      [WNetGetConnection, 'WNetGetConnection', 12, [LPCSTR, FARPTR, FARPTR], UINT],
      [WNetGetCaps, 'WNetGetCaps', 2, [UINT], UINT],
      [User.stub, 'WNetDeviceMode', 2],
      [User.stub, 'WNetBrowseDialog', 8],
      [User.stub, 'WNetGetUser', 8],
      [User.stub, 'WNetAddConnection', 12],
      [User.stub, 'WNetCancelConnection', 6],
      [User.stub, 'WNetGetError', 4],
      // 520 //
      [User.stub, 'WNetGetErrorText', 10],
      [User.stub, 'WNetEnable', 0],
      [User.stub, 'WNetDisable', 0],
      [User.stub, 'WNetRestoreConnection', 6],
      [User.stub, 'WNetWriteJob', 10],
      [User.stub, 'WNetConnectDialog', 4],
      [User.stub, 'WNetDisconnectDialog', 4],
      [User.stub, 'WNetConnectionDialog', 4],
      [User.stub, 'WNetViewQueueDialog', 6],
      [User.stub, 'WNetPropertyDialog', 8],
      // 530 //
      [User.stub, 'WNetGetDirectoryType', 8],
      [User.stub, 'WNetDirectoryNotify', 8],
      [User.stub, 'WNetGetPropertyText', 8],
    ];
  }

  static stub() {
    console.log('Stub called!');
  }
}

/**
 * The **POINT** structure defines the x- and y-coordinates of a point.
 */
export class POINT extends Struct {
  constructor() {
    super([
      ['x', INT],
      ['y', INT],
    ]);
  }
}

/**
 * The **RECT** structure defines the coordinates of the upper-left and lower-
 * right corners of a rectangle.
 */
export class RECT extends Struct {
  constructor() {
    super([
      ['left', INT],
      ['top', INT],
      ['right', INT],
      ['bottom', INT],
    ]);
  }
}

/**
 * The **MSG** structure contains information from the system's application queue.
 */
export class MSG extends Struct {
  declare callback: any;
  declare hwnd: any;
  declare lParam: any;
  declare message: any;
  declare wParam: any;
  constructor() {
    super([
      ['hwnd', HWND],
      ['message', UINT],
      ['wParam', WPARAM],
      ['lParam', LPARAM],
      ['time', DWORD],
      ['pt', POINT],
    ]);
  }
}

/**
 * The **CREATESTRUCT** structure contains information from the system's application queue.
 */
export class CREATESTRUCT extends Struct {
  declare cx: any;
  declare cy: any;
  declare dwExStyle: any;
  declare hInstance: any;
  declare hMenu: any;
  declare hwndParent: any;
  declare lpCreateParams: any;
  declare lpszClass: any;
  declare lpszName: any;
  declare style: any;
  declare x: any;
  declare y: any;
  constructor() {
    super([
      ['lpCreateParams', FARPTR],
      ['hInstance', HINSTANCE],
      ['hMenu', HMENU],
      ['hwndParent', HWND],
      ['cy', INT],
      ['cx', INT],
      ['y', INT],
      ['x', INT],
      ['style', LONG],
      ['lpszName', FARPTR],
      ['lpszClass', FARPTR],
      ['dwExStyle', DWORD],
    ]);
  }
}

/**
 * The **MDICREATESTRUCT** structure contains information about the class,
 * title, owner, location, and size of a multiple document interface (MDI) child
 * window.
 */
export class MDICREATESTRUCT extends Struct {
  declare cx: any;
  declare cy: any;
  declare hOwner: any;
  declare lParam: any;
  declare style: any;
  declare szClass: any;
  declare szTitle: any;
  declare x: any;
  declare y: any;
  constructor() {
    super([
      ['szClass', LPCSTR],
      ['szTitle', LPCSTR],
      ['hOwner', HINSTANCE],
      ['x', INT],
      ['y', INT],
      ['cx', INT],
      ['cy', INT],
      ['style', DWORD],
      ['lParam', LPARAM],
    ]);
  }
}

/**
 * The **MINMAXINFO** structure contains information about a window's maximized
 * size and its minimum and maximum tracking size.
 *
 * @memberof User
 */
export class MINMAXINFO extends Struct {
  constructor() {
    super([
      ['ptReserved', POINT],
      ['ptMaxSize', POINT],
      ['ptMaxPosition', POINT],
      ['ptMinTrackSize', POINT],
      ['ptMaxTrackSize', POINT],
    ]);
  }
}

/**
 * The **MSG** structure contains information from the system's application queue.
 */
export class WINDOWPOS extends Struct {
  declare cx: any;
  declare cy: any;
  declare flags: any;
  declare hwnd: any;
  declare hwndInsertAfter: any;
  declare x: any;
  declare y: any;
  constructor() {
    super([
      ['hwnd', HWND],
      ['hwndInsertAfter', HWND],
      ['x', INT],
      ['y', INT],
      ['cx', INT],
      ['cy', INT],
      ['flags', UINT],
    ]);
  }
}

/**
 * The **WNDCLASS** structure contains window class information.
 */
export class WNDCLASS extends Struct {
  constructor() {
    super([
      ['style', UINT],
      ['lpfnWndProc', WNDPROC],
      ['cbClsExtra', INT],
      ['cbWndExtra', INT],
      ['hInstance', HINSTANCE],
      ['hIcon', HICON],
      ['hCursor', HCURSOR],
      ['hbrBackground', HBRUSH],
      ['lpszMenuName', LPCSTR],
      ['lpszClassName', LPCSTR],
    ]);
  }
}

/**
 * The **PAINTSTRUCT** structure contains information for an application. This
 * information can be used to paint the client area of a window owned by that
 * application.
 */
export class PAINTSTRUCT extends Struct {
  constructor() {
    super([
      ['hdc', HDC],
      ['fErase', BOOL],
      ['rcPaint', RECT],
      ['fRestore', BOOL],
      ['fIncUpdate', BOOL],
      ['rgbReserved0', DWORD],
      ['rgbReserved1', DWORD],
      ['rgbReserved2', DWORD],
      ['rgbReserved3', DWORD],
    ]);
  }
}

// Button Control Styles
// ---------------------

User.BS_PUSHBUTTON = 0x00000000;
User.BS_DEFPUSHBUTTON = 0x00000001;
User.BS_CHECKBOX = 0x00000002;
User.BS_AUTOCHECKBOX = 0x00000003;
User.BS_RADIOBUTTON = 0x00000004;
User.BS_3STATE = 0x00000005;
User.BS_AUTO3STATE = 0x00000006;
User.BS_GROUPBOX = 0x00000007;
User.BS_USERBUTTON = 0x00000008;
User.BS_AUTORADIOBUTTON = 0x00000009;
User.BS_OWNERDRAW = 0x0000000b;
User.BS_LEFTTEXT = 0x00000020;

// Button Control Messages
// -----------------------

User.WM_USER = 0x0400;
User.BM_GETCHECK = User.WM_USER + 0;
User.BM_SETCHECK = User.WM_USER + 1;
User.BM_GETSTATE = User.WM_USER + 2;
User.BM_SETSTATE = User.WM_USER + 3;
User.BM_SETSTYLE = User.WM_USER + 4;

// User Button Notification Codes
// ------------------------------

User.BN_CLICKED = 0;
User.BN_PAINT = 1;
User.BN_HILITE = 2;
User.BN_UNHILITE = 3;
User.BN_DISABLE = 4;
User.BN_DOUBLECLICKED = 5;

// Messages
// --------

User.WM_CREATE = 0x0001;
User.WM_DESTROY = 0x0002;
User.WM_MOVE = 0x0003;
User.WM_SIZE = 0x0005;
User.WM_ACTIVATE = 0x0006;
User.WM_SETFOCUS = 0x0007;
User.WM_KILLFOCUS = 0x0008;
User.WM_SETREDRAW = 0x0008;
User.WM_ENABLE = 0x000a;
User.WM_SETTEXT = 0x000c;
User.WM_GETTEXT = 0x000d;
User.WM_GETTEXTLENGTH = 0x000e;
User.WM_PAINT = 0x000f;
User.WM_CLOSE = 0x0010;
User.WM_QUIT = 0x0012;
User.WM_INITDIALOG = 0x0110;
User.WM_QUERYOPEN = 0x0013;
User.WM_ERASEBKGND = 0x0014;
User.WM_SHOWWINDOW = 0x0018;
User.WM_ACTIVATEAPP = 0x001c;
User.WM_MOUSEACTIVATE = 0x0021;
User.WM_GETMINMAXINFO = 0x0024;
User.WM_ICONERASEBKGND = 0x0027;
User.WM_DRAWITEM = 0x0028;
User.WM_MEASUREITEM = 0x002c;
User.WM_DELETEITEM = 0x002d;
User.WM_SETFONT = 0x0030;
User.WM_GETFONT = 0x0031;
User.WM_QUERYDRAGICON = 0x0037;
User.WM_CTLCOLOR = 0x0019;
User.WM_VKEYTOITEM = 0x002e;
User.WM_CHARTOITEM = 0x002f;
User.WM_COMPAREITEM = 0x0039;
User.WM_WINDOWPOSCHANGING = 0x0046;
User.WM_WINDOWPOSCHANGED = 0x0047;
User.WM_NCCREATE = 0x0081;
User.WM_NCDESTROY = 0x0082;
User.WM_NCCALCSIZE = 0x0083;
User.WM_NCHITTEST = 0x0084;
User.WM_NCPAINT = 0x0085;
User.WM_NCACTIVATE = 0x0086;
User.WM_NCMOUSEMOVE = 0x00a0;
User.WM_NCLBUTTONDOWN = 0x00a1;
User.WM_NCLBUTTONUP = 0x00a2;
User.WM_NCLBUTTONDBLCLK = 0x00a3;
User.WM_NCRBUTTONDOWN = 0x00a4;
User.WM_NCRBUTTONUP = 0x00a5;
User.WM_NCRBUTTONDBLCLK = 0x00a6;
User.WM_NCMBUTTONDOWN = 0x00a7;
User.WM_NCMBUTTONUP = 0x00a8;
User.WM_NCMBUTTONUP = 0x00a9;
User.WM_KEYDOWN = 0x0100;
User.WM_KEYUP = 0x0101;
User.WM_CHAR = 0x0102;
User.WM_DEADCHAR = 0x0103;
User.WM_SYSKEYDOWN = 0x0104;
User.WM_SYSKEYUP = 0x0105;
User.WM_SYSCHAR = 0x0106;
User.WM_SYSDEADCHAR = 0x0107;
User.WM_COMMAND = 0x0111;
User.WM_SYSCOMMAND = 0x0112;
User.WM_TIMER = 0x0113;
User.WM_HSCROLL = 0x0114;
User.WM_VSCROLL = 0x0115;
User.WM_INITMENU = 0x0116;
User.WM_INITMENUPOPUP = 0x0117;
User.WM_MENUSELECT = 0x011f;
User.WM_MENUCHAR = 0x0120;
User.WM_MOUSEMOVE = 0x0200;
User.WM_LBUTTONDOWN = 0x0201;
User.WM_LBUTTONUP = 0x0202;
User.WM_LBUTTONDBLCLK = 0x0203;
User.WM_RBUTTONDOWN = 0x0204;
User.WM_RBUTTONUP = 0x0205;
User.WM_RBUTTONDBLCLK = 0x0206;
User.WM_MBUTTONDOWN = 0x0207;
User.WM_MBUTTONUP = 0x0208;
User.WM_MBUTTONDBLCLK = 0x0209;
User.WM_PARENTNOTIFY = 0x0210;
User.WM_MDICREATE = 0x0220;
User.WM_MDIDESTROY = 0x0221;
User.WM_MDIACTIVATE = 0x0222;
User.WM_MDIRESTORE = 0x0223;
User.WM_MDINEXT = 0x0224;
User.WM_MDIMAXIMIZE = 0x0225;
User.WM_MDITILE = 0x0226;
User.WM_MDICASCADE = 0x0227;
User.WM_MDIICONARRANGE = 0x0228;
User.WM_MDIGETACTIVE = 0x0229;
User.WM_MDISETMENU = 0x0230;
User.WM_DROPFILES = 0x0233;
User.WM_CUT = 0x300;
User.WM_COPY = 0x301;
User.WM_PASTE = 0x302;
User.WM_CLEAR = 0x303;
User.WM_UNDO = 0x304;
User.WM_RENDERFORMAT = 0x0305;
User.WM_RENDERALLFORMATS = 0x0306;
User.WM_DESTROYCLIPBOARD = 0x0307;
// TODO: Clipboard viewer messages
User.WM_QUERYNEWPALETTE = 0x030f;
User.WM_PALETTEISCHANGING = 0x0310;
User.WM_PALETTECHANGED = 0x0311;

// WM_KEYUP/DOWN/CHAR HIWORD(lParam) flags
User.KF_EXTENDED = 0x0100;
User.KF_DLGMODE = 0x0800;
User.KF_MENUMODE = 0x1000;
User.KF_ALTDOWN = 0x2000;
User.KF_REPEAT = 0x4000;
User.KF_UP = 0x8000;

// WM_SIZE message wParam values
User.SIZE_RESTORED = 0;
User.SIZE_MINIMIZED = 1;
User.SIZE_MAXIMIZED = 2;
User.SIZE_MAXSHOW = 3;
User.SIZE_MAXHIDE = 4;

// Key/Mouse States
User.MK_LBUTTON = 0x0001;
User.MK_RBUTTON = 0x0002;
User.MK_SHIFT = 0x0004;
User.MK_CONTROL = 0x0008;
User.MK_MBUTTON = 0x0010;

// ShowWindow flags
User.SW_HIDE = 0x0000;
User.SW_SHOWNORMAL = 0x0001;
User.SW_NORMAL = 0x0001;
User.SW_SHOWMINIMIZED = 0x0002;
User.SW_SHOWMAXIMIZED = 0x0003;
User.SW_MAXIMIZED = 0x0003;
User.SW_MAXIMIZE = 0x0003;
User.SW_SHOWNOACTIVATE = 0x0004;
User.SW_SHOW = 0x0005;
User.SW_MINIMIZE = 0x0006;
User.SW_SHOWMINNOACTIVE = 0x0007;
User.SW_SHOWNA = 0x0008;
User.SW_RESTORE = 0x0009;

// ShowWindow wParam codes (WM_SHOWWINDOW)
User.SW_PARENTCLOSING = 1;
User.SW_OTHERMAXIMIZED = 2;
User.SW_PARENTOPENING = 3;
User.SW_OTHERRESTORED = 4;

// CreateWindow flags
User.CW_USEDEFAULT = -32768;

// Window Styles
User.WS_OVERLAPPED = 0x00000000;
User.WS_POPUP = 0x80000000;
User.WS_CHILD = 0x40000000;
User.WS_CLIPSIBLINGS = 0x04000000;
User.WS_CLIPCHILDREN = 0x02000000;
User.WS_VISIBLE = 0x10000000;
User.WS_DISABLED = 0x08000000;
User.WS_MINIMIZE = 0x20000000;
User.WS_MAXIMIZE = 0x01000000;
User.WS_CAPTION = 0x00c00000;
User.WS_BORDER = 0x00800000;
User.WS_DLGFRAME = 0x00400000;
User.WS_VSCROLL = 0x00200000;
User.WS_HSCROLL = 0x00100000;
User.WS_SYSMENU = 0x00080000;
User.WS_THICKFRAME = 0x00040000;
User.WS_MINIMIZEBOX = 0x00020000;
User.WS_MAXIMIZEBOX = 0x00010000;
User.WS_GROUP = 0x00020000;
User.WS_TABSTOP = 0x00010000;
User.WS_OVERLAPPEDWINDOW =
  User.WS_OVERLAPPED |
  User.WS_CAPTION |
  User.WS_SYSMENU |
  User.WS_THICKFRAME |
  User.WS_MINIMIZEBOX |
  User.WS_MAXIMIZEBOX;
User.WS_POPUPWINDOW = User.WS_POPUP | User.WS_BORDER | User.WS_SYSMENU;
User.WS_CHILDWINDOW = User.WS_CHILD;
User.WS_EX_DLGMODALFRAME = 0x00000001;
User.WS_EX_NOPARENTNOTIFY = 0x00000004;
User.WS_EX_TOPMOST = 0x00000008;
User.WS_EX_ACCEPTFILES = 0x00000010;
User.WS_EX_TRANSPARENT = 0x00000020;

User.WS_TILED = User.WS_OVERLAPPED;
User.WS_ICONIC = User.WS_MINIMIZE;
User.WS_SIZEBOX = User.WS_THICKFRAME;
User.WS_TILEDWINDOW = User.WS_OVERLAPPEDWINDOW;

// PeekMessage flags
User.PM_NOREMOVE = 0x0000;
User.PM_REMOVE = 0x0001;
User.PM_NOYIELD = 0x0002;

// RedrawWindow flags
User.RDW_INVALIDATE = 0x0001;
User.RDW_INTERNALPAINT = 0x0002;
User.RDW_ERASE = 0x0004;
User.RDW_VALIDATE = 0x0008;
User.RDW_NOINTERNALPAINT = 0x0010;
User.RDW_NOERASE = 0x0020;
User.RDW_NOCHILDREN = 0x0040;
User.RDW_ALLCHILDREN = 0x0080;
User.RDW_UPDATENOW = 0x0100;
User.RDW_ERASENOW = 0x0200;
User.RDW_FRAME = 0x0400;
User.RDW_NOFRAME = 0x0800;

// MessageBox Values
// -----------------
User.IDOK = 0x1;
User.IDCANCEL = 0x2;
User.IDABORT = 0x3;
User.IDRETRY = 0x4;
User.IDIGNORE = 0x5;
User.IDYES = 0x6;
User.IDNO = 0x7;

User.MB_OK = 0x0000;
User.MB_OKCANCEL = 0x0001;
User.MB_ABORTRETRYIGNORE = 0x0002;
User.MB_YESNOCANCEL = 0x0003;
User.MB_YESNO = 0x0004;
User.MB_RETRYCANCEL = 0x0005;
User.MB_TYPEMASK = 0x000f;

User.MB_ICONHAND = 0x0010;
User.MB_ICONQUESTION = 0x0020;
User.MB_ICONEXCLAMATION = 0x0030;
User.MB_ICONASTERISK = 0x0040;
User.MB_ICONMASK = 0x00f0;

User.MB_ICONINFORMATION = User.MB_ICONASTERISK;
User.MB_ICONSTOP = User.MB_ICONHAND;

User.MB_DEFBUTTON1 = 0x0000;
User.MB_DEFBUTTON2 = 0x0100;
User.MB_DEFBUTTON3 = 0x0200;
User.MB_DEFMASK = 0x0f00;

User.MB_APPLMODAL = 0x0000;
User.MB_SYSTEMMODAL = 0x1000;
User.MB_TASKMODAL = 0x2000;

User.MB_NOFOCUS = 0x8000;

// SetWindowPos / WINDOWPOS flags
User.SWP_NOSIZE = 0x0001;
User.SWP_NOMOVE = 0x0002;
User.SWP_NOZORDER = 0x0004;
User.SWP_NOREDRAW = 0x0008;
User.SWP_NOACTIVATE = 0x0010;
User.SWP_FRAMECHANGED = 0x0020;
User.SWP_SHOWWINDOW = 0x0040;
User.SWP_HIDEWINDOW = 0x0080;
User.SWP_NOCOPYBITS = 0x0100;
User.SWP_NOOWNERZORDER = 0x0200;
User.SWP_DRAWFRAME = User.SWP_FRAMECHANGED;
User.SWP_NOREPOSITION = User.SWP_NOOWNERZORDER;
User.SWP_NOSENDCHANGING = 0x0400;
User.SWP_DEFERERASE = 0x2000;

// SetWindowPos hwndInsertAfter field values
User.HWND_TOP = 0x0;
User.HWND_BOTTOM = 0x1;
User.HWND_TOPMOST = 0xffff; // -1
User.HWND_NOTOPMOST = 0xfffe; // -2

// WM_ACTIVATE state values
User.WA_INACTIVE = 0x0;
User.WA_ACTIVE = 0x1;
User.WA_CLICKACTIVE = 0x2;

// DialogBox styles
// ----------------

User.DS_ABSALIGN = 0x01;
User.DS_SYSMODAL = 0x02;
User.DS_LOCALEDIT = 0x20;
User.DS_SETFONT = 0x40;
User.DS_MODALFRAME = 0x80;
User.DS_NOIDLEMSG = 0x100;

/* Dialog messages */
User.DM_GETDEFID = User.WM_USER + 0;
User.DM_SETDEFID = User.WM_USER + 1;

// Virtual Key Codes
User.VK_LBUTTON = 0x01;
User.VK_RBUTTON = 0x02;
User.VK_CANCEL = 0x03;
User.VK_MBUTTON = 0x04;
User.VK_BACK = 0x08;
User.VK_TAB = 0x09;
User.VK_CLEAR = 0x0c;
User.VK_RETURN = 0x0d;
User.VK_SHIFT = 0x10;
User.VK_CONTROL = 0x11;
User.VK_MENU = 0x12;
User.VK_PAUSE = 0x13;
User.VK_CAPITAL = 0x14;
User.VK_ESCAPE = 0x1b;
User.VK_SPACE = 0x20;
User.VK_PRIOR = 0x21;
User.VK_NEXT = 0x22;
User.VK_END = 0x23;
User.VK_HOME = 0x24;
User.VK_LEFT = 0x25;
User.VK_UP = 0x26;
User.VK_RIGHT = 0x27;
User.VK_DOWN = 0x28;
User.VK_SELECT = 0x29;
User.VK_PRINT = 0x2a;
User.VK_EXECUTE = 0x2b;
User.VK_SNAPSHOT = 0x2c;
User.VK_INSERT = 0x2d;
User.VK_DELETE = 0x2e;
User.VK_HELP = 0x2f;
User.VK_NUMPAD0 = 0x60;
User.VK_NUMPAD1 = 0x61;
User.VK_NUMPAD2 = 0x62;
User.VK_NUMPAD3 = 0x63;
User.VK_NUMPAD4 = 0x64;
User.VK_NUMPAD5 = 0x65;
User.VK_NUMPAD6 = 0x66;
User.VK_NUMPAD7 = 0x67;
User.VK_NUMPAD8 = 0x68;
User.VK_NUMPAD9 = 0x69;
User.VK_MULTIPLY = 0x6a;
User.VK_ADD = 0x6b;
User.VK_SEPARATOR = 0x6c;
User.VK_SUBTRACT = 0x6d;
/* The system metrics, by their documented index. Several of these follow from
 * the display driver rather than from Windows; see win16/display-modes.ts.
 */
User.SM_CXSCREEN = 0;
User.SM_CYSCREEN = 1;
User.SM_CYCAPTION = 4;
User.SM_CXBORDER = 5;
User.SM_CYBORDER = 6;
User.SM_CXICON = 11;
User.SM_CYICON = 12;
User.SM_CYMENU = 15;
User.SM_CXFULLSCREEN = 16;
User.SM_CYFULLSCREEN = 17;
User.SM_CXFRAME = 32;
User.SM_CYFRAME = 33;

User.VK_DECIMAL = 0x6e;
User.VK_DIVIDE = 0x6f;
User.VK_F1 = 0x70;
User.VK_F2 = 0x71;
User.VK_F3 = 0x72;
User.VK_F4 = 0x73;
User.VK_F5 = 0x74;
User.VK_F6 = 0x75;
User.VK_F7 = 0x76;
User.VK_F8 = 0x77;
User.VK_F9 = 0x78;
User.VK_F10 = 0x79;
User.VK_F11 = 0x7a;
User.VK_F12 = 0x7b;
User.VK_F13 = 0x7c;
User.VK_F14 = 0x7d;
User.VK_F15 = 0x7e;
User.VK_F16 = 0x7f;
User.VK_F17 = 0x80;
User.VK_F18 = 0x81;
User.VK_F19 = 0x82;
User.VK_F20 = 0x83;
User.VK_F21 = 0x84;
User.VK_F22 = 0x85;
User.VK_F23 = 0x86;
User.VK_F24 = 0x87;
User.VK_NUMLOCK = 0x90;
User.VK_SCROLL = 0x91;

// Virtual key translation
User.VIRTUAL_KEY_TRANSLATE = {
  Enter: User.VK_RETURN,
  NumpadEnter: User.VK_RETURN,
  Space: User.VK_SPACE,
  Escape: User.VK_ESCAPE,
  F1: User.VK_F1,
  F2: User.VK_F2,
  F3: User.VK_F3,
  F4: User.VK_F4,
  F5: User.VK_F5,
  F6: User.VK_F6,
  F7: User.VK_F7,
  F8: User.VK_F8,
  F9: User.VK_F9,
  F10: User.VK_F10,
  F11: User.VK_F11,
  F12: User.VK_F12,
  F13: User.VK_F13,
  F14: User.VK_F14,
  F15: User.VK_F15,
  F16: User.VK_F16,
  F17: User.VK_F17,
  F18: User.VK_F18,
  F19: User.VK_F19,
  F20: User.VK_F20,
  F21: User.VK_F21,
  F22: User.VK_F22,
  F23: User.VK_F23,
  F24: User.VK_F24,
  NumLock: User.VK_NUMLOCK,
  ScrollLock: User.VK_SCROLL,
  Backspace: User.VK_BACK,
  Tab: User.VK_TAB,
  Clear: User.VK_CLEAR,
  ShiftLeft: User.VK_SHIFT,
  ControlLeft: User.VK_CONTROL,
  ContextMenu: User.VK_MENU,
  Pause: User.VK_PAUSE,
  CapsLock: User.VK_CAPITAL,
  PageUp: User.VK_PRIOR,
  PageDown: User.VK_NEXT,
  End: User.VK_END,
  Home: User.VK_HOME,
  ArrowLeft: User.VK_LEFT,
  ArrowUp: User.VK_UP,
  ArrowRight: User.VK_RIGHT,
  ArrowDown: User.VK_DOWN,
  PrintScreen: User.VK_PRINT,
  Insert: User.VK_INSERT,
  Delete: User.VK_DELETE,
  Numpad0: User.VK_NUMPAD0,
  Numpad1: User.VK_NUMPAD1,
  Numpad2: User.VK_NUMPAD2,
  Numpad3: User.VK_NUMPAD3,
  Numpad4: User.VK_NUMPAD4,
  Numpad5: User.VK_NUMPAD5,
  Numpad6: User.VK_NUMPAD6,
  Numpad7: User.VK_NUMPAD7,
  Numpad8: User.VK_NUMPAD8,
  Numpad9: User.VK_NUMPAD9,
  NumpadMultiply: User.VK_MULTIPLY,
  NumpadAdd: User.VK_ADD,
  NumpadSubtract: User.VK_SUBTRACT,
  NumpadDecimal: User.VK_DECIMAL,
  NumpadDivide: User.VK_DIVIDE,
  ShiftRight: User.VK_SHIFT,
  ControlRight: User.VK_CONTROL,
  /* The keys that are not letters, digits or named, as the US keyboard
   * driver gives them: `KEYBOARD.DRV`'s table of a virtual key for each scan
   * code, at file offset `12ee`, read at the scan code each of these keys
   * sends -- `-` 0Ch, `=` 0Dh, `[` 1Ah, `]` 1Bh, `;` 27h, `'` 28h, `` ` ``
   * 29h, `\` 2Bh, `,` 33h, `.` 34h, `/` 35h, and the 102nd key 56h. */
  Minus: 0xbd,
  Equal: 0xbb,
  BracketLeft: 0xdb,
  BracketRight: 0xdd,
  Semicolon: 0xba,
  Quote: 0xde,
  Backquote: 0xc0,
  Backslash: 0xdc,
  Comma: 0xbc,
  Period: 0xbe,
  Slash: 0xbf,
  IntlBackslash: 0xe2,
  /*
    '': User.VK_SEPARATOR,
    '': User.VK_SELECT, // (sometimes 'enter')
    '': User.VK_EXECUTE,
    '': User.VK_SNAPSHOT,
    '': User.VK_HELP,*/
};
