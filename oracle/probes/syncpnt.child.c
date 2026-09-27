/*
 * The program `syncpnt.c` starts: it shows a window of its own over the
 * probe's, hides it, and waits for messages until it is closed.
 */

#include <windows.h>

LRESULT CALLBACK __export Proc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
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
    kind.hbrBackground = GetStockObject(BLACK_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "SyncCover";
    RegisterClass(&kind);

    window = CreateWindow("SyncCover", "", WS_POPUP | WS_VISIBLE, 20, 100, 200, 100, NULL, NULL,
                          instance, NULL);
    UpdateWindow(window);
    ShowWindow(window, SW_HIDE);

    while (GetMessage(&msg, NULL, 0, 0)) {
        DispatchMessage(&msg);
    }

    (void)previous;
    (void)command;
    (void)show;
    return msg.wParam;
}
