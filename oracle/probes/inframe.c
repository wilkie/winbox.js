/*
 * A pen of PS_INSIDEFRAME wider than a pixel around the shapes with a
 * bounding rectangle -- Ellipse, RoundRect, Pie and Chord, and Rectangle
 * beside them -- pixel for pixel, as `widepoly` records it for Rectangle.
 * And the same pen in a colour the display lacks, which Windows describes
 * as drawn patterned where any other pen is drawn in one colour.
 *
 * Each shape is drawn in a cell of its own, 32 by 32, on the screen over
 * white, with a light grey brush, and the cell is read back:
 *
 * * `shape`: the case, what it was -- its function, rectangle in the cell,
 *   the corner or the radials' two points, the pen's style, width and
 *   colour.
 * * `ellipse`, `roundrect`, `pie`, `chord`, `rectangle`: the case and the
 *   row; the row, a palette digit a pixel.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\INFRAME.OUT"

#define CELL 32
#define ACROSS 7

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

/* kind: 0 ellipse, 1 roundrect, 2 pie, 3 chord, 4 rectangle; a, b, c, d the
 * corner or the radials; style PS_INSIDEFRAME or PS_SOLID; colour 0 black,
 * 1 purple, `804000c0`'s lack of a colour of its own. */
struct Shape {
    int kind;
    int left, top, right, bottom;
    int a, b, c, d;
    int style;
    int width;
    int colour;
};

