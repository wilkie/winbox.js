/*
 * sizes -- the outline faces above thirty-one pixels, in a cell that fits them.
 *
 * Every glyph recorded before this was drawn into a thirty-two pixel square, so
 * nothing above a thirty-one pixel cell height has ever been compared: not the
 * sizes at which dropout control is meant to switch off, not the sizes at which
 * `prep` takes its large branches, not the scan converter on a glyph a hundred
 * points across. This draws into sixty-four, and says so in the record so the
 * replay draws into the same.
 */

#include <windows.h>

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\SIZES.OUT"

#define CELL_WIDTH  64
#define CELL_HEIGHT 64
#define ROW_BYTES   8
#define CELL_BYTES  (ROW_BYTES * CELL_HEIGHT)

static HDC memory;
static HBITMAP canvas;
static char bits[CELL_BYTES];

static const char HEX[] = "0123456789abcdef";

static const char WIDE[] = "ABEKMNRSWXZabdefgjkmnostwy0123456789";

static void probeGlyph(LPCSTR name, HFONT font, char character)
{
    HFONT previous;
    LPSTR at;
    int index;
    char text[2];

    if (font == NULL) {
        return;
    }

    previous = (HFONT)SelectObject(memory, font);

    PatBlt(memory, 0, 0, CELL_WIDTH, CELL_HEIGHT, WHITENESS);

    SetTextColor(memory, RGB(0, 0, 0));
    SetBkColor(memory, RGB(255, 255, 255));
    SetBkMode(memory, OPAQUE);

    text[0] = character;
    text[1] = '\0';

    TextOut(memory, 2, 0, text, 1);

    GetBitmapBits(canvas, (LONG)CELL_BYTES, bits);

    at = probeResult;

    for (index = 0; index < CELL_BYTES; index++) {
        *at++ = HEX[(bits[index] >> 4) & 0x0f];
        *at++ = HEX[bits[index] & 0x0f];
    }

    *at = '\0';

    if (((unsigned char)character >= '0' && (unsigned char)character <= '9') ||
        ((unsigned char)character >= 'A' && (unsigned char)character <= 'Z') ||
        ((unsigned char)character >= 'a' && (unsigned char)character <= 'z')) {
        wsprintf(probeArgs, "%s,'%c'", (LPSTR)name, character);
    } else {
        char coded[3];

        coded[0] = HEX[((unsigned char)character >> 4) & 0x0f];
        coded[1] = HEX[(unsigned char)character & 0x0f];
        coded[2] = '\0';

        wsprintf(probeArgs, "%s,#%s", (LPSTR)name, (LPSTR)coded);
    }

    probe("glyph", probeArgs, probeResult);

    SelectObject(memory, previous);
}

static void probeAt(LPCSTR face, int height, int weight, BYTE italic, LPCSTR chars)
{
    HFONT font = CreateFont(height, 0, 0, 0, weight, italic, 0, 0,
                            ANSI_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                            DEFAULT_QUALITY, DEFAULT_PITCH, face);
    int index;
    char name[80];

    wsprintf(name, "\"%s\",h=%d,weight=%d,italic=%d,cell=64", (LPSTR)face, height, weight,
             (int)italic);

    for (index = 0; chars[index]; index++) {
        probeGlyph(name, font, chars[index]);
    }

    if (font) {
        DeleteObject(font);
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static const int SIZES[] = { 36, 40, 44, 48, 56, 64 };
    static const char *FACES[] = { "Arial", "Times New Roman", "Courier New" };
    HDC screen;
    int face;
    int size;

    probeOpen(OUTPUT);

    screen = GetDC(NULL);
    memory = CreateCompatibleDC(screen);

    canvas = CreateBitmap(CELL_WIDTH, CELL_HEIGHT, 1, 1, NULL);

    if (memory == NULL || canvas == NULL) {
        probe("CreateBitmap", "64x64x1", "failed");
        probeFinish();
        return 0;
    }

    SelectObject(memory, canvas);

    probeNote("the regular outline faces above thirty-one pixels");
    for (face = 0; face < 3; face++) {
        for (size = 0; size < sizeof(SIZES) / sizeof(SIZES[0]); size++) {
            probeAt(FACES[face], SIZES[size], FW_NORMAL, 0, WIDE);
        }
    }

    probeNote("the bold files at forty-eight");
    for (face = 0; face < 3; face++) {
        probeAt(FACES[face], 48, FW_BOLD, 0, WIDE);
    }

    probeNote("Symbol, as the control with a synthesised slant");
    probeAt("Symbol", 36, FW_NORMAL, 0, "ABKMWagjmy1");
    probeAt("Symbol", 48, FW_NORMAL, 0, "ABKMWagjmy1");
    probeAt("Symbol", 64, FW_NORMAL, 0, "ABKMWagjmy1");
    probeAt("Symbol", 48, FW_NORMAL, 1, "ABKMWagjmy1");

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
