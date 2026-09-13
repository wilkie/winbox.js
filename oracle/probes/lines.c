/*
 * Which pixels a line puts down.
 *
 * Nothing here has ever measured this. Every glyph in the corpus is drawn by
 * filling what a contour encloses or by copying a strike, and neither walks a
 * line; the three plotter fonts do, and they were the first thing to notice
 * that our line and GDI's disagree -- by one pixel, on the rows where a
 * Bresenham has a tie to break.
 *
 * Asking through a font is asking badly. The endpoints come out of a design
 * scaled by a ratio, so a disagreement could be the scaling as easily as the
 * line, and the answer arrives one letter at a time. This asks directly: a pen
 * a pixel wide, two endpoints chosen in whole pixels, and the ink.
 *
 * The fan is rings around a fixed origin, so every octant is crossed at
 * several lengths and both the shallow and the steep cases appear with and
 * without an exact diagonal.
 *
 * A tie is what happens when the line passes exactly between two pixels, and
 * it needs an even major span to arise at all. The first four radii were 3, 5,
 * 8 and 13, of which only one is even: seven slopes in the whole sweep can tie,
 * which turned out to be too few to say what breaks a tie. So 10, 12 and 14 are
 * here as well, and the even radii now outnumber the odd.
 *
 * The origin is the middle of a thirty-two square cell, so a radius of fifteen
 * is the most that still lands inside it, which caps the major span at fifteen
 * and the even spans at fourteen. A tie turns out to be decided by the slope in
 * lowest terms, and fourteen is not enough denominators to say how, so there is
 * a second fan as well: from the corner of the cell rather than its middle,
 * which buys a span of thirty-one and every even denominator up to thirty. It
 * asks one octant only, because the first fan already showed the answer is the
 * same in all eight once the signs are taken off. Both fans start on an even
 * coordinate, so neither can be told from the other by the parity of where it
 * begins.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\LINES.OUT"

/* Thirty-two square, four bytes a row, so the rows are contiguous and the
 * record is the same shape as the glyph probe's.
 */
#define CELL_WIDTH  32
#define CELL_HEIGHT 32
#define ROW_BYTES   4
#define CELL_BYTES  (ROW_BYTES * CELL_HEIGHT)

#define ORIGIN 16

static HDC memory;
static HBITMAP canvas;
static char bits[CELL_BYTES];

static const char HEX[] = "0123456789abcdef";

/* Draws one line and records the whole cell. */
static void probeLine(int dx, int dy)
{
    LPSTR at;
    int index;

    PatBlt(memory, 0, 0, CELL_WIDTH, CELL_HEIGHT, WHITENESS);

    MoveTo(memory, ORIGIN, ORIGIN);
    LineTo(memory, ORIGIN + dx, ORIGIN + dy);

    GetBitmapBits(canvas, (LONG)CELL_BYTES, bits);

    at = probeResult;

    for (index = 0; index < CELL_BYTES; index++) {
        *at++ = HEX[(bits[index] >> 4) & 0x0f];
        *at++ = HEX[bits[index] & 0x0f];
    }

    *at = '\0';

    wsprintf(probeArgs, "%d,%d", dx, dy);
    probe("line", probeArgs, probeResult);
}

/* One fan from the corner of the cell, at a fixed major span. */
static void probeCorner(int span)
{
    int minor;

    for (minor = 0; minor <= span; minor++) {
        PatBlt(memory, 0, 0, CELL_WIDTH, CELL_HEIGHT, WHITENESS);

        MoveTo(memory, 0, 0);
        LineTo(memory, span, minor);

        GetBitmapBits(canvas, (LONG)CELL_BYTES, bits);

        {
            LPSTR at = probeResult;
            int index;

            for (index = 0; index < CELL_BYTES; index++) {
                *at++ = HEX[(bits[index] >> 4) & 0x0f];
                *at++ = HEX[bits[index] & 0x0f];
            }

            *at = '\0';
        }

        wsprintf(probeArgs, "%d,%d", span, minor);
        probe("corner", probeArgs, probeResult);
    }
}

/* One ring of endpoints at a fixed distance from the origin. */
static void probeRing(int radius)
{
    int step;

    for (step = -radius; step <= radius; step++) {
        probeLine(radius, step);
        probeLine(-radius, step);
        probeLine(step, radius);
        probeLine(step, -radius);
    }
}

int PASCAL WinMain(HANDLE instance, HANDLE previous, LPSTR command, int show)
{
    HDC screen;
    HBITMAP previousBitmap;
    HPEN pen;

    probeOpen(OUTPUT);

    screen = GetDC(NULL);
    memory = CreateCompatibleDC(screen);
    canvas = CreateBitmap(CELL_WIDTH, CELL_HEIGHT, 1, 1, NULL);
    previousBitmap = (HBITMAP)SelectObject(memory, canvas);

    pen = (HPEN)GetStockObject(BLACK_PEN);
    SelectObject(memory, pen);

    probeNote("a pen one pixel wide, from the middle of the cell outward");
    probeRing(3);
    probeRing(5);
    probeRing(8);
    probeRing(13);
    probeRing(10);
    probeRing(12);
    probeRing(14);

    probeNote("a pen one pixel wide, from the corner of the cell");
    probeCorner(16);
    probeCorner(18);
    probeCorner(20);
    probeCorner(22);
    probeCorner(24);
    probeCorner(26);
    probeCorner(28);
    probeCorner(30);

    SelectObject(memory, previousBitmap);
    DeleteObject(canvas);
    DeleteDC(memory);
    ReleaseDC(NULL, screen);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
