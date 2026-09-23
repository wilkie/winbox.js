/*
 * The box a glyph is blitted into, read out of the scaler.
 *
 * 8o found that the rectangle `TextOut` paints behind the text is not the
 * string's extent -- `groundw` asks `GetTextExtent` and `GetCharWidth` of the
 * same requests and both answer what this side computes, while the rectangle
 * is up to four columns wider. It is the box the glyph is blitted into, and
 * uniting the advance with the fitted outline's extremes accounts for every
 * case where the ink reaches past the advance. What is left is the glyphs whose
 * ink reaches nowhere near it -- `l` above all -- where the box is wider than
 * both and nothing on this side says by how much.
 *
 * 8k found the scaler's own bitmap metrics in its sixteen kilobyte buffer: the
 * left side bearing, the width and the height of the glyph as blitted, in
 * sixty-fourths and again in whole pixels a few bytes above. Those are the box.
 * So this points `scalemem`'s instrument at the cells `groundbx` cannot
 * explain, and at the ones either side that it can.
 *
 * `heap.c` established the method and the caution: `TOOLHELP`'s `GlobalFirst`,
 * `GlobalNext`, `GlobalHandleToSel` and `MemoryRead`, nothing written, and
 * every draw the first of its size, because a second request for a glyph is a
 * blit that never enters the scaler.
 */
#include "probe.h"
#include <toolhelp.h>

#define OUTPUT "C:\\ORACLE\\GROUNDSC.OUT"

#define CELL_WIDTH  64
#define CELL_HEIGHT 64

#define MAX_BLOCKS 256

/* The window the bitmap metrics sit in. It is not at a fixed offset between
 * faces -- 8k found Arial's size fields at +0x1602 and Times New Roman's eight
 * bytes further on -- so a generous window is dumped and the fields are found
 * on the other side by what they hold. */
#define WINDOW_FROM 0x1540
#define WINDOW_TO   0x1660

static HDC memory;
static HBITMAP canvas;

static DWORD sizes[MAX_BLOCKS];
static WORD selectors[MAX_BLOCKS];
static int found;

static char buffer[64];
static const char HEX[] = "0123456789abcdef";

static void census(void)
{
    GLOBALENTRY entry;
    BOOL more;

    entry.dwSize = sizeof(GLOBALENTRY);
    more = GlobalFirst(&entry, GLOBAL_ALL);

    while (more && found < MAX_BLOCKS) {
        sizes[found] = entry.dwBlockSize;
        selectors[found] = GlobalHandleToSel(entry.hBlock);
        found++;

        entry.dwSize = sizeof(GLOBALENTRY);
        more = GlobalNext(&entry, GLOBAL_ALL);
    }

    wsprintf(probeResult, "blocks=%d", found);
    probe("census", "all", probeResult);
}

static void draw(LPCSTR face, int height, char character)
{
    HFONT font;
    HFONT previous;
    char text[2];

    font = CreateFont(height, 0, 0, 0, FW_NORMAL, 0, 0, 0, ANSI_CHARSET,
                      OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                      DEFAULT_QUALITY, DEFAULT_PITCH, face);

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

    SelectObject(memory, previous);
    DeleteObject(font);
}

/* The window out of every block big enough to be the scaler's buffer. */
static void dump(LPCSTR face, int height, char character)
{
    int index;

    for (index = 0; index < found; index++) {
        DWORD at;

        if (sizes[index] < 0x4000 || sizes[index] > 0x4400) {
            continue;
        }

        for (at = WINDOW_FROM; at < WINDOW_TO; at += 32) {
            DWORD got = MemoryRead(selectors[index], at, buffer, 32);
            LPSTR out = probeResult;
            int byte;

            if (got == 0) {
                break;
            }

            for (byte = 0; byte < (int)got; byte++) {
                unsigned char value = (unsigned char)buffer[byte];

                *out++ = HEX[(value >> 4) & 0x0f];
                *out++ = HEX[value & 0x0f];
            }

            *out = '\0';

            wsprintf(probeArgs, "\"%s\",h=%d,'%c',%d,+%04x",
                     (LPSTR)face, height, character, index, (int)at);
            probe("bytes", probeArgs, probeResult);
        }
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    /* Cells where the rectangle is wider than anything this side computes, and
     * cells either side where it is not. */
    static const int ARIAL_L[] = { 10, 12, 13, 14, 15, 21, 27, 43, 45, 47, 0 };
    static const int COURIER_L[] = { 12, 14, 24, 0 };

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

    /* One draw at a size the sweep does not use, so that whatever the scaler
     * allocates for a size exists to be counted before the census. */
    draw("Arial", 64, 'o');

    census();

    probeNote("the scaler's bitmap metrics at the cells the ground rectangle disagrees about");

    for (at = 0; ARIAL_L[at]; at++) {
        draw("Arial", ARIAL_L[at], 'l');
        dump("Arial", ARIAL_L[at], 'l');
    }

    for (at = 0; COURIER_L[at]; at++) {
        draw("Courier New", COURIER_L[at], 'l');
        dump("Courier New", COURIER_L[at], 'l');
    }

    draw("Arial", 12, 'A');
    dump("Arial", 12, 'A');
    draw("Arial", 16, 'A');
    dump("Arial", 16, 'A');

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
