/*
 * GDI's `ScanLR` (ordinal 135) on a window's device context and on the
 * screen's, where the display driver scans the screen itself. A window at
 * 40,30 of 100 by 60, white with a red block, a blue block and a black
 * run, and a second window, green, over part of it at 90,30. Recorded on
 * the VGA, the Super VGA and the EGA (`per-display.mjs`).
 *
 * * `window`: `ScanLR` on the first window's context, from a point, each
 *   way, for a colour and for anything else: the answer.
 * * `screen`: the same on the screen's context, the points the screen's.
 * * `origin`: on the window's context with its viewport moved.
 */

#define PROBE_FLUSH
#include "probe.h"

#define OUTPUT "C:\\ORACLE\\SCANSCR.OUT"

typedef int(FAR PASCAL *SCANLRPROC)(HDC, int, int, DWORD, int);

static SCANLRPROC scanLR;

static void registerClass(HINSTANCE instance, LPCSTR name)
{
    WNDCLASS kind;

    kind.style = 0;
    kind.lpfnWndProc = DefWindowProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = NULL;
    kind.lpszMenuName = NULL;
    kind.lpszClassName = name;
    RegisterClass(&kind);
}

static void pump(void)
{
    MSG msg;

    while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
        DispatchMessage(&msg);
    }
}

static void block(HDC dc, int left, int top, int right, int bottom, COLORREF colour)
{
    RECT rect;
    HBRUSH brush = CreateSolidBrush(colour);

    SetRect(&rect, left, top, right, bottom);
    FillRect(dc, &rect, brush);
    DeleteObject(brush);
}

static void scanned(LPCSTR name, HDC dc, int x, int y, DWORD colour, int style)
{
    wsprintf(probeArgs, "%d,%d %08lx style %d", x, y, colour, style);
    wsprintf(probeResult, "%d", scanLR(dc, x, y, colour, style));
    probe(name, probeArgs, probeResult);
}

/* Each style from a point, for the colour there and for another. */
static void around(LPCSTR name, HDC dc, int x, int y, DWORD colour)
{
    int style;

    for (style = 0; style < 4; style++) {
        scanned(name, dc, x, y, colour, style);
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HWND window, cover;
    HDC dc, screen;

    probeOpen(OUTPUT);
    scanLR = (SCANLRPROC)GetProcAddress(GetModuleHandle("GDI"), MAKEINTRESOURCE(135));

    registerClass(instance, "ScanScrWin");
    window = CreateWindow("ScanScrWin", "", WS_POPUP | WS_VISIBLE, 40, 30, 100, 60, NULL, NULL,
                          instance, NULL);
    UpdateWindow(window);
    cover = CreateWindow("ScanScrWin", "", WS_POPUP | WS_VISIBLE, 90, 30, 30, 30, NULL, NULL,
                         instance, NULL);
    UpdateWindow(cover);
    pump();

    dc = GetDC(window);
    block(dc, 0, 0, 100, 60, RGB(255, 255, 255));
    block(dc, 10, 5, 30, 15, RGB(255, 0, 0));
    block(dc, 35, 5, 45, 15, RGB(0, 0, 255));
    block(dc, 20, 40, 70, 41, RGB(0, 0, 0));
    ReleaseDC(window, dc);
    dc = GetDC(cover);
    block(dc, 0, 0, 30, 30, RGB(0, 255, 0));
    ReleaseDC(cover, dc);
    ValidateRect(window, NULL);
    ValidateRect(cover, NULL);

    dc = GetDC(window);
    around("window", dc, 0, 10, RGB(255, 255, 255));
    around("window", dc, 10, 10, RGB(255, 0, 0));
    around("window", dc, 29, 10, RGB(255, 0, 0));
    around("window", dc, 31, 10, RGB(255, 255, 255));
    around("window", dc, 40, 10, RGB(0, 0, 255));
    around("window", dc, 60, 10, RGB(0, 255, 0));
    around("window", dc, 0, 40, RGB(255, 255, 255));
    around("window", dc, 30, 40, RGB(0, 0, 0));
    around("window", dc, 99, 50, RGB(255, 255, 255));
    around("window", dc, 120, 50, RGB(255, 255, 255));
    around("window", dc, -10, 50, RGB(255, 255, 255));
    around("window", dc, 0, 70, RGB(255, 255, 255));
    around("window", dc, 0, -40, RGB(255, 255, 255));
    around("window", dc, 0, 10, RGB(250, 10, 0));
    scanned("window", dc, 700, 10, RGB(255, 255, 255), 0);
    scanned("window", dc, -50, 10, RGB(255, 255, 255), 0);
    scanned("window", dc, 0, 500, RGB(255, 255, 255), 0);
    SetViewportOrg(dc, 5, 2);
    around("origin", dc, 0, 10, RGB(255, 255, 255));
    around("origin", dc, 10, 10, RGB(255, 0, 0));
    ReleaseDC(window, dc);

    screen = GetDC(NULL);
    around("screen", screen, 40, 40, RGB(255, 255, 255));
    around("screen", screen, 50, 40, RGB(255, 0, 0));
    around("screen", screen, 100, 40, RGB(0, 255, 0));
    around("screen", screen, 75, 40, RGB(0, 0, 255));
    scanned("screen", screen, 639, 40, RGB(0, 0, 0), 0);
    scanned("screen", screen, 640, 40, RGB(0, 0, 0), 0);
    scanned("screen", screen, -1, 40, RGB(0, 0, 0), 0);
    scanned("screen", screen, 10, -1, RGB(0, 0, 0), 0);
    scanned("screen", screen, 10, 479, RGB(0, 0, 0), 0);
    scanned("screen", screen, 10, 480, RGB(0, 0, 0), 0);
    scanned("screen", screen, 10, 600, RGB(0, 0, 0), 0);
    ReleaseDC(NULL, screen);

    DestroyWindow(cover);
    DestroyWindow(window);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
