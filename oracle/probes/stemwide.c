/*
 * The other three faces, swept over the same range `stemsize` swept one.
 *
 * `stemsize` took stock Courier New from a cell of a hundred and twenty to one
 * of two hundred and fifty-two and found a rule the recorded corpus could not
 * see: the control value cut-in does not apply to a `MIRP` that does not round.
 * Every glyph of that corpus is drawn at eight to forty pixels per em, and the
 * gap the cut-in decides only opens up above about a hundred and eighty.
 *
 * One face and seven characters is a thin sample to have found it in, and the
 * same region is unrecorded for every other face. So sweep it wider: Arial,
 * Times New Roman and Courier New, ten characters each, every eighth cell from
 * forty-eight to two hundred and forty-eight, on a square pixel and on one that
 * is not.
 *
 * The record is the same column profile, so the same adapter replays it.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\STEMWIDE.OUT"

#define CELL_WIDTH  64
#define CELL_HEIGHT 200
#define ROW_BYTES   8
#define CELL_BYTES  (ROW_BYTES * CELL_HEIGHT)

static HDC memory;
static HBITMAP canvas;
static char bits[CELL_BYTES];

static const char HEX[] = "0123456789abcdef";

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

static void probeSize(LPCSTR face, int height)
{
    /* Ten that between them have serifs, bowls, diagonals, a crossbar and a
     * descender -- the features a hint program has instructions for.
     */
    static const char CHARS[] = "AWagnwoseB";

    int index;
    char name[64];

    HFONT font = CreateFont(height, 0, 0, 0, FW_NORMAL, 0, 0, 0, ANSI_CHARSET,
                            OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                            DEFAULT_QUALITY, DEFAULT_PITCH, face);

    wsprintf(name, "\"%s\",h=%d,weight=400,italic=0", (LPSTR)face, height);

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

    /* From well inside where `bands` agrees to past where a square pixel
     * reaches the horizontal em an EGA reaches at a cell of a hundred and
     * eighty. Fours, then the crossing can be walked by ones if it wants it.
     */
    probeNote("three faces, every eighth cell from forty-eight to two hundred and forty-eight");

    for (height = 48; height <= 248; height += 8) {
        probeSize("Arial", height);
        probeSize("Times New Roman", height);
        probeSize("Courier New", height);
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
