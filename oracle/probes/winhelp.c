/*
 * What `WinHelp` answers when no Help is running.
 *
 * Notepad calls `WinHelp` with `HELP_QUIT` as it closes, and does not close
 * when that fails. This records the answer to that call, from a window of the
 * probe's own, with Windows Help not running:
 *
 * * `quit`: `HELP_QUIT`, for a help file no one opened.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\WINHELP.OUT"

LONG FAR PASCAL _export ProbeProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    return DefWindowProc(hwnd, message, wParam, lParam);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HWND window;

    probeOpen(OUTPUT);

    kind.style = 0;
    kind.lpfnWndProc = ProbeProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "ProbeHelp";
    RegisterClass(&kind);

    window = CreateWindow("ProbeHelp", "Help", WS_OVERLAPPEDWINDOW, 40, 40, 200, 120, NULL, NULL,
                          instance, NULL);

    wsprintf(probeResult, "%d", WinHelp(window, "NOTEPAD.HLP", HELP_QUIT, 0L));
    probe("quit", "NOTEPAD.HLP", probeResult);

    DestroyWindow(window);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
