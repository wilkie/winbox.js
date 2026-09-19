/*
 * What the glyph buffer is twice of, asked at a cell that is not four bytes
 * wide.
 *
 * GDI refuses to draw a glyph whose bitmap will not fit the buffer it keeps for
 * one. `times-reach` and `cour-tall` measured that buffer at a cell eighteen
 * rows tall and pinned it at two cells' worth -- but every glyph they drew sat
 * in a cell narrow enough to pad to four bytes a row, where "twice the cell"
 * and "eight bytes a row of the cell" are the same number.
 *
 * `bands` is what says they are not the same rule: a hundred-row Courier cell
 * is twelve bytes across at a hundred and forty pixels and sixteen at a hundred
 * and eighty, and the flat eight refuses glyphs Windows plainly draws.
 *
 * This asks it directly. Every glyph of the fabrication carries the same two
 * shapes: a marker by the baseline, and a block twelve hundred units wide
 * standing above the ascender, where the cell clips it away. The block is never
 * seen -- it can only be counted -- so if the marker comes back the glyph was
 * drawn and if the bitmap is blank it was refused.
 *
 * The ten characters differ only in their advances, from `W` at 1933 units to
 * the apostrophe at 369. They carry an identical shape, so at a given size the
 * glyph's own bitmap is the same for all ten and only the cell differs. A limit
 * of eight bytes a row of the cell refuses all ten together, from about a cell
 * of fifty-nine on; twice the cell draws `W`, `M` and `A` at every size in the
 * sweep and lets the narrow ones come and go as the padding steps.
 *
 * Recorded against the bare fabrication as well -- the same marker with no
 * block -- which must be drawn at every size and says the probe is looking
 * where the marker is.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\BUFFER.OUT"

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

/* The ten advances, at one size. */
static void probeSize(int height)
{
    static const char CHARS[] = "WMAorIil.'";

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

    /* From well below where either rule refuses anything to well past where
     * both have refused everything they are going to. Fours are fine: the
     * quantity that steps is the padding of a row, which is thirty-two pixels.
     */
    probeNote("every cell from thirty to a hundred and ninety, at ten advances");

    for (height = 30; height <= 190; height += 4) {
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
