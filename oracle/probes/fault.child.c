/*
 * The program `fault.c` starts: it makes a window of its own and waits for
 * messages. Told WM_USER, it loads a selector past the end of the
 * descriptor table into ES, which a processor faults on.
 */

#include <windows.h>

void badSelector(void);
#pragma aux badSelector = "mov ax, 0fff7h" "mov es, ax" modify [ax es];

LRESULT CALLBACK __export Proc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_USER) {
        badSelector();
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
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "FaultChild";
    RegisterClass(&kind);
    CreateWindow("FaultChild", "Faulting", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 100, 100, 200, 150,
                 NULL, NULL, instance, NULL);

    while (GetMessage(&msg, NULL, 0, 0)) {
        DispatchMessage(&msg);
    }

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
