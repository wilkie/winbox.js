/*
 * A font's height and width under a mapping mode: what GDI realizes it at,
 * and what GetTextMetrics, GetCharWidth and GetTextExtent answer back.
 *
 * Each case selects a font into a memory device context holding a 128 by
 * 64 monochrome bitmap, sets the mapping, and records:
 *
 * * `metrics`: GetTextMetrics' height, ascent, descent, internal and
 *   external leading, average and greatest width, and overhang;
 * * `widths`: GetCharWidth of `A` to `D`;
 * * `extent`: GetTextExtent of "Hello", width and height;
 * * `face`: GetTextFace and tmPitchAndFamily;
 * * `drawn`: "H" drawn at the logical point that is device (4, 4), and the
 *   box of its black pixels in device terms, read in MM_TEXT: left, top,
 *   right, bottom (exclusive), or "none".
 *
 * The cases: Arial and MS Sans Serif at negative and positive heights in
 * MM_LOMETRIC (480 rows to 1560 units on the VGA); heights that map to
 * less than a pixel; a width; MM_ANISOTROPIC at three units to two pixels,
 * and with y running up; Arial at the pixel sizes the small heights come
 * to, in MM_TEXT; the System font, a stock font.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\FONTMAP.OUT"

static HDC dc;

/* The functions' names, prefixed `small-` for the heights that come to two
 * pixels or fewer. */
static const char *prefix = "";

static void record(LPCSTR function, LPCSTR name)
{
    char named[40];

    wsprintf(named, "%s%s", (LPSTR)prefix, function);
    probe(named, name, probeResult);
}

static void anisotropic(int wx, int wy, int vx, int vy)
{
    SetMapMode(dc, MM_ANISOTROPIC);
    SetWindowExt(dc, wx, wy);
    SetViewportExt(dc, vx, vy);
}

static void measure(LPCSTR name)
{
    TEXTMETRIC tm;
    int widths[4];
    DWORD extent;
    char face[LF_FACESIZE];

    GetTextMetrics(dc, &tm);
    GetTextFace(dc, sizeof(face), face);
    wsprintf(probeResult, "%s,%d", (LPSTR)face, tm.tmPitchAndFamily);
    record("face", name);

    wsprintf(probeResult, "%d,%d,%d,%d,%d,%d,%d,%d", tm.tmHeight, tm.tmAscent, tm.tmDescent,
             tm.tmInternalLeading, tm.tmExternalLeading, tm.tmAveCharWidth, tm.tmMaxCharWidth,
             tm.tmOverhang);
    record("metrics", name);

    widths[0] = widths[1] = widths[2] = widths[3] = -1;
    wsprintf(probeResult, "%d", GetCharWidth(dc, 'A', 'D', widths));
    wsprintf(probeResult + lstrlen(probeResult), " %d,%d,%d,%d", widths[0], widths[1], widths[2],
             widths[3]);
    record("widths", name);

    extent = GetTextExtent(dc, "Hello", 5);
    wsprintf(probeResult, "%u,%u", LOWORD(extent), HIWORD(extent));
    record("extent", name);
}

static void drawn(LPCSTR name, POINT at)
{
    int x;
    int y;
    int left = 999;
    int top = 999;
    int right = -1;
    int bottom = -1;

    TextOut(dc, at.x, at.y, "H", 1);
    SetMapMode(dc, MM_TEXT);

    for (y = 0; y < 64; y++) {
        for (x = 0; x < 128; x++) {
            if (GetPixel(dc, x, y) == RGB(0, 0, 0)) {
                if (x < left) left = x;
                if (y < top) top = y;
                if (x + 1 > right) right = x + 1;
                if (y + 1 > bottom) bottom = y + 1;
            }
        }
    }

    if (right < 0) {
        lstrcpy(probeResult, "none");
    } else {
        wsprintf(probeResult, "%d,%d,%d,%d", left, top, right, bottom);
    }

    record("drawn", name);
}

