/*
 * Ellipses and rounded rectangles, pixel for pixel.
 *
 * Calculator draws its buttons with `RoundRect`; `Ellipse` draws the same
 * curve whole. Each shape here is drawn in its own place on the screen, over
 * white, with a black pen one pixel wide and a light grey brush unless the
 * list says otherwise, and every pixel of the area is read back:
 *
 * * `shape`: what each shape was -- its function, rectangle, corner and pen.
 * * `area`, `screen`: the area, a row a record, a palette digit a pixel, as
 *   `chrome` writes them.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\CURVES.OUT"

#define WIDTH  240
#define HEIGHT 136

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

/* kind: 0 ellipse, 1 round rectangle; pen: 1 one-pixel, 3 three-pixel, 0 none; brush: 1 grey, 0 none. */
struct Shape {
    int kind;
    int left, top, right, bottom;
    int cornerWidth, cornerHeight;
    int pen;
    int brush;
};

static const struct Shape SHAPES[] = {
    { 0, 4, 4, 5, 5, 0, 0, 1, 1 },          { 0, 10, 4, 12, 6, 0, 0, 1, 1 },
    { 0, 16, 4, 19, 7, 0, 0, 1, 1 },        { 0, 24, 4, 28, 8, 0, 0, 1, 1 },
    { 0, 32, 4, 37, 9, 0, 0, 1, 1 },        { 0, 42, 4, 48, 10, 0, 0, 1, 1 },
    { 0, 52, 4, 59, 11, 0, 0, 1, 1 },       { 0, 64, 4, 72, 12, 0, 0, 1, 1 },
    { 0, 4, 16, 44, 40, 0, 0, 1, 1 },       { 0, 50, 16, 77, 49, 0, 0, 1, 1 },
    { 0, 84, 16, 114, 36, 0, 0, 0, 1 },     { 0, 120, 16, 150, 40, 0, 0, 3, 1 },
    { 0, 156, 16, 186, 40, 0, 0, 1, 0 },    { 0, 192, 16, 228, 18, 0, 0, 1, 1 },
    { 1, 4, 56, 40, 76, 8, 8, 1, 1 },       { 1, 46, 56, 86, 80, 12, 6, 1, 1 },
    { 1, 92, 56, 122, 86, 30, 30, 1, 1 },   { 1, 128, 56, 168, 74, 4, 4, 1, 1 },
    { 1, 174, 56, 214, 86, 0, 0, 1, 1 },    { 1, 4, 92, 44, 122, 7, 9, 1, 1 },
    { 1, 50, 92, 80, 112, 10, 10, 0, 1 },   { 1, 86, 92, 106, 102, 40, 40, 1, 1 },
    { 1, 112, 92, 152, 122, 16, 16, 3, 1 }, { 1, 158, 92, 198, 122, 16, 16, 1, 0 },
    { 1, 204, 92, 236, 110, 5, 5, 1, 1 },
};

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HDC screen;
    HPEN thin = CreatePen(PS_SOLID, 1, RGB(0, 0, 0));
    HPEN thick = CreatePen(PS_SOLID, 3, RGB(0, 0, 0));
    int index;
    int x;
    int y;

    probeOpen(OUTPUT);
    ShowCursor(FALSE);
    SetCursorPos(GetSystemMetrics(SM_CXSCREEN) - 1, GetSystemMetrics(SM_CYSCREEN) - 1);

    screen = GetDC(NULL);
    PatBlt(screen, 0, 0, WIDTH, HEIGHT, WHITENESS);

    for (index = 0; index < sizeof(SHAPES) / sizeof(SHAPES[0]); index++) {
        const struct Shape *s = &SHAPES[index];
        HPEN oldPen = SelectObject(screen, s->pen == 3 ? thick
                                          : s->pen == 1 ? thin
                                                        : GetStockObject(NULL_PEN));
        HBRUSH oldBrush = SelectObject(screen, GetStockObject(s->brush ? LTGRAY_BRUSH : NULL_BRUSH));

        if (s->kind == 0) {
            Ellipse(screen, s->left, s->top, s->right, s->bottom);
        } else {
            RoundRect(screen, s->left, s->top, s->right, s->bottom, s->cornerWidth,
                      s->cornerHeight);
        }

        SelectObject(screen, oldPen);
        SelectObject(screen, oldBrush);

        wsprintf(probeArgs, "%d", index);
        wsprintf(probeResult, "%s,%d:%d:%d:%d,corner=%d:%d,pen=%d,brush=%d",
                 (LPSTR)(s->kind ? "roundrect" : "ellipse"), s->left, s->top, s->right,
                 s->bottom, s->cornerWidth, s->cornerHeight, s->pen, s->brush);
        probe("shape", probeArgs, probeResult);
    }

    wsprintf(probeResult, "0:0:%d:%d", WIDTH, HEIGHT);
    probe("area", "curves", probeResult);

    for (y = 0; y < HEIGHT; y++) {
        LPSTR at = probeResult;

        for (x = 0; x < WIDTH; x++) {
            *at++ = digit(GetPixel(screen, x, y));
        }

        *at = '\0';
        wsprintf(probeArgs, "curves,y=%d", y);
        probe("screen", probeArgs, probeResult);
    }

    ReleaseDC(NULL, screen);
    DeleteObject(thin);
    DeleteObject(thick);
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
