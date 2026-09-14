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
 * The fans also ask the same spans from an odd coordinate. Nothing recorded
 * could say whether a tie depends on where the line begins rather than only on
 * its slope, because every ring and the first fan all begin on an even one --
 * and a glyph's strokes begin wherever the outline puts them. It does not: 236
 * slopes across four origins, on a VGA and on a Hercules, and not one of them
 * turns on the parity of either coordinate.
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

/* One fan from a fixed point, at a fixed major span. */
static void probeFrom(int fromX, int fromY, int span)
{
    int minor;

    for (minor = 0; minor <= span; minor++) {
        PatBlt(memory, 0, 0, CELL_WIDTH, CELL_HEIGHT, WHITENESS);

        MoveTo(memory, fromX, fromY);
        LineTo(memory, fromX + span, fromY + minor);

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

        wsprintf(probeArgs, "%d,%d,%d,%d", fromX, fromY, span, minor);
        probe("from", probeArgs, probeResult);
    }
}

/* One segment named by both its ends. */
static void probeSegment(int fromX, int fromY, int toX, int toY)
{
    LPSTR at;
    int index;

    PatBlt(memory, 0, 0, CELL_WIDTH, CELL_HEIGHT, WHITENESS);

    MoveTo(memory, fromX, fromY);
    LineTo(memory, toX, toY);

    GetBitmapBits(canvas, (LONG)CELL_BYTES, bits);

    at = probeResult;

    for (index = 0; index < CELL_BYTES; index++) {
        *at++ = HEX[(bits[index] >> 4) & 0x0f];
        *at++ = HEX[bits[index] & 0x0f];
    }

    *at = '\0';

    wsprintf(probeArgs, "%d,%d,%d,%d", fromX, fromY, toX, toY);
    probe("segment", probeArgs, probeResult);
}

/* A chain of two lines, which is what a plotter glyph draws.
 *
 * Everything above draws one `LineTo` after one `MoveTo`. A stroke font draws a
 * run of them, and nothing has ever asked whether the second line of a chain is
 * the same line drawn on its own -- a driver handed a whole polyline in one
 * `Output` call need not walk it segment by segment the way two calls would.
 */
static void probeChain(int x0, int y0, int x1, int y1, int x2, int y2)
{
    LPSTR at;
    int index;

    PatBlt(memory, 0, 0, CELL_WIDTH, CELL_HEIGHT, WHITENESS);

    MoveTo(memory, x0, y0);
    LineTo(memory, x1, y1);
    LineTo(memory, x2, y2);

    GetBitmapBits(canvas, (LONG)CELL_BYTES, bits);

    at = probeResult;

    for (index = 0; index < CELL_BYTES; index++) {
        *at++ = HEX[(bits[index] >> 4) & 0x0f];
        *at++ = HEX[bits[index] & 0x0f];
    }

    *at = '\0';

    wsprintf(probeArgs, "%d,%d,%d,%d,%d,%d", x0, y0, x1, y1, x2, y2);
    probe("chain", probeArgs, probeResult);
}

/* A whole polyline, named, which is what a stroke glyph actually draws.
 *
 * `probeChain` asks two segments. A plotter glyph draws a run of a dozen, some
 * of them off the edge of the cell and some of them of no length at all, and
 * `Script`'s `j` says that is not the same thing: its stem, drawn on its own or
 * as the second of two, breaks a tie one way, and drawn inside the glyph it
 * breaks it the other.
 */
static void probePoly(LPCSTR name, const int FAR *points, int count)
{
    LPSTR at;
    int index;

    PatBlt(memory, 0, 0, CELL_WIDTH, CELL_HEIGHT, WHITENESS);

    MoveTo(memory, points[0], points[1]);

    for (index = 1; index < count; index++) {
        LineTo(memory, points[index * 2], points[index * 2 + 1]);
    }

    GetBitmapBits(canvas, (LONG)CELL_BYTES, bits);

    at = probeResult;

    for (index = 0; index < CELL_BYTES; index++) {
        *at++ = HEX[(bits[index] >> 4) & 0x0f];
        *at++ = HEX[bits[index] & 0x0f];
    }

    *at = '\0';

    /* The points themselves are the record's name: a polyline has no other
     * identity, and this side has to rebuild it to replay it. */
    at = probeArgs;

    for (index = 0; index < count * 2; index++) {
        if (index) {
            *at++ = ',';
        }

        wsprintf(at, "%d", points[index]);

        while (*at) {
            at++;
        }
    }

    *at = '\0';

    probeNote(name);
    probe("poly", probeArgs, probeResult);
}

