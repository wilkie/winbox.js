/*
 * The turn read off a square rather than fitted to a letter.
 *
 * 8u draws every oblique angle within a pixel or two of Windows and exact at
 * none of them, and a letter cannot say which part is wrong. Recorded against
 * the `rot-square` fabrication -- Symbol with its letters replaced by one plain
 * square of known design coordinates and no hint program -- the ink box at each
 * angle is the transform itself, with nothing hinted or curved in the way.
 *
 * Three sweeps:
 *
 *     every ten degrees        the shape of the map from angle to box
 *     a degree at a time near  where a box steps, which is what pins the
 *       a half right angle     rounding rather than the formula
 *     the pen across a pixel   whether the origin is rounded, and to what
 *
 * A second character is drawn beside the first in one sweep, because where the
 * pen lands after a turned advance is a separate question from where the first
 * glyph goes, and the single character cannot ask it.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\ROTSQ.OUT"

#define CELL_WIDTH  64
#define CELL_HEIGHT 64
#define ROW_BYTES   8
#define CELL_BYTES  (ROW_BYTES * CELL_HEIGHT)

static HDC memory;
static HBITMAP canvas;
static char bits[CELL_BYTES];

static int inkAt(int column, int row)
{
    unsigned char value = (unsigned char)bits[row * ROW_BYTES + (column >> 3)];

    return (value & (0x80 >> (column & 7))) == 0;
}

static void probeSquare(int height, int escapement, int penX, int penY, LPCSTR text)
{
    HFONT font;
    HFONT previous;
    TEXTMETRIC tm;
    int column;
    int row;
    int left = CELL_WIDTH;
    int top = CELL_HEIGHT;
    int right = -1;
    int bottom = -1;
    int count = 0;

    wsprintf(probeArgs, "h=%d,esc=%d,pen=%d:%d,text=\"%s\"",
             height, escapement, penX, penY, (LPSTR)text);

    font = CreateFont(height, 0, escapement, escapement, FW_NORMAL, 0, 0, 0,
                      SYMBOL_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                      DEFAULT_QUALITY, DEFAULT_PITCH, "Symbol");

    if (font == NULL) {
        probe("square box", probeArgs, "no font");
        return;
    }

    previous = (HFONT)SelectObject(memory, font);

    GetTextMetrics(memory, &tm);

    PatBlt(memory, 0, 0, CELL_WIDTH, CELL_HEIGHT, WHITENESS);

    SetTextColor(memory, RGB(0, 0, 0));
    SetBkColor(memory, RGB(255, 255, 255));
    SetBkMode(memory, TRANSPARENT);

    TextOut(memory, penX, penY, text, lstrlen(text));

    GetBitmapBits(canvas, (LONG)CELL_BYTES, bits);

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

    wsprintf(probeResult, "box=%d:%d:%d:%d,ink=%d,ppem=%d",
             left, top, right, bottom, count, tm.tmHeight - tm.tmInternalLeading);
    probe("square box", probeArgs, probeResult);

    {
        LPSTR at = probeResult;
        int index;
        static const char HEX[] = "0123456789abcdef";

        for (index = 0; index < CELL_BYTES; index++) {
            unsigned char value = (unsigned char)bits[index];

            *at++ = HEX[(value >> 4) & 0x0f];
            *at++ = HEX[value & 0x0f];
        }

        *at = '\0';
    }

    probe("square ink", probeArgs, probeResult);

    SelectObject(memory, previous);
    DeleteObject(font);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HDC screen;
    int angle;
    int at;

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

    probeNote("a square with no program, turned: every ten degrees at three sizes");

    for (angle = 0; angle < 3600; angle += 100) {
        probeSquare(16, angle, 32, 32, "A");
        probeSquare(32, angle, 32, 32, "A");
    }

    probeNote("a degree at a time across a half right angle, where a box steps");

    for (angle = 430; angle <= 470; angle++) {
        probeSquare(32, angle, 32, 32, "A");
    }

    probeNote("the pen walked across a pixel, to read the origin's rounding");

    for (at = 28; at <= 36; at++) {
        probeSquare(32, 450, at, 32, "A");
        probeSquare(32, 450, 32, at, "A");
    }

    probeNote("two squares, so the turned advance can be read from the second");

    for (angle = 0; angle < 3600; angle += 300) {
        probeSquare(16, angle, 32, 32, "AB");
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
