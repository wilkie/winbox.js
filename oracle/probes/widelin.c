/*
 * Lines drawn with a pen wider than a pixel, pixel for pixel: how GDI makes
 * a wide line, its ends and its joins.
 *
 * Each case is drawn in a cell of its own, 32 by 32, on the screen over
 * white, with a black solid pen of its width, and the cell is read back:
 *
 * * `line`: the case, what it was -- the pen's width and the points.
 * * `cell`: the case and the row; the row, a palette digit a pixel.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\WIDELIN.OUT"

#define CELL 32
#define ACROSS 8

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

/* width, then up to four points; count the points. */
struct Line {
    int width;
    int count;
    POINT points[4];
};

static const struct Line LINES[] = {
    {2, 2, {{6, 16}, {26, 16}}},
    {3, 2, {{6, 16}, {26, 16}}},
    {4, 2, {{6, 16}, {26, 16}}},
    {5, 2, {{6, 16}, {26, 16}}},
    {8, 2, {{6, 16}, {26, 16}}},
    {3, 2, {{16, 6}, {16, 26}}},
    {4, 2, {{16, 6}, {16, 26}}},
    {3, 2, {{6, 6}, {26, 26}}},
    {4, 2, {{6, 6}, {26, 26}}},
    {5, 2, {{6, 26}, {26, 6}}},
    {3, 2, {{4, 10}, {28, 20}}},
    {4, 2, {{4, 10}, {28, 20}}},
    {5, 2, {{10, 4}, {20, 28}}},
    {6, 2, {{26, 20}, {6, 12}}},
    {7, 2, {{16, 16}, {16, 16}}},
    {3, 2, {{16, 16}, {17, 16}}},
    {4, 3, {{6, 26}, {16, 6}, {26, 26}}},
    {5, 3, {{6, 8}, {26, 8}, {26, 26}}},
    {3, 4, {{6, 6}, {26, 6}, {26, 26}, {6, 26}}},
    {6, 3, {{4, 24}, {14, 10}, {28, 22}}},
};

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HDC screen;
    int count = sizeof(LINES) / sizeof(LINES[0]);
    int index;
    int x;
    int y;
    int i;

    probeOpen(OUTPUT);
    ShowCursor(FALSE);
    SetCursorPos(GetSystemMetrics(SM_CXSCREEN) - 1, GetSystemMetrics(SM_CYSCREEN) - 1);

    screen = GetDC(NULL);
    PatBlt(screen, 0, 0, CELL * ACROSS, CELL * ((count + ACROSS - 1) / ACROSS), WHITENESS);

    for (index = 0; index < count; index++) {
        const struct Line *l = &LINES[index];
        int cx = (index % ACROSS) * CELL;
        int cy = (index / ACROSS) * CELL;
        HPEN pen = CreatePen(PS_SOLID, l->width, RGB(0, 0, 0));
        HPEN old = SelectObject(screen, pen);
        POINT moved[4];

        for (i = 0; i < l->count; i++) {
            moved[i].x = cx + l->points[i].x;
            moved[i].y = cy + l->points[i].y;
        }

        Polyline(screen, moved, l->count);
        SelectObject(screen, old);
        DeleteObject(pen);

        wsprintf(probeArgs, "%d", index);
        wsprintf(probeResult, "w=%d", l->width);

        for (i = 0; i < l->count; i++) {
            char one[16];

            wsprintf(one, " %d,%d", l->points[i].x, l->points[i].y);
            lstrcat(probeResult, one);
        }

        probe("line", probeArgs, probeResult);
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
            probe("cell", probeArgs, probeResult);
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
