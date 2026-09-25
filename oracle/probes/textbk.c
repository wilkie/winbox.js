/*
 * The background a character is drawn on, which this has never been asked.
 *
 * `TextOut` paints the cell behind the glyph before it paints the glyph, in
 * the background colour, unless the background mode says not to. Every probe
 * in the corpus sets the background to white and leaves the mode at `OPAQUE`,
 * so the two have never been separated: a white rectangle painted onto a white
 * cell is indistinguishable from no rectangle at all, and the colour has never
 * been anything but the colour already there.
 *
 * `SetBkColor` is implemented on this side and `SetBkMode` is not, and the
 * drawing code paints the rectangle **white** whatever the colour says -- there
 * is a `TODO` beside it. So ask.
 *
 * The cell starts white and the text is black. With the background black:
 *
 *     OPAQUE        a black rectangle over the cell, the glyph lost in it
 *     TRANSPARENT   a white cell with a black glyph
 *
 * and with it white both come out the same, which is the control that says the
 * difference is the mode and not the colour.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\TEXTBK.OUT"

#define CELL_WIDTH  64
#define CELL_HEIGHT 64
#define ROW_BYTES   8
#define CELL_BYTES  (ROW_BYTES * CELL_HEIGHT)

static HDC memory;
static HBITMAP canvas;
static char bits[CELL_BYTES];

static const char HEX[] = "0123456789abcdef";

static void probeGlyph(LPCSTR name, HFONT font, char character, int mode, int dark, int brush)
{
    HFONT previous;
    HBRUSH before;
    LPSTR at;
    int index;
    char text[2];

    if (font == NULL) {
        return;
    }

    previous = (HFONT)SelectObject(memory, font);

    PatBlt(memory, 0, 0, CELL_WIDTH, CELL_HEIGHT, WHITENESS);

    SetTextColor(memory, RGB(0, 0, 0));
    SetBkColor(memory, dark ? RGB(0, 0, 0) : RGB(255, 255, 255));
    SetBkMode(memory, mode);
    before = (HBRUSH)SelectObject(memory, GetStockObject(brush ? BLACK_BRUSH : WHITE_BRUSH));

    text[0] = character;
    text[1] = '\0';

    TextOut(memory, 2, 0, text, 1);

    GetBitmapBits(canvas, (LONG)CELL_BYTES, bits);

    at = probeResult;

    for (index = 0; index < CELL_BYTES; index++) {
        unsigned char value = (unsigned char)bits[index];

        *at++ = HEX[(value >> 4) & 0x0f];
        *at++ = HEX[value & 0x0f];
    }

    *at = '\0';

    wsprintf(probeArgs, "%s,'%c'", (LPSTR)name, character);
    probe("glyph", probeArgs, probeResult);

    SelectObject(memory, before);
    SelectObject(memory, previous);
}

/*
 * Whether `TextOut` uses the selected brush at all. Every cell above is drawn
 * with the white stock brush on a white cell, where a fill with the brush
 * could not be seen. Here the brush is black and the background white, in
 * both modes: any ink beyond the glyph and its ground is the brush.
 */
static void probeBrush(LPCSTR face, int height)
{
    int mode;
    char name[96];

    for (mode = 0; mode <= 1; mode++) {
        HFONT font = CreateFont(height, 0, 0, 0, FW_NORMAL, 0, 0, 0,
                                ANSI_CHARSET, OUT_DEFAULT_PRECIS,
                                CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY,
                                DEFAULT_PITCH, face);

        wsprintf(name, "\"%s\",h=%d,weight=400,italic=0,back=0,opaque=%d,cell=64,brush=1",
                 (LPSTR)face, height, mode);

        probeGlyph(name, font, 'A', mode ? OPAQUE : TRANSPARENT, 0, 1);

        if (font) {
            DeleteObject(font);
        }
    }
}

static void probeSize(LPCSTR face, int height)
{
    int mode;
    int dark;
    char name[96];

    for (dark = 0; dark <= 1; dark++) {
        for (mode = 0; mode <= 1; mode++) {
            HFONT font = CreateFont(height, 0, 0, 0, FW_NORMAL, 0, 0, 0,
                                    ANSI_CHARSET, OUT_DEFAULT_PRECIS,
                                    CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY,
                                    DEFAULT_PITCH, face);

            wsprintf(name, "\"%s\",h=%d,weight=400,italic=0,back=%d,opaque=%d,cell=64",
                     (LPSTR)face, height, dark, mode);

            probeGlyph(name, font, 'A', mode ? OPAQUE : TRANSPARENT, dark, 0);

            if (font) {
                DeleteObject(font);
            }
        }
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static const int SIZES[] = { 12, 16, 24, 32, 0 };

    HDC screen;
    int at;

    probeOpen(OUTPUT);

    screen = GetDC(NULL);
    memory = CreateCompatibleDC(screen);
    canvas = CreateBitmap(CELL_WIDTH, CELL_HEIGHT, 1, 1, NULL);

    if (memory == NULL || canvas == NULL) {
        probe("setup", "64x64x1", "failed");
        probeFinish();
        return 0;
    }

    SelectObject(memory, canvas);

    probeNote("four faces, four sizes, each background colour and mode");

    for (at = 0; SIZES[at]; at++) {
        probeSize("MS Sans Serif", SIZES[at]);
        probeSize("Arial", SIZES[at]);
        probeSize("Courier New", SIZES[at]);
        probeSize("System", SIZES[at]);
    }

    probeNote("the same, with a black brush selected");
    probeBrush("MS Sans Serif", 16);
    probeBrush("Arial", 16);
    probeBrush("System", 16);

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
