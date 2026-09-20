/*
 * The styled files, where the half-size rule says the threshold moves.
 *
 * 8k says a glyph is fitted at half the size when the right edge of the box the
 * face declares, carried across the horizontal size, passes two hundred and
 * fifty-six pixels. The three regular faces gave that rule; the styled files
 * are a prediction, because they declare different boxes and so should cross at
 * different sizes:
 *
 *     Arial              xMax 2048     halves above 256.0 across
 *     Arial Bold         2048          256.0
 *     Arial Italic       2174          241.2
 *     Arial Bold Italic  2209          237.3
 *     Times New Roman    2066          253.8
 *     Times Bold         2067          253.6
 *     Times Italic       2020          259.5
 *     Times Bold Italic  2067          253.6
 *
 * Twenty pixels per em between the extremes, and Times Italic crossing *later*
 * than its own regular where Arial Italic crosses earlier -- which no rule
 * about the size could produce. The cells run either side of every one of them,
 * on a pixel that is not square where the horizontal size runs ahead of the
 * cell, and on one that is.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\STEMSTYL.OUT"

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

static void probeSize(LPCSTR face, int height, int weight, int italic)
{
    static const char CHARS[] = "AWagno";

    int index;
    char name[64];

    HFONT font = CreateFont(height, 0, 0, 0, weight, (BYTE)italic, 0, 0, ANSI_CHARSET,
                            OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                            DEFAULT_QUALITY, DEFAULT_PITCH, face);

    wsprintf(name, "\"%s\",h=%d,weight=%d,italic=%d", (LPSTR)face, height, weight, italic);

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
    /* The cells a non-square pixel crosses the thresholds at, and the taller
     * ones a square pixel needs for the same horizontal sizes.
     */
    probeNote("the styled files, either side of every threshold, on both kinds of cell");

    for (height = 190; height <= 234; height += 4) {
        probeSize("Arial", height, FW_BOLD, 0);
        probeSize("Arial", height, FW_NORMAL, 1);
        probeSize("Arial", height, FW_BOLD, 1);
        probeSize("Times New Roman", height, FW_BOLD, 0);
        probeSize("Times New Roman", height, FW_NORMAL, 1);
        probeSize("Times New Roman", height, FW_BOLD, 1);
    }

    for (height = 250; height <= 298; height += 4) {
        probeSize("Arial", height, FW_BOLD, 0);
        probeSize("Arial", height, FW_NORMAL, 1);
        probeSize("Arial", height, FW_BOLD, 1);
        probeSize("Times New Roman", height, FW_BOLD, 0);
        probeSize("Times New Roman", height, FW_NORMAL, 1);
        probeSize("Times New Roman", height, FW_BOLD, 1);
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
