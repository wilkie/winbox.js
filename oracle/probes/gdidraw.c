/*
 * GDI's drawing functions not yet recorded: `FloodFill`, `ExtFloodFill`,
 * `LineDDA`, `PolyPolygon`, `SetDIBits` and `CreateDIBPatternBrush`.
 *
 * Each case draws in a cell 32 by 32 at the screen's corner, filled white
 * first, and reads it back:
 *
 * * `rows`: the case and the row, a palette digit a pixel.
 * * `answer`: what the call answered.
 * * `dda`: the points `LineDDA` gave its procedure, in order.
 *
 * The cases:
 * * `flood`: a black frame (4, 4)-(28, 28) and a black line from (4, 28) to
 *   (28, 4) inside it; `FloodFill` at (8, 20), border black, with the light
 *   grey brush. `flood on border`: the same started on the frame, at (4, 10).
 * * `surface`: red (4, 4)-(20, 20) and blue (12, 12)-(28, 28), blue drawn
 *   over red; `ExtFloodFill` at (6, 6), `FLOODFILLSURFACE` red, with the
 *   green brush. `border mode`: the flood case by `ExtFloodFill`'s
 *   `FLOODFILLBORDER`.
 * * `poly alternate`, `poly winding`: `PolyPolygon` with the light grey brush
 *   and the black pen of two triangles that overlap, (2, 2) (28, 2) (2, 28)
 *   and (6, 6) (30, 30) (30, 6), and a square (4, 20)-(14, 30) with a square
 *   hole (7, 23)-(11, 27) drawn the same way round, under each fill mode.
 * * `dib4`, `dib1`, `dib part`: `SetDIBits` into a bitmap 8 by 4 compatible
 *   with the screen, then copied to the cell: a DIB of four bits a pixel,
 *   each row's pixels 0 to 7 of the palette's indices plus the row times 4;
 *   one of one bit, rows 0Fh, F0h, 33h, CCh, its colours red and blue; and
 *   the four-bit DIB's scan lines 1 and 2 only.
 * * `pattern4`, `pattern1`: a cell filled with `PATCOPY` by
 *   `CreateDIBPatternBrush` of a packed DIB 8 by 8: four bits a pixel,
 *   index `(x + y) & 15`; and one bit, rows alternating 55h and AAh, red and
 *   white.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\GDIDRAW.OUT"

#define CELL 32

static const char HEX[] = "0123456789abcdef";

static const COLORREF PALETTE[16] = {
    RGB(0, 0, 0),       RGB(128, 0, 0),     RGB(0, 128, 0),   RGB(128, 128, 0),
    RGB(0, 0, 128),     RGB(128, 0, 128),   RGB(0, 128, 128), RGB(192, 192, 192),
    RGB(128, 128, 128), RGB(255, 0, 0),     RGB(0, 255, 0),   RGB(255, 255, 0),
    RGB(0, 0, 255),     RGB(255, 0, 255),   RGB(0, 255, 255), RGB(255, 255, 255),
};

static HDC screen;
static char points[512];
static LPSTR pointAt;

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

static void clear(void)
{
    PatBlt(screen, 0, 0, CELL, CELL, WHITENESS);
}

static void rows(LPCSTR name)
{
    int x;
    int y;

    for (y = 0; y < CELL; y++) {
        for (x = 0; x < CELL; x++) {
            probeResult[x] = digit(GetPixel(screen, x, y));
        }

        probeResult[CELL] = '\0';
        wsprintf(probeArgs, "%s,y=%d", name, y);
        probe("rows", probeArgs, probeResult);
    }
}

static void answer(LPCSTR name, int value)
{
    wsprintf(probeResult, "%d", value);
    probe("answer", name, probeResult);
}

static void solid(COLORREF colour, int left, int top, int right, int bottom)
{
    HBRUSH brush = CreateSolidBrush(colour);
    RECT r;

    SetRect(&r, left, top, right, bottom);
    FillRect(screen, &r, brush);
    DeleteObject(brush);
}

static void framed(void)
{
    HPEN old = SelectObject(screen, GetStockObject(BLACK_PEN));
    HBRUSH was = SelectObject(screen, GetStockObject(NULL_BRUSH));

    clear();
    Rectangle(screen, 4, 4, 29, 29);
    MoveTo(screen, 4, 28);
    LineTo(screen, 28, 4);
    SelectObject(screen, old);
    SelectObject(screen, was);
}

void FAR PASCAL _export Point(int x, int y, LPARAM data)
{
    if (pointAt - points < (int)sizeof(points) - 12) {
        pointAt += wsprintf(pointAt, "%s%d,%d", (LPSTR)(pointAt == points ? "" : " "), x, y);
    }

    (void)data;
}

static void dda(LPCSTR name, FARPROC proc, int x1, int y1, int x2, int y2)
{
    pointAt = points;
    *pointAt = '\0';
    LineDDA(x1, y1, x2, y2, (LINEDDAPROC)proc, 0);
    probe("dda", name, points);
}

/* A packed DIB 8 by `height`: header, colour table, bits. */
static HGLOBAL packed(int bits, int height, const RGBQUAD FAR *colours, int count,
                      const BYTE FAR *data, int size)
{
    HGLOBAL block = GlobalAlloc(GMEM_MOVEABLE, sizeof(BITMAPINFOHEADER) + count * 4 + size);
    BYTE FAR *at = GlobalLock(block);
    BITMAPINFOHEADER FAR *header = (BITMAPINFOHEADER FAR *)at;

    header->biSize = sizeof(BITMAPINFOHEADER);
    header->biWidth = 8;
    header->biHeight = height;
    header->biPlanes = 1;
    header->biBitCount = bits;
    header->biCompression = BI_RGB;
    header->biSizeImage = 0;
    header->biXPelsPerMeter = 0;
    header->biYPelsPerMeter = 0;
    header->biClrUsed = 0;
    header->biClrImportant = 0;
    _fmemcpy(at + sizeof(BITMAPINFOHEADER), colours, count * 4);
    _fmemcpy(at + sizeof(BITMAPINFOHEADER) + count * 4, data, size);
    GlobalUnlock(block);

    return block;
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static RGBQUAD sixteen[16];
    static RGBQUAD two[2] = {{0, 0, 255, 0}, {255, 0, 0, 0}};
    static RGBQUAD redWhite[2] = {{0, 0, 255, 0}, {255, 255, 255, 0}};
    static BYTE four[16];
    static BYTE one[16] = {0x0f, 0, 0, 0, 0xf0, 0, 0, 0, 0x33, 0, 0, 0, 0xcc, 0, 0, 0};
    static BYTE pattern4[32];
    static BYTE pattern1[32];
    FARPROC proc;
    int index;

    probeOpen(OUTPUT);
    ShowCursor(FALSE);
    SetCursorPos(GetSystemMetrics(SM_CXSCREEN) - 1, GetSystemMetrics(SM_CYSCREEN) - 1);

    screen = GetDC(NULL);

    for (index = 0; index < 16; index++) {
        sixteen[index].rgbRed = GetRValue(PALETTE[index]);
        sixteen[index].rgbGreen = GetGValue(PALETTE[index]);
        sixteen[index].rgbBlue = GetBValue(PALETTE[index]);
        sixteen[index].rgbReserved = 0;
    }

    /* FloodFill and ExtFloodFill. */
    {
        HBRUSH old = SelectObject(screen, GetStockObject(LTGRAY_BRUSH));

        framed();
        answer("flood", FloodFill(screen, 8, 20, RGB(0, 0, 0)));
        rows("flood");

        framed();
        answer("flood on border", FloodFill(screen, 4, 10, RGB(0, 0, 0)));
        rows("flood on border");

        framed();
        answer("border mode", ExtFloodFill(screen, 8, 20, RGB(0, 0, 0), FLOODFILLBORDER));
        rows("border mode");

        SelectObject(screen, old);
    }

    {
        HBRUSH green = CreateSolidBrush(RGB(0, 255, 0));
        HBRUSH old = SelectObject(screen, green);

        clear();
        solid(RGB(255, 0, 0), 4, 4, 20, 20);
        solid(RGB(0, 0, 255), 12, 12, 28, 28);
        answer("surface", ExtFloodFill(screen, 6, 6, RGB(255, 0, 0), FLOODFILLSURFACE));
        rows("surface");

        SelectObject(screen, old);
        DeleteObject(green);
    }

    /* LineDDA. */
    proc = MakeProcInstance((FARPROC)Point, instance);
    dda("0,0-10,4", proc, 0, 0, 10, 4);
    dda("10,4-0,0", proc, 10, 4, 0, 0);
    dda("0,0-3,9", proc, 0, 0, 3, 9);
    dda("5,5-5,5", proc, 5, 5, 5, 5);
    dda("9,0-0,3", proc, 9, 0, 0, 3);
    FreeProcInstance(proc);

    /* PolyPolygon. */
    {
        static POINT shape[] = {{2, 2},  {28, 2},  {2, 28},  {6, 6},   {30, 30},
                                {30, 6}, {4, 20},  {14, 20}, {14, 30}, {4, 30},
                                {7, 23}, {11, 23}, {11, 27}, {7, 27}};
        static int counts[] = {3, 3, 4, 4};
        HPEN oldPen = SelectObject(screen, GetStockObject(BLACK_PEN));
        HBRUSH oldBrush = SelectObject(screen, GetStockObject(LTGRAY_BRUSH));

        clear();
        SetPolyFillMode(screen, ALTERNATE);
        answer("poly alternate", PolyPolygon(screen, shape, counts, 4));
        rows("poly alternate");

        clear();
        SetPolyFillMode(screen, WINDING);
        answer("poly winding", PolyPolygon(screen, shape, counts, 4));
        rows("poly winding");

        SetPolyFillMode(screen, ALTERNATE);
        SelectObject(screen, oldPen);
        SelectObject(screen, oldBrush);
    }

    /* SetDIBits. */
    {
        struct {
            BITMAPINFOHEADER header;
            RGBQUAD colours[16];
        } info;
        HBITMAP bitmap = CreateCompatibleBitmap(screen, 8, 4);
        HDC memory = CreateCompatibleDC(screen);
        int row;

        for (row = 0; row < 4; row++) {
            for (index = 0; index < 4; index++) {
                int first = (index * 2 + row * 4) & 15;
                int second = (index * 2 + 1 + row * 4) & 15;

                four[row * 4 + index] = (BYTE)((first << 4) | second);
            }
        }

        info.header.biSize = sizeof(BITMAPINFOHEADER);
        info.header.biWidth = 8;
        info.header.biHeight = 4;
        info.header.biPlanes = 1;
        info.header.biBitCount = 4;
        info.header.biCompression = BI_RGB;
        info.header.biSizeImage = 0;
        info.header.biXPelsPerMeter = 0;
        info.header.biYPelsPerMeter = 0;
        info.header.biClrUsed = 0;
        info.header.biClrImportant = 0;
        _fmemcpy(info.colours, sixteen, sizeof(sixteen));

        SelectObject(memory, bitmap);
        PatBlt(memory, 0, 0, 8, 4, WHITENESS);
        SelectObject(memory, CreateCompatibleBitmap(screen, 1, 1));
        answer("dib4", SetDIBits(screen, bitmap, 0, 4, four, (BITMAPINFO FAR *)&info,
                                 DIB_RGB_COLORS));
        SelectObject(memory, bitmap);
        clear();
        BitBlt(screen, 0, 0, 8, 4, memory, 0, 0, SRCCOPY);
        rows("dib4");

        SelectObject(memory, CreateCompatibleBitmap(screen, 1, 1));
        info.header.biBitCount = 1;
        _fmemcpy(info.colours, two, sizeof(two));
        answer("dib1", SetDIBits(screen, bitmap, 0, 4, one, (BITMAPINFO FAR *)&info,
                                 DIB_RGB_COLORS));
        SelectObject(memory, bitmap);
        clear();
        BitBlt(screen, 0, 0, 8, 4, memory, 0, 0, SRCCOPY);
        rows("dib1");

        SelectObject(memory, CreateCompatibleBitmap(screen, 1, 1));
        PatBlt(screen, 0, 0, 1, 1, WHITENESS);
        {
            HDC fill = CreateCompatibleDC(screen);

            SelectObject(fill, bitmap);
            PatBlt(fill, 0, 0, 8, 4, WHITENESS);
            SelectObject(fill, CreateCompatibleBitmap(screen, 1, 1));
            DeleteDC(fill);
        }
        info.header.biBitCount = 4;
        _fmemcpy(info.colours, sixteen, sizeof(sixteen));
        answer("dib part", SetDIBits(screen, bitmap, 1, 2, four + 4, (BITMAPINFO FAR *)&info,
                                     DIB_RGB_COLORS));
        SelectObject(memory, bitmap);
        clear();
        BitBlt(screen, 0, 0, 8, 4, memory, 0, 0, SRCCOPY);
        rows("dib part");

        DeleteDC(memory);
        DeleteObject(bitmap);
    }

    /* CreateDIBPatternBrush. */
    {
        HGLOBAL block;
        HBRUSH brush;
        HBRUSH old;
        int row;

        for (row = 0; row < 8; row++) {
            for (index = 0; index < 4; index++) {
                int first = (index * 2 + row) & 15;
                int second = (index * 2 + 1 + row) & 15;

                pattern4[row * 4 + index] = (BYTE)((first << 4) | second);
            }

            pattern1[row * 4] = (BYTE)(row & 1 ? 0xaa : 0x55);
        }

        block = packed(4, 8, sixteen, 16, pattern4, 32);
        brush = CreateDIBPatternBrush(block, DIB_RGB_COLORS);
        answer("pattern4", brush != NULL);
        clear();
        old = SelectObject(screen, brush);
        PatBlt(screen, 0, 0, 16, 16, PATCOPY);
        SelectObject(screen, old);
        rows("pattern4");
        DeleteObject(brush);
        GlobalFree(block);

        block = packed(1, 8, redWhite, 2, pattern1, 32);
        brush = CreateDIBPatternBrush(block, DIB_RGB_COLORS);
        answer("pattern1", brush != NULL);
        clear();
        old = SelectObject(screen, brush);
        PatBlt(screen, 0, 0, 16, 16, PATCOPY);
        SelectObject(screen, old);
        rows("pattern1");
        DeleteObject(brush);
        GlobalFree(block);
    }

    ReleaseDC(NULL, screen);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
