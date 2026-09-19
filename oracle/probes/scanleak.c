/*
 * Whether what the scan converter does to one font carries over to the next.
 *
 * `bands` and `dropsize` draw the same fabricated hairline, from the same file,
 * at the same size, on the same display -- and disagree. `dropsize` draws Times
 * New Roman's `A` at a cell of sixty and the bar comes back; `bands` draws it
 * and the cell is blank. The two profiles agree about the geometry wherever
 * both draw, so it is not the size and not the shape: it is whether the stroke
 * was rescued.
 *
 * The one thing that differs is what the process did first. `dropsize` selects
 * nothing but Times New Roman. `bands` draws the whole of Courier New at four
 * sizes before it reaches Times, and Courier New's `prep` sets `SCANCTRL` to
 * give up dropout control above forty-four pixels per em, where Times New
 * Roman's says a hundred and twenty-four.
 *
 * If that setting is the scaler's rather than the font's -- written into a
 * global graphics state and left there -- then a font drawn after Courier New
 * at a large size inherits Courier New's answer, and every conclusion drawn
 * from a probe that mixes faces is about the order of its own loops.
 *
 * So draw the same character at the same sizes with nothing before it, and
 * again after each of four other fonts, and see whether the answer moves.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\SCANLEAK.OUT"

#define CELL_WIDTH  64
#define CELL_HEIGHT 200
#define ROW_BYTES   8
#define CELL_BYTES  (ROW_BYTES * CELL_HEIGHT)

static int warmed;
static HDC memory;
static HBITMAP canvas;
static char bits[CELL_BYTES];

static const char HEX[] = "0123456789abcdef";

/* Draws one character into the canvas and leaves the ink there. */
static void draw(HFONT font, char character)
{
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
}

/* And writes down the leftmost inked column of every row. */
static void report(LPCSTR name)
{
    LPSTR at;
    int row;
    int column;
    int byte;

    GetBitmapBits(canvas, (LONG)CELL_BYTES, bits);

    at = probeResult;

    for (row = 0; row < CELL_HEIGHT; row++) {
        int found = 0xff;

        for (column = 0; column < CELL_WIDTH && found == 0xff; column++) {
            byte = bits[row * ROW_BYTES + (column >> 3)] & 0xff;

            if ((byte & (0x80 >> (column & 7))) == 0) {
                found = column;
            }
        }

        *at++ = HEX[(found >> 4) & 0x0f];
        *at++ = HEX[found & 0x0f];
    }

    *at = '\0';

    probe("column", (LPSTR)name, probeResult);
}

static HFONT fontAt(LPCSTR face, int height)
{
    return CreateFont(height, 0, 0, 0, FW_NORMAL, 0, 0, 0, ANSI_CHARSET,
                      OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                      DEFAULT_QUALITY, DEFAULT_PITCH, face);
}

/* Everything `bands` draws before it reaches Times New Roman. */
static void warm(void)
{
    static const char WIDE[] = "ABEKMNRSWXZabdefgjkmnostwy0123456789";
    static const int SIZES[] = { 60, 100, 140, 180, 0 };

    int size;
    int index;

    for (size = 0; SIZES[size]; size++) {
        HFONT font = fontAt("Courier New", SIZES[size]);

        for (index = 0; WIDE[index]; index++) {
            draw(font, WIDE[index]);
        }

        if (font) {
            DeleteObject(font);
        }
    }
}

/*
 * One cell of the table: draw `before` at `beforeHeight` if there is one, then
 * draw Times New Roman's hairline at `height` and report only that.
 */
/*
 * `dropsize`'s own prefix: every size from sixteen up to just under the one
 * being asked about, twelve glyphs through each, each font deleted after.
 *
 * Nothing else has moved the answer -- not the font drawn before it, not the
 * order of the sizes, not a hundred and forty-four large glyphs first, not one
 * font a character against one a size. The two probes that disagree differ only
 * in that one arrives at a size having drawn every smaller one.
 */
static void sweepTo(int upto)
{
    static const char CHARS3[] = "ABEKMNRSWXZa";

    int height;
    int index;

    for (height = 16; height < upto; height += 2) {
        HFONT font = fontAt("Times New Roman", height);

        for (index = 0; CHARS3[index]; index++) {
            draw(font, CHARS3[index]);
        }

        if (font) {
            DeleteObject(font);
        }
    }
}

/* And the same measurement after it. */
static void probeSwept(int height)
{
    static const char CHARS4[] = "ABEKMNRSWXZa";

    HFONT font;
    char name[96];
    int index;

    sweepTo(height);

    font = fontAt("Times New Roman", height);

    for (index = 0; CHARS4[index]; index++) {
        draw(font, CHARS4[index]);
        wsprintf(name, "after=sweep,h=%d,'%c'", height, CHARS4[index]);
        report(name);
    }

    if (font) {
        DeleteObject(font);
    }
}

