/*
 * Pie, Chord and Arc, pixel for pixel: as Tetris for Windows of the corpus
 * draws with Pie.
 *
 * Each shape is drawn in a cell of its own, 32 by 32, on the screen over
 * white, with a black pen one pixel wide and a light grey brush unless the
 * list says otherwise, and the cell is read back:
 *
 * * `shape`: the case, what it was -- its function, rectangle in the cell,
 *   the radials' two points, pen and brush.
 * * `pie`, `chord`, `arc`: the case and the row; the row, a palette digit a
 *   pixel.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\WEDGES.OUT"

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

/* kind: 0 pie, 1 chord, 2 arc; pen: 1 one pixel, 0 none; brush: 1 grey, 0 none. */
struct Shape {
    int kind;
    int left, top, right, bottom;
    int x1, y1, x2, y2;
    int pen;
    int brush;
};

static const struct Shape SHAPES[] = {
    /* A quarter, from the right round to the top. */
    {0, 2, 2, 30, 30, 30, 16, 16, 2, 1, 1},
    /* Three quarters: from the top round to the right. */
    {0, 2, 2, 30, 30, 16, 2, 30, 16, 1, 1},
    /* A half, the lower: from the left round to the right. */
    {0, 2, 2, 30, 30, 2, 16, 30, 16, 1, 1},
    /* A thin slice, and one the same point twice: the whole ellipse. */
    {0, 2, 2, 30, 30, 30, 14, 30, 18, 1, 1},
    {0, 2, 2, 30, 30, 30, 16, 30, 16, 1, 1},
    /* Radials to points far outside, at a slant; an odd, flat ellipse. */
    {0, 2, 2, 30, 30, 100, -40, -60, 70, 1, 1},
    {0, 1, 6, 30, 23, 30, 6, 1, 23, 1, 1},
    /* No pen; no brush. */
    {0, 2, 2, 30, 30, 30, 16, 16, 2, 0, 1},
    {0, 2, 2, 30, 30, 30, 16, 16, 2, 1, 0},
    {1, 2, 2, 30, 30, 30, 16, 16, 2, 1, 1},
    {1, 2, 2, 30, 30, 16, 2, 30, 16, 1, 1},
    {1, 2, 2, 30, 30, 2, 16, 30, 16, 1, 1},
    {1, 2, 2, 30, 30, 30, 16, 30, 16, 1, 1},
    {1, 1, 6, 30, 23, 30, 6, 1, 23, 1, 1},
    {1, 2, 2, 30, 30, 30, 16, 16, 2, 0, 1},
    {2, 2, 2, 30, 30, 30, 16, 16, 2, 1, 1},
    {2, 2, 2, 30, 30, 16, 2, 30, 16, 1, 1},
    {2, 2, 2, 30, 30, 2, 16, 30, 16, 1, 1},
    {2, 2, 2, 30, 30, 30, 16, 30, 16, 1, 1},
    {2, 2, 2, 30, 30, 100, -40, -60, 70, 1, 1},
    {2, 1, 6, 30, 23, 30, 6, 1, 23, 1, 1},
};

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static const char *KINDS[3] = {"pie", "chord", "arc"};
    HDC screen;
    HPEN thin = CreatePen(PS_SOLID, 1, RGB(0, 0, 0));
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
        HPEN oldPen = SelectObject(screen, s->pen ? thin : GetStockObject(NULL_PEN));
        HBRUSH oldBrush =
            SelectObject(screen, GetStockObject(s->brush ? LTGRAY_BRUSH : NULL_BRUSH));

        if (s->kind == 0) {
            Pie(screen, cx + s->left, cy + s->top, cx + s->right, cy + s->bottom, cx + s->x1,
                cy + s->y1, cx + s->x2, cy + s->y2);
        } else if (s->kind == 1) {
            Chord(screen, cx + s->left, cy + s->top, cx + s->right, cy + s->bottom, cx + s->x1,
                  cy + s->y1, cx + s->x2, cy + s->y2);
        } else {
            Arc(screen, cx + s->left, cy + s->top, cx + s->right, cy + s->bottom, cx + s->x1,
                cy + s->y1, cx + s->x2, cy + s->y2);
        }

        SelectObject(screen, oldPen);
        SelectObject(screen, oldBrush);

        wsprintf(probeArgs, "%d", index);
        wsprintf(probeResult, "%s,%d:%d:%d:%d,%d:%d-%d:%d,pen=%d,brush=%d",
                 (LPSTR)KINDS[s->kind], s->left, s->top, s->right, s->bottom, s->x1, s->y1,
                 s->x2, s->y2, s->pen, s->brush);
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
    DeleteObject(thin);
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
