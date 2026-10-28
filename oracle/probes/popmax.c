/*
 * A pop-up window made with `WS_MAXIMIZE` or `WS_MINIMIZE`: whether
 * `CreateWindow` maximizes or minimizes it as it does an overlapped window
 * (`USER.EXE` seg8 `0843`-`0861` tests the style after `WM_CREATE` without
 * asking what kind of window it is), where it goes, and what it is sent.
 *
 * Widget Workshop's InstallShield Setup makes its backdrop
 * `WS_POPUP | WS_CLIPSIBLINGS | WS_CLIPCHILDREN | WS_MAXIMIZE` at (0, 0),
 * 640 by 480, and centres its dialogs on the rectangle it then has.
 *
 * `W` is made, hidden, for each case, of a class whose procedure logs, in
 * order:
 *
 * * `WM_GETMINMAXINFO`: `24:` and the five points as USER offers them,
 *   `x,y` each, `/` between.
 * * `WM_WINDOWPOSCHANGING`: `46:` the place, size and flags asked,
 *   `x,y,cx,cy,flags`.
 * * `WM_WINDOWPOSCHANGED`: `47:` the same.
 * * `WM_SIZE` `5:` the type and the size, `WM_MOVE` `3:` the point.
 * * `WM_NCCREATE` `81`, `WM_NCCALCSIZE` `83`, `WM_CREATE` `1`,
 *   `WM_SHOWWINDOW` `18:` its `wParam`.
 *
 * then `log` writes them as it is made (`made`) and `rects` the window's
 * rectangle, its client area's on the screen, and whether it is zoomed,
 * iconic and visible; then it is shown with `SW_SHOW`, and `log` and
 * `rects` again (`shown`). The cases:
 *
 * * `widget`: InstallShield's backdrop, as above.
 * * `border`: `WS_POPUP | WS_BORDER | WS_MAXIMIZE` at (10, 10), 100 by 50.
 * * `thick`: `WS_POPUP | WS_THICKFRAME | WS_MAXIMIZE`, the same.
 * * `caption`: `WS_POPUP | WS_CAPTION | WS_SYSMENU | WS_MAXIMIZE`.
 * * `owned`: `WS_POPUP | WS_MAXIMIZE` owned by `A`, a window shown at
 *   (400, 300).
 * * `min`: `WS_POPUP | WS_CAPTION | WS_MINIMIZE`, its records `minlog` and
 *   `minrects`.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\POPMAX.OUT"

static HINSTANCE module;
static char events[1500];

static void add(LPCSTR text)
{
    if (lstrlen(events) + lstrlen(text) + 2 < sizeof(events)) {
        if (events[0]) {
            lstrcat(events, " ");
        }

        lstrcat(events, text);
    }
}

LONG FAR PASCAL _export Proc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    char one[160];

    if (message == WM_GETMINMAXINFO) {
        MINMAXINFO FAR *info = (MINMAXINFO FAR *)lParam;

        wsprintf(one, "24:%d,%d/%d,%d/%d,%d/%d,%d/%d,%d", info->ptReserved.x, info->ptReserved.y,
                 info->ptMaxSize.x, info->ptMaxSize.y, info->ptMaxPosition.x,
                 info->ptMaxPosition.y, info->ptMinTrackSize.x, info->ptMinTrackSize.y,
                 info->ptMaxTrackSize.x, info->ptMaxTrackSize.y);
        add(one);
    } else if (message == WM_WINDOWPOSCHANGING || message == WM_WINDOWPOSCHANGED) {
        WINDOWPOS FAR *pos = (WINDOWPOS FAR *)lParam;

        wsprintf(one, "%x:%d,%d,%d,%d,%x", message, pos->x, pos->y, pos->cx, pos->cy,
                 pos->flags);
        add(one);
    } else if (message == WM_SIZE) {
        wsprintf(one, "5:%d,%d,%d", wParam, LOWORD(lParam), HIWORD(lParam));
        add(one);
    } else if (message == WM_MOVE) {
        wsprintf(one, "3:%d,%d", (int)LOWORD(lParam), (int)HIWORD(lParam));
        add(one);
    } else if (message == WM_SHOWWINDOW) {
        wsprintf(one, "18:%d", wParam);
        add(one);
    } else if (message == WM_NCCREATE || message == WM_NCCALCSIZE || message == WM_CREATE) {
        wsprintf(one, "%x", message);
        add(one);
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

static void pump(void)
{
    MSG message;
    int count = 0;

    while (count < 200 && PeekMessage(&message, NULL, 0, 0, PM_REMOVE)) {
        TranslateMessage(&message);
        DispatchMessage(&message);
        count++;
    }
}

/* What the records of the case are called: `log` and `rects`, or for the
 * minimized case `minlog` and `minrects`. */
