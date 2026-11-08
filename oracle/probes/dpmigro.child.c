/*
 * `dpmigro`'s second program: a window, hidden, whose timer writes a
 * `tick` record to the probe's file every 200 ms, fifteen times, then
 * ends. Each record is written by opening the file, writing at its end and
 * closing it again, so that the probe's own records and these lie in the
 * order they were written.
 */

#include <string.h>
#include <windows.h>

#define OUTPUT "C:\\ORACLE\\DPMIGRO.OUT"

static UINT ticks;

static void tick(void)
{
    char line[32];
    HFILE file = _lopen(OUTPUT, OF_WRITE);
    int length;

    if (file == HFILE_ERROR) {
        return;
    }

    length = wsprintf(line, "tick\t%u\tyes\r\n", ticks);
    _llseek(file, 0L, 2);
    _lwrite(file, line, length);
    _lclose(file);
}

LRESULT CALLBACK _export ChildProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_TIMER) {
        tick();
        if (++ticks >= 15) {
            KillTimer(window, 1);
            DestroyWindow(window);
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
    WNDCLASS wc;
    HWND window;
    MSG msg;

    memset(&wc, 0, sizeof(wc));
    wc.lpfnWndProc = ChildProc;
    wc.hInstance = instance;
    wc.lpszClassName = "DpmiGroC";
    RegisterClass(&wc);

    window = CreateWindow("DpmiGroC", "", WS_OVERLAPPED, 0, 0, 10, 10, NULL, NULL, instance,
                          NULL);
    SetTimer(window, 1, 200, NULL);

    while (GetMessage(&msg, NULL, 0, 0)) {
        DispatchMessage(&msg);
    }

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
