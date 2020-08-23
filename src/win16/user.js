"use strict";

import { BYTE, UBYTE, INT, UINT, LONG, ULONG,
         DWORD, HLOCAL, HGLOBAL, HANDLE, ATOM, LRESULT,
         HMENU, HINSTANCE, WPARAM, LPARAM, HDC,
         HBRUSH, HICON, HCURSOR, WNDPROC,
         BOOL, NEARPTR, FARPTR, LPCSTR, HWND, Struct } from './types.js';

import { CreateWindow } from './user/CreateWindow.js';
import { DefWindowProc } from './user/DefWindowProc.js';
import { DispatchMessage } from './user/DispatchMessage.js';
import { FindWindow } from './user/FindWindow.js';
import { GetDC } from './user/GetDC.js';
import { GetMessage } from './user/GetMessage.js';
import { GetTickCount } from './user/GetTickCount.js';
import { InitApp } from './user/InitApp.js';
import { PeekMessage } from './user/PeekMessage.js';
import { RegisterClass } from './user/RegisterClass.js';
import { ReleaseDC } from './user/ReleaseDC.js';
import { SetWindowText } from './user/SetWindowText.js';
import { ShowWindow } from './user/ShowWindow.js';
import { TranslateMessage } from './user/TranslateMessage.js';
import { UpdateWindow } from './user/UpdateWindow.js';

export class User {
    static get name() {
        return "USER";
    }

    static get exports() {
        return [
            // 0 //
            null,
            [User.stub, "MessageBox", 12],
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
            [User.stub, "SetFocus", 2],
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
            [User.stub, "GetWindowRect", 6],
            [User.stub, "GetClientRect", 6],
            [User.stub, "EnableWindow", 4],
            [User.stub, "IsWindowEnabled", 0],
            [User.stub, "GetWindowText", 8],
            [SetWindowText, "SetWindowText", 6, [HWND, LPCSTR]],
            [User.stub, "GetWindowTextLength", 2],
            [User.stub, "BeginPaint", 6],
            // 40 //
            [User.stub, "EndPaint", 6],
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
            [User.stub, "MoveWindow", 12],
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
            [User.stub, "FillRect", 8],
            [User.stub, "InvertRect", 6],
            [User.stub, "FrameRect", 8],
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
            [User.stub, "LoadBitmap", 6],
            [User.stub, "LoadString", 10],
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
            [User.stub, "RedrawWindow", 10],
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
            [User.stub, "_WSPRINTF", 0],
            [User.stub, "WVSPRINTF", 12],
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

// Messages
User.WM_PAINT = 0x000f;
User.WM_ERASEBKGND = 0x0014;
User.WM_ICONERASEBKGND = 0x0027;
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

// CreateWindow flags
User.CW_USEDEFAULT = 0x8000;

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

export default User;
