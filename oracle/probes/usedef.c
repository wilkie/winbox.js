/*
 * Windows made at CW_USEDEFAULT: where USER puts them, and what their
 * CREATESTRUCT says in WM_CREATE.
 *
 * * `rect`: GetWindowRect after CreateWindow, as left, top, right, bottom.
 * * `create`: the CREATESTRUCT's x, y, cx and cy in WM_CREATE.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\USEDEF.OUT"

static char created[40];
static HINSTANCE owner;

LRESULT CALLBACK __export Proc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_CREATE) {
        CREATESTRUCT FAR *create = (CREATESTRUCT FAR *)lParam;

        wsprintf(created, "%d,%d,%d,%d", create->x, create->y, create->cx, create->cy);
    }

    return DefWindowProc(window, message, wParam, lParam);
}

static HWND make(LPCSTR what, DWORD style, int x, int y, int cx, int cy)
{
    HWND window;
    RECT area;

    created[0] = '\0';
    window = CreateWindow("UseDef", what, style, x, y, cx, cy, NULL, NULL,
                          owner, NULL);
    GetWindowRect(window, &area);
    wsprintf(probeResult, "%d,%d,%d,%d", area.left, area.top, area.right, area.bottom);
    probe("rect", what, probeResult);
    probe("create", what, created);
    return window;
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HWND made[8];

    probeOpen(OUTPUT);
    owner = instance;

    kind.style = 0;
    kind.lpfnWndProc = Proc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "UseDef";
    RegisterClass(&kind);

    made[0] = make("first, all default", WS_OVERLAPPEDWINDOW, CW_USEDEFAULT, CW_USEDEFAULT,
                   CW_USEDEFAULT, CW_USEDEFAULT);
    made[1] = make("second, all default", WS_OVERLAPPEDWINDOW, CW_USEDEFAULT, CW_USEDEFAULT,
                   CW_USEDEFAULT, CW_USEDEFAULT);
    made[2] = make("third, all default", WS_OVERLAPPEDWINDOW, CW_USEDEFAULT, CW_USEDEFAULT,
                   CW_USEDEFAULT, CW_USEDEFAULT);
    made[3] = make("place default, 200x150", WS_OVERLAPPEDWINDOW, CW_USEDEFAULT, CW_USEDEFAULT,
                   200, 150);
    made[4] = make("at 30,40, size default", WS_OVERLAPPEDWINDOW, 30, 40, CW_USEDEFAULT,
                   CW_USEDEFAULT);
    made[5] = make("popup, all default", WS_POPUP, CW_USEDEFAULT, CW_USEDEFAULT, CW_USEDEFAULT,
                   CW_USEDEFAULT);
    made[6] = make("visible, all default", WS_OVERLAPPEDWINDOW | WS_VISIBLE, CW_USEDEFAULT,
                   CW_USEDEFAULT, CW_USEDEFAULT, CW_USEDEFAULT);
    made[7] = make("caption only, all default", WS_CAPTION, CW_USEDEFAULT, CW_USEDEFAULT,
                   CW_USEDEFAULT, CW_USEDEFAULT);

    {
        int i;

        for (i = 0; i < 8; i++) {
            DestroyWindow(made[i]);
        }
    }

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
