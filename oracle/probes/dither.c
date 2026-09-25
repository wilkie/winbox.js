/*
 * How a colour the display cannot show is drawn.
 *
 * A display driver has sixteen colours, or two, and a program asks for any of
 * sixteen million. A pen or text takes the nearest colour the display has; a
 * brush is realised as a pattern of the colours it does have, which is what
 * makes the Hercules's grey window frame a checkerboard and the EGA's scroll
 * bar colour, `818181`, something other than a flat grey. winbox.js draws
 * every colour as its nearest, and this is what it has to become.
 *
 * For each of a sweep of colours -- every grey in steps of four, and a cube of
 * five levels of red, green and blue -- a solid brush fills a square of the
 * screen, and every pixel of it is read back with `GetPixel`, a hex digit a
 * pixel as the `chrome` probe writes them. Three questions:
 *
 * * `screen`: the pattern, filled at a corner aligned to sixteen.
 * * `offset`: the same fill at an odd position, which says whether the pattern
 *   is anchored to the screen or to the rectangle.
 * * `mono`: the same brush into a sixteen-pixel monochrome bitmap, read with
 *   `GetBitmapBits`, which says how a brush dithers where there are two
 *   colours whatever the display. `monoramp` is the same for every grey and
 *   every level of red, green and blue alone.
 *
 * And `nearest`: what `GetNearestColor` says the display would draw a pen of
 * the colour as.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\DITHER.OUT"

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
static HDC memory;
static HBITMAP mono;
static unsigned char bits[SIZE * 2];

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

/* A square of the screen filled with the brush, read back row by row. */
static void probeSquare(LPCSTR kind, COLORREF colour, int left, int top)
{
    HBRUSH brush = CreateSolidBrush(colour);
    HBRUSH previous = (HBRUSH)SelectObject(screen, brush);
    LPSTR at = probeResult;
    int x;
    int y;

    PatBlt(screen, left, top, SIZE, SIZE, PATCOPY);
    SelectObject(screen, previous);
    DeleteObject(brush);

    for (y = 0; y < SIZE; y++) {
        if (y) {
            *at++ = '/';
        }

        for (x = 0; x < SIZE; x++) {
            *at++ = digit(GetPixel(screen, left + x, top + y));
        }
    }

    *at = '\0';

    wsprintf(probeArgs, "%06lx,at=%d:%d", colour & 0xffffffL, left, top);
    probe(kind, probeArgs, probeResult);
}

/* The brush into a monochrome bitmap, read with GetBitmapBits. */
static void probeMono(LPCSTR kind, COLORREF colour)
{
    HBRUSH brush = CreateSolidBrush(colour);
    HBRUSH previous = (HBRUSH)SelectObject(memory, brush);
    LPSTR at = probeResult;
    int index;

    PatBlt(memory, 0, 0, SIZE, SIZE, PATCOPY);
    SelectObject(memory, previous);
    DeleteObject(brush);

    GetBitmapBits(mono, (LONG)sizeof(bits), bits);

    for (index = 0; index < (int)sizeof(bits); index++) {
        *at++ = HEX[(bits[index] >> 4) & 0x0f];
        *at++ = HEX[bits[index] & 0x0f];
    }

    *at = '\0';

    wsprintf(probeArgs, "%06lx", colour & 0xffffffL);
    probe(kind, probeArgs, probeResult);
}

static void probeColour(COLORREF colour)
{
    probeSquare("screen", colour, 32, 32);
    probeSquare("offset", colour, 53, 37);
    probeMono("mono", colour);

    wsprintf(probeArgs, "%06lx", colour & 0xffffffL);
    wsprintf(probeResult, "%06lx", GetNearestColor(screen, colour) & 0xffffffL);
    probe("nearest", probeArgs, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static const int LEVELS[] = { 0, 64, 128, 192, 255 };
    int grey;
    int r;
    int g;
    int b;

    probeOpen(OUTPUT);

    ShowCursor(FALSE);
    SetCursorPos(639, 479);

    screen = GetDC(NULL);
    memory = CreateCompatibleDC(screen);
    mono = CreateBitmap(SIZE, SIZE, 1, 1, NULL);
    SelectObject(memory, mono);

    probeNote("every grey, in steps of four");

    for (grey = 0; grey <= 256; grey += 4) {
        int level = grey > 255 ? 255 : grey;

        probeColour(RGB(level, level, level));
    }

    probeNote("a cube of five levels of red, green and blue");

    for (r = 0; r < 5; r++) {
        for (g = 0; g < 5; g++) {
            for (b = 0; b < 5; b++) {
                probeColour(RGB(LEVELS[r], LEVELS[g], LEVELS[b]));
            }
        }
    }

    probeNote("the system colours the displays use that are not palette colours");
    probeColour(RGB(0x81, 0x81, 0x81));
    probeColour(RGB(0x3f, 0x3f, 0x3f));
    probeColour(RGB(0x7f, 0x7f, 0x7f));
    probeColour(RGB(0xbf, 0xbf, 0xbf));

    /* Finer, on the screen only: every grey and every red, which settle how a
     * level turns into a count of pixels at its exact edges, and a grid of
     * red against green in eighths, where one channel lies between black
     * and the dark colour and the other between the dark colour and the
     * bright one. */
    probeNote("every grey, every red, and red against green in eighths");

    for (grey = 0; grey < 256; grey++) {
        probeSquare("ramp", RGB(grey, grey, grey), 32, 32);
    }

    for (r = 0; r < 256; r++) {
        probeSquare("ramp", RGB(r, 0, 0), 32, 32);
    }

    for (r = 0; r <= 8; r++) {
        for (g = 0; g <= 8; g++) {
            probeSquare("grid", RGB(r * 32 > 255 ? 255 : r * 32, g * 32 > 255 ? 255 : g * 32, 0),
                        32, 32);
        }
    }

    /* And into the monochrome bitmap, every grey and every level of each of
     * red, green and blue alone, which settle how the three are weighed and
     * how the sum is rounded. */
    probeNote("every grey and every red, green and blue, into a monochrome bitmap");

    for (grey = 0; grey < 256; grey++) {
        probeMono("monoramp", RGB(grey, grey, grey));
    }

    for (r = 0; r < 256; r++) {
        probeMono("monoramp", RGB(r, 0, 0));
    }

    for (g = 0; g < 256; g++) {
        probeMono("monoramp", RGB(0, g, 0));
    }

    for (b = 0; b < 256; b++) {
        probeMono("monoramp", RGB(0, 0, b));
    }

    DeleteDC(memory);
    DeleteObject(mono);
    ReleaseDC(NULL, screen);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
