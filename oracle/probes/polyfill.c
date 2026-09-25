/*
 * `Polygon`, which nothing here draws, asked on the corners turned text uses.
 *
 * A VGA reports `POLYGONALCAPS` 8, scanlines alone, so the driver fills no
 * polygon: GDI turns every one into scanlines itself. 8u found that Windows
 * fills a turned string's opaque ground as a polygon -- the ground rectangle
 * turned, with whole-pixel corners -- and that no simple sampling rule
 * reproduces it at thirty degrees. This asks whether the ground *is* GDI's
 * `Polygon`, by drawing `Polygon` on exactly the corners derived for each of
 * the twelve turned grounds `rotstyle` recorded, and gives GDI's fill rule a
 * sweep to be read against: a rectangle eighteen by sixteen turned every five
 * degrees about the same point, and bands two and three pixels thick like a
 * thick rule's, each under both fill modes.
 *
 * The pen is `NULL_PEN`, so only the fill is drawn, and the brush is black.
 * Then each quadrilateral again with a black pen: with the null brush for the
 * outline alone, and with the black brush for the two together.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\POLYFILL.OUT"

#define CELL      128
#define ROW_BYTES (CELL / 8)

static HDC memory;
static HBITMAP canvas;
static char bits[ROW_BYTES * CELL];

static const char HEX[] = "0123456789abcdef";

typedef struct { LPCSTR tag; int esc; POINT pts[4]; } QUAD;

static QUAD QUADS[] = {
    { "ground Arial 16", 300, { {64,64}, {80,55}, {88,69}, {72,78} } },
    { "ground Arial 16", 450, { {64,64}, {77,51}, {88,62}, {75,75} } },
    { "ground Arial 16", 900, { {64,64}, {64,46}, {80,46}, {80,64} } },
    { "ground Arial 16", 1800, { {64,64}, {46,64}, {46,48}, {64,48} } },
    { "ground Arial 24", 300, { {64,64}, {87,50}, {99,70}, {76,84} } },
    { "ground Arial 24", 450, { {64,64}, {83,45}, {99,61}, {80,80} } },
    { "ground Arial 24", 900, { {64,64}, {64,37}, {87,37}, {87,64} } },
    { "ground Arial 24", 1800, { {64,64}, {37,64}, {37,41}, {64,41} } },
    { "ground Courier New 16", 300, { {64,64}, {78,56}, {86,70}, {72,78} } },
    { "ground Courier New 16", 450, { {64,64}, {75,53}, {86,64}, {75,75} } },
    { "ground Courier New 16", 900, { {64,64}, {64,48}, {80,48}, {80,64} } },
    { "ground Courier New 16", 1800, { {64,64}, {48,64}, {48,48}, {64,48} } },
    { "rect 18x16", 50, { {64,64}, {82,62}, {83,78}, {65,80} } },
    { "rect 18x16", 100, { {64,64}, {82,61}, {85,77}, {67,80} } },
    { "rect 18x16", 150, { {64,64}, {81,59}, {85,74}, {68,79} } },
    { "rect 18x16", 200, { {64,64}, {81,58}, {86,73}, {69,79} } },
    { "rect 18x16", 250, { {64,64}, {80,56}, {87,71}, {71,79} } },
    { "rect 18x16", 300, { {64,64}, {80,55}, {88,69}, {72,78} } },
    { "rect 18x16", 350, { {64,64}, {79,54}, {88,67}, {73,77} } },
    { "rect 18x16", 400, { {64,64}, {78,52}, {88,64}, {74,76} } },
    { "rect 18x16", 450, { {64,64}, {77,51}, {88,62}, {75,75} } },
    { "rect 18x16", 500, { {64,64}, {76,50}, {88,60}, {76,74} } },
    { "rect 18x16", 550, { {64,64}, {74,49}, {87,58}, {77,73} } },
    { "rect 18x16", 600, { {64,64}, {73,48}, {87,56}, {78,72} } },
    { "rect 18x16", 650, { {64,64}, {72,48}, {87,55}, {79,71} } },
    { "rect 18x16", 700, { {64,64}, {70,47}, {85,52}, {79,69} } },
    { "rect 18x16", 750, { {64,64}, {69,47}, {84,51}, {79,68} } },
    { "rect 18x16", 800, { {64,64}, {67,46}, {83,49}, {80,67} } },
    { "rect 18x16", 850, { {64,64}, {66,46}, {82,47}, {80,65} } },
    { "rect 18x16", 900, { {64,64}, {64,46}, {80,46}, {80,64} } },
    { "rect 18x16", 950, { {64,64}, {62,46}, {78,45}, {80,63} } },
    { "rect 18x16", 1000, { {64,64}, {61,46}, {77,43}, {80,61} } },
    { "rect 18x16", 1050, { {64,64}, {59,47}, {74,43}, {79,60} } },
    { "rect 18x16", 1100, { {64,64}, {58,47}, {73,42}, {79,59} } },
    { "rect 18x16", 1150, { {64,64}, {56,48}, {71,41}, {79,57} } },
    { "rect 18x16", 1200, { {64,64}, {55,48}, {69,40}, {78,56} } },
    { "rect 18x16", 1250, { {64,64}, {54,49}, {67,40}, {77,55} } },
    { "rect 18x16", 1300, { {64,64}, {52,50}, {64,40}, {76,54} } },
    { "rect 18x16", 1350, { {64,64}, {51,51}, {62,40}, {75,53} } },
    { "rect 18x16", 1400, { {64,64}, {50,52}, {60,40}, {74,52} } },
    { "rect 18x16", 1450, { {64,64}, {49,54}, {58,41}, {73,51} } },
    { "rect 18x16", 1500, { {64,64}, {48,55}, {56,41}, {72,50} } },
    { "rect 18x16", 1550, { {64,64}, {48,56}, {55,41}, {71,49} } },
    { "rect 18x16", 1600, { {64,64}, {47,58}, {52,43}, {69,49} } },
    { "rect 18x16", 1650, { {64,64}, {47,59}, {51,44}, {68,49} } },
    { "rect 18x16", 1700, { {64,64}, {46,61}, {49,45}, {67,48} } },
    { "rect 18x16", 1750, { {64,64}, {46,62}, {47,46}, {65,48} } },
    { "rect 18x16", 1800, { {64,64}, {46,64}, {46,48}, {64,48} } },
    { "rect 18x16", 1850, { {64,64}, {46,66}, {45,50}, {63,48} } },
    { "rect 18x16", 1900, { {64,64}, {46,67}, {43,51}, {61,48} } },
    { "rect 18x16", 1950, { {64,64}, {47,69}, {43,54}, {60,49} } },
    { "rect 18x16", 2000, { {64,64}, {47,70}, {42,55}, {59,49} } },
    { "rect 18x16", 2050, { {64,64}, {48,72}, {41,57}, {57,49} } },
    { "rect 18x16", 2100, { {64,64}, {48,73}, {40,59}, {56,50} } },
    { "rect 18x16", 2150, { {64,64}, {49,74}, {40,61}, {55,51} } },
    { "rect 18x16", 2200, { {64,64}, {50,76}, {40,64}, {54,52} } },
    { "rect 18x16", 2250, { {64,64}, {51,77}, {40,66}, {53,53} } },
    { "rect 18x16", 2300, { {64,64}, {52,78}, {40,68}, {52,54} } },
    { "rect 18x16", 2350, { {64,64}, {54,79}, {41,70}, {51,55} } },
    { "rect 18x16", 2400, { {64,64}, {55,80}, {41,72}, {50,56} } },
    { "rect 18x16", 2450, { {64,64}, {56,80}, {41,73}, {49,57} } },
    { "rect 18x16", 2500, { {64,64}, {58,81}, {43,76}, {49,59} } },
    { "rect 18x16", 2550, { {64,64}, {59,81}, {44,77}, {49,60} } },
    { "rect 18x16", 2600, { {64,64}, {61,82}, {45,79}, {48,61} } },
    { "rect 18x16", 2650, { {64,64}, {62,82}, {46,81}, {48,63} } },
    { "rect 18x16", 2700, { {64,64}, {64,82}, {48,82}, {48,64} } },
    { "rect 18x16", 2750, { {64,64}, {66,82}, {50,83}, {48,65} } },
    { "rect 18x16", 2800, { {64,64}, {67,82}, {51,85}, {48,67} } },
    { "rect 18x16", 2850, { {64,64}, {69,81}, {54,85}, {49,68} } },
    { "rect 18x16", 2900, { {64,64}, {70,81}, {55,86}, {49,69} } },
    { "rect 18x16", 2950, { {64,64}, {72,80}, {57,87}, {49,71} } },
    { "rect 18x16", 3000, { {64,64}, {73,80}, {59,88}, {50,72} } },
    { "rect 18x16", 3050, { {64,64}, {74,79}, {61,88}, {51,73} } },
    { "rect 18x16", 3100, { {64,64}, {76,78}, {64,88}, {52,74} } },
    { "rect 18x16", 3150, { {64,64}, {77,77}, {66,88}, {53,75} } },
    { "rect 18x16", 3200, { {64,64}, {78,76}, {68,88}, {54,76} } },
    { "rect 18x16", 3250, { {64,64}, {79,74}, {70,87}, {55,77} } },
    { "rect 18x16", 3300, { {64,64}, {80,73}, {72,87}, {56,78} } },
    { "rect 18x16", 3350, { {64,64}, {80,72}, {73,87}, {57,79} } },
    { "rect 18x16", 3400, { {64,64}, {81,70}, {76,85}, {59,79} } },
    { "rect 18x16", 3450, { {64,64}, {81,69}, {77,84}, {60,79} } },
    { "rect 18x16", 3500, { {64,64}, {82,67}, {79,83}, {61,80} } },
    { "rect 18x16", 3550, { {64,64}, {82,66}, {81,82}, {63,80} } },
    { "band 27x2", 50, { {64,64}, {91,62}, {91,64}, {64,66} } },
    { "band 27x3", 50, { {64,64}, {91,62}, {91,65}, {64,67} } },
    { "band 27x2", 100, { {64,64}, {91,59}, {91,61}, {64,66} } },
    { "band 27x3", 100, { {64,64}, {91,59}, {92,62}, {65,67} } },
    { "band 27x2", 150, { {64,64}, {90,57}, {91,59}, {65,66} } },
    { "band 27x3", 150, { {64,64}, {90,57}, {91,60}, {65,67} } },
    { "band 27x2", 200, { {64,64}, {89,55}, {90,57}, {65,66} } },
    { "band 27x3", 200, { {64,64}, {89,55}, {90,58}, {65,67} } },
    { "band 27x2", 250, { {64,64}, {88,53}, {89,55}, {65,66} } },
    { "band 27x3", 250, { {64,64}, {88,53}, {89,56}, {65,67} } },
    { "band 27x2", 300, { {64,64}, {87,50}, {88,52}, {65,66} } },
    { "band 27x3", 300, { {64,64}, {87,50}, {89,53}, {66,67} } },
    { "band 27x2", 350, { {64,64}, {86,49}, {87,51}, {65,66} } },
    { "band 27x3", 350, { {64,64}, {86,49}, {88,51}, {66,66} } },
    { "band 27x2", 400, { {64,64}, {85,47}, {86,49}, {65,66} } },
    { "band 27x3", 400, { {64,64}, {85,47}, {87,49}, {66,66} } },
    { "band 27x2", 450, { {64,64}, {83,45}, {84,46}, {65,65} } },
    { "band 27x3", 450, { {64,64}, {83,45}, {85,47}, {66,66} } },
    { "band 27x2", 500, { {64,64}, {81,43}, {83,44}, {66,65} } },
    { "band 27x3", 500, { {64,64}, {81,43}, {83,45}, {66,66} } },
    { "band 27x2", 550, { {64,64}, {79,42}, {81,43}, {66,65} } },
    { "band 27x3", 550, { {64,64}, {79,42}, {81,44}, {66,66} } },
    { "band 27x2", 600, { {64,64}, {78,41}, {80,42}, {66,65} } },
    { "band 27x3", 600, { {64,64}, {78,41}, {81,43}, {67,66} } },
    { "band 27x2", 650, { {64,64}, {75,40}, {77,41}, {66,65} } },
    { "band 27x3", 650, { {64,64}, {75,40}, {78,41}, {67,65} } },
    { "band 27x2", 700, { {64,64}, {73,39}, {75,40}, {66,65} } },
    { "band 27x3", 700, { {64,64}, {73,39}, {76,40}, {67,65} } },
    { "band 27x2", 750, { {64,64}, {71,38}, {73,39}, {66,65} } },
    { "band 27x3", 750, { {64,64}, {71,38}, {74,39}, {67,65} } },
    { "band 27x2", 800, { {64,64}, {69,37}, {71,37}, {66,64} } },
    { "band 27x3", 800, { {64,64}, {69,37}, {72,38}, {67,65} } },
    { "band 27x2", 850, { {64,64}, {66,37}, {68,37}, {66,64} } },
    { "band 27x3", 850, { {64,64}, {66,37}, {69,37}, {67,64} } },
};

static int inkAt(int column, int row)
{
    unsigned char value = (unsigned char)bits[row * ROW_BYTES + (column >> 3)];

    return (value & (0x80 >> (column & 7))) == 0;
}

static void writeInk(void)
{
    LPSTR at;
    int column;
    int row;
    int left = CELL;
    int top = CELL;
    int right = -1;
    int bottom = -1;

    for (row = 0; row < CELL; row++) {
        for (column = 0; column < CELL; column++) {
            if (!inkAt(column, row)) {
                continue;
            }

            if (column < left)   { left = column; }
            if (column > right)  { right = column; }
            if (row < top)       { top = row; }
            if (row > bottom)    { bottom = row; }
        }
    }

    wsprintf(probeResult, "box=%d:%d:%d:%d,rows=", left, top, right, bottom);
    at = probeResult + lstrlen(probeResult);

    for (row = top; right >= 0 && row <= bottom; row++) {
        int nibble = 0;
        int count = 0;

        for (column = left; column <= right; column++) {
            nibble = (nibble << 1) | inkAt(column, row);
            count++;

            if (count == 4) {
                *at++ = HEX[nibble];
                nibble = 0;
                count = 0;
            }
        }

        if (count) {
            *at++ = HEX[(nibble << (4 - count)) & 0x0f];
        }

        if (row < bottom) {
            *at++ = '/';
        }

        if (at - probeResult > 1900) {
            *at++ = '!';
            break;
        }
    }

    *at = '\0';
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HDC screen;
    int index;
    int mode;

    probeOpen(OUTPUT);

    screen = GetDC(NULL);
    memory = CreateCompatibleDC(screen);
    canvas = CreateBitmap(CELL, CELL, 1, 1, NULL);

    if (memory == NULL || canvas == NULL) {
        probe("setup", "128x128x1", "failed");
        probeFinish();
        return 0;
    }

    SelectObject(memory, canvas);
    SelectObject(memory, GetStockObject(NULL_PEN));
    SelectObject(memory, GetStockObject(BLACK_BRUSH));

    probeNote("Polygon with a null pen on turned-text corners and turned rectangles");

    for (index = 0; index < (int)(sizeof(QUADS) / sizeof(QUADS[0])); index++) {
        for (mode = ALTERNATE; mode <= WINDING; mode++) {
            PatBlt(memory, 0, 0, CELL, CELL, WHITENESS);
            SetPolyFillMode(memory, mode);
            Polygon(memory, QUADS[index].pts, 4);
            GetBitmapBits(canvas, (LONG)sizeof(bits), bits);

            wsprintf(probeArgs, "\"%s\",esc=%d,mode=%d,pts=%d:%d:%d:%d:%d:%d:%d:%d",
                     QUADS[index].tag, QUADS[index].esc, mode,
                     QUADS[index].pts[0].x, QUADS[index].pts[0].y,
                     QUADS[index].pts[1].x, QUADS[index].pts[1].y,
                     QUADS[index].pts[2].x, QUADS[index].pts[2].y,
                     QUADS[index].pts[3].x, QUADS[index].pts[3].y);
            writeInk();
            probe("polygon ink", probeArgs, probeResult);
        }
    }

    /* The outline, which the null pen above leaves out. A black pen with the
     * null brush gives the outline alone; with the black brush, the outline
     * and the fill together, which says whether the two cover the same edge.
     */
    probeNote("Polygon with a black pen, alone and over the fill");
    SetPolyFillMode(memory, ALTERNATE);
    SelectObject(memory, GetStockObject(BLACK_PEN));

    for (index = 0; index < (int)(sizeof(QUADS) / sizeof(QUADS[0])); index++) {
        for (mode = 0; mode < 2; mode++) {
            PatBlt(memory, 0, 0, CELL, CELL, WHITENESS);
            SelectObject(memory, GetStockObject(mode ? BLACK_BRUSH : NULL_BRUSH));
            Polygon(memory, QUADS[index].pts, 4);
            GetBitmapBits(canvas, (LONG)sizeof(bits), bits);

            wsprintf(probeArgs, "\"%s\",esc=%d,brush=%s,pts=%d:%d:%d:%d:%d:%d:%d:%d",
                     QUADS[index].tag, QUADS[index].esc, mode ? (LPSTR)"black" : (LPSTR)"null",
                     QUADS[index].pts[0].x, QUADS[index].pts[0].y,
                     QUADS[index].pts[1].x, QUADS[index].pts[1].y,
                     QUADS[index].pts[2].x, QUADS[index].pts[2].y,
                     QUADS[index].pts[3].x, QUADS[index].pts[3].y);
            writeInk();
            probe("polygon outlined", probeArgs, probeResult);
        }
    }

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
