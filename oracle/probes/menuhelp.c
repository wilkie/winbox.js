/*
 * A menu bar item whose text starts with a backspace, "\bHelp": Windows
 * puts it, and those after it, at the bar's right, as Tetris for Windows of
 * the corpus has its Help.
 *
 * Windows 300, 160, 140, 130, 120, 100 and 101 to 115 wide, each 150
 * high, with a bar of "&File", "&Game" and "\b&Help": at the narrower, the
 * bar wraps. The bar's rows are read from the screen, a palette digit a
 * pixel:
 *
 * * `bar`: the window's width and the row, from the window's top; the row
 *   across the whole window.
 */

#include "probe.h"

#include <string.h>

#define OUTPUT "C:\\ORACLE\\MENUHELP.OUT"

static const char HEX[] = "0123456789abcdef";

static const COLORREF PALETTE[16] = {
    RGB(0, 0, 0),       RGB(128, 0, 0),     RGB(0, 128, 0),   RGB(128, 128, 0),
    RGB(0, 0, 128),     RGB(128, 0, 128),   RGB(0, 128, 128), RGB(192, 192, 192),
    RGB(128, 128, 128), RGB(255, 0, 0),     RGB(0, 255, 0),   RGB(255, 255, 0),
    RGB(0, 0, 255),     RGB(255, 0, 255),   RGB(0, 255, 255), RGB(255, 255, 255),
};

static char row[340];

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

static void bar(HINSTANCE instance, int width)
{
    HMENU menu = CreateMenu();
    HWND window;
    HDC screen;
    RECT outer;
    int x;
    int y;

    AppendMenu(menu, MF_STRING, 1, "&File");
    AppendMenu(menu, MF_STRING, 2, "&Game");
    AppendMenu(menu, MF_STRING, 3, "\b&Help");

    window = CreateWindow("MenuHelp", "Bar", WS_OVERLAPPED | WS_CAPTION | WS_VISIBLE, 20, 20,
                          width, 150, NULL, menu, instance, NULL);
    UpdateWindow(window);
    GetWindowRect(window, &outer);
    screen = GetDC(NULL);

    for (y = 0; y < 64; y++) {
        for (x = 0; x < width; x++) {
            row[x] = digit(GetPixel(screen, outer.left + x, outer.top + y));
        }

        row[width] = '\0';
        wsprintf(probeArgs, "%d,y=%d", width, y);
        probe("bar", probeArgs, row);
    }

    ReleaseDC(NULL, screen);
    DestroyWindow(window);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    int width;

    probeOpen(OUTPUT);
    ShowCursor(FALSE);
    SetCursorPos(GetSystemMetrics(SM_CXSCREEN) - 1, GetSystemMetrics(SM_CYSCREEN) - 1);

    memset(&kind, 0, sizeof(kind));
    kind.lpfnWndProc = DefWindowProc;
    kind.hInstance = instance;
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszClassName = "MenuHelp";
    RegisterClass(&kind);

    bar(instance, 300);
    bar(instance, 160);
    bar(instance, 140);
    bar(instance, 130);
    bar(instance, 120);
    bar(instance, 100);

    for (width = 101; width <= 115; width++) {
        bar(instance, width);
    }

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
