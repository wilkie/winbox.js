/*
 * The smear across a string in the cases `smearrun` left alone.
 *
 * Every bold glyph section 3 read was drawn with an opaque ground, one glyph
 * at a time; `smearrun` drew strings, and drew them transparent. The two rules
 * disagree about the last glyph's overhang, and the mode is one of the two
 * things that changed. This draws the same strings opaque, at every byte phase
 * of the pen, so that the mode is the only difference.
 *
 * And turned. `rotstyle` drew "AB" smeared at four angles and the `B` stood two
 * pixels further along than the plain one, not the one pixel it stands upright
 * -- but with two glyphs "two a glyph" and "one a glyph and one more" put the
 * `B` in the same place. Three glyphs tell them apart. Both modes, since the
 * upright rule turns on the mode.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\SMEARMOD.OUT"

#define WIDTH     128
#define HEIGHT    128
#define ROW_BYTES (WIDTH / 8)

static HDC memory;
static HBITMAP canvas;
static char bits[ROW_BYTES * HEIGHT];

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
    int left = WIDTH;
    int top = HEIGHT;
    int right = -1;
    int bottom = -1;

    for (row = 0; row < HEIGHT; row++) {
        for (column = 0; column < WIDTH; column++) {
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

static void probeRun(LPCSTR face, int height, int weight, LPCSTR text,
                     int mode, int escapement, int x, int y)
{
    HFONT font;
    HFONT previous;
    DWORD extent;

    font = CreateFont(height, 0, escapement, escapement, weight, 0, 0, 0,
                      lstrcmp(face, "Symbol") == 0 ? SYMBOL_CHARSET : ANSI_CHARSET,
                      OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                      DEFAULT_QUALITY, DEFAULT_PITCH, face);

    wsprintf(probeArgs, "\"%s\",h=%d,weight=%d,text=\"%s\",mode=%d,esc=%d,pen=%d:%d",
             (LPSTR)face, height, weight, (LPSTR)text, mode, escapement, x, y);

    if (font == NULL) {
        probe("smear ink", probeArgs, "no font");
        return;
    }

    previous = (HFONT)SelectObject(memory, font);

    /* The ground is the colour of the page, so an opaque draw shows only its
     * ink: what the mode changes is the glyphs, if anything. */
    PatBlt(memory, 0, 0, WIDTH, HEIGHT, WHITENESS);
    SetTextColor(memory, RGB(0, 0, 0));
    SetBkColor(memory, RGB(255, 255, 255));
    SetBkMode(memory, mode);

    TextOut(memory, x, y, text, lstrlen(text));
    GetBitmapBits(canvas, (LONG)sizeof(bits), bits);

    writeInk();

    extent = GetTextExtent(memory, text, lstrlen(text));
    wsprintf(probeResult + lstrlen(probeResult), ",extent=%d", LOWORD(extent));

    probe("smear ink", probeArgs, probeResult);

    SelectObject(memory, previous);
    DeleteObject(font);
}

static void probeFaces(int size, LPCSTR text, int mode, int escapement, int x, int y)
{
    probeRun("Arial", size, 600, text, mode, escapement, x, y);
    probeRun("Times New Roman", size, 600, text, mode, escapement, x, y);
    probeRun("Courier New", size, 600, text, mode, escapement, x, y);
    probeRun("Symbol", size, 700, text, mode, escapement, x, y);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static LPCSTR TEXTS[] = { "A", "AB", "ABA", "ll", "lll" };
    static const int ANGLES[] = { 300, 450, 900, 1800 };
    HDC screen;
    int size;
    int text;
    int pen;
    int angle;

    probeOpen(OUTPUT);

    screen = GetDC(NULL);
    memory = CreateCompatibleDC(screen);
    canvas = CreateBitmap(WIDTH, HEIGHT, 1, 1, NULL);

    if (memory == NULL || canvas == NULL) {
        probe("setup", "128x128x1", "failed");
        probeFinish();
        return 0;
    }

    SelectObject(memory, canvas);

    probeNote("smeared strings opaque upright, and turned in both modes");

    for (size = 16; size <= 24; size += 8) {
        for (text = 0; text < 5; text++) {
            for (pen = 8; pen < 16; pen++) {
                probeFaces(size, TEXTS[text], OPAQUE, 0, pen, 4);
            }

            for (angle = 0; angle < 4; angle++) {
                probeFaces(size, TEXTS[text], TRANSPARENT, ANGLES[angle], 64, 64);
                probeFaces(size, TEXTS[text], OPAQUE, ANGLES[angle], 64, 64);
            }
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
