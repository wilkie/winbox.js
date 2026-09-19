/*
 * The same sweep as `dropsize`, walked the other way.
 *
 * `dropsize` asks every size from sixteen upward, so each size is realized
 * having already drawn every smaller one. `scanleak` says that matters: on a
 * display whose pixel is not square, Times New Roman at a cell of sixty
 * rescues its sub-pixel bars when it is realized after the smaller sizes and
 * does not when it is realized cold, and whichever answer the first
 * realization gets is the one every later request for that size gets too.
 *
 * So walk the sizes down instead. Every size is then realized having seen only
 * larger ones, and any height where this and `dropsize` disagree is a height
 * whose answer is not a property of the size at all.
 *
 * Everything else is `dropsize` unchanged: the same twelve bars, the same two
 * fabrications, the same column profile.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\DROPDOWN.OUT"

#define CELL_WIDTH  64
#define CELL_HEIGHT 200
#define ROW_BYTES   8
#define CELL_BYTES  (ROW_BYTES * CELL_HEIGHT)

static HDC memory;
static HBITMAP canvas;
static char bits[CELL_BYTES];

static const char HEX[] = "0123456789abcdef";

/* Draws one character and writes down the leftmost inked column of each row. */
static void probeTall(LPCSTR name, HFONT font, char character)
{
    HFONT previous;
    LPSTR at;
    int row;
    int column;
    int byte;
    char text[2];

    if (font == NULL) {
        return;
    }

    previous = (HFONT)SelectObject(memory, font);

    PatBlt(memory, 0, 0, CELL_WIDTH, CELL_HEIGHT, WHITENESS);

    SetTextColor(memory, RGB(0, 0, 0));
    SetBkColor(memory, RGB(255, 255, 255));
    SetBkMode(memory, OPAQUE);

    text[0] = character;
    text[1] = '\0';

    TextOut(memory, 2, 0, text, 1);

    GetBitmapBits(canvas, (LONG)CELL_BYTES, bits);

    at = probeResult;

    for (row = 0; row < CELL_HEIGHT; row++) {
        int found = 0xff;

        for (column = 0; column < CELL_WIDTH && found == 0xff; column++) {
            byte = bits[row * ROW_BYTES + (column >> 3)] & 0xff;

            if ((byte & (0x80 >> (column & 7))) == 0) {
                found = column;
            }
        }

        *at++ = HEX[(found >> 4) & 0x0f];
        *at++ = HEX[found & 0x0f];
    }

    *at = '\0';

    wsprintf(probeArgs, "%s,'%c'", (LPSTR)name, character);
    probe("column", probeArgs, probeResult);

    SelectObject(memory, previous);
}

/*
 * The twelve bars of the sweep's first two phases, at one size.
 *
 * Twelve rather than thirty-six because the question is where the ink stops and
 * not which phase it stops at, and a fine sweep in the size costs records that
 * a fine sweep in the phase would only repeat.
 */
static void probeSize(int height)
{
    static const char CHARS[] = "ABEKMNRSWXZa";

    int index;
    char name[64];

    HFONT font = CreateFont(height, 0, 0, 0, FW_NORMAL, 0, 0, 0, ANSI_CHARSET,
                            OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                            DEFAULT_QUALITY, DEFAULT_PITCH, "Times New Roman");

    wsprintf(name, "\"Times New Roman\",h=%d,weight=400,italic=0", height);

    for (index = 0; CHARS[index]; index++) {
        probeTall(name, font, CHARS[index]);
    }

    if (font) {
        DeleteObject(font);
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HDC screen;
    int height;

    probeOpen(OUTPUT);

    screen = GetDC(NULL);
    memory = CreateCompatibleDC(screen);
    canvas = CreateBitmap(CELL_WIDTH, CELL_HEIGHT, 1, 1, NULL);

    if (memory == NULL || canvas == NULL) {
        probe("CreateBitmap", "64x200x1", "failed");
        probeFinish();
        return 0;
    }

    SelectObject(memory, canvas);

    /* Every size from well inside where the corpus works to well past where
     * `bands` says it has stopped. Two at a time is fine: the quantity that
     * matters is pixels per em, which moves by rather less than the height.
     */
    probeNote("every height from seventy down to sixteen, largest first");

    for (height = 70; height >= 16; height -= 2) {
        probeSize(height);
    }

    /* And one at a time across the crossing, which the twos step over: the
     * rescue is there at forty-seven pixels per em and gone at forty-nine, and
     * the height that gives forty-eight is an odd one.
     */
    probeNote("one at a time across the crossing, largest first");

    for (height = 61; height >= 49; height -= 2) {
        probeSize(height);
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
