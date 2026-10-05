/*
 * The program `curdir.c` starts: it writes a line to C:\ORACLE\CURDIR.TXT
 * as it starts and once it has changed to C:\ORACLE\CB, each with its
 * current directory, and one for each WM_USER it takes, with its wParam and
 * its current directory. At the second it makes REL.TXT by a relative name.
 * It closes when its window is closed.
 */

#include <windows.h>
#include <direct.h>

#define LOG "C:\\ORACLE\\CURDIR.TXT"

static void note(LPCSTR what)
{
    char line[160];
    char directory[80];
    HFILE file;

    directory[0] = '\0';
    getcwd(directory, sizeof(directory));
    wsprintf(line, "%s cwd=%s\r\n", what, (LPSTR)directory);

    file = _lopen(LOG, OF_READWRITE);

    if (file == HFILE_ERROR) {
        file = _lcreat(LOG, 0);
    }

    _llseek(file, 0L, 2);
    _lwrite(file, line, lstrlen(line));
    _lclose(file);
}

LRESULT CALLBACK __export Proc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    char line[40];
    HFILE file;

    if (message == WM_USER) {
        wsprintf(line, "got %u", wParam);
        note(line);

        if (wParam == 2) {
            file = _lcreat("REL.TXT", 0);
            _lclose(file);
        }

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

    note("winmain");
    chdir("C:\\ORACLE\\CB");
    note("changed");

    kind.style = 0;
    kind.lpfnWndProc = Proc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "CurDirChild";
    RegisterClass(&kind);

    window = CreateWindow("CurDirChild", "Child", WS_OVERLAPPEDWINDOW, 300, 200, 150, 100, NULL,
                          NULL, instance, NULL);
    ShowWindow(window, show);

    while (GetMessage(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }

    note("exit");

    (void)previous;
    (void)command;
    return msg.wParam;
}
