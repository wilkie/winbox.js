/*
 * The three stroke faces, at every size rather than at seven.
 *
 * The glyph sweep draws Roman, Modern and Script at 8, 12, 16, 20, 24, 32 and
 * 40 pixels. That was chosen to cross each design's own height -- thirty-two
 * units for Roman and Modern, thirty-seven for Script -- and it is enough to
 * say whether a stroke font is drawn at all. It is not enough to say how a
 * design coordinate becomes a pixel.
 *
 * That question is now down to a single pixel. `Script`'s `j` at sixteen on a
 * Hercules puts a vertex at column one where scaling the design x by the ratio
 * the metrics imply -- the realised average width over the design's, seven over
 * seventeen here -- puts it at column two. The design value is -1, the scaled
 * value -0.41, and Windows is a whole pixel away from it, so this is not a
 * rounding question; something about the transform is wrong. One cell cannot
 * say what: searching a scale, an offset and a rounding mode against that one
 * cell admits 1,843 combinations.
 *
 * So this asks the same twelve characters at every height from eight to forty.
 * A design coordinate crosses a pixel boundary at a different size for every
 * value it takes, so a dense sweep in the size is a dense sweep in the
 * transform, and a rule that survives all of it is pinned rather than fitted.
 *
 * Roman slanted is here as well, because the slant is applied to the
 * coordinates rather than to the picture and so goes through the same
 * transform.
 *
 * Reachable only through `OEM_CHARSET`, as the other two probes have it: a
 * request in ANSI for any of these three names lands somewhere else entirely.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\PLOTTER.OUT"

#define CELL_WIDTH  32
#define CELL_HEIGHT 32
#define ROW_BYTES   4
#define CELL_BYTES  (ROW_BYTES * CELL_HEIGHT)

static HDC memory;
static HBITMAP canvas;
static char bits[CELL_BYTES];

static const char HEX[] = "0123456789abcdef";

/* Draws one character and records the pixels it left, exactly as the glyph
 * sweep does -- same cell, same origin, same record shape, so the two can be
 * compared record for record where they overlap.
 */
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

/* One face at every height in the range. */
static void probeEverySize(LPCSTR face, BYTE italic)
{
    static const char CHARS[] = "ABKMWagjmy1.";

    int height;
    int index;
    char name[64];

    for (height = 8; height <= 40; height++) {
        HFONT font = CreateFont(height, 0, 0, 0, FW_NORMAL, italic, 0, 0,
                                OEM_CHARSET, OUT_DEFAULT_PRECIS,
                                CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY,
                                DEFAULT_PITCH, face);

        wsprintf(name, "\"%s\",h=%d,weight=400,italic=%d,oem", (LPSTR)face, height,
                 (int)italic);

        for (index = 0; CHARS[index]; index++) {
            probeGlyph(name, font, CHARS[index]);
        }

        if (font) {
            DeleteObject(font);
        }
    }
}

int PASCAL WinMain(HANDLE instance, HANDLE previous, LPSTR command, int show)
{
    HDC screen;
    HBITMAP previousBitmap;

    probeOpen(OUTPUT);

    screen = GetDC(NULL);
    memory = CreateCompatibleDC(screen);
    canvas = CreateBitmap(CELL_WIDTH, CELL_HEIGHT, 1, 1, NULL);
    previousBitmap = (HBITMAP)SelectObject(memory, canvas);

    probeNote("the three stroke faces at every height from eight to forty");
    probeEverySize("Roman", 0);
    probeEverySize("Modern", 0);
    probeEverySize("Script", 0);

    probeNote("and the one of them Windows slants for itself");
    probeEverySize("Roman", 1);

    SelectObject(memory, previousBitmap);
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
