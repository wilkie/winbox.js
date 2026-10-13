/*
 * The program `ddeleft.c` starts, "Left Server": it allocates blocks of
 * global memory when the probe asks, for the probe to look at once this
 * program has gone. `WM_USER + 8` answers a plain block and one of
 * `GMEM_DDESHARE`; `WM_USER + 10` a plain block made shared afterwards by
 * `GlobalReAlloc` with `GMEM_MODIFY`, and a fixed one of `GMEM_DDESHARE`;
 * `WM_USER + 9` closes it. Started with `2` on its command line, it is a
 * second copy of the program, "Left Server 2", which only keeps the module
 * loaded.
 */

#include <windows.h>

LRESULT CALLBACK __export Proc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    HGLOBAL handle;

    switch (message) {
    case WM_USER + 8:
        return MAKELONG(GlobalAlloc(GMEM_MOVEABLE, 32),
                        GlobalAlloc(GMEM_MOVEABLE | GMEM_DDESHARE, 32));

    case WM_USER + 10:
        handle = GlobalAlloc(GMEM_MOVEABLE, 32);
        return MAKELONG(GlobalReAlloc(handle, 0, GMEM_MODIFY | GMEM_DDESHARE),
                        GlobalAlloc(GMEM_FIXED | GMEM_DDESHARE, 32));

    case WM_USER + 9:
        DestroyWindow(window);
        return 0;

    case WM_DESTROY:
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
    kind.lpszClassName = "DdeLeftS";

    /* A second copy uses the class the first registered. */
    if (!previous) {
        RegisterClass(&kind);
    }

    window = CreateWindow("DdeLeftS", command[0] == '2' ? "Left Server 2" : "Left Server",
                          WS_OVERLAPPEDWINDOW, 400, 300, 160, 100, NULL, NULL, instance, NULL);
    ShowWindow(window, SW_SHOWNOACTIVATE);
    UpdateWindow(window);

    while (GetMessage(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }

    (void)show;
    return 0;
}
