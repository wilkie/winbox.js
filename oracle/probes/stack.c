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

    for (index = 0; index < DEPTH; index += CHUNK) {
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
     * The eleven characters `dot-edge` gives a bearing to, at the one size
     * where the disagreement lives, slanted and upright.
     *
     * `dot-edge` puts the same hundred-unit square in all eleven, three font
     * units further right each time -- a fiftieth of a pixel a step, so the
     * eleven together walk the square through a fifth of a pixel of phase and
     * nothing else about them differs at all. At fifteen pixels and slanted,
     * six of the eleven come out of Windows differently than we draw them, and
     * they are the middle six: `A` and `B` agree, `K` `M` `W` `a` `g` and `j`
     * do not, and `m` `y` and `1` agree again. A window of phase, with an edge
     * on each side of it.
     *
     * That is what makes this recording able to answer the question. A word
     * that is the box will be one number for the two cells at the bottom of
     * the window, another for the six inside it, and a third for the three
     * above -- and our own box, computed from the outline, steps in the wrong
     * place. Somewhere in this dump is a word that steps in the right one.
     *
     * The upright pass is the control: the same eleven, drawn by a path we
     * already agree with everywhere, so a word that moves between the two
     * passes is a word the synthesised slant reaches and the rest is scenery.
     */
    probeNote("the eleven bearings at the size where the slant disagrees, slanted");
    probeCell("Symbol", 15, 1, 'A');
    probeCell("Symbol", 15, 1, 'B');
    probeCell("Symbol", 15, 1, 'K');
    probeCell("Symbol", 15, 1, 'M');
    probeCell("Symbol", 15, 1, 'W');
    probeCell("Symbol", 15, 1, 'a');
    probeCell("Symbol", 15, 1, 'g');
    probeCell("Symbol", 15, 1, 'j');
    probeCell("Symbol", 15, 1, 'm');
    probeCell("Symbol", 15, 1, 'y');
    probeCell("Symbol", 15, 1, '1');

    /*
     * And the same character across every size the glyph probe records, in
     * both passes.
     *
     * The eleven above say *that* the slanted box is the upright box moved
     * over; they cannot say by how much in general, because they are all one
     * size and the answer there is one column. A translation has to be a
     * number that comes from somewhere, and the only way to see where is to
     * watch it change.
     */
    probeNote("one bearing across every size, to see what the translation is");
    probeCell("Symbol", 8, 0, 'A');
    probeCell("Symbol", 8, 1, 'A');
    probeCell("Symbol", 10, 0, 'A');
    probeCell("Symbol", 10, 1, 'A');
    probeCell("Symbol", 12, 0, 'A');
    probeCell("Symbol", 12, 1, 'A');
    probeCell("Symbol", 13, 0, 'A');
    probeCell("Symbol", 13, 1, 'A');
    probeCell("Symbol", 16, 0, 'A');
    probeCell("Symbol", 16, 1, 'A');
    probeCell("Symbol", 20, 0, 'A');
    probeCell("Symbol", 20, 1, 'A');
    probeCell("Symbol", 24, 0, 'A');
    probeCell("Symbol", 24, 1, 'A');

    /*
     * And the same eleven at twenty pixels, which is sixteen per em.
     *
     * That is the size where a design unit is exactly half a sixty-fourth, so
     * an instrument built on even coordinates is measured rather than
     * approximated. `dot-riser` is built for this pass.
     */
    /*
     * And at nine and twenty per em as well.
     *
     * The three quantities left in the box's left edge -- the slope, a shift
     * that is a fraction of the em, and a rounding constant -- cannot be told
     * apart at one size, because a shift measured in font units grows with the
     * size and a constant in sixty-fourths does not. Two sizes separate them
     * only as well as the two sizes are far apart. Four, spanning nine per em
     * to twenty, is what this pass is for.
     */
    /* And at six per em, which is the far end of the lever; see `dot-small`. */
    probeNote("the eleven at six per em");
    probeCell("Symbol", 8, 1, 'A');
    probeCell("Symbol", 8, 1, 'B');
    probeCell("Symbol", 8, 1, 'K');
    probeCell("Symbol", 8, 1, 'M');
    probeCell("Symbol", 8, 1, 'W');
    probeCell("Symbol", 8, 1, 'a');
    probeCell("Symbol", 8, 1, 'g');
    probeCell("Symbol", 8, 1, 'j');
    probeCell("Symbol", 8, 1, 'm');
    probeCell("Symbol", 8, 1, 'y');
    probeCell("Symbol", 8, 1, '1');

    probeCell("Symbol", 8, 0, 'A');
    probeCell("Symbol", 8, 0, 'B');
    probeCell("Symbol", 8, 0, 'K');
    probeCell("Symbol", 8, 0, 'M');
    probeCell("Symbol", 8, 0, 'W');
    probeCell("Symbol", 8, 0, 'a');
    probeCell("Symbol", 8, 0, 'g');
    probeCell("Symbol", 8, 0, 'j');
    probeCell("Symbol", 8, 0, 'm');
    probeCell("Symbol", 8, 0, 'y');
    probeCell("Symbol", 8, 0, '1');

    /* Seven per em as well, which `dot-edge`'s span happens to step in. */
    probeNote("the eleven at seven per em");
    probeCell("Symbol", 10, 1, 'A');
    probeCell("Symbol", 10, 1, 'B');
    probeCell("Symbol", 10, 1, 'K');
    probeCell("Symbol", 10, 1, 'M');
    probeCell("Symbol", 10, 1, 'W');
    probeCell("Symbol", 10, 1, 'a');
    probeCell("Symbol", 10, 1, 'g');
    probeCell("Symbol", 10, 1, 'j');
    probeCell("Symbol", 10, 1, 'm');
    probeCell("Symbol", 10, 1, 'y');
    probeCell("Symbol", 10, 1, '1');

    probeCell("Symbol", 10, 0, 'A');
    probeCell("Symbol", 10, 0, 'B');
    probeCell("Symbol", 10, 0, 'K');
    probeCell("Symbol", 10, 0, 'M');
    probeCell("Symbol", 10, 0, 'W');
    probeCell("Symbol", 10, 0, 'a');
    probeCell("Symbol", 10, 0, 'g');
    probeCell("Symbol", 10, 0, 'j');
    probeCell("Symbol", 10, 0, 'm');
    probeCell("Symbol", 10, 0, 'y');
    probeCell("Symbol", 10, 0, '1');

    probeNote("the eleven at nine per em");
    probeCell("Symbol", 12, 1, 'A');
    probeCell("Symbol", 12, 1, 'B');
    probeCell("Symbol", 12, 1, 'K');
    probeCell("Symbol", 12, 1, 'M');
    probeCell("Symbol", 12, 1, 'W');
    probeCell("Symbol", 12, 1, 'a');
    probeCell("Symbol", 12, 1, 'g');
    probeCell("Symbol", 12, 1, 'j');
    probeCell("Symbol", 12, 1, 'm');
    probeCell("Symbol", 12, 1, 'y');
    probeCell("Symbol", 12, 1, '1');

    probeCell("Symbol", 12, 0, 'A');
    probeCell("Symbol", 12, 0, 'B');
    probeCell("Symbol", 12, 0, 'K');
    probeCell("Symbol", 12, 0, 'M');
    probeCell("Symbol", 12, 0, 'W');
    probeCell("Symbol", 12, 0, 'a');
    probeCell("Symbol", 12, 0, 'g');
    probeCell("Symbol", 12, 0, 'j');
    probeCell("Symbol", 12, 0, 'm');
    probeCell("Symbol", 12, 0, 'y');
    probeCell("Symbol", 12, 0, '1');

    probeNote("and at twenty per em");
    probeCell("Symbol", 24, 1, 'A');
    probeCell("Symbol", 24, 1, 'B');
    probeCell("Symbol", 24, 1, 'K');
    probeCell("Symbol", 24, 1, 'M');
    probeCell("Symbol", 24, 1, 'W');
    probeCell("Symbol", 24, 1, 'a');
    probeCell("Symbol", 24, 1, 'g');
    probeCell("Symbol", 24, 1, 'j');
    probeCell("Symbol", 24, 1, 'm');
    probeCell("Symbol", 24, 1, 'y');
    probeCell("Symbol", 24, 1, '1');

    probeCell("Symbol", 24, 0, 'A');
    probeCell("Symbol", 24, 0, 'B');
    probeCell("Symbol", 24, 0, 'K');
    probeCell("Symbol", 24, 0, 'M');
    probeCell("Symbol", 24, 0, 'W');
    probeCell("Symbol", 24, 0, 'a');
    probeCell("Symbol", 24, 0, 'g');
    probeCell("Symbol", 24, 0, 'j');
    probeCell("Symbol", 24, 0, 'm');
    probeCell("Symbol", 24, 0, 'y');
    probeCell("Symbol", 24, 0, '1');

    probeNote("the eleven again at the size where the arithmetic is exact");
    probeCell("Symbol", 20, 1, 'A');
    probeCell("Symbol", 20, 1, 'B');
    probeCell("Symbol", 20, 1, 'K');
    probeCell("Symbol", 20, 1, 'M');
    probeCell("Symbol", 20, 1, 'W');
    probeCell("Symbol", 20, 1, 'a');
    probeCell("Symbol", 20, 1, 'g');
    probeCell("Symbol", 20, 1, 'j');
    probeCell("Symbol", 20, 1, 'm');
    probeCell("Symbol", 20, 1, 'y');
    probeCell("Symbol", 20, 1, '1');

    probeCell("Symbol", 20, 0, 'A');
    probeCell("Symbol", 20, 0, 'B');
    probeCell("Symbol", 20, 0, 'K');
    probeCell("Symbol", 20, 0, 'M');
    probeCell("Symbol", 20, 0, 'W');
    probeCell("Symbol", 20, 0, 'a');
    probeCell("Symbol", 20, 0, 'g');
    probeCell("Symbol", 20, 0, 'j');
    probeCell("Symbol", 20, 0, 'm');
    probeCell("Symbol", 20, 0, 'y');
    probeCell("Symbol", 20, 0, '1');

    probeNote("and upright, which is the control");
    probeCell("Symbol", 15, 0, 'A');
    probeCell("Symbol", 15, 0, 'B');
    probeCell("Symbol", 15, 0, 'K');
    probeCell("Symbol", 15, 0, 'M');
    probeCell("Symbol", 15, 0, 'W');
    probeCell("Symbol", 15, 0, 'a');
    probeCell("Symbol", 15, 0, 'g');
    probeCell("Symbol", 15, 0, 'j');
    probeCell("Symbol", 15, 0, 'm');
    probeCell("Symbol", 15, 0, 'y');
    probeCell("Symbol", 15, 0, '1');

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
