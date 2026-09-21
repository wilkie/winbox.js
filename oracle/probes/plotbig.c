/*
 * The plotter faces above forty pixels per em.
 *
 * `plotter` draws Modern, Roman and Script at every height from eight to forty
 * and the corpus is exact on all four displays. Above forty nothing has ever
 * asked, and these are a different path from everything `stemwide` and
 * `stemstyl` sweep: a stroke face has no outline to fill and no hint program to
 * run, and its glyphs are drawn as lines, with their own rules about which
 * pixel a line ends on and what a driver does at the edge of a cell.
 *
 * So sweep them the same way the outline faces were swept, and with the same
 * record -- the leftmost inked column of each row -- so the same adapter
 * replays it.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\PLOTBIG.OUT"

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
    /* Uprights, diagonals, a bowl and a descender, drawn as strokes. */
    static const char CHARS[] = "ABKMWagm";

    int index;
    char name[64];

    /* `OEM_CHARSET` is how these are reachable at all; see `plotter.c`. */
    HFONT font = CreateFont(height, 0, 0, 0, FW_NORMAL, 0, 0, 0, OEM_CHARSET,
                            OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                            DEFAULT_QUALITY, DEFAULT_PITCH, face);

    wsprintf(name, "\"%s\",h=%d,weight=400,italic=0,oem", (LPSTR)face, height);

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
    probeNote("the three plotter faces, every eighth cell from forty-eight to two hundred and forty-eight");

    for (height = 48; height <= 248; height += 8) {
        probeSize("Modern", height);
        probeSize("Roman", height);
        probeSize("Script", height);
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
