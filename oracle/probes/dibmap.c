/*
 * Which of the display's colours a 256-colour DIB's colours become: through
 * CreateDIBitmap, as Championship Slots of the corpus loads its pictures,
 * and through SetDIBitsToDevice, beside GetNearestColor of the same colour.
 *
 * The DIB is 16 by 16, each pixel its own entry of the colour table: the
 * 216 colours of a cube of six levels a side, 0, 51, 102, 153, 204 and 255,
 * then 40 greys and near-greys.
 *
 * * `colour`: the entry's red, green and blue in hex, as `rrggbb`; what the
 *   pixel became through CreateDIBitmap, and GetNearestColor, each as
 *   `rrggbb`.
 * * `device`: what it became through SetDIBitsToDevice onto a compatible
 *   bitmap.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\DIBMAP.OUT"

static struct {
    BITMAPINFOHEADER header;
    RGBQUAD colours[256];
} info;

static BYTE bits[256];

static void rgb(int at, int red, int green, int blue)
{
    info.colours[at].rgbRed = (BYTE)red;
    info.colours[at].rgbGreen = (BYTE)green;
    info.colours[at].rgbBlue = (BYTE)blue;
    info.colours[at].rgbReserved = 0;
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HDC screen;
    HDC made;
    HDC drawn;
    HBITMAP bitmap;
    HBITMAP canvas;
    HBITMAP oldMade;
    HBITMAP oldDrawn;
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

    for (r = 0; r < 20; r++) {
        rgb(at++, r * 13 + 8, r * 13 + 8, r * 13 + 8);
    }

    for (r = 0; r < 20; r++) {
        rgb(at++, r * 13 + 8, r * 13 + 4, r * 13 + 12);
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

    screen = GetDC(NULL);
    bitmap = CreateDIBitmap(screen, &info.header, CBM_INIT, bits, (BITMAPINFO FAR *)&info,
                            DIB_RGB_COLORS);
    made = CreateCompatibleDC(screen);
    oldMade = SelectObject(made, bitmap);

    canvas = CreateCompatibleBitmap(screen, 16, 16);
    drawn = CreateCompatibleDC(screen);
    oldDrawn = SelectObject(drawn, canvas);
    SetDIBitsToDevice(drawn, 0, 0, 16, 16, 0, 0, 0, 16, bits, (BITMAPINFO FAR *)&info,
                      DIB_RGB_COLORS);

    for (at = 0; at < 256; at++) {
        /* Bottom-up: entry `at` is at column at % 16, row 15 - at / 16. */
        int x = at % 16;
        int y = 15 - at / 16;
        COLORREF want = RGB(info.colours[at].rgbRed, info.colours[at].rgbGreen,
                            info.colours[at].rgbBlue);
        COLORREF one = GetPixel(made, x, y);
        COLORREF two = GetPixel(drawn, x, y);
        COLORREF three = GetNearestColor(screen, want);

        wsprintf(probeArgs, "%02x%02x%02x", GetRValue(want), GetGValue(want), GetBValue(want));
        wsprintf(probeResult, "%02x%02x%02x %02x%02x%02x", GetRValue(one), GetGValue(one),
                 GetBValue(one), GetRValue(three), GetGValue(three), GetBValue(three));
        probe("colour", probeArgs, probeResult);
        wsprintf(probeResult, "%02x%02x%02x", GetRValue(two), GetGValue(two), GetBValue(two));
        probe("device", probeArgs, probeResult);
    }

    SelectObject(made, oldMade);
    SelectObject(drawn, oldDrawn);
    DeleteDC(made);
    DeleteDC(drawn);
    DeleteObject(bitmap);
    DeleteObject(canvas);
    ReleaseDC(NULL, screen);
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
