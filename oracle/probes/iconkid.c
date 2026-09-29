/*
 * A window minimized whose client area a child fills, as a game's or an
 * MFC program's is: what shows at its icon, and what a press there reaches.
 *
 * `P`, overlapped, visible at 60,60 300 by 200, and in it `C`, a child as
 * large as its client area. P is minimized with SW_MINIMIZE, and the queue
 * pumped. Then:
 *
 * * `point`: WindowFromPoint at the icon's middle: `P`, `C`, or `other`.
 * * `visible`: IsWindowVisible of C, and of P.
 * * `paint`: whether C was sent WM_PAINT while P was minimized.
 * * `hit`: what P's DefWindowProc answers WM_NCHITTEST with at the icon's
 *   middle.
 * * `double`: WM_NCLBUTTONDBLCLK with HTCAPTION sent to P, as a double click
 *   on its icon sends it: whether P is minimized after, and zoomed.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\ICONKID.OUT"

static HWND parent;
static HWND child;
static BOOL painted;
static BOOL watching;

LONG FAR PASCAL _export ParentProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    return DefWindowProc(hwnd, message, wParam, lParam);
}

LONG FAR PASCAL _export ChildProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_PAINT) {
        PAINTSTRUCT ps;

        if (watching) {
            painted = TRUE;
        }

        BeginPaint(hwnd, &ps);
        EndPaint(hwnd, &ps);
        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

static void pump(void)
{
    MSG message;

    while (PeekMessage(&message, NULL, 0, 0, PM_REMOVE)) {
        TranslateMessage(&message);
        DispatchMessage(&message);
    }
}

static LPCSTR who(HWND hwnd)
{
    return hwnd == parent ? "P" : hwnd == child ? "C" : "other";
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    RECT client;
    RECT icon;
    POINT middle;

    probeOpen(OUTPUT);
    ShowCursor(FALSE);
    SetCursorPos(GetSystemMetrics(SM_CXSCREEN) - 1, GetSystemMetrics(SM_CYSCREEN) - 1);

    kind.style = 0;
    kind.lpfnWndProc = ParentProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = LoadIcon(NULL, IDI_APPLICATION);
    kind.hCursor = NULL;
    kind.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "IconKidParent";
    RegisterClass(&kind);

    kind.lpfnWndProc = ChildProc;
    kind.hIcon = NULL;
    kind.hbrBackground = GetStockObject(BLACK_BRUSH);
    kind.lpszClassName = "IconKidChild";
    RegisterClass(&kind);

    parent = CreateWindow("IconKidParent", "P", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 60, 60, 300,
                          200, NULL, NULL, instance, NULL);
    GetClientRect(parent, &client);
    child = CreateWindow("IconKidChild", "C", WS_CHILD | WS_VISIBLE, 0, 0, client.right,
                         client.bottom, parent, (HMENU)1, instance, NULL);
    UpdateWindow(parent);
    pump();

    watching = TRUE;
    ShowWindow(parent, SW_MINIMIZE);
    pump();
    watching = FALSE;

    GetWindowRect(parent, &icon);
    middle.x = (icon.left + icon.right) / 2;
    middle.y = (icon.top + icon.bottom) / 2;

    probe("point", "middle", who(WindowFromPoint(middle)));
    probe("visible", "C", IsWindowVisible(child) ? "yes" : "no");
    probe("visible", "P", IsWindowVisible(parent) ? "yes" : "no");
    probe("paint", "C", painted ? "yes" : "no");

    wsprintf(probeResult, "%d",
             (int)DefWindowProc(parent, WM_NCHITTEST, 0, MAKELONG(middle.x, middle.y)));
    probe("hit", "middle", probeResult);

    SendMessage(parent, WM_NCLBUTTONDBLCLK, HTCAPTION, MAKELONG(middle.x, middle.y));
    pump();
    wsprintf(probeResult, "iconic=%d,zoomed=%d", IsIconic(parent) ? 1 : 0,
             IsZoomed(parent) ? 1 : 0);
    probe("double", "caption", probeResult);

    DestroyWindow(parent);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
