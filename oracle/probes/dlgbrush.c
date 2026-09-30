/*
 * What a dialog's background is painted with: `WM_CTLCOLOR` to the dialog
 * itself, `CTLCOLOR_DLG`, as FIBS/W answers it with a grey brush of its
 * own; and to it for its static text, `CTLCOLOR_STATIC`.
 *
 * A dialog 100 by 50 with a static control "Hi" at (10, 10), 60 by 12, is
 * made twice: first with a procedure that answers `CTLCOLOR_DLG` with a red
 * brush and `CTLCOLOR_STATIC` with a yellow one, the background colour set
 * yellow too; then with one that answers every `WM_CTLCOLOR` with nought.
 *
 * * `messages`: in order as the dialog is made and shown, each
 *   `WM_ERASEBKGND` and `WM_CTLCOLOR` its procedure is given, a
 *   `WM_CTLCOLOR` as its type and whether the control named is the dialog
 *   (`D`) or the static (`S`).
 * * `pixels`: palette digits of the dialog's client area clear of the
 *   static, and of the static's own area clear of its text.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\DLGBRUSH.OUT"

static const char HEX[] = "0123456789abcdef";

static const COLORREF PALETTE[16] = {
    RGB(0, 0, 0),       RGB(128, 0, 0),     RGB(0, 128, 0),   RGB(128, 128, 0),
    RGB(0, 0, 128),     RGB(128, 0, 128),   RGB(0, 128, 128), RGB(192, 192, 192),
    RGB(128, 128, 128), RGB(255, 0, 0),     RGB(0, 255, 0),   RGB(255, 255, 0),
    RGB(0, 0, 255),     RGB(255, 0, 255),   RGB(0, 255, 255), RGB(255, 255, 255),
};


static char digit(COLORREF colour)
{
    int index;

    for (index = 0; index < 16; index++) {
        if (PALETTE[index] == (colour & 0xffffffL)) {
            return HEX[index];
        }
    }

    return '?';
}

static BYTE FAR *template;
static int at;
static BOOL answering;
static HBRUSH red;
static HBRUSH yellow;
static char log[512];
static LPSTR logAt;

static void byte(BYTE value)
{
    template[at++] = value;
}

static void word(WORD value)
{
    byte(LOBYTE(value));
    byte(HIBYTE(value));
}

static void note(LPCSTR text)
{
    if (logAt - log < (int)sizeof(log) - 20) {
        logAt += wsprintf(logAt, "%s%s", (LPSTR)(logAt == log ? "" : " "), text);
    }
}

BOOL FAR PASCAL _export DialogProc(HWND dialog, UINT message, WPARAM wParam, LPARAM lParam)
{
    char text[24];

    if (message == WM_ERASEBKGND) {
        note("erase");
        return FALSE;
    }

    if (message == WM_CTLCOLOR) {
        wsprintf(text, "ctl(%d,%s)", HIWORD(lParam),
                 (LPSTR)((HWND)LOWORD(lParam) == dialog ? "D" : "S"));
        note(text);

        if (!answering) {
            return FALSE;
        }

        if (HIWORD(lParam) == CTLCOLOR_DLG) {
            return (BOOL)red;
        }

        if (HIWORD(lParam) == CTLCOLOR_STATIC) {
            SetBkColor((HDC)wParam, RGB(255, 255, 0));
            return (BOOL)yellow;
        }

        return FALSE;
    }

    return message == WM_INITDIALOG;
}

static void pump(void)
{
    MSG message;

    while (PeekMessage(&message, NULL, 0, 0, PM_REMOVE)) {
        TranslateMessage(&message);
        DispatchMessage(&message);
    }
}

static void run(HINSTANCE instance, FARPROC proc, LPCSTR name)
{
    HWND dialog;
    POINT point;
    HDC screen;

    logAt = log;
    *log = '\0';
    dialog = CreateDialogIndirect(instance, template, NULL, (DLGPROC)proc);
    pump();
    probe("messages", name, log);

    screen = GetDC(NULL);
    point.x = 5;
    point.y = 40;
    ClientToScreen(dialog, &point);
    wsprintf(probeResult, "client=%c", digit(GetPixel(screen, point.x, point.y)));
    {
        RECT r;
        HWND item = GetDlgItem(dialog, 100);

        GetWindowRect(item, &r);
        wsprintf(probeResult + lstrlen(probeResult), ",static=%c",
                 digit(GetPixel(screen, r.right - 3, r.top + 2)));
    }
    ReleaseDC(NULL, screen);
    probe("pixels", name, probeResult);

    DestroyWindow(dialog);
    pump();
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HGLOBAL memory = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, 256);
    FARPROC proc = MakeProcInstance((FARPROC)DialogProc, instance);
    DWORD style = WS_POPUP | WS_CAPTION | WS_SYSMENU | DS_MODALFRAME | WS_VISIBLE;
    DWORD itemStyle = WS_CHILD | WS_VISIBLE | SS_LEFT;

    probeOpen(OUTPUT);
    ShowCursor(FALSE);
    SetCursorPos(GetSystemMetrics(SM_CXSCREEN) - 1, GetSystemMetrics(SM_CYSCREEN) - 1);

    red = CreateSolidBrush(RGB(255, 0, 0));
    yellow = CreateSolidBrush(RGB(255, 255, 0));

    template = (BYTE FAR *)GlobalLock(memory);
    word(LOWORD(style));
    word(HIWORD(style));
    byte(1);
    word(20);
    word(20);
    word(100);
    word(50);
    byte(0);
    byte(0);
    byte('D');
    byte(0);

    word(10);
    word(10);
    word(60);
    word(12);
    word(100);
    word(LOWORD(itemStyle));
    word(HIWORD(itemStyle));
    byte(0x82);
    byte('H');
    byte('i');
    byte(0);
    byte(0);

    answering = TRUE;
    run(instance, proc, "answering");
    answering = FALSE;
    run(instance, proc, "not answering");

    DeleteObject(red);
    DeleteObject(yellow);
    GlobalUnlock(memory);
    GlobalFree(memory);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
