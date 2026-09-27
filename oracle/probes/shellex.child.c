/*
 * The program `shellex.c` starts through ShellExecute: it writes a line to C:\ORACLE\CHILD.TXT at
 * each step -- what WinMain was given, its window made, the first message
 * taken, and its end -- and closes when its window is closed.
 */

#include <windows.h>

#define LOG "C:\\ORACLE\\CHILD.TXT"

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
    if (message == WM_DESTROY) {
        PostQuitMessage(0);
        return 0;
    }

    return DefWindowProc(window, message, wParam, lParam);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    char line[200];
    WNDCLASS kind;
    HWND window;
    MSG msg;
    BOOL first = TRUE;

    wsprintf(line, "winmain cmd=[%s] show=%d previous=%s", command, show,
             (LPSTR)(previous ? "yes" : "no"));
    note(line);

    if (!previous) {
        kind.style = 0;
        kind.lpfnWndProc = Proc;
        kind.cbClsExtra = 0;
        kind.cbWndExtra = 0;
        kind.hInstance = instance;
        kind.hIcon = NULL;
        kind.hCursor = NULL;
        kind.hbrBackground = GetStockObject(WHITE_BRUSH);
        kind.lpszMenuName = NULL;
        kind.lpszClassName = "WinExecChild";
        RegisterClass(&kind);
    }

    window = CreateWindow("WinExecChild", "Child", WS_OVERLAPPEDWINDOW, 300, 200, 150, 100, NULL,
                          NULL, instance, NULL);
    ShowWindow(window, show);
    note("window");

    while (GetMessage(&msg, NULL, 0, 0)) {
        if (first) {
            note("first message");
            first = FALSE;
        }

        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }

    note("exit");

    return msg.wParam;
}
