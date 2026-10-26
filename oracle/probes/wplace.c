/*
 * GetWindowPlacement through a window's states: its flags, how it is
 * shown, its icon's and its maximized place, and its normal rectangle --
 * and GetInternalWindowPos's icon place beside it.
 *
 * * `normal`: a window at the top, 100,80 200x150, as made.
 * * `minimized`: once ShowWindow has made it an icon.
 * * `restored`: once ShowWindow has restored it.
 * * `maximized`: once ShowWindow has maximized it.
 * * `again`: restored again.
 *
 * Each record: `length,flags,show,min=x,y,max=x,y,normal=l,t,r,b;pos=x,y`,
 * `pos` the point GetInternalWindowPos gives.
 */

#define PROBE_FLUSH
#include "probe.h"
#include <string.h>

#define OUTPUT "C:\\ORACLE\\WPLACE.OUT"

UINT FAR PASCAL GetInternalWindowPos(HWND, LPRECT, LPPOINT);

static void place(HWND window, LPCSTR name)
{
    WINDOWPLACEMENT placement;
    RECT normal;
    POINT icon;

    _fmemset(&placement, 0xee, sizeof(placement));
    placement.length = sizeof(placement);
    GetWindowPlacement(window, &placement);
    GetInternalWindowPos(window, &normal, &icon);
    wsprintf(probeResult, "%d,%x,%d,min=%d,%d,max=%d,%d,normal=%d,%d,%d,%d;pos=%d,%d",
             placement.length, placement.flags, placement.showCmd, placement.ptMinPosition.x,
             placement.ptMinPosition.y, placement.ptMaxPosition.x, placement.ptMaxPosition.y,
             placement.rcNormalPosition.left, placement.rcNormalPosition.top,
             placement.rcNormalPosition.right, placement.rcNormalPosition.bottom, icon.x, icon.y);
    probe("place", name, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HWND window;

    probeOpen(OUTPUT);

    kind.style = 0;
    kind.lpfnWndProc = DefWindowProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = LoadIcon(NULL, IDI_APPLICATION);
    kind.hCursor = NULL;
    kind.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "WPlace";
    RegisterClass(&kind);
    window = CreateWindow("WPlace", "Place", WS_OVERLAPPEDWINDOW, 100, 80, 200, 150, NULL, NULL,
                          instance, NULL);

    ShowWindow(window, SW_SHOWNORMAL);
    place(window, "normal");
    ShowWindow(window, SW_MINIMIZE);
    place(window, "minimized");
    ShowWindow(window, SW_RESTORE);
    place(window, "restored");
    ShowWindow(window, SW_MAXIMIZE);
    place(window, "maximized");
    ShowWindow(window, SW_RESTORE);
    place(window, "again");

    DestroyWindow(window);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
