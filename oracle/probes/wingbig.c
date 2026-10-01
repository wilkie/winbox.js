/*
 * A WinG bitmap larger than a segment, as SimTower draws its whole screen
 * into one: 640 by 480, bottom-up, 300 KB of bits behind one pointer.
 *
 * Its colour table makes each index a colour of its own, `RGB(i, 255 - i,
 * 0x40)`, so a pixel read back names the index it holds. Each row of
 * memory, counted from the start of the bits, is filled with its number
 * modulo 256 through a huge pointer, as a program made for Windows 3.1
 * walks one.
 *
 * * `pixel`: `GetPixel` of the WinG device context at (x, y), as the index
 *   the colour names, for rows either side of each 64 KiB boundary (102 and
 *   103 rows of 640 make 65,920 bytes, past the first).
 * * `screen`: the bitmap `WinGBitBlt` to the screen at (0, 0), and
 *   `GetPixel` of the screen at the same places, `rrggbb`.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\WINGBIG.OUT"

typedef HDC(FAR PASCAL *WG_CREATEDC)(void);
typedef HBITMAP(FAR PASCAL *WG_CREATEBITMAP)(HDC, BITMAPINFO FAR *, void FAR *FAR *);
typedef BOOL(FAR PASCAL *WG_BITBLT)(HDC, int, int, int, int, HDC, int, int);

static struct {
    BITMAPINFOHEADER header;
    RGBQUAD colours[256];
} info;

static const int AT[][2] = { { 0, 0 },   { 0, 376 }, { 0, 377 }, { 255, 377 }, { 256, 377 },
                             { 639, 377 }, { 0, 378 }, { 0, 479 }, { 300, 275 }, { 300, 274 },
                             { 511, 274 }, { 512, 274 }, { 600, 100 } };

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HINSTANCE wing;
    WG_CREATEDC createDC;
    WG_CREATEBITMAP createBitmap;
    WG_BITBLT bitBlt;
    HDC dc;
    HDC screen;
    HBITMAP bitmap;
    HBITMAP before;
    BYTE huge *bits = NULL;
    BYTE huge *at;
    long row;
    int column;
    int i;

    probeOpen(OUTPUT);
    ShowCursor(FALSE);
    SetCursorPos(639, 479);

    wing = LoadLibrary("WING.DLL");

    if (wing < HINSTANCE_ERROR) {
        probe("load", "WING.DLL", "failed");
        probeFinish();
        return 0;
    }

    createDC = (WG_CREATEDC)GetProcAddress(wing, MAKEINTRESOURCE(1001));
    createBitmap = (WG_CREATEBITMAP)GetProcAddress(wing, MAKEINTRESOURCE(1003));
    bitBlt = (WG_BITBLT)GetProcAddress(wing, MAKEINTRESOURCE(1010));

    info.header.biSize = sizeof(BITMAPINFOHEADER);
    info.header.biWidth = 640;
    info.header.biHeight = 480;
    info.header.biPlanes = 1;
    info.header.biBitCount = 8;
    info.header.biCompression = BI_RGB;

    for (i = 0; i < 256; i++) {
        info.colours[i].rgbRed = (BYTE)i;
        info.colours[i].rgbGreen = (BYTE)(255 - i);
        info.colours[i].rgbBlue = 0x40;
    }

    dc = createDC();
    bitmap = createBitmap(dc, (BITMAPINFO FAR *)&info, (void FAR *FAR *)&bits);
    probe("bitmap", "640x480", bitmap && bits ? "made" : "none");

    if (!bitmap || !bits) {
        probeFinish();
        return 0;
    }

    at = bits;

    for (row = 0; row < 480; row++) {
        for (column = 0; column < 640; column++) {
            *at++ = (BYTE)row;
        }
    }

    before = SelectObject(dc, bitmap);

    for (i = 0; i < sizeof(AT) / sizeof(AT[0]); i++) {
        wsprintf(probeArgs, "%d,%d", AT[i][0], AT[i][1]);
        wsprintf(probeResult, "%d", GetRValue(GetPixel(dc, AT[i][0], AT[i][1])));
        probe("pixel", probeArgs, probeResult);
    }

    screen = GetDC(NULL);
    bitBlt(screen, 0, 0, 640, 480, dc, 0, 0);

    for (i = 0; i < sizeof(AT) / sizeof(AT[0]); i++) {
        COLORREF colour = GetPixel(screen, AT[i][0], AT[i][1]);

        wsprintf(probeArgs, "%d,%d", AT[i][0], AT[i][1]);
        wsprintf(probeResult, "%02x%02x%02x", GetRValue(colour), GetGValue(colour),
                 GetBValue(colour));
        probe("screen", probeArgs, probeResult);
    }

    ReleaseDC(NULL, screen);
    SelectObject(dc, before);
    DeleteObject(bitmap);
    DeleteDC(dc);
    FreeLibrary(wing);
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
