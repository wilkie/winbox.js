/*
 * Whether a glyph too tall to rasterise in one go breaks where the band ends.
 *
 * A description of the font scaler's client interface says two things this
 * fixture could not otherwise see. Rasterising a glyph takes a scanline range
 * -- a band -- and the client may ask for one band at a time to save memory;
 * and of the two banding strategies offered, only the more expensive one "can
 * preserve dropout-control behaviour", which says the cheaper one loses it.
 *
 * If GDI bands, and if a band boundary loses whatever dropout control needs to
 * carry across it, then a stroke thin enough to be rescued on every scanline
 * should fail on one particular row -- the same device row for every glyph at
 * that size, wherever the boundary falls. Nothing else measured here would do
 * that: every rule found so far fails at a stroke's own ends, which move with
 * the stroke.
 *
 * The glyph probe cannot ask, because it draws at eight to twenty-two pixels
 * per em into a thirty-two pixel cell, which is one band by any plausible
 * reckoning. This one draws the same fabricated hairlines two hundred pixels
 * tall.
 *
 * What it records is a column profile rather than a bitmap. For each row, the
 * first inked column, or `ff` for a row with no ink at all. That is the whole
 * question -- a bar that breaks has a row of `ff` in the middle of a run -- and
 * it fits in the record format, which a two hundred row bitmap would not.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\BANDS.OUT"

/* Sixty-four pixels wide is eight bytes a row, so rows stay contiguous. Two
 * hundred tall is enough for a hairline several bands long at any band size
 * worth guessing at.
 */
#define CELL_WIDTH  64
#define CELL_HEIGHT 200
#define ROW_BYTES   8
#define CELL_BYTES  (ROW_BYTES * CELL_HEIGHT)

static HDC memory;
static HBITMAP canvas;
static char bits[CELL_BYTES];

static const char HEX[] = "0123456789abcdef";

/*
 * Draws one character tall and records where its ink is, row by row.
 *
 * The profile is one byte per row: the leftmost inked column, or 0xff if the
 * row is empty. A hairline standing upright gives the same column on every row
 * it occupies, so a break shows as `ff` between two identical values and needs
 * no interpretation.
 */
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

            /* A set bit is white, as the probe's background is, so ink is a
             * clear bit.
             */
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

/* One face at one size, over the characters a shape font fills. */
static void probeSize(LPCSTR face, int height)
{
    static const char WIDE[] = "ABEKMNRSWXZabdefgjkmnostwy0123456789";

    int index;
    char name[64];

    HFONT font = CreateFont(height, 0, 0, 0, FW_NORMAL, 0, 0, 0, ANSI_CHARSET,
                            OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                            DEFAULT_QUALITY, DEFAULT_PITCH, face);

    wsprintf(name, "\"%s\",h=%d,weight=400,italic=0", (LPSTR)face, height);

    for (index = 0; WIDE[index]; index++) {
        probeTall(name, font, WIDE[index]);
    }

    if (font) {
        DeleteObject(font);
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HDC screen;

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

    /* Four sizes an order of magnitude past anything else recorded. If a band
     * is thirty-two or sixty-four scanlines, the taller of these cross two or
     * three boundaries and the shortest crosses one.
     */
    /* Courier New switches dropout control off above forty-four pixels per em,
     * so it is the control: at these sizes a hairline that misses every pixel
     * centre is simply not drawn. Times New Roman keeps it to a hundred and
     * twenty-four, which is where the question can actually be asked.
     */
    probeNote("tall glyphs, to ask whether a band boundary breaks a rescued stroke");
    probeSize("Courier New", 60);
    probeSize("Courier New", 100);
    probeSize("Courier New", 140);
    probeSize("Courier New", 180);
    probeSize("Times New Roman", 60);
    probeSize("Times New Roman", 90);
    probeSize("Times New Roman", 120);
    probeSize("Times New Roman", 140);

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
