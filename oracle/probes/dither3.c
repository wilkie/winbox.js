/*
 * How a solid brush is drawn in a colour whose three channels all differ and
 * lie between the levels `dither` sampled -- as Tetris for Windows of the
 * corpus asks for `8e60d7` behind its board.
 *
 * For each colour of a cube of seven levels a side -- 16, 48, 96, 142, 176,
 * 215 and 240 -- a solid brush fills a square of sixteen at a corner of the
 * screen aligned to sixteen, and every pixel of it is read back with
 * `GetPixel`, a hex digit a pixel as `dither` writes them.
 *
 * * `ramp`: the colour, as `rrggbb`, and where; the pixels, row by row.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\DITHER3.OUT"

#define SIZE 16

static const char HEX[] = "0123456789abcdef";

/* The sixteen colours of the palette, in the order Windows documents them. */
static const COLORREF PALETTE[16] = {
    RGB(0, 0, 0),       RGB(128, 0, 0),     RGB(0, 128, 0),   RGB(128, 128, 0),
    RGB(0, 0, 128),     RGB(128, 0, 128),   RGB(0, 128, 128), RGB(192, 192, 192),
    RGB(128, 128, 128), RGB(255, 0, 0),     RGB(0, 255, 0),   RGB(255, 255, 0),
    RGB(0, 0, 255),     RGB(255, 0, 255),   RGB(0, 255, 255), RGB(255, 255, 255),
};

static HDC screen;

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

static void probeSquare(COLORREF colour)
{
    HBRUSH brush = CreateSolidBrush(colour);
    HBRUSH previous = (HBRUSH)SelectObject(screen, brush);
    LPSTR at = probeResult;
    int x;
    int y;

    PatBlt(screen, 32, 32, SIZE, SIZE, PATCOPY);
    SelectObject(screen, previous);
    DeleteObject(brush);

    for (y = 0; y < SIZE; y++) {
        if (y) {
            *at++ = '/';
        }

        for (x = 0; x < SIZE; x++) {
            *at++ = digit(GetPixel(screen, 32 + x, 32 + y));
        }
    }

    *at = '\0';

    wsprintf(probeArgs, "%06lx,at=32:32", colour & 0xffffffL);
    probe("ramp", probeArgs, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static const int LEVELS[7] = {16, 48, 96, 142, 176, 215, 240};
    int r;
    int g;
    int b;

    probeOpen(OUTPUT);

    ShowCursor(FALSE);
    SetCursorPos(639, 479);

    screen = GetDC(NULL);

    for (r = 0; r < 7; r++) {
        for (g = 0; g < 7; g++) {
            for (b = 0; b < 7; b++) {
                probeSquare(RGB(LEVELS[r], LEVELS[g], LEVELS[b]));
            }
        }
    }

    ReleaseDC(NULL, screen);
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
