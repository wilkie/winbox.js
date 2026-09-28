/*
 * LockWindowUpdate: what it answers, and what drawing on a locked window
 * does, as Championship Slots of the corpus locks its window while it
 * changes it.
 *
 * Two top-level windows, "a" at 20,20 and "b" at 300,20, each 200 by 150,
 * white. Drawing is a FillRect in black through GetDC over the client
 * area's top left 20 by 20; what shows is read from the screen, at the
 * client area's point 5,5, as `black` or `white` (or `other`).
 *
 * * `lock`: the case; what LockWindowUpdate answered.
 * * `shows`: the case; the pixel on the screen.
 * * `invalid`: the case; whether GetUpdateRect says a's client area needs
 *   painting, and the rectangle.
 */

#include "probe.h"

#include <string.h>

#define OUTPUT "C:\\ORACLE\\LOCKUPD.OUT"

static HINSTANCE instance;
static HWND a;
static HWND b;

static void answer(LPCSTR name, BOOL result)
{
    wsprintf(probeResult, "%d", result);
    probe("lock", name, probeResult);
}

static void draw(HWND window)
{
    HDC dc = GetDC(window);
    RECT box;

    box.left = 0;
    box.top = 0;
    box.right = 20;
    box.bottom = 20;
    FillRect(dc, &box, GetStockObject(BLACK_BRUSH));
    ReleaseDC(window, dc);
}

static void shows(LPCSTR name, HWND window)
{
    POINT point;
    HDC screen = GetDC(NULL);
    COLORREF colour;

    point.x = 5;
    point.y = 5;
    ClientToScreen(window, &point);
    colour = GetPixel(screen, point.x, point.y) & 0xffffffL;
    ReleaseDC(NULL, screen);
    probe("shows", name,
          colour == 0 ? "black" : colour == RGB(255, 255, 255) ? "white" : "other");
}

static void invalid(LPCSTR name)
{
    RECT box;
    BOOL any = GetUpdateRect(a, &box, FALSE);

    wsprintf(probeResult, "%d %d,%d,%d,%d", any, box.left, box.top, box.right, box.bottom);
    probe("invalid", name, probeResult);
}

int PASCAL WinMain(HINSTANCE self, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;

    instance = self;
    probeOpen(OUTPUT);

    memset(&kind, 0, sizeof(kind));
    kind.lpfnWndProc = DefWindowProc;
    kind.hInstance = instance;
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszClassName = "LockUpd";
    RegisterClass(&kind);

    a = CreateWindow("LockUpd", "A", WS_OVERLAPPED | WS_CAPTION | WS_VISIBLE, 20, 20, 200, 150, NULL,
                     NULL, instance, NULL);
    b = CreateWindow("LockUpd", "B", WS_OVERLAPPED | WS_CAPTION | WS_VISIBLE, 300, 20, 200, 150, NULL,
                     NULL, instance, NULL);
    UpdateWindow(a);
    UpdateWindow(b);

    answer("unlock-none", LockWindowUpdate(NULL));
    answer("lock-a", LockWindowUpdate(a));
    answer("lock-a-again", LockWindowUpdate(a));
    answer("lock-b", LockWindowUpdate(b));

    draw(a);
    shows("a-locked", a);
    draw(b);
    shows("b-unlocked", b);
    invalid("locked");

    answer("unlock", LockWindowUpdate(NULL));
    shows("a-unlocked", a);
    invalid("unlocked");

    UpdateWindow(a);
    shows("a-updated", a);
    invalid("updated");

    answer("unlock-again", LockWindowUpdate(NULL));

    draw(a);
    shows("a-drawn-after", a);

    DestroyWindow(b);
    DestroyWindow(a);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