/* One fan whose long axis is y rather than x.
 *
 * Every steep line the sweep above draws begins at the middle of the cell and
 * spans at most fifteen, because that is as far as a ring reaches. The corner
 * fans buy a span of thirty-one and every denominator up to thirty, but their
 * long axis is always x. So a steep line longer than fifteen has never been
 * asked at all, and neither has a steep line that begins anywhere but the one
 * point -- which is exactly what a plotter glyph draws.
 *
 * The minor offset is swept over whatever keeps the far end inside the cell,
 * so the fan asks every slope it can reach rather than a fixed count.
 */
static void probeDown(int fromX, int fromY, int span)
{
    int minor;

    for (minor = -span; minor <= span; minor++) {
        if (fromX + minor < 0 || fromX + minor >= CELL_WIDTH) {
            continue;
        }

        PatBlt(memory, 0, 0, CELL_WIDTH, CELL_HEIGHT, WHITENESS);

        MoveTo(memory, fromX, fromY);
        LineTo(memory, fromX + minor, fromY + span);

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

        wsprintf(probeArgs, "%d,%d,%d,%d", fromX, fromY, span, minor);
        probe("down", probeArgs, probeResult);
    }
}

/* A fan of lines that begin outside the cell and end on a named row.
 *
 * Every line in every sweep above lies wholly inside the cell, so nothing has
 * ever asked what a clipped one draws -- and a plotter glyph at a forty pixel
 * cell is wider than the cell and its strokes begin off the right-hand edge.
 * The one display that cannot clip for itself is the one that gets them wrong.
 */
static void probeAcross(int fromX, int fromY, int toY)
{
    int toX;

    for (toX = 0; toX < CELL_WIDTH; toX++) {
        probeSegment(fromX, fromY, toX, toY);
    }
}

/* And the same the other way about: a line that begins inside and ends past an
 * edge, which is the shape of a descender at a size the cell cannot hold.
 */
static void probeBelow(int fromX, int fromY, int toY)
{
    int toX;

    for (toX = -8; toX < CELL_WIDTH + 8; toX++) {
        probeSegment(fromX, fromY, toX, toY);
    }
}

/* Every short line from a point just off an edge.
 *
 * The fans below cross an edge at a shallow angle over a long span, which is
 * the shape a plotter capital makes. A plotter descender makes another: two or
 * three pixels of hook, drawn from a point a column outside the cell, where the
 * whole line is shorter than the distance it is clipped by.
 */
