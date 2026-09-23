/*
 * The rectangle the ground is painted over, swept.
 *
 * `textbk` drew four faces at four cells and found the ground running from the
 * pen for the string's advance -- except at three of the sixteen, where it is a
 * column wider, and at one of those it starts a column to the *left* of the
 * pen. `groundw` says the advance is not the reason: `GetTextExtent` and
 * `GetCharWidth` both answer what this side computes at all three.
 *
 * The text is painted in the background's own colour, so the glyph adds nothing
 * and what comes back is the rectangle and nothing else. Four faces, every cell
 * from eight to forty-eight, and a character whose ink is known to reach past
 * its advance in at least one of them.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\GROUNDBX.OUT"

#define CELL_WIDTH  64
#define CELL_HEIGHT 64
#define ROW_BYTES   8
#define CELL_BYTES  (ROW_BYTES * CELL_HEIGHT)

static HDC memory;
static HBITMAP canvas;
static char bits[CELL_BYTES];

static const char HEX[] = "0123456789abcdef";

static void probeCell(LPCSTR face, int height, char character)
{
    HFONT font;
    HFONT previous;
    LPSTR at;
    int index;
    char text[2];

    font = CreateFont(height, 0, 0, 0, FW_NORMAL, 0, 0, 0, ANSI_CHARSET,
                      OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                      DEFAULT_QUALITY, DEFAULT_PITCH, face);

    wsprintf(probeArgs, "\"%s\",h=%d,'%c'", (LPSTR)face, height, character);

    if (font == NULL) {
        probe("ground", probeArgs, "no font");
        return;
    }

    previous = (HFONT)SelectObject(memory, font);

    PatBlt(memory, 0, 0, CELL_WIDTH, CELL_HEIGHT, WHITENESS);

    /* Both black, so only the rectangle shows. The pen is two columns in, as
     * every other glyph probe puts it, which leaves room for a rectangle that
     * reaches to the left of it -- the most any of these does is one column. */
    SetTextColor(memory, RGB(0, 0, 0));
    SetBkColor(memory, RGB(0, 0, 0));
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

    probe("ground", probeArgs, probeResult);

    SelectObject(memory, previous);
    DeleteObject(font);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static const char *FACES[] = { "MS Sans Serif", "Arial", "Courier New", "System", NULL };
    static const char CHARS[] = "AWl ";

    HDC screen;
    int face;
    int height;
    int index;

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

    probeNote("the ground rectangle alone, four faces, every cell from eight to forty-eight");

    for (face = 0; FACES[face]; face++) {
        for (height = 8; height <= 48; height++) {
            for (index = 0; CHARS[index]; index++) {
                probeCell(FACES[face], height, CHARS[index]);
            }
        }
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
