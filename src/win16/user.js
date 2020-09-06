"use strict";

/** @namespace User */

import { Module } from './module.js';

import { BYTE, UBYTE, INT, UINT, LONG, ULONG,
         DWORD, HLOCAL, HGLOBAL, HANDLE, ATOM, LRESULT,
         HMENU, HINSTANCE, WPARAM, LPARAM, HDC, HRGN,
         HBRUSH, HICON, HCURSOR, WNDPROC, VARIADIC, HBITMAP,
         BOOL, NEARPTR, FARPTR, LPCSTR, HWND, Struct } from './types.js';

import { BeginPaint } from './user/BeginPaint.js';
import { CreateWindow } from './user/CreateWindow.js';
import { DefWindowProc } from './user/DefWindowProc.js';
import { DispatchMessage } from './user/DispatchMessage.js';
import { EndPaint } from './user/EndPaint.js';
import { FillRect } from './user/FillRect.js';
import { FindWindow } from './user/FindWindow.js';
import { FrameRect } from './user/FrameRect.js';
import { GetDC } from './user/GetDC.js';
import { GetMessage } from './user/GetMessage.js';
import { GetTickCount } from './user/GetTickCount.js';
import { GetClientRect } from './user/GetClientRect.js';
import { GetWindowRect } from './user/GetWindowRect.js';
import { InitApp } from './user/InitApp.js';
import { LoadBitmap } from './user/LoadBitmap.js';
import { LoadString } from './user/LoadString.js';
import { MessageBox } from './user/MessageBox.js';
import { MoveWindow } from './user/MoveWindow.js';
import { PeekMessage } from './user/PeekMessage.js';
import { RegisterClass } from './user/RegisterClass.js';
import { RedrawWindow } from './user/RedrawWindow.js';
import { ReleaseDC } from './user/ReleaseDC.js';
import { SetFocus } from './user/SetFocus.js';
import { SetWindowText } from './user/SetWindowText.js';
import { ShowWindow } from './user/ShowWindow.js';
import { TranslateMessage } from './user/TranslateMessage.js';
import { UpdateWindow } from './user/UpdateWindow.js';
import { wsprintf } from './user/wsprintf.js';

/**
 * The Win16 User library.
 *
 * @memberof Win16
 */
export class User extends Module {
    static get name() {
        return "USER";
    }

