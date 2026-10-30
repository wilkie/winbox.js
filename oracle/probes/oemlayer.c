/*
 * USER's ordinals 4 and 3, DisableOEMLayer and EnableOEMLayer, called by
 * ordinal one after the other: the screen and the input given up, as for a
 * full-screen DOS program, and taken back (`USER.EXE` seg5 `01a2`,
 * `0165`).
 *
 * * `cursor`: `ShowCursor`'s count before and after each (read by a show
 *   and a hide).
 * * `queue`: whether a message posted to the probe's window before
 *   DisableOEMLayer is still there after EnableOEMLayer.
 * * `paint`: the paint messages the probe's window and its child get after,
 *   counted as they are dispatched: `WM_NCPAINT`, `WM_ERASEBKGND`,
 *   `WM_PAINT`, for each window.
 * * `keystate`: `GetKeyState(VK_SHIFT)` after.
 */

#include "probe.h"
#include <string.h>

#define OUTPUT "C:\\ORACLE\\OEMLAYER.OUT"

typedef void(FAR PASCAL *VOIDPROC)(void);

static HWND main;
static HWND child;
static int counts[2][3];

static int cursorCount(void)
{
    ShowCursor(TRUE);
    return ShowCursor(FALSE);
}

LRESULT CALLBACK __export WindowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    int which = window == main ? 0 : 1;

    switch (message) {
    case WM_NCPAINT:
        counts[which][0]++;
        break;
    case WM_ERASEBKGND:
        counts[which][1]++;
        break;
    case WM_PAINT:
        counts[which][2]++;
        break;
    }

    return DefWindowProc(window, message, wParam, lParam);
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
    WNDCLASS wc;
    HMODULE user;
    VOIDPROC disable;
    VOIDPROC enable;
    MSG msg;
    BOOL there;

    probeOpen(OUTPUT);

    user = GetModuleHandle("USER");
    disable = (VOIDPROC)GetProcAddress(user, MAKEINTRESOURCE(4));
    enable = (VOIDPROC)GetProcAddress(user, MAKEINTRESOURCE(3));

    wc.style = 0;
    wc.lpfnWndProc = WindowProc;
    wc.cbClsExtra = 0;
    wc.cbWndExtra = 0;
    wc.hInstance = instance;
    wc.hIcon = NULL;
    wc.hCursor = LoadCursor(NULL, IDC_ARROW);
    wc.hbrBackground = GetStockObject(WHITE_BRUSH);
    wc.lpszMenuName = NULL;
    wc.lpszClassName = "OemProbe";
    RegisterClass(&wc);

    main = CreateWindow("OemProbe", "OEM", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 20, 20, 300, 200,
                        NULL, NULL, instance, NULL);
    child = CreateWindow("OemProbe", "", WS_CHILD | WS_VISIBLE | WS_BORDER, 10, 10, 80, 60, main,
                         (HMENU)1, instance, NULL);
    UpdateWindow(main);
    pump();

    wsprintf(probeResult, "%d", cursorCount());
    probe("cursor", "before", probeResult);

    PostMessage(main, WM_USER + 1, 0, 0L);
    disable();
    wsprintf(probeResult, "%d", cursorCount());
    probe("cursor", "after disable", probeResult);
    enable();
    wsprintf(probeResult, "%d", cursorCount());
    probe("cursor", "after enable", probeResult);

    there = PeekMessage(&msg, main, WM_USER + 1, WM_USER + 1, PM_REMOVE);
    probe("queue", "posted before", there ? "there" : "gone");

    memset(counts, 0, sizeof(counts));
    pump();
    wsprintf(probeResult, "nc=%d erase=%d paint=%d", counts[0][0], counts[0][1], counts[0][2]);
    probe("paint", "main", probeResult);
    wsprintf(probeResult, "nc=%d erase=%d paint=%d", counts[1][0], counts[1][1], counts[1][2]);
    probe("paint", "child", probeResult);

    wsprintf(probeResult, "%04x", (UINT)GetKeyState(VK_SHIFT));
    probe("keystate", "shift", probeResult);

    DestroyWindow(main);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
