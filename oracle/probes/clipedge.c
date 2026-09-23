/*
 * Which side of `ETO_CLIPPED`'s edges is inside.
 *
 * 8t drew one clipped rectangle -- a clean box in the middle of the text -- and
 * that says the flag clips and nothing more. Where the edges fall wants the
 * rectangle walked across the text a column at a time, and the degenerate
 * rectangles want asking on purpose:
 *
 *     an empty one            left equal to right: everything, or nothing?
 *     an inverted one         right left of left: normalised, or nothing?
 *     one clear of the text   nothing, presumably, but it has never been asked
 *     one off the surface     a negative edge, which a `RECT` is free to carry
 *
 * The text is black on white and the mode is `TRANSPARENT`, so the glyphs are
 * all that is drawn and the clip shows in them directly. Two characters of a
 * strike and of an outline face, because 8o and 8t both found the two answering
 * differently about what is painted behind text.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\CLIPEDGE.OUT"

#define CELL_WIDTH  64
#define CELL_HEIGHT 48
#define ROW_BYTES   8
#define CELL_BYTES  (ROW_BYTES * CELL_HEIGHT)

#define PEN_X 8
#define PEN_Y 4

static HDC memory;
static HBITMAP canvas;
static char bits[CELL_BYTES];

static const char HEX[] = "0123456789abcdef";

static void probeClip(LPCSTR face, int height, LPCSTR name,
                      int left, int top, int right, int bottom, UINT options)
{
    HFONT font;
    RECT box;
    LPSTR at;
    int index;

    font = CreateFont(height, 0, 0, 0, FW_NORMAL, 0, 0, 0, ANSI_CHARSET,
                      OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                      DEFAULT_QUALITY, DEFAULT_PITCH, face);

    wsprintf(probeArgs, "\"%s\",h=%d,%s,rect=%d:%d:%d:%d,opt=%u",
             (LPSTR)face, height, (LPSTR)name, left, top, right, bottom, options);

    if (font == NULL) {
        probe("clip", probeArgs, "no font");
        return;
    }

    SelectObject(memory, font);

    PatBlt(memory, 0, 0, CELL_WIDTH, CELL_HEIGHT, WHITENESS);

    SetTextColor(memory, RGB(0, 0, 0));
    SetBkColor(memory, RGB(255, 255, 255));
    SetBkMode(memory, TRANSPARENT);

    box.left = left;
    box.top = top;
    box.right = right;
    box.bottom = bottom;

    ExtTextOut(memory, PEN_X, PEN_Y, options, &box, "AB", 2, NULL);

    GetBitmapBits(canvas, (LONG)CELL_BYTES, bits);

    at = probeResult;

    for (index = 0; index < CELL_BYTES; index++) {
        unsigned char value = (unsigned char)bits[index];

        *at++ = HEX[(value >> 4) & 0x0f];
        *at++ = HEX[value & 0x0f];
    }

    *at = '\0';

    probe("clip", probeArgs, probeResult);

    DeleteObject(font);
}

static void sweep(LPCSTR face, int height)
{
    int at;

    /* The right edge walked across the letters, then the left, then the bottom
     * and the top. One of those four says which side of each edge is in. */
    for (at = 8; at <= 28; at++) {
        probeClip(face, height, "right", 0, 0, at, CELL_HEIGHT, ETO_CLIPPED);
    }

    for (at = 6; at <= 26; at++) {
        probeClip(face, height, "left", at, 0, CELL_WIDTH, CELL_HEIGHT, ETO_CLIPPED);
    }

    for (at = 4; at <= 22; at++) {
        probeClip(face, height, "bottom", 0, 0, CELL_WIDTH, at, ETO_CLIPPED);
    }

    for (at = 4; at <= 22; at++) {
        probeClip(face, height, "top", 0, at, CELL_WIDTH, CELL_HEIGHT, ETO_CLIPPED);
    }

    /* And the rectangles that are not rectangles. */
    probeClip(face, height, "empty", 14, 6, 14, 14, ETO_CLIPPED);
    probeClip(face, height, "flat", 10, 10, 20, 10, ETO_CLIPPED);
    probeClip(face, height, "inverted", 20, 6, 10, 14, ETO_CLIPPED);
    probeClip(face, height, "upside", 10, 14, 20, 6, ETO_CLIPPED);
    probeClip(face, height, "clear", 40, 30, 60, 40, ETO_CLIPPED);
    probeClip(face, height, "negative", -8, -4, 16, 40, ETO_CLIPPED);
    probeClip(face, height, "huge", -100, -100, 200, 200, ETO_CLIPPED);

    /* The same edges with the ground painted too, so the clip can be seen
     * cutting the rectangle as well as the letters. */
    probeClip(face, height, "both-right", 0, 0, 16, CELL_HEIGHT, ETO_CLIPPED | ETO_OPAQUE);
    probeClip(face, height, "both-bottom", 0, 0, CELL_WIDTH, 12, ETO_CLIPPED | ETO_OPAQUE);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HDC screen;

    probeOpen(OUTPUT);

    screen = GetDC(NULL);
    memory = CreateCompatibleDC(screen);
    canvas = CreateBitmap(CELL_WIDTH, CELL_HEIGHT, 1, 1, NULL);

    if (memory == NULL || canvas == NULL) {
        probe("setup", "64x48x1", "failed");
        probeFinish();
        return 0;
    }

    SelectObject(memory, canvas);

    probeNote("ETO_CLIPPED: each edge walked across the text, and the degenerate rectangles");

    sweep("MS Sans Serif", 16);
    sweep("Arial", 16);

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