    static get exports() {
        return [
            // 0 //
            null,
            [MessageBox, "MessageBox", 12, [HWND, LPCSTR, LPCSTR, UINT], INT],
            [User.stub, "OldExitWindows", 0],
            [User.stub, "EnableOEMLayer", 0],
            [User.stub, "DisableOEMLayer", 0],
            [InitApp, "InitApp", 2, [HANDLE], BOOL],
            [User.stub, "PostQuitMessage", 0],
            [User.stub, "ExitWindows", 6],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            // 10 //
            [User.stub, "SetTimer", 10],
            [User.stub, "Bear11", 10],
            [User.stub, "KillTimer", 4],
            [GetTickCount, "GetTickCount", 0, [], DWORD],
            [User.stub, "GetTimerResolution", 0],
            [User.stub, "GetCurrentTime", 0],
            [User.stub, "ClipCursor", 4],
            [User.stub, "GetCursorPos", 4],
            [User.stub, "SetCapture", 2],
            [User.stub, "ReleaseCapture", 0],
            // 20 //
            [User.stub, "SetDoubleClickTime", 0],
            [User.stub, "GetDoubleClickTime", 0],
            [SetFocus, "SetFocus", 2, [HWND], HWND],
            [User.stub, "GetFocus", 0],
            [User.stub, "RemoveProp", 6],
            [User.stub, "GetProp", 6],
            [User.stub, "SetProp", 8],
            [User.stub, "EnumProps", 6],
            [User.stub, "ClientToScreen", 6],
            [User.stub, "ScreenToClient", 6],
            // 30 //
            [User.stub, "WindowFromPoint", 4],
            [User.stub, "IsIconic", 0],
            [GetWindowRect, "GetWindowRect", 6, [HWND, [RECT]]],
            [GetClientRect, "GetClientRect", 6, [HWND, [RECT]]],
            [User.stub, "EnableWindow", 4],
            [User.stub, "IsWindowEnabled", 0],
            [User.stub, "GetWindowText", 8],
            [SetWindowText, "SetWindowText", 6, [HWND, LPCSTR]],
            [User.stub, "GetWindowTextLength", 2],
            [BeginPaint, "BeginPaint", 6, [HWND, [PAINTSTRUCT]], HDC],
            // 40 //
            [EndPaint, "EndPaint", 6, [HWND, [PAINTSTRUCT]]],
            [CreateWindow, "CreateWindow", 30, [LPCSTR, LPCSTR, DWORD, INT, INT, INT, INT, HWND, HMENU, HINSTANCE, FARPTR], HWND],
            [ShowWindow, "ShowWindow", 4, [HWND, INT], BOOL],
            [User.stub, "CloseWindow", 2],
            [User.stub, "OpenIcon", 2],
            [User.stub, "BringWindowToTop", 2],
            [User.stub, "GetParent", 2],
            [User.stub, "IsWindow", 0],
            [User.stub, "IsChild", 0],
            [User.stub, "IsWindowVisible", 0],
            // 50 //
            [FindWindow, "FindWindow", 8, [LPCSTR, LPCSTR], HWND],
            [User.stub, "Bear51", 2],
            [User.stub, "AnyPopUp", 0],
            [User.stub, "DestroyWindow", 2],
            [User.stub, "EnumWindows", 8],
            [User.stub, "EnumChildWindows", 10],
            [MoveWindow, "MoveWindow", 12, [HWND, INT, INT, INT, INT, BOOL], BOOL],
            [RegisterClass, "RegisterClass", 4, [WNDCLASS], ATOM],
            [User.stub, "GetClassName", 8],
            [User.stub, "SetActiveWindow", 2],
            // 60 //
            [User.stub, "GetActiveWindow", 0],
            [User.stub, "ScrollWindow", 14],
            [User.stub, "SetScrollPos", 8],
            [User.stub, "GetScrollPos", 4],
            [User.stub, "SetScrollRange", 10],
            [User.stub, "GetScrollRange", 12],
            [GetDC, "GetDC", 2, [HWND], HDC],
            [User.stub, "GetWindowDC", 2],
            [ReleaseDC, "ReleaseDC", 4, [HWND, HDC], INT],
            [User.stub, "SetCursor", 2],
            // 70 //
            [User.stub, "SetCursorPos", 0],
            [User.stub, "ShowCursor", 2],
            [User.stub, "SetRect", 12],
            [User.stub, "SetRectEmpty", 0],
            [User.stub, "CopyRect", 8],
            [User.stub, "IsRectEmpty", 0],
            [User.stub, "PtInRect", 8],
            [User.stub, "OffsetRect", 8],
            [User.stub, "InflateRect", 8],
            [User.stub, "IntersectRect", 12],
            // 80 //
            [User.stub, "UnionRect", 12],
            [FillRect, "FillRect", 8, [HDC, [RECT], HBRUSH], INT],
            [User.stub, "InvertRect", 6],
            [FrameRect, "FrameRect", 8, [HDC, [RECT], HBRUSH], INT],
            [User.stub, "DrawIcon", 8],
            [User.stub, "DrawText", 14],
            [User.stub, "Bear86", 0],
            [User.stub, "DialogBox", 12],
            [User.stub, "EndDialog", 4],
            [User.stub, "CreateDialog", 12],
            // 90 //
            [User.stub, "IsDialogMessage", 6],
            [User.stub, "GetDlgItem", 4],
            [User.stub, "SetDlgItemText", 8],
            [User.stub, "GetDlgItemText", 10],
            [User.stub, "SetDlgItemInt", 8],
            [User.stub, "GetDlgItemInt", 10],
            [User.stub, "CheckRadioButton", 8],
            [User.stub, "CheckDlgButton", 6],
            [User.stub, "IsDlgButtonChecked", 4],
            [User.stub, "DlgDirSelect", 8],
            // 100 //
            [User.stub, "DlgDirList", 12],
            [User.stub, "SendDlgItemMessage", 12],
            [User.stub, "AdjustWindowRect", 10],
            [User.stub, "MapDialogRect", 6],
            [User.stub, "MessageBeep", 2],
            [User.stub, "FlashWindow", 4],
            [User.stub, "GetKeyState", 0],
            [DefWindowProc, "DefWindowProc", 10, [HWND, UINT, WPARAM, LPARAM], LRESULT],
            [GetMessage, "GetMessage", 10, [[MSG], HWND, UINT, UINT], BOOL],
            [PeekMessage, "PeekMessage", 12, [[MSG], HWND, UINT, UINT, UINT], BOOL],
            // 110 //
            [User.stub, "PostMessage", 10],
            [User.stub, "SendMessage", 10],
            [User.stub, "WaitMessage", 0],
            [TranslateMessage, "TranslateMessage", 4, [[MSG]], BOOL],
            [DispatchMessage, "DispatchMessage", 4, [[MSG]], LONG],
            [User.stub, "ReplyMessage", 4],
            [User.stub, "PostAppMessage", 10],
            [User.stub, "Unknown"],
            [User.stub, "RegisterWindowMessage", 4],
            [User.stub, "GetMessagePos", 0],
            // 120 //
            [User.stub, "GetMessageTime", 0],
            [User.stub, "SetWindowsHook", 6],
            [User.stub, "CallWindowProc", 14],
            [User.stub, "CallMsgFilter", 6],
            [UpdateWindow, "UpdateWindow", 2, [HWND]],
            [User.stub, "InvalidateRect", 8],
            [User.stub, "InvalidateRgn", 6],
            [User.stub, "ValidateRect", 6],
            [User.stub, "ValidateRgn", 4],
            [User.stub, "GetClassWord", 4],
            // 130 //
            [User.stub, "SetClassWord", 6],
            [User.stub, "GetClassLong", 4],
            [User.stub, "SetClassLong", 8],
            [User.stub, "GetWindowWord", 4],
            [User.stub, "SetWindowWord", 6],
            [User.stub, "GetWindowLong", 4],
            [User.stub, "SetWindowLong", 8],
            [User.stub, "OpenClipboard", 2],
            [User.stub, "CloseClipboard", 0],
            [User.stub, "EmptyClipboard", 0],
            // 140 //
            [User.stub, "GetClipboardOwner", 0],
            [User.stub, "SetClipboardData", 4],
            [User.stub, "GetClipboardData", 2],
            [User.stub, "CountClipboardFormats", 0],
            [User.stub, "EnumClipboardFormats", 2],
            [User.stub, "RegisterClipboardFormat", 4],
            [User.stub, "GetClipboardFormatName", 8],
            [User.stub, "SetClipboardViewer", 2],
            [User.stub, "GetClipboardViewer", 0],
            [User.stub, "ChangeClipboardChain", 4],
            // 150 //
            [User.stub, "LoadMenu", 6],
            [User.stub, "CreateMenu", 0],
            [User.stub, "DestroyMenu", 2],
            [User.stub, "ChangeMenu", 12],
            [User.stub, "CheckMenuItem", 6],
            [User.stub, "EnableMenuItem", 6],
            [User.stub, "GetSystemMenu", 4],
            [User.stub, "GetMenu", 2],
            [User.stub, "SetMenu", 4],
            [User.stub, "GetSubMenu", 4],
            // 160 //
            [User.stub, "DrawMenuBar", 2],
            [User.stub, "GetMenuString", 12],
            [User.stub, "HiliteMenuItem", 8],
            [User.stub, "CreateCaret", 8],
            [User.stub, "DestroyCaret", 0],
            [User.stub, "SetCaretPos", 4],
            [User.stub, "HideCaret", 2],
            [User.stub, "ShowCaret", 2],
            [User.stub, "SetCaretBlinkTime", 2],
            [User.stub, "GetCaretBlinkTime", 0],
            // 170 //
            [User.stub, "ArrangeIconicWindows", 2],
            [User.stub, "WinHelp", 12],
            [User.stub, "SwitchToThisWindow", 4],
            [User.stub, "LoadCursor", 6],
            [User.stub, "LoadIcon", 6],
            [LoadBitmap, "LoadBitmap", 6, [HINSTANCE, DWORD], HBITMAP],
            [LoadString, "LoadString", 10, [HINSTANCE, UINT, FARPTR, INT], INT],
            [User.stub, "LoadAccelerators", 6],
            [User.stub, "TranslateAccelerator", 8],
            [User.stub, "GetSystemMetrics", 2],
            // 180 //
            [User.stub, "GetSysColor", 0],
            [User.stub, "SetSysColors", 10],
            [User.stub, "Bear182", 4],
            [User.stub, "GetCaretPos", 4],
            [User.stub, "QuerySendMessage", 10],
            [User.stub, "GrayString", 22],
            [User.stub, "SwapMouseButton", 0],
            [User.stub, "EndMenu", 0],
            [User.stub, "SetSysModalWindow", 2],
            [User.stub, "GetSysModalWindow", 0],
            // 190 //
            [User.stub, "GetUpdateRect", 8],
            [User.stub, "ChildWindowFromPoint", 6],
            [User.stub, "InSendMessage", 0],
            [User.stub, "IsClipboardFormatAvailable", 2],
            [User.stub, "DlgDirSelectComboBox", 8],
            [User.stub, "DlgDirListComboBox", 12],
            [User.stub, "TabbedTextOut", 20],
            [User.stub, "GetTabbedTextExtent", 14],
            [User.stub, "CascadeChildWindows", 4],
            [User.stub, "TileChildWindows", 4],
            // 200 //
            [User.stub, "OpenComm", 8],
            [User.stub, "SetCommState", 4],
            [User.stub, "GetCommState", 6],
            [User.stub, "GetCommError", 6],
            [User.stub, "ReadComm", 8],
            [User.stub, "WriteComm", 8],
            [User.stub, "TransmitCommChar", 4],
            [User.stub, "CloseComm", 2],
            [User.stub, "SetCommEventMask", 4],
            [User.stub, "GetCommEventMask", 4],
            // 210 //
            [User.stub, "SetCommBreak", 2],
            [User.stub, "ClearCommBreak", 2],
            [User.stub, "UngetCommChar", 4],
            [User.stub, "BuildCommDCB", 8],
            [User.stub, "EscapeCommFunction", 4],
            [User.stub, "FlushComm", 4],
            [User.stub, "UserSeeUserDo", 8],
            [User.stub, "LookupMenuHandle", 4],
            [User.stub, "DialogBoxIndirect", 10],
            [User.stub, "CreateDialogIndirect", 12],
            // 220 //
            [User.stub, "LoadMenuIndirect", 4],
            [User.stub, "ScrollDC", 20],
            [User.stub, "GetKeyboardState", 4],
            [User.stub, "SetKeyboardState", 4],
            [User.stub, "GetWindowTask", 2],
            [User.stub, "EnumTaskWindows", 10],
            [User.stub, "LockInput", 6],
            [User.stub, "GetNextDlgGroupItem", 6],
            [User.stub, "GetNextDlgTabItem", 6],
            [User.stub, "GetTopWindow", 2],
            // 230 //
            [User.stub, "GetNextWindow", 4],
            [User.stub, "GetSystemDebugState", 0],
            [User.stub, "SetWindowPos", 14],
            [User.stub, "SetParent", 4],
            [User.stub, "UnhookWindowsHook", 6],
            [User.stub, "DefHookProc", 12],
            [User.stub, "GetCapture", 0],
            [User.stub, "GetUpdateRgn", 6],
            [User.stub, "ExcludeUpdateRgn", 4],
            [User.stub, "DialogBoxParam", 16],
            // 240 //
            [User.stub, "DialogBoxIndirectParam", 14],
            [User.stub, "CreateDialogParam", 16],
            [User.stub, "CreateDialogIndirectParam", 16],
            [User.stub, "GetDialogBaseUnits", 0],
            [User.stub, "EqualRect", 8],
            [User.stub, "EnableCommNotification", 8],
            [User.stub, "ExitWindowsExec", 8],
            [User.stub, "GetCursor", 0],
            [User.stub, "GetOpenClipboardWindow", 0],
            [User.stub, "GetAsyncKeyState", 0],
            // 250 //
            [User.stub, "GetMenuState", 6],
            [User.stub, "SendDriverMessage", 12],
            [User.stub, "OpenDriver", 12],
            [User.stub, "CloseDriver", 10],
            [User.stub, "GetDriverModuleHandle", 2],
            [User.stub, "DefDriveProc", 16],
            [User.stub, "GetDriverInfo", 6],
            [User.stub, "GetNextDriver", 6],
            [User.stub, "MapWindowPoints", 10],
            [User.stub, "BeginDeferWindowPos", 2],
            // 260 //
            [User.stub, "DeferWindowPos", 16],
            [User.stub, "EndDeferWindowPos", 2],
            [User.stub, "GetWindow", 4],
            [User.stub, "GetMenuItemCount", 2],
            [User.stub, "GetMenuItemId", 4],
            [User.stub, "ShowOwnedPopups", 4],
            [User.stub, "SetMessageQueue", 2],
            [User.stub, "ShowScrollBar", 6],
            [User.stub, "GlobalAddAtom", 4],
            [User.stub, "GlobalDeleteAtom", 2],
            // 270 //
            [User.stub, "GlobalFindAtom", 4],
            [User.stub, "GlobalGetAtomName", 8],
            [User.stub, "IsZoomed", 0],
            [User.stub, "ControlPanelInfo", 8],
            [User.stub, "GetNextQueueWindow", 4],
            [User.stub, "RepaintScreen", 0],
            [User.stub, "LockMyTask", 2],
            [User.stub, "GetDlgCtrlId", 2],
            [User.stub, "GetDesktopHWnd", 0],
            [User.stub, "OldSetDeskPattern", 0],
            // 280 //
            [User.stub, "SetSystemMenu", 4],
            [User.stub, "Unknown"],
            [User.stub, "SelectPalette", 6],
            [User.stub, "RealizePalette", 2],
            [User.stub, "GetFreeSystemResources", 2],
            [User.stub, "Bear285", 4],
            [User.stub, "GetDesktopWindow", 0],
            [User.stub, "GetLastActivePopup", 2],
            [User.stub, "GetMessageExtraInfo", 0],
            [User.stub, "Keybd_Event", 0],
            // 290 //
            [RedrawWindow, "RedrawWindow", 10, [HWND, [RECT], HRGN, UINT], BOOL],
            [User.stub, "SetWindowsHookEx", 10],
            [User.stub, "UnhookWindowsHookEx", 4],
            [User.stub, "CallNextHookEx", 12],
            [User.stub, "LockWindowUpdate", 2],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "Mouse_Event", 0],
            // 300 //
            [User.stub, "Unknown"],
            [User.stub, "BozosLiveHere", 10],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "Bear306", 10],
            [User.stub, "Unknown"],
            [User.stub, "DefDlgProc", 10],
            [User.stub, "GetClipCursor", 4],
            // 310 //
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "SignalProc", 10],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "ScrollWindowEx", 22],
            // 320 //
            [User.stub, "SysErrorBox", 14],
            [User.stub, "SetEventHook", 4],
            [User.stub, "WinOldAppHackomatic", 10],
            [User.stub, "GetMessage2", 14],
            [User.stub, "FillWindow", 8],
            [User.stub, "PaintRect", 12],
            [User.stub, "GetControlBrush", 6],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            // 330 //
            [User.stub, "Unknown"],
            [User.stub, "EnableHardwareInput", 0],
            [User.stub, "UserYield", 0],
            [User.stub, "IsUserIdle", 0],
            [User.stub, "GetQueueStatus", 0],
            [User.stub, "GetInputState", 0],
            [User.stub, "LoadCursorIconHandler", 6],
            [User.stub, "GetMouseEventProc", 0],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            // 340 //
            [User.stub, "Unknown"],
            [User.stub, "_FFFE_FARFRAME", 2],
            [User.stub, "Unknown"],
            [User.stub, "GetFilePortName", 4],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            // 350 //
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "LoadDibCursorHandler", 6],
            [User.stub, "LoadDibIconHandler", 6],
            [User.stub, "IsMenu", 0],
            [User.stub, "GetDCEx", 8],
            // 360 //
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "DCHook", 12],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "CopyIcon", 4],
            [User.stub, "CopyCursor", 4],
            // 370 //
            [User.stub, "GetWindowPlacement", 6],
            [User.stub, "SetWindowPlacement", 6],
            [User.stub, "GetInternalIconHeader", 8],
            [User.stub, "SubtractRect", 12],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            // 380 //
            [User.stub, "Unknown"], [User.stub, "Unknown"],
            [User.stub, "Unknown"], [User.stub, "Unknown"],
            [User.stub, "Unknown"], [User.stub, "Unknown"],
            [User.stub, "Unknown"], [User.stub, "Unknown"],
            [User.stub, "Unknown"], [User.stub, "Unknown"],
            // 390 //
            [User.stub, "Unknown"], [User.stub, "Unknown"],
            [User.stub, "Unknown"], [User.stub, "Unknown"],
            [User.stub, "Unknown"], [User.stub, "Unknown"],
            [User.stub, "Unknown"], [User.stub, "Unknown"],
            [User.stub, "Unknown"], [User.stub, "Unknown"],
            // 400 //
            [User.stub, "FinalUserInit", 0],
            [User.stub, "Unknown"],
            [User.stub, "GetPriorityClipboardFormat", 6],
            [User.stub, "UnregisterClass", 6],
            [User.stub, "GetClassInfo", 10],
            [User.stub, "Unknown"],
            [User.stub, "CreateCursor", 18],
            [User.stub, "CreateIcon", 18],
            [User.stub, "CreateCursorIconIndirect", 14],
            [User.stub, "Unknown"],
            // 410 //
            [User.stub, "InsertMenu", 12],
            [User.stub, "AppendMenu", 10],
            [User.stub, "RemoveMenu", 6],
            [User.stub, "DeleteMenu", 6],
            [User.stub, "ModifyMenu", 12],
            [User.stub, "CreatePopupMenu", 0],
            [User.stub, "TrackPopupMenu", 16],
            [User.stub, "GetMenuCheckmarkDimensions", 0],
            [User.stub, "SetMenuItemBitmaps", 10],
            [User.stub, "Unknown"],
            // 420 //
            [wsprintf, "_WSPRINTF", 0, [FARPTR, LPCSTR, VARIADIC], INT],
            [wsprintf, "WVSPRINTF", 12, [FARPTR, LPCSTR, FARPTR], INT],
            [User.stub, "DlgDirSelectEx", 10],
            [User.stub, "DlgDirSelectComboBoxEx", 10],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            // 430 //
            [User.stub, "LSTRCMP", 8],
            [User.stub, "AnsiUpper", 4],
            [User.stub, "AnsiLower", 4],
            [User.stub, "IsCharAlpha", 2],
            [User.stub, "IsCharAlphanumeric", 2],
            [User.stub, "IsCharUpper", 2],
            [User.stub, "IsCharLower", 2],
            [User.stub, "AnsiUpperBuff", 6],
            [User.stub, "AnsiLowerBuff", 6],
            [User.stub, "Unknown"],
            // 440 //
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "DefFrameProc", 12],
            [User.stub, "Unknown"],
            [User.stub, "DefMDIChildProc", 10],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            // 450 //
            [User.stub, "Unknown"],
            [User.stub, "TranslateMDISysAccel",  6],
            [User.stub, "CreateWindowEx", 34],
            [User.stub, "Unknown"],
            [User.stub, "AdjustWindowRectEx", 14],
            [User.stub, "GetIconID", 6],
            [User.stub, "LoadIconHandler", 4],
            [User.stub, "DestroyIcon", 2],
            [User.stub, "DestroyCursor", 2],
            [User.stub, "DumpIcon", 16],
            // 460 //
            [User.stub, "GetInternalWindowPos", 10],
            [User.stub, "SetInternalWindowPos", 12],
            [User.stub, "CalcChildScroll", 4],
            [User.stub, "ScrollChildren", 10],
            [User.stub, "DragObject", 12],
            [User.stub, "DragDetect", 6],
            [User.stub, "DrawFocusRect", 6],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            // 470 //
            [User.stub, "StringFunc", 8],
            [User.stub, "LSTRCMPI", 8],
            [User.stub, "AnsiNext", 4],
            [User.stub, "AnsiPrev", 8],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            // 480 //
            [User.stub, "GetUserLocalObjType", 2],
            [User.stub, "Hardware_Event", 0],
            [User.stub, "EnableScrollBar", 6],
            [User.stub, "SystemParametersInfo", 10],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            // 490 //
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "Unknown"],
            [User.stub, "WNetErrorText", 8],
            // 500 //
            [User.stub, "Unknown"],
            [User.stub, "WNetOpenJob", 14],
            [User.stub, "WNetCloseJob", 10],
            [User.stub, "WNetAbortJob", 6],
            [User.stub, "WNetHoldJob", 6],
            [User.stub, "WNetReleaseJob", 6],
            [User.stub, "WNetCancelJob", 6],
            [User.stub, "WNetSetJobCopies", 8],
            [User.stub, "WNetWatchQueue", 12],
            [User.stub, "WNetUnwatchQueue", 4],
            // 510 //
            [User.stub, "WNetLockQueueData", 12],
            [User.stub, "WNetUnlockQueueData", 4],
            [User.stub, "WNetGetConnection", 12],
            [User.stub, "WNetGetCaps", 2],
            [User.stub, "WNetDeviceMode", 2],
            [User.stub, "WNetBrowseDialog", 8],
            [User.stub, "WNetGetUser", 8],
            [User.stub, "WNetAddConnection", 12],
            [User.stub, "WNetCancelConnection", 6],
            [User.stub, "WNetGetError", 4],
            // 520 //
            [User.stub, "WNetGetErrorText", 10],
            [User.stub, "WNetEnable", 0],
            [User.stub, "WNetDisable", 0],
            [User.stub, "WNetRestoreConnection", 6],
            [User.stub, "WNetWriteJob", 10],
            [User.stub, "WNetConnectDialog", 4],
            [User.stub, "WNetDisconnectDialog", 4],
            [User.stub, "WNetConnectionDialog", 4],
            [User.stub, "WNetViewQueueDialog", 6],
            [User.stub, "WNetPropertyDialog", 8],
            // 530 //
            [User.stub, "WNetGetDirectoryType", 8],
            [User.stub, "WNetDirectoryNotify", 8],
            [User.stub, "WNetGetPropertyText", 8],
        ];
    }

    static stub() {
        console.log("Stub called!");
    }
}

