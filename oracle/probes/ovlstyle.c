/*
 * What USER makes of a window's style as it creates it: an overlapped
 * window asked for without a caption or a border, as Jewel Thief of the
 * corpus asks for its main window, and pop-ups and children for comparison.
 *
 * Each window is made hidden at 10,10, 200 by 100. For each:
 *
 * * `style`: the style asked for, and `GetWindowLong(GWL_STYLE)` after, in
 *   hex.
 * * `rects`: the window's rectangle and its client area's size, as
 *   `left,top,right,bottom w,h`.
 */

#include "probe.h"

#include <string.h>

#define OUTPUT "C:\\ORACLE\\OVLSTYLE.OUT"

static HINSTANCE instance;
static HWND parent;

static void make(LPCSTR name, DWORD style, BOOL child)
{
    HWND window = CreateWindow("OvlStyle", "It", style, 10, 10, 200, 100, child ? parent : NULL,
                               NULL, instance, NULL);
    RECT outer;
    RECT inner;

    wsprintf(probeResult, "%08lx %08lx", style, GetWindowLong(window, GWL_STYLE));
    probe("style", name, probeResult);

    GetWindowRect(window, &outer);
    GetClientRect(window, &inner);
    wsprintf(probeResult, "%d,%d,%d,%d %d,%d", outer.left, outer.top, outer.right, outer.bottom,
             inner.right, inner.bottom);
    probe("rects", name, probeResult);

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
    kind.lpszClassName = "OvlStyle";
    RegisterClass(&kind);

    parent = CreateWindow("OvlStyle", "Parent", WS_OVERLAPPEDWINDOW, 0, 0, 400, 300, NULL, NULL,
                          instance, NULL);

    make("overlapped", WS_OVERLAPPED, FALSE);
    make("sysmenu-minbox", WS_SYSMENU | WS_MINIMIZEBOX, FALSE);
    make("thickframe", WS_THICKFRAME, FALSE);
    make("border", WS_BORDER, FALSE);
    make("dlgframe", WS_DLGFRAME, FALSE);
    make("caption", WS_CAPTION, FALSE);
    make("overlappedwindow", WS_OVERLAPPEDWINDOW, FALSE);
    make("popup", WS_POPUP, FALSE);
    make("popup-sysmenu", WS_POPUP | WS_SYSMENU, FALSE);
    make("popup-thickframe", WS_POPUP | WS_THICKFRAME, FALSE);
    make("child", WS_CHILD, TRUE);
    make("child-sysmenu", WS_CHILD | WS_SYSMENU, TRUE);
    make("owned", WS_SYSMENU, TRUE);

    DestroyWindow(parent);

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
