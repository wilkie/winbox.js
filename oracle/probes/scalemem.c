/*
 * What the scaler holds at the size where Arial and Times go wrong.
 *
 * `stemwide` and `stemedge` put the gap between a cell of two hundred and
 * twelve and one of two hundred and fourteen on an EGA, for Arial and Times New
 * Roman and not for Courier New. `times-ruler` says the scaling is right on
 * both axes; tracing says this side runs the same instructions in the same
 * order either side of the crossing, with the same control values scaling
 * smoothly, and that the values `prep` leaves behind scale smoothly too. So
 * nothing branches here, and Windows draws a glyph bigger in both directions
 * from the moment the horizontal size passes two hundred and fifty-six.
 *
 * If the number that jumps is not in anything this can compute, read the
 * scaler's memory and look for it. `heap.c` established the method and the
 * caution: `TOOLHELP`'s `GlobalFirst`, `GlobalNext`, `GlobalHandleToSel` and
 * `MemoryRead`, nothing written, and **every draw the first of its size**,
 * because a second request for a glyph is a blit that never enters the scaler.
 *
 * Here the sweep is in the size rather than in the character. The same letter
 * is drawn at four cells -- two below the crossing and two above -- and GDI's
 * blocks are dumped after each. A field that holds the size reads 251, 255, 257
 * and 259 across them, or 188, 191, 193 and 194, or those in sixty-fourths; a
 * field that is the difference reads three of those and then something else.
 */
#include "probe.h"
#include <toolhelp.h>

#define OUTPUT "C:\\ORACLE\\SCALEMEM.OUT"

/* The face and the cells are the whole of what a run varies, and the structure
 * this reads is not at a fixed offset between faces -- Arial's sits at +0x1602,
 * Courier New's one byte further on, Times New Roman's eight. Find it by
 * looking for the word that rises with the size rather than by an address.
 */
#define PROBE_FACE "Arial"
#define PROBE_CHAR 'B'

/* Tall enough to hold the glyph at these cells, and one bit a pixel. */
#define CELL_WIDTH  64
#define CELL_HEIGHT 256

#define MAX_BLOCKS 256

static HDC memory;
static HBITMAP canvas;

static HGLOBAL blocks[MAX_BLOCKS];
static DWORD sizes[MAX_BLOCKS];
static HGLOBAL owners[MAX_BLOCKS];
static WORD selectors[MAX_BLOCKS];
static WORD kinds[MAX_BLOCKS];
static int found;
static HMODULE gdiModule;

static char buffer[64];
static const char HEX[] = "0123456789abcdef";

/* Every block in the system, with who owns it. */
static void census(void)
{
    GLOBALENTRY entry;
    BOOL more;

    gdiModule = GetModuleHandle("GDI");

    entry.dwSize = sizeof(GLOBALENTRY);
    more = GlobalFirst(&entry, GLOBAL_ALL);

    while (more && found < MAX_BLOCKS) {
        blocks[found] = entry.hBlock;
        sizes[found] = entry.dwBlockSize;
        owners[found] = entry.hOwner;
        selectors[found] = GlobalHandleToSel(entry.hBlock);
        kinds[found] = entry.wType;

        wsprintf(probeArgs, "%d", found);
        wsprintf(probeResult, "sel=%04x,size=%lx,flags=%04x,type=%u,owner=%04x",
                 (int)selectors[found], entry.dwBlockSize, (int)entry.wFlags,
                 (int)entry.wType, (int)entry.hOwner);
        probe("block", probeArgs, probeResult);

        found++;

        entry.dwSize = sizeof(GLOBALENTRY);
        more = GlobalNext(&entry, GLOBAL_ALL);
    }

    wsprintf(probeResult, "blocks=%d,gdi=%04x", found, (int)gdiModule);
    probe("census", "all", probeResult);
}