/*
 * The same sizes again, but one font for all twelve characters rather than one
 * font each -- which is the only thing left that `dropsize` does differently,
 * and on a display whose pixel is not square the two do not agree.
 */
static void probeShared(int height)
{
    static const char CHARS2[] = "ABEKMNRSWXZa";

    HFONT font = fontAt("Times New Roman", height);
    char name[96];
    int index;

    for (index = 0; CHARS2[index]; index++) {
        draw(font, CHARS2[index]);
        wsprintf(name, "after=shared,h=%d,'%c'", height, CHARS2[index]);
        report(name);
    }

    if (font) {
        DeleteObject(font);
    }
}

static void probeAfter(LPCSTR before, int beforeHeight, int height, char character)
{
    HFONT first;
    HFONT second;
    char name[96];

    if (before != NULL) {
        first = fontAt(before, beforeHeight);
        draw(first, 'A');

        if (first) {
            DeleteObject(first);
        }
    }

    second = fontAt("Times New Roman", height);
    draw(second, character);

    if (second) {
        DeleteObject(second);
    }

    if (before == NULL) {
        wsprintf(name, "after=%s,h=%d,'%c'", warmed ? (LPSTR)"bands" : (LPSTR)"none",
                 height, character);
    } else {
        wsprintf(name, "after=%s@%d,h=%d,'%c'", (LPSTR)before, beforeHeight,
                 height, character);
    }

    report(name);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    /* Sizes either side of where `dropsize` says the rescue stops, and two
     * well clear of it in each direction.
     */
    /* Sixty first, because that is the one `bands` and `dropsize` disagree
     * about and `bands` reaches it before any other size of the face.
     */
    static const int HEIGHTS[] = { 60, 30, 40, 50, 54, 55, 56, 70, 0 };

    /* The characters `dropsize` sweeps, which are six bar widths at two
     * sub-pixel phases.
     */
    static const char CHARS[] = "ABEKMNRSWXZa";

    HDC screen;
    int index;
    int at;

    probeOpen(OUTPUT);

    screen = GetDC(NULL);
    memory = CreateCompatibleDC(screen);
    canvas = CreateBitmap(CELL_WIDTH, CELL_HEIGHT, 1, 1, NULL);

    if (memory == NULL || canvas == NULL) {
        probe("CreateBitmap", "64x200x1", "failed");
        probeFinish();
        return 0;
    }

    SelectObject(memory, canvas);

    /* And after every smaller size of the same face, which is the one thing
     * `dropsize` does that nothing here has done yet.
     */
    probeNote("after every smaller size of the same face, as dropsize reaches it");

    for (at = 0; HEIGHTS[at]; at++) {
        probeSwept(HEIGHTS[at]);
    }

    /* Nothing before it, and the size never realized before. */
    probeNote("nothing selected before it");

    for (at = 0; HEIGHTS[at]; at++) {
        for (index = 0; CHARS[index]; index++) {
            probeAfter(NULL, 0, HEIGHTS[at], CHARS[index]);
        }
    }

    /* Courier New first, below and above its own forty-four pixel threshold --
     * a cell of twenty is about eighteen pixels per em and one of a hundred and
     * eighty about a hundred and fifty-seven.
     */
    probeNote("Courier New first, under and over its own threshold");

    for (at = 0; HEIGHTS[at]; at++) {
        for (index = 0; CHARS[index]; index++) {
            probeAfter("Courier New", 20, HEIGHTS[at], CHARS[index]);
        }
    }

    for (at = 0; HEIGHTS[at]; at++) {
        for (index = 0; CHARS[index]; index++) {
            probeAfter("Courier New", 180, HEIGHTS[at], CHARS[index]);
        }
    }

    /* And Arial, whose threshold is lower still, to say whether it is Courier
     * New in particular or whatever came last.
     */
    probeNote("Arial first, which gives up above sixteen");

    for (at = 0; HEIGHTS[at]; at++) {
        for (index = 0; CHARS[index]; index++) {
            probeAfter("Arial", 180, HEIGHTS[at], CHARS[index]);
        }
    }

    /* Then the whole of what `bands` does before it reaches Times New Roman:
     * four Courier New fonts at sixty to a hundred and eighty, thirty-six
     * glyphs through each. One font and one glyph changes nothing; a hundred
     * and forty-four large glyphs is the only thing left that the two probes do
     * differently.
     */
    probeNote("all of Courier New as bands draws it, then the same sizes again");

    warmed = 1;
    warm();

    for (at = 0; HEIGHTS[at]; at++) {
        for (index = 0; CHARS[index]; index++) {
            probeAfter(NULL, 0, HEIGHTS[at], CHARS[index]);
        }
    }

    /* And one font for all twelve, which is how `dropsize` draws them. */
    probeNote("one font for the whole size, as dropsize does it");

    for (at = 0; HEIGHTS[at]; at++) {
        probeShared(HEIGHTS[at]);
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
