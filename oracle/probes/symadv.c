/*
 * Symbol's advances either side of where it starts fitting at half the size.
 *
 * 8k found that a face whose `head.xMax` carried across the horizontal size
 * passes two hundred and fifty-six is fitted at **half** the size and doubled.
 * Symbol declares the widest box of the four -- 2279 units against Arial's
 * 2048 -- so it crosses earliest, at two hundred and thirty-one pixels per em,
 * and `tiepick` finds its measured strings too wide from exactly there:
 * sixteen cells from 285 to 300, over by two to nine pixels on a seven
 * character string.
 *
 * A string's extent is a sum, so it cannot say which glyph is wrong or by how
 * much. `GetCharWidth` answers per character, so this asks for the seven
 * characters of that string one at a time, over every cell from 160 to 300 --
 * well below the crossing, through it, and past it -- and records the extent
 * beside them so the sum can be checked against its parts.
 *
 * The two cells below the crossing that `tiepick` also misses, 170 and 190,
 * are inside the sweep for the same reason.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\SYMADV.OUT"

static HDC dc;

static const char SPECIMEN[] = "Windows";

static void probeCell(int height)
{
    TEXTMETRIC tm;
    HFONT font;
    HFONT previous;
    DWORD extent;
    int widths[224];
    int index;
    LPSTR at;

    font = CreateFont(height, 0, 0, 0, FW_NORMAL, 0, 0, 0, ANSI_CHARSET,
                      OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                      DEFAULT_QUALITY, DEFAULT_PITCH, "Symbol");

    wsprintf(probeArgs, "h=%d", height);

    if (font == NULL) {
        probe("symbol advances", probeArgs, "no font");
        return;
    }

    previous = (HFONT)SelectObject(dc, font);

    GetTextMetrics(dc, &tm);

    /* The size the request was fitted at, which the internal leading names:
     * the cell less the em, and the em is the pixel size. 8r. */
    wsprintf(probeResult, "height=%d,ascent=%d,descent=%d,internal=%d",
             tm.tmHeight, tm.tmAscent, tm.tmDescent, tm.tmInternalLeading);
    probe("symbol size", probeArgs, probeResult);

    at = probeResult;
    *at = '\0';

    if (GetCharWidth(dc, 32, 255, widths)) {
        for (index = 0; SPECIMEN[index]; index++) {
            wsprintf(at, index ? ",%c=%d" : "%c=%d",
                     SPECIMEN[index], widths[(BYTE)SPECIMEN[index] - 32]);

            while (*at) {
                at++;
            }
        }
    }

    probe("symbol advances", probeArgs, probeResult);

    extent = GetTextExtent(dc, SPECIMEN, lstrlen(SPECIMEN));
    wsprintf(probeResult, "width=%d,height=%d", LOWORD(extent), HIWORD(extent));
    probe("symbol extent", probeArgs, probeResult);

    SelectObject(dc, previous);
    DeleteObject(font);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    int height;

    probeOpen(OUTPUT);

    dc = GetDC(NULL);

    probeNote("Symbol's advances one character at a time, through the half-size crossing");

    for (height = 160; height <= 300; height++) {
        probeCell(height);
    }

    ReleaseDC(NULL, dc);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