static void text(void)
{
    SetMapMode(dc, MM_TEXT);
}

static void lometric(void)
{
    SetMapMode(dc, MM_LOMETRIC);
}

static void three_to_two(void)
{
    anisotropic(3, 3, 2, 2);
}

static void three_to_two_up(void)
{
    anisotropic(3, 3, 2, -2);
}

static void one(LPCSTR name, LPCSTR face, int height, int width, void (*map)(void))
{
    HFONT font = CreateFont(height, width, 0, 0, FW_NORMAL, 0, 0, 0, ANSI_CHARSET,
                            OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY,
                            DEFAULT_PITCH | FF_DONTCARE, face);
    HFONT old = SelectObject(dc, font);
    POINT at;

    map();
    measure(name);

    SetMapMode(dc, MM_TEXT);
    PatBlt(dc, 0, 0, 128, 64, WHITENESS);
    map();
    at.x = 4;
    at.y = 4;
    DPtoLP(dc, &at, 1);
    drawn(name, at);

    SelectObject(dc, old);
    DeleteObject(font);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HDC screen;
    HBITMAP canvas;
    HBITMAP held;
    POINT at;

    probeOpen(OUTPUT);

    screen = GetDC(NULL);
    dc = CreateCompatibleDC(screen);
    canvas = CreateBitmap(128, 64, 1, 1, NULL);
    held = SelectObject(dc, canvas);
    SetTextColor(dc, RGB(0, 0, 0));
    SetBkColor(dc, RGB(255, 255, 255));

    probeNote("MM_LOMETRIC, 480 rows to 1560 units, 640 columns to 2080");
    one("Arial/-60", "Arial", -60, 0, lometric);
    one("Arial/60", "Arial", 60, 0, lometric);
    one("Arial/-100", "Arial", -100, 0, lometric);
    one("Arial/-60/30", "Arial", -60, 30, lometric);
    one("MS Sans Serif/-42", "MS Sans Serif", -42, 0, lometric);
    one("MS Sans Serif/42", "MS Sans Serif", 42, 0, lometric);
    one("MS Sans Serif/64", "MS Sans Serif", 64, 0, lometric);

    probeNote("MM_ANISOTROPIC, three units to two pixels");
    one("Arial/-25 3:2", "Arial", -25, 0, three_to_two);
    one("Arial/25 3:2", "Arial", 25, 0, three_to_two);
    one("Arial/-25 3:2 up", "Arial", -25, 0, three_to_two_up);
    one("Arial/-26/9 3:2", "Arial", -26, 9, three_to_two);
    one("MS Sans Serif/20 3:2", "MS Sans Serif", 20, 0, three_to_two);

    probeNote("heights that come to two pixels or fewer, in MM_LOMETRIC");
    prefix = "small-";
    one("Arial/-5", "Arial", -5, 0, lometric);
    one("Arial/5", "Arial", 5, 0, lometric);
    one("Arial/-1", "Arial", -1, 0, lometric);
    one("Arial/1", "Arial", 1, 0, lometric);
    probeNote("MM_TEXT, the pixel sizes the small heights come to");
    one("Arial/-3 text", "Arial", -3, 0, text);
    one("Arial/-2 text", "Arial", -2, 0, text);
    one("Arial/-1 text", "Arial", -1, 0, text);
    one("Arial/1 text", "Arial", 1, 0, text);
    one("Arial/2 text", "Arial", 2, 0, text);
    prefix = "";

    probeNote("the System font, a stock font, in MM_LOMETRIC");
    SelectObject(dc, GetStockObject(SYSTEM_FONT));
    lometric();
    measure("System");
    SetMapMode(dc, MM_TEXT);
    PatBlt(dc, 0, 0, 128, 64, WHITENESS);
    lometric();
    at.x = 4;
    at.y = 4;
    DPtoLP(dc, &at, 1);
    drawn("System", at);

    SelectObject(dc, held);
    DeleteDC(dc);
    DeleteObject(canvas);
    ReleaseDC(NULL, screen);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