static const struct Shape SHAPES[] = {
    {0, 2, 2, 30, 30, 0, 0, 0, 0, PS_INSIDEFRAME, 2, 0},
    {0, 2, 2, 30, 30, 0, 0, 0, 0, PS_INSIDEFRAME, 3, 0},
    {0, 2, 2, 30, 30, 0, 0, 0, 0, PS_INSIDEFRAME, 4, 0},
    {0, 2, 2, 30, 30, 0, 0, 0, 0, PS_INSIDEFRAME, 5, 0},
    {0, 2, 2, 30, 30, 0, 0, 0, 0, PS_INSIDEFRAME, 7, 0},
    {0, 1, 6, 30, 23, 0, 0, 0, 0, PS_INSIDEFRAME, 3, 0},
    {0, 1, 6, 30, 23, 0, 0, 0, 0, PS_INSIDEFRAME, 4, 0},
    {1, 2, 2, 30, 30, 12, 12, 0, 0, PS_INSIDEFRAME, 2, 0},
    {1, 2, 2, 30, 30, 12, 12, 0, 0, PS_INSIDEFRAME, 3, 0},
    {1, 2, 2, 30, 30, 12, 12, 0, 0, PS_INSIDEFRAME, 4, 0},
    {1, 2, 2, 30, 30, 12, 12, 0, 0, PS_INSIDEFRAME, 5, 0},
    {1, 1, 6, 30, 23, 20, 8, 0, 0, PS_INSIDEFRAME, 4, 0},
    {2, 2, 2, 30, 30, 30, 16, 16, 2, PS_INSIDEFRAME, 2, 0},
    {2, 2, 2, 30, 30, 30, 16, 16, 2, PS_INSIDEFRAME, 3, 0},
    {2, 2, 2, 30, 30, 30, 16, 16, 2, PS_INSIDEFRAME, 5, 0},
    {2, 2, 2, 30, 30, 16, 2, 30, 16, PS_INSIDEFRAME, 4, 0},
    {3, 2, 2, 30, 30, 2, 16, 30, 16, PS_INSIDEFRAME, 3, 0},
    {3, 2, 2, 30, 30, 2, 16, 30, 16, PS_INSIDEFRAME, 4, 0},
    {4, 2, 2, 30, 30, 0, 0, 0, 0, PS_INSIDEFRAME, 3, 0},
    {4, 2, 2, 30, 30, 0, 0, 0, 0, PS_INSIDEFRAME, 4, 0},
    {0, 2, 2, 30, 30, 0, 0, 0, 0, PS_INSIDEFRAME, 4, 1},
    {4, 2, 2, 30, 30, 0, 0, 0, 0, PS_INSIDEFRAME, 4, 1},
    {0, 2, 2, 30, 30, 0, 0, 0, 0, PS_INSIDEFRAME, 1, 1},
    {0, 2, 2, 30, 30, 0, 0, 0, 0, PS_SOLID, 4, 1},
    {1, 2, 2, 30, 30, 12, 12, 0, 0, PS_INSIDEFRAME, 4, 1},
    {2, 2, 2, 30, 30, 30, 16, 16, 2, PS_INSIDEFRAME, 4, 1},
    {3, 2, 2, 30, 30, 2, 16, 30, 16, PS_INSIDEFRAME, 4, 1},
    {2, 2, 2, 30, 30, 30, 16, 16, 2, PS_SOLID, 4, 1},
};

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static const char *KINDS[5] = {"ellipse", "roundrect", "pie", "chord", "rectangle"};
    static const COLORREF COLOURS[2] = {RGB(0, 0, 0), RGB(128, 64, 192)};
    HDC screen;
    int count = sizeof(SHAPES) / sizeof(SHAPES[0]);
    int index;
    int x;
    int y;

    probeOpen(OUTPUT);
    ShowCursor(FALSE);
    SetCursorPos(GetSystemMetrics(SM_CXSCREEN) - 1, GetSystemMetrics(SM_CYSCREEN) - 1);

    screen = GetDC(NULL);
    PatBlt(screen, 0, 0, CELL * ACROSS, CELL * ((count + ACROSS - 1) / ACROSS), WHITENESS);

    for (index = 0; index < count; index++) {
        const struct Shape *s = &SHAPES[index];
        int cx = (index % ACROSS) * CELL;
        int cy = (index / ACROSS) * CELL;
        HPEN pen = CreatePen(s->style, s->width, COLOURS[s->colour]);
        HPEN oldPen = SelectObject(screen, pen);
        HBRUSH oldBrush = SelectObject(screen, GetStockObject(LTGRAY_BRUSH));
        int l = cx + s->left;
        int t = cy + s->top;
        int r = cx + s->right;
        int b = cy + s->bottom;

        if (s->kind == 0) {
            Ellipse(screen, l, t, r, b);
        } else if (s->kind == 1) {
            RoundRect(screen, l, t, r, b, s->a, s->b);
        } else if (s->kind == 2) {
            Pie(screen, l, t, r, b, cx + s->a, cy + s->b, cx + s->c, cy + s->d);
        } else if (s->kind == 3) {
            Chord(screen, l, t, r, b, cx + s->a, cy + s->b, cx + s->c, cy + s->d);
        } else {
            Rectangle(screen, l, t, r, b);
        }

        SelectObject(screen, oldPen);
        SelectObject(screen, oldBrush);
        DeleteObject(pen);

        wsprintf(probeArgs, "%d", index);
        wsprintf(probeResult, "%s,%d:%d:%d:%d,%d:%d:%d:%d,style=%d,width=%d,colour=%d",
                 (LPSTR)KINDS[s->kind], s->left, s->top, s->right, s->bottom, s->a, s->b, s->c,
                 s->d, s->style, s->width, s->colour);
        probe("shape", probeArgs, probeResult);
    }

    for (index = 0; index < count; index++) {
        int cx = (index % ACROSS) * CELL;
        int cy = (index / ACROSS) * CELL;

        for (y = 0; y < CELL; y++) {
            LPSTR at = probeResult;

            for (x = 0; x < CELL; x++) {
                *at++ = digit(GetPixel(screen, cx + x, cy + y));
            }

            *at = '\0';
            wsprintf(probeArgs, "%d,y=%d", index, y);
            probe(KINDS[SHAPES[index].kind], probeArgs, probeResult);
        }
    }

    ReleaseDC(NULL, screen);
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
