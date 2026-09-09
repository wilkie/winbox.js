/*
 * maxorder -- is `tmMaxCharWidth` a property of the request, or of what came
 * before it?
 *
 * The `maxwidth` sweep leaves one metric unexplained, and section 8a of
 * `FONTS.md` proves what it is not: not the font's bounding box scaled by the
 * horizontal size, not a constant times the stretch, not a maximum over any of
 * five per-glyph quantities, and not the widest character. One recorded row
 * points somewhere else instead. Times New Roman asked for fourteen pixels on
 * an EGA reports an average that wants a horizontal size near seventeen and a
 * maximum that wants one near twelve, and the maximum it reports is the one the
 * twelve pixel row reports. A metric that belongs to a different size than the
 * average beside it is a stale one.
 *
 * So this asks each anomalous request three ways: on its own, after another
 * size of the same face, and after another face entirely. If the answer moves,
 * the maximum is carried rather than computed, and what it is carried from is
 * the next thing to find. If it does not, staleness is out and the sweep's
 * arithmetic stands alone.
 */

#include <windows.h>

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\MAXORDER.OUT"

static HDC memory;

/* One measurement, with no attempt to keep anything alive afterwards. */
static void measure(LPCSTR face, int height, int width, LPCSTR label)
{
    HFONT font = CreateFont(height, width, 0, 0, FW_NORMAL, 0, 0, 0,
                            ANSI_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                            DEFAULT_QUALITY, DEFAULT_PITCH, face);
    HFONT previous;
    TEXTMETRIC tm;

    if (font == NULL) {
        return;
    }

    previous = (HFONT)SelectObject(memory, font);
    GetTextMetrics(memory, &tm);
    SelectObject(memory, previous);

    wsprintf(probeArgs, "\"%s\",h=%d,w=%d,after=%s", (LPSTR)face, height, width, (LPSTR)label);
    wsprintf(probeResult, "ave=%d,max=%d,overhang=%d", tm.tmAveCharWidth,
             tm.tmMaxCharWidth, tm.tmOverhang);
    probe("ordered", probeArgs, probeResult);

    DeleteObject(font);
}

/* Selects a font, reads nothing, and lets it go: something for the one that
 * follows to have come after. */
static void touch(LPCSTR face, int height, int width)
{
    HFONT font = CreateFont(height, width, 0, 0, FW_NORMAL, 0, 0, 0,
                            ANSI_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                            DEFAULT_QUALITY, DEFAULT_PITCH, face);
    HFONT previous;
    TEXTMETRIC tm;

    if (font == NULL) {
        return;
    }

    previous = (HFONT)SelectObject(memory, font);
    GetTextMetrics(memory, &tm);
    SelectObject(memory, previous);
    DeleteObject(font);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static const char *FACES[] = { "Arial", "Arial", "Arial", "Times New Roman", "Courier New" };
    static const int HEIGHTS[] = { 10, 10, 16, 32, 24 };
    static const int WIDTHS[] = { 27, 28, 2, 13, 5 };
    HDC screen;
    int index;

    probeOpen(OUTPUT);

    screen = GetDC(NULL);
    memory = CreateCompatibleDC(screen);

    probeNote("each request measured alone, after a sibling size, and after another face");

    for (index = 0; index < 5; index++) {
        measure(FACES[index], HEIGHTS[index], WIDTHS[index], "nothing");

        touch(FACES[index], HEIGHTS[index] + 6, 0);
        measure(FACES[index], HEIGHTS[index], WIDTHS[index], "itself-taller");

        touch(FACES[index], HEIGHTS[index], WIDTHS[index] + 4);
        measure(FACES[index], HEIGHTS[index], WIDTHS[index], "itself-wider");

        touch("Symbol", 20, 0);
        measure(FACES[index], HEIGHTS[index], WIDTHS[index], "symbol");

        touch("MS Sans Serif", 12, 0);
        measure(FACES[index], HEIGHTS[index], WIDTHS[index], "a-strike");
    }

    DeleteDC(memory);
    ReleaseDC(NULL, screen);

    probeFinish();
    return 0;
}
