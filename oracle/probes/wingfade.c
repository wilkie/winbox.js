/*
 * What `WinGBitBlt` puts on the screen while a palette's colours are
 * animated, as Lode Runner: The Legend Returns shows its pictures: it
 * realizes a palette whose 236 colours between the static ones are
 * `PC_RESERVED` and black, makes its bitmap's colour table the palette's
 * entries, blits its picture to the screen, then fades the picture in with
 * `AnimatePalette`. On the 256-colour display with WinG installed.
 *
 * A window over the whole screen; a palette of 256, the twenty static
 * colours at either end as the system palette has them, and between them
 * 236 entries each `PC_RESERVED`; a WinG bitmap of 236 by 1, top-down,
 * whose pixel `x` is index `10 + x`. Each case blits the bitmap to its own
 * row, and reads the screen's pixels at indices 10, 11, 50, 128 and 245 by
 * `GetPixel`, as `rrggbb`:
 *
 * * `colours`: the 236 entries colours of their own (`i`, `255 - i`, 80h)
 *   when realized, the colour table the same; blitted, then read.
 * * `black-table`: the palette realized with the 236 entries black, the
 *   colour table its entries (black, as the system palette's), blitted;
 *   read, then read again after `AnimatePalette` gives the 236 entries
 *   their colours.
 * * `colour-table`: the same, but the colour table the colours while the
 *   palette is black.
 * * `one-off`: the same as `black-table`, but entry 245 of the colour table
 *   white: the table is the system palette's but for one entry.
 * * `realize`: what `RealizePalette` answered for each palette, and whether
 *   its handle is the one of the palette deleted before it.
 */

#define PROBE_FLUSH
#include "probe.h"

#define OUTPUT "C:\\ORACLE\\WINGFADE.OUT"

typedef HDC(FAR PASCAL *WG_CREATEDC)(void);
typedef HBITMAP(FAR PASCAL *WG_CREATEBITMAP)(HDC, BITMAPINFO FAR *, void FAR *FAR *);
typedef UINT(FAR PASCAL *WG_COLORTABLE)(HDC, UINT, UINT, RGBQUAD FAR *);
typedef BOOL(FAR PASCAL *WG_BITBLT)(HDC, int, int, int, int, HDC, int, int);

static WG_CREATEDC createDC;
static WG_CREATEBITMAP createBitmap;
static WG_COLORTABLE setColorTable;
static WG_BITBLT bitBlt;

static struct {
    BITMAPINFOHEADER header;
    RGBQUAD colours[256];
} info;

static struct {
    WORD version;
    WORD count;
    PALETTEENTRY entries[256];
} logical;

static PALETTEENTRY coloured[256];
static PALETTEENTRY dark[256];
static PALETTEENTRY offByOne[256];
static RGBQUAD table[256];

static HDC windowDC;
static HDC wingDC;
static HPALETTE deleted;

static const int PLACES[] = { 10, 11, 50, 128, 245 };

static LRESULT CALLBACK WindowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    return DefWindowProc(window, message, wParam, lParam);
}

static void hex(LPSTR at, COLORREF colour)
{
    wsprintf(at, "%02x%02x%02x", GetRValue(colour), GetGValue(colour), GetBValue(colour));
}

/* The screen's pixels at the indices read, on row `y`. */
static void read(LPCSTR function, LPCSTR args, int y)
{
    LPSTR at = probeResult;
    int k;

    for (k = 0; k < sizeof(PLACES) / sizeof(PLACES[0]); k++) {
        hex(at, GetPixel(windowDC, PLACES[k] - 10, y));
        at += 6;
        *at++ = k < sizeof(PLACES) / sizeof(PLACES[0]) - 1 ? ',' : '\0';
    }

    probe(function, args, probeResult);
}

/* A palette of the entries given, selected into the window's context and
 * realized. */
static HPALETTE realized(LPCSTR name, PALETTEENTRY FAR *entries)
{
    HPALETTE palette;
    int i;

    logical.version = 0x300;
    logical.count = 256;

    for (i = 0; i < 256; i++) {
        logical.entries[i] = entries[i];
    }

    palette = CreatePalette((LOGPALETTE FAR *)&logical);
    SelectPalette(windowDC, palette, FALSE);
    wsprintf(probeResult, "%u,%s", RealizePalette(windowDC),
             (LPSTR)(palette == deleted ? "the handle deleted before" : "a handle of its own"));
    probe("realize", name, probeResult);

    return palette;
}

