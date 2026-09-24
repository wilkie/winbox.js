/*
 * Where the pen goes along a turned baseline, read off squares.
 *
 * `rotsq` settled where a single turned glyph lands and what shape it is: the
 * baseline origin is the pen carried by the ascent along the exact angle and
 * rounded to a pixel, and the outline goes through a matrix whose entries are
 * the size times the cosine and sine, each rounded to a whole pixel. What it
 * cannot settle is the *second* glyph, because it drew only eight pairs, and
 * eight pairs are not enough to choose between the ways a pen can walk: along
 * the exact angle or the rounded one, by the fitted advance or the design one,
 * rounded at every step or only once at the end.
 *
 * So this draws the `rot-square` fabrication -- every letter one plain square
 * with no program, all advancing alike -- as one, two and three squares, at
 * four cell heights and every five degrees that is not a right angle. The
 * canvas is large enough that nothing leaves it, and only the ink inside its
 * own box is written down, row by row, so that a record stays small.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\ROTPEN.OUT"

#define CELL      160
#define ROW_BYTES (CELL / 8)
#define PEN       80

static HDC memory;
static HBITMAP canvas;
static char bits[ROW_BYTES * CELL];

static const char HEX[] = "0123456789abcdef";

static int inkAt(int column, int row)
{
    unsigned char value = (unsigned char)bits[row * ROW_BYTES + (column >> 3)];

    return (value & (0x80 >> (column & 7))) == 0;
}

static void probePen(int height, int escapement, LPCSTR text)
{
    HFONT font;
    HFONT previous;
    TEXTMETRIC tm;
    LPSTR at;
    int column;
    int row;
    int left = CELL;
    int top = CELL;
    int right = -1;
    int bottom = -1;

    wsprintf(probeArgs, "h=%d,esc=%d,text=\"%s\"", height, escapement, (LPSTR)text);

    font = CreateFont(height, 0, escapement, escapement, FW_NORMAL, 0, 0, 0,
                      SYMBOL_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                      DEFAULT_QUALITY, DEFAULT_PITCH, "Symbol");

    if (font == NULL) {
        probe("pen ink", probeArgs, "no font");
        return;
    }

    previous = (HFONT)SelectObject(memory, font);

    GetTextMetrics(memory, &tm);

    PatBlt(memory, 0, 0, CELL, CELL, WHITENESS);

    SetTextColor(memory, RGB(0, 0, 0));
    SetBkColor(memory, RGB(255, 255, 255));
    SetBkMode(memory, TRANSPARENT);

    TextOut(memory, PEN, PEN, text, lstrlen(text));

    GetBitmapBits(canvas, (LONG)sizeof(bits), bits);

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

    /* The size and the ascent, then the box, then the box's rows as hex, one
     * nibble per four columns from the box's left edge. */
    wsprintf(probeResult, "ppem=%d,ascent=%d,box=%d:%d:%d:%d,rows=",
             tm.tmHeight - tm.tmInternalLeading, tm.tmAscent,
             left, top, right, bottom);

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
    }

    *at = '\0';

    probe("pen ink", probeArgs, probeResult);

    SelectObject(memory, previous);
    DeleteObject(font);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HDC screen;
    int height;
    int angle;

    probeOpen(OUTPUT);

    screen = GetDC(NULL);
    memory = CreateCompatibleDC(screen);
    canvas = CreateBitmap(CELL, CELL, 1, 1, NULL);

    if (memory == NULL || canvas == NULL) {
        probe("setup", "160x160x1", "failed");
        probeFinish();
        return 0;
    }

    SelectObject(memory, canvas);

    probeNote("one, two and three squares at every five degrees off the axes, four sizes");

    for (height = 24; height <= 48; height += 8) {
        for (angle = 50; angle < 3600; angle += 50) {
            if (angle % 900 == 0) {
                continue;
            }

            probePen(height, angle, "A");
            probePen(height, angle, "AB");
            probePen(height, angle, "ABA");
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
