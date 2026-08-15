/*
 * One character's advance, at every size.
 *
 * This probe exists to be pointed at a fabricated font. On a stock
 * installation it measures something already known -- `hdmx` tabulates the
 * same advances, and the `glyphs` probe draws the same letters -- and that is
 * the point: it is the control that says the channel works before anything is
 * asked through it.
 *
 * What it is for is the fabrications in `scripts/oracle/fabricate.mjs` that
 * rewrite a glyph's instructions to report an intermediate position as the
 * glyph's advance. A hinting program moves several dozen points and hands back
 * one number, and no API asks it where any of the others went. Moving the
 * advance phantom onto a point of interest turns the one number that does come
 * back into a window on any of them, at every size, in a single recording.
 *
 * The advance rather than the drawn pixels, because the advance is a number
 * and pixels are a picture. A picture has to be compared row by row and says
 * nothing about the sixty-fourths underneath it; a magnified advance says
 * exactly where a point landed, to whatever resolution the magnification was
 * built for.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\HINTING.OUT"

static HDC dc;

/*
 * Records the width of one character of one face at one size.
 *
 * `GetTextExtent` of a single character is its advance: there is no kerning in
 * a string of one and no overhang on a face that has not been synthesised.
 */
static void probeAdvance(LPCSTR face, int height, BYTE italic, char character)
{
    HFONT font;
    HFONT previous;
    TEXTMETRIC tm;
    DWORD extent;
    char text[2];

    text[0] = character;
    text[1] = '\0';

    wsprintf(probeArgs, "\"%s\",h=%d,italic=%d,'%c'", (LPSTR)face, height,
             (int)italic, character);

    font = CreateFont(height, 0, 0, 0, FW_NORMAL, italic, 0, 0, ANSI_CHARSET,
                      OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY,
                      DEFAULT_PITCH, face);

    if (font == NULL) {
        probe("advance", probeArgs, "no font");
        return;
    }

    previous = (HFONT)SelectObject(dc, font);

    /* The pixel size comes back with the advance because the advance is
     * meaningless without it: a fabricated glyph reports a position scaled to
     * the size it was hinted at, and reading it needs to know which size that
     * was. `tmHeight` minus the internal leading is that number.
     */
    GetTextMetrics(dc, &tm);
    extent = GetTextExtent(dc, text, 1);

    wsprintf(probeResult, "advance=%d,ppem=%d", LOWORD(extent),
             tm.tmHeight - tm.tmInternalLeading);
    probe("advance", probeArgs, probeResult);

    SelectObject(dc, previous);
    DeleteObject(font);
}

/*
 * Every size the interesting sizes are reachable through.
 *
 * A request is for a cell height and what comes out is a pixel size, and the
 * two are not the same number -- so a sweep wide enough to land on the sizes
 * `hdmx` tabulates is a sweep of nearly everything. Which cell height produced
 * which pixel size is recorded alongside each answer rather than worked out
 * here, because working it out here would be assuming the very mapping the
 * rest of the oracle exists to measure.
 */
static void probeSweep(LPCSTR face, BYTE italic, char character)
{
    int height;

    for (height = 8; height <= 110; height++) {
        probeAdvance(face, height, italic, character);
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    probeOpen(OUTPUT);

    dc = GetDC(NULL);

    if (dc == NULL) {
        probe("GetDC", "NULL", "failed");
        probeFinish();
        return 0;
    }

    /* The letters this was built to chase, and one that has never disagreed,
     * which is the control.
     */
    probeNote("one character's advance at every cell height");
    probeSweep("Times New Roman", 0, 'w');
    probeSweep("Times New Roman", 0, 'o');
    probeSweep("Arial", 1, 'M');

    /* The letter the synthetic experiments are written over. On a stock font
     * this is just an `m`; on a fabricated one it is four points and a single
     * instruction, and its width is the answer.
     */
    probeSweep("Arial", 1, 'm');

    /* Courier New carries no `hdmx` at all, so every size runs the program and
     * every size can be read. It is the best host the fabrications have.
     */
    probeSweep("Courier New", 0, '1');

    ReleaseDC(NULL, dc);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
