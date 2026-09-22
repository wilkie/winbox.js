/*
 * Which of a tied pair of sizes Windows takes, asked of the metrics.
 *
 * `VDMX` quantises: two sizes a pixel apart often grid-fit to the same cell,
 * and which of them is used moves the internal leading by one and the glyph by
 * a pixel. 8f measured, over forty-eight ties in the `font` recording, that an
 * exact fit takes the *first* of the tie -- and `stemstyl` draws four cells
 * that only the *second* reproduces, pixel for pixel:
 *
 *     Arial Bold Italic      cell 258   227 or 228, drawn at 228
 *     Times New Roman Bold   cell 274   242 or 243, drawn at 243
 *     Times Bold Italic      cell 274   244 or 245, drawn at 245
 *     Times Bold Italic      cell 278   248 or 249, drawn at 249
 *
 * against thirteen other ties in the same recording, at the same sizes and in
 * the same faces, which the first of the pair draws exactly. The table rows are
 * the same shape on both sides -- neighbours a pixel below, the pair, a
 * neighbour above -- so nothing in `VDMX` separates them.
 *
 * `stemstyl` records pixels and nothing else, so it cannot say whether Windows
 * *chose* the second size or merely *drew* at it while reporting the first.
 * This asks the metrics the same question over the whole region, every second
 * cell from 190 to 298, in the six styles `stemstyl` draws: the ascent and
 * descent name a row of `VDMX` outright, and so name the size.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\TIEPICK.OUT"

static HDC dc;

static const char SPECIMEN[] = "Windows";

static void probeAsk(LPCSTR face, int height, int weight, int italic)
{
    TEXTMETRIC tm;
    HFONT font;
    HFONT previous;
    DWORD extent;

    wsprintf(probeArgs, "\"%s\",h=%d,weight=%d,italic=%d",
             (LPSTR)face, height, weight, italic);

    font = CreateFont(height, 0, 0, 0, weight, (BYTE)italic, 0, 0, ANSI_CHARSET,
                      OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                      DEFAULT_QUALITY, DEFAULT_PITCH, face);

    if (font == NULL) {
        probe("tie heights", probeArgs, "no font");
        return;
    }

    previous = (HFONT)SelectObject(dc, font);

    GetTextMetrics(dc, &tm);

    wsprintf(probeResult, "height=%d,ascent=%d,descent=%d,internal=%d,external=%d",
             tm.tmHeight, tm.tmAscent, tm.tmDescent,
             tm.tmInternalLeading, tm.tmExternalLeading);
    probe("tie heights", probeArgs, probeResult);

    extent = GetTextExtent(dc, SPECIMEN, lstrlen(SPECIMEN));
    wsprintf(probeResult, "width=%d,height=%d", LOWORD(extent), HIWORD(extent));
    probe("tie extent", probeArgs, probeResult);

    SelectObject(dc, previous);
    DeleteObject(font);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    int height;

    probeOpen(OUTPUT);

    dc = GetDC(NULL);

    probeNote("every cell height, so the step from one size to the next can be read");

    /* Every cell, not every other one: the answer is a step function of the
     * height and what is wanted is where each step falls. Six faces, chosen so
     * that both sides of the disagreement are represented -- the two that take
     * the second of a tie at these sizes, two that take the first, the symbol
     * face whose ties `font` already answers, and the fixed pitch one.
     */
    for (height = 8; height <= 300; height++) {
        probeAsk("Arial", height, FW_NORMAL, 0);
        probeAsk("Arial", height, FW_BOLD, 1);
        probeAsk("Times New Roman", height, FW_BOLD, 0);
        probeAsk("Times New Roman", height, FW_NORMAL, 1);
        probeAsk("Courier New", height, FW_NORMAL, 0);
        probeAsk("Symbol", height, FW_NORMAL, 0);
    }

    ReleaseDC(NULL, dc);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
