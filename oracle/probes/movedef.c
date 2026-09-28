/*
 * A window moved to CW_USEDEFAULT: MoveWindow and SetWindowPos given
 * -32768 for x and y, or for x alone, and where the window is after.
 *
 * * `rect`: GetWindowRect after each, as left, top, right, bottom.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\MOVEDEF.OUT"

static void where(LPCSTR what, HWND window)
{
    RECT area;

    GetWindowRect(window, &area);
    wsprintf(probeResult, "%d,%d,%d,%d", area.left, area.top, area.right, area.bottom);
    probe("rect", what, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HWND window;
    HWND child;

    probeOpen(OUTPUT);

    kind.style = 0;
    kind.lpfnWndProc = DefWindowProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "MoveDef";
    RegisterClass(&kind);

    window = CreateWindow("MoveDef", "MoveDef", WS_OVERLAPPEDWINDOW, 50, 60, 200, 150, NULL, NULL,
                          instance, NULL);
    where("made at 50,60 200x150", window);

    MoveWindow(window, CW_USEDEFAULT, CW_USEDEFAULT, 300, 200, FALSE);
    where("MoveWindow both default, 300x200", window);

    MoveWindow(window, 50, 60, 200, 150, FALSE);
    MoveWindow(window, CW_USEDEFAULT, 70, 300, 200, FALSE);
    where("MoveWindow x default, y 70", window);

    MoveWindow(window, 50, 60, 200, 150, FALSE);
    MoveWindow(window, 640, 480, 300, 200, FALSE);
    where("MoveWindow 640,480", window);

    MoveWindow(window, -32767, -32767, 300, 200, FALSE);
    where("MoveWindow -32767,-32767", window);

    MoveWindow(window, 50, 60, 200, 150, FALSE);
    SetWindowPos(window, NULL, CW_USEDEFAULT, CW_USEDEFAULT, 300, 200, SWP_NOZORDER | SWP_NOACTIVATE);
    where("SetWindowPos both default, 300x200", window);

    MoveWindow(window, 50, 60, 200, 150, FALSE);
    child = CreateWindow("MoveDef", "Child", WS_CHILD, 5, 5, 40, 30, window, NULL, instance, NULL);
    MoveWindow(child, CW_USEDEFAULT, CW_USEDEFAULT, 40, 30, FALSE);
    where("child MoveWindow both default", child);

    DestroyWindow(window);

    /* As a program of the corpus does it: made at CW_USEDEFAULT, moved there
     * again at 640 by 480, then shown. */
    window = CreateWindow("MoveDef", "Default", WS_OVERLAPPEDWINDOW, CW_USEDEFAULT, CW_USEDEFAULT,
                          CW_USEDEFAULT, CW_USEDEFAULT, NULL, NULL, instance, NULL);
    where("made at CW_USEDEFAULT", window);
    MoveWindow(window, CW_USEDEFAULT, CW_USEDEFAULT, 640, 480, TRUE);
    where("made at CW_USEDEFAULT, moved to it, 640x480", window);
    ShowWindow(window, SW_SHOWNORMAL);
    where("then shown", window);
    DestroyWindow(window);

    window = CreateWindow("MoveDef", "Placed", WS_OVERLAPPEDWINDOW, 50, 60, 200, 150, NULL, NULL,
                          instance, NULL);
    MoveWindow(window, CW_USEDEFAULT, CW_USEDEFAULT, 300, 200, TRUE);
    ShowWindow(window, SW_SHOWNORMAL);
    where("made at 50,60, moved to CW_USEDEFAULT, shown", window);
    DestroyWindow(window);

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
