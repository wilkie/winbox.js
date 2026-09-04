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

/* What this run reads. The two characters are written down as `y` and `1` in the
 * records whatever they are, because every reader of this fixture compares two
 * cells and does not care what they were called. */
#define PROBE_FACE   "Times New Roman"
#define PROBE_HEIGHT 31
#define PROBE_ONE    ((char)0xe4)
#define PROBE_TWO    ((char)0xe5)

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
static int scalerBlock = -1;
static HMODULE gdiModule;
static int found;

static char buffer[CHUNK];
static const char HEX[] = "0123456789abcdef";

/* How far below the drawing call to keep, which is what the stack probe found
 * the whole frame to be. */
#define DEPTH 2560

/* Not on the stack, because the stack is the thing being copied. */
static char residue[DEPTH];
static WORD residueTop;

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

/*
 * Copies the stack below this call out, so that the frame and the heap can be
 * read in the same run.
 *
 * The two have to come from one run or they cannot be put together: a selector
 * is whatever the heap handed out that time, so a pointer found in a frame
 * recorded on Tuesday means nothing against a census taken on Wednesday. There
 * is deliberately no call in the loop, for the reason `stack.c` gives.
 */
static void captureStack(void)
{
    char marker;
    char far *base = (char far *)&marker;
    unsigned index;

    residueTop = (WORD)(DWORD)base;

    if (residueTop < DEPTH) {
        return;
    }

    base = base - DEPTH;

    for (index = 0; index < DEPTH; index++) {
        residue[index] = base[index];
    }
}

/*
 * Draws one character and keeps the stack it was drawn on.
 *
 * The capture has to be the first thing after the call, before the font is let
 * go and before anything is written down, because every one of those is a call
 * and a call lands on the very bytes being read.
 */
