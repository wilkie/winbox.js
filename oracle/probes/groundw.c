/*
 * The width the ground is painted to, which is the width of the string.
 *
 * 8o found that `TextOut` paints the cell behind the glyph before the glyph,
 * and `textbk` measured the rectangle: it runs from the pen for the string's
 * advance. Three of its sixteen cells come out a column narrow on this side --
 * Arial at a cell of twelve, Courier New at twelve and at twenty-four -- and
 * the glyph inside the rectangle is right in all three, so the disagreement is
 * about the **width** and not about the ground.
 *
 * Three quantities could be that width and the corpus separates none of them:
 * what `GetTextExtent` answers for the string, what `GetCharWidth` answers for
 * the character, and the two of those plus `tmOverhang`. The `font` sweep
 * records extents only for its own ten character specimen, which has no `A` in
 * it, and `maxwidth` records the widest character of a face rather than a
 * named one.
 *
 * So ask all three of the same request, for the faces `textbk` draws and every
 * cell from eight to forty-eight, and for the characters a cell is likely to
 * disagree about: a wide one, a narrow one and a space.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\GROUNDW.OUT"

static HDC dc;

static void probeAsk(LPCSTR face, int height, char character)
{
    TEXTMETRIC tm;
    HFONT font;
    HFONT previous;
    DWORD extent;
    int widths[224];
    char text[2];

    wsprintf(probeArgs, "\"%s\",h=%d,'%c'", (LPSTR)face, height, character);

    font = CreateFont(height, 0, 0, 0, FW_NORMAL, 0, 0, 0, ANSI_CHARSET,
                      OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                      DEFAULT_QUALITY, DEFAULT_PITCH, face);

    if (font == NULL) {
        probe("width", probeArgs, "no font");
        return;
    }

    previous = (HFONT)SelectObject(dc, font);

    GetTextMetrics(dc, &tm);

    text[0] = character;
    text[1] = '\0';

    extent = GetTextExtent(dc, text, 1);

    if (!GetCharWidth(dc, 32, 255, widths)) {
        widths[(BYTE)character - 32] = -1;
    }

    wsprintf(probeResult, "extent=%d,charwidth=%d,overhang=%d,ave=%d",
             LOWORD(extent), widths[(BYTE)character - 32], tm.tmOverhang,
             tm.tmAveCharWidth);
    probe("width", probeArgs, probeResult);

    SelectObject(dc, previous);
    DeleteObject(font);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static const char *FACES[] = { "MS Sans Serif", "Arial", "Courier New", "System", NULL };
    static const char CHARS[] = "AWil ";

    int face;
    int height;
    int index;

    probeOpen(OUTPUT);

    dc = GetDC(NULL);

    probeNote("the extent, the character width and the overhang of one character");

    for (face = 0; FACES[face]; face++) {
        for (height = 8; height <= 48; height++) {
            for (index = 0; CHARS[index]; index++) {
                probeAsk(FACES[face], height, CHARS[index]);
            }
        }
    }

    ReleaseDC(NULL, dc);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