static LPCSTR logName = "log";
static LPCSTR rectsName = "rects";

static void rects(LPCSTR name, HWND w)
{
    RECT window;
    RECT client;
    POINT corner;

    GetWindowRect(w, &window);
    GetClientRect(w, &client);
    corner.x = 0;
    corner.y = 0;
    ClientToScreen(w, &corner);
    wsprintf(probeResult, "window=%d:%d:%d:%d,client=%d:%d:%d:%d,zoomed=%d,iconic=%d,visible=%d",
             window.left, window.top, window.right, window.bottom, corner.x, corner.y,
             corner.x + client.right, corner.y + client.bottom, IsZoomed(w) ? 1 : 0,
             IsIconic(w) ? 1 : 0, IsWindowVisible(w) ? 1 : 0);
    probe(rectsName, name, probeResult);
}

static void made(LPCSTR name, DWORD style, int x, int y, int cx, int cy, HWND owner)
{
    HWND w;
    char label[40];

    events[0] = '\0';
    w = CreateWindow("PopMax", "W", style, x, y, cx, cy, owner, NULL, module, NULL);
    wsprintf(label, "%s-made", name);
    probe(logName, label, events);
    rects(label, w);

    events[0] = '\0';
    ShowWindow(w, SW_SHOW);
    pump();
    wsprintf(label, "%s-shown", name);
    probe(logName, label, events);
    rects(label, w);

    DestroyWindow(w);
    pump();
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HWND anchor;

    probeOpen(OUTPUT);
    module = instance;

    kind.style = 0;
    kind.lpfnWndProc = Proc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = LoadIcon(NULL, IDI_APPLICATION);
    kind.hCursor = LoadCursor(NULL, IDC_ARROW);
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "PopMax";
    RegisterClass(&kind);
    kind.lpfnWndProc = DefWindowProc;
    kind.lpszClassName = "Anchor";
    RegisterClass(&kind);

    /* The pointer out of the way. */
    ShowCursor(FALSE);
    SetCursorPos(639, 479);

    made("widget", WS_POPUP | WS_CLIPSIBLINGS | WS_CLIPCHILDREN | WS_MAXIMIZE, 0, 0,
         GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN), NULL);
    made("border", WS_POPUP | WS_BORDER | WS_MAXIMIZE, 10, 10, 100, 50, NULL);
    made("thick", WS_POPUP | WS_THICKFRAME | WS_MAXIMIZE, 10, 10, 100, 50, NULL);
    made("caption", WS_POPUP | WS_CAPTION | WS_SYSMENU | WS_MAXIMIZE, 10, 10, 100, 50, NULL);

    anchor = CreateWindow("Anchor", "A", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 400, 300, 120, 80,
                          NULL, NULL, module, NULL);
    UpdateWindow(anchor);
    pump();
    made("owned", WS_POPUP | WS_MAXIMIZE, 10, 10, 100, 50, anchor);
    logName = "minlog";
    rectsName = "minrects";
    made("min", WS_POPUP | WS_CAPTION | WS_MINIMIZE, 10, 10, 100, 50, anchor);
    DestroyWindow(anchor);
    pump();

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
