/*
 * Whether a window is made at least a minimum size: as BG and the
 * `menuhelp` probe found, a window with a caption asked to be 100 wide is
 * 102, SM_CXMIN, on Windows.
 *
 * Each window is asked for at 10,10, 40 wide and 10 high, with a style:
 *
 * * `size`: the style's name; its width and height after CreateWindow, then
 *   after SetWindowPos to 30 by 5, then after MoveWindow to 20 by 4.
 * * `metrics`: SM_CXMIN, SM_CYMIN, SM_CXMINTRACK, SM_CYMINTRACK.
 */

#include "probe.h"

#include <string.h>

#define OUTPUT "C:\\ORACLE\\MINSIZE.OUT"

static HINSTANCE instance;
static HWND parent;

static void size(LPCSTR name, DWORD style, BOOL child)
{
    HWND window = CreateWindow("MinSize", "Min", style, 10, 10, 40, 10, child ? parent : NULL, NULL,
                               instance, NULL);
    RECT a;
    RECT b;
    RECT c;

    GetWindowRect(window, &a);
    SetWindowPos(window, NULL, 0, 0, 30, 5, SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE);
    GetWindowRect(window, &b);
    MoveWindow(window, 10, 10, 20, 4, FALSE);
    GetWindowRect(window, &c);

    wsprintf(probeResult, "%d,%d %d,%d %d,%d", a.right - a.left, a.bottom - a.top,
             b.right - b.left, b.bottom - b.top, c.right - c.left, c.bottom - c.top);
    probe("size", name, probeResult);
    DestroyWindow(window);
}

int PASCAL WinMain(HINSTANCE self, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;

    instance = self;
    probeOpen(OUTPUT);

    memset(&kind, 0, sizeof(kind));
    kind.lpfnWndProc = DefWindowProc;
    kind.hInstance = instance;
    kind.lpszClassName = "MinSize";
    RegisterClass(&kind);

    wsprintf(probeResult, "%d %d %d %d", GetSystemMetrics(SM_CXMIN), GetSystemMetrics(SM_CYMIN),
             GetSystemMetrics(SM_CXMINTRACK), GetSystemMetrics(SM_CYMINTRACK));
    probe("metrics", "min", probeResult);

    parent = CreateWindow("MinSize", "Parent", WS_OVERLAPPEDWINDOW, 0, 0, 300, 200, NULL, NULL,
                          instance, NULL);

    size("overlapped", WS_OVERLAPPED, FALSE);
    size("caption", WS_OVERLAPPED | WS_CAPTION, FALSE);
    size("thickframe", WS_OVERLAPPED | WS_THICKFRAME, FALSE);
    size("overlappedwindow", WS_OVERLAPPEDWINDOW, FALSE);
    size("popup", WS_POPUP, FALSE);
    size("popup-caption", WS_POPUP | WS_CAPTION, FALSE);
    size("popup-thickframe", WS_POPUP | WS_THICKFRAME, FALSE);
    size("popup-border", WS_POPUP | WS_BORDER, FALSE);
    size("child", WS_CHILD, TRUE);
    size("child-caption", WS_CHILD | WS_CAPTION, TRUE);
    size("child-thickframe", WS_CHILD | WS_THICKFRAME, TRUE);

    DestroyWindow(parent);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
