/*
 * The ground behind a **run**, swept the way 8o swept it behind one character.
 *
 * `groundbx` drew one character over four faces and every cell from eight to
 * forty-eight, and settled the rectangle: the advance run from the glyph's own
 * left edge, united with the box it is blitted into. `extout` then drew two
 * characters and the rule did not carry over -- Arial's `AB` at a cell of
 * sixteen advances nine and nine and is painted over eighteen columns, and
 * Courier New's at twenty advances ten and ten and is painted over nineteen.
 * Seven records is not enough to say why.
 *
 * So this is the same instrument pointed at runs. The text is painted in the
 * background's own colour, so the glyphs add nothing and the rectangle is all
 * that comes back. Two strikes and two outline faces, ten cells each, and five
 * runs chosen for their bearings: a letter that bears nothing, a pair, a pair
 * of the narrowest letter there is, that letter beside the widest, and the
 * widest beside a plain one.
 *
 * And a handful through `ExtTextOut` with an advance array, because 8t found a
 * strike and an outline face answering that differently -- MS Sans Serif with
 * twenty and twenty painted over twenty-nine, which is the pens and the last
 * glyph's own advance, and Courier New over forty, which is the array's sum.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\GROUNDRN.OUT"

#define CELL_WIDTH  96
#define CELL_HEIGHT 56
#define ROW_BYTES   12
#define CELL_BYTES  (ROW_BYTES * CELL_HEIGHT)

#define PEN_X 8
#define PEN_Y 4

static HDC memory;
static HBITMAP canvas;
static char bits[CELL_BYTES];

static const char HEX[] = "0123456789abcdef";

static void writeCell(void)
{
    LPSTR at = probeResult;
    int index;

    GetBitmapBits(canvas, (LONG)CELL_BYTES, bits);

    for (index = 0; index < CELL_BYTES; index++) {
        unsigned char value = (unsigned char)bits[index];

        *at++ = HEX[(value >> 4) & 0x0f];
        *at++ = HEX[value & 0x0f];
    }

    *at = '\0';
}

static HFONT begin(LPCSTR face, int height)
{
    HFONT font = CreateFont(height, 0, 0, 0, FW_NORMAL, 0, 0, 0, ANSI_CHARSET,
                            OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                            DEFAULT_QUALITY, DEFAULT_PITCH, face);

    if (font == NULL) {
        return NULL;
    }

    SelectObject(memory, font);

    PatBlt(memory, 0, 0, CELL_WIDTH, CELL_HEIGHT, WHITENESS);

    /* Both black, so only the rectangle shows. */
    SetTextColor(memory, RGB(0, 0, 0));
    SetBkColor(memory, RGB(0, 0, 0));
    SetBkMode(memory, OPAQUE);

    return font;
}

static void probeRun(LPCSTR face, int height, LPCSTR run)
{
    HFONT font = begin(face, height);

    wsprintf(probeArgs, "\"%s\",h=%d,s=%s", (LPSTR)face, height, (LPSTR)run);

    if (font == NULL) {
        probe("run", probeArgs, "no font");
        return;
    }

    TextOut(memory, PEN_X, PEN_Y, run, lstrlen(run));

    writeCell();
    probe("run", probeArgs, probeResult);

    DeleteObject(font);
}

static void probeArray(LPCSTR face, int height, LPCSTR run, int first, int second)
{
    HFONT font = begin(face, height);
    int dx[2];

    dx[0] = first;
    dx[1] = second;

    wsprintf(probeArgs, "\"%s\",h=%d,s=%s,dx=%d:%d",
             (LPSTR)face, height, (LPSTR)run, first, second);

    if (font == NULL) {
        probe("run", probeArgs, "no font");
        return;
    }

    ExtTextOut(memory, PEN_X, PEN_Y, 0, NULL, run, 2, dx);

    writeCell();
    probe("run", probeArgs, probeResult);

    DeleteObject(font);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static const char *FACES[] = { "MS Sans Serif", "System", "Arial", "Courier New", NULL };
    static const char *RUNS[] = { "A", "AB", "ll", "lW", "WA", NULL };
    static const int SIZES[] = { 8, 10, 12, 14, 16, 20, 24, 32, 40, 48, 0 };

    HDC screen;
    int face;
    int at;
    int which;

    probeOpen(OUTPUT);

    screen = GetDC(NULL);
    memory = CreateCompatibleDC(screen);
    canvas = CreateBitmap(CELL_WIDTH, CELL_HEIGHT, 1, 1, NULL);

    if (memory == NULL || canvas == NULL) {
        probe("setup", "96x56x1", "failed");
        probeFinish();
        return 0;
    }

    SelectObject(memory, canvas);

    probeNote("the ground behind a run: four faces, ten cells, five runs, and an array");

    for (face = 0; FACES[face]; face++) {
        for (at = 0; SIZES[at]; at++) {
            for (which = 0; RUNS[which]; which++) {
                probeRun(FACES[face], SIZES[at], RUNS[which]);
            }
        }

        probeArray(FACES[face], 16, "AB", 20, 20);
        probeArray(FACES[face], 16, "AB", 4, 4);
        probeArray(FACES[face], 32, "AB", 20, 20);
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
