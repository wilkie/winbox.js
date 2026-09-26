/*
 * Ellipses and rounded rectangles under each drawing mode.
 *
 * Calculator shows a key pressed by drawing it again with `SetROP2`: the
 * drawing mode decides what the pen and the brush do to the pixels already
 * there. Over vertical stripes of white, black, blue and yellow, a pixel
 * each, this draws for each of the sixteen modes a rounded rectangle with a
 * red pen a pixel wide over a green brush, and below it an ellipse with a
 * red pen three pixels wide over the same brush; then Calculator's own case,
 * a key drawn twice with `R2_NOT` and a black brush, once and twice over.
 *
 * * `mode`: each cell's mode, what `SetROP2` answered, and `GetROP2` after.
 * * `area`, `screen`: the area, a row a record, a palette digit a pixel.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\MIXMODE.OUT"

#define WIDTH  256
#define HEIGHT 112

static const char HEX[] = "0123456789abcdef";

static const COLORREF PALETTE[16] = {
    RGB(0, 0, 0),       RGB(128, 0, 0),     RGB(0, 128, 0),   RGB(128, 128, 0),
    RGB(0, 0, 128),     RGB(128, 0, 128),   RGB(0, 128, 128), RGB(192, 192, 192),
    RGB(128, 128, 128), RGB(255, 0, 0),     RGB(0, 255, 0),   RGB(255, 255, 0),
    RGB(0, 0, 255),     RGB(255, 0, 255),   RGB(0, 255, 255), RGB(255, 255, 255),
};

static const COLORREF STRIPES[4] = {
    RGB(255, 255, 255), RGB(0, 0, 0), RGB(0, 0, 255), RGB(255, 255, 0),
};

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

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HDC screen;
    HPEN thin = CreatePen(PS_SOLID, 1, RGB(255, 0, 0));
    HPEN thick = CreatePen(PS_SOLID, 3, RGB(255, 0, 0));
    HBRUSH green = CreateSolidBrush(RGB(0, 255, 0));
    int mode;
    int x;
    int y;

    probeOpen(OUTPUT);
    ShowCursor(FALSE);
    SetCursorPos(GetSystemMetrics(SM_CXSCREEN) - 1, GetSystemMetrics(SM_CYSCREEN) - 1);

    screen = GetDC(NULL);

    for (x = 0; x < WIDTH; x++) {
        HBRUSH stripe = CreateSolidBrush(STRIPES[x & 3]);
        HBRUSH old = SelectObject(screen, stripe);

        PatBlt(screen, x, 0, 1, HEIGHT, PATCOPY);
        SelectObject(screen, old);
        DeleteObject(stripe);
    }

    for (mode = 1; mode <= 16; mode++) {
        int left = ((mode - 1) & 7) * 32 + 2;
        int top = ((mode - 1) >> 3) * 44 + 2;
        HPEN oldPen = SelectObject(screen, thin);
        HBRUSH oldBrush = SelectObject(screen, green);
        int was = SetROP2(screen, mode);

        RoundRect(screen, left, top, left + 28, top + 18, 8, 8);
        SelectObject(screen, thick);
        Ellipse(screen, left + 1, top + 22, left + 27, top + 40);

        wsprintf(probeArgs, "%d", mode);
        wsprintf(probeResult, "was=%d,now=%d", was, GetROP2(screen));
        probe("mode", probeArgs, probeResult);

        SetROP2(screen, R2_COPYPEN);
        SelectObject(screen, oldPen);
        SelectObject(screen, oldBrush);
    }

    /* Calculator's key: drawn in the copy mode, then over itself with R2_NOT
     * and the black brush, once in the first cell and twice in the second. */
    {
        HPEN oldPen = SelectObject(screen, GetStockObject(BLACK_PEN));
        HBRUSH oldBrush = SelectObject(screen, GetStockObject(WHITE_BRUSH));
        int cell;

        for (cell = 0; cell < 2; cell++) {
            int left = cell * 40 + 2;
            int top = 92;
            int times;

            RoundRect(screen, left, top, left + 36, top + 18, 10, 10);
            SelectObject(screen, GetStockObject(BLACK_BRUSH));
            SetROP2(screen, R2_NOT);

            for (times = 0; times <= cell; times++) {
                RoundRect(screen, left, top, left + 36, top + 18, 10, 10);
            }

            SetROP2(screen, R2_COPYPEN);
            SelectObject(screen, GetStockObject(WHITE_BRUSH));
        }

        SelectObject(screen, oldPen);
        SelectObject(screen, oldBrush);
    }

    wsprintf(probeResult, "0:0:%d:%d", WIDTH, HEIGHT);
    probe("area", "mixmode", probeResult);

    for (y = 0; y < HEIGHT; y++) {
        LPSTR at = probeResult;

        for (x = 0; x < WIDTH; x++) {
            *at++ = digit(GetPixel(screen, x, y));
        }

        *at = '\0';
        wsprintf(probeArgs, "mixmode,y=%d", y);
        probe("screen", probeArgs, probeResult);
    }

    ReleaseDC(NULL, screen);
    DeleteObject(thin);
    DeleteObject(thick);
    DeleteObject(green);
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
