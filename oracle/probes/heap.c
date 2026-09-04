/*
 * What the scaler leaves on the heap.
 *
 * The stack probe reads the memory a drawing call ran on, and it has taken that
 * as far as it goes. Opened on the whole frame it shows the scan converter's
 * box arriving already made: between two cells that differ only in a side
 * bearing, twelve bytes of two and a quarter kilobytes change, and not one of
 * them is a coordinate. The numbers the box was computed from are not on the
 * stack at all.
 *
 * They are on the heap. The scaler allocates its point buffer from `maxp` once
 * per size and fits every glyph of that size in it -- which is why carrying the
 * previous glyph's tail forward is worth 26 cells of the fabricated corpus --
 * and a buffer that outlives the call is a buffer this program can go and read
 * afterwards.
 *
 * `TOOLHELP` is how. `GlobalFirst` and `GlobalNext` walk the global heap and
 * say who owns each block; `GlobalHandleToSel` turns a handle into a selector;
 * and `MemoryRead` reads through that selector without the program having to
 * construct a pointer it might not be allowed to hold. Nothing here writes.
 *
 * This is the census, and it is deliberately not the answer. It records every
 * block GDI owns, and then a checksum of each after drawing each of a spread of
 * characters. A block whose checksum is the same for every character holds
 * nothing about the glyph; a block that changes with the character is where the
 * glyph went, and that is the one worth dumping. Finding it by what moves is
 * the same trick the stack probe used to find the box, one storey down.
 */
#include "probe.h"
#include <toolhelp.h>

#define OUTPUT "C:\\ORACLE\\HEAP.OUT"

/* The same cell every other probe draws into. */
#define CELL_WIDTH  32
#define CELL_HEIGHT 32

/* More than GDI is ever seen to own, and small enough to sit in a segment. */
#define MAX_BLOCKS 256

/* Read in pieces so the buffer is a local and not a segment of its own. */
#define CHUNK 512

static HDC memory;
static HBITMAP canvas;

static HGLOBAL blocks[MAX_BLOCKS];
static DWORD sizes[MAX_BLOCKS];
static HGLOBAL owners[MAX_BLOCKS];
static HMODULE gdiModule;
static int found;

static char buffer[CHUNK];
static const char HEX[] = "0123456789abcdef";

/*
 * A running sum over a block, rotated so that order matters.
 *
 * A plain sum would miss two bytes swapping, which is exactly the kind of
 * change a point buffer makes.
 */
static WORD checksum(HGLOBAL block, DWORD size)
{
    WORD selector = GlobalHandleToSel(block);
    DWORD at = 0;
    WORD sum = 0;

    if (selector == 0) {
        return 0;
    }

    while (at < size) {
        DWORD want = size - at;
        DWORD got;
        int index;

        if (want > CHUNK) {
            want = CHUNK;
        }

        got = MemoryRead(selector, at, buffer, want);

        if (got == 0) {
            break;
        }

        for (index = 0; index < (int)got; index++) {
            sum = (WORD)(((sum << 1) | (sum >> 15)) + (unsigned char)buffer[index]);
        }

        at += got;
    }

    return sum;
}

/* Every global block GDI owns, in the order the heap holds them. */
static void census(void)
{
    GLOBALENTRY entry;
    HMODULE gdi = GetModuleHandle("GDI");
    BOOL more;

    gdiModule = gdi;

    entry.dwSize = sizeof(GLOBALENTRY);
    more = GlobalFirst(&entry, GLOBAL_ALL);

    while (more && found < MAX_BLOCKS) {
        /* Every block, not only GDI's.
         *
         * The scaler's point buffer need not still belong to anyone by the time
         * this looks: a buffer allocated for a call and freed at the end of it
         * is a free block afterwards, holding exactly what it held, and owned by
         * nobody. Filtering on GDI's ownership was how the first census missed
         * everything except the bitmap being drawn into.
         */
        if (1) {
            blocks[found] = entry.hBlock;
            sizes[found] = entry.dwBlockSize;
            owners[found] = entry.hOwner;

            wsprintf(probeArgs, "%d", found);
            wsprintf(probeResult, "sel=%04x,size=%lx,flags=%04x,type=%u,owner=%04x",
                     (int)GlobalHandleToSel(entry.hBlock), entry.dwBlockSize,
                     (int)entry.wFlags, (int)entry.wType, (int)entry.hOwner);
            probe("block", probeArgs, probeResult);

            found++;
        }

        entry.dwSize = sizeof(GLOBALENTRY);
        more = GlobalNext(&entry, GLOBAL_ALL);
    }

    wsprintf(probeResult, "blocks=%d,gdi=%04x", found, (int)gdi);
    probe("census", "all", probeResult);
}

