/*
 * widths -- the `lfWidth` field, which nothing had ever recorded.
 *
 * A request may name an average character width as well as a height, and GDI
 * answers by stretching or squeezing the face horizontally: for an outline,
 * a horizontal pixel size chosen from the width and the face's own average
 * advance; for a strike, whatever it does. Every glyph recorded before this
 * asked for a width of nought. This sweeps the width at two heights over the
 * three regular outline faces and one strike family, and records the metrics
 * Windows reports beside the glyphs, in a sixty-four pixel cell so a stretched
 * glyph fits.
 */

#include <windows.h>

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\WIDTHS.OUT"

#define CELL_WIDTH  64
#define CELL_HEIGHT 64
#define ROW_BYTES   8
#define CELL_BYTES  (ROW_BYTES * CELL_HEIGHT)

static HDC memory;
static HBITMAP canvas;
static char bits[CELL_BYTES];

static const char HEX[] = "0123456789abcdef";

static const char WIDE[] = "ABEKMNRSWXZabdefgjkmnostwy0123456789";

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
        *at++ = HEX[(bits[index] >> 4) & 0x0f];
        *at++ = HEX[bits[index] & 0x0f];
    }

    *at = '\0';

    wsprintf(probeArgs, "%s,'%c'", (LPSTR)name, character);
    probe("glyph", probeArgs, probeResult);

    SelectObject(memory, previous);
}

/* The glyphs at one height and width, and the metrics Windows reports for it
 * in the font probe's records. */
static void probeWidth(LPCSTR face, int height, int width, LPCSTR chars)
{
    HFONT font = CreateFont(height, width, 0, 0, FW_NORMAL, 0, 0, 0,
                            ANSI_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                            DEFAULT_QUALITY, DEFAULT_PITCH, face);
    HFONT previous;
    TEXTMETRIC tm;
    char name[80];
    char resolved[64];
    int index;

    if (font == NULL) {
        return;
    }

    previous = (HFONT)SelectObject(memory, font);
    GetTextMetrics(memory, &tm);
    GetTextFace(memory, sizeof(resolved), resolved);
    SelectObject(memory, previous);

    wsprintf(probeArgs,
             "\"%s\",h=%d,w=%d,weight=400,italic=0,under=0,strike=0,charset=0,pitch=0",
             (LPSTR)face, height, width);
    wsprintf(probeResult, "\"%s\"", (LPSTR)resolved);
    probe("CreateFont face", probeArgs, probeResult);
    wsprintf(probeResult, "height=%d,ascent=%d,descent=%d,internal=%d,external=%d",
             tm.tmHeight, tm.tmAscent, tm.tmDescent, tm.tmInternalLeading,
             tm.tmExternalLeading);
    probe("CreateFont heights", probeArgs, probeResult);
    wsprintf(probeResult, "ave=%d,max=%d,weight=%d,overhang=%d",
             tm.tmAveCharWidth, tm.tmMaxCharWidth, tm.tmWeight, tm.tmOverhang);
    probe("CreateFont widths", probeArgs, probeResult);

    wsprintf(name, "\"%s\",h=%d,w=%d,weight=400,italic=0,cell=64", (LPSTR)face, height, width);

    for (index = 0; chars[index]; index++) {
        probeGlyph(name, font, chars[index]);
    }

    DeleteObject(font);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static const char *FACES[] = { "Arial", "Times New Roman", "Courier New" };
    static const int AT16[] = { 0, 3, 4, 5, 6, 7, 8, 10, 12, 16 };
    static const int AT24[] = { 0, 5, 7, 9, 10, 11, 12, 14, 16, 20 };
    HDC screen;
    int face;
    int index;

    probeOpen(OUTPUT);

    screen = GetDC(NULL);
    memory = CreateCompatibleDC(screen);

    canvas = CreateBitmap(CELL_WIDTH, CELL_HEIGHT, 1, 1, NULL);

    if (memory == NULL || canvas == NULL) {
        probe("CreateBitmap", "64x64x1", "failed");
        probeFinish();
        return 0;
    }

    SelectObject(memory, canvas);

    probeNote("the outline faces, the width swept at sixteen and twenty-four pixels");
    for (face = 0; face < 3; face++) {
        for (index = 0; index < sizeof(AT16) / sizeof(AT16[0]); index++) {
            probeWidth(FACES[face], 16, AT16[index], WIDE);
        }

        for (index = 0; index < sizeof(AT24) / sizeof(AT24[0]); index++) {
            probeWidth(FACES[face], 24, AT24[index], WIDE);
        }
    }

    probeNote("a strike family, for what a width does to a bitmap");
    for (index = 0; index < sizeof(AT16) / sizeof(AT16[0]); index++) {
        probeWidth("MS Sans Serif", 16, AT16[index], "ABKMWagjmy1");
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
