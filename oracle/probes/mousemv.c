/*
 * Whether USER gives a window a mouse move of its own accord: a window
 * shown under the cursor, one shown clear of it, and one moved under it,
 * each looked at with PeekMessage before anything else is done.
 *
 * * `queue`: the messages waiting for the probe's windows, in order, as
 *   their numbers in hex, with a mouse message's point after it; `none`.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\MOUSEMV.OUT"

static void queue(LPCSTR what)
{
    MSG msg;
    char one[40];
    int count = 0;

    probeResult[0] = '\0';

    while (count < 12 && PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
        if (msg.message == WM_PAINT) {
            DispatchMessage(&msg);
            continue;
        }

        if (msg.message >= WM_MOUSEFIRST && msg.message <= WM_MOUSELAST) {
            wsprintf(one, "%x(%d,%d),", msg.message, LOWORD(msg.lParam), HIWORD(msg.lParam));
        } else {
            wsprintf(one, "%x,", msg.message);
        }

        lstrcat(probeResult, one);
        DispatchMessage(&msg);
        count++;
    }

    probe("queue", what, probeResult[0] ? probeResult : "none");
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HWND under;
    HWND clear;

    probeOpen(OUTPUT);

    kind.style = 0;
    kind.lpfnWndProc = DefWindowProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = LoadCursor(NULL, IDC_ARROW);
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "MouseMove";
    RegisterClass(&kind);

    SetCursorPos(320, 240);
    queue("before any window");

    clear = CreateWindow("MouseMove", "Clear", WS_OVERLAPPEDWINDOW, 0, 0, 200, 150, NULL, NULL,
                         instance, NULL);
    ShowWindow(clear, SW_SHOWNORMAL);
    UpdateWindow(clear);
    queue("shown clear of the cursor");

    under = CreateWindow("MouseMove", "Under", WS_OVERLAPPEDWINDOW, 200, 150, 240, 200, NULL,
                         NULL, instance, NULL);
    ShowWindow(under, SW_SHOWNORMAL);
    UpdateWindow(under);
    queue("shown under the cursor");

    queue("nothing done since");

    SetWindowPos(clear, NULL, 250, 200, 0, 0, SWP_NOSIZE | SWP_NOZORDER);
    queue("another moved under the cursor");

    SetCursorPos(10, 10);
    queue("cursor set elsewhere");

    DestroyWindow(under);
    DestroyWindow(clear);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