/* The colour table as the entries given. */
static void tabled(PALETTEENTRY FAR *entries)
{
    int i;

    for (i = 0; i < 256; i++) {
        table[i].rgbRed = entries[i].peRed;
        table[i].rgbGreen = entries[i].peGreen;
        table[i].rgbBlue = entries[i].peBlue;
        table[i].rgbReserved = 0;
    }

    setColorTable(wingDC, 0, 256, table);
}

/* The palette black, the colour table as given, blitted to row `y`; read,
 * then the 236 colours animated in and read again. */
static void faded(LPCSTR name, PALETTEENTRY FAR *entries, int y)
{
    HPALETTE palette = realized(name, dark);
    PALETTEENTRY now[256];
    char args[32];

    if (entries == NULL) {
        GetPaletteEntries(palette, 0, 256, now);
        entries = now;
    }

    tabled(entries);
    bitBlt(windowDC, 0, y, 236, 1, wingDC, 0, 0);
    wsprintf(args, "%s,blitted", name);
    read(name, args, y);
    AnimatePalette(palette, 10, 236, &coloured[10]);
    wsprintf(args, "%s,animated", name);
    read(name, args, y);
    SelectPalette(windowDC, GetStockObject(DEFAULT_PALETTE), FALSE);
    DeleteObject(palette);
    deleted = palette;
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HINSTANCE wing;
    WNDCLASS wc;
    HWND window;
    HPALETTE palette;
    HBITMAP bitmap;
    BYTE huge *bits = NULL;
    int i;

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
    setColorTable = (WG_COLORTABLE)GetProcAddress(wing, MAKEINTRESOURCE(1006));
    bitBlt = (WG_BITBLT)GetProcAddress(wing, MAKEINTRESOURCE(1010));

    _fmemset(&wc, 0, sizeof(wc));
    wc.lpfnWndProc = WindowProc;
    wc.hInstance = instance;
    wc.hbrBackground = GetStockObject(BLACK_BRUSH);
    wc.lpszClassName = "WingFade";
    RegisterClass(&wc);
    window = CreateWindow("WingFade", "", WS_POPUP | WS_VISIBLE, 0, 0, 640, 480, NULL, NULL,
                          instance, NULL);
    UpdateWindow(window);
    windowDC = GetDC(window);

    GetSystemPaletteEntries(windowDC, 0, 256, coloured);

    for (i = 0; i < 256; i++) {
        dark[i] = coloured[i];
        dark[i].peFlags = 0;
        coloured[i].peFlags = 0;

        if (i >= 10 && i < 246) {
            coloured[i].peRed = (BYTE)i;
            coloured[i].peGreen = (BYTE)(255 - i);
            coloured[i].peBlue = 0x80;
            coloured[i].peFlags = PC_RESERVED;
            dark[i].peRed = 0;
            dark[i].peGreen = 0;
            dark[i].peBlue = 0;
            dark[i].peFlags = PC_RESERVED;
        }
    }

    wingDC = createDC();
    _fmemset(&info, 0, sizeof(info));
    info.header.biSize = sizeof(BITMAPINFOHEADER);
    info.header.biWidth = 236;
    info.header.biHeight = -1;
    info.header.biPlanes = 1;
    info.header.biBitCount = 8;
    info.header.biCompression = BI_RGB;
    info.header.biClrUsed = 256;
    bitmap = createBitmap(wingDC, (BITMAPINFO FAR *)&info, (void FAR *FAR *)&bits);
    SelectObject(wingDC, bitmap);

    for (i = 0; i < 236; i++) {
        bits[i] = (BYTE)(10 + i);
    }

    palette = realized("colours", coloured);
    tabled(coloured);
    bitBlt(windowDC, 0, 10, 236, 1, wingDC, 0, 0);
    read("colours", "blitted", 10);
    SelectPalette(windowDC, GetStockObject(DEFAULT_PALETTE), FALSE);
    DeleteObject(palette);
    deleted = palette;

    faded("black-table", NULL, 20);
    faded("colour-table", coloured, 30);

    for (i = 0; i < 256; i++) {
        offByOne[i] = dark[i];
    }

    offByOne[245].peRed = 0xff;
    offByOne[245].peGreen = 0xff;
    offByOne[245].peBlue = 0xff;
    faded("one-off", offByOne, 40);

    ReleaseDC(window, windowDC);
    DeleteDC(wingDC);
    DeleteObject(bitmap);
    DestroyWindow(window);
    probeFinish();

    return 0;
}
