/*
 * The smear across a string, which section 3 measured one glyph at a time.
 *
 * A bold Windows has to make is drawn by smearing each glyph a column to the
 * right, and section 3 read the rule for one glyph out of GDI's memory: the
 * overhang column is drawn when it lies inside the glyph's bold cell and does
 * not begin a new byte of the destination row. `rotstyle` then drew "AB" and
 * found that rule does not survive a second glyph: Windows draws the first
 * glyph's overhang where the rule says not to, and drops the last one's where
 * the rule says to draw it -- and the last one stops at the pen plus the plain
 * advances in all three records that show it.
 *
 * Three records are not a rule. This draws strings of one to four glyphs,
 * smeared, in four faces at two cells, with the pen at every phase of a byte
 * -- the column the pen starts in modulo eight -- because the single-glyph rule
 * is a rule about bytes. Upright only: the rule lives there.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\SMEARRUN.OUT"

#define WIDTH     128
#define HEIGHT    48
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

static void probeRun(LPCSTR face, int height, int weight, LPCSTR text, int pen)
{
    HFONT font;
    HFONT previous;
    DWORD extent;

    font = CreateFont(height, 0, 0, 0, weight, 0, 0, 0,
                      lstrcmp(face, "Symbol") == 0 ? SYMBOL_CHARSET : ANSI_CHARSET,
                      OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                      DEFAULT_QUALITY, DEFAULT_PITCH, face);

    wsprintf(probeArgs, "\"%s\",h=%d,weight=%d,text=\"%s\",pen=%d",
             (LPSTR)face, height, weight, (LPSTR)text, pen);

    if (font == NULL) {
        probe("smear ink", probeArgs, "no font");
        return;
    }

    previous = (HFONT)SelectObject(memory, font);

    PatBlt(memory, 0, 0, WIDTH, HEIGHT, WHITENESS);
    SetTextColor(memory, RGB(0, 0, 0));
    SetBkColor(memory, RGB(255, 255, 255));
    SetBkMode(memory, TRANSPARENT);

    TextOut(memory, pen, 4, text, lstrlen(text));
    GetBitmapBits(canvas, (LONG)sizeof(bits), bits);

    writeInk();

    /* And what the string measures, which is the other number a clip could
     * be taken from. */
    extent = GetTextExtent(memory, text, lstrlen(text));
    wsprintf(probeResult + lstrlen(probeResult), ",extent=%d", LOWORD(extent));

    probe("smear ink", probeArgs, probeResult);

    SelectObject(memory, previous);
    DeleteObject(font);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static LPCSTR TEXTS[] = { "A", "AB", "ABA", "ABAB", "l", "ll", "lll", "W", "WW", "BA" };
    HDC screen;
    int size;
    int text;
    int pen;

    probeOpen(OUTPUT);

    screen = GetDC(NULL);
    memory = CreateCompatibleDC(screen);
    canvas = CreateBitmap(WIDTH, HEIGHT, 1, 1, NULL);

    if (memory == NULL || canvas == NULL) {
        probe("setup", "128x48x1", "failed");
        probeFinish();
        return 0;
    }

    SelectObject(memory, canvas);

    probeNote("smeared strings of one to four glyphs at every byte phase of the pen");

    for (size = 16; size <= 24; size += 8) {
        for (text = 0; text < 10; text++) {
            for (pen = 8; pen < 16; pen++) {
                probeRun("Arial", size, 600, TEXTS[text], pen);
                probeRun("Times New Roman", size, 600, TEXTS[text], pen);
                probeRun("Courier New", size, 600, TEXTS[text], pen);
                probeRun("Symbol", size, 700, TEXTS[text], pen);
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
