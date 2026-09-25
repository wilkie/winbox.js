/*
 * `BitBlt`, between monochrome and colour bitmaps, under its raster operations.
 *
 * A program's sprites are drawn this way: a monochrome mask `SRCAND`ed onto the
 * screen, the sprite `SRCPAINT`ed or `SRCINVERT`ed over it, and a monochrome
 * bitmap drawn onto a colour one takes its colours from the destination's text
 * and background colours. None of that has been asked.
 *
 * Three questions:
 *
 * * Monochrome to monochrome, under every raster operation that has a name.
 *   The source's bits are `0011` over and over and the destination's `0101`,
 *   so every four pixels hold all four pairs of source and destination bit,
 *   and the result is each operation's truth table. The operations that use
 *   the brush are asked with the black brush and with the white one.
 * * Monochrome to colour: a sixteen by two pattern drawn onto a colour bitmap
 *   of the screen's kind, with red as the text colour and green as the
 *   background, under `SRCCOPY`, and under `SRCAND`, `SRCPAINT` and
 *   `SRCINVERT` onto a blue bitmap. The colours are read with `GetPixel`, which
 *   says what the pixel is without depending on how the display driver lays
 *   out a colour bitmap's bytes.
 * * Colour to monochrome: pixels of five colours set with `SetPixel`, copied
 *   to a monochrome bitmap with the source's background colour green, and then
 *   red. Which become white is the rule.
 *
 * * Colour onto colour under `SRCINVERT`: a row of the sixteen palette colours
 *   onto a bitmap filled with each of them in turn. A raster operation on a
 *   colour display works on the driver's colour indices, not on red, green and
 *   blue, and exclusive-or against every colour lays the whole index map out:
 *   256 pairs, and the same under `SRCAND`, which exclusive-or alone cannot
 *   separate from a relabelling of the index bits.
 *
 * Only colours the sixteen-colour palette holds exactly are used, so nothing is
 * dithered and nothing is rounded to a neighbour.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\BITBLT.OUT"

#define WIDTH  16
#define HEIGHT 2
#define BYTES  (2 * HEIGHT)

static const char HEX[] = "0123456789abcdef";

static unsigned char sourceBits[BYTES] = { 0x33, 0x33, 0x33, 0x33 };
static unsigned char destBits[BYTES] = { 0x55, 0x55, 0x55, 0x55 };
static unsigned char spriteBits[BYTES] = { 0xf0, 0x0f, 0x0f, 0xf0 };
static unsigned char bits[BYTES];

typedef struct { LPCSTR name; DWORD rop; } ROP;

static ROP ROPS[] = {
    { "SRCCOPY", SRCCOPY },         { "SRCPAINT", SRCPAINT },
    { "SRCAND", SRCAND },           { "SRCINVERT", SRCINVERT },
    { "SRCERASE", SRCERASE },       { "NOTSRCCOPY", NOTSRCCOPY },
    { "NOTSRCERASE", NOTSRCERASE }, { "MERGECOPY", MERGECOPY },
    { "MERGEPAINT", MERGEPAINT },   { "PATCOPY", PATCOPY },
    { "PATPAINT", PATPAINT },       { "PATINVERT", PATINVERT },
    { "DSTINVERT", DSTINVERT },     { "BLACKNESS", BLACKNESS },
    { "WHITENESS", WHITENESS },
};

/* Monochrome onto monochrome, one operation and one brush. */
static void probeMono(HDC source, HDC dest, HBITMAP destBitmap, int index, int white)
{
    LPSTR at;
    int byte;

    SetBitmapBits(destBitmap, (DWORD)BYTES, destBits);
    SelectObject(dest, GetStockObject(white ? WHITE_BRUSH : BLACK_BRUSH));

    BitBlt(dest, 0, 0, WIDTH, HEIGHT, source, 0, 0, ROPS[index].rop);

    GetBitmapBits(destBitmap, (LONG)BYTES, bits);

    at = probeResult;

    for (byte = 0; byte < BYTES; byte++) {
        *at++ = HEX[(bits[byte] >> 4) & 0x0f];
        *at++ = HEX[bits[byte] & 0x0f];
    }

    *at = '\0';

    wsprintf(probeArgs, "%s,rop=%08lx,brush=%s", ROPS[index].name, ROPS[index].rop,
             white ? (LPSTR)"white" : (LPSTR)"black");
    probe("mono", probeArgs, probeResult);
}

