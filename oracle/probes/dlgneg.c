/*
 * How a dialog's negative place in dialog units becomes pixels, as Space
 * Traveler's About box, at -2 down from its owner's client area, stands a
 * row lower in Windows than `MulDiv` puts it. `dlgpos` had only one
 * negative place, and the screen's edge stopped it there.
 *
 * The owner is an overlapped window at (100, 120), 400 by 300. Each dialog
 * is made with `CreateDialogIndirect` from a template of no controls, 40 by
 * 20, without a caption or a frame:
 *
 * * `rect`: for each template place, the screen place of the dialog's
 *   client area's corner, less the owner's, as "x,y".
 * * `units`: `GetDialogBaseUnits`, in hexadecimal.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\DLGNEG.OUT"

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

BOOL FAR PASCAL _export DialogProc(HWND dialog, UINT message, WPARAM wParam, LPARAM lParam)
{
    return message == WM_INITDIALOG;
}

static void place(HINSTANCE instance, HWND owner, FARPROC proc, BOOL modal, int x, int y, int cx,
                  int cy)
{
    DWORD style = WS_POPUP;
    HWND dialog;
    RECT r;
    POINT p;
    POINT o;

    at = 0;
    word(LOWORD(style));
    word(HIWORD(style));
    byte(0);
    word(x);
    word(y);
    word(cx);
    word(cy);
    byte(0);
    byte(0);
    byte('D');
    byte(0);

    dialog = CreateDialogIndirect(instance, template, owner, (DLGPROC)proc);
    GetWindowRect(dialog, &r);
    p.x = 0;
    p.y = 0;
    ClientToScreen(dialog, &p);
    o.x = 0;
    o.y = 0;
    ClientToScreen(owner, &o);
    wsprintf(probeArgs, "%d,%d", x, y);
    wsprintf(probeResult, "%d,%d", p.x - o.x, p.y - o.y);
    probe("rect", probeArgs, probeResult);
    DestroyWindow(dialog);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static const int PLACES[][2] = {
        { 0, -1 }, { 0, -2 }, { 0, -3 }, { 0, -4 }, { 0, -5 }, { 0, -6 }, { 0, -7 }, { 0, -9 },
        { -1, 0 }, { -2, 0 }, { -3, 0 }, { -5, 0 }, { -6, 0 }, { -7, 0 }, { 0, 1 }, { 0, 3 },
        { 1, 0 }, { 3, 0 },
    };
    HGLOBAL memory = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, 256);
    FARPROC proc = MakeProcInstance((FARPROC)DialogProc, instance);
    WNDCLASS kind;
    HWND owner;
    int i;

    probeOpen(OUTPUT);
    template = (BYTE FAR *)GlobalLock(memory);

    kind.style = 0;
    kind.lpfnWndProc = DefWindowProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "DlgNegOwner";
    RegisterClass(&kind);
    owner = CreateWindow("DlgNegOwner", "O", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 100, 120, 400, 300,
                         NULL, NULL, instance, NULL);

    wsprintf(probeResult, "%lx", GetDialogBaseUnits());
    probe("units", "GetDialogBaseUnits", probeResult);

    for (i = 0; i < sizeof(PLACES) / sizeof(PLACES[0]); i++) {
        place(instance, owner, proc, FALSE, PLACES[i][0], PLACES[i][1], 40, 20);
    }

    DestroyWindow(owner);
    GlobalUnlock(memory);
    GlobalFree(memory);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
