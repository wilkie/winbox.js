/*
 * The tie of 8r, asked of the five faces `tiepick` does not sweep.
 *
 * 8r found that an exact fit takes the *first* of a run of sizes that grid-fit
 * to the same cell -- 227 times -- and that fourteen cells take the last, all
 * of them above a cell of 254, with nothing in the table to separate them. It
 * had six faces to look at, and three of the fourteen are Arial Bold Italic's
 * and seven Times New Roman's.
 *
 * These are the other five, over the cells where the fourteen live. Their runs
 * fall at different sizes -- Courier New Bold ties at a cell of 230 where Times
 * New Roman ties at 233 -- so they are new cases and not the same ones again.
 *
 * Recorded on both displays, because the table is one list per aspect ratio and
 * the lists are not the same list: Times New Roman's catch-all group and its
 * 4:3 group differ in 55 rows above two hundred pixels per em, so the two
 * recordings ask about different runs.
 *
 * The internal leading names the size: the cell less the em. 8r.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\TIEWIDE.OUT"

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
        probe("wide heights", probeArgs, "no font");
        return;
    }

    previous = (HFONT)SelectObject(dc, font);
    GetTextMetrics(dc, &tm);

    wsprintf(probeResult, "height=%d,ascent=%d,descent=%d,internal=%d,external=%d",
             tm.tmHeight, tm.tmAscent, tm.tmDescent,
             tm.tmInternalLeading, tm.tmExternalLeading);
    probe("wide heights", probeArgs, probeResult);

    SelectObject(dc, previous);
    DeleteObject(font);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    int height;

    probeOpen(OUTPUT);

    dc = GetDC(NULL);

    probeNote("the tie region in the five faces tiepick leaves out");

    for (height = 228; height <= 300; height++) {
        probeAsk("Times New Roman", height, FW_NORMAL, 0);
        probeAsk("Times New Roman", height, FW_BOLD, 1);
        probeAsk("Courier New", height, FW_BOLD, 0);
        probeAsk("Courier New", height, FW_NORMAL, 1);
        probeAsk("Arial", height, FW_BOLD, 0);
    }

    ReleaseDC(NULL, dc);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
