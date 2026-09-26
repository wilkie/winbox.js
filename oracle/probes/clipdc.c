/*
 * A device context's clip region, and saving and restoring a device context.
 *
 * All on a memory device context with a 16 by 16 colour bitmap:
 *
 * * `clip`: what each clipping call answers -- the region's kind, 0 error,
 *   1 empty, 2 a rectangle, 3 more -- and `GetClipBox`'s answer and box
 *   after it.
 * * `save`: what `SaveDC` and `RestoreDC` answer, and the text colour, the
 *   background colour, the stretch mode and the clip box after each.
 * * `rows`: the bitmap's rows, as the palette's digits, after drawing each
 *   way through a clip of a rectangle with a hole in it.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\CLIPDC.OUT"

static const char HEX[] = "0123456789abcdef";

static const COLORREF PALETTE[16] = {
    RGB(0, 0, 0),       RGB(128, 0, 0),     RGB(0, 128, 0),   RGB(128, 128, 0),
    RGB(0, 0, 128),     RGB(128, 0, 128),   RGB(0, 128, 128), RGB(192, 192, 192),
    RGB(128, 128, 128), RGB(255, 0, 0),     RGB(0, 255, 0),   RGB(255, 255, 0),
    RGB(0, 0, 255),     RGB(255, 0, 255),   RGB(0, 255, 255), RGB(255, 255, 255),
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

static HDC screen;
static HDC dc;
static HBITMAP target;
static HBITMAP oldTarget;
static char row[32];

static void box(LPCSTR name, int answer)
{
    RECT rect;
    int kind = GetClipBox(dc, &rect);

    wsprintf(probeResult, "%d,box=%d:%d,%d,%d,%d", answer, kind, rect.left, rect.top,
             rect.right, rect.bottom);
    probe("clip", name, probeResult);
}

static void begin(void)
{
    dc = CreateCompatibleDC(screen);
    target = CreateCompatibleBitmap(screen, 16, 16);
    oldTarget = SelectObject(dc, target);
    PatBlt(dc, 0, 0, 16, 16, WHITENESS);
}

static void holed(void)
{
    IntersectClipRect(dc, 2, 3, 12, 10);
    ExcludeClipRect(dc, 4, 5, 7, 7);
}

static void end(LPCSTR name)
{
    int x;
    int y;

    SelectClipRgn(dc, NULL);

    for (y = 0; y < 16; y++) {
        for (x = 0; x < 16; x++) {
            row[x] = digit(GetPixel(dc, x, y));
        }

        row[16] = '\0';
        wsprintf(probeArgs, "%s,y=%d", name, y);
        probe("rows", probeArgs, row);
    }

    SelectObject(dc, oldTarget);
    DeleteObject(target);
    DeleteDC(dc);
}

static void save(LPCSTR name, int answer)
{
    RECT rect;

    GetClipBox(dc, &rect);
    wsprintf(probeResult, "%d,text=%06lx,back=%06lx,stretch=%d,box=%d,%d,%d,%d", answer,
             GetTextColor(dc), GetBkColor(dc), GetStretchBltMode(dc), rect.left, rect.top,
             rect.right, rect.bottom);
    probe("save", name, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HRGN region;
    HBITMAP other;
    HDC source;
    HBITMAP picture;
    HBITMAP was;
    RECT rect;
    int answer;

    probeOpen(OUTPUT);
    screen = GetDC(NULL);

    /* The clip calls. */
    dc = CreateCompatibleDC(screen);
    box("new", 0);
    target = CreateCompatibleBitmap(screen, 16, 16);
    oldTarget = SelectObject(dc, target);
    box("selected", 0);
    box("intersect", IntersectClipRect(dc, 2, 3, 12, 10));
    box("intersect-again", IntersectClipRect(dc, 0, 0, 8, 16));
    box("exclude", ExcludeClipRect(dc, 4, 5, 6, 7));
    box("exclude-edge", ExcludeClipRect(dc, 0, 0, 16, 4));
    box("intersect-outside", IntersectClipRect(dc, 20, 20, 30, 30));
    box("select-null", SelectClipRgn(dc, NULL));
    box("intersect-reversed", IntersectClipRect(dc, 12, 10, 2, 3));
    SelectClipRgn(dc, NULL);
    region = CreateRectRgn(1, 2, 9, 11);
    box("select-region", SelectClipRgn(dc, region));
    SetRectRgn(region, 0, 0, 3, 3);
    box("region-changed", 0);
    DeleteObject(region);
    box("region-deleted", 0);
    IntersectClipRect(dc, 3, 3, 5, 5);
    other = CreateCompatibleBitmap(screen, 20, 20);
    SelectObject(dc, other);
    box("bitmap-changed", 0);
    SelectObject(dc, target);
    DeleteObject(other);
    box("offset", OffsetClipRgn(dc, 2, 1));
    SelectObject(dc, oldTarget);
    DeleteObject(target);
    DeleteDC(dc);

    /* Saving and restoring. */
    begin();
    SetTextColor(dc, RGB(255, 0, 0));
    SetBkColor(dc, RGB(0, 0, 255));
    SetStretchBltMode(dc, COLORONCOLOR);
    save("before", 0);
    answer = SaveDC(dc);
    SetTextColor(dc, RGB(0, 255, 0));
    SetBkColor(dc, RGB(255, 255, 0));
    SetStretchBltMode(dc, WHITEONBLACK);
    IntersectClipRect(dc, 1, 1, 5, 5);
    save("saved", answer);
    answer = SaveDC(dc);
    SetTextColor(dc, RGB(0, 0, 0));
    IntersectClipRect(dc, 2, 2, 4, 4);
    save("saved-again", answer);
    answer = SaveDC(dc);
    save("saved-third", answer);
    save("restore-minus-one", RestoreDC(dc, -1));
    save("restore-one", RestoreDC(dc, 1));
    save("restore-empty", RestoreDC(dc, -1));
    save("save-after", SaveDC(dc));
    save("restore-five", RestoreDC(dc, 5));
    save("restore-zero", RestoreDC(dc, 0));
    save("restore-minus-two", RestoreDC(dc, -2));
    save("restore-two", RestoreDC(dc, 2));
    save("restore-minus-one-after-zero", RestoreDC(dc, -1));
    save("save-1", SaveDC(dc));
    save("save-2", SaveDC(dc));
    SetTextColor(dc, RGB(0, 128, 0));
    save("restore-2-of-2", RestoreDC(dc, 2));
    save("restore-minus-one-last", RestoreDC(dc, -1));
    save("save-a", SaveDC(dc));
    save("save-b", SaveDC(dc));
    save("save-c", SaveDC(dc));
    save("restore-minus-two-of-3", RestoreDC(dc, -2));
    save("restore-minus-one-then", RestoreDC(dc, -1));
    save("restore-minus-one-empty", RestoreDC(dc, -1));
    save("save-x", SaveDC(dc));
    SetTextColor(dc, RGB(0, 128, 0));
    save("save-y", SaveDC(dc));
    SetTextColor(dc, RGB(128, 0, 0));
    save("restore-zero-of-2", RestoreDC(dc, 0));
    save("restore-minus-one-after", RestoreDC(dc, -1));
    save("restore-minus-one-after-2", RestoreDC(dc, -1));
    end("save");

    /* Drawing through the holed clip. */
    begin();
    holed();
    PatBlt(dc, 0, 0, 16, 16, BLACKNESS);
    end("patblt");

    begin();
    holed();
    rect.left = 0;
    rect.top = 0;
    rect.right = 16;
    rect.bottom = 16;
    FillRect(dc, &rect, GetStockObject(BLACK_BRUSH));
    end("fillrect");

    begin();
    holed();
    SelectObject(dc, GetStockObject(GRAY_BRUSH));
    Rectangle(dc, 0, 1, 15, 14);
    SelectObject(dc, GetStockObject(WHITE_BRUSH));
    MoveTo(dc, 0, 15);
    LineTo(dc, 16, 0);
    end("lines");

    begin();
    holed();
    SetBkColor(dc, RGB(255, 255, 0));
    SetTextColor(dc, RGB(0, 0, 255));
    TextOut(dc, 0, 0, "WM", 2);
    end("text");

    begin();
    holed();
    {
        int x;
        int y;

        for (y = 0; y < 16; y++) {
            for (x = 0; x < 16; x++) {
                SetPixel(dc, x, y, RGB(255, 0, 0));
            }
        }
    }
    end("setpixel");

    begin();
    source = CreateCompatibleDC(screen);
    picture = CreateCompatibleBitmap(screen, 8, 8);
    was = SelectObject(source, picture);
    PatBlt(source, 0, 0, 8, 8, BLACKNESS);
    holed();
    BitBlt(dc, 0, 0, 16, 16, source, 0, 0, SRCCOPY);
    SetStretchBltMode(dc, COLORONCOLOR);
    StretchBlt(dc, 6, 6, 8, 8, source, 0, 0, 4, 4, SRCCOPY);
    SelectObject(source, was);
    DeleteObject(picture);
    DeleteDC(source);
    end("blt");

    ReleaseDC(NULL, screen);
    probeFinish();

    return 0;
}
