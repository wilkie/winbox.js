/*
 * The program `tasks2.c` starts: it writes a line to C:\ORACLE\CHILD.TXT
 * as it starts -- what WinMain was given and the current directory -- and
 * one for each WM_USER it takes, with its wParam; it closes when its window
 * is closed.
 */

#include <windows.h>
#include <direct.h>

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
    char line[40];

    if (message == WM_USER) {
        wsprintf(line, "got %u", wParam);
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
    char line[200];
    char directory[80];
    WNDCLASS kind;
    HWND window;
    MSG msg;

    directory[0] = '\0';
    getcwd(directory, sizeof(directory));
    wsprintf(line, "winmain cmd=[%s] show=%d previous=%s cwd=%s", command, show,
             (LPSTR)(previous ? "yes" : "no"), (LPSTR)directory);
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
        kind.lpszClassName = "Tasks2Child";
        RegisterClass(&kind);
    }

    window = CreateWindow("Tasks2Child", command, WS_OVERLAPPEDWINDOW, 300, 200, 150, 100, NULL,
                          NULL, instance, NULL);
    ShowWindow(window, show);

    while (GetMessage(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }

    return msg.wParam;
}
