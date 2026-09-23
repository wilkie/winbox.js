/*
 * Where a strike puts its strikeout.
 *
 * `rules` drew four kinds of face at seven sizes and settled both rules for an
 * outline face -- `post` for the underline, `OS/2` for the strikeout -- and
 * half of them for a strike: its underline sits one row below the baseline at
 * every size, with a thickness that follows the cell. Where the *strikeout*
 * goes did not follow the ascent, the cell or the descent in anything those
 * seven sizes could separate, and six distinct strikes is not many to fit a
 * rule to.
 *
 * So this is the same question asked of every raster face the installation has
 * and of the vector ones beside them, at eighteen sizes each: enough distinct
 * strikes that a rule has somewhere to fail. Each face is drawn twice, with the
 * strikeout off and on, and the rows that differ between the two are the rule.
 * One character is enough, since the band does not depend on it -- and it has
 * to be one whose ink keeps out of the way, or the rows the rule adds are not
 * the rows the rule covers.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\STRIKOUT.OUT"

#define CELL_WIDTH  64
#define CELL_HEIGHT 64
#define ROW_BYTES   8
#define CELL_BYTES  (ROW_BYTES * CELL_HEIGHT)

static HDC memory;
static HBITMAP canvas;
static char bits[CELL_BYTES];

static const char HEX[] = "0123456789abcdef";

static void probeCell(LPCSTR face, int height, int strike)
{
    HFONT font;
    HFONT previous;
    TEXTMETRIC tm;
    LPSTR at;
    int index;
    char resolved[64];

    font = CreateFont(height, 0, 0, 0, FW_NORMAL, 0, 0, (BYTE)strike, ANSI_CHARSET,
                      OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                      DEFAULT_QUALITY, DEFAULT_PITCH, face);

    wsprintf(probeArgs, "\"%s\",h=%d,strike=%d", (LPSTR)face, height, strike);

    if (font == NULL) {
        probe("band", probeArgs, "no font");
        return;
    }

    previous = (HFONT)SelectObject(memory, font);

    PatBlt(memory, 0, 0, CELL_WIDTH, CELL_HEIGHT, WHITENESS);
    SetTextColor(memory, RGB(0, 0, 0));
    SetBkColor(memory, RGB(255, 255, 255));
    SetBkMode(memory, OPAQUE);
    /* A full stop: its ink is a blob on the baseline and nothing anywhere
     * near the middle of the cell, so the rows the strikeout adds are the
     * rows the strikeout is. Drawn with `A` this sweep lost a row wherever
     * the rule landed on the crossbar. */
    TextOut(memory, 2, 0, ".", 1);

    GetBitmapBits(canvas, (LONG)CELL_BYTES, bits);

    at = probeResult;

    for (index = 0; index < CELL_BYTES; index++) {
        unsigned char value = (unsigned char)bits[index];

        *at++ = HEX[(value >> 4) & 0x0f];
        *at++ = HEX[value & 0x0f];
    }

    *at = '\0';

    probe("band", probeArgs, probeResult);

    /* The face that answered and the cell it was realised at, so the band can
     * be put beside the numbers `GetTextMetrics` reports for the same
     * request without guessing which strike came back. */
    if (strike == 0) {
        GetTextMetrics(memory, &tm);
        GetTextFace(memory, sizeof(resolved), resolved);
        wsprintf(probeResult, "face=\"%s\",height=%d,ascent=%d,descent=%d,internal=%d,external=%d",
                 (LPSTR)resolved, tm.tmHeight, tm.tmAscent, tm.tmDescent,
                 tm.tmInternalLeading, tm.tmExternalLeading);
        probe("band metrics", probeArgs, probeResult);
    }

    SelectObject(memory, previous);
    DeleteObject(font);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static const char *FACES[] = {
        "MS Sans Serif", "MS Serif", "Courier", "System", "Terminal",
        "Small Fonts", "Fixedsys", "Roman", "Modern", "Script", NULL
    };
    static const int SIZES[] = {
        8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 22, 24, 28, 32, 36, 40, 44, 48, 0
    };

    HDC screen;
    int face;
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

    probeNote("every raster and vector face, eighteen sizes, the strikeout off and on");

    for (face = 0; FACES[face]; face++) {
        for (at = 0; SIZES[at]; at++) {
            probeCell(FACES[face], SIZES[at], 0);
            probeCell(FACES[face], SIZES[at], 1);
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
