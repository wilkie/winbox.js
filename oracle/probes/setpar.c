/*
 * `SetParent`'s hiding before and showing after (`USER.EXE` seg14
 * `041a`-`04e0`): a visible window is hidden with `ShowWindow(SW_HIDE)`
 * (`0437`, seg14 `0bf2`), given its parent, moved with `SetWindowPos`
 * (`SWP_NOSIZE | SWP_NOZORDER`, `04b7`-`04c6`), and shown again with
 * `ShowWindow(SW_SHOWNORMAL)` (`04d1`).
 *
 * P1 is an overlapped window 300 by 200 at (20, 20); P2 another, 200 by
 * 150 at (340, 20). C is a child of P1, 60 by 40 at (10, 10), shown; H a
 * child of P1 the same at (80, 10), hidden; D a child of P1 at (150, 10),
 * shown, whose class has `CS_HREDRAW`. Each window's procedure writes down
 * what it is sent -- `WM_SHOWWINDOW` with its two words, the two
 * `WM_WINDOWPOS` messages with their flags, `WM_MOVE` and `WM_SIZE` with
 * theirs, `WM_NCPAINT`, `WM_ERASEBKGND`, `WM_NCACTIVATE`, `WM_ACTIVATE`
 * and `WM_CHILDACTIVATE` -- and each case is a record of what was written
 * during the call, `|` between, then of the window's visibility and
 * place in its new parent after.
 */

#define PROBE_FLUSH
#include "probe.h"

#define OUTPUT "C:\\ORACLE\\SETPAR.OUT"

static char text[1600];
static LPSTR at;

static void note(HWND window, LPCSTR line)
{
    char name[8];

    GetWindowText(window, name, sizeof name);

    if (at - text < (int)sizeof text - 80) {
        at += wsprintf(at, "%s%s:%s", (LPSTR)(at == text ? "" : "|"), (LPSTR)name, line);
    }
}

LRESULT CALLBACK __export Proc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    char line[60];

    switch (message) {
    case WM_SHOWWINDOW:
        wsprintf(line, "show %u %lu", wParam, lParam);
        note(window, line);
        break;
    case WM_WINDOWPOSCHANGING:
    case WM_WINDOWPOSCHANGED: {
        WINDOWPOS FAR *pos = (WINDOWPOS FAR *)lParam;

        wsprintf(line, "%s %x %d,%d %dx%d",
                 (LPSTR)(message == WM_WINDOWPOSCHANGING ? "changing" : "changed"), pos->flags,
                 pos->x, pos->y, pos->cx, pos->cy);
        note(window, line);
        break;
    }
    case WM_MOVE:
        wsprintf(line, "move %d,%d", (int)LOWORD(lParam), (int)HIWORD(lParam));
        note(window, line);
        break;
    case WM_SIZE:
        wsprintf(line, "size %u %d,%d", wParam, (int)LOWORD(lParam), (int)HIWORD(lParam));
        note(window, line);
        break;
    case WM_NCPAINT:
        note(window, "ncpaint");
        break;
    case WM_ERASEBKGND:
        note(window, "erase");
        break;
    case WM_NCACTIVATE:
        wsprintf(line, "ncactivate %u", wParam);
        note(window, line);
        break;
    case WM_ACTIVATE:
        wsprintf(line, "activate %u", wParam);
        note(window, line);
        break;
    case WM_CHILDACTIVATE:
        note(window, "childactivate");
        break;
    }

    return DefWindowProc(window, message, wParam, lParam);
}

static void start(void)
{
    at = text;
    *at = '\0';
}

static void after(LPCSTR what, HWND window, HWND parent)
{
    RECT rect;

    probe(what, "sent", at == text ? "-" : text);
    GetWindowRect(window, &rect);
    ScreenToClient(parent, (POINT FAR *)&rect.left);
    wsprintf(probeResult, "visible %d style visible %d at %d,%d", IsWindowVisible(window) ? 1 : 0,
             GetWindowLong(window, GWL_STYLE) & WS_VISIBLE ? 1 : 0, rect.left, rect.top);
    probe(what, "after", probeResult);
}

static void pump(void)
{
    MSG msg;

    while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
        DispatchMessage(&msg);
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HWND p1, p2, c, h, d;
    HWND old;

    probeOpen(OUTPUT);
    start();

    kind.style = 0;
    kind.lpfnWndProc = Proc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "SetPar";
    RegisterClass(&kind);
    kind.style = CS_HREDRAW;
    kind.lpszClassName = "SetParH";
    RegisterClass(&kind);

    p1 = CreateWindow("SetPar", "P1", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 20, 20, 300, 200, NULL, NULL,
                      instance, NULL);
    p2 = CreateWindow("SetPar", "P2", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 340, 20, 200, 150, NULL, NULL,
                      instance, NULL);
    c = CreateWindow("SetPar", "C", WS_CHILD | WS_VISIBLE, 10, 10, 60, 40, p1, NULL, instance, NULL);
    h = CreateWindow("SetPar", "H", WS_CHILD, 80, 10, 60, 40, p1, NULL, instance, NULL);
    d = CreateWindow("SetParH", "D", WS_CHILD | WS_VISIBLE, 150, 10, 60, 40, p1, NULL, instance,
                     NULL);
    UpdateWindow(p1);
    UpdateWindow(p2);
    pump();

    start();
    old = SetParent(c, p2);
    probe("shown", "answer is P1", old == p1 ? "yes" : "no");
    after("shown", c, p2);
    pump();

    start();
    SetParent(h, p2);
    after("hidden", h, p2);
    pump();

    start();
    SetParent(d, p2);
    after("hredraw", d, p2);
    pump();

    start();
    SetParent(c, p2);
    after("same parent", c, p2);
    pump();

    DestroyWindow(p2);
    DestroyWindow(p1);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
