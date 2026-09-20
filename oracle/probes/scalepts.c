/*
 * Looking for the fitted outline after the call, and what that rules out.
 *
 * `scalemem` reads the scaler's buffer once `TextOut` has returned and finds
 * the glyph's metrics there and not its points. `heap.c` says why that need not
 * be the end of it: a buffer allocated for a call and freed at the end of it is
 * a free block afterwards, **holding exactly what it held**, and `scalemem`
 * walks only the blocks GDI owns. So walk everyone's.
 *
 * The glyph is Arial's `w` at the one cell of `KNOWN_GAPS` -- forty-two pixels
 * tall, with six of its nineteen points on that top edge, which is 2,688 in
 * sixty-fourths six times over. Three or more of those in one block is a
 * signature worth dumping the neighbourhood of.
 *
 * **It is not there.** Forty-five blocks in the size range read cleanly and the
 * glyph's top edge appears in none of them at the cell in question; the one
 * block that matched at the other cell holds the font's own bytecode, where the
 * pair happens to fall out of `b8 ff de 40 0d` and the like. The points are
 * gone by the time the call returns.
 *
 * Three ways of reading further that do **not** work, so that the next attempt
 * does not spend them again:
 *
 *   - `AllocSelector(0)` with `SetSelectorBase` and `SetSelectorLimit` over a
 *     block's linear address -- which is what `heap.c` reaches for behind an
 *     `#ifdef` -- **hangs the guest**. Reading through such a selector faults,
 *     and a fault under Windows 3.1 is a message box, which is a run that never
 *     finishes rather than one that fails.
 *   - `MemoryRead` through a selector the program made for itself answers
 *     nought every time: it validates what it is given against the global heap.
 *     Two hundred and twenty-seven blocks, not one byte.
 *   - `MemoryRead` on 0x00bc, the fixed stack the scaler's thunk switches to,
 *     answers nought as well. That selector is named in `heap.c`'s reading of
 *     the thunk; nothing has ever read through it.
 *
 * What does work is `GlobalHandleToSel` on the handle `GlobalFirst` reports,
 * for **any** block and not only an owned one, which is what this uses.
 */

#include "probe.h"
#include <toolhelp.h>

#define OUTPUT "C:\\ORACLE\\SCALEPTS.OUT"

#define PROBE_FACE "Arial"
#define PROBE_CHAR 'w'

#define CELL_WIDTH  64
#define CELL_HEIGHT 128

#define MAX_BLOCKS 256

/* Forty-two pixels in sixty-fourths, which is the top of this glyph at the cell
 * that disagrees; and thirty-seven at the cell that agrees. */
#define TOP_TALL 2688
#define TOP_SHORT 2368

#define WINDOW 64

static HDC memory;
static HBITMAP canvas;

static HGLOBAL handles[MAX_BLOCKS];
static DWORD addresses[MAX_BLOCKS];
static DWORD sizes[MAX_BLOCKS];
static int found;

static char buffer[WINDOW];
static const char HEX[] = "0123456789abcdef";

static void census(void)
{
    GLOBALENTRY entry;
    BOOL more;

    entry.dwSize = sizeof(GLOBALENTRY);
    more = GlobalFirst(&entry, GLOBAL_ALL);

    while (more && found < MAX_BLOCKS) {
        handles[found] = entry.hBlock;
        addresses[found] = entry.dwAddress;
        sizes[found] = entry.dwBlockSize;
        found++;

        entry.dwSize = sizeof(GLOBALENTRY);
        more = GlobalNext(&entry, GLOBAL_ALL);
    }

    wsprintf(probeResult, "blocks=%d", found);
    probe("census", "all", probeResult);
}

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

/* Writes one window out, two bytes to a word, so a reader can take it as `y`. */
static void report(int height, int index, DWORD at, int got)
{
    LPSTR out = probeResult;
    int byte;

    for (byte = 0; byte < got; byte++) {
        unsigned char value = (unsigned char)buffer[byte];

        *out++ = HEX[(value >> 4) & 0x0f];
        *out++ = HEX[value & 0x0f];
    }

    *out = '\0';

    wsprintf(probeArgs, "h=%d,%d,+%08lx", height, index, at);
    probe("window", probeArgs, probeResult);
}

