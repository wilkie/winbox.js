/*
 * WindowFromPoint's walk (USER.EXE seg1 713c, 71b9): which windows it asks
 * WM_NCHITTEST, in what order, and what their answers make of it.
 *
 * A top-level window, "top", at 40,40, 300 by 200, of a class whose
 * procedure writes down each WM_NCHITTEST it is sent and answers it as the
 * window's word at 0 says: 0 as DefWindowProc does, else that code. In
 * top's client area, each made after the one before:
 *
 * * "glass" at 10,10, 60 by 40, answering HTTRANSPARENT, over "under" at
 *   30,20, 60 by 40, made after it.
 * * "dis", disabled, at 110,10, 60 by 40, over "beneath" at 130,20.
 * * "spill" at 250,100, 100 by 100, reaching past top's client area.
 * * "cap" at 10,100, 60 by 40, answering HTCAPTION, holding "kid" at 5,5,
 *   20 by 15.
 *
 * "over", a pop-up at 400,300, 100 by 80, is made system-modal for one
 * point.
 *
 * * `window`: the point's name; what WindowFromPoint answered, by name.
 * * `asked`: the same point; the windows sent WM_NCHITTEST during the call,
 *   in order, joined by `/`, `-` for none.
 */

#include "probe.h"

#include <string.h>

#define OUTPUT "C:\\ORACLE\\WFPWALK.OUT"

#define COUNT 9

static HINSTANCE instance;
static HWND windows[COUNT];
static const char *NAMES[COUNT] = {"top",   "glass", "under", "dis", "beneath",
                                   "spill", "cap",   "kid",   "over"};
static char asked[256];

static LPCSTR nameOf(HWND window)
{
    int i;

    if (!window) {
        return "none";
    }

    if (window == GetDesktopWindow()) {
        return "desktop";
    }

    for (i = 0; i < COUNT; i++) {
        if (window == windows[i]) {
            return NAMES[i];
        }
    }

    return "other";
}

LRESULT CALLBACK _export WalkProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_NCHITTEST) {
        int answer = (int)GetWindowWord(window, 0);

        if (asked[0]) {
            lstrcat(asked, "/");
        }

        lstrcat(asked, nameOf(window));

        if (answer) {
            return answer;
        }
    }

    return DefWindowProc(window, message, wParam, lParam);
}

static HWND child(HWND parent, DWORD style, int x, int y, int w, int h, int answer)
{
    HWND made = CreateWindow("WalkWin", "", WS_CHILD | WS_VISIBLE | style, x, y, w, h, parent,
                             NULL, instance, NULL);

    SetWindowWord(made, 0, (WORD)answer);
    return made;
}

/* A point of the screen. */
static void screenAt(LPCSTR name, int x, int y)
{
    POINT point;
    LPCSTR found;

    point.x = x;
    point.y = y;
    asked[0] = '\0';
    found = nameOf(WindowFromPoint(point));
    probe("window", name, found);
    probe("asked", name, asked[0] ? asked : "-");
}

/* A point of top's client area. */
static void at(LPCSTR name, int x, int y)
{
    POINT point;

    point.x = x;
    point.y = y;
    ClientToScreen(windows[0], &point);
    screenAt(name, point.x, point.y);
}

int PASCAL WinMain(HINSTANCE self, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HWND top;

    instance = self;
    probeOpen(OUTPUT);

    memset(&kind, 0, sizeof(kind));
    kind.lpfnWndProc = WalkProc;
    kind.cbWndExtra = 2;
    kind.hInstance = instance;
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszClassName = "WalkWin";
    RegisterClass(&kind);

    top = CreateWindow("WalkWin", "Top", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 40, 40, 300, 200, NULL,
                       NULL, instance, NULL);
    windows[0] = top;
    windows[1] = child(top, 0, 10, 10, 60, 40, HTTRANSPARENT);
    windows[2] = child(top, 0, 30, 20, 60, 40, 0);
    windows[3] = child(top, WS_DISABLED, 110, 10, 60, 40, 0);
    windows[4] = child(top, 0, 130, 20, 60, 40, 0);
    windows[5] = child(top, 0, 250, 100, 100, 100, 0);
    windows[6] = child(top, 0, 10, 100, 60, 40, HTCAPTION);
    windows[7] = child(windows[6], 0, 5, 5, 20, 15, 0);
    windows[8] = CreateWindow("WalkWin", "Over", WS_POPUP | WS_BORDER | WS_VISIBLE, 400, 300, 100,
                              80, NULL, NULL, instance, NULL);
    UpdateWindow(top);
    UpdateWindow(windows[8]);

    at("client", 200, 150);
    at("glass-only", 15, 15);
    at("glass-under", 40, 30);
    at("under-only", 80, 50);
    at("dis-only", 115, 15);
    at("dis-beneath", 140, 30);
    at("spill-in", 260, 110);
    at("spill-beyond", 305, 110);
    screenAt("spill-outside", 40 + 300 + 5, 40 + 30 + 110);
    at("cap", 50, 130);
    at("kid", 20, 112);
    screenAt("caption", 150, 45);
    screenAt("over", 450, 340);
    screenAt("desktop", 600, 20);

    SetSysModalWindow(windows[8]);
    at("modal-client", 200, 150);
    at("modal-kid", 20, 112);
    screenAt("modal-over", 450, 340);
    screenAt("modal-desktop", 600, 20);
    SetSysModalWindow(NULL);

    at("after-modal", 200, 150);

    DestroyWindow(windows[8]);
    DestroyWindow(top);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