static void probeShort(int fromX, int fromY)
{
    int dx;
    int dy;

    for (dy = -4; dy <= 4; dy++) {
        for (dx = -4; dx <= 4; dx++) {
            if (dx == 0 && dy == 0) {
                continue;
            }

            probeSegment(fromX, fromY, fromX + dx, fromY + dy);
        }
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
    probeFrom(0, 0, 16);
    probeFrom(0, 0, 18);
    probeFrom(0, 0, 20);
    probeFrom(0, 0, 22);
    probeFrom(0, 0, 24);
    probeFrom(0, 0, 26);
    probeFrom(0, 0, 28);
    probeFrom(0, 0, 30);

    /* And the same spans from somewhere odd.
     *
     * Both fans above begin on an even coordinate, and so does every ring, so
     * nothing recorded has ever been able to say whether a tie depends on where
     * the line starts rather than only on its slope. A glyph's strokes begin
     * wherever the outline puts them, and the plotter faces are the only thing
     * in the corpus that draws one -- which is where the question came from.
     */
    /* And lines that stop on the very last row or column the cell has.
     *
     * A line does not draw the pixel it stops on, and every sweep above stops
     * with room to spare -- the rings reach fourteen from a middle at sixteen
     * and the corner fans thirty from nought, so the thirty-second row and the
     * thirty-second column have never been an endpoint. The plotter faces put
     * one there: at a forty pixel cell their strokes end on row thirty-one, and
     * that is where a Hercules and an EGA part company.
     */
    probeNote("stopping on the last row and the last column, which nothing has asked");
    probeFrom(0, 0, 31);
    probeRing(15);

    probeNote("and from an odd coordinate, which nothing has asked before");
    probeFrom(1, 1, 16);
    probeFrom(1, 1, 18);
    probeFrom(1, 1, 20);
    probeFrom(1, 1, 22);
    probeFrom(1, 1, 24);
    probeFrom(1, 1, 26);
    probeFrom(1, 1, 28);
    probeFrom(1, 0, 16);
    probeFrom(0, 1, 16);
    probeFrom(1, 0, 20);
    probeFrom(0, 1, 20);

    /* Steep lines longer than fifteen, which nothing has asked.
     *
     * Every steep line above starts at the middle of the cell, so its span is
     * capped at fifteen and its start is one fixed point. A plotter stroke at a
     * forty pixel cell is steep, spans twenty-six, and starts on row five --
     * none of which the sweep can produce. The three spans of twenty-six differ
     * only in where they stop: on the last row of the cell, one short of it,
     * and well inside. That separates the span from the edge.
     */
    probeNote("fans whose long axis is y, which the rings are too short to ask");
    probeDown(16, 5, 26);
    probeDown(16, 4, 26);
    probeDown(16, 0, 26);
    probeDown(16, 5, 20);
    probeDown(16, 0, 20);
    probeDown(16, 1, 20);
    probeDown(17, 0, 20);
    probeDown(16, 0, 10);
    probeDown(16, 1, 10);
    probeDown(17, 1, 10);

    /* And the strokes of the five glyphs that disagree, drawn as lines.
     *
     * These are the device segments this side computes for `Roman` slanted `M`
     * and `W` at forty and `Script` `j` at sixteen and forty and `y` at forty,
     * on a Hercules, with the two `W` strokes an EGA computes beside them. Drawn
     * through `LineTo` they answer the one question a glyph cannot: whether the
     * pixels we disagree about are a property of the line or of the font.
     */
    probeNote("the strokes of the glyphs that disagree, drawn as lines");
    probeSegment(24, 5, 16, 31);
    probeSegment(34, 5, 16, 31);
    probeSegment(34, 5, 25, 31);
    probeSegment(43, 5, 25, 31);
    probeSegment(25, 5, 19, 25);
    probeSegment(35, 5, 28, 25);
    probeSegment(20, 5, 29, 5);
    probeSegment(25, 5, 21, 31);
    probeSegment(42, 5, 21, 31);
    probeSegment(25, 5, 12, 31);
    probeSegment(42, 5, 29, 31);
    probeSegment(43, 5, 30, 31);
    probeSegment(26, 5, 23, 28);
    probeSegment(23, 5, 14, 31);
    probeSegment(32, 5, 14, 31);
    probeSegment(2, 22, 4, 17);
    probeSegment(4, 17, -2, 37);
    probeSegment(12, 17, 6, 37);
    probeSegment(3, 7, 0, 15);
    probeSegment(0, 12, 2, 11);
    probeSegment(2, 11, 4, 10);

    /* And lines that leave the cell, which nothing has asked either.
     *
     * The first four fans begin to the right of the cell and end on its last
     * row; the next two begin to the left of it; the last three begin inside
     * and end below. Between them they cross every edge in both directions and
     * at every slope the cell can reach.
     */
    probeNote("lines that leave the cell, which the driver that cannot clip must be given clipped");
    probeAcross(33, 5, 31);
    probeAcross(35, 5, 31);
    probeAcross(40, 5, 31);
    probeAcross(47, 5, 31);
    probeAcross(-2, 5, 31);
    probeAcross(-9, 5, 31);
    probeBelow(16, 17, 37);
    probeBelow(4, 17, 37);
    probeBelow(16, 5, 45);

    /* And the edges the fans above do not cross.
     *
     * Every clipped line so far enters or leaves through a side. A plotter
     * descender leaves through the bottom and comes back, so a line that
     * *begins* below the cell has never been drawn, and neither has one that
     * begins above it.
     */
    probeNote("lines that begin past the top or the bottom, and short ones from just outside");
    probeAcross(16, 37, 5);
    probeAcross(16, 37, 0);
    probeAcross(16, -6, 26);
    probeAcross(16, -6, 31);
    probeAcross(-1, 17, 15);
    probeAcross(-1, 17, 25);
    probeShort(-1, 17);
    probeShort(32, 16);
    probeShort(16, 32);
    probeShort(16, -1);

    /* And short lines that stay inside it, which nothing has asked either.
     *
     * Every ring is three pixels across or more and every fan sixteen, so a
     * line of one or two pixels has never been drawn anywhere but off an edge.
     * A plotter letter is mostly made of them: `Script`'s `j` at sixteen pixels
     * walks its hook in steps of one and two.
     */
    probeShort(16, 16);
    probeShort(15, 15);

    /* One slope from ten places, and the same slope inside a chain.
     *
     * `Script`'s `j` at sixteen pixels draws its stem from `(3,7)` to `(0,15)`
     * -- a steep span of eight with a minor of three, which ties exactly half
     * way down. The ring of eight asks that slope from `(16,16)` and is
     * reproduced; the stem is not, and it wants the tie the other way. Either
     * where a steep line begins decides its tie -- which the fans have only ever
     * been able to ask of shallow ones -- or the second line of a chain is not
     * the same line drawn alone. These ask both.
     */
    probeNote("one steep slope from ten origins, and the same inside a chain");
    probeSegment(3, 7, 0, 15);
    probeSegment(4, 7, 1, 15);
    probeSegment(3, 8, 0, 16);
    probeSegment(4, 8, 1, 16);
    probeSegment(16, 7, 13, 15);
    probeSegment(17, 7, 14, 15);
    probeSegment(16, 8, 13, 16);
    probeSegment(17, 8, 14, 16);
    probeSegment(3, 16, 0, 24);
    probeSegment(16, 16, 13, 24);

    probeChain(2, 9, 3, 7, 0, 15);
    probeChain(3, 7, 3, 7, 0, 15);
    probeChain(2, 8, 3, 7, 0, 15);
    probeChain(4, 9, 3, 7, 0, 15);
    probeChain(15, 18, 16, 16, 13, 24);
    probeChain(16, 16, 16, 16, 13, 24);
    probeChain(2, 9, 3, 7, 3, 7);
    probeChain(0, 15, 3, 7, 2, 9);

    /* And the polylines a plotter glyph draws, cut back a point at a time.
     *
     * `Script`'s `j` at sixteen pixels and at twenty-one is the whole of what
     * the plotter faces still get wrong, and the pixel is on its stem -- the
     * second segment of a run of twelve. Drawn alone, and drawn as the second
     * of two, that segment breaks its tie toward where it began; inside the
     * glyph Windows breaks it the other way. These are the same runs in device
     * pixels, whole and cut back, so that whatever makes the difference can be
     * found by where the answer changes.
     */
    probeNote("the polylines a stroke glyph draws, whole and cut back");
    {
        static const int J16[] = {
            2, 9, 3, 7, 0, 15, 0, 15, -1, 15, -1, 15, -1, 15,
            -1, 13, 0, 12, 2, 11, 2, 11, 4, 10, 5, 9,
        };
        static const int J16NODUP[] = {
            2, 9, 3, 7, 0, 15, -1, 15, -1, 13, 0, 12, 2, 11, 4, 10, 5, 9,
        };
        static const int J16INSIDE[] = {
            2, 9, 3, 7, 0, 15, 0, 15, 1, 15, 1, 15, 1, 15,
            1, 13, 0, 12, 2, 11, 2, 11, 4, 10, 5, 9,
        };
        static const int J21[] = {
            2, 11, 3, 9, 0, 19, -1, 20, -2, 20, -2, 20, -2, 19,
            -2, 18, 0, 16, 1, 15, 3, 14, 4, 13, 6, 11,
        };

        probePoly("j16", J16, 13);
        probePoly("j16 cut to 3", J16, 3);
        probePoly("j16 cut to 4", J16, 4);
        probePoly("j16 cut to 5", J16, 5);
        probePoly("j16 cut to 6", J16, 6);
        probePoly("j16 cut to 8", J16, 8);
        probePoly("j16 cut to 9", J16, 9);
        probePoly("j16 no duplicates", J16NODUP, 9);
        probePoly("j16 kept inside", J16INSIDE, 13);
        probePoly("j21", J21, 13);
        probePoly("j21 cut to 3", J21, 3);
    }

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
