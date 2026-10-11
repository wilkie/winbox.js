/*
 * Frames drawn at each border width: `SPI_SETBORDER` with 1, 2, 3, 5 and
 * 8, and with each the windows as they are then drawn and hit-tested.
 *
 * `W` is an overlapped window with both scroll bars and a menu bar of one
 * item, at (30, 30), 150 by 110 at the width of 3 it starts with, active;
 * `P` a pop-up with a sizing frame and nothing else, at (300, 40), 60 by
 * 40, shown without being activated. Both are of a class with a white
 * background and a procedure that paints nothing.
 *
 * For each width: `rects`, each window's rectangle on the screen and its
 * client area's; `pixels`, every pixel of each, a row a record, one hex
 * digit a pixel as `chrome` writes them; `hit`, what `W` answers
 * `WM_NCHITTEST` across 20 by 20 pixels from its top left corner, and from
 * its bottom right (`hitend`, counted back), a row a record, a letter a
 * point: `a` plus the code, `E` for `HTERROR` and `T` for
 * `HTTRANSPARENT`. Then `W` maximized at a width of 5, its rectangles; and
 * the width put back to 3.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\BDRWIDTH.OUT"

static HINSTANCE module;
static HWND w;
static HWND p;

static const COLORREF PALETTE[16] = {
    RGB(0, 0, 0),       RGB(128, 0, 0),     RGB(0, 128, 0),   RGB(128, 128, 0),
    RGB(0, 0, 128),     RGB(128, 0, 128),   RGB(0, 128, 128), RGB(192, 192, 192),
    RGB(128, 128, 128), RGB(255, 0, 0),     RGB(0, 255, 0),   RGB(255, 255, 0),
    RGB(0, 0, 255),     RGB(255, 0, 255),   RGB(0, 255, 255), RGB(255, 255, 255),
};

static const char HEX[] = "0123456789abcdef";

LONG FAR PASCAL _export Proc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_PAINT) {
        PAINTSTRUCT paint;

        BeginPaint(hwnd, &paint);
        EndPaint(hwnd, &paint);
        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

static char digit(COLORREF colour)
{
    int i;

    for (i = 0; i < 16; i++) {
        if (PALETTE[i] == colour) {
            return HEX[i];
        }
    }

    return '?';
}

static void pump(void)
{
    MSG msg;
    int i;

    for (i = 0; i < 5; i++) {
        while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
            TranslateMessage(&msg);
            DispatchMessage(&msg);
        }
    }
}

static void rects(LPCSTR name, HWND window, int width)
{
    RECT outer;
    RECT client;
    POINT corner;

    GetWindowRect(window, &outer);
    GetClientRect(window, &client);
    corner.x = 0;
    corner.y = 0;
    ClientToScreen(window, &corner);
    wsprintf(probeArgs, "%s,%d", name, width);
    wsprintf(probeResult, "window=%d:%d:%d:%d,client=%d:%d:%d:%d", outer.left, outer.top,
             outer.right, outer.bottom, corner.x, corner.y, corner.x + client.right,
             corner.y + client.bottom);
    probe("rects", probeArgs, probeResult);
}

static void pixels(LPCSTR name, HWND window, int width)
{
    RECT outer;
    HDC screen;
    int x;
    int y;

    GetWindowRect(window, &outer);
    screen = GetDC(NULL);

    for (y = outer.top; y < outer.bottom; y++) {
        LPSTR at = probeResult;

        for (x = outer.left; x < outer.right; x++) {
            *at++ = digit(GetPixel(screen, x, y));
        }

        *at = '\0';
        wsprintf(probeArgs, "%s,%d,y=%d", name, width, y - outer.top);
        probe("pixels", probeArgs, probeResult);
    }

    ReleaseDC(NULL, screen);
}

static char code(LONG answer)
{
    if (answer == HTERROR) {
        return 'E';
    }

    if (answer == HTTRANSPARENT) {
        return 'T';
    }

    return (char)('a' + (int)answer);
}

static void hits(int width)
{
    RECT outer;
    int x;
    int y;

    GetWindowRect(w, &outer);

    for (y = 0; y < 20; y++) {
        LPSTR at = probeResult;

        for (x = 0; x < 20; x++) {
            *at++ = code(SendMessage(w, WM_NCHITTEST, 0,
                                     MAKELPARAM(outer.left + x, outer.top + y)));
        }

        *at = '\0';
        wsprintf(probeArgs, "%d,y=%d", width, y);
        probe("hit", probeArgs, probeResult);
    }

    for (y = 0; y < 20; y++) {
        LPSTR at = probeResult;

        for (x = 0; x < 20; x++) {
            *at++ = code(SendMessage(w, WM_NCHITTEST, 0,
                                     MAKELPARAM(outer.right - 1 - x, outer.bottom - 1 - y)));
        }

        *at = '\0';
        wsprintf(probeArgs, "%d,y=%d", width, y);
        probe("hitend", probeArgs, probeResult);
    }
}

static void width(int border)
{
    int metrics[2];

    SystemParametersInfo(SPI_SETBORDER, border, NULL, 0);
    pump();
    metrics[0] = GetSystemMetrics(SM_CXFRAME);
    metrics[1] = GetSystemMetrics(SM_CYFRAME);
    wsprintf(probeArgs, "%d", border);
    wsprintf(probeResult, "frame=%d:%d,min=%d:%d,mintrack=%d:%d", metrics[0], metrics[1],
             GetSystemMetrics(SM_CXMIN), GetSystemMetrics(SM_CYMIN),
             GetSystemMetrics(SM_CXMINTRACK), GetSystemMetrics(SM_CYMINTRACK));
    probe("metrics", probeArgs, probeResult);
    rects("W", w, border);
    rects("P", p, border);
    pixels("W", w, border);
    pixels("P", p, border);
    hits(border);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HMENU menu;

    probeOpen(OUTPUT);
    module = instance;

    kind.style = 0;
    kind.lpfnWndProc = Proc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = LoadCursor(NULL, IDC_ARROW);
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "BdrWidth";
    RegisterClass(&kind);

    /* The pointer out of the way. */
    ShowCursor(FALSE);
    SetCursorPos(639, 479);

    menu = CreateMenu();
    AppendMenu(menu, MF_STRING, 100, "&File");

    w = CreateWindow("BdrWidth", "W", WS_OVERLAPPEDWINDOW | WS_VSCROLL | WS_HSCROLL, 30, 30, 150,
                     110, NULL, menu, module, NULL);
    p = CreateWindow("BdrWidth", "P", WS_POPUP | WS_THICKFRAME, 300, 40, 60, 40, NULL, NULL,
                     module, NULL);
    ShowWindow(w, SW_SHOWNORMAL);
    UpdateWindow(w);
    ShowWindow(p, SW_SHOWNOACTIVATE);
    UpdateWindow(p);
    pump();

    width(1);
    width(2);
    width(3);
    width(5);
    width(8);

    SystemParametersInfo(SPI_SETBORDER, 5, NULL, 0);
    ShowWindow(w, SW_SHOWMAXIMIZED);
    pump();
    rects("Wmax", w, 5);
    ShowWindow(w, SW_SHOWNORMAL);
    pump();
    rects("Wrestored", w, 5);

    SystemParametersInfo(SPI_SETBORDER, 3, NULL, 0);
    pump();
    rects("W", w, 3);

    DestroyWindow(p);
    DestroyWindow(w);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
