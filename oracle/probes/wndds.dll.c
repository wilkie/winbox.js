/*
 * The library `wndds.c` hands its window to: each export gets a message to
 * the window from the library's own code, where DS is the library's.
 */

#include <windows.h>

void FAR PASCAL _export Send(HWND window)
{
    SendMessage(window, WM_USER, 1, 0L);
}

void FAR PASCAL _export Dispatch(HWND window)
{
    MSG msg;

    PostMessage(window, WM_USER, 2, 0L);

    while (PeekMessage(&msg, window, WM_USER, WM_USER, PM_REMOVE)) {
        DispatchMessage(&msg);
    }
}

void FAR PASCAL _export Call(HWND window)
{
    CallWindowProc((FARPROC)GetWindowLong(window, GWL_WNDPROC), window, WM_USER, 3, 0L);
}

int FAR PASCAL LibMain(HANDLE instance, WORD data, WORD heap, LPSTR command)
{
    (void)instance;
    (void)data;
    (void)heap;
    (void)command;
    return 1;
}

int FAR PASCAL _export WEP(int exiting)
{
    (void)exiting;
    return 1;
}
