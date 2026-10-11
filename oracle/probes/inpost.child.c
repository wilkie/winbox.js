/*
 * The program `inpost.c` starts: a window, "Probe B", at (340, 40), 200 by
 * 150, which writes a line to C:\ORACLE\POST.TXT for each key's message it
 * is handed -- `B`, the message and the virtual key, in hex -- and for
 * `WM_USER`, sent it by the other program, what `PeekMessage` with
 * `PM_REMOVE` then finds of the keys' messages (`B:peek:`); it closes when
 * its window is closed.
 */

#include <windows.h>

#define LOG "C:\\ORACLE\\POST.TXT"

static void note(LPCSTR text)
{
    HFILE file = _lopen(LOG, OF_READWRITE);

    if (file == HFILE_ERROR) {
        file = _lcreat(LOG, 0);
    }

    _llseek(file, 0L, 2);
    _lwrite(file, text, lstrlen(text));
    _lwrite(file, "\r\n", 2);
    _lclose(file);
}

LRESULT CALLBACK __export Proc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    char line[40];
    MSG msg;

    if (message >= WM_KEYDOWN && message <= WM_SYSCHAR) {
        wsprintf(line, "B:%x:%x", message, wParam);
        note(line);
        return 0;
    }

    if (message == WM_USER) {
        if (PeekMessage(&msg, NULL, WM_KEYFIRST, WM_KEYLAST, PM_REMOVE)) {
            wsprintf(line, "B:peek:%x:%x", msg.message, msg.wParam);
        } else {
            lstrcpy(line, "B:peek:none");
        }

        note(line);
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
    kind.lpszClassName = "InPostB";
    RegisterClass(&kind);

    window = CreateWindow("InPostB", "Probe B", WS_OVERLAPPEDWINDOW, 340, 40, 200, 150, NULL,
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
