/*
 * `ExtTextOut`, which nothing has ever called.
 *
 * The corpus draws all its text with `TextOut`, and `ExtTextOut` is the call
 * with the arguments `TextOut` has not got: a rectangle, two flags that say
 * what to do with it, and an array of advances one per character. On this side
 * it is a stub in the export table.
 *
 * Each of those is a question:
 *
 *     the rectangle with `ETO_OPAQUE`   is it the rectangle as given, or the
 *                                       one 8o computes from the glyphs?
 *     the rectangle with `ETO_CLIPPED`  which edges are inside it
 *     the rectangle with neither        is it read at all
 *     `ETO_OPAQUE` under `TRANSPARENT`  does the flag or the mode decide
 *     the advance array                 does it replace the advance, and does
 *                                       the ground and the rule follow it
 *     the array with `SetTextCharacterExtra`  which of the two wins, or both
 *
 * Asked of a strike and of an outline face, because 8o and 8n both found the
 * two answer differently. The text is two characters so that an array has
 * somewhere to show, and it is drawn away from the corner so that a rectangle
 * has room on every side.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\EXTOUT.OUT"

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

/* One drawing, written out a bit a pixel.
 *
 * `useRect` says whether a rectangle is passed at all, which is a different
 * question from whether a flag names one; `dx` is NULL or an array of two.
 */
static void probeDraw(LPCSTR name, LPCSTR face, int height, UINT options,
                      int useRect, int left, int top, int right, int bottom,
                      int mode, int dark, int extra, int *dx)
{
    HFONT font;
    HFONT previous;
    RECT box;
    LPSTR at;
    int index;

    font = CreateFont(height, 0, 0, 0, FW_NORMAL, 0, 0, 0, ANSI_CHARSET,
                      OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                      DEFAULT_QUALITY, DEFAULT_PITCH, face);

    /* Every argument of the call in the record, so the replay does not have to
     * carry a copy of this table. */
    if (dx) {
        wsprintf(probeArgs,
                 "\"%s\",h=%d,%s,opt=%u,rect=%d:%d:%d:%d,use=%d,mode=%d,dark=%d,extra=%d,dx=%d:%d",
                 (LPSTR)face, height, (LPSTR)name, options, left, top, right, bottom,
                 useRect, mode, dark, extra, dx[0], dx[1]);
    } else {
        wsprintf(probeArgs,
                 "\"%s\",h=%d,%s,opt=%u,rect=%d:%d:%d:%d,use=%d,mode=%d,dark=%d,extra=%d",
                 (LPSTR)face, height, (LPSTR)name, options, left, top, right, bottom,
                 useRect, mode, dark, extra);
    }

    if (font == NULL) {
        probe("cell", probeArgs, "no font");
        return;
    }

    previous = (HFONT)SelectObject(memory, font);

    PatBlt(memory, 0, 0, CELL_WIDTH, CELL_HEIGHT, WHITENESS);

    SetTextColor(memory, RGB(0, 0, 0));
    SetBkColor(memory, dark ? RGB(0, 0, 0) : RGB(255, 255, 255));
    SetBkMode(memory, mode);
    SetTextCharacterExtra(memory, extra);

    box.left = left;
    box.top = top;
    box.right = right;
    box.bottom = bottom;

    ExtTextOut(memory, PEN_X, PEN_Y, options, useRect ? &box : NULL, "AB", 2, dx);

    SetTextCharacterExtra(memory, 0);

    GetBitmapBits(canvas, (LONG)CELL_BYTES, bits);

    at = probeResult;

    for (index = 0; index < CELL_BYTES; index++) {
        unsigned char value = (unsigned char)bits[index];

        *at++ = HEX[(value >> 4) & 0x0f];
        *at++ = HEX[value & 0x0f];
    }

    *at = '\0';

    probe("cell", probeArgs, probeResult);

    SelectObject(memory, previous);
    DeleteObject(font);
}

