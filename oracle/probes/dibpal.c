/*
 * A 256-colour DIB made a device bitmap by CreateDIBitmap with a logical
 * palette of its own colours selected and realized in the device context,
 * as Championship Slots of the corpus makes its pictures -- beside the same
 * without a palette, as `dibmap` records.
 *
 * The DIB is 16 by 16, each pixel its own entry: 216 colours of a cube of six
 * levels a side, then 34 greys and near-greys, then six colours of
 * Championship Slots' ball.
 *
 * * `palette`: the entry's colour, as `rrggbb`; what its pixel became with
 *   the palette realized, then without it, each as `rrggbb`.
 * * `realized`: what RealizePalette answered.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\DIBPAL.OUT"

static struct {
    BITMAPINFOHEADER header;
    RGBQUAD colours[256];
} info;

static struct {
    WORD version;
    WORD count;
    PALETTEENTRY entries[256];
} logical;

static BYTE bits[256];

static void rgb(int at, int red, int green, int blue)
{
    info.colours[at].rgbRed = (BYTE)red;
    info.colours[at].rgbGreen = (BYTE)green;
    info.colours[at].rgbBlue = (BYTE)blue;
    info.colours[at].rgbReserved = 0;
    logical.entries[at].peRed = (BYTE)red;
    logical.entries[at].peGreen = (BYTE)green;
    logical.entries[at].peBlue = (BYTE)blue;
    logical.entries[at].peFlags = 0;
}

static HBITMAP make(HDC screen)
{
    return CreateDIBitmap(screen, &info.header, CBM_INIT, bits, (BITMAPINFO FAR *)&info,
                          DIB_RGB_COLORS);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static const int BALL[6][3] = {{24, 86, 85},  {44, 123, 177}, {14, 66, 156},
                                   {0, 123, 251}, {229, 231, 11}, {38, 133, 125}};
    HDC screen;
    HDC memory;
    HPALETTE palette;
    HPALETTE old;
    HBITMAP with;
    HBITMAP without;
    HBITMAP was;
    int at;
    int r;
    int g;
    int b;

    probeOpen(OUTPUT);

    at = 0;

    for (r = 0; r < 6; r++) {
        for (g = 0; g < 6; g++) {
            for (b = 0; b < 6; b++) {
                rgb(at++, r * 51, g * 51, b * 51);
            }
        }
    }

    for (r = 0; r < 17; r++) {
        rgb(at++, r * 15 + 8, r * 15 + 8, r * 15 + 8);
    }

    for (r = 0; r < 17; r++) {
        rgb(at++, r * 15 + 8, r * 15 + 4, r * 15 + 12);
    }

    for (r = 0; r < 6; r++) {
        rgb(at++, BALL[r][0], BALL[r][1], BALL[r][2]);
    }

    for (at = 0; at < 256; at++) {
        bits[at] = (BYTE)at;
    }

    info.header.biSize = sizeof(BITMAPINFOHEADER);
    info.header.biWidth = 16;
    info.header.biHeight = 16;
    info.header.biPlanes = 1;
    info.header.biBitCount = 8;
    info.header.biCompression = BI_RGB;
    info.header.biClrUsed = 256;

    logical.version = 0x300;
    logical.count = 256;

    screen = GetDC(NULL);
    without = make(screen);

    palette = CreatePalette((LOGPALETTE FAR *)&logical);
    old = SelectPalette(screen, palette, FALSE);
    wsprintf(probeResult, "%d", RealizePalette(screen));
    probe("realized", "screen", probeResult);
    with = make(screen);
    SelectPalette(screen, old, FALSE);

    memory = CreateCompatibleDC(screen);
    was = SelectObject(memory, with);

    for (at = 0; at < 256; at++) {
        int x = at % 16;
        int y = 15 - at / 16;
        COLORREF one;
        COLORREF two;

        SelectObject(memory, with);
        one = GetPixel(memory, x, y);
        SelectObject(memory, without);
        two = GetPixel(memory, x, y);

        wsprintf(probeArgs, "%02x%02x%02x", info.colours[at].rgbRed, info.colours[at].rgbGreen,
                 info.colours[at].rgbBlue);
        wsprintf(probeResult, "%02x%02x%02x %02x%02x%02x", GetRValue(one), GetGValue(one),
                 GetBValue(one), GetRValue(two), GetGValue(two), GetBValue(two));
        probe("palette", probeArgs, probeResult);
    }

    SelectObject(memory, was);
    DeleteDC(memory);
    DeleteObject(with);
    DeleteObject(without);
    DeleteObject(palette);
    ReleaseDC(NULL, screen);
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
