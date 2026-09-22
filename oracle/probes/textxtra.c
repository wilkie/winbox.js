/*
 * The gap `SetTextCharacterExtra` adds after every character.
 *
 * Nothing in the corpus has ever set it, so every record says what nought
 * does, and nought is the one value that cannot show the rest. It is a stub on
 * this side and the drawing knows nothing of it.
 *
 * A single character cannot show it either -- the extra is added *after* each
 * one, so it moves the next character and the string's width and nothing else.
 * This draws two, at the corner, so the second's shift is the measurement.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\TEXTXTRA.OUT"

#define CELL_WIDTH  64
#define CELL_HEIGHT 64
#define ROW_BYTES   8
#define CELL_BYTES  (ROW_BYTES * CELL_HEIGHT)

static HDC memory;
static HBITMAP canvas;
static char bits[CELL_BYTES];

static const char HEX[] = "0123456789abcdef";

static void probeGlyph(LPCSTR name, HFONT font, LPCSTR word, int extra)
{
    HFONT previous;
    LPSTR at;
    int index;

    if (font == NULL) {
        return;
    }

    previous = (HFONT)SelectObject(memory, font);

    PatBlt(memory, 0, 0, CELL_WIDTH, CELL_HEIGHT, WHITENESS);

    SetTextColor(memory, RGB(0, 0, 0));
    SetBkColor(memory, RGB(255, 255, 255));
    SetBkMode(memory, TRANSPARENT);
    SetTextCharacterExtra(memory, extra);

    TextOut(memory, 2, 0, word, lstrlen(word));

    GetBitmapBits(canvas, (LONG)CELL_BYTES, bits);

    at = probeResult;

    for (index = 0; index < CELL_BYTES; index++) {
        unsigned char value = (unsigned char)bits[index];

        *at++ = HEX[(value >> 4) & 0x0f];
        *at++ = HEX[value & 0x0f];
    }

    *at = '\0';

    wsprintf(probeArgs, "%s,'%s'", (LPSTR)name, (LPSTR)word);
    probe("glyph", probeArgs, probeResult);

    SelectObject(memory, previous);
}

/* One face at one size, at four spacings. */
static void probeSize(LPCSTR face, int height)
{
    static const int EXTRA[] = { 0, 1, 2, 5 };

    int at;
    char name[96];

    for (at = 0; at < 4; at++) {
        HFONT font = CreateFont(height, 0, 0, 0, FW_NORMAL, 0, 0, 0,
                                ANSI_CHARSET, OUT_DEFAULT_PRECIS,
                                CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY,
                                DEFAULT_PITCH, face);

        wsprintf(name, "\"%s\",h=%d,weight=400,italic=0,extra=%d,cell=64",
                 (LPSTR)face, height, EXTRA[at]);

        probeGlyph(name, font, "AB", EXTRA[at]);

        if (font) {
            DeleteObject(font);
        }
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static const int SIZES[] = { 12, 24, 0 };

    HDC screen;
    int at;

    probeOpen(OUTPUT);

    screen = GetDC(NULL);
    memory = CreateCompatibleDC(screen);
    canvas = CreateBitmap(CELL_WIDTH, CELL_HEIGHT, 1, 1, NULL);

    if (memory == NULL || canvas == NULL) {
        probe("setup", "64x64x1", "failed");
        probeFinish();
        return 0;
    }

    SelectObject(memory, canvas);

    probeNote("three faces, two sizes, four spacings");

    for (at = 0; SIZES[at]; at++) {
        probeSize("MS Sans Serif", SIZES[at]);
        probeSize("Arial", SIZES[at]);
        probeSize("Courier New", SIZES[at]);
    }

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
