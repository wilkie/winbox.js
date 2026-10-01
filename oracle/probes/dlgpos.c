/*
 * Where a dialog is put from its template: the template's place and size in
 * dialog units, owned by a window at the top of the screen, as Space
 * Traveler's and Cell War's dialogs are.
 *
 * The owner is an overlapped window at (0, 0), 640 by 480, with a menu-less
 * caption. Each dialog is made with `CreateDialogIndirect` from a template
 * of no controls, with a caption:
 *
 * * `rect`: for each template place and size, and with and without
 *   `DS_MODALFRAME`, the dialog's `GetWindowRect` and the screen place of
 *   its client area's corner, as "left,top,right,bottom;x,y".
 * * `units`: `GetDialogBaseUnits`, in hexadecimal.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\DLGPOS.OUT"

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
    DWORD style = WS_POPUP | WS_CAPTION | WS_SYSMENU | (modal ? DS_MODALFRAME : 0);
    HWND dialog;
    RECT r;
    POINT p;

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
    wsprintf(probeArgs, "%s,%d,%d,%d,%d", (LPSTR)(modal ? "modal" : "plain"), x, y, cx, cy);
    wsprintf(probeResult, "%d,%d,%d,%d;%d,%d", r.left, r.top, r.right, r.bottom, p.x, p.y);
    probe("rect", probeArgs, probeResult);
    DestroyWindow(dialog);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static const int PLACES[][4] = {
        { 71, -2, 170, 200 }, { 0, 0, 100, 50 }, { 1, 1, 100, 50 }, { 3, 5, 101, 51 },
        { 10, 10, 100, 50 }, { 21, 19, 103, 57 },
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
    kind.lpszClassName = "DlgPosOwner";
    RegisterClass(&kind);
    owner = CreateWindow("DlgPosOwner", "O", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 0, 0, 640, 480,
                         NULL, NULL, instance, NULL);

    wsprintf(probeResult, "%lx", GetDialogBaseUnits());
    probe("units", "GetDialogBaseUnits", probeResult);

    for (i = 0; i < sizeof(PLACES) / sizeof(PLACES[0]); i++) {
        place(instance, owner, proc, TRUE, PLACES[i][0], PLACES[i][1], PLACES[i][2], PLACES[i][3]);
        place(instance, owner, proc, FALSE, PLACES[i][0], PLACES[i][1], PLACES[i][2], PLACES[i][3]);
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