/* The same two characters through `TextOut`, as the control. */
static void probeControl(LPCSTR face, int height, int mode, int dark)
{
    HFONT font;
    HFONT previous;
    LPSTR at;
    int index;

    font = CreateFont(height, 0, 0, 0, FW_NORMAL, 0, 0, 0, ANSI_CHARSET,
                      OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                      DEFAULT_QUALITY, DEFAULT_PITCH, face);

    wsprintf(probeArgs, "\"%s\",h=%d,textout,mode=%d,dark=%d",
             (LPSTR)face, height, mode, dark);

    if (font == NULL) {
        probe("cell", probeArgs, "no font");
        return;
    }

    previous = (HFONT)SelectObject(memory, font);

    PatBlt(memory, 0, 0, CELL_WIDTH, CELL_HEIGHT, WHITENESS);
    SetTextColor(memory, RGB(0, 0, 0));
    SetBkColor(memory, dark ? RGB(0, 0, 0) : RGB(255, 255, 255));
    SetBkMode(memory, mode);

    TextOut(memory, PEN_X, PEN_Y, "AB", 2);

    GetBitmapBits(canvas, (LONG)CELL_BYTES, bits);

    at = probeResult;

    for (index = 0; index < CELL_BYTES; index++) {
        unsigned char value = (unsigned char)bits[index];

        *at++ = HEX[(value >> 4) & 0x0f];
        *at++ = HEX[value & 0x0f];
    }

    *at = '\0';

    probe("cell", probeArgs, probeResult);

    SelectObject(memory, previous);
    DeleteObject(font);
}

static void sweep(LPCSTR face, int height)
{
    int wide[2];
    int narrow[2];
    int nought[2];

    wide[0] = 20;
    wide[1] = 20;
    narrow[0] = 4;
    narrow[1] = 4;
    nought[0] = 0;
    nought[1] = 0;

    /* The control, and the same thing through the other call. */
    probeControl(face, height, OPAQUE, 1);
    probeControl(face, height, TRANSPARENT, 1);

    probeDraw("plain", face, height, 0, 0, 0, 0, 0, 0, OPAQUE, 1, 0, NULL);
    probeDraw("plain", face, height, 0, 0, 0, 0, 0, 0, TRANSPARENT, 1, 0, NULL);

    /* A rectangle, and the flags that say what to do with it. */
    probeDraw("rect-noflag", face, height, 0, 1, 4, 2, 40, 22, OPAQUE, 1, 0, NULL);
    probeDraw("opaque-big", face, height, ETO_OPAQUE, 1, 4, 2, 40, 22, OPAQUE, 1, 0, NULL);
    probeDraw("opaque-small", face, height, ETO_OPAQUE, 1, 10, 6, 20, 14, OPAQUE, 1, 0, NULL);
    probeDraw("clipped", face, height, ETO_CLIPPED, 1, 10, 6, 20, 14, OPAQUE, 1, 0, NULL);
    probeDraw("both", face, height, ETO_OPAQUE | ETO_CLIPPED, 1, 10, 6, 20, 14, OPAQUE, 1, 0, NULL);
    probeDraw("opaque-transparent", face, height, ETO_OPAQUE, 1, 4, 2, 40, 22, TRANSPARENT, 1, 0, NULL);
    probeDraw("opaque-norect", face, height, ETO_OPAQUE, 0, 0, 0, 0, 0, OPAQUE, 1, 0, NULL);

    /* And the advances. */
    probeDraw("dx-wide", face, height, 0, 0, 0, 0, 0, 0, TRANSPARENT, 1, 0, wide);
    probeDraw("dx-narrow", face, height, 0, 0, 0, 0, 0, 0, TRANSPARENT, 1, 0, narrow);
    probeDraw("dx-nought", face, height, 0, 0, 0, 0, 0, 0, TRANSPARENT, 1, 0, nought);
    probeDraw("dx-wide-opaque", face, height, 0, 0, 0, 0, 0, 0, OPAQUE, 1, 0, wide);
    probeDraw("dx-wide-extra", face, height, 0, 0, 0, 0, 0, 0, TRANSPARENT, 1, 3, wide);
    probeDraw("extra", face, height, 0, 0, 0, 0, 0, 0, TRANSPARENT, 1, 3, NULL);
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

    probeNote("ExtTextOut: the rectangle, the flags and the advance array");

    sweep("MS Sans Serif", 16);
    sweep("Arial", 16);
    sweep("Courier New", 20);

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
