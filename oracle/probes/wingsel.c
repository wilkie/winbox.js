/*
 * How long a bitmap takes to be selected into a WinG device context, by the
 * context's text and background colours and the bitmap's colour table, and
 * how long `GetNearestColor` takes there by where the colour is in the
 * table, under the recorder's DOSBox on the 256-colour display with WinG
 * installed. Timings, not answers: kept in `fixtures/timings/`, not
 * replayed. Recorded at a fixed rate (`record.mjs --cycles 80000`), a
 * call's time is the instructions Windows runs for it.
 *
 * GDI's SelectObject of a bitmap sets the context's background and text
 * colours again (`GDI.EXE` seg1 `1d5e`-`1d80`), each a colour the device's
 * `ColorInfo` matches; WinG's device, `WINGDE.DLL`, matches a colour by a
 * search of the bitmap's colour table, entry by entry, that ends at the
 * first entry of the colour itself (seg2 `029d`-`0352`). SimTower selects
 * its bitmaps into its WinG context and out again several times a step of
 * its game (kb/topics/timing.md, "A game that paces itself by its work").
 *
 * Set up as `wingcost` is: bitmaps of 64 by 64, their colour table WinG's
 * halftone palette's, that palette selected and realized in a window over
 * the whole screen.
 *
 * * `rate`: `cpurate`'s `alu` workload in the same run, as instructions a
 *   millisecond, the passes and the milliseconds.
 * * `where`: the first entry of the table that is the colour, 256 for none.
 * * `cost`: the call, as nanoseconds a call, the calls and the
 *   milliseconds, after its name how it was made. `SelectObject` is two
 *   calls timed as one: a pen selected and the one before back, one
 *   bitmap selected and then the other, or the context's first bitmap
 *   (WinG's of 1 by 1) and then one of the two. The table is `halftone`, or
 *   `reversed`, the halftone palette's backwards; the context's colours
 *   its own, a white background and black text, or colours in no entry, a
 *   text colour of RGB(1,2,3) and a background of RGB(3,2,1);
 *   `GetNearestColor`'s black, white, or RGB(1,2,3), in no entry.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\WINGSEL.OUT"

typedef HDC(FAR PASCAL *WG_CREATEDC)(void);
typedef HBITMAP(FAR PASCAL *WG_CREATEBITMAP)(HDC, BITMAPINFO FAR *, void FAR *FAR *);
typedef UINT(FAR PASCAL *WG_COLORTABLE)(HDC, UINT, UINT, RGBQUAD FAR *);
typedef HPALETTE(FAR PASCAL *WG_HALFTONEPALETTE)(void);

static WG_CREATEDC createDC;
static WG_CREATEBITMAP createBitmap;
static WG_COLORTABLE setColorTable;
static WG_HALFTONEPALETTE halftonePalette;

static struct {
    BITMAPINFOHEADER header;
    RGBQUAD colours[256];
} info;

static HDC wingDC;
static HBITMAP first;
static HBITMAP second;
static HBITMAP original;
static HPEN pen;
static COLORREF nearest;

static void passAlu(void)
{
    _asm {
        mov cx, 65535
        mov bx, 3
        mov dx, 5
    top:
        add ax, bx
        sub ax, cx
        xor ax, dx
        and ax, bx
        or ax, cx
        shl ax, 1
        inc ax
        dec ax
        loop top
    }
}

static void rate(void)
{
    int run;

    for (run = 1; run <= 3; run++) {
        DWORD start = GetTickCount();
        DWORD elapsed;
        long passes = 0;

        do {
            passAlu();
            passes++;
            elapsed = GetTickCount() - start;
        } while (elapsed < 2000);

        wsprintf(probeArgs, "alu,%d", run);
        wsprintf(probeResult, "%ld,%ld,%ld", (long)((passes * 65535L * 9L) / (long)elapsed),
                 passes, (long)elapsed);
        probe("rate", probeArgs, probeResult);
    }
}

static void batchBitmaps(int batch)
{
    int i;

    for (i = 0; i < batch; i++) {
        SelectObject(wingDC, second);
        SelectObject(wingDC, first);
    }
}

static void batchOriginal(int batch)
{
    int i;

    for (i = 0; i < batch; i++) {
        SelectObject(wingDC, original);
        SelectObject(wingDC, first);
    }
}

static void batchPens(int batch)
{
    int i;

    for (i = 0; i < batch; i++) {
        SelectObject(wingDC, SelectObject(wingDC, pen));
    }
}

static void batchNearest(int batch)
{
    int i;

    for (i = 0; i < batch; i++) {
        GetNearestColor(wingDC, nearest);
    }
}

static void cost(LPCSTR name, LPCSTR how, void (*pass)(int), int batch)
{
    int run;

    for (run = 1; run <= 3; run++) {
        DWORD start = GetTickCount();
        DWORD elapsed;
        long calls = 0;

        do {
            pass(batch);
            calls += batch;
            elapsed = GetTickCount() - start;
        } while (elapsed < 2000);

        wsprintf(probeArgs, "%s/%s,%d", name, how, run);
        wsprintf(probeResult, "%ld,%ld,%ld", (long)((elapsed * 1000000L) / calls), calls,
                 (long)elapsed);
        probe("cost", probeArgs, probeResult);
    }
}

/* Where a colour is first in the table: the search's length. */
static void where(LPCSTR table, LPCSTR name, COLORREF colour)
{
    int k;

    for (k = 0; k < 256; k++) {
        if (info.colours[k].rgbRed == GetRValue(colour) &&
            info.colours[k].rgbGreen == GetGValue(colour) &&
            info.colours[k].rgbBlue == GetBValue(colour)) {
            break;
        }
    }

    wsprintf(probeArgs, "%s,%s", table, name);
    wsprintf(probeResult, "%d", k);
    probe("where", probeArgs, probeResult);
}

