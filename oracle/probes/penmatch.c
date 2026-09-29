/*
 * Which of the display's colours a pen, text, a background and `SetPixel`
 * draw a colour as -- the colours `GetNearestColor` answers for (`nearest2`),
 * or some other rule -- and whether a wide pen is drawn solid or patterned
 * like a brush.
 *
 * For each colour of a cube of eight levels a side -- 0, 36, 73, 109, 146,
 * 182, 219 and 255 -- into a bitmap compatible with the screen, over white:
 *
 * * `setpixel`: the colour, as `rrggbb`; what SetPixel answered, and the
 *   pixel read back with GetPixel, each as `rrggbb`.
 * * `pen`: a line one pixel wide; one of its pixels.
 * * `text`: the text colour; a lit pixel of a `|`.
 * * `back`: the background colour, filled by ExtTextOut's ETO_OPAQUE; one of
 *   its pixels.
 * * `wide`: a horizontal line of a pen six pixels wide; sixteen pixels of two
 *   of its rows, a hex digit a pixel as `dither` writes them.
 *
 * Then the same again into a monochrome bitmap, each colour's arguments
 * ending `,mono`: which colours a monochrome bitmap takes as white.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\PENMATCH.OUT"

static const char HEX[] = "0123456789abcdef";

/* The sixteen colours of the palette, in the order Windows documents them. */
static const COLORREF PALETTE[16] = {
    RGB(0, 0, 0),       RGB(128, 0, 0),     RGB(0, 128, 0),   RGB(128, 128, 0),
    RGB(0, 0, 128),     RGB(128, 0, 128),   RGB(0, 128, 128), RGB(192, 192, 192),
    RGB(128, 128, 128), RGB(255, 0, 0),     RGB(0, 255, 0),   RGB(255, 255, 0),
    RGB(0, 0, 255),     RGB(255, 0, 255),   RGB(0, 255, 255), RGB(255, 255, 255),
};

static HDC memory;
static LPCSTR suffix = "";
static int glyphX;
static int glyphY;

static char digit(COLORREF colour)
{
    int index;

    for (index = 0; index < 16; index++) {
        if (PALETTE[index] == (colour & 0xffffffL)) {
            return HEX[index];
        }
    }

    return '?';
}

static void clear(void)
{
    PatBlt(memory, 0, 0, 64, 80, WHITENESS);
}

static void answer(LPCSTR kind, COLORREF colour)
{
    wsprintf(probeResult, "%02x%02x%02x", GetRValue(colour), GetGValue(colour),
             GetBValue(colour));
    probe(kind, probeArgs, probeResult);
}

static void ask(int red, int green, int blue)
{
    COLORREF colour = RGB(red, green, blue);
    COLORREF set;
    HPEN pen;
    HPEN was;
    RECT rect;
    LPSTR at;
    int x;
    int y;

    wsprintf(probeArgs, "%02x%02x%02x%s", red, green, blue, suffix);

    clear();
    set = SetPixel(memory, 4, 4, colour);
    wsprintf(probeResult, "%02x%02x%02x %02x%02x%02x", GetRValue(set), GetGValue(set),
             GetBValue(set), GetRValue(GetPixel(memory, 4, 4)), GetGValue(GetPixel(memory, 4, 4)),
             GetBValue(GetPixel(memory, 4, 4)));
    probe("setpixel", probeArgs, probeResult);

    clear();
    pen = CreatePen(PS_SOLID, 1, colour);
    was = SelectObject(memory, pen);
    MoveTo(memory, 0, 10);
    LineTo(memory, 16, 10);
    SelectObject(memory, was);
    DeleteObject(pen);
    answer("pen", GetPixel(memory, 4, 10));

    clear();
    SetBkMode(memory, TRANSPARENT);
    SetTextColor(memory, colour);
    TextOut(memory, 0, 20, "|", 1);
    SetTextColor(memory, RGB(0, 0, 0));
    answer("text", GetPixel(memory, glyphX, glyphY));

    clear();
    SetBkColor(memory, colour);
    rect.left = 0;
    rect.top = 40;
    rect.right = 16;
    rect.bottom = 48;
    ExtTextOut(memory, 0, 40, ETO_OPAQUE, &rect, "", 0, NULL);
    SetBkColor(memory, RGB(255, 255, 255));
    answer("back", GetPixel(memory, 4, 44));

    clear();
    pen = CreatePen(PS_SOLID, 6, colour);
    was = SelectObject(memory, pen);
    MoveTo(memory, 0, 64);
    LineTo(memory, 40, 64);
    SelectObject(memory, was);
    DeleteObject(pen);
    at = probeResult;

    for (y = 63; y <= 64; y++) {
        if (y != 63) {
            *at++ = '/';
        }

        for (x = 8; x < 24; x++) {
            *at++ = digit(GetPixel(memory, x, y));
        }
    }

    *at = '\0';
    probe("wide", probeArgs, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static const int LEVELS[8] = {0, 36, 73, 109, 146, 182, 219, 255};
    HDC screen;
    HBITMAP bitmap;
    HBITMAP old;
    int r;
    int g;
    int b;

    probeOpen(OUTPUT);

    screen = GetDC(NULL);
    memory = CreateCompatibleDC(screen);
    bitmap = CreateCompatibleBitmap(screen, 64, 80);
    old = SelectObject(memory, bitmap);

    /* Where the `|` is lit: its first black pixel, drawn once in black. */
    clear();
    SetBkMode(memory, TRANSPARENT);
    TextOut(memory, 0, 20, "|", 1);
    glyphX = -1;

    for (r = 20; r < 40 && glyphX < 0; r++) {
        for (g = 0; g < 16 && glyphX < 0; g++) {
            if ((GetPixel(memory, g, r) & 0xffffffL) == 0) {
                glyphX = g;
                glyphY = r;
            }
        }
    }

    wsprintf(probeResult, "%d,%d", glyphX, glyphY);
    probe("glyph", "|", probeResult);

    for (r = 0; r < 8; r++) {
        for (g = 0; g < 8; g++) {
            for (b = 0; b < 8; b++) {
                ask(LEVELS[r], LEVELS[g], LEVELS[b]);
            }
        }
    }

    SelectObject(memory, old);
    DeleteObject(bitmap);

    bitmap = CreateBitmap(64, 80, 1, 1, NULL);
    old = SelectObject(memory, bitmap);
    suffix = ",mono";

    for (r = 0; r < 8; r++) {
        for (g = 0; g < 8; g++) {
            for (b = 0; b < 8; b++) {
                ask(LEVELS[r], LEVELS[g], LEVELS[b]);
            }
        }
    }

    SelectObject(memory, old);
    DeleteObject(bitmap);
    DeleteDC(memory);
    ReleaseDC(NULL, screen);
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
