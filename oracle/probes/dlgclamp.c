/*
 * Where a dialog box goes when its template puts it partly off the screen.
 *
 * Calculator's template places its dialog 310 dialog units across -- 620
 * pixels, most of it past the right edge of a 640-pixel screen -- yet on
 * Windows it opens on the screen. This makes an empty dialog, 100 by 50 units
 * with a caption and no owner, at each of these places, and records where its
 * window went:
 *
 * * `place`: past the right edge, past the bottom, past both, at negative
 *   places, and in the middle for comparison.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\DLGCLAMP.OUT"

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

static void pump(void)
{
    MSG message;

    while (PeekMessage(&message, NULL, 0, 0, PM_REMOVE)) {
        TranslateMessage(&message);
        DispatchMessage(&message);
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static const int PLACES[][2] = { { 20, 20 }, { 300, 20 }, { 20, 250 }, { 300, 250 },
                                     { -30, 20 }, { 20, -30 }, { 400, 400 } };
    HGLOBAL memory = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, 256);
    FARPROC proc = MakeProcInstance((FARPROC)DialogProc, instance);
    DWORD style = WS_POPUP | WS_CAPTION | WS_SYSMENU | DS_MODALFRAME | WS_VISIBLE;
    int index;

    probeOpen(OUTPUT);
    template = (BYTE FAR *)GlobalLock(memory);

    for (index = 0; index < sizeof(PLACES) / sizeof(PLACES[0]); index++) {
        HWND dialog;
        RECT window;

        at = 0;
        word(LOWORD(style));
        word(HIWORD(style));
        byte(0);
        word(PLACES[index][0]);
        word(PLACES[index][1]);
        word(100);
        word(50);
        byte(0);
        byte(0);
        byte('D');
        byte(0);

        dialog = CreateDialogIndirect(instance, template, NULL, (DLGPROC)proc);
        pump();
        GetWindowRect(dialog, &window);

        wsprintf(probeArgs, "x=%d,y=%d", PLACES[index][0], PLACES[index][1]);
        wsprintf(probeResult, "window=%d:%d:%d:%d", window.left, window.top, window.right,
                 window.bottom);
        probe("place", probeArgs, probeResult);

        DestroyWindow(dialog);
        pump();
    }

    GlobalUnlock(memory);
    GlobalFree(memory);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
