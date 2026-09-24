/*
 * `lfEscapement`, which nothing on this side has ever read.
 *
 * `CreateFont` takes an angle in tenths of a degree and our implementation
 * throws it away with a comment saying so. Before anything can rotate, four
 * things want measuring, and none of them is guessable:
 *
 *     which faces rotate at all   a strike cannot be turned; an outline can,
 *                                 and a vector font is drawn from lines
 *     which way the angle goes    counter-clockwise from the x axis, or the
 *                                 other way, and from which axis
 *     whether it is snapped       to a right angle, to the nearest degree, or
 *                                 honoured as it is given
 *     what the mapper does        a request that cannot be honoured may come
 *                                 back as a different face, or upright
 *
 * So: six faces -- a strike, three outlines and two vector fonts -- swept over
 * thirteen angles, with the face and metrics recorded beside the pixels. The
 * pen sits in the middle of the cell so the text can leave it in any direction
 * and still be caught, the mode is `TRANSPARENT` and the text black on white,
 * so the ink is the whole of what comes back.
 *
 * `lfOrientation` is asked separately at the end. It is a second angle, for
 * the character's own upright against the baseline, and whether Windows 3.1
 * reads it at all is exactly the sort of thing that cannot be assumed.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\ROTATE.OUT"

#define CELL_WIDTH  64
#define CELL_HEIGHT 64
#define ROW_BYTES   8
#define CELL_BYTES  (ROW_BYTES * CELL_HEIGHT)

#define PEN_X 32
#define PEN_Y 32

static HDC memory;
static HBITMAP canvas;
static char bits[CELL_BYTES];

static const char HEX[] = "0123456789abcdef";

static const char SPECIMEN[] = "AB";

/* The ink is where a bit is clear: the cell is filled white, which sets every
 * bit, and the text is drawn black. */
static int inkAt(int column, int row)
{
    unsigned char value = (unsigned char)bits[row * ROW_BYTES + (column >> 3)];

    return (value & (0x80 >> (column & 7))) == 0;
}

static void probeDraw(LPCSTR face, int height, int escapement, int orientation)
{
    TEXTMETRIC tm;
    HFONT font;
    HFONT previous;
    DWORD extent;
    char picked[LF_FACESIZE];
    LPSTR at;
    int index;
    int column;
    int row;
    int left;
    int top;
    int right;
    int bottom;
    int count;

    wsprintf(probeArgs, "\"%s\",h=%d,esc=%d,ori=%d",
             (LPSTR)face, height, escapement, orientation);

    font = CreateFont(height, 0, escapement, orientation, FW_NORMAL, 0, 0, 0,
                      ANSI_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                      DEFAULT_QUALITY, DEFAULT_PITCH, face);

    if (font == NULL) {
        probe("rotate face", probeArgs, "no font");
        return;
    }

    previous = (HFONT)SelectObject(memory, font);

    GetTextFace(memory, LF_FACESIZE, picked);
    GetTextMetrics(memory, &tm);
    extent = GetTextExtent(memory, SPECIMEN, lstrlen(SPECIMEN));

    wsprintf(probeResult,
             "face=\"%s\",height=%d,ascent=%d,descent=%d,internal=%d,"
             "average=%d,maximum=%d,pitch=%u,extent=%d:%d",
             (LPSTR)picked, tm.tmHeight, tm.tmAscent, tm.tmDescent,
             tm.tmInternalLeading, tm.tmAveCharWidth, tm.tmMaxCharWidth,
             (UINT)tm.tmPitchAndFamily, LOWORD(extent), HIWORD(extent));
    probe("rotate face", probeArgs, probeResult);

    PatBlt(memory, 0, 0, CELL_WIDTH, CELL_HEIGHT, WHITENESS);

    SetTextColor(memory, RGB(0, 0, 0));
    SetBkColor(memory, RGB(255, 255, 255));
    SetBkMode(memory, TRANSPARENT);

    TextOut(memory, PEN_X, PEN_Y, SPECIMEN, lstrlen(SPECIMEN));

    GetBitmapBits(canvas, (LONG)CELL_BYTES, bits);

    left = CELL_WIDTH;
    top = CELL_HEIGHT;
    right = -1;
    bottom = -1;
    count = 0;

    for (row = 0; row < CELL_HEIGHT; row++) {
        for (column = 0; column < CELL_WIDTH; column++) {
            if (!inkAt(column, row)) {
                continue;
            }

            count++;

            if (column < left)   { left = column; }
            if (column > right)  { right = column; }
            if (row < top)       { top = row; }
            if (row > bottom)    { bottom = row; }
        }
    }

    /* The box is for reading; the bitmap below is what is compared. */
    wsprintf(probeResult, "box=%d:%d:%d:%d,ink=%d", left, top, right, bottom, count);
    probe("rotate box", probeArgs, probeResult);

    at = probeResult;

    for (index = 0; index < CELL_BYTES; index++) {
        unsigned char value = (unsigned char)bits[index];

        *at++ = HEX[(value >> 4) & 0x0f];
        *at++ = HEX[value & 0x0f];
    }

    *at = '\0';

    probe("rotate ink", probeArgs, probeResult);

    SelectObject(memory, previous);
    DeleteObject(font);
}

