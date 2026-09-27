/*
 * Regions: made, combined, asked about and painted.
 *
 * * `combine`: CombineRgn's answer for two rectangles' regions and a mode,
 *   then GetRgnBox's answer and box, then the region's pixels.
 * * `shape`: a region made by CreateEllipticRgn, CreateRoundRectRgn or
 *   CreatePolygonRgn: GetRgnBox's answer and box, then its pixels.
 * * `polypolygon`: the same for CreatePolyPolygonRgn.
 * * `point`, `rect`, `equal`, `offset`, `set`: PtInRegion, RectInRegion,
 *   EqualRgn, OffsetRgn and SetRectRgn's answers.
 * * `paint`: FillRgn, FrameRgn, InvertRgn and PaintRgn's answers and the
 *   pixels they leave.
 *
 * The pixels are a 64 by 64 monochrome bitmap, white, with the region
 * filled black -- or painted as the record says -- as GetBitmapBits hands
 * them back: 8 bytes a row, in hex.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\REGIONS.OUT"

static HDC memory;
static HBITMAP bitmap;
static char bits[520];

static void clear(void)
{
    PatBlt(memory, 0, 0, 64, 64, WHITENESS);
}

static LPSTR pixels(void)
{
    static char hex[1100];
    int i;

    GetBitmapBits(bitmap, 512, bits);

    for (i = 0; i < 512; i++) {
        wsprintf(hex + i * 2, "%02x", (BYTE)bits[i]);
    }

    return hex;
}

static void describe(HRGN region, int answer)
{
    RECT box;
    int boxAnswer;

    SetRect(&box, -1, -1, -1, -1);
    boxAnswer = GetRgnBox(region, &box);
    clear();
    FillRgn(memory, region, GetStockObject(BLACK_BRUSH));
    wsprintf(probeResult, "%d/%d:%d,%d,%d,%d/", answer, boxAnswer, box.left, box.top, box.right,
             box.bottom);
    lstrcat(probeResult, pixels());
}

static void combine(LPCSTR what, const RECT *one, const RECT *two, int mode)
{
    HRGN a = CreateRectRgnIndirect(one);
    HRGN b = CreateRectRgnIndirect(two);
    HRGN out = CreateRectRgn(0, 0, 0, 0);
    int answer = CombineRgn(out, a, b, mode);

    describe(out, answer);
    probe("combine", what, probeResult);
    DeleteObject(a);
    DeleteObject(b);
    DeleteObject(out);
}

static void shape(LPCSTR what, HRGN region)
{
    describe(region, region ? 1 : 0);
    probe("shape", what, probeResult);
    DeleteObject(region);
}

/* Apart from `shape`: what GDI makes of several polygons is its own. */
static void polys(LPCSTR what, HRGN region)
{
    describe(region, region ? 1 : 0);
    probe("polypolygon", what, probeResult);
    DeleteObject(region);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static const RECT a = { 4, 4, 24, 24 };
    static const RECT b = { 14, 14, 34, 34 };
    static const RECT c = { 40, 40, 50, 50 };
    static const RECT e = { 5, 5, 5, 5 };
    static const RECT inside = { 6, 6, 10, 10 };
    static const RECT beside = { 4, 24, 24, 30 };
    static const char *modes[] = { "", "and", "or", "xor", "diff", "copy" };
    static const POINT triangle[] = { { 2, 2 }, { 40, 10 }, { 10, 40 } };
    static const POINT star[] = { { 30, 2 }, { 40, 50 }, { 2, 18 }, { 58, 18 }, { 20, 50 } };
    static const POINT two[] = { { 2, 2 }, { 20, 2 }, { 20, 20 }, { 30, 30 }, { 50, 30 }, { 40, 50 } };
    static const int counts[] = { 3, 3 };
    char what[40];
    HDC screen;
    HRGN r;
    HRGN s;
    RECT box;
    int mode;

    probeOpen(OUTPUT);

    screen = GetDC(NULL);
    memory = CreateCompatibleDC(screen);
    ReleaseDC(NULL, screen);
    bitmap = CreateBitmap(64, 64, 1, 1, NULL);
    SelectObject(memory, bitmap);

    for (mode = RGN_AND; mode <= RGN_COPY; mode++) {
        wsprintf(what, "overlapping %s", (LPSTR)modes[mode]);
        combine(what, &a, &b, mode);
        wsprintf(what, "apart %s", (LPSTR)modes[mode]);
        combine(what, &a, &c, mode);
        wsprintf(what, "same %s", (LPSTR)modes[mode]);
        combine(what, &a, &a, mode);
        wsprintf(what, "empty %s", (LPSTR)modes[mode]);
        combine(what, &a, &e, mode);
        wsprintf(what, "inside %s", (LPSTR)modes[mode]);
        combine(what, &a, &inside, mode);
        wsprintf(what, "touching %s", (LPSTR)modes[mode]);
        combine(what, &a, &beside, mode);
    }

    combine("empty empty or", &e, &e, RGN_OR);
    combine("mode 0", &a, &b, 0);
    combine("mode 6", &a, &b, 6);

    shape("rect", CreateRectRgn(4, 4, 24, 24));
    shape("rect inverted", CreateRectRgn(24, 24, 4, 4));
    shape("ellipse 0,0,20,14", CreateEllipticRgn(0, 0, 20, 14));
    shape("ellipse 3,5,40,41", CreateEllipticRgn(3, 5, 40, 41));
    shape("ellipse 10,10,11,11", CreateEllipticRgn(10, 10, 11, 11));
    shape("ellipse 10,10,12,12", CreateEllipticRgn(10, 10, 12, 12));
    shape("ellipse 5,5,9,20", CreateEllipticRgn(5, 5, 9, 20));
    shape("ellipse inverted", CreateEllipticRgn(40, 41, 3, 5));
    shape("roundrect 2,2,50,40,12,10", CreateRoundRectRgn(2, 2, 50, 40, 12, 10));
    shape("roundrect 2,2,50,40,0,0", CreateRoundRectRgn(2, 2, 50, 40, 0, 0));
    shape("roundrect 2,2,30,30,40,40", CreateRoundRectRgn(2, 2, 30, 30, 40, 40));
    shape("polygon triangle alternate", CreatePolygonRgn(triangle, 3, ALTERNATE));
    shape("polygon star alternate", CreatePolygonRgn(star, 5, ALTERNATE));
    shape("polygon star winding", CreatePolygonRgn(star, 5, WINDING));
    polys("two", CreatePolyPolygonRgn(two, counts, 2, ALTERNATE));
    {
        static const POINT apart[] = { { 2, 2 }, { 20, 2 }, { 10, 20 }, { 30, 30 }, { 50, 30 }, { 40, 50 } };
        static const POINT squares[] = { { 2, 2 }, { 20, 2 }, { 20, 20 }, { 2, 20 },
                                         { 30, 30 }, { 50, 30 }, { 50, 50 }, { 30, 50 } };
        static const POINT threes[] = { { 2, 2 }, { 20, 2 }, { 10, 20 }, { 30, 2 }, { 50, 2 },
                                        { 40, 20 }, { 2, 30 }, { 20, 30 }, { 10, 50 } };
        static const int one[] = { 3 };
        static const int fours[] = { 4, 4 };
        static const int three[] = { 3, 3, 3 };

        polys("one", CreatePolyPolygonRgn(apart, one, 1, ALTERNATE));
        polys("apart", CreatePolyPolygonRgn(apart, counts, 2, ALTERNATE));
        polys("apart winding", CreatePolyPolygonRgn(apart, counts, 2, WINDING));
        polys("squares", CreatePolyPolygonRgn(squares, fours, 2, ALTERNATE));
        polys("three", CreatePolyPolygonRgn(threes, three, 3, ALTERNATE));
        shape("polygon two points", CreatePolygonRgn(apart, 2, ALTERNATE));
        shape("polygon one point", CreatePolygonRgn(apart, 1, ALTERNATE));
    }

    r = CreateRectRgn(4, 4, 24, 24);
    s = CreateRectRgn(14, 14, 34, 34);
    CombineRgn(r, r, s, RGN_OR);

    wsprintf(probeResult, "%d,%d,%d,%d,%d,%d,%d,%d", PtInRegion(r, 4, 4), PtInRegion(r, 23, 23),
             PtInRegion(r, 24, 4), PtInRegion(r, 24, 14), PtInRegion(r, 33, 33),
             PtInRegion(r, 34, 34), PtInRegion(r, 30, 5), PtInRegion(r, -1, -1));
    probe("point", "corners and edges", probeResult);

    SetRect(&box, 0, 0, 5, 5);
    wsprintf(what, "%d,", RectInRegion(r, &box));
    SetRect(&box, 24, 4, 30, 10);
    wsprintf(what + lstrlen(what), "%d,", RectInRegion(r, &box));
    SetRect(&box, 23, 23, 24, 24);
    wsprintf(what + lstrlen(what), "%d,", RectInRegion(r, &box));
    SetRect(&box, 40, 40, 30, 30);
    wsprintf(what + lstrlen(what), "%d", RectInRegion(r, &box));
    probe("rect", "some", what);

    {
        HRGN t = CreateRectRgn(4, 4, 24, 24);
        HRGN u = CreateRectRgn(14, 14, 34, 34);
        HRGN v = CreateRectRgn(0, 0, 0, 0);

        CombineRgn(v, t, u, RGN_OR);
        wsprintf(probeResult, "%d,%d,%d", EqualRgn(r, v), EqualRgn(r, t), EqualRgn(t, t));
        probe("equal", "same, different, itself", probeResult);
        DeleteObject(t);
        DeleteObject(u);
        DeleteObject(v);
    }

    wsprintf(probeResult, "%d", OffsetRgn(r, 3, -2));
    GetRgnBox(r, &box);
    wsprintf(probeResult + lstrlen(probeResult), ":%d,%d,%d,%d", box.left, box.top, box.right,
             box.bottom);
    probe("offset", "3,-2", probeResult);

    SetRectRgn(r, 1, 2, 3, 4);
    wsprintf(probeResult, "%d", GetRgnBox(r, &box));
    wsprintf(probeResult + lstrlen(probeResult), ":%d,%d,%d,%d", box.left, box.top, box.right,
             box.bottom);
    probe("set", "1,2,3,4", probeResult);
    SetRectRgn(r, 5, 5, 5, 9);
    wsprintf(probeResult, "%d", GetRgnBox(r, &box));
    wsprintf(probeResult + lstrlen(probeResult), ":%d,%d,%d,%d", box.left, box.top, box.right,
             box.bottom);
    probe("set", "empty", probeResult);

    SetRectRgn(r, 4, 4, 24, 24);
    CombineRgn(r, r, s, RGN_XOR);

    clear();
    wsprintf(probeResult, "%d/", FrameRgn(memory, r, GetStockObject(BLACK_BRUSH), 2, 1));
    lstrcat(probeResult, pixels());
    probe("paint", "frame 2,1", probeResult);

    clear();
    wsprintf(probeResult, "%d/", FrameRgn(memory, r, GetStockObject(BLACK_BRUSH), 1, 3));
    lstrcat(probeResult, pixels());
    probe("paint", "frame 1,3", probeResult);

    clear();
    wsprintf(probeResult, "%d/", InvertRgn(memory, r));
    lstrcat(probeResult, pixels());
    probe("paint", "invert", probeResult);

    clear();
    SelectObject(memory, GetStockObject(BLACK_BRUSH));
    wsprintf(probeResult, "%d/", PaintRgn(memory, r));
    lstrcat(probeResult, pixels());
    probe("paint", "paint", probeResult);

    clear();
    wsprintf(probeResult, "%d/", FillRgn(memory, r, GetStockObject(GRAY_BRUSH)));
    lstrcat(probeResult, pixels());
    probe("paint", "fill gray", probeResult);

    DeleteObject(r);
    DeleteObject(s);
    DeleteDC(memory);
    DeleteObject(bitmap);
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
