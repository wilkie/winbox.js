/*
 * GetDIBits: a device-dependent bitmap read back as a DIB, as Championship
 * Slots of the corpus reads its pictures back.
 *
 * Two bitmaps, 16 by 4: a colour one compatible with the screen, each pixel
 * the palette's colour (x + 4 * y) % 16; and a monochrome one, its pixels
 * set where x + y is odd. Each is read with a BITMAPINFOHEADER filled as
 * asked -- the size, width, height, one plane, the bit count, BI_RGB, the
 * rest nought -- the colour table and bits first filled with EEh.
 *
 * * `answer`: the case; what GetDIBits answered.
 * * `header`: the case; the header after, as `width height planes bits
 *   compression sizeImage xppm yppm used important`.
 * * `table`: the case; the colour table's first entries, as `bbggrr` each
 *   (the reserved byte after in brackets where it is not nought).
 * * `bits`: the case; the bits, in hex, a row a group.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\GETDIB.OUT"

static const char HEX[] = "0123456789abcdef";

static const COLORREF PALETTE[16] = {
    RGB(0, 0, 0),       RGB(128, 0, 0),     RGB(0, 128, 0),   RGB(128, 128, 0),
    RGB(0, 0, 128),     RGB(128, 0, 128),   RGB(0, 128, 128), RGB(192, 192, 192),
    RGB(128, 128, 128), RGB(255, 0, 0),     RGB(0, 255, 0),   RGB(255, 255, 0),
    RGB(0, 0, 255),     RGB(255, 0, 255),   RGB(0, 255, 255), RGB(255, 255, 255),
};

static struct {
    BITMAPINFOHEADER header;
    RGBQUAD colours[256];
} info;

static BYTE bits[256];
static char text[600];

static void hex(BYTE FAR *from, int count, int group)
{
    int i;
    int at = 0;

    for (i = 0; i < count && at < 580; i++) {
        if (i && group && i % group == 0) {
            text[at++] = ' ';
        }

        text[at++] = HEX[from[i] >> 4];
        text[at++] = HEX[from[i] & 15];
    }

    text[at] = '\0';
}

static void ask(LPCSTR name, HDC dc, HBITMAP bitmap, int count, UINT start, UINT lines, BOOL withBits)
{
    int answer;
    int i;
    int entries;
    int stride;
    char one[24];

    _fmemset(&info, 0xee, sizeof(info));
    _fmemset(bits, 0xee, sizeof(bits));
    info.header.biSize = sizeof(BITMAPINFOHEADER);
    info.header.biWidth = 16;
    info.header.biHeight = 4;
    info.header.biPlanes = 1;
    info.header.biBitCount = count;
    info.header.biCompression = BI_RGB;
    info.header.biSizeImage = 0;
    info.header.biXPelsPerMeter = 0;
    info.header.biYPelsPerMeter = 0;
    info.header.biClrUsed = 0;
    info.header.biClrImportant = 0;

    answer = GetDIBits(dc, bitmap, start, lines, withBits ? (LPVOID)bits : NULL,
                       (BITMAPINFO FAR *)&info, DIB_RGB_COLORS);

    wsprintf(probeResult, "%d", answer);
    probe("answer", name, probeResult);

    wsprintf(probeResult, "%ld %ld %d %d %ld %ld %ld %ld %ld %ld", info.header.biWidth,
             info.header.biHeight, info.header.biPlanes, info.header.biBitCount,
             info.header.biCompression, info.header.biSizeImage, info.header.biXPelsPerMeter,
             info.header.biYPelsPerMeter, info.header.biClrUsed, info.header.biClrImportant);
    probe("header", name, probeResult);

    entries = count == 1 ? 2 : count == 4 ? 16 : count == 8 ? 18 : 2;
    probeResult[0] = '\0';

    for (i = 0; i < entries; i++) {
        wsprintf(one, "%s%02x%02x%02x", (LPSTR)(i ? " " : ""), info.colours[i].rgbBlue,
                 info.colours[i].rgbGreen, info.colours[i].rgbRed);
        lstrcat(probeResult, one);

        if (info.colours[i].rgbReserved) {
            wsprintf(one, "[%02x]", info.colours[i].rgbReserved);
            lstrcat(probeResult, one);
        }
    }

    probe("table", name, probeResult);

    if (withBits) {
        stride = ((16 * (count ? count : 1) + 31) / 32) * 4;
        hex(bits, stride * 4 + 4, stride);
        probe("bits", name, text);
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HDC screen;
    HDC memory;
    HBITMAP colour;
    HBITMAP mono;
    HBITMAP old;
    int x;
    int y;

    probeOpen(OUTPUT);
    screen = GetDC(NULL);
    memory = CreateCompatibleDC(screen);

    colour = CreateCompatibleBitmap(screen, 16, 4);
    old = SelectObject(memory, colour);

    for (y = 0; y < 4; y++) {
        for (x = 0; x < 16; x++) {
            SetPixel(memory, x, y, PALETTE[(x + 4 * y) % 16]);
        }
    }

    mono = CreateBitmap(16, 4, 1, 1, NULL);
    SelectObject(memory, mono);

    for (y = 0; y < 4; y++) {
        for (x = 0; x < 16; x++) {
            SetPixel(memory, x, y, (x + y) & 1 ? RGB(255, 255, 255) : RGB(0, 0, 0));
        }
    }

    SelectObject(memory, old);

    ask("colour-0-nobits", screen, colour, 0, 0, 4, FALSE);
    ask("colour-4-nobits", screen, colour, 4, 0, 4, FALSE);
    ask("colour-1", screen, colour, 1, 0, 4, TRUE);
    ask("colour-4", screen, colour, 4, 0, 4, TRUE);
    ask("colour-8", screen, colour, 8, 0, 4, TRUE);
    ask("colour-24", screen, colour, 24, 0, 4, TRUE);
    ask("colour-4-scans-1-2", screen, colour, 4, 1, 2, TRUE);
    ask("mono-1", screen, mono, 1, 0, 4, TRUE);
    ask("mono-4", screen, mono, 4, 0, 4, TRUE);

    DeleteObject(colour);
    DeleteObject(mono);
    DeleteDC(memory);
    ReleaseDC(NULL, screen);
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
