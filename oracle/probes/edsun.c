/*
 * `WIN.INI`'s `[Windows]` `Edsun=`, which USER reads as it starts
 * (`USER.EXE` seg3 `2236`-`2245`, `GetProfileInt`): set, each rectangle
 * USER keeps as it was -- the lock's and the bits a `CS_SAVEBITS` window
 * saves -- is two pixels wider on the left and on the right (seg13
 * `1ee9`-`1ef7`). Recorded without it (`edsun`) and with `Edsun=1`
 * (`edsun-on`, `edsun.on.ini`).
 *
 * B is an overlapped window 500 by 350 at (0, 0), white; L a pop-up 200 by
 * 100 at (100, 100) over it; S a pop-up of a `CS_SAVEBITS` class 100 by 50
 * at (150, 250).
 *
 * * `lock`: L locked, a pixel drawn through the screen's context one left
 *   of L and one four left of it, the lock let go: what of B is due after,
 *   as `GetUpdateRect` answers it.
 * * `saved`: S shown, a pixel drawn one left of S and one four left of it,
 *   S hidden: what of B is due after.
 */

#include "probe.h"

#ifndef OUTPUT
#define OUTPUT "C:\\ORACLE\\EDSUN.OUT"
#endif

static void pump(void)
{
    MSG msg;

    while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
        DispatchMessage(&msg);
    }
}

static void due(LPCSTR function, HWND window)
{
    RECT rect;
    BOOL any = GetUpdateRect(window, &rect, FALSE);

    wsprintf(probeResult, "%d %d,%d,%d,%d", any ? 1 : 0, rect.left, rect.top, rect.right,
             rect.bottom);
    probe(function, "B due", probeResult);
}

static void dot(int x, int y)
{
    HDC screen = GetDC(NULL);

    PatBlt(screen, x, y, 1, 1, BLACKNESS);
    ReleaseDC(NULL, screen);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HWND b;
    HWND l;
    HWND s;

    probeOpen(OUTPUT);

    kind.style = 0;
    kind.lpfnWndProc = DefWindowProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "Edsun";
    RegisterClass(&kind);
    kind.style = CS_SAVEBITS;
    kind.lpszClassName = "EdsunSaved";
    RegisterClass(&kind);

    probe("setting", "GetProfileInt Windows Edsun", GetProfileInt("Windows", "Edsun", 0) ? "1" : "0");

    b = CreateWindow("Edsun", "B", WS_OVERLAPPED | WS_VISIBLE, 0, 0, 500, 350, NULL, NULL, instance,
                     NULL);
    UpdateWindow(b);
    l = CreateWindow("Edsun", "", WS_POPUP | WS_VISIBLE, 100, 100, 200, 100, b, NULL, instance,
                     NULL);
    UpdateWindow(l);
    pump();
    ValidateRect(b, NULL);

    LockWindowUpdate(l);
    dot(99, 150);
    dot(96, 150);
    LockWindowUpdate(NULL);
    due("lock", b);
    pump();
    ValidateRect(b, NULL);

    s = CreateWindow("EdsunSaved", "", WS_POPUP, 150, 250, 100, 50, b, NULL, instance, NULL);
    ShowWindow(s, SW_SHOWNA);
    UpdateWindow(s);
    pump();
    ValidateRect(b, NULL);
    dot(149, 270);
    dot(146, 270);
    ShowWindow(s, SW_HIDE);
    due("saved", b);

    DestroyWindow(s);
    DestroyWindow(l);
    DestroyWindow(b);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
