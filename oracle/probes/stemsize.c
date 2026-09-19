/*
 * Where a stock glyph's stem lands, swept in size on both kinds of pixel.
 *
 * Replaying `bands` on an EGA leaves three of stock Courier New at a cell of a
 * hundred and eighty: `g`, `n` and `w` come out one or two columns across from
 * where Windows puts them. `n` is a whole-glyph pixel -- every one of its
 * seventy-two inked rows is one over -- and `g` and `w` move only part of
 * themselves, so it is not one shift but three placements.
 *
 * The side bearing is not it: all three have a bearing equal to their `xMin`,
 * so nothing is carried. What is left is the hint program under a horizontal
 * size of two hundred and twenty-four pixels per em, against a vertical one of
 * a hundred and sixty-seven.
 *
 * `bands` has four sizes and cannot say whether that is the stretch or just the
 * horizontal size being large, because on a VGA it never asks for one that big.
 * So sweep the cell finely on both displays and up to a size where a square
 * pixel reaches the same horizontal em. If a VGA at a cell of two hundred and
 * forty is wrong in the same way, it is the size; if it is right, it is the
 * stretch.
 *
 * No fabrication: these are the shipped glyphs.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\STEMSIZE.OUT"

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
    static const char CHARS[] = "gnwmoBE";

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
    probeNote("stock Courier New, every fourth cell from a hundred and twenty to two hundred and fifty-two");

    for (height = 120; height <= 252; height += 4) {
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
