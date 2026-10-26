/*
 * GetDCEx, called by ordinal, on an overlapped window 200 by 150 at (40,
 * 30) with a child 50 by 40 at (10, 10) in it:
 *
 * * `dc`: GetDCOrg, GetClipBox's kind and box, for flags and a region;
 *   and the same of GetDC and GetWindowDC beside them.
 * * `parentclip`: the same, of the child's with `DCX_PARENTCLIP`.
 * * `region`: whether the region given is still a GDI object after the
 *   device context is released.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\GETDCEX.OUT"

#define DCX_WINDOW 0x00000001L
#define DCX_CACHE 0x00000002L
#define DCX_CLIPCHILDREN 0x00000008L
#define DCX_CLIPSIBLINGS 0x00000010L
#define DCX_PARENTCLIP 0x00000020L
#define DCX_EXCLUDERGN 0x00000040L
#define DCX_INTERSECTRGN 0x00000080L
#define DCX_KEEPCLIPRGN 0x00040000L

typedef HDC(FAR PASCAL *GETDCEXPROC)(HWND, HRGN, DWORD);
typedef UINT(FAR PASCAL *TYPEPROC)(HGDIOBJ);

static HMODULE user;

static void describeAs(LPCSTR function, LPCSTR what, HWND window, HDC dc)
{
    RECT box;
    int kind;
    DWORD origin;

    if (!dc) {
        probe(function, what, "null");
        return;
    }

    origin = GetDCOrg(dc);
    kind = GetClipBox(dc, &box);
    wsprintf(probeResult, "org %d,%d clip %d %d,%d,%d,%d", (int)LOWORD(origin), (int)HIWORD(origin),
             kind, box.left, box.top, box.right, box.bottom);
    probe(function, what, probeResult);
    ReleaseDC(window, dc);
}

static void describe(LPCSTR what, HWND window, HDC dc)
{
    describeAs("dc", what, window, dc);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HWND window;
    HWND child;
    HRGN region;
    GETDCEXPROC getDCEx;
    TYPEPROC type;
    MSG msg;

    probeOpen(OUTPUT);
    user = GetModuleHandle("USER");
    getDCEx = (GETDCEXPROC)GetProcAddress(user, MAKEINTRESOURCE(359));
    type = (TYPEPROC)GetProcAddress(GetModuleHandle("GDI"), MAKEINTRESOURCE(462));

    window = CreateWindow("STATIC", "", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 40, 30, 200, 150, NULL,
                          NULL, instance, NULL);
    child = CreateWindow("STATIC", "", WS_CHILD | WS_VISIBLE, 10, 10, 50, 40, window, NULL,
                         instance, NULL);
    UpdateWindow(window);

    while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
        DispatchMessage(&msg);
    }

    describe("GetDC", window, GetDC(window));
    describe("GetWindowDC", window, GetWindowDC(window));
    describe("0", window, getDCEx(window, NULL, 0));
    describe("WINDOW", window, getDCEx(window, NULL, DCX_WINDOW));
    describe("CACHE", window, getDCEx(window, NULL, DCX_CACHE));
    describe("WINDOW CACHE", window, getDCEx(window, NULL, DCX_WINDOW | DCX_CACHE));
    describe("CACHE CLIPCHILDREN", window, getDCEx(window, NULL, DCX_CACHE | DCX_CLIPCHILDREN));
    describeAs("parentclip", "child CACHE PARENTCLIP", child,
               getDCEx(child, NULL, DCX_CACHE | DCX_PARENTCLIP));
    describe("null window CACHE", NULL, getDCEx(NULL, NULL, DCX_CACHE));

    region = CreateRectRgn(20, 20, 80, 60);
    describe("CACHE INTERSECTRGN", window, getDCEx(window, region, DCX_CACHE | DCX_INTERSECTRGN));
    wsprintf(probeResult, "%u", type(region));
    probe("region", "after INTERSECTRGN", probeResult);

    region = CreateRectRgn(20, 20, 80, 60);
    describe("CACHE EXCLUDERGN", window, getDCEx(window, region, DCX_CACHE | DCX_EXCLUDERGN));
    wsprintf(probeResult, "%u", type(region));
    probe("region", "after EXCLUDERGN", probeResult);

    region = CreateRectRgn(20, 20, 80, 60);
    describe("CACHE region, no flag", window, getDCEx(window, region, DCX_CACHE));
    wsprintf(probeResult, "%u", type(region));
    probe("region", "after no flag", probeResult);

    region = CreateRectRgn(20, 20, 80, 60);
    describe("CACHE INTERSECTRGN KEEPCLIPRGN", window,
             getDCEx(window, region, DCX_CACHE | DCX_INTERSECTRGN | DCX_KEEPCLIPRGN));
    wsprintf(probeResult, "%u", type(region));
    probe("region", "after KEEPCLIPRGN", probeResult);
    DeleteObject(region);

    DestroyWindow(window);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
