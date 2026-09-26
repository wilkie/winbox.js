/*
 * Pattern brushes: what a brush made from a bitmap paints, where its pattern
 * starts, and what it keeps of the bitmap.
 *
 * Every case paints a 16 by 16 colour bitmap, compatible with the screen and
 * filled white first, in a memory device context, and records its rows as the
 * palette's digits:
 *
 * * `rows`: the case and the row's number; the row.
 * * `brush`: what `GetObject` answers for the brush -- its size, and the
 *   `LOGBRUSH`'s style, colour and whether its last word is the bitmap's
 *   handle -- and what `SelectObject` answers after a `FillRect`.
 *
 * The monochrome pattern has one set bit in its first row and a diagonal
 * below, so that where it starts shows; its set bits are white.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\PATBRUSH.OUT"

static const char HEX[] = "0123456789abcdef";

static const COLORREF PALETTE[16] = {
    RGB(0, 0, 0),       RGB(128, 0, 0),     RGB(0, 128, 0),   RGB(128, 128, 0),
    RGB(0, 0, 128),     RGB(128, 0, 128),   RGB(0, 128, 128), RGB(192, 192, 192),
    RGB(128, 128, 128), RGB(255, 0, 0),     RGB(0, 255, 0),   RGB(255, 255, 0),
    RGB(0, 0, 255),     RGB(255, 0, 255),   RGB(0, 255, 255), RGB(255, 255, 255),
};

/* Row 0 has bit 7 and bit 4 set; rows 1..7 a diagonal. As WORDs, one per row. */
static WORD BITS[8] = {0x90, 0x40, 0x20, 0x10, 0x08, 0x04, 0x02, 0x01};

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

static HDC screen;
static HDC dc;
static HBITMAP target;
static HBITMAP oldTarget;
static char row[32];

static void begin(void)
{
    RECT all;

    dc = CreateCompatibleDC(screen);
    target = CreateCompatibleBitmap(screen, 16, 16);
    oldTarget = SelectObject(dc, target);
    all.left = 0;
    all.top = 0;
    all.right = 16;
    all.bottom = 16;
    FillRect(dc, &all, GetStockObject(WHITE_BRUSH));
}

static void end(LPCSTR name)
{
    int x;
    int y;

    for (y = 0; y < 16; y++) {
        for (x = 0; x < 16; x++) {
            row[x] = digit(GetPixel(dc, x, y));
        }

        row[16] = '\0';
        wsprintf(probeArgs, "%s,y=%d", name, y);
        probe("rows", probeArgs, row);
    }

    SelectObject(dc, GetStockObject(WHITE_BRUSH));
    SelectObject(dc, oldTarget);
    DeleteObject(target);
    DeleteDC(dc);
}

static HBRUSH monoBrush(HBITMAP FAR *made)
{
    HBITMAP bitmap = CreateBitmap(8, 8, 1, 1, BITS);
    HBRUSH brush = CreatePatternBrush(bitmap);

    if (made) {
        *made = bitmap;
    } else {
        DeleteObject(bitmap);
    }

    return brush;
}

