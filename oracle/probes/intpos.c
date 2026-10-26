/*
 * GetInternalWindowPos and SetInternalWindowPos, called by ordinal, on an
 * overlapped window made at (30, 40), 200 by 120:
 *
 * * `get`: the answer, the rectangle and the point, normal, minimized and
 *   maximized; `-` where nothing was written.
 * * `set`: the answer, then GetWindowRect and IsIconic/IsZoomed after.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\INTPOS.OUT"

typedef UINT(FAR PASCAL *GETPROC)(HWND, LPRECT, LPPOINT);
typedef BOOL(FAR PASCAL *SETPROC)(HWND, UINT, LPRECT, LPPOINT);

static HMODULE user;
static HWND window;

static void get(LPCSTR what)
{
    RECT rect;
    POINT point;
    UINT answer;

    rect.left = rect.top = rect.right = rect.bottom = -7;
    point.x = point.y = -7;
    answer = ((GETPROC)GetProcAddress(user, MAKEINTRESOURCE(460)))(window, &rect, &point);
    wsprintf(probeResult, "%u: %d,%d,%d,%d %d,%d", answer, rect.left, rect.top, rect.right,
             rect.bottom, point.x, point.y);
    probe("get", what, probeResult);
}

static void after(LPCSTR what, BOOL answer)
{
    RECT rect;

    GetWindowRect(window, &rect);
    wsprintf(probeResult, "%d: %d,%d,%d,%d %s%s", answer, rect.left, rect.top, rect.right,
             rect.bottom, (LPSTR)(IsIconic(window) ? "iconic" : ""),
             (LPSTR)(IsZoomed(window) ? "zoomed" : ""));
    probe("set", what, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    MSG msg;
    RECT rect;
    POINT point;
    SETPROC set;

    probeOpen(OUTPUT);
    user = GetModuleHandle("USER");
    set = (SETPROC)GetProcAddress(user, MAKEINTRESOURCE(461));
    window = CreateWindow("STATIC", "", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 30, 40, 200, 120, NULL,
                          NULL, instance, NULL);

    while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
        DispatchMessage(&msg);
    }

    get("normal");
    ShowWindow(window, SW_MINIMIZE);
    get("minimized");
    ShowWindow(window, SW_RESTORE);
    ShowWindow(window, SW_MAXIMIZE);
    get("maximized");
    ShowWindow(window, SW_RESTORE);
    get("restored");

    rect.left = 50;
    rect.top = 60;
    rect.right = 250;
    rect.bottom = 160;
    after("normal rect", set(window, SW_SHOWNORMAL, &rect, NULL));
    get("after normal rect");

    point.x = 100;
    point.y = 400;
    after("minimize at point", set(window, SW_SHOWMINIMIZED, NULL, &point));
    get("after minimize at point");

    after("restore", set(window, SW_SHOWNORMAL, NULL, NULL));
    get("after restore");

    DestroyWindow(window);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
