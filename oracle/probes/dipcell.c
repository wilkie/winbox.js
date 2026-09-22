/*
 * The cells where `VDMX` dips, and which side of the dip Windows lands on.
 *
 * The table's cells climb with the size nearly everywhere. Eight times in the
 * sixteen outline faces they do not: a size fits a *taller* cell than the size
 * above it, so a scan walking upward meets a row too tall and finds an exact
 * answer two rows further on. Whether it gets there is the question.
 *
 *     Arial Bold Italic     105:121 -> 106:120    cell 120
 *                           150:172 -> 151:171    cell 171, in the 4:3 group
 *                           168:192 -> 169:191    cell 191
 *     Courier New Italic    111:122 -> 112:121    cell 121
 *     Times Bold             79:91  ->  80:90     cell 90
 *                           112:128 -> 113:127    cell 127
 *     Times Italic          189:211 -> 190:210    cell 210
 *     Symbol                 63:79  ->  64:78     cell 78
 *                           155:191 -> 156:190    cell 190
 *
 * These are the nine where the answer past the dip is the *only* exact fit --
 * where a size below it already fits the cell exactly there is nothing to
 * decide. `tiepick` covers six of them and says the exact answer past the dip
 * is taken five times and refused once, at Symbol's cell of 190. This asks all
 * eight in one recording, with the cell either side of each for company, so the
 * census is in one place and the two Courier and Arial styles `tiepick` does
 * not sweep are in it.
 *
 * The internal leading names the size: the cell less the em. 8r.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\DIPCELL.OUT"

static HDC dc;

static void probeAsk(LPCSTR face, int height, int weight, int italic)
{
    TEXTMETRIC tm;
    HFONT font;
    HFONT previous;

    wsprintf(probeArgs, "\"%s\",h=%d,weight=%d,italic=%d",
             (LPSTR)face, height, weight, italic);

    font = CreateFont(height, 0, 0, 0, weight, (BYTE)italic, 0, 0, ANSI_CHARSET,
                      OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                      DEFAULT_QUALITY, DEFAULT_PITCH, face);

    if (font == NULL) {
        probe("dip heights", probeArgs, "no font");
        return;
    }

    previous = (HFONT)SelectObject(dc, font);
    GetTextMetrics(dc, &tm);

    wsprintf(probeResult, "height=%d,ascent=%d,descent=%d,internal=%d,external=%d",
             tm.tmHeight, tm.tmAscent, tm.tmDescent,
             tm.tmInternalLeading, tm.tmExternalLeading);
    probe("dip heights", probeArgs, probeResult);

    SelectObject(dc, previous);
    DeleteObject(font);
}

static void probeAround(LPCSTR face, int height, int weight, int italic)
{
    int offset;

    for (offset = -2; offset <= 2; offset++) {
        probeAsk(face, height + offset, weight, italic);
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    probeOpen(OUTPUT);

    dc = GetDC(NULL);

    probeNote("the eight cells where VDMX dips, and the two either side of each");

    probeAround("Arial", 120, FW_BOLD, 1);
    /* Decisive only in the 4:3 group, which is the one a display with a pixel
     * taller than it is wide reads -- an EGA's `emDenom` puts the request at
     * 2048:1536. In the square group a size below the dip already fits this
     * cell exactly, so there is nothing to decide there. */
    probeAround("Arial", 171, FW_BOLD, 1);
    probeAround("Arial", 191, FW_BOLD, 1);
    probeAround("Courier New", 121, FW_NORMAL, 1);
    probeAround("Times New Roman", 90, FW_BOLD, 0);
    probeAround("Times New Roman", 127, FW_BOLD, 0);
    probeAround("Times New Roman", 210, FW_NORMAL, 1);
    probeAround("Symbol", 78, FW_NORMAL, 0);
    probeAround("Symbol", 190, FW_NORMAL, 0);

    ReleaseDC(NULL, dc);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
