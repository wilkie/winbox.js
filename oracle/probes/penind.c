/*
 * CreatePenIndirect beside CreatePen, and what each style of pen draws: as
 * Championship Slots of the corpus makes its pens.
 *
 * Each pen draws two lines by MoveTo and LineTo across a 64 by 6 colour
 * bitmap, compatible with the screen and filled white first: along row 2
 * from the left, and along row 5 from the sixth column, in a memory device
 * context whose background colour is yellow.
 *
 * * `made`: whether CreatePen and CreatePenIndirect of a style and width
 *   gave a handle, as `pen,indirect`.
 * * `object`: what GetObject answers for each, its size and bytes in hex.
 * * `rows`: the style, width and background mode; rows 1 to 3 and 5, as
 *   the palette's digits. `wide` the same, for a pen wider than a pixel.
 * * `column`, `diagonal`: for a pen a pixel wide, the pixels of a line down
 *   the first column of a 64 square, and of one from its second column
 *   to its right edge a row down each column, in background mode OPAQUE.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\PENIND.OUT"

static const char HEX[] = "0123456789abcdef";

static const COLORREF PALETTE[16] = {
    RGB(0, 0, 0),       RGB(128, 0, 0),     RGB(0, 128, 0),   RGB(128, 128, 0),
    RGB(0, 0, 128),     RGB(128, 0, 128),   RGB(0, 128, 128), RGB(192, 192, 192),
    RGB(128, 128, 128), RGB(255, 0, 0),     RGB(0, 255, 0),   RGB(255, 255, 0),
    RGB(0, 0, 255),     RGB(255, 0, 255),   RGB(0, 255, 255), RGB(255, 255, 255),
};

static HDC screen;
static char row[80];
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

static void object(LPCSTR label, HPEN pen)
{
    BYTE bytes[16];
    int size;
    int i;

    for (i = 0; i < 16; i++) {
        bytes[i] = 0xee;
    }

    size = GetObject(pen, sizeof(bytes), bytes);
    wsprintf(probeResult, "%d ", size);

    for (i = 0; i < size && i < 16; i++) {
        row[2 * i] = HEX[bytes[i] >> 4];
        row[2 * i + 1] = HEX[bytes[i] & 15];
    }

    row[2 * i] = '\0';
    lstrcat(probeResult, row);
    probe("object", label, probeResult);
}

static void draw(HPEN pen, int mode, LPCSTR function)
{
    HDC dc = CreateCompatibleDC(screen);
    HBITMAP target = CreateCompatibleBitmap(screen, 64, 6);
    HBITMAP old = SelectObject(dc, target);
    HPEN oldPen;
    int x;
    int y;

    PatBlt(dc, 0, 0, 64, 6, WHITENESS);
    SetBkColor(dc, RGB(255, 255, 0));
    SetBkMode(dc, mode);
    oldPen = SelectObject(dc, pen);
    MoveTo(dc, 0, 2);
    LineTo(dc, 64, 2);
    MoveTo(dc, 5, 5);
    LineTo(dc, 64, 5);
    SelectObject(dc, oldPen);

    for (y = 1; y <= 5; y++) {
        if (y == 4) {
            continue;
        }

        for (x = 0; x < 64; x++) {
            row[x] = digit(GetPixel(dc, x, y));
        }

        row[64] = '\0';
        wsprintf(probeArgs, "%s,%s,y=%d", (LPSTR)name, (LPSTR)(mode == OPAQUE ? "opaque" : "transparent"), y);
        probe(function, probeArgs, row);
    }

    SelectObject(dc, old);
    DeleteObject(target);
    DeleteDC(dc);
}

/* A vertical line down the first column and a diagonal from the top left
 * corner of a 64 square, each read along its own pixels. */
static void across(HPEN pen)
{
    HDC dc = CreateCompatibleDC(screen);
    HBITMAP target = CreateCompatibleBitmap(screen, 64, 64);
    HBITMAP old = SelectObject(dc, target);
    HPEN oldPen;
    int i;

    PatBlt(dc, 0, 0, 64, 64, WHITENESS);
    SetBkColor(dc, RGB(255, 255, 0));
    SetBkMode(dc, OPAQUE);
    oldPen = SelectObject(dc, pen);
    MoveTo(dc, 0, 0);
    LineTo(dc, 0, 64);
    MoveTo(dc, 1, 0);
    LineTo(dc, 64, 63);
    SelectObject(dc, oldPen);

    for (i = 0; i < 64; i++) {
        row[i] = digit(GetPixel(dc, 0, i));
    }

    row[64] = '\0';
    probe("column", name, row);

    for (i = 0; i < 63; i++) {
        row[i] = digit(GetPixel(dc, i + 1, i));
    }

    row[63] = '\0';
    probe("diagonal", name, row);

    SelectObject(dc, old);
    DeleteObject(target);
    DeleteDC(dc);
}

static void pen(int style, int width)
{
    LOGPEN logical;
    HPEN direct;
    HPEN indirect;

    wsprintf(name, "style-%d,width-%d", style, width);
    direct = CreatePen(style, width, RGB(255, 0, 0));
    logical.lopnStyle = style;
    logical.lopnWidth.x = width;
    logical.lopnWidth.y = 77;
    logical.lopnColor = RGB(255, 0, 0);
    indirect = CreatePenIndirect(&logical);
    wsprintf(probeResult, "%d,%d", direct != 0, indirect != 0);
    probe("made", name, probeResult);

    if (direct) {
        lstrcpy(probeArgs, name);
        lstrcat(probeArgs, ",pen");
        object(probeArgs, direct);
    }

    if (indirect) {
        lstrcpy(probeArgs, name);
        lstrcat(probeArgs, ",indirect");
        object(probeArgs, indirect);
        draw(indirect, OPAQUE, width > 1 ? "wide" : "rows");
        draw(indirect, TRANSPARENT, width > 1 ? "wide" : "rows");

        if (width == 1) {
            across(indirect);
        }

        DeleteObject(indirect);
    }

    if (direct) {
        DeleteObject(direct);
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    int style;

    probeOpen(OUTPUT);
    screen = GetDC(NULL);

    for (style = 0; style <= 7; style++) {
        pen(style, 1);
    }

    pen(PS_DASH, 3);
    pen(PS_SOLID, 0);
    pen(PS_INSIDEFRAME, 3);

    ReleaseDC(NULL, screen);
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
