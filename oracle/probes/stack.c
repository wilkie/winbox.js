/*
 * The stack the scaler left behind.
 *
 * Every other probe here asks Windows a question and writes down the answer.
 * This one asks nothing. It draws a single character and then reads the memory
 * the drawing ran on, because the number it is after is one Windows has no API
 * for and never returns.
 *
 * The question is the bounding box. `FONTS.md` section 9 has the whole chase:
 * the scan converter is handed a box -- a left and a right column, a low and a
 * high row -- and every pixel it decides turns on where that box's edges fall.
 * Our own box is computed from the outline and agrees with the oracle on every
 * glyph but eleven, and those eleven are a glyph Windows is slanting, where a
 * feature narrower than a pixel lands differently than our rule says. Reading
 * the scaler's image settled what the box is *used* for and never where it
 * comes from: the four words are already in a parameter block by the time the
 * scan driver is entered, marshalled by segment 40 out of a structure belonging
 * to a caller that ten separate searches failed to find.
 *
 * So stop reading and watch. A Win16 DLL has no stack of its own -- it runs on
 * the stack of whoever called it -- and GDI is a DLL. Every frame the font
 * scaler pushes, the parameter block included, is built *on this program's own
 * stack*, in the memory immediately below the `TextOut` call. When `TextOut`
 * returns none of it is cleared. It is simply abandoned, and it is still there.
 *
 * The whole probe is that observation. Draw one character; copy the stack out
 * from under the call before anything else can touch it; write down the bytes.
 * What the four words are, and which offset of the block they sit at, is then
 * a question about a hex dump rather than about a disassembly -- and the dump
 * can be taken twice, once upright and once slanted, so the words that answer
 * to the slant identify themselves by being the ones that move.
 *
 * Two details make it work rather than nearly work.
 *
 * The copy has to come first. `probe()` builds its record in a 2400 byte local,
 * which is to say that the act of writing anything down obliterates most of
 * what is worth writing down. So the capture is a loop with no calls in it,
 * into a buffer on the global heap, and every `wsprintf` happens afterwards.
 *
 * And reading below the stack pointer is safe here, which is not a general
 * claim. In the large model the stack lives at the top of the program's own
 * data segment, so an address below it is still an address inside a segment
 * this program owns; the only real bound is the segment itself, and that is
 * what the check on the offset is for. Nothing is written. This reads memory
 * that this program was handed, that it has finished with, and that Windows
 * has not yet reused.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\STACK.OUT"

/* The same cell the glyph probe draws into, so that a character drawn here and
 * the same character drawn there are the same call with the same arguments and
 * the residue belongs to a picture we already have.
 */
#define CELL_WIDTH  32
#define CELL_HEIGHT 32

/*
 * How far below the call to read.
 *
 * `TextOut` reaches the scan converter through the text drawing, the font
 * realization, the marshalling and the scan driver, and each of those is a
 * frame. The first recording of this probe went four kilobytes down and found
 * that the deepest byte the drawing touched was 2446, with everything below it
 * still zero -- so this is that measurement rounded up, and not a guess.
 */
#define DEPTH 2560

/* Bytes to a record. Sixty-four hex digits and an argument field, comfortably
 * inside what `probe()` will carry. */
#define CHUNK 32

/*
 * The part of the capture worth writing down.
 *
 * The first recordings wrote the whole window, which is what a probe should do
 * when it does not yet know what it is looking for. It knows now: the box the
 * scan converter is set up from lies at 0x24e and 0x24a below the call, in
 * every cell of every instrument and at every size. Eighty-one records a cell
 * to carry two words is what was stopping this from being run at eighteen
 * sizes instead of six.
 *
 * So the capture is still taken whole -- it costs nothing and a shallow capture
 * would be the one mistake that cannot be undone after the fact -- and only the
 * chunks that can contain the box are written out. Generously bracketed, in
 * case a size moves the frame: 128 bytes where 4 would do.
 */
#define WINDOW_LO 0x280
#define WINDOW_HI 0x200

static HDC memory;
static HBITMAP canvas;

/* The residue cannot be copied to the stack, because the stack is the thing
 * being copied. It goes to the global heap instead. */
static HGLOBAL block;
static char far *residue;

/* Where the capture was taken from, so a dump can be placed against another
 * dump taken at a different call depth. */
static WORD residueTop;

static const char HEX[] = "0123456789abcdef";

/*
 * Copies the stack below this call into the global buffer.
 *
 * `marker` is a local, so its address is the stack pointer, near enough: the
 * bytes below it are what the call that just returned was using. This function
 * is entered at the same depth that `TextOut` was, so its own frame sits where
 * the drawing's outermost frame sat -- which costs the shallowest handful of
 * bytes of the residue and nothing deeper.
 *
 * There is deliberately no call in the loop. A call here would push a frame
 * into the middle of what is being read.
 */
