/*
 * The program `bcast.c` starts: an overlapped window, "Probe X", at (400,
 * 300), 160 by 100, which writes a line to C:\ORACLE\BCAST.TXT for each
 * message of the probe's it is handed -- `X`, `s` where it was sent
 * (`InSendMessage`) and `p` where it was posted, the message, `wParam` and
 * `lParam` as `bcast.c` writes them -- and `X:done` for `WM_USER + 1`,
 * which the probe posts it after each of its posts, so that the probe
 * knows when this program has taken all that was posted before. It closes
 * when its window is closed.
 */

#include <windows.h>

#define LOG "C:\\ORACLE\\BCAST.TXT"

static UINT registered;

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
    char line[120];
    char how = InSendMessage() ? 's' : 'p';

    if (message == registered) {
        wsprintf(line, "X:%c:R:%u:%lx", how, wParam, lParam);
        note(line);
        return 0;
    }

    if (message == WM_WININICHANGE || message == WM_DEVMODECHANGE) {
        if (lParam) {
            wsprintf(line, "X:%c:%s:%u:o%u:%s", how,
                     (LPSTR)(message == WM_WININICHANGE ? "ini" : "dev"), wParam,
                     LOWORD(lParam), (LPSTR)lParam);
        } else {
            wsprintf(line, "X:%c:%s:%u:null", how,
                     (LPSTR)(message == WM_WININICHANGE ? "ini" : "dev"), wParam);
        }

        note(line);
        return 0;
    }

    if (message == WM_USER + 5) {
        wsprintf(line, "X:%c:u5:%u:%lx", how, wParam, lParam);
        note(line);
        return 77;
    }

    if (message == WM_USER + 1) {
        note("X:done");
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

    registered = RegisterWindowMessage("BcastProbe");

    kind.style = 0;
    kind.lpfnWndProc = Proc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "BcastX";
    RegisterClass(&kind);

    window = CreateWindow("BcastX", "Probe X", WS_OVERLAPPEDWINDOW, 400, 300, 160, 100, NULL,
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
