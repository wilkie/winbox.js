/*
 * GetSystemDebugState, called by ordinal, in hexadecimal, as the system
 * goes through the states it answers of:
 *
 * * `state`: from WinMain with the probe's window active; in a modal
 *   dialog's WM_INITDIALOG, and in a message posted from it, taken once
 *   the dialog shows; after the dialog has ended; the same of a dialog
 *   whose procedure answers WM_ACTIVATE itself; of a modeless dialog made
 *   and destroyed; in WM_INITMENUPOPUP while TrackPopupMenu has its pop-up
 *   open (EndMenu at the first WM_ENTERIDLE); after LockMyTask(TRUE) and
 *   LockMyTask(FALSE); and after SetSysModalWindow of a second window, and
 *   once that window is destroyed.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\SYSDBG.OUT"

#define WM_PROBE (WM_USER + 1)

typedef DWORD(FAR PASCAL *STATEPROC)(void);
typedef void(FAR PASCAL *VOIDPROC)(void);
typedef void(FAR PASCAL *LOCKPROC)(BOOL);

static HMODULE user;
static HWND self;
static int idles;
static BOOL answersActivate;

static void state(LPCSTR what)
{
    wsprintf(probeResult, "%08lx", ((STATEPROC)GetProcAddress(user, MAKEINTRESOURCE(231)))());
    probe("state", what, probeResult);
}

BOOL CALLBACK _export DialogProc(HWND dialog, UINT message, WPARAM wParam, LPARAM lParam)
{
    switch (message) {
    case WM_INITDIALOG:
        state(answersActivate ? "WM_INITDIALOG, WM_ACTIVATE answered" : "WM_INITDIALOG");
        PostMessage(dialog, WM_PROBE, 0, 0);
        return TRUE;

    case WM_ACTIVATE:
        return answersActivate;

    case WM_PROBE:
        state(answersActivate ? "dialog shown, WM_ACTIVATE answered" : "dialog shown");
        EndDialog(dialog, 1);
        return TRUE;
    }

    (void)wParam;
    (void)lParam;
    return FALSE;
}

BOOL CALLBACK _export ModelessProc(HWND dialog, UINT message, WPARAM wParam, LPARAM lParam)
{
    (void)dialog;
    (void)wParam;
    (void)lParam;
    return message == WM_INITDIALOG;
}

LRESULT CALLBACK _export WindowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    switch (message) {
    case WM_INITMENUPOPUP:
        state("WM_INITMENUPOPUP");
        break;

    case WM_ENTERIDLE:
        if (idles++ == 0) {
            ((VOIDPROC)GetProcAddress(user, MAKEINTRESOURCE(187)))();
        }

        return 0;
    }

    return DefWindowProc(window, message, wParam, lParam);
}

/* A template in a global block: its header, then its one control. */
static BYTE FAR *template;
static int at;

static void byte(BYTE value)
{
    template[at++] = value;
}

static void word(WORD value)
{
    byte(LOBYTE(value));
    byte(HIBYTE(value));
}

static void string(LPCSTR text)
{
    while (*text) {
        byte(*text++);
    }

    byte(0);
}

static void build(HGLOBAL memory, DWORD visible)
{
    DWORD style = WS_POPUP | WS_CAPTION | WS_SYSMENU | DS_MODALFRAME | visible;
    DWORD button = BS_PUSHBUTTON | WS_TABSTOP | WS_CHILD | WS_VISIBLE;

    template = (BYTE FAR *)GlobalLock(memory);
    at = 0;
    word(LOWORD(style));
    word(HIWORD(style));
    byte(1);
    word(40);
    word(20);
    word(120);
    word(60);
    byte(0);
    byte(0);
    string("D");
    word(6);
    word(6);
    word(60);
    word(12);
    word(IDOK);
    word(LOWORD(button));
    word(HIWORD(button));
    byte(0x80);
    string("OK");
    byte(0);
    GlobalUnlock(memory);
}

static void pump(void)
{
    MSG msg;

    while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
        DispatchMessage(&msg);
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HGLOBAL memory;
    HMENU popup;
    HWND modeless;
    HWND other;

    probeOpen(OUTPUT);
    user = GetModuleHandle("USER");

    kind.style = 0;
    kind.lpfnWndProc = WindowProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = LoadCursor(NULL, IDC_ARROW);
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "SysDbgProbe";
    RegisterClass(&kind);
    self = CreateWindow("SysDbgProbe", "SysDbg", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 10, 10, 300, 200,
                        NULL, NULL, instance, NULL);
    UpdateWindow(self);
    pump();
    state("start");

    memory = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, 256);
    build(memory, 0);
    answersActivate = FALSE;
    DialogBoxIndirect(instance, memory, self, (DLGPROC)DialogProc);
    state("after the dialog");
    answersActivate = TRUE;
    DialogBoxIndirect(instance, memory, self, (DLGPROC)DialogProc);
    state("after the dialog, WM_ACTIVATE answered");

    build(memory, WS_VISIBLE);
    template = (BYTE FAR *)GlobalLock(memory);
    modeless = CreateDialogIndirect(instance, template, self, (DLGPROC)ModelessProc);
    GlobalUnlock(memory);
    pump();
    state("modeless dialog");
    DestroyWindow(modeless);
    pump();
    state("modeless dialog destroyed");
    GlobalFree(memory);

    popup = CreatePopupMenu();
    AppendMenu(popup, MF_STRING, 101, "One");
    SetCursorPos(600, 440);
    TrackPopupMenu(popup, TPM_LEFTALIGN, 60, 60, 0, self, NULL);
    pump();
    state("after the menu");
    DestroyMenu(popup);

    ((LOCKPROC)GetProcAddress(user, MAKEINTRESOURCE(276)))(TRUE);
    state("LockMyTask(TRUE)");
    ((LOCKPROC)GetProcAddress(user, MAKEINTRESOURCE(276)))(FALSE);
    state("LockMyTask(FALSE)");

    other = CreateWindow("SysDbgProbe", "Other", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 40, 40, 200, 100,
                         NULL, NULL, instance, NULL);
    pump();
    SetSysModalWindow(other);
    state("SetSysModalWindow");
    DestroyWindow(other);
    pump();
    state("system-modal window destroyed");

    DestroyWindow(self);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