/* Draws a character without recording anything, to put the heap in the state
 * that character leaves it in. */
static void draw(LPCSTR face, int height, char character)
{
    HFONT font = CreateFont(height, 0, 0, 0, FW_NORMAL, 0, 0, 0, ANSI_CHARSET,
                            OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                            DEFAULT_QUALITY, DEFAULT_PITCH, face);
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

    text[0] = character;
    text[1] = '\0';

    TextOut(memory, 2, 0, text, 1);

    SelectObject(memory, previous);
    DeleteObject(font);
}

/* Writes a block out, thirty-two bytes to a record. */
static void dump(int index, char character)
{
    WORD selector = GlobalHandleToSel(blocks[index]);
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

        wsprintf(probeArgs, "'%c',%d,+%04x", character, index, (int)at);
        probe("bytes", probeArgs, probeResult);

        at += got;
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HDC screen;

    probeOpen(OUTPUT);

    screen = GetDC(NULL);
    memory = CreateCompatibleDC(screen);
    canvas = CreateBitmap(CELL_WIDTH, CELL_HEIGHT, 1, 1, NULL);

    if (memory == NULL || canvas == NULL) {
        probe("setup", "32x32x1", "failed");
        probeFinish();
        return 0;
    }

    SelectObject(memory, canvas);

    /* One draw before the census, so that whatever the scaler allocates for
     * this size exists to be counted. A block that is not there yet cannot be
     * watched. */
    probeNote("one draw to make the scaler allocate, then the census");
    {
        HFONT font = CreateFont(8, 0, 0, 0, FW_NORMAL, 0, 0, 0, ANSI_CHARSET,
                                OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                                DEFAULT_QUALITY, DEFAULT_PITCH, "Symbol");
        HFONT was = (HFONT)SelectObject(memory, font);

        TextOut(memory, 2, 0, "K", 1);

        SelectObject(memory, was);
        DeleteObject(font);
    }

    census();

    /* The bearing sweep the stack probe reads, at the size where its box moves
     * a column further than any rule that fits the other five hundred. */

    /*
     * And the blocks that tell the two cells apart, byte for byte.
     *
     * Hashing says which blocks hold something about the glyph; it cannot say
     * what. So the two characters whose boxes differ are drawn again, either
     * side of a comparison, and every block whose hash moves between them is
     * written out in both states. Everything that does not move is left out,
     * which is most of GDI's heap and all of its code.
     */
    probeNote("the blocks that differ between the two cells, in full");
    {
        static WORD before[MAX_BLOCKS];
        static char changed[MAX_BLOCKS];
        int index;

        draw("Symbol", 8, 'y');

        for (index = 0; index < found; index++) {
            before[index] = checksum(blocks[index], sizes[index]);
        }

        draw("Symbol", 8, '1');

        for (index = 0; index < found; index++) {
            /* Whose block it is decides whether it is worth writing out.
             *
             * The census is of everything, because the point buffer need not
             * belong to anyone by the time it is read. What comes out of the
             * comparison, though, is mostly other modules getting on with their
             * own business between two draws -- one block that moves is full of
             * another module's text. Only GDI's are dumped.
             */
            changed[index] = (char)(owners[index] == gdiModule &&
                                    checksum(blocks[index], sizes[index]) != before[index]);

            if (changed[index]) {
                dump(index, '1');
            }
        }

        draw("Symbol", 8, 'y');

        for (index = 0; index < found; index++) {
            if (changed[index]) {
                dump(index, 'y');
            }
        }

        /* And then the small ones across the whole sweep, so that a byte which
         * moves can be read against the bearing that moved it rather than
         * against one other character. */
        {
            static const char CHARS[] = "ABKMWagjmy1";
            int which;

            for (which = 0; CHARS[which]; which++) {
                draw("Symbol", 8, CHARS[which]);

                for (index = 0; index < found; index++) {
                    if (changed[index] && sizes[index] <= 0x400L) {
                        dump(index, CHARS[which]);
                    }
                }
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
