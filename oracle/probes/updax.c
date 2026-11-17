/*
 * What `UpdateWindow`, which answers nothing, leaves in DX:AX. USER's
 * `UpdateWindow` checks the window (`USER.EXE` seg1 `a963`-`a966`), pops
 * its own return thunk's offset into DX (`a969`), and paints, leaving
 * CDEFh in AX as it returns (`4415`). A program of the catalog (Google
 * Eyes) answers its `InitInstance` with what `UpdateWindow` left in AX,
 * and ends where it is nought.
 *
 * * `left`: AX after `UpdateWindow` of a window with something to paint,
 *   of one with nothing, of nought and of a handle that is no window, in
 *   hex.
 * * `dx`: DX after each, in hex.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\UPDAX.OUT"

typedef DWORD(FAR PASCAL *UPDATE)(HWND);

LRESULT CALLBACK __export Proc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    return DefWindowProc(window, message, wParam, lParam);
}

static void left(LPCSTR what, HWND window)
{
    UPDATE update = (UPDATE)UpdateWindow;
    DWORD got = update(window);

    wsprintf(probeResult, "%04x", LOWORD(got));
    probe("left", what, probeResult);
    wsprintf(probeResult, "%04x", HIWORD(got));
    probe("dx", what, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HWND window;

    probeOpen(OUTPUT);

    _fmemset(&kind, 0, sizeof(kind));
    kind.lpfnWndProc = Proc;
    kind.hInstance = instance;
    kind.hCursor = LoadCursor(NULL, IDC_ARROW);
    kind.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    kind.lpszClassName = "UpdAx";
    RegisterClass(&kind);

    window = CreateWindow("UpdAx", "UpdAx", WS_OVERLAPPEDWINDOW, 10, 10, 200, 100, NULL, NULL, instance, NULL);
    ShowWindow(window, SW_SHOWNORMAL);
    left("to paint", window);
    left("nothing to paint", window);
    InvalidateRect(window, NULL, TRUE);
    left("invalidated", window);
    left("nought", NULL);
    left("no window", (HWND)0x1234);

    DestroyWindow(window);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