/* One character at one cell, and nothing else selected around it. */
static void draw(int height)
{
    HFONT font = CreateFont(height, 0, 0, 0, FW_NORMAL, 0, 0, 0, ANSI_CHARSET,
                            OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                            DEFAULT_QUALITY, DEFAULT_PITCH, PROBE_FACE);
    HFONT previous;
    char text[2];

    if (font == NULL) {
        return;
    }

    previous = (HFONT)SelectObject(memory, font);

    PatBlt(memory, 0, 0, CELL_WIDTH, CELL_HEIGHT, WHITENESS);

    SetTextColor(memory, RGB(0, 0, 0));
    SetBkColor(memory, RGB(255, 255, 255));
    SetBkMode(memory, OPAQUE);

    text[0] = PROBE_CHAR;
    text[1] = '\0';

    TextOut(memory, 2, 0, text, 1);

    SelectObject(memory, previous);
    DeleteObject(font);
}

/* One block, thirty-two bytes a record, tagged with the cell it was read at. */
static void dump(int index, int height)
{
    WORD selector = selectors[index];
    DWORD size = sizes[index];
    DWORD at = 0;

    if (selector == 0) {
        return;
    }

    while (at < size) {
        DWORD want = size - at;
        DWORD got;
        LPSTR out = probeResult;
        int byte;

        if (want > 32) {
            want = 32;
        }

        got = MemoryRead(selector, at, buffer, want);

        if (got == 0) {
            break;
        }

        for (byte = 0; byte < (int)got; byte++) {
            unsigned char value = (unsigned char)buffer[byte];

            *out++ = HEX[(value >> 4) & 0x0f];
            *out++ = HEX[value & 0x0f];
        }

        *out = '\0';

        wsprintf(probeArgs, "h=%d,%d,+%04x", height, index, (int)at);
        probe("bytes", probeArgs, probeResult);

        at += got;
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    /* Two cells below the crossing and two above it. */
    /* Two cells either side of the crossing on an EGA, and four more that
     * cross the same horizontal size on a square pixel, where the cell has to
     * be much taller to reach it.
     */
    static const int HEIGHTS[] = { 283, 284, 285, 286, 287, 288, 289, 290, 0 };

    HDC screen;
    int at;
    int index;

    probeOpen(OUTPUT);

    screen = GetDC(NULL);
    memory = CreateCompatibleDC(screen);
    canvas = CreateBitmap(CELL_WIDTH, CELL_HEIGHT, 1, 1, NULL);

    if (memory == NULL || canvas == NULL) {
        probe("setup", "64x256x1", "failed");
        probeFinish();
        return 0;
    }

    SelectObject(memory, canvas);

    /* One draw at a size the sweep does not use, so that whatever the scaler
     * allocates for a size exists to be counted before the census. */
    probeNote("one draw at a size the sweep does not use, then the census");
    draw(64);

    census();

    /* And the sweep. Each cell is asked for once and only once, so every draw
     * is the first of its size and the scaler actually runs.
     */
    probeNote("the same letter at four cells, each dumped on its first draw");

    for (at = 0; HEIGHTS[at]; at++) {
        draw(HEIGHTS[at]);

        /* GDI's data segment, and not its sixteen kilobyte point buffer.
         *
         * The buffer holds the glyph, so every byte of it changes between two
         * sizes and it is all noise for this question. What is wanted is the
         * state a size is set up in, which lives where GDI keeps its own
         * variables -- the block `heap.c` names `DGROUP`, about twelve
         * kilobytes, and the largest thing GDI owns that is not the buffer.
         */
        for (index = 0; index < found; index++) {
            /* GDI's own data blocks, which is where the scaler keeps its
             * per-size state. Its size is not the same for every face -- the
             * buffer is cut from `maxp` -- so this goes by kind and not by a
             * length. */
            if (owners[index] == gdiModule && kinds[index] == 2 &&
                sizes[index] >= 0x1000L && sizes[index] <= 0x8000L) {
                dump(index, HEIGHTS[at]);
            }
        }
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
