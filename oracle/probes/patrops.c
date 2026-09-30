/*
 * `PatBlt` under every raster operation it can do without a source, and a
 * few it cannot: what a program gets from `PATINVERT`, `DSTINVERT` and the
 * operations without names, over colours.
 *
 * On the screen, over white, cells 16 wide and 8 high: each column of a cell
 * filled first with one of the sixteen palette colours, the destination,
 * then the whole cell `PatBlt`ted with a pattern brush whose eight rows are
 * eight palette colours, the first eight in one brush and the last eight in
 * the other. So each cell holds every destination under eight patterns, and
 * two cells every pair.
 *
 * * `rop`: the operation's code, the brush (`low` or `high`), and the row, as
 *   palette digits, a pixel each, in the palette's order.
 * * `result`: what `PatBlt` answered for each operation.
 * * `hatch`: a red `HS_DIAGCROSS` brush `PATCOPY`d over the sixteen columns,
 *   the background colour green, `OPAQUE` and then `TRANSPARENT`; 16 rows.
 * * `source`: `SRCCOPY`, `SRCPAINT`, `SRCINVERT` and `NOTSRCCOPY`, which read
 *   a source `PatBlt` has not got, with a blue brush over the columns: the
 *   answer and the rows. The last two tell doing nothing from taking the
 *   destination for the source.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\PATROPS.OUT"

static const char HEX[] = "0123456789abcdef";

static const COLORREF PALETTE[16] = {
    RGB(0, 0, 0),       RGB(128, 0, 0),     RGB(0, 128, 0),   RGB(128, 128, 0),
    RGB(0, 0, 128),     RGB(128, 0, 128),   RGB(0, 128, 128), RGB(192, 192, 192),
    RGB(128, 128, 128), RGB(255, 0, 0),     RGB(0, 255, 0),   RGB(255, 255, 0),
    RGB(0, 0, 255),     RGB(255, 0, 255),   RGB(0, 255, 255), RGB(255, 255, 255),
};

/* The sixteen operations of the brush and the destination alone. */
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

/* A column of each palette colour, `width` wide, in order. */
static void columns(HDC screen, int x, int y, int width, int height)
{
    int index;

    for (index = 0; index < 16; index++) {
        HBRUSH brush = CreateSolidBrush(PALETTE[index]);
        HBRUSH old = SelectObject(screen, brush);

        PatBlt(screen, x + index * width, y, width, height, PATCOPY);
        SelectObject(screen, old);
        DeleteObject(brush);
    }
}

static void rows(HDC screen, LPCSTR function, LPCSTR name, int x, int y, int width, int height)
{
    int row;
    int column;

    for (row = 0; row < height; row++) {
        LPSTR at = probeResult;

        for (column = 0; column < width; column++) {
            *at++ = digit(GetPixel(screen, x + column, y + row));
        }

        *at = '\0';
        wsprintf(probeArgs, "%s,y=%d", name, row);
        probe(function, probeArgs, probeResult);
    }
}

/* A pattern brush whose rows are palette colours `first` to `first + 7`. */
static HBRUSH striped(HDC screen, int first)
{
    HDC memory = CreateCompatibleDC(screen);
    HBITMAP bitmap = CreateCompatibleBitmap(screen, 8, 8);
    HBITMAP old = SelectObject(memory, bitmap);
    HBRUSH brush;
    int row;

    for (row = 0; row < 8; row++) {
        HBRUSH solid = CreateSolidBrush(PALETTE[first + row]);
        RECT line;

        SetRect(&line, 0, row, 8, row + 1);
        FillRect(memory, &line, solid);
        DeleteObject(solid);
    }

    SelectObject(memory, old);
    DeleteDC(memory);
    brush = CreatePatternBrush(bitmap);
    DeleteObject(bitmap);

    return brush;
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HDC screen;
    HBRUSH brushes[2];
    int index;
    int half;

    probeOpen(OUTPUT);
    ShowCursor(FALSE);
    SetCursorPos(GetSystemMetrics(SM_CXSCREEN) - 1, GetSystemMetrics(SM_CYSCREEN) - 1);

    screen = GetDC(NULL);
    PatBlt(screen, 0, 0, 256, 64, WHITENESS);

    brushes[0] = striped(screen, 0);
    brushes[1] = striped(screen, 8);

    for (index = 0; index < 16; index++) {
        for (half = 0; half < 2; half++) {
            HBRUSH old;
            BOOL answer;
            char name[24];

            columns(screen, 0, 0, 1, 8);
            old = SelectObject(screen, brushes[half]);
            answer = PatBlt(screen, 0, 0, 16, 8, ROPS[index]);
            SelectObject(screen, old);

            wsprintf(name, "%lx,%s", ROPS[index], (LPSTR)(half ? "high" : "low"));
            rows(screen, "rop", name, 0, 0, 16, 8);

            if (half == 0) {
                wsprintf(probeArgs, "%lx", ROPS[index]);
                wsprintf(probeResult, "%d", answer);
                probe("result", probeArgs, probeResult);
            }
        }
    }

    DeleteObject(brushes[0]);
    DeleteObject(brushes[1]);

    {
        HBRUSH hatch = CreateHatchBrush(HS_DIAGCROSS, RGB(255, 0, 0));
        HBRUSH old;
        int mode;

        SetBkColor(screen, RGB(0, 255, 0));

        for (mode = 0; mode < 2; mode++) {
            SetBkMode(screen, mode ? TRANSPARENT : OPAQUE);
            columns(screen, 0, 0, 1, 16);
            old = SelectObject(screen, hatch);
            PatBlt(screen, 0, 0, 16, 16, PATCOPY);
            SelectObject(screen, old);
            rows(screen, "hatch", mode ? "transparent" : "opaque", 0, 0, 16, 16);
        }

        SetBkMode(screen, OPAQUE);
        SetBkColor(screen, RGB(255, 255, 255));
        DeleteObject(hatch);
    }

    {
        static const DWORD SOURCES[4] = {SRCCOPY, SRCPAINT, SRCINVERT, NOTSRCCOPY};
        HBRUSH blue = CreateSolidBrush(RGB(0, 0, 255));
        HBRUSH old;
        char name[16];

        for (index = 0; index < 4; index++) {
            BOOL answer;

            columns(screen, 0, 0, 1, 2);
            old = SelectObject(screen, blue);
            answer = PatBlt(screen, 0, 0, 16, 2, SOURCES[index]);
            SelectObject(screen, old);

            wsprintf(name, "%lx", SOURCES[index]);
            wsprintf(probeResult, "%d", answer);
            probe("result", name, probeResult);
            rows(screen, "source", name, 0, 0, 16, 2);
        }

        DeleteObject(blue);
    }

    ReleaseDC(NULL, screen);
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
