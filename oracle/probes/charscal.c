/*
 * charscal -- the horizontal size, read off a proportional face's advances.
 *
 * `maxwidth` measures the realised horizontal size through one number, the
 * stub's `dfMaxWidth`, and pins it to about a fiftieth of a pixel by asking
 * eight fabrications of that number. This asks the same question through the
 * advances instead, which needs no fabrication at all: a proportional face has
 * a couple of hundred of them, spread from a fifth of an em to nearly a whole
 * one, and `GetCharWidth` reports each rounded to a pixel. Every one of them
 * is an interval on the size, and two hundred intervals intersect to a much
 * smaller one than eight do.
 *
 * Courier New cannot answer this -- every advance is the same -- so the two
 * proportional faces are the ones asked.
 */

#include <windows.h>

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\CHARSCAL.OUT"

static HDC memory;

static void probeOne(LPCSTR face, int height, int width)
{
    HFONT font = CreateFont(height, width, 0, 0, FW_NORMAL, 0, 0, 0,
                            ANSI_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                            DEFAULT_QUALITY, DEFAULT_PITCH, face);
    HFONT previous;
    int widths[224];
    int index;
    LPSTR at;

    if (font == NULL) {
        return;
    }

    previous = (HFONT)SelectObject(memory, font);

    if (!GetCharWidth(memory, 32, 255, widths)) {
        SelectObject(memory, previous);
        DeleteObject(font);
        return;
    }

    SelectObject(memory, previous);
    DeleteObject(font);

    at = probeResult;

    for (index = 0; index < 224; index++) {
        if (index) {
            *at++ = ',';
        }

        at += wsprintf(at, "%d", widths[index]);
    }

    *at = '\0';

    wsprintf(probeArgs, "\"%s\",h=%d,w=%d", (LPSTR)face, height, width);
    probe("widths", probeArgs, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static const char *FACES[] = { "Arial", "Times New Roman" };
    static const int HEIGHTS[] = { 8, 10, 12, 14, 16, 18, 20, 24, 32 };
    HDC screen;
    int face;
    int index;
    int width;

    probeOpen(OUTPUT);

    screen = GetDC(NULL);
    memory = CreateCompatibleDC(screen);

    probeNote("every character's advance, at every width from none to thirty-two");
    for (face = 0; face < 2; face++) {
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
