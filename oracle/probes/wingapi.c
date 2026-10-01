/*
 * WinG's ten functions, on the 256-colour display with WinG installed
 * (`install-wing.mjs`), as SimTower calls them: it makes a WinG device
 * context and bitmaps, draws into the bitmaps' bits itself, and blits them
 * to its window.
 *
 * WING.DLL is loaded by name and its functions found by ordinal, as no
 * import library for it is part of the toolchain.
 *
 * * `dc`: `WinGCreateDC` made a device context (`yes`/`no`), and its
 *   `GetDeviceCaps` bits a pixel, planes, `NUMCOLORS`, `RASTERCAPS`, and the
 *   width and height of the bitmap selected into it, by `GetObject`.
 * * `bitmap`: `WinGCreateBitmap` of an 8-bit DIB, 16 by 8, bottom-up (a
 *   height of 8) and top-down (-8), with four colours in its table: whether
 *   it made one and a pointer; `GetObject`'s width, height, bytes a row,
 *   planes and bits a pixel; whether `WinGGetDIBPointer` answers the same
 *   pointer, and the header it fills.
 * * `pixel`: index `n` written into the bits at byte `b`, the bitmap
 *   selected into the WinG DC, then `GetPixel` at (x, y), as `rrggbb`.
 * * `table`: `WinGGetDIBColorTable` of the selected bitmap's four entries,
 *   after `WinGSetDIBColorTable` changes entry 1.
 * * `blit`: the bitmap `WinGBitBlt` to the screen at (600, 400), then
 *   `GetPixel` of the screen there, and `WinGStretchBlt` at twice the size.
 * * `halftone`: `WinGCreateHalftonePalette`'s entries, sixteen a record.
 * * `halftone-brush`: `WinGCreateHalftoneBrush` of a colour and dither type,
 *   `PatBlt` over the bitmap, and the 16 indices of its first two rows.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\WINGAPI.OUT"

typedef HDC(FAR PASCAL *WG_CREATEDC)(void);
typedef BOOL(FAR PASCAL *WG_RECOMMENDED)(BITMAPINFO FAR *);
typedef HBITMAP(FAR PASCAL *WG_CREATEBITMAP)(HDC, BITMAPINFO FAR *, void FAR *FAR *);
typedef void FAR *(FAR PASCAL *WG_GETDIBPOINTER)(HBITMAP, BITMAPINFO FAR *);
typedef UINT(FAR PASCAL *WG_COLORTABLE)(HDC, UINT, UINT, RGBQUAD FAR *);
typedef HPALETTE(FAR PASCAL *WG_HALFTONEPALETTE)(void);
typedef HBRUSH(FAR PASCAL *WG_HALFTONEBRUSH)(HDC, COLORREF, int);
typedef BOOL(FAR PASCAL *WG_STRETCHBLT)(HDC, int, int, int, int, HDC, int, int, int, int);
typedef BOOL(FAR PASCAL *WG_BITBLT)(HDC, int, int, int, int, HDC, int, int);

static WG_CREATEDC createDC;
static WG_CREATEBITMAP createBitmap;
static WG_GETDIBPOINTER getDIBPointer;
static WG_COLORTABLE getColorTable;
static WG_COLORTABLE setColorTable;
static WG_HALFTONEPALETTE halftonePalette;
static WG_HALFTONEBRUSH halftoneBrush;
static WG_STRETCHBLT stretchBlt;
static WG_BITBLT bitBlt;

static struct {
    BITMAPINFOHEADER header;
    RGBQUAD colours[256];
} info;

static struct {
    BITMAPINFOHEADER header;
    RGBQUAD colours[256];
} back;

static void hex(LPSTR at, COLORREF colour)
{
    wsprintf(at, "%02x%02x%02x", GetRValue(colour), GetGValue(colour), GetBValue(colour));
}

static void describe(LPCSTR name, HDC dc, int height)
{
    HBITMAP bitmap;
    HBITMAP before;
    BYTE huge *bits = NULL;
    BITMAP shape;
    BYTE huge *again;
    int k;

    _fmemset(&info, 0, sizeof(info));
    info.header.biSize = sizeof(BITMAPINFOHEADER);
    info.header.biWidth = 16;
    info.header.biHeight = height;
    info.header.biPlanes = 1;
    info.header.biBitCount = 8;
    info.header.biCompression = BI_RGB;
    info.header.biClrUsed = 4;
    info.colours[0].rgbRed = 0xff;
    info.colours[1].rgbGreen = 0xff;
    info.colours[2].rgbBlue = 0xff;
    info.colours[3].rgbRed = 0x5f;
    info.colours[3].rgbGreen = 0x3f;
    info.colours[3].rgbBlue = 0x3f;

    bitmap = createBitmap(dc, (BITMAPINFO FAR *)&info, (void FAR *FAR *)&bits);
    wsprintf(probeResult, "%s,%s", (LPSTR)(bitmap ? "made" : "none"),
             (LPSTR)(bits ? "pointer" : "null"));
    probe("bitmap", name, probeResult);

    if (!bitmap) {
        return;
    }

    GetObject(bitmap, sizeof(shape), &shape);
    wsprintf(probeArgs, "%s,getobject", name);
    wsprintf(probeResult, "%d,%d,%d,%d,%d", shape.bmWidth, shape.bmHeight, shape.bmWidthBytes,
             shape.bmPlanes, shape.bmBitsPixel);
    probe("bitmap", probeArgs, probeResult);

    _fmemset(&back, 0, sizeof(back));
    again = (BYTE huge *)getDIBPointer(bitmap, (BITMAPINFO FAR *)&back);
    wsprintf(probeArgs, "%s,pointer", name);
    wsprintf(probeResult, "%s:%ld,%ld,%ld,%d,%d,%ld,%ld", (LPSTR)(again == bits ? "same" : "other"),
             back.header.biSize, back.header.biWidth, back.header.biHeight, back.header.biPlanes,
             back.header.biBitCount, back.header.biCompression, back.header.biClrUsed);
    probe("bitmap", probeArgs, probeResult);

    /* Each of the four colours, and an index past them, at the first and
     * last byte of the first row of memory and the start of the second. */
    for (k = 0; k < 16 * 8; k++) {
        bits[k] = 0;
    }

    bits[0] = 1;
    bits[15] = 2;
    bits[16] = 3;
    bits[17] = 7;
    bits[18] = 250;

    before = SelectObject(dc, bitmap);

    {
        static const int AT[][2] = { { 0, 0 }, { 15, 0 }, { 0, 1 }, { 1, 1 }, { 2, 1 },
                                     { 0, 7 }, { 15, 7 }, { 0, 6 }, { 1, 6 }, { 2, 6 } };
        int i;

        for (i = 0; i < sizeof(AT) / sizeof(AT[0]); i++) {
            wsprintf(probeArgs, "%s,%d,%d", name, AT[i][0], AT[i][1]);
            hex(probeResult, GetPixel(dc, AT[i][0], AT[i][1]));
            probe("pixel", probeArgs, probeResult);
        }
    }

    if (height > 0) {
        RGBQUAD table[4];
        RGBQUAD change;
        HDC screen = GetDC(NULL);
        LPSTR at;
        UINT got;

        change.rgbRed = 0x12;
        change.rgbGreen = 0x34;
        change.rgbBlue = 0x56;
        change.rgbReserved = 0;
        wsprintf(probeResult, "%u", setColorTable(dc, 1, 1, &change));
        probe("table", "set", probeResult);
        got = getColorTable(dc, 0, 4, table);
        at = probeResult;
        at += wsprintf(at, "%u:", got);

        for (k = 0; k < 4; k++) {
            at += wsprintf(at, "%02x%02x%02x%s", table[k].rgbRed, table[k].rgbGreen,
                           table[k].rgbBlue, (LPSTR)(k < 3 ? "," : ""));
        }

        probe("table", "get", probeResult);
        hex(probeResult, GetPixel(dc, 0, 7));
        probe("table", "pixel-after", probeResult);

        /* To the screen, as it is and at twice the size. */
        bitBlt(screen, 600, 400, 16, 8, dc, 0, 0);
        at = probeResult;

        for (k = 0; k < 4; k++) {
            hex(at, GetPixel(screen, 600 + k, 400 + 7));
            at += 6;
            *at++ = k < 3 ? ',' : '\0';
        }

        probe("blit", "bitblt,bottom-row", probeResult);
        at = probeResult;

        for (k = 0; k < 4; k++) {
            hex(at, GetPixel(screen, 600 + k, 400));
            at += 6;
            *at++ = k < 3 ? ',' : '\0';
        }

        probe("blit", "bitblt,top-row", probeResult);

        stretchBlt(screen, 560, 420, 32, 16, dc, 0, 0, 16, 8);
        at = probeResult;

        for (k = 0; k < 4; k++) {
            hex(at, GetPixel(screen, 560 + k, 420 + 15));
            at += 6;
            *at++ = k < 3 ? ',' : '\0';
        }

        probe("blit", "stretch,bottom-row", probeResult);
        ReleaseDC(NULL, screen);

        /* Halftone brushes, of a colour and each dither type. */
        {
            static const COLORREF COLOURS[] = { RGB(255, 128, 0), RGB(64, 64, 64),
                                                RGB(0x5f, 0x3f, 0x3f) };
            int c;
            int type;

            for (c = 0; c < 3; c++) {
                for (type = 0; type < 3; type++) {
                    HBRUSH brush = halftoneBrush(dc, COLOURS[c], type);
                    HBRUSH was = SelectObject(dc, brush);

                    PatBlt(dc, 0, 0, 16, 8, PATCOPY);
                    SelectObject(dc, was);
                    DeleteObject(brush);

                    at = probeResult;

                    for (k = 0; k < 8; k++) {
                        at += wsprintf(at, "%d,", bits[(7 * 16) + k]);
                    }

                    for (k = 0; k < 8; k++) {
                        at += wsprintf(at, "%d%s", bits[(6 * 16) + k], (LPSTR)(k < 7 ? "," : ""));
                    }

                    hex(probeArgs, COLOURS[c]);
                    wsprintf(probeArgs + 6, ",type=%d", type);
                    probe("halftone-brush", probeArgs, probeResult);
                }
            }
        }
    }

    SelectObject(dc, before);
    DeleteObject(bitmap);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HINSTANCE wing;
    HDC dc;
    HPALETTE palette;
    PALETTEENTRY entries[256];
    int i;
    int k;

    probeOpen(OUTPUT);
    ShowCursor(FALSE);
    SetCursorPos(639, 479);

    wing = LoadLibrary("WING.DLL");

    if (wing < HINSTANCE_ERROR) {
        wsprintf(probeResult, "%d", (int)wing);
        probe("load", "WING.DLL", probeResult);
        probeFinish();
        return 0;
    }

    createDC = (WG_CREATEDC)GetProcAddress(wing, MAKEINTRESOURCE(1001));
    createBitmap = (WG_CREATEBITMAP)GetProcAddress(wing, MAKEINTRESOURCE(1003));
    getDIBPointer = (WG_GETDIBPOINTER)GetProcAddress(wing, MAKEINTRESOURCE(1004));
    getColorTable = (WG_COLORTABLE)GetProcAddress(wing, MAKEINTRESOURCE(1005));
    setColorTable = (WG_COLORTABLE)GetProcAddress(wing, MAKEINTRESOURCE(1006));
    halftonePalette = (WG_HALFTONEPALETTE)GetProcAddress(wing, MAKEINTRESOURCE(1007));
    halftoneBrush = (WG_HALFTONEBRUSH)GetProcAddress(wing, MAKEINTRESOURCE(1008));
    stretchBlt = (WG_STRETCHBLT)GetProcAddress(wing, MAKEINTRESOURCE(1009));
    bitBlt = (WG_BITBLT)GetProcAddress(wing, MAKEINTRESOURCE(1010));

    dc = createDC();

    if (dc) {
        BITMAP shape;
        HBITMAP probeBitmap = CreateBitmap(1, 1, 1, 1, NULL);
        HBITMAP first = SelectObject(dc, probeBitmap);

        SelectObject(dc, first);
        DeleteObject(probeBitmap);
        GetObject(first, sizeof(shape), &shape);
        wsprintf(probeResult, "yes:%d,%d,%d,%d:%d,%d", GetDeviceCaps(dc, BITSPIXEL),
                 GetDeviceCaps(dc, PLANES), GetDeviceCaps(dc, NUMCOLORS),
                 GetDeviceCaps(dc, RASTERCAPS), shape.bmWidth, shape.bmHeight);
    } else {
        wsprintf(probeResult, "no");
    }

    probe("dc", "WinGCreateDC", probeResult);

    if (dc) {
        describe("bottom-up", dc, 8);
        describe("top-down", dc, -8);
        DeleteDC(dc);
    }

    palette = halftonePalette();
    wsprintf(probeResult, "%u", GetPaletteEntries(palette, 0, 256, entries));
    probe("halftone", "count", probeResult);

    for (i = 0; i < 256; i += 16) {
        LPSTR at = probeResult;

        for (k = i; k < i + 16; k++) {
            at += wsprintf(at, "%02x%02x%02x/%02x%s", entries[k].peRed, entries[k].peGreen,
                           entries[k].peBlue, entries[k].peFlags, (LPSTR)(k < i + 15 ? "," : ""));
        }

        wsprintf(probeArgs, "%d-%d", i, i + 15);
        probe("halftone", probeArgs, probeResult);
    }

    DeleteObject(palette);
    FreeLibrary(wing);
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