static HBRUSH colourBrush(int size)
{
    HDC memory = CreateCompatibleDC(screen);
    HBITMAP bitmap = CreateCompatibleBitmap(screen, size, size);
    HBITMAP old = SelectObject(memory, bitmap);
    HBRUSH brush;
    int x;
    int y;

    for (y = 0; y < size; y++) {
        for (x = 0; x < size; x++) {
            SetPixel(memory, x, y, PALETTE[(x + 2 * y) % 16]);
        }
    }

    SelectObject(memory, old);
    DeleteDC(memory);
    brush = CreatePatternBrush(bitmap);
    DeleteObject(bitmap);

    return brush;
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HBRUSH brush;
    HBRUSH old;
    HBITMAP bitmap;
    LOGBRUSH logical;
    RECT rect;
    int size;

    probeOpen(OUTPUT);
    screen = GetDC(NULL);

    /* What the brush is. */
    brush = monoBrush(&bitmap);
    size = GetObject(brush, sizeof(logical), &logical);
    wsprintf(probeResult, "%d,style=%u,color=%08lx,bitmap=%s", size, logical.lbStyle,
             logical.lbColor, (LPSTR)(logical.lbHatch == (int)bitmap ? "same" : "other"));
    probe("brush", "mono", probeResult);
    DeleteObject(bitmap);
    DeleteObject(brush);

    /* A monochrome pattern: text and background colours at the time of the Blt. */
    begin();
    brush = monoBrush(NULL);
    SelectObject(dc, brush);
    SetTextColor(dc, RGB(255, 0, 0));
    SetBkColor(dc, RGB(0, 0, 255));
    PatBlt(dc, 0, 0, 16, 16, PATCOPY);
    end("mono");
    DeleteObject(brush);

    /* Colours set before the brush is selected, and changed after. */
    begin();
    brush = monoBrush(NULL);
    SetTextColor(dc, RGB(0, 128, 0));
    SetBkColor(dc, RGB(255, 255, 0));
    SelectObject(dc, brush);
    SetTextColor(dc, RGB(128, 0, 128));
    SetBkColor(dc, RGB(0, 255, 255));
    PatBlt(dc, 0, 0, 16, 16, PATCOPY);
    end("mono-later");
    DeleteObject(brush);

    /* A rectangle not at the origin: where the pattern starts. */
    begin();
    brush = monoBrush(NULL);
    SelectObject(dc, brush);
    SetTextColor(dc, RGB(0, 0, 0));
    SetBkColor(dc, RGB(255, 255, 255));
    PatBlt(dc, 3, 2, 10, 11, PATCOPY);
    end("offset");
    DeleteObject(brush);

    /* The brush origin, set and the brush selected again after UnrealizeObject. */
    begin();
    brush = monoBrush(NULL);
    SetTextColor(dc, RGB(0, 0, 0));
    SetBkColor(dc, RGB(255, 255, 255));
    SelectObject(dc, brush);
    SetBrushOrg(dc, 3, 1);
    PatBlt(dc, 0, 0, 16, 8, PATCOPY);
    SelectObject(dc, GetStockObject(WHITE_BRUSH));
    UnrealizeObject(brush);
    SelectObject(dc, brush);
    PatBlt(dc, 0, 8, 16, 8, PATCOPY);
    end("origin");
    DeleteObject(brush);

    /* The brush origin changed, and the brush selected again without
     * UnrealizeObject; then a new brush selected with the origin set. */
    begin();
    brush = monoBrush(NULL);
    SetTextColor(dc, RGB(0, 0, 0));
    SetBkColor(dc, RGB(255, 255, 255));
    SelectObject(dc, brush);
    SetBrushOrg(dc, 3, 1);
    SelectObject(dc, GetStockObject(WHITE_BRUSH));
    SelectObject(dc, brush);
    PatBlt(dc, 0, 0, 16, 8, PATCOPY);
    SelectObject(dc, GetStockObject(WHITE_BRUSH));
    DeleteObject(brush);
    brush = monoBrush(NULL);
    SelectObject(dc, brush);
    PatBlt(dc, 0, 8, 16, 8, PATCOPY);
    end("reselect");
    DeleteObject(brush);

    /* A colour pattern, 8 by 8, and 16 by 16 of which only a corner is kept. */
    begin();
    brush = colourBrush(8);
    SelectObject(dc, brush);
    PatBlt(dc, 0, 0, 16, 16, PATCOPY);
    end("colour");
    DeleteObject(brush);

    begin();
    brush = colourBrush(16);
    SelectObject(dc, brush);
    PatBlt(dc, 0, 0, 16, 16, PATCOPY);
    end("colour16");
    DeleteObject(brush);

    /* FillRect with it, and which brush the device context has after. */
    begin();
    brush = monoBrush(NULL);
    SetTextColor(dc, RGB(0, 0, 0));
    SetBkColor(dc, RGB(255, 255, 255));
    rect.left = 2;
    rect.top = 1;
    rect.right = 14;
    rect.bottom = 15;
    FillRect(dc, &rect, brush);
    old = SelectObject(dc, GetStockObject(BLACK_BRUSH));
    wsprintf(probeResult, "%s",
             (LPSTR)(old == brush                                ? "pattern"
                     : old == GetStockObject(WHITE_BRUSH) ? "white"
                                                                 : "other"));
    probe("brush", "after-fillrect", probeResult);
    end("fillrect");
    DeleteObject(brush);

    /* A source and the pattern together: the operation Sound Recorder greys
     * its pictures with, D and (P or S), over a picture of black and white. */
    begin();
    {
        HDC memory = CreateCompatibleDC(screen);
        HBITMAP picture = CreateCompatibleBitmap(screen, 16, 16);
        HBITMAP was = SelectObject(memory, picture);
        int x;
        int y;

        for (y = 0; y < 16; y++) {
            for (x = 0; x < 16; x++) {
                SetPixel(memory, x, y, (x / 4 + y / 4) % 2 ? RGB(0, 0, 0) : RGB(255, 255, 255));
            }
        }

        rect.left = 0;
        rect.top = 0;
        rect.right = 16;
        rect.bottom = 16;
        FillRect(dc, &rect, GetStockObject(LTGRAY_BRUSH));
        brush = monoBrush(NULL);
        SelectObject(dc, brush);
        SetTextColor(dc, RGB(0, 0, 0));
        SetBkColor(dc, RGB(255, 255, 255));
        BitBlt(dc, 0, 0, 16, 16, memory, 0, 0, 0xa803a9L);
        SelectObject(memory, was);
        DeleteObject(picture);
        DeleteDC(memory);
    }
    end("dspoa");
    DeleteObject(brush);

    ReleaseDC(NULL, screen);
    probeFinish();

    return 0;
}