/* Every pixel of a colour device context, as the colour GetPixel reports. */
static void writePixels(HDC dc)
{
    LPSTR at = probeResult;
    int x;
    int y;

    for (y = 0; y < HEIGHT; y++) {
        for (x = 0; x < WIDTH; x++) {
            COLORREF colour = GetPixel(dc, x, y);

            wsprintf(at, "%s%06lx", (LPSTR)(x || y ? "/" : ""), colour & 0xffffffL);

            while (*at) {
                at++;
            }
        }
    }
}

/* Monochrome onto colour: red text colour, green background, over a ground. */
static void probeToColour(HDC source, HDC colour, LPCSTR name, DWORD rop, COLORREF ground)
{
    HBRUSH brush = CreateSolidBrush(ground);
    HBRUSH previous = (HBRUSH)SelectObject(colour, brush);

    PatBlt(colour, 0, 0, WIDTH, HEIGHT, PATCOPY);
    SelectObject(colour, previous);
    DeleteObject(brush);

    SetTextColor(colour, RGB(255, 0, 0));
    SetBkColor(colour, RGB(0, 255, 0));

    BitBlt(colour, 0, 0, WIDTH, HEIGHT, source, 0, 0, rop);

    writePixels(colour);

    wsprintf(probeArgs, "%s,rop=%08lx,ground=%06lx,text=0000ff,back=00ff00", name, rop,
             ground & 0xffffffL);
    probe("to colour", probeArgs, probeResult);
}

/* Colour onto monochrome, with the source's background colour as given. */
static void probeToMono(HDC colour, HDC dest, HBITMAP destBitmap, COLORREF back, LPCSTR name)
{
    LPSTR at;
    int byte;

    SetBitmapBits(destBitmap, (DWORD)BYTES, destBits);
    SetBkColor(colour, back);

    BitBlt(dest, 0, 0, WIDTH, HEIGHT, colour, 0, 0, SRCCOPY);

    GetBitmapBits(destBitmap, (LONG)BYTES, bits);

    at = probeResult;

    for (byte = 0; byte < BYTES; byte++) {
        *at++ = HEX[(bits[byte] >> 4) & 0x0f];
        *at++ = HEX[bits[byte] & 0x0f];
    }

    *at = '\0';

    wsprintf(probeArgs, "back=%s", name);
    probe("to mono", probeArgs, probeResult);
}

/* The sixteen colours of the palette, in the order Windows documents them. */
static const COLORREF PALETTE[16] = {
    RGB(0, 0, 0),       RGB(128, 0, 0),     RGB(0, 128, 0),   RGB(128, 128, 0),
    RGB(0, 0, 128),     RGB(128, 0, 128),   RGB(0, 128, 128), RGB(192, 192, 192),
    RGB(128, 128, 128), RGB(255, 0, 0),     RGB(0, 255, 0),   RGB(255, 255, 0),
    RGB(0, 0, 255),     RGB(255, 0, 255),   RGB(0, 255, 255), RGB(255, 255, 255),
};