static void probeFrame(LPCSTR face, int height, char character)
{
    HFONT font = CreateFont(height, 0, 0, 0, FW_NORMAL, 0, 0, 0, ANSI_CHARSET,
                            OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                            DEFAULT_QUALITY, DEFAULT_PITCH, face);
    HFONT previous;
    char text[2];
    unsigned at;

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

    captureStack();

    SelectObject(memory, previous);
    DeleteObject(font);

    wsprintf(probeArgs, "'%c'", character);
    wsprintf(probeResult, "sp=%04x,ss=%04x,depth=%d", (int)residueTop,
             (int)(WORD)((DWORD)(char far *)&font >> 16), DEPTH);
    probe("frame", probeArgs, probeResult);

    /*
     * And the head of every block, because one of them is the scaler's stack.
     *
     * The thunk saves the caller's `ss` and `sp` into its own segment at `0x16`
     * and `0x18` before it switches, so the segment that holds this program's
     * own stack pointer at those two offsets is the one the scan converter ran
     * on. That is a signature no other block can accidentally carry, and it
     * finds the segment without having to know which selector the loader gave
     * it.
     */
    {
        int index;

        for (index = 0; index < found; index++) {
            WORD selector = GlobalHandleToSel(blocks[index]);
            LPSTR out;
            int byte;

            if (selector == 0 || MemoryRead(selector, 0x10L, buffer, 16L) == 0) {
                continue;
            }

            out = probeResult;

            for (byte = 0; byte < 16; byte++) {
                unsigned char value = (unsigned char)buffer[byte];

                *out++ = HEX[(value >> 4) & 0x0f];
                *out++ = HEX[value & 0x0f];
            }

            *out = '\0';

            /* And the one whose head carries this program's own stack pointer is
             * the scaler's segment, whatever size the loader gave it. Matching
             * on the size only worked for the font it was first written for. */
            if ((buffer[0x18 - 0x10] | (buffer[0x19 - 0x10] << 8)) ==
                (int)(WORD)((DWORD)(char far *)&font >> 16)) {
                scalerBlock = index;
            }

            wsprintf(probeArgs, "'%c',%d", character, index);
            probe("head", probeArgs, probeResult);
        }
    }

    for (at = 0; at < DEPTH; at += 32) {
        LPSTR out = probeResult;
        int byte;

        for (byte = 0; byte < 32; byte++) {
            unsigned char value = (unsigned char)residue[at + byte];

            *out++ = HEX[(value >> 4) & 0x0f];
            *out++ = HEX[value & 0x0f];
        }

        *out = '\0';

        wsprintf(probeArgs, "'%c',-%04x", character, (int)(DEPTH - at));
        probe("stack", probeArgs, probeResult);
    }
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

/*
 * Writes out a selector that belongs to no block, until it stops reading.
 *
 * The scaler does not run on the stack of whoever called it. Its thunk, at
 * segment 36 offset `0xae`, sets `ss` to a fixed `0x00bc` and `sp` to a saved
 * offset before it calls, and puts them back afterwards -- so every frame the
 * scan converter builds is on a stack of its own, and the residue probe has
 * been reading the wrong one all along. That is why no coordinate and no
 * pointer to the outline is ever in it: nothing that matters happens there.
 *
 * A stack that is switched away from is abandoned rather than cleared, exactly
 * as the caller's is, so it can be read afterwards the same way. `MemoryRead`
 * takes a selector and does not care that no block of the heap owns it, and it
 * returns nought rather than faulting where the segment ends -- which is also
 * how far to go.
 */
static void dumpSelector(WORD selector, char character, DWORD to)
{
    DWORD at = 0;

    while (at < to) {
        DWORD got = MemoryRead(selector, at, buffer, 32L);
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

        wsprintf(probeArgs, "'%c',+%04x", character, (int)at);
        probe("scaler", probeArgs, probeResult);

        at += got;
    }
}

/* Writes part of a block out, thirty-two bytes to a record. */
static void dumpRange(int index, char character, DWORD from, DWORD to)
{
    WORD selector = GlobalHandleToSel(blocks[index]);
    DWORD at = from;

    if (selector == 0) {
        return;
    }

    while (at < to) {
        DWORD want = to - at;
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
        probe("window", probeArgs, probeResult);

        at += got;
    }
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
    probeNote("one draw of a character the sweep does not use, then the census");
    {
        HFONT font = CreateFont(8, 0, 0, 0, FW_NORMAL, 0, 0, 0, ANSI_CHARSET,
                                OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                                DEFAULT_QUALITY, DEFAULT_PITCH, PROBE_FACE);
        HFONT was = (HFONT)SelectObject(memory, font);

        TextOut(memory, 2, 0, "Z", 1);

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
    /*
     * The sweep, and every draw in it the first of its character.
     *
     * This has to come before anything else touches these glyphs. GDI keeps
     * drawn glyphs, and a second request for one is a blit that never enters
     * the scaler at all -- so a block read after a cached draw holds whatever
     * the last *uncached* glyph left in it, which is a different character's
     * answer wearing this character's name. Reading the block for the eleven
     * bearings after they had each been drawn once already gives eleven
     * identical dumps, which is how this was found.
     *
     * The two cells the box disagrees about are dumped whole; the other nine
     * are dumped at the three places the whole-block comparison showed moving,
     * which is enough to read a field against the sweep.
     */
    probeNote("the frame and the block together, each on the character's first draw");
    {
        static const char CHARS[] = "";
        int which;
        int index;
        int scaler = -1;

        for (index = 0; index < found; index++) {
            if (owners[index] == gdiModule && sizes[index] == 0x4000L) {
                scaler = index;
            }
        }

        (void)scaler;

        {
            /* The frame and the block for one character together, both from its
             * first draw, so that a pointer found in the frame can be looked up
             * in the block as it stood at that moment. Drawing it again to read
             * the second of them would be reading a blit. */
            /* Two characters of whatever face the recording is pointed at.
             *
             * `PROBE_FACE`, `PROBE_HEIGHT` and the two characters are the whole
             * of what a run varies. A fabrication that rewrites one face wants
             * its own face read, and the cell that is still wrong is an accented
             * letter of Times New Roman at a thirty-one pixel cell rather than a
             * dot of Symbol at eight.
             */
            probeFrame(PROBE_FACE, PROBE_HEIGHT, PROBE_ONE);

            if (scalerBlock >= 0) {
                dump(scalerBlock, 'y');
            }

            probeFrame(PROBE_FACE, PROBE_HEIGHT, PROBE_TWO);

            if (scalerBlock >= 0) {
                dump(scalerBlock, '1');
            }

            /* And GDI's own data segment, once.
             *
             * The frame holds no pointer to the block the points are in -- the
             * only selector of GDI's it carries in quantity is `DGROUP` itself.
             * So the element is reached through a field in GDI's data rather
             * than through anything passed on the stack, and that field is what
             * names the routine which reads it.
             */
            for (index = 0; index < found; index++) {
                if (owners[index] == gdiModule && sizes[index] == 0x3180L) {
                    dump(index, 'd');
                }
            }

            for (which = 0; CHARS[which]; which++) {
                draw(PROBE_FACE, PROBE_HEIGHT, CHARS[which]);

                dumpRange(scaler, CHARS[which], 0x1380L, 0x1400L);
                dumpRange(scaler, CHARS[which], 0x2260L, 0x22a0L);
            }
        }
    }

    /*
     * And the frame the box is marshalled in, from the same run as the census.
     *
     * The box is not in any block, so the step that makes it leaves nothing
     * behind but the frame it ran in. What the frame can still say is *which*
     * structure it was made from: a far pointer whose selector is the scaler's
     * block names the thing being read, and the offset says which part of it.
     * Both characters are drawn fresh, after everything above has already put
     * them in the cache -- so these two frames are a cached draw and are worth
     * exactly what a cached draw is worth, which the analysis has to allow for.
     */
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
