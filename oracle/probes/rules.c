/*
 * The underline and the strikeout, which nothing has ever drawn.
 *
 * `LOGFONT` has `lfUnderline` and `lfStrikeOut`, and the corpus carries them
 * only through the metrics probes: `font` asks `CreateFont` for an underlined
 * face and records what `GetTextMetrics` says about it -- fifteen records of
 * `underlined` and `struckout` and their effect on the reported cell -- and
 * then nobody draws one. Whether GDI puts a rule under the text at all, how
 * thick it is, where it sits, and how far it runs are all unrecorded.
 *
 * They are not a property of the glyph, so they want asking of every kind of
 * face at once: a raster family, an outline family, a fixed-pitch outline and
 * the system face. The cell is sixty-four so that a forty pixel cell has room
 * below the baseline for the rule to be seen.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\RULES.OUT"

#define CELL_WIDTH  64
#define CELL_HEIGHT 64
#define ROW_BYTES   8
#define CELL_BYTES  (ROW_BYTES * CELL_HEIGHT)

static HDC memory;
static HBITMAP canvas;
static char bits[CELL_BYTES];

static const char HEX[] = "0123456789abcdef";

/* One character, and the whole cell written out a bit a pixel. */
static void probeGlyph(LPCSTR name, HFONT font, char character)
{
    HFONT previous;
    LPSTR at;
    int index;
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

    for (index = 0; index < CELL_BYTES; index++) {
        unsigned char value = (unsigned char)bits[index];

        *at++ = HEX[(value >> 4) & 0x0f];
        *at++ = HEX[value & 0x0f];
    }

    *at = '\0';

    wsprintf(probeArgs, "%s,'%c'", (LPSTR)name, character);
    probe("glyph", probeArgs, probeResult);

    SelectObject(memory, previous);
}

/* One face at one size, with and without each rule. */
static void probeSize(LPCSTR face, int height)
{
    static const char CHARS[] = "Ag";

    int under;
    int strike;
    int index;
    char name[96];

    for (under = 0; under <= 1; under++) {
        for (strike = 0; strike <= 1; strike++) {
            HFONT font = CreateFont(height, 0, 0, 0, FW_NORMAL, 0, (BYTE)under,
                                    (BYTE)strike, ANSI_CHARSET,
                                    OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                                    DEFAULT_QUALITY, DEFAULT_PITCH, face);

            wsprintf(name, "\"%s\",h=%d,weight=400,italic=0,under=%d,strike=%d,cell=64",
                     (LPSTR)face, height, under, strike);

            for (index = 0; CHARS[index]; index++) {
                probeGlyph(name, font, CHARS[index]);
            }

            if (font) {
                DeleteObject(font);
            }
        }
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static const int SIZES[] = { 10, 12, 16, 20, 24, 32, 40, 0 };

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

    probeNote("four kinds of face, seven sizes, each rule on and off");

    for (at = 0; SIZES[at]; at++) {
        probeSize("MS Sans Serif", SIZES[at]);
        probeSize("Arial", SIZES[at]);
        probeSize("Courier New", SIZES[at]);
        probeSize("System", SIZES[at]);
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