/*
 * Every block, in windows, reporting the ones that look like the outline.
 *
 * A window is reported when it holds three or more words equal to the glyph's
 * top edge, and the two windows either side of it go with it so that the `x`
 * array next door is in the recording too.
 */
static void hunt(int height, int wanted)
{
    int index;
    int blocks = 0;
    int hits = 0;

    for (index = 0; index < found; index++) {
        DWORD size = sizes[index];
        WORD selector;
        DWORD at;
        int seen = 0;
        LPSTR out = probeResult;
        DWORD firstHit = 0;

        /* Only blocks that could be the point buffer, and read through the
         * handle's own selector.
         *
         * `AllocSelector` over a linear address is what `heap.c` reaches for to
         * get at a free block, and it hangs the guest here -- a selector made
         * that way faults on the first read and Windows 3.1 answers a fault
         * with a message box, which is a run that never finishes. A free block
         * still has a handle in the arena, and `GlobalHandleToSel` on that is
         * the path `heap.c`'s census already uses. The only thing wrong with
         * `scalemem` was that it asked GDI's blocks and not everyone's.
         */
        if (size < 0x1000L || size > 0x8000L) {
            continue;
        }

        selector = GlobalHandleToSel(handles[index]);

        if (selector == 0) {
            continue;
        }

        blocks++;

        for (at = 0; at + 1 < size; at += 2) {
            WORD value;

            if (MemoryRead(selector, at, buffer, 2L) != 2L) {
                break;
            }

            value = (WORD)((buffer[0] & 0xff) | ((buffer[1] & 0xff) << 8));

            if (value == (WORD)wanted) {
                if (seen == 0) {
                    firstHit = at;
                }

                if (seen < 12) {
                    out += wsprintf(out, "%lx,", at);
                }

                seen++;
            }
        }

        if (seen >= 3) {
            DWORD from = firstHit > 128L ? firstHit - 128L : 0L;
            DWORD byte;

            *out = '\0';
            wsprintf(probeArgs, "h=%d,%d,size=%lx,seen=%d", height, index, size, seen);
            probe("where", probeArgs, probeResult);

            hits++;

            for (byte = 0; byte < 384L && from + byte + 32L <= size; byte += 32L) {
                LPSTR line = probeResult;
                int k;

                if (MemoryRead(selector, from + byte, buffer, 32L) != 32L) {
                    break;
                }

                for (k = 0; k < 32; k++) {
                    unsigned char value = (unsigned char)buffer[k];

                    *line++ = HEX[(value >> 4) & 0x0f];
                    *line++ = HEX[value & 0x0f];
                }

                *line = '\0';
                wsprintf(probeArgs, "h=%d,%d,+%04x", height, index, (int)(from + byte));
                probe("window", probeArgs, probeResult);
            }
        }
    }

    wsprintf(probeArgs, "h=%d,want=%d", height, wanted);
    wsprintf(probeResult, "blocks=%d,hits=%d", blocks, hits);
    probe("hunt", probeArgs, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HDC screen;

    probeOpen(OUTPUT);

    screen = GetDC(NULL);
    memory = CreateCompatibleDC(screen);
    canvas = CreateBitmap(CELL_WIDTH, CELL_HEIGHT, 1, 1, NULL);

    if (memory == NULL || canvas == NULL) {
        probe("setup", "64x128x1", "failed");
        probeFinish();
        return 0;
    }

    SelectObject(memory, canvas);

    probeNote("one draw at a size the hunt does not use, then the census");
    draw(40);

    census();

    /* The cell that disagrees, then the cell that agrees, each drawn once so
     * that the scaler actually runs and the buffer holds this glyph. */
    /* Find the block the outline lands in, by the cell that agrees.
     *
     * Its top edge is thirty-seven whole pixels there, and four of the glyph's
     * points sit on it. Then dump that block whole at each cell, each on the
     * character's first draw at that size so the scaler actually runs.
     */
    /* Each cell drawn once, so the scaler actually runs, and every block in
     * the plausible range read afterwards.
     */
    probeNote("the cell that disagrees");
    draw(88);
    hunt(88, TOP_TALL);

    probeNote("and the cell that agrees");
    draw(80);
    hunt(80, TOP_SHORT);

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
