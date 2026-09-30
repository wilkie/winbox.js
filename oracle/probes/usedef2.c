/*
 * Windows made at CW_USEDEFAULT across and a place given down, as Reversi
 * makes its window -- `CreateWindow(..., CW_USEDEFAULT, 0, 320, 384, ...)`
 * -- first, and then after one made all default.
 *
 * * `rect`: GetWindowRect after CreateWindow, as left, top, right, bottom.
 * * `create`: the CREATESTRUCT's x, y, cx and cy in WM_CREATE.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\USEDEF2.OUT"

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
    window = CreateWindow("UseDef2", what, style, x, y, cx, cy, NULL, NULL,
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
    HWND made[4];

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
    kind.lpszClassName = "UseDef2";
    RegisterClass(&kind);

    made[0] = make("first, x default, y 0, 320x384", WS_OVERLAPPEDWINDOW, CW_USEDEFAULT, 0, 320,
                   384);
    made[1] = make("second, x default, y 0, 320x384", WS_OVERLAPPEDWINDOW, CW_USEDEFAULT, 0, 320,
                   384);
    made[2] = make("x default, y 1, 320x384", WS_OVERLAPPEDWINDOW, CW_USEDEFAULT, 1, 320, 384);
    made[3] = make("all default", WS_OVERLAPPEDWINDOW, CW_USEDEFAULT, CW_USEDEFAULT,
                   CW_USEDEFAULT, CW_USEDEFAULT);

    {
        int i;

        for (i = 0; i < 4; i++) {
            DestroyWindow(made[i]);
        }
    }

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
