/*
 * The program `lockinp.c` starts: a window, "Probe C", at (380, 40), 200 by
 * 150, which answers `WM_USER` posted to it by posting `WM_USER + 1` back to
 * the window its `wParam` names; it closes when its window is closed.
 */

#include <windows.h>

LRESULT CALLBACK __export Proc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_USER) {
        PostMessage((HWND)wParam, WM_USER + 1, 0, 0L);
        return 0;
    }

    if (message == WM_DESTROY) {
        PostQuitMessage(0);
        return 0;
    }

    return DefWindowProc(window, message, wParam, lParam);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HWND window;
    MSG msg;

    kind.style = 0;
    kind.lpfnWndProc = Proc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "LockInpC";
    RegisterClass(&kind);

    window = CreateWindow("LockInpC", "Probe C", WS_OVERLAPPEDWINDOW, 380, 40, 200, 150, NULL,
                          NULL, instance, NULL);
    ShowWindow(window, SW_SHOWNORMAL);
    UpdateWindow(window);

    while (GetMessage(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
