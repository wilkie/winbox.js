/*
 * A menu bar item flagged MF_HELP, as Flak Attack of the corpus flags its
 * Help: where Windows puts it, beside `menuhelp`'s item whose text starts
 * with a backspace.
 *
 * Windows 300, 160, 130 and 110 wide, each 150 high, with a bar of "&File",
 * "&Game" and "&Help" flagged MF_HELP; one 300 wide with "\b&Help" to set
 * beside them; and a window maximized, with a caption and no sizing frame,
 * as Flak Attack's, with each. The bar's rows are read from the screen, a
 * palette digit a pixel:
 *
 * * `bar`: the window's width, how its Help is marked (`flag` or `bs`), and
 *   the row, from the window's top; the row across the whole window.
 * * `max`: the same for the window maximized, the screen's rows from the top,
 *   the right-hand 160 pixels.
 */

#include "probe.h"

#include <string.h>

#define OUTPUT "C:\\ORACLE\\MENUFLAG.OUT"

static const char HEX[] = "0123456789abcdef";

static const COLORREF PALETTE[16] = {
    RGB(0, 0, 0),       RGB(128, 0, 0),     RGB(0, 128, 0),   RGB(128, 128, 0),
    RGB(0, 0, 128),     RGB(128, 0, 128),   RGB(0, 128, 128), RGB(192, 192, 192),
    RGB(128, 128, 128), RGB(255, 0, 0),     RGB(0, 255, 0),   RGB(255, 255, 0),
    RGB(0, 0, 255),     RGB(255, 0, 255),   RGB(0, 255, 255), RGB(255, 255, 255),
};

static char row[700];

static char digit(COLORREF colour)
{
    int index;

    for (index = 0; index < 16; index++) {
        if (PALETTE[index] == (colour & 0xffffffL)) {
            return HEX[index];
        }
    }

    return '?';
}

static HMENU menuOf(BOOL flag)
{
    HMENU menu = CreateMenu();

    AppendMenu(menu, MF_STRING, 1, "&File");
    AppendMenu(menu, MF_STRING, 2, "&Game");

    if (flag) {
        AppendMenu(menu, MF_STRING | MF_HELP, 3, "&Help");
    } else {
        AppendMenu(menu, MF_STRING, 3, "\b&Help");
    }

    return menu;
}

static void bar(HINSTANCE instance, int width, BOOL flag)
{
    HWND window;
    HDC screen;
    RECT outer;
    int x;
    int y;

    window = CreateWindow("MenuFlag", "Bar", WS_OVERLAPPED | WS_CAPTION | WS_VISIBLE, 20, 20,
                          width, 150, NULL, menuOf(flag), instance, NULL);
    UpdateWindow(window);
    GetWindowRect(window, &outer);
    screen = GetDC(NULL);

    for (y = 0; y < 64; y++) {
        for (x = 0; x < width; x++) {
            row[x] = digit(GetPixel(screen, outer.left + x, outer.top + y));
        }

        row[width] = '\0';
        wsprintf(probeArgs, "%d,%s,y=%d", width, (LPSTR)(flag ? "flag" : "bs"), y);
        probe("bar", probeArgs, row);
    }

    ReleaseDC(NULL, screen);
    DestroyWindow(window);
}

static void maximized(HINSTANCE instance, BOOL flag)
{
    HWND window;
    HDC screen;
    int x;
    int y;
    int across = GetSystemMetrics(SM_CXSCREEN);

    window = CreateWindow("MenuFlag", "Max",
                          WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX, 50, 30, 300,
                          200, NULL, menuOf(flag), instance, NULL);
    ShowWindow(window, SW_SHOWMAXIMIZED);
    UpdateWindow(window);
    screen = GetDC(NULL);

    for (y = 0; y < 40; y++) {
        for (x = 0; x < 160; x++) {
            row[x] = digit(GetPixel(screen, across - 160 + x, y));
        }

        row[160] = '\0';
        wsprintf(probeArgs, "%s,y=%d", (LPSTR)(flag ? "flag" : "bs"), y);
        probe("max", probeArgs, row);
    }

    ReleaseDC(NULL, screen);
    DestroyWindow(window);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;

    probeOpen(OUTPUT);
    ShowCursor(FALSE);
    SetCursorPos(GetSystemMetrics(SM_CXSCREEN) - 1, GetSystemMetrics(SM_CYSCREEN) - 1);

    memset(&kind, 0, sizeof(kind));
    kind.lpfnWndProc = DefWindowProc;
    kind.hInstance = instance;
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszClassName = "MenuFlag";
    RegisterClass(&kind);

    bar(instance, 300, TRUE);
    bar(instance, 160, TRUE);
    bar(instance, 130, TRUE);
    bar(instance, 110, TRUE);
    bar(instance, 300, FALSE);
    maximized(instance, TRUE);
    maximized(instance, FALSE);

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
