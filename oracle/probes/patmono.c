/*
 * `PatBlt` into bitmaps that are not the screen's kind: a monochrome bitmap
 * under every raster operation of the brush and the destination, and colour
 * bitmaps of depths the display does not have.
 *
 * * `mono`: a monochrome bitmap 16 by 2, each row's bits 0101..., under a
 *   pattern brush of a monochrome bitmap whose rows are 00110011, so each
 *   four pixels hold every pair of brush and destination bit; the text colour
 *   black and the background white. The operation's code, and the bitmap's
 *   bytes after, by `GetBitmapBits`, in hexadecimal.
 * * `swapped`: the same under `PATCOPY`, the text colour white and the
 *   background black: whether a monochrome brush's bits are its colours.
 * * `depth`: a bitmap 16 by 2 made by `CreateBitmap` with the planes and
 *   bits a pixel given: whether it was made, what `GetObject` says of it --
 *   bytes a row, planes and bits a pixel -- and whether a memory device
 *   context compatible with the screen takes it.
 * * `fill`: for one it took, filled white and then its left half red with
 *   `PATCOPY`: `GetPixel` at (0, 0) and (8, 0) as palette digits, and its
 *   bytes by `GetBitmapBits`.
 * * `compatible`: a bitmap 16 by 2 made by `CreateCompatibleBitmap`: what
 *   `GetObject` says of it, its bytes filled as `fill` fills, and then bytes
 *   counting up given by `SetBitmapBits` -- its answer, and each pixel of
 *   both rows as `GetPixel` reads it, palette digits: the display's own
 *   layout of a colour bitmap.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\PATMONO.OUT"

static const char HEX[] = "0123456789abcdef";

static const COLORREF PALETTE[16] = {
    RGB(0, 0, 0),       RGB(128, 0, 0),     RGB(0, 128, 0),   RGB(128, 128, 0),
    RGB(0, 0, 128),     RGB(128, 0, 128),   RGB(0, 128, 128), RGB(192, 192, 192),
    RGB(128, 128, 128), RGB(255, 0, 0),     RGB(0, 255, 0),   RGB(255, 255, 0),
    RGB(0, 0, 255),     RGB(255, 0, 255),   RGB(0, 255, 255), RGB(255, 255, 255),
};

static const DWORD ROPS[16] = {
    0x00000042L, 0x000500A9L, 0x000A0329L, 0x000F0001L, 0x00500325L, 0x00550009L,
    0x005A0049L, 0x005F00E9L, 0x00A000C9L, 0x00A50065L, 0x00AA0029L, 0x00AF0229L,
    0x00F00021L, 0x00F50225L, 0x00FA0089L, 0x00FF0062L,
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

static void hex(LPSTR out, BYTE FAR *bytes, int count)
{
    int index;

    for (index = 0; index < count; index++) {
        *out++ = HEX[bytes[index] >> 4];
        *out++ = HEX[bytes[index] & 15];
    }

    *out = '\0';
}

/* A monochrome bitmap 16 by 2 of 0101..., the brush PatBlted over it. */
static void mono(HDC screen, HBRUSH brush, DWORD rop, COLORREF text, COLORREF back)
{
    static BYTE start[4] = {0x55, 0x55, 0x55, 0x55};
    HDC memory = CreateCompatibleDC(screen);
    HBITMAP bitmap = CreateBitmap(16, 2, 1, 1, start);
    HBITMAP old = SelectObject(memory, bitmap);
    HBRUSH was;
    BYTE bits[4];

    SetTextColor(memory, text);
    SetBkColor(memory, back);
    was = SelectObject(memory, brush);
    PatBlt(memory, 0, 0, 16, 2, rop);
    SelectObject(memory, was);
    SelectObject(memory, old);
    GetBitmapBits(bitmap, sizeof(bits), bits);
    hex(probeResult, bits, sizeof(bits));

    DeleteObject(bitmap);
    DeleteDC(memory);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static const WORD PATTERN[8] = {0x33, 0x33, 0x33, 0x33, 0x33, 0x33, 0x33, 0x33};
    static const BYTE DEPTHS[][2] = {{1, 1}, {4, 1}, {1, 4}, {1, 8}, {3, 1}, {1, 24}};
    HDC screen;
    HBITMAP pattern;
    HBRUSH brush;
    int index;

    probeOpen(OUTPUT);
    screen = GetDC(NULL);

    pattern = CreateBitmap(8, 8, 1, 1, PATTERN);
    brush = CreatePatternBrush(pattern);
    DeleteObject(pattern);

    for (index = 0; index < 16; index++) {
        mono(screen, brush, ROPS[index], RGB(0, 0, 0), RGB(255, 255, 255));
        wsprintf(probeArgs, "%lx", ROPS[index]);
        probe("mono", probeArgs, probeResult);
    }

    mono(screen, brush, PATCOPY, RGB(255, 255, 255), RGB(0, 0, 0));
    probe("swapped", "f00021", probeResult);
    DeleteObject(brush);

    for (index = 0; index < (int)(sizeof(DEPTHS) / sizeof(DEPTHS[0])); index++) {
        int planes = DEPTHS[index][0];
        int bits = DEPTHS[index][1];
        HBITMAP bitmap = CreateBitmap(16, 2, planes, bits, NULL);
        HDC memory;
        HBITMAP old;
        BITMAP info;

        wsprintf(probeArgs, "%dx%d", planes, bits);

        if (!bitmap) {
            probe("depth", probeArgs, "none");
            continue;
        }

        GetObject(bitmap, sizeof(info), &info);
        memory = CreateCompatibleDC(screen);
        old = SelectObject(memory, bitmap);

        wsprintf(probeResult, "row=%d,planes=%d,bits=%d,selected=%d", info.bmWidthBytes,
                 info.bmPlanes, info.bmBitsPixel, old ? 1 : 0);
        probe("depth", probeArgs, probeResult);

        if (old) {
            HBRUSH red = CreateSolidBrush(RGB(255, 0, 0));
            HBRUSH was;
            BYTE bytes[256];
            LONG size = (LONG)info.bmWidthBytes * 2 * info.bmPlanes;
            LONG got;
            char pixels[3];

            PatBlt(memory, 0, 0, 16, 2, WHITENESS);
            was = SelectObject(memory, red);
            PatBlt(memory, 0, 0, 8, 2, PATCOPY);
            SelectObject(memory, was);
            DeleteObject(red);

            pixels[0] = digit(GetPixel(memory, 0, 0));
            pixels[1] = digit(GetPixel(memory, 8, 0));
            pixels[2] = '\0';

            if (size > (LONG)sizeof(bytes)) {
                size = sizeof(bytes);
            }

            got = GetBitmapBits(bitmap, size, bytes);
            wsprintf(probeResult, "%s,%ld:", (LPSTR)pixels, got);
            hex(probeResult + lstrlen(probeResult), bytes, (int)got);
            probe("fill", probeArgs, probeResult);
            SelectObject(memory, old);
        }

        DeleteDC(memory);
        DeleteObject(bitmap);
    }

    {
        static BYTE given[64];
        HBITMAP bitmap = CreateCompatibleBitmap(screen, 16, 2);
        HDC memory = CreateCompatibleDC(screen);
        HBITMAP old;
        BITMAP info;
        HBRUSH red;
        HBRUSH was;
        BYTE bytes[256];
        LONG size;
        LONG got;
        int x;

        GetObject(bitmap, sizeof(info), &info);
        wsprintf(probeResult, "row=%d,planes=%d,bits=%d", info.bmWidthBytes, info.bmPlanes,
                 info.bmBitsPixel);
        probe("compatible", "object", probeResult);

        old = SelectObject(memory, bitmap);
        PatBlt(memory, 0, 0, 16, 2, WHITENESS);
        red = CreateSolidBrush(RGB(255, 0, 0));
        was = SelectObject(memory, red);
        PatBlt(memory, 0, 0, 8, 2, PATCOPY);
        SelectObject(memory, was);
        DeleteObject(red);

        size = (LONG)info.bmWidthBytes * 2 * info.bmPlanes;

        if (size > (LONG)sizeof(bytes)) {
            size = sizeof(bytes);
        }

        got = GetBitmapBits(bitmap, size, bytes);
        wsprintf(probeResult, "%ld:", got);
        hex(probeResult + lstrlen(probeResult), bytes, (int)got);
        probe("compatible", "fill", probeResult);

        /* Bytes counting up, set and read back a pixel at a time. */
        for (x = 0; x < (int)sizeof(given); x++) {
            given[x] = (BYTE)(x * 17 + 3);
        }

        wsprintf(probeResult, "%ld", SetBitmapBits(bitmap, size, given));
        probe("compatible", "set", probeResult);

        for (x = 0; x < 16; x++) {
            probeResult[x] = digit(GetPixel(memory, x, 0));
        }

        probeResult[16] = '\0';
        probe("compatible", "row0", probeResult);

        for (x = 0; x < 16; x++) {
            probeResult[x] = digit(GetPixel(memory, x, 1));
        }

        probeResult[16] = '\0';
        probe("compatible", "row1", probeResult);

        SelectObject(memory, old);
        DeleteDC(memory);
        DeleteObject(bitmap);
    }

    ReleaseDC(NULL, screen);
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
