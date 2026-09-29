/*
 * Shapes drawn with a pen wider than a pixel: Polygon, Rectangle, Pie,
 * Chord and Arc, as `widelin` records lines.
 *
 * Each case is drawn in a cell of its own, 40 by 40, on the screen over
 * white, with a black solid pen of its width and a light grey brush, and
 * the cell is read back:
 *
 * * `shape`: the case, what it was.
 * * `cell`: the case and the row; the row, a palette digit a pixel.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\WIDEPOLY.OUT"

#define CELL 40
#define ACROSS 6

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

/* kind: 0 polygon, 1 rectangle, 2 pie, 3 chord, 4 arc, 5 polygon w/ inside frame pen. */
struct Shape {
    int kind;
    int width;
    int a, b, c, d;
};

static POINT TRIANGLE[3] = {{8, 32}, {20, 6}, {33, 30}};

static const struct Shape SHAPES[] = {
    {0, 3, 0, 0, 0, 0},     {0, 6, 0, 0, 0, 0},     {1, 3, 8, 8, 32, 30},
    {1, 6, 8, 8, 32, 30},   {2, 3, 36, 20, 20, 4},  {2, 6, 36, 20, 20, 4},
    {3, 4, 4, 20, 36, 20},  {4, 3, 36, 20, 20, 4},  {4, 6, 4, 20, 36, 20},
    {4, 8, 36, 20, 36, 20}, {5, 5, 8, 8, 32, 30},
};

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static const char *KINDS[6] = {"polygon", "rectangle", "pie", "chord", "arc", "insideframe"};
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
        HPEN pen = CreatePen(s->kind == 5 ? PS_INSIDEFRAME : PS_SOLID, s->width, RGB(0, 0, 0));
        HPEN old = SelectObject(screen, pen);
        HBRUSH oldBrush = SelectObject(screen, GetStockObject(LTGRAY_BRUSH));
        POINT moved[3];
        int i;

        switch (s->kind) {
        case 0:
            for (i = 0; i < 3; i++) {
                moved[i].x = cx + TRIANGLE[i].x;
                moved[i].y = cy + TRIANGLE[i].y;
            }

            Polygon(screen, moved, 3);
            break;
        case 1:
        case 5:
            Rectangle(screen, cx + s->a, cy + s->b, cx + s->c, cy + s->d);
            break;
        case 2:
            Pie(screen, cx + 6, cy + 6, cx + 34, cy + 34, cx + s->a, cy + s->b, cx + s->c, cy + s->d);
            break;
        case 3:
            Chord(screen, cx + 6, cy + 6, cx + 34, cy + 34, cx + s->a, cy + s->b, cx + s->c, cy + s->d);
            break;
        default:
            Arc(screen, cx + 6, cy + 6, cx + 34, cy + 34, cx + s->a, cy + s->b, cx + s->c, cy + s->d);
            break;
        }

        SelectObject(screen, old);
        SelectObject(screen, oldBrush);
        DeleteObject(pen);

        wsprintf(probeArgs, "%d", index);
        wsprintf(probeResult, "%s,w=%d,%d:%d:%d:%d", (LPSTR)KINDS[s->kind], s->width, s->a, s->b,
                 s->c, s->d);
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