/**
 * The **POINT** structure defines the x- and y-coordinates of a point.
 */
export class POINT extends Struct {
    constructor() {
        super([
            ['x', INT],
            ['y', INT]
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
            ['bottom', INT]
        ]);
    }
}

/**
 * The **MSG** structure contains information from the system's application queue.
 */
export class MSG extends Struct {
    constructor() {
        super([
            ['hwnd', HWND],
            ['message', UINT],
            ['wParam', WPARAM],
            ['lParam', LPARAM],
            ['time', DWORD],
            ['pt', POINT]
        ]);
    }
}

/**
 * The **CREATESTRUCT** structure contains information from the system's application queue.
 */
export class CREATESTRUCT extends Struct {
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
            ['dwExStyle', DWORD]
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
            ['ptMaxTrackSize', POINT]
        ]);
    }
}

/**
 * The **MSG** structure contains information from the system's application queue.
 */
export class WINDOWPOS extends Struct {
    constructor() {
        super([
            ['hwnd', HWND],
            ['hwndInsertAfter', HWND],
            ['x', INT],
            ['y', INT],
            ['cx', INT],
            ['cy', INT],
            ['flags', UINT]
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
            ['rgbReserved3', DWORD]
        ]);
    }
}

// Messages
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
User.CW_USEDEFAULT = -32768

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
User.WS_OVERLAPPEDWINDOW = User.WS_OVERLAPPED | User.WS_CAPTION |
                           User.WS_SYSMENU | User.WS_THICKFRAME |
                           User.WS_MINIMIZEBOX | User.WS_MAXIMIZEBOX;
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