/* Colour onto colour: the palette onto one of its colours, under `rop`. */
static void probeOnto(HDC palette, HDC colour, int ground, DWORD rop, LPCSTR name)
{
    HBRUSH brush = CreateSolidBrush(PALETTE[ground]);
    HBRUSH previous = (HBRUSH)SelectObject(colour, brush);

    PatBlt(colour, 0, 0, WIDTH, HEIGHT, PATCOPY);
    SelectObject(colour, previous);
    DeleteObject(brush);

    BitBlt(colour, 0, 0, WIDTH, HEIGHT, palette, 0, 0, rop);

    writePixels(colour);

    wsprintf(probeArgs, "ground=%06lx", PALETTE[ground] & 0xffffffL);
    probe(name, probeArgs, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static const COLORREF COLOURS[] = {
        RGB(255, 0, 0), RGB(0, 255, 0), RGB(0, 0, 255), RGB(255, 255, 255), RGB(0, 0, 0),
    };

    HDC screen;
    HDC source;
    HDC dest;
    HDC colour;
    HDC palette;
    HBITMAP paletteBitmap;
    HBITMAP sourceBitmap;
    HBITMAP destBitmap;
    HBITMAP colourBitmap;
    int index;
    int x;
    int y;

    probeOpen(OUTPUT);

    screen = GetDC(NULL);
    source = CreateCompatibleDC(screen);
    dest = CreateCompatibleDC(screen);
    colour = CreateCompatibleDC(screen);

    sourceBitmap = CreateBitmap(WIDTH, HEIGHT, 1, 1, sourceBits);
    destBitmap = CreateBitmap(WIDTH, HEIGHT, 1, 1, destBits);
    colourBitmap = CreateCompatibleBitmap(screen, WIDTH, HEIGHT);

    SelectObject(source, sourceBitmap);
    SelectObject(dest, destBitmap);
    SelectObject(colour, colourBitmap);

    probeNote("monochrome onto monochrome: source 0011, destination 0101");

    for (index = 0; index < (int)(sizeof(ROPS) / sizeof(ROPS[0])); index++) {
        probeMono(source, dest, destBitmap, index, 0);
        probeMono(source, dest, destBitmap, index, 1);
    }

    probeNote("monochrome onto colour: text red, background green");
    SetBitmapBits(sourceBitmap, (DWORD)BYTES, spriteBits);
    probeToColour(source, colour, "SRCCOPY", SRCCOPY, RGB(255, 255, 255));
    probeToColour(source, colour, "SRCAND", SRCAND, RGB(0, 0, 255));
    probeToColour(source, colour, "SRCPAINT", SRCPAINT, RGB(0, 0, 255));
    probeToColour(source, colour, "SRCINVERT", SRCINVERT, RGB(0, 0, 255));

    probeNote("colour onto monochrome: which pixels match the background colour");

    for (y = 0; y < HEIGHT; y++) {
        for (x = 0; x < WIDTH; x++) {
            SetPixel(colour, x, y, COLOURS[(x + y) % 5]);
        }
    }

    writePixels(colour);
    probe("colour source", "", probeResult);

    probeToMono(colour, dest, destBitmap, RGB(0, 255, 0), "green");
    probeToMono(colour, dest, destBitmap, RGB(255, 0, 0), "red");

    probeNote("colour onto colour, exclusive-or: the palette onto each of its colours");
    palette = CreateCompatibleDC(screen);
    paletteBitmap = CreateCompatibleBitmap(screen, WIDTH, HEIGHT);
    SelectObject(palette, paletteBitmap);

    for (y = 0; y < HEIGHT; y++) {
        for (x = 0; x < WIDTH; x++) {
            SetPixel(palette, x, y, PALETTE[x]);
        }
    }

    writePixels(palette);
    probe("palette source", "", probeResult);

    for (index = 0; index < 16; index++) {
        probeOnto(palette, colour, index, SRCINVERT, "xor");
    }

    /* Exclusive-or fixes the indices only up to a relabelling of their bits
     * that keeps it; `AND` does not survive such a relabelling, so the two
     * tables together fix every colour's index. */
    probeNote("colour onto colour, and: the palette onto each of its colours");

    for (index = 0; index < 16; index++) {
        probeOnto(palette, colour, index, SRCAND, "and");
    }

    DeleteDC(palette);
    DeleteObject(paletteBitmap);

    DeleteDC(source);
    DeleteDC(dest);
    DeleteDC(colour);
    DeleteObject(sourceBitmap);
    DeleteObject(destBitmap);
    DeleteObject(colourBitmap);
    ReleaseDC(NULL, screen);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
