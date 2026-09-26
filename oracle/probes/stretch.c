/*
 * StretchBlt: which of the source's columns and rows the destination is made
 * of, shrinking and growing, in each stretch mode.
 *
 * The source is a memory bitmap of the display's format whose every pixel's
 * colour is its column's number, or its row's, modulo sixteen, as the
 * palette's digits. Each case stretches it into a destination filled white
 * and records the destination's rows:
 *
 * * `rows`: the case -- `x` for the column source or `y` for the row source,
 *   the source's width and height, the destination's, the mode -- and the
 *   row's number; the row as digits.
 * * `mode`: a new device context's stretch mode, and what setting each of
 *   0, 1, 3, 4 and 5 answers and leaves, as `answer,after`.
 *
 * Paintbrush shrinks its toolbox, 58 by 279, to 37 by 189 with
 * `COLORONCOLOR`, and the case is among these.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\STRETCH.OUT"

static const char HEX[] = "0123456789abcdef";

static const COLORREF PALETTE[16] = {
    RGB(0, 0, 0),       RGB(128, 0, 0),     RGB(0, 128, 0),   RGB(128, 128, 0),
    RGB(0, 0, 128),     RGB(128, 0, 128),   RGB(0, 128, 128), RGB(192, 192, 192),
    RGB(128, 128, 128), RGB(255, 0, 0),     RGB(0, 255, 0),   RGB(255, 255, 0),
    RGB(0, 0, 255),     RGB(255, 0, 255),   RGB(0, 255, 255), RGB(255, 255, 255),
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

static HDC screen;
static char row[300];

static void stretch(char axis, int sw, int sh, int dw, int dh, int mode)
{
    HDC source = CreateCompatibleDC(screen);
    HDC target = CreateCompatibleDC(screen);
    HBITMAP from = CreateCompatibleBitmap(screen, sw, sh);
    HBITMAP to = CreateCompatibleBitmap(screen, dw < 0 ? -dw : dw, dh < 0 ? -dh : dh);
    HBITMAP oldFrom = SelectObject(source, from);
    HBITMAP oldTo = SelectObject(target, to);
    int width = dw < 0 ? -dw : dw;
    int height = dh < 0 ? -dh : dh;
    RECT all;
    int x;
    int y;

    for (y = 0; y < sh; y++) {
        for (x = 0; x < sw; x++) {
            SetPixel(source, x, y, PALETTE[(axis == 'x' ? x : y) % 16]);
        }
    }

    all.left = 0;
    all.top = 0;
    all.right = width;
    all.bottom = height;
    FillRect(target, &all, GetStockObject(WHITE_BRUSH));

    SetStretchBltMode(target, mode);
    StretchBlt(target, dw < 0 ? width - 1 : 0, dh < 0 ? height - 1 : 0, dw, dh, source, 0, 0, sw,
               sh, SRCCOPY);

    for (y = 0; y < height; y++) {
        LPSTR out = row;

        for (x = 0; x < width && x < (int)sizeof(row) - 1; x++) {
            *out++ = digit(GetPixel(target, x, y));
        }

        *out = '\0';
        wsprintf(probeArgs, "%c,%d:%d,%d:%d,%d,y=%d", axis, sw, sh, dw, dh, mode, y);
        probe("rows", probeArgs, row);
    }

    SelectObject(source, oldFrom);
    SelectObject(target, oldTo);
    DeleteObject(from);
    DeleteObject(to);
    DeleteDC(source);
    DeleteDC(target);
}

static void modes(void)
{
    static const int SET[] = {0, 1, 3, 4, 5};
    HDC dc = CreateCompatibleDC(screen);
    int index;
    int answer;

    wsprintf(probeResult, "%d", GetStretchBltMode(dc));
    probe("mode", "new", probeResult);

    for (index = 0; index < 5; index++) {
        SetStretchBltMode(dc, COLORONCOLOR);
        wsprintf(probeArgs, "set=%d", SET[index]);
        answer = SetStretchBltMode(dc, SET[index]);
        wsprintf(probeResult, "%d,%d", answer, GetStretchBltMode(dc));
        probe("mode", probeArgs, probeResult);
    }

    DeleteDC(dc);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    probeOpen(OUTPUT);
    screen = GetDC(NULL);

    modes();

    /* Columns, shrinking and growing, in COLORONCOLOR. */
    stretch('x', 58, 1, 37, 1, COLORONCOLOR);
    stretch('x', 16, 1, 7, 1, COLORONCOLOR);
    stretch('x', 16, 1, 10, 1, COLORONCOLOR);
    stretch('x', 7, 1, 16, 1, COLORONCOLOR);
    stretch('x', 5, 1, 13, 1, COLORONCOLOR);
    stretch('x', 16, 1, -10, 1, COLORONCOLOR);

    /* Rows, the same. */
    stretch('y', 1, 58, 1, 37, COLORONCOLOR);
    stretch('y', 1, 279, 1, 189, COLORONCOLOR);
    stretch('y', 1, 16, 1, 7, COLORONCOLOR);
    stretch('y', 1, 7, 1, 16, COLORONCOLOR);
    stretch('y', 1, 16, 1, -10, COLORONCOLOR);

    /* The other modes, shrinking, which is where they differ. */
    stretch('x', 16, 1, 7, 1, BLACKONWHITE);
    stretch('x', 16, 1, 7, 1, WHITEONBLACK);
    stretch('y', 1, 16, 1, 7, BLACKONWHITE);
    stretch('y', 1, 16, 1, 7, WHITEONBLACK);

    /* Both at once, as Paintbrush does. */
    stretch('x', 58, 20, 37, 13, COLORONCOLOR);

    ReleaseDC(NULL, screen);
    probeFinish();

    return 0;
}
