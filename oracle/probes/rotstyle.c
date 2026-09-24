/*
 * Everything else that happens to turned text.
 *
 * 8u settled a turned glyph exactly, but only the plainest way of drawing
 * one: `TextOut`, a transparent ground, the default alignment, no rule, no
 * made-up style. Each of those has an upright answer measured elsewhere --
 * the ground in 8o, the rules in 8s, the alignment in 8p, the synthesised bold
 * and slant in section 3 -- and none of them has been asked turned. Whether
 * Windows turns each of them with the text, draws it upright, or drops it is
 * the question, and there is no reading of it that can be made from outside
 * without asking.
 *
 * So: Arial at two sizes and Courier New, five angles, and one variation at a
 * time -- the opaque ground, an underline, a strikeout, a synthesised bold, a
 * bold file, a synthesised slant (Symbol, which has no italic), each of the
 * alignments, and `ExtTextOut` with an opaque rectangle and with a clipping
 * one. The canvas is large enough that nothing leaves it; the ink box and its
 * rows are written down, as `rotpen` does.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\ROTSTYLE.OUT"

#define CELL      128
#define ROW_BYTES (CELL / 8)
#define PEN       64

static HDC memory;
static HBITMAP canvas;
static char bits[ROW_BYTES * CELL];

static const char HEX[] = "0123456789abcdef";

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

        /* A record must stay inside the buffer; a box this large is not
         * expected, and a truncated one says so rather than overrunning. */
        if (at - probeResult > 1900) {
            *at++ = '!';
            break;
        }
    }

    *at = '\0';
}

/*
 * One draw. `what` names the variation; the rest are its parameters:
 * the face, the cell, the angle, the weight, the italic, underline and
 * strikeout bytes, the background mode, the alignment, and for `ExtTextOut`
 * its options and rectangle relative to the pen.
 */
static void probeStyle(LPCSTR what, LPCSTR face, int height, int escapement,
                       int weight, int italic, int underline, int strikeout,
                       int mode, UINT align, UINT options, int dl, int dt, int dr, int db)
{
    HFONT font;
    HFONT previous;
    RECT box;

    wsprintf(probeArgs, "%s,\"%s\",h=%d,esc=%d,weight=%d,italic=%d,under=%d,strike=%d,"
             "mode=%d,align=%u,opt=%u,rect=%d:%d:%d:%d",
             (LPSTR)what, (LPSTR)face, height, escapement, weight, italic, underline,
             strikeout, mode, align, options, dl, dt, dr, db);

    font = CreateFont(height, 0, escapement, escapement, weight, (BYTE)italic,
                      (BYTE)underline, (BYTE)strikeout,
                      lstrcmp(face, "Symbol") == 0 ? SYMBOL_CHARSET : ANSI_CHARSET,
                      OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                      DEFAULT_QUALITY, DEFAULT_PITCH, face);

    if (font == NULL) {
        probe("style ink", probeArgs, "no font");
        return;
    }

    previous = (HFONT)SelectObject(memory, font);

    PatBlt(memory, 0, 0, CELL, CELL, WHITENESS);

    /* Black text on a black ground would say nothing about where the ground
     * is, so the ground is the background colour of a monochrome bitmap's
     * other value: the text is white on black when the mode is opaque. */
    if (mode == OPAQUE) {
        SetTextColor(memory, RGB(255, 255, 255));
        SetBkColor(memory, RGB(0, 0, 0));
    } else {
        SetTextColor(memory, RGB(0, 0, 0));
        SetBkColor(memory, RGB(255, 255, 255));
    }

    SetBkMode(memory, mode);
    SetTextAlign(memory, align);

    if (lstrcmp(what, "ext") == 0) {
        box.left = PEN + dl;
        box.top = PEN + dt;
        box.right = PEN + dr;
        box.bottom = PEN + db;
        ExtTextOut(memory, PEN, PEN, options, &box, "AB", 2, NULL);
    } else {
        TextOut(memory, PEN, PEN, "AB", 2);
    }

    GetBitmapBits(canvas, (LONG)sizeof(bits), bits);

    writeInk();
    probe("style ink", probeArgs, probeResult);

    SelectObject(memory, previous);
    DeleteObject(font);
}

static void sweep(LPCSTR face, int height)
{
    static const int ANGLES[] = { 0, 300, 450, 900, 1800 };
    int index;

    for (index = 0; index < 5; index++) {
        int esc = ANGLES[index];

        probeStyle("plain",  face, height, esc, 400, 0, 0, 0, TRANSPARENT, TA_TOP | TA_LEFT, 0, 0, 0, 0, 0);
        probeStyle("ground", face, height, esc, 400, 0, 0, 0, OPAQUE,      TA_TOP | TA_LEFT, 0, 0, 0, 0, 0);
        probeStyle("under",  face, height, esc, 400, 0, 1, 0, TRANSPARENT, TA_TOP | TA_LEFT, 0, 0, 0, 0, 0);
        probeStyle("strike", face, height, esc, 400, 0, 0, 1, TRANSPARENT, TA_TOP | TA_LEFT, 0, 0, 0, 0, 0);
        probeStyle("smear",  face, height, esc, 600, 0, 0, 0, TRANSPARENT, TA_TOP | TA_LEFT, 0, 0, 0, 0, 0);
        probeStyle("bold",   face, height, esc, 700, 0, 0, 0, TRANSPARENT, TA_TOP | TA_LEFT, 0, 0, 0, 0, 0);
        probeStyle("center", face, height, esc, 400, 0, 0, 0, TRANSPARENT, TA_TOP | TA_CENTER, 0, 0, 0, 0, 0);
        probeStyle("right",  face, height, esc, 400, 0, 0, 0, TRANSPARENT, TA_TOP | TA_RIGHT, 0, 0, 0, 0, 0);
        probeStyle("base",   face, height, esc, 400, 0, 0, 0, TRANSPARENT, TA_BASELINE | TA_LEFT, 0, 0, 0, 0, 0);
        probeStyle("bottom", face, height, esc, 400, 0, 0, 0, TRANSPARENT, TA_BOTTOM | TA_LEFT, 0, 0, 0, 0, 0);
        probeStyle("ext",    face, height, esc, 400, 0, 0, 0, TRANSPARENT, TA_TOP | TA_LEFT, ETO_OPAQUE, -4, -4, 20, 12);
        probeStyle("ext",    face, height, esc, 400, 0, 0, 0, TRANSPARENT, TA_TOP | TA_LEFT, ETO_CLIPPED, -20, -20, 8, 8);
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HDC screen;
    static const int ANGLES[] = { 0, 300, 450, 900, 1800 };
    int index;

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

    probeNote("turned text with the ground, the rules, the styles and the alignments");

    sweep("Arial", 16);
    sweep("Arial", 24);
    sweep("Courier New", 16);

    /* A slant Windows has to make up: Symbol has no italic file. */
    for (index = 0; index < 5; index++) {
        probeStyle("slant", "Symbol", 16, ANGLES[index], 400, 1, 0, 0, TRANSPARENT, TA_TOP | TA_LEFT, 0, 0, 0, 0, 0);
        probeStyle("slant", "Symbol", 24, ANGLES[index], 400, 1, 0, 0, TRANSPARENT, TA_TOP | TA_LEFT, 0, 0, 0, 0, 0);
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
