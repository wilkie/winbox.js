/*
 * CreateBrushIndirect for each style of LOGBRUSH, CreateHatchBrush beside
 * it, and MoveToEx: as Championship Slots of the corpus makes its brushes
 * and moves its pen.
 *
 * Each painting case fills a 16 by 16 colour bitmap, compatible with the
 * screen and filled white first, with FillRect in a memory device context
 * whose text colour is black and background colour yellow, and records its
 * rows as the palette's digits:
 *
 * * `rows`: the case and the row's number; the row.
 * * `made`: whether a handle came back, and for the null style whether it is
 *   the stock NULL_BRUSH.
 * * `object`: what GetObject answers for the brush, its size and the bytes,
 *   in hex -- a bitmap's handle, where the hatch word is one, as `hhhh`.
 * * `moveto`: MoveToEx's answer and the POINT it filled, and the current
 *   position after, as `answer x,y cx,cy`.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\BRUSHIND.OUT"

static const char HEX[] = "0123456789abcdef";

static const COLORREF PALETTE[16] = {
    RGB(0, 0, 0),       RGB(128, 0, 0),     RGB(0, 128, 0),   RGB(128, 128, 0),
    RGB(0, 0, 128),     RGB(128, 0, 128),   RGB(0, 128, 128), RGB(192, 192, 192),
    RGB(128, 128, 128), RGB(255, 0, 0),     RGB(0, 255, 0),   RGB(255, 255, 0),
    RGB(0, 0, 255),     RGB(255, 0, 255),   RGB(0, 255, 255), RGB(255, 255, 255),
};

static WORD BITS[8] = {0x90, 0x40, 0x20, 0x10, 0x08, 0x04, 0x02, 0x01};

static HDC screen;
static char row[64];
static char name[32];

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

static void paint(LPCSTR name, HBRUSH brush, int mode)
{
    HDC dc = CreateCompatibleDC(screen);
    HBITMAP target = CreateCompatibleBitmap(screen, 16, 16);
    HBITMAP old = SelectObject(dc, target);
    RECT all;
    int x;
    int y;

    all.left = 0;
    all.top = 0;
    all.right = 16;
    all.bottom = 16;
    FillRect(dc, &all, GetStockObject(WHITE_BRUSH));
    SetTextColor(dc, RGB(0, 0, 0));
    SetBkColor(dc, RGB(255, 255, 0));
    SetBkMode(dc, mode);
    FillRect(dc, &all, brush);

    for (y = 0; y < 16; y++) {
        for (x = 0; x < 16; x++) {
            row[x] = digit(GetPixel(dc, x, y));
        }

        row[16] = '\0';
        wsprintf(probeArgs, "%s,y=%d", name, y);
        probe("rows", probeArgs, row);
    }

    SelectObject(dc, old);
    DeleteObject(target);
    DeleteDC(dc);
}

static void object(LPCSTR name, HBRUSH brush, WORD handle)
{
    BYTE bytes[16];
    int size;
    int i;

    for (i = 0; i < 16; i++) {
        bytes[i] = 0xee;
    }

    size = GetObject(brush, sizeof(bytes), bytes);
    wsprintf(probeResult, "%d ", size);

    for (i = 0; i < size && i < 16; i++) {
        row[2 * i] = HEX[bytes[i] >> 4];
        row[2 * i + 1] = HEX[bytes[i] & 15];
    }

    row[2 * i] = '\0';

    /* A bitmap's handle is the recording's own: said as `hhhh`. */
    if (handle && size >= 8 && *(WORD *)(bytes + 6) == handle) {
        lstrcpy(row + 12, "hhhh");
    }

    lstrcat(probeResult, row);
    probe("object", name, probeResult);
}

static HBRUSH make(LPCSTR name, UINT style, COLORREF colour, int hatch)
{
    LOGBRUSH logical;
    HBRUSH brush;

    logical.lbStyle = style;
    logical.lbColor = colour;
    logical.lbHatch = hatch;
    brush = CreateBrushIndirect(&logical);
    probe("made", name, brush ? "1" : "0");

    if (brush) {
        object(name, brush, style == BS_PATTERN ? (WORD)hatch : 0);
    }

    return brush;
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HBRUSH brush;
    HBITMAP bitmap;
    HDC dc;
    POINT point;
    BOOL answer;
    DWORD position;
    int hatch;

    probeOpen(OUTPUT);
    screen = GetDC(NULL);

    brush = make("solid", BS_SOLID, RGB(255, 0, 0), 0);
    paint("solid", brush, OPAQUE);
    DeleteObject(brush);

    brush = make("solid-hatch", BS_SOLID, RGB(0, 0, 255), HS_CROSS);
    DeleteObject(brush);

    brush = make("null", BS_NULL, RGB(255, 0, 0), 0);
    probe("made", "null-stock", brush == GetStockObject(NULL_BRUSH) ? "1" : "0");
    paint("null", brush, OPAQUE);
    DeleteObject(brush);

    for (hatch = 0; hatch <= 6; hatch++) {
        wsprintf(name, "hatch-%d", hatch);
        brush = make(name, BS_HATCHED, RGB(0, 0, 255), hatch);

        if (brush) {
            paint(name, brush, OPAQUE);
            DeleteObject(brush);
        }
    }

    brush = make("hatch-transparent", BS_HATCHED, RGB(0, 0, 255), HS_DIAGCROSS);
    paint("hatch-transparent", brush, TRANSPARENT);
    DeleteObject(brush);

    brush = CreateHatchBrush(HS_CROSS, RGB(255, 0, 0));
    probe("made", "createhatch", brush ? "1" : "0");
    object("createhatch", brush, 0);
    DeleteObject(brush);

    bitmap = CreateBitmap(8, 8, 1, 1, BITS);
    brush = make("pattern", BS_PATTERN, RGB(255, 0, 0), (int)bitmap);
    paint("pattern", brush, OPAQUE);
    DeleteObject(brush);
    DeleteObject(bitmap);

    brush = make("bad-style", 9, RGB(255, 0, 0), 0);

    if (brush) {
        paint("bad-style", brush, OPAQUE);
        DeleteObject(brush);
    }

    dc = CreateCompatibleDC(screen);
    answer = MoveToEx(dc, 3, 4, NULL);
    position = GetCurrentPosition(dc);
    wsprintf(probeResult, "%d %d,%d", answer, LOWORD(position), HIWORD(position));
    probe("moveto", "null-point", probeResult);

    point.x = point.y = -1;
    answer = MoveToEx(dc, -5, 600, &point);
    position = GetCurrentPosition(dc);
    wsprintf(probeResult, "%d %d,%d %d,%d", answer, point.x, point.y, (int)LOWORD(position),
             (int)HIWORD(position));
    probe("moveto", "point", probeResult);

    point.x = point.y = -1;
    answer = MoveToEx(0, 1, 2, &point);
    wsprintf(probeResult, "%d %d,%d", answer, point.x, point.y);
    probe("moveto", "no-dc", probeResult);
    DeleteDC(dc);

    ReleaseDC(NULL, screen);
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
