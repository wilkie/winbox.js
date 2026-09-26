/*
 * Mapping modes: logical coordinates turned into the device's.
 *
 * * `mode`: for each mapping mode, what `SetMapMode` answered, and then
 *   `GetMapMode`, the window and viewport origins and extents.
 * * `set`: what each origin and extent call answers, and the extents after,
 *   in the modes where they differ -- `MM_ISOTROPIC` makes the viewport fit.
 * * `point`: `LPtoDP` of points under a window extent of 3 to a viewport's 2,
 *   7 to -3, and an origin moved, and `DPtoLP` back.
 * * `rows`: a 16 by 16 bitmap, as the palette's digits, after drawing under an
 *   origin moved and under a scale.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\MAPMODE.OUT"

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
static char text[128];

static void begin(void)
{
    dc = CreateCompatibleDC(screen);
    target = CreateCompatibleBitmap(screen, 16, 16);
    oldTarget = SelectObject(dc, target);
    PatBlt(dc, 0, 0, 16, 16, WHITENESS);
}

static void end(LPCSTR name)
{
    int x;
    int y;

    SetMapMode(dc, MM_TEXT);
    SetWindowOrg(dc, 0, 0);
    SetViewportOrg(dc, 0, 0);

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

static void state(LPSTR out)
{
    DWORD wo = GetWindowOrg(dc);
    DWORD we = GetWindowExt(dc);
    DWORD vo = GetViewportOrg(dc);
    DWORD ve = GetViewportExt(dc);

    wsprintf(out, "map=%d,wo=%d:%d,we=%d:%d,vo=%d:%d,ve=%d:%d", GetMapMode(dc), (int)LOWORD(wo),
             (int)HIWORD(wo), (int)LOWORD(we), (int)HIWORD(we), (int)LOWORD(vo), (int)HIWORD(vo),
             (int)LOWORD(ve), (int)HIWORD(ve));
}

static void setting(LPCSTR name, DWORD answer)
{
    state(text);
    wsprintf(probeResult, "%d:%d,%s", (int)LOWORD(answer), (int)HIWORD(answer), (LPSTR)text);
    probe("set", name, probeResult);
}

static void points(LPCSTR name)
{
    POINT p[1];
    int x;

    for (x = -7; x <= 7; x++) {
        p[0].x = x;
        p[0].y = x;
        LPtoDP(dc, p, 1);
        wsprintf(probeArgs, "%s,lp=%d", name, x);
        wsprintf(probeResult, "%d,%d", p[0].x, p[0].y);
        probe("point", probeArgs, probeResult);

        p[0].x = x;
        p[0].y = x;
        DPtoLP(dc, p, 1);
        wsprintf(probeArgs, "%s,dp=%d", name, x);
        wsprintf(probeResult, "%d,%d", p[0].x, p[0].y);
        probe("point", probeArgs, probeResult);
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HDC source;
    HBITMAP picture;
    HBITMAP was;
    int mode;
    int answer;

    probeOpen(OUTPUT);
    screen = GetDC(NULL);

    /* Each mode's origins and extents. */
    dc = CreateCompatibleDC(screen);
    state(text);
    probe("mode", "new", text);

    for (mode = 1; mode <= 8; mode++) {
        answer = SetMapMode(dc, mode);
        state(text);
        wsprintf(probeResult, "%d,%s", answer, (LPSTR)text);
        wsprintf(probeArgs, "set=%d", mode);
        probe("mode", probeArgs, probeResult);
    }

    answer = SetMapMode(dc, 9);
    state(text);
    wsprintf(probeResult, "%d,%s", answer, (LPSTR)text);
    probe("mode", "set=9", probeResult);
    answer = SetMapMode(dc, 0);
    state(text);
    wsprintf(probeResult, "%d,%s", answer, (LPSTR)text);
    probe("mode", "set=0", probeResult);

    /* The origin and extent calls. */
    SetMapMode(dc, MM_TEXT);
    setting("text-window-org", SetWindowOrg(dc, 5, 7));
    setting("text-viewport-org", SetViewportOrg(dc, -2, 3));
    setting("text-window-ext", SetWindowExt(dc, 10, 20));
    setting("text-viewport-ext", SetViewportExt(dc, 30, 40));
    setting("text-offset-window", OffsetWindowOrg(dc, 1, 1));
    setting("text-offset-viewport", OffsetViewportOrg(dc, 1, 1));
    SetMapMode(dc, MM_ANISOTROPIC);
    setting("aniso", 0);
    setting("aniso-window-ext", SetWindowExt(dc, 10, 20));
    setting("aniso-viewport-ext", SetViewportExt(dc, 30, -40));
    setting("aniso-window-ext-zero", SetWindowExt(dc, 0, 5));
    setting("aniso-scale-window", ScaleWindowExt(dc, 2, 3, 1, 2));
    setting("aniso-scale-viewport", ScaleViewportExt(dc, 3, 2, 5, 4));
    SetMapMode(dc, MM_ISOTROPIC);
    setting("iso", 0);
    setting("iso-window-ext", SetWindowExt(dc, 100, 100));
    setting("iso-viewport-ext", SetViewportExt(dc, 50, 80));
    setting("iso-viewport-ext-neg", SetViewportExt(dc, 60, -30));
    setting("iso-window-ext-2", SetWindowExt(dc, 30, 10));
    SetMapMode(dc, MM_LOENGLISH);
    setting("loenglish-window-ext", SetWindowExt(dc, 10, 20));
    setting("loenglish-window-org", SetWindowOrg(dc, 10, 20));
    DeleteDC(dc);

    /* Points. */
    dc = CreateCompatibleDC(screen);
    SetMapMode(dc, MM_ANISOTROPIC);
    SetWindowExt(dc, 3, 3);
    SetViewportExt(dc, 2, 2);
    points("3to2");
    SetWindowExt(dc, 7, 7);
    SetViewportExt(dc, 3, -3);
    points("7to-3");
    SetWindowExt(dc, 2, 2);
    SetViewportExt(dc, 5, 5);
    SetWindowOrg(dc, 1, -2);
    SetViewportOrg(dc, 3, 4);
    points("2to5-moved");
    SetMapMode(dc, MM_LOMETRIC);
    points("lometric");
    SetMapMode(dc, MM_TEXT);
    SetWindowOrg(dc, 3, -1);
    SetViewportOrg(dc, 2, 2);
    points("text-moved");
    DeleteDC(dc);

    /* Drawing with the origin moved, as a program scrolls. */
    begin();
    SetWindowOrg(dc, 3, 2);
    PatBlt(dc, 3, 2, 4, 3, BLACKNESS);
    SelectObject(dc, GetStockObject(GRAY_BRUSH));
    Rectangle(dc, 8, 6, 14, 12);
    MoveTo(dc, 3, 15);
    LineTo(dc, 17, 8);
    end("window-org");

    begin();
    source = CreateCompatibleDC(screen);
    picture = CreateCompatibleBitmap(screen, 8, 8);
    was = SelectObject(source, picture);
    PatBlt(source, 0, 0, 8, 8, BLACKNESS);
    PatBlt(source, 2, 2, 4, 4, WHITENESS);
    SetWindowOrg(source, 1, 1);
    SetViewportOrg(dc, 4, 3);
    BitBlt(dc, 0, 0, 6, 6, source, 1, 1, SRCCOPY);
    end("viewport-org-blt");

    /* Drawing under a scale of two thirds. */
    begin();
    SetMapMode(dc, MM_ANISOTROPIC);
    SetWindowExt(dc, 3, 3);
    SetViewportExt(dc, 2, 2);
    PatBlt(dc, 1, 1, 5, 4, BLACKNESS);
    SelectObject(dc, GetStockObject(GRAY_BRUSH));
    Rectangle(dc, 7, 2, 20, 14);
    MoveTo(dc, 0, 23);
    LineTo(dc, 23, 11);
    end("scale");

    begin();
    SetMapMode(dc, MM_ANISOTROPIC);
    SetWindowExt(dc, 1, 1);
    SetViewportExt(dc, 3, 2);
    SetStretchBltMode(dc, COLORONCOLOR);
    BitBlt(dc, 0, 0, 4, 4, source, 1, 1, SRCCOPY);
    end("scale-blt");

    /* Lines whose every other step is a tie, through a mapping: the origin
     * moved with the line inside the bitmap in both terms; moved so that the
     * logical line is off it; and a scale. */
    begin();
    SetWindowOrg(dc, -1, -1);
    MoveTo(dc, 1, 12);
    LineTo(dc, 13, 6);
    end("tie-inside");

    begin();
    SetWindowOrg(dc, 5, 0);
    MoveTo(dc, 6, 12);
    LineTo(dc, 18, 6);
    end("tie-logical-outside");

    begin();
    SetMapMode(dc, MM_ANISOTROPIC);
    SetViewportExt(dc, 2, 1);
    MoveTo(dc, 0, 12);
    LineTo(dc, 6, 6);
    end("tie-scaled");

    SelectObject(source, was);
    DeleteObject(picture);
    DeleteDC(source);

    ReleaseDC(NULL, screen);
    probeFinish();

    return 0;
}
