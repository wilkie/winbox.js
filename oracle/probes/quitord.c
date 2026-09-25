/*
 * Where `WM_QUIT` comes, among what else is waiting.
 *
 * `PostQuitMessage` does not put a message in the queue: in USER it sets a
 * flag in the task's queue, with the exit code beside it. This records where
 * the message that flag makes comes out:
 *
 * * `order`: a message posted, then the quit, then another message posted, a
 *   window made due to be painted and a timer let come due -- then each
 *   message `PeekMessage` takes, in turn, until the queue is empty.
 * * `again`: whether the quit comes out a second time.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\QUITORD.OUT"

LONG FAR PASCAL _export ProbeProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    return DefWindowProc(hwnd, message, wParam, lParam);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HWND window;
    MSG message;
    DWORD start;
    int index;
    int quits = 0;

    probeOpen(OUTPUT);

    kind.style = 0;
    kind.lpfnWndProc = ProbeProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "ProbeQuit";
    RegisterClass(&kind);

    window = CreateWindow("ProbeQuit", "Quit", WS_OVERLAPPEDWINDOW, 40, 40, 200, 120, NULL, NULL,
                          instance, NULL);
    ShowWindow(window, SW_SHOWNORMAL);
    UpdateWindow(window);

    /* Everything else out of the queue first. */
    while (PeekMessage(&message, NULL, 0, 0, PM_REMOVE)) {
        DispatchMessage(&message);
    }

    PostMessage(window, WM_USER, 1, 0L);
    PostQuitMessage(7);
    PostMessage(window, WM_USER, 2, 0L);
    InvalidateRect(window, NULL, TRUE);
    SetTimer(window, 1, 55, NULL);

    start = GetTickCount();
    while (GetTickCount() - start < 250) {
    }

    for (index = 0; index < 12 && PeekMessage(&message, NULL, 0, 0, PM_REMOVE); index++) {
        wsprintf(probeArgs, "%d", index);
        wsprintf(probeResult, "message=%04x,wParam=%d", message.message, message.wParam);
        probe("order", probeArgs, probeResult);

        if (message.message == WM_QUIT) {
            quits++;
        } else if (message.message == WM_PAINT) {
            ValidateRect(window, NULL);
        } else if (message.message == WM_TIMER) {
            KillTimer(window, 1);
        }
    }

    wsprintf(probeResult, "%d", quits);
    probe("again", "quits", probeResult);

    DestroyWindow(window);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
