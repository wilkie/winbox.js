/*
 * The program `rdwmore.c` starts: a hidden window, "Probe R", which for
 * `WM_USER + 1` invalidates the window `wParam` names, all of it, without
 * an erase, from this task (`USER.EXE` seg1 `4242`-`424c`), and for
 * `WM_USER + 2` validates it. It closes when its window is closed.
 */

#include <windows.h>

LRESULT CALLBACK __export Proc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_USER + 1) {
        InvalidateRect((HWND)wParam, NULL, FALSE);
        return 1;
    }

    if (message == WM_USER + 2) {
        ValidateRect((HWND)wParam, NULL);
        return 1;
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
    MSG msg;

    kind.style = 0;
    kind.lpfnWndProc = Proc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = NULL;
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "RdwMoreR";
    RegisterClass(&kind);

    CreateWindow("RdwMoreR", "Probe R", WS_OVERLAPPED, 500, 400, 100, 60, NULL, NULL, instance,
                 NULL);

    while (GetMessage(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
