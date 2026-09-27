/*
 * FlashWindow on the active window, an inactive one and a minimized one:
 *
 * * `flash`: its answer, and after the `/` the WM_NCACTIVATEs the window
 *   got for it, their wParams in order, and whether the active window is
 *   still A.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\FLASH.OUT"

static char got[64];

LRESULT CALLBACK __export Proc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_NCACTIVATE) {
        char one[8];

        wsprintf(one, "%u,", wParam);
        lstrcat(got, one);
    }

    return DefWindowProc(window, message, wParam, lParam);
}

static void flash(LPCSTR what, HWND window, HWND a, BOOL invert)
{
    BOOL answer;

    got[0] = '\0';
    answer = FlashWindow(window, invert);
    wsprintf(probeResult, "%d/%s/%s", answer, (LPSTR)got,
             (LPSTR)(GetActiveWindow() == a ? "A" : "?"));
    probe("flash", what, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HWND a;
    HWND b;
    HWND c;

    probeOpen(OUTPUT);

    kind.style = 0;
    kind.lpfnWndProc = Proc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "Flash";
    RegisterClass(&kind);

    c = CreateWindow("Flash", "C", WS_OVERLAPPEDWINDOW, 0, 200, 100, 60, NULL, NULL, instance,
                     NULL);
    ShowWindow(c, SW_SHOWMINNOACTIVE);
    b = CreateWindow("Flash", "B", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 120, 0, 100, 60, NULL, NULL,
                     instance, NULL);
    a = CreateWindow("Flash", "A", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 0, 0, 100, 60, NULL, NULL,
                     instance, NULL);
    SetActiveWindow(a);
    UpdateWindow(a);
    UpdateWindow(b);

    flash("active, invert", a, a, TRUE);
    flash("active, invert again", a, a, TRUE);
    flash("active, invert a third time", a, a, TRUE);
    flash("active, restore", a, a, FALSE);
    flash("active, restore again", a, a, FALSE);
    flash("inactive, invert", b, a, TRUE);
    flash("inactive, invert again", b, a, TRUE);
    flash("inactive, invert a third time", b, a, TRUE);
    flash("inactive, restore", b, a, FALSE);
    flash("inactive, restore again", b, a, FALSE);
    flash("minimized, invert", c, a, TRUE);
    flash("minimized, invert again", c, a, TRUE);
    flash("minimized, restore", c, a, FALSE);
    flash("minimized, restore again", c, a, FALSE);

    DestroyWindow(a);
    DestroyWindow(b);
    DestroyWindow(c);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
