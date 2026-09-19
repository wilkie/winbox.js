/*
 * The size at which dropout control stops.
 *
 * `bands` says a sub-pixel bar in a glyph whose box is wide is refused at every
 * size it asks -- sixty to a hundred and eighty pixels, which is fifty-two
 * pixels per em and up -- and that the same bar alone is drawn at all of them.
 * Everything about the bar and about its company has been swept and ruled out:
 * its height from three device rows to a hundred and eight, its position from
 * the bottom of the box to the top, an arm on it of six lengths at six heights,
 * and four different companions. None of it changes the answer.
 *
 * What has not been varied is the size. Every glyph of the recorded corpus is
 * drawn at eight to forty pixels per em and dropout control plainly works
 * there; every cell of `bands` is fifty-two and up and it plainly does not. A
 * threshold in between would explain all of it at once, and it would not be the
 * font's own: `SCANCTRL` says forty-four for Courier New and a hundred and
 * twenty-four for Times New Roman, and the two behave identically across the
 * whole of `bands`.
 *
 * So sweep the size finely across the gap and watch the ink stop. The bar is
 * the same bar the other recordings use, drawn from a font whose box is wide,
 * and the record is the same column profile: for each row, the leftmost inked
 * column, or `ff` for a row with none.
 *
 * Recorded twice -- once against the fabrication whose glyph is the bar alone,
 * which should be drawn at every size, and once against the one that carries a
 * ballast, which is the one in question. The first is the control that says the
 * bar is where the probe is looking.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\DROPSIZE.OUT"

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
    probeNote("every height from sixteen to seventy, to find where the rescue stops");

    for (height = 16; height <= 70; height += 2) {
        probeSize(height);
    }

    /* And one at a time across the crossing, which the twos step over: the
     * rescue is there at forty-seven pixels per em and gone at forty-nine, and
     * the height that gives forty-eight is an odd one.
     */
    probeNote("one at a time across the crossing");

    for (height = 49; height <= 61; height += 2) {
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
