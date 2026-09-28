/*
 * WindowFromPoint and ChildWindowFromPoint: which window each answers for a
 * point, as Championship Slots of the corpus asks where the mouse is.
 *
 * A top-level window, "top", at 40,40, 300 by 200, holds children in its
 * client area, each 40 by 30: "shown", "hidden" (never shown), "disabled",
 * "static" (a STATIC), "group" (a BS_GROUPBOX), and "outer", which holds a
 * child "inner" at 5,5, 20 by 15. A second top-level window, "over", covers
 * part of "top".
 *
 * * `window`: the point's name; what WindowFromPoint answered, by name --
 *   `desktop` for GetDesktopWindow, `none` for nought, `other` otherwise.
 * * `child`: the point, in top's client area; what ChildWindowFromPoint of
 *   top answered.
 */

#include "probe.h"

#include <string.h>

#define OUTPUT "C:\\ORACLE\\WINPOINT.OUT"

static HINSTANCE instance;
static HWND top;
static HWND over;
static HWND kids[7];
static const char *NAMES[7] = {"shown", "hidden", "disabled", "static", "group", "outer", "inner"};

static LPCSTR nameOf(HWND window)
{
    int i;

    if (!window) {
        return "none";
    }

    if (window == top) {
        return "top";
    }

    if (window == over) {
        return "over";
    }

    if (window == GetDesktopWindow()) {
        return "desktop";
    }

    for (i = 0; i < 7; i++) {
        if (window == kids[i]) {
            return NAMES[i];
        }
    }

    return "other";
}

static HWND child(HWND parent, LPCSTR kind, DWORD style, int x, int y, int w, int h)
{
    return CreateWindow(kind, "", WS_CHILD | style, x, y, w, h, parent, NULL, instance, NULL);
}

/* A point in top's client area, asked both ways. */
static void at(LPCSTR name, int x, int y)
{
    POINT point;

    point.x = x;
    point.y = y;
    probe("child", name, nameOf(ChildWindowFromPoint(top, point)));
    ClientToScreen(top, &point);
    probe("window", name, nameOf(WindowFromPoint(point)));
}

/* A point of the screen. */
static void screenAt(LPCSTR name, int x, int y)
{
    POINT point;

    point.x = x;
    point.y = y;
    probe("window", name, nameOf(WindowFromPoint(point)));
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
    kind.lpszClassName = "WinPoint";
    RegisterClass(&kind);

    top = CreateWindow("WinPoint", "Top", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 40, 40, 300, 200,
                       NULL, NULL, instance, NULL);
    kids[0] = child(top, "WinPoint", WS_VISIBLE, 10, 10, 40, 30);
    kids[1] = child(top, "WinPoint", 0, 60, 10, 40, 30);
    kids[2] = child(top, "WinPoint", WS_VISIBLE | WS_DISABLED, 110, 10, 40, 30);
    kids[3] = child(top, "STATIC", WS_VISIBLE, 160, 10, 40, 30);
    kids[4] = child(top, "BUTTON", WS_VISIBLE | BS_GROUPBOX, 210, 10, 40, 30);
    kids[5] = child(top, "WinPoint", WS_VISIBLE, 10, 60, 40, 30);
    kids[6] = child(kids[5], "WinPoint", WS_VISIBLE, 5, 5, 20, 15);
    over = CreateWindow("WinPoint", "Over", WS_POPUP | WS_BORDER | WS_VISIBLE, 300, 150, 100, 100,
                        NULL, NULL, instance, NULL);
    UpdateWindow(top);
    UpdateWindow(over);

    at("empty", 100, 100);
    at("shown", 20, 20);
    at("hidden", 70, 20);
    at("disabled", 120, 20);
    at("static", 170, 20);
    at("group-inside", 230, 25);
    at("group-edge", 210, 25);
    at("outer", 12, 62);
    at("inner", 20, 70);
    at("outside-client", -2, -2);
    at("far-outside", 500, 400);

    screenAt("caption", 150, 45);
    screenAt("over", 350, 200);
    screenAt("desktop", 600, 20);
    screenAt("off-screen", -5, -5);

    EnableWindow(top, FALSE);
    at("top-disabled", 100, 100);
    at("top-disabled-shown", 20, 20);
    EnableWindow(top, TRUE);

    DestroyWindow(over);
    DestroyWindow(top);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