static void nearestOf(LPCSTR table, LPCSTR name, COLORREF colour)
{
    char how[64];

    where(table, name, colour);
    nearest = colour;
    wsprintf(how, "%s table, %s", table, name);
    cost("GetNearestColor", how, batchNearest, 100);
}

/* Each way of a table: the nearest colours, then the bitmaps selected
 * with the context's own colours and with colours in neither table. */
static void ways(LPCSTR table)
{
    char how[64];

    nearestOf(table, "black", RGB(0, 0, 0));
    nearestOf(table, "white", RGB(255, 255, 255));
    nearestOf(table, "a colour in no entry", RGB(1, 2, 3));

    SetTextColor(wingDC, RGB(0, 0, 0));
    SetBkColor(wingDC, RGB(255, 255, 255));
    wsprintf(how, "bitmaps, %s table, white and black", table);
    cost("SelectObject", how, batchBitmaps, 100);

    SetTextColor(wingDC, RGB(1, 2, 3));
    SetBkColor(wingDC, RGB(3, 2, 1));
    wsprintf(how, "bitmaps, %s table, colours in no entry", table);
    cost("SelectObject", how, batchBitmaps, 100);
    wsprintf(how, "the first bitmap back, %s table, colours in no entry", table);
    cost("SelectObject", how, batchOriginal, 100);

    SetTextColor(wingDC, RGB(0, 0, 0));
    SetBkColor(wingDC, RGB(255, 255, 255));
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HINSTANCE wing;
    WNDCLASS kind;
    HWND window;
    HDC windowDC;
    HPALETTE palette;
    PALETTEENTRY entries[256];
    void FAR *bits = NULL;
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
    setColorTable = (WG_COLORTABLE)GetProcAddress(wing, MAKEINTRESOURCE(1006));
    halftonePalette = (WG_HALFTONEPALETTE)GetProcAddress(wing, MAKEINTRESOURCE(1007));

    kind.style = 0;
    kind.lpfnWndProc = DefWindowProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = GetStockObject(BLACK_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "WinGSel";
    RegisterClass(&kind);

    window = CreateWindow("WinGSel", "", WS_POPUP | WS_VISIBLE, 0, 0, 640, 480, NULL, NULL,
                          instance, NULL);
    UpdateWindow(window);
    windowDC = GetDC(window);

    palette = halftonePalette();
    GetPaletteEntries(palette, 0, 256, entries);
    SelectPalette(windowDC, palette, FALSE);
    RealizePalette(windowDC);

    _fmemset(&info, 0, sizeof(info));
    info.header.biSize = sizeof(BITMAPINFOHEADER);
    info.header.biWidth = 64;
    info.header.biHeight = 64;
    info.header.biPlanes = 1;
    info.header.biBitCount = 8;
    info.header.biCompression = BI_RGB;
    info.header.biClrUsed = 256;

    for (k = 0; k < 256; k++) {
        info.colours[k].rgbRed = entries[k].peRed;
        info.colours[k].rgbGreen = entries[k].peGreen;
        info.colours[k].rgbBlue = entries[k].peBlue;
    }

    wingDC = createDC();
    first = createBitmap(wingDC, (BITMAPINFO FAR *)&info, &bits);
    second = createBitmap(wingDC, (BITMAPINFO FAR *)&info, &bits);
    original = SelectObject(wingDC, first);
    pen = CreatePen(PS_SOLID, 1, RGB(255, 0, 0));

    rate();
    cost("SelectObject", "pen and back", batchPens, 100);
    ways("halftone");

    /* The halftone palette's colours backwards, in both bitmaps. */
    for (k = 0; k < 256; k++) {
        info.colours[k].rgbRed = entries[255 - k].peRed;
        info.colours[k].rgbGreen = entries[255 - k].peGreen;
        info.colours[k].rgbBlue = entries[255 - k].peBlue;
    }

    SelectObject(wingDC, second);
    setColorTable(wingDC, 0, 256, info.colours);
    SelectObject(wingDC, first);
    setColorTable(wingDC, 0, 256, info.colours);
    ways("reversed");
    rate();

    SelectObject(wingDC, original);
    DeleteObject(pen);
    DeleteDC(wingDC);
    DeleteObject(first);
    DeleteObject(second);
    ReleaseDC(window, windowDC);
    DestroyWindow(window);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
