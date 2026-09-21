/*
 * Where the text lands, which nothing has ever moved.
 *
 * `SetTextAlign` says what the point handed to `TextOut` means. Left, centre or
 * right across; top, bottom or baseline down. Every probe in the corpus leaves
 * it alone, so every record says only what the default does, and the default is
 * the one combination that cannot show the rest: the point is the top left.
 *
 * `SetTextAlign` is a stub on this side and the drawing has no notion of
 * alignment at all, so the whole instruction is unrecorded and unimplemented.
 *
 * The character is drawn at the middle of the cell rather than at its corner,
 * so that a shift in any direction has somewhere to go.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\TEXTALIN.OUT"

#define CELL_WIDTH  64
#define CELL_HEIGHT 64
#define ROW_BYTES   8
#define CELL_BYTES  (ROW_BYTES * CELL_HEIGHT)

static HDC memory;
static HBITMAP canvas;
static char bits[CELL_BYTES];

static const char HEX[] = "0123456789abcdef";

static void probeGlyph(LPCSTR name, HFONT font, char character, int align)
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
    SetBkMode(memory, TRANSPARENT);
    SetTextAlign(memory, align);

    text[0] = character;
    text[1] = '\0';

    TextOut(memory, 32, 32, text, 1);

    GetBitmapBits(canvas, (LONG)CELL_BYTES, bits);

    at = probeResult;

    for (index = 0; index < CELL_BYTES; index++) {
        unsigned char value = (unsigned char)bits[index];

        *at++ = HEX[(value >> 4) & 0x0f];
        *at++ = HEX[value & 0x0f];
    }

    *at = '\0';

    wsprintf(probeArgs, "%s,'%c'", (LPSTR)name, character);
    probe("glyph", probeArgs, probeResult);

    SelectObject(memory, previous);
}

/*
 * One face at one size, at every combination the flags allow.
 *
 * Across: left is nought, right two, centre six. Down: top is nought, bottom
 * eight, baseline twenty-four. `TA_UPDATECP` is left out -- it changes what the
 * point is rather than where the text goes from it, and wants a probe that
 * draws twice.
 */
static void probeSize(LPCSTR face, int height)
{
    static const int ACROSS[] = { 0, 2, 6 };
    static const int DOWN[] = { 0, 8, 24 };

    int x;
    int y;
    char name[96];

    for (x = 0; x < 3; x++) {
        for (y = 0; y < 3; y++) {
            int align = ACROSS[x] | DOWN[y];

            HFONT font = CreateFont(height, 0, 0, 0, FW_NORMAL, 0, 0, 0,
                                    ANSI_CHARSET, OUT_DEFAULT_PRECIS,
                                    CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY,
                                    DEFAULT_PITCH, face);

            wsprintf(name, "\"%s\",h=%d,weight=400,italic=0,align=%d,at=32,cell=64",
                     (LPSTR)face, height, align);

            probeGlyph(name, font, 'A', align);

            if (font) {
                DeleteObject(font);
            }
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

    probeNote("two faces, two sizes, every combination of the alignment flags");

    for (at = 0; SIZES[at]; at++) {
        probeSize("MS Sans Serif", SIZES[at]);
        probeSize("Arial", SIZES[at]);
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
