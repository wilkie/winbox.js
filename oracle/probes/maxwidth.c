/*
 * maxwidth -- `tmMaxCharWidth` under a stretch, densely.
 *
 * The `widths` probe sweeps ten widths at two heights and records the glyphs
 * beside the metrics, which is enough to fix every rule but one: the maximum
 * width Windows reports for Courier New at twenty-two pixels asked for five.
 * Section 8a of `FONTS.md` proves that answer is not the font's bounding box
 * scaled by any single horizontal size, because the row beside it wants a size
 * more than two thirds of a percent larger per unit of width.
 *
 * This records the metrics alone -- no glyphs, so it stays small -- for every
 * width from one to thirty-two at nine heights on the three regular outline
 * faces. What the sweep is for is the shape of the staircase: where the
 * reported maximum steps from one pixel to the next, densely enough that the
 * function behind it can be read off rather than guessed at.
 */

#include <windows.h>

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\MAXWIDTH.OUT"

static HDC memory;

static void probeOne(LPCSTR face, int height, int width)
{
    HFONT font = CreateFont(height, width, 0, 0, FW_NORMAL, 0, 0, 0,
                            ANSI_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                            DEFAULT_QUALITY, DEFAULT_PITCH, face);
    HFONT previous;
    TEXTMETRIC tm;
    char resolved[64];

    if (font == NULL) {
        return;
    }

    previous = (HFONT)SelectObject(memory, font);
    GetTextMetrics(memory, &tm);
    GetTextFace(memory, sizeof(resolved), resolved);
    SelectObject(memory, previous);

    wsprintf(probeArgs, "\"%s\",h=%d,w=%d", (LPSTR)face, height, width);
    wsprintf(probeResult, "face=\"%s\",height=%d,ave=%d,max=%d",
             (LPSTR)resolved, tm.tmHeight, tm.tmAveCharWidth, tm.tmMaxCharWidth);
    probe("metrics", probeArgs, probeResult);

    DeleteObject(font);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static const char *FACES[] = { "Arial", "Times New Roman", "Courier New" };
    static const int HEIGHTS[] = { 8, 10, 12, 14, 16, 18, 20, 24, 32 };
    HDC screen;
    int face;
    int index;
    int width;

    probeOpen(OUTPUT);

    screen = GetDC(NULL);
    memory = CreateCompatibleDC(screen);

    probeNote("the maximum width, every width from one to thirty-two at nine heights");
    for (face = 0; face < 3; face++) {
        for (index = 0; index < sizeof(HEIGHTS) / sizeof(HEIGHTS[0]); index++) {
            for (width = 0; width <= 32; width++) {
                probeOne(FACES[face], HEIGHTS[index], width);
            }
        }
    }

    DeleteDC(memory);
    ReleaseDC(NULL, screen);

    probeFinish();
    return 0;
}
