/*
 * The program `sysdlg.c` starts: three windows at the top, "Probe C" at
 * (360, 40) and "Probe E" at (360, 220), shown, and "Probe G", hidden. Each
 * appends a line to C:\ORACLE\SYSDLG.TXT for each message `sysdlg.c` logs
 * of its own: the window, the message, `wParam` and `lParam` in hex, and
 * for the position messages the flags and the window to go after. `WM_USER`
 * posted to it is answered by posting `WM_USER + 1` back to the window its
 * `wParam` names. It closes when "Probe C" is closed.
 */

#include <windows.h>

#define LOG "C:\\ORACLE\\SYSDLG.TXT"

static char line[80];
static HWND mainWindow;

static void note(void)
{
    HFILE file = _lopen(LOG, OF_READWRITE);

    if (file == HFILE_ERROR) {
        file = _lcreat(LOG, 0);
    }

    _llseek(file, 0L, 2);
    _lwrite(file, line, lstrlen(line));
    _lwrite(file, "\r\n", 2);
    _lclose(file);
}

/* Apart, so that the far pointer is loaded only where it is one. */
static void logPosition(HWND window, UINT message, WINDOWPOS FAR *pos)
{
    wsprintf(line, "%04x %04x %04x %04x", window, message, pos->flags, pos->hwndInsertAfter);
    note();
}

LRESULT CALLBACK __export Proc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    switch (message) {
    case WM_ACTIVATEAPP:
    case WM_NCACTIVATE:
    case WM_ACTIVATE:
    case WM_SETFOCUS:
    case WM_KILLFOCUS:
    case WM_ENABLE:
    case WM_CANCELMODE:
    case WM_KEYDOWN:
    case WM_USER:
        wsprintf(line, "%04x %04x %04x %08lx", window, message, wParam, lParam);
        note();
        break;
    case WM_WINDOWPOSCHANGING:
    case WM_WINDOWPOSCHANGED:
        logPosition(window, message, (WINDOWPOS FAR *)lParam);
        break;
    }

    if (message == WM_USER) {
        PostMessage((HWND)wParam, WM_USER + 1, 0, 0L);
        return 0;
    }

    if (message == WM_DESTROY && window == mainWindow) {
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
    kind.lpszClassName = "SysDlgC";
    RegisterClass(&kind);

    CreateWindow("SysDlgC", "Probe G", WS_OVERLAPPEDWINDOW, 380, 120, 200, 100, NULL, NULL,
                 instance, NULL);
    window = CreateWindow("SysDlgC", "Probe E", WS_OVERLAPPEDWINDOW, 360, 220, 220, 150, NULL,
                          NULL, instance, NULL);
    ShowWindow(window, SW_SHOWNORMAL);
    UpdateWindow(window);
    window = CreateWindow("SysDlgC", "Probe C", WS_OVERLAPPEDWINDOW, 360, 40, 220, 150, NULL,
                          NULL, instance, NULL);
    mainWindow = window;
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