static void captureStack(void)
{
    char marker;
    char far *base;
    unsigned index;

    base = (char far *)&marker;

    /* The low word of a far pointer is its offset, and the offset is how far
     * up the segment the stack has got. Below `DEPTH` there is no room to read
     * without leaving the segment. */
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
 * Draws one character and records the stack it was drawn on.
 *
 * The font is created and destroyed around the single call so that the glyph
 * cannot come out of a cache. A cached glyph is blitted, and a blit never
 * enters the scaler -- the residue would then be a picture of the wrong thing,
 * and an empty one at that.
 */
static void probeCell(LPCSTR face, int height, BYTE italic, char character)
{
    HFONT font;
    HFONT previous;
    char text[2];
    char name[80];
    unsigned index;

    font = CreateFont(height, 0, 0, 0, FW_NORMAL, italic, 0, 0, ANSI_CHARSET,
                      OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY,
                      DEFAULT_PITCH, face);

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

    /* Two pixels in, as the glyph probe draws it. */
    TextOut(memory, 2, 0, text, 1);

    captureStack();

    wsprintf(name, "\"%s\",h=%d,italic=%d,'%c'", (LPSTR)face, height,
             (int)italic, character);

    wsprintf(probeResult, "sp=%04x,depth=%d", (int)residueTop, DEPTH);
    probe("stack", name, probeResult);

    for (index = DEPTH - WINDOW_LO; index < DEPTH - WINDOW_HI; index += CHUNK) {
        LPSTR at = probeResult;
        unsigned byte;

        for (byte = 0; byte < CHUNK; byte++) {
            unsigned char value = (unsigned char)residue[index + byte];

            *at++ = HEX[(value >> 4) & 0x0f];
            *at++ = HEX[value & 0x0f];
        }

        *at = '\0';

        /* Named by how far below the capture the chunk starts, because that is
         * the coordinate a frame lives in. The absolute address is in the
         * `stack` record above and is not the same twice. */
        wsprintf(probeArgs, "%s,-%04x", (LPSTR)name, (int)(DEPTH - index));
        probe("residue", probeArgs, probeResult);
    }

    SelectObject(memory, previous);
    DeleteObject(font);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HDC screen;

    probeOpen(OUTPUT);

    block = GlobalAlloc(GMEM_FIXED, (DWORD)DEPTH);
    residue = (char far *)GlobalLock(block);

    screen = GetDC(NULL);
    memory = CreateCompatibleDC(screen);
    canvas = CreateBitmap(CELL_WIDTH, CELL_HEIGHT, 1, 1, NULL);

    if (residue == NULL || memory == NULL || canvas == NULL) {
        probe("setup", "32x32x1", "failed");
        probeFinish();
        return 0;
    }

    SelectObject(memory, canvas);

    /*
     * The eleven bearings, at every size Symbol answers with its outline.
     *
     * The displacement the slant applies to the box is now measured rather
     * than fitted: take the upright rule, which is exact on every box read so
     * far, and ask what displacement put through it reproduces the slanted box.
     * Four sizes gave four integers -- 31, 64, 78 and 94 sixty-fourths at six,
     * twelve, sixteen and twenty per em -- and no rule proposed so far
     * generates them.
     *
     * Four points is not a curve. This records eighteen, which it can afford
     * because the output is windowed on the two words the box lives in rather
     * than the whole two and a half kilobytes.
     *
     * Not every height in the list will answer with an outline: Symbol has
     * bitmap strikes, and thirteen and sixteen pixels are known to be two of
     * them. A strike is drawn by an entirely different mechanism and its box is
     * not this box, so those sizes are recorded and then told apart afterwards
     * -- by the upright rule, which holds for an outline and has no reason to
     * hold for a strike.
     */
    probeNote("the eleven bearings, at every size, slanted and upright");
    {
        static const int HEIGHTS[] = {
            8, 9, 10, 11, 12, 14, 15, 17, 18, 19,
            20, 21, 22, 24, 26, 28, 32, 40
        };
        static const char CHARS[] = "ABKMWagjmy1";

        int size;
        int index;

        for (size = 0; size < sizeof(HEIGHTS) / sizeof(HEIGHTS[0]); size++) {
            for (index = 0; CHARS[index]; index++) {
                probeCell("Symbol", HEIGHTS[size], 1, CHARS[index]);
            }

            for (index = 0; CHARS[index]; index++) {
                probeCell("Symbol", HEIGHTS[size], 0, CHARS[index]);
            }
        }
    }

    DeleteObject(canvas);
    DeleteDC(memory);
    ReleaseDC(NULL, screen);

    GlobalUnlock(block);
    GlobalFree(block);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
