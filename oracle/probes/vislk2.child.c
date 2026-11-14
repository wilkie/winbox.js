/*
 * The program `vislk2.c` starts: a window, "Probe Lock B", at (340, 40),
 * 200 by 150, which answers `WM_USER` sent it by the other program with
 * `LockWindowUpdate`'s answer: of nought where `wParam` is 0, of its own
 * window where it is 1, of the window `lParam` names where it is 2. It
 * closes when its window is closed.
 */

#include <windows.h>

LRESULT CALLBACK __export Proc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_USER) {
        switch (wParam) {
        case 0:
            return LockWindowUpdate(NULL);
        case 1:
            return LockWindowUpdate(window);
        default:
            return LockWindowUpdate((HWND)LOWORD(lParam));
        }
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
    kind.lpszClassName = "VisLk2B";
    RegisterClass(&kind);

    window = CreateWindow("VisLk2B", "Probe Lock B", WS_OVERLAPPEDWINDOW, 340, 40, 200, 150, NULL,
                          NULL, instance, NULL);
    ShowWindow(window, SW_SHOWNOACTIVATE);
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