static void sweep(LPCSTR face, int height)
{
    /* Right angles first, because they are the ones a driver might special
     * case; then the angles between them, and the ones outside nought to a
     * full turn, which the field is free to carry. */
    probeDraw(face, height, 0, 0);
    probeDraw(face, height, 900, 900);
    probeDraw(face, height, 1800, 1800);
    probeDraw(face, height, 2700, 2700);
    probeDraw(face, height, 450, 450);
    probeDraw(face, height, 1350, 1350);
    probeDraw(face, height, 2250, 2250);
    probeDraw(face, height, 3150, 3150);
    probeDraw(face, height, 100, 100);
    probeDraw(face, height, 300, 300);
    probeDraw(face, height, 600, 600);
    probeDraw(face, height, -900, -900);
    probeDraw(face, height, 3600, 3600);
    probeDraw(face, height, 4500, 4500);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HDC screen;

    probeOpen(OUTPUT);

    screen = GetDC(NULL);
    memory = CreateCompatibleDC(screen);
    canvas = CreateBitmap(CELL_WIDTH, CELL_HEIGHT, 1, 1, NULL);

    if (memory == NULL || canvas == NULL) {
        probe("setup", "64x64x1", "failed");
        probeFinish();
        return 0;
    }

    SelectObject(memory, canvas);

    probeNote("lfEscapement swept over thirteen angles in six faces");

    sweep("MS Sans Serif", 16);
    sweep("Arial", 16);
    sweep("Times New Roman", 16);
    sweep("Courier New", 16);
    sweep("Modern", 16);
    sweep("Roman", 16);

    /* A strike at a size it has, and an outline large enough that a fraction
     * of a degree would show, so that "snapped to a right angle" and "rounded
     * to something coarse" can be told apart. */
    probeNote("the same angles at a larger size, where a coarse rounding would show");

    sweep("Arial", 32);

    /* And the second angle on its own. Escapement without orientation, and
     * orientation without escapement, in a face that rotates and in one that
     * cannot. */
    probeNote("lfOrientation apart from lfEscapement");

    probeDraw("Arial", 16, 0, 900);
    probeDraw("Arial", 16, 900, 0);
    probeDraw("Arial", 16, 450, 900);
    probeDraw("Arial", 16, 900, 450);
    probeDraw("Arial", 16, 0, 450);
    probeDraw("Modern", 16, 0, 900);
    probeDraw("Modern", 16, 900, 0);
    probeDraw("MS Sans Serif", 16, 0, 900);
    probeDraw("MS Sans Serif", 16, 900, 0);

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
