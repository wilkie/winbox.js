/*
 * What Windows actually draws.
 *
 * Every other probe records numbers a program can ask for. This one records
 * pixels, which nothing can ask for directly: it draws into a memory bitmap it
 * owns and then reads the bits back out, so the record is the ink itself.
 *
 * That is the only ground truth there is for a rasteriser. Glyph shapes are
 * not derivable from anything -- a TrueType outline goes through hinting and
 * scan conversion before it becomes pixels, and the whole question is what
 * comes out. Writing a rasteriser and checking it against a picture of what
 * Windows drew is the only honest order to do it in.
 *
 * It is also the missing half of the display work more generally. A sixteen
 * colour driver dithers, glyphs are the finest detail on the screen, and until
 * now nothing here could say whether what we draw looks like what Windows drew
 * or merely measures the same.
 *
 * The bitmap is monochrome on purpose. One bit per pixel is exactly the
 * question being asked of a glyph -- is this pixel inked -- with no palette,
 * no dithering and no driver in the way. Colour belongs to a later probe.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\GLYPHS.OUT"

/* The bitmap every glyph is drawn into.
 *
 * Thirty-two pixels wide is four bytes a row, which is already word aligned,
 * so the rows are contiguous and the bits come back without padding to reason
 * about. Nothing recorded here is drawn larger than this.
 */
#define CELL_WIDTH  32
#define CELL_HEIGHT 32
#define ROW_BYTES   4
#define CELL_BYTES  (ROW_BYTES * CELL_HEIGHT)

static HDC memory;
static HBITMAP canvas;
static char bits[CELL_BYTES];

static const char HEX[] = "0123456789abcdef";

/*
 * Draws one character and records the pixels it left.
 *
 * The bitmap is cleared to white, the character drawn at a fixed origin in
 * black, and the bits read straight back. What goes in the record is the whole
 * cell rather than a trimmed bounding box: where a glyph sits inside its cell
 * is as much a part of the answer as its shape, and trimming would throw that
 * away.
 */
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

    /* Two pixels in from the left so that a glyph which starts left of its
     * origin -- an italic `f`, a `j` -- still lands inside the cell.
     */
    TextOut(memory, 2, 0, text, 1);

    GetBitmapBits(canvas, (LONG)CELL_BYTES, bits);

    at = probeResult;

    for (index = 0; index < CELL_BYTES; index++) {
        *at++ = HEX[(bits[index] >> 4) & 0x0f];
        *at++ = HEX[bits[index] & 0x0f];
    }

    *at = '\0';

    /* Above ASCII a character is not safe to write into the record as itself,
     * so it goes in as its code instead. Everything the probe asked for before
     * this was ASCII and still reads exactly as it did.
     */
    if ((unsigned char)character < 0x80) {
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

/* Draws a run of characters in one font. */
static void probeFace(LPCSTR name, HFONT font)
{
    static const char CHARACTERS[] = "AWgj1.";

    int index;

    for (index = 0; CHARACTERS[index]; index++) {
        probeGlyph(name, font, CHARACTERS[index]);
    }
}

/* A named font at a size, described the way the font probe describes one. */
/*
 * Every character of a face at a spread of sizes.
 *
 * The six letters above were chosen to exercise particular features and are
 * enough to say whether a rasteriser is broadly right. They are not enough to
 * settle a rule: the scan converter's treatment of a stroke too thin to cover a
 * pixel centre turns on maybe a dozen spans across all of them, and a dozen
 * examples will fit almost any rule offered. This is the wide net -- a few
 * hundred glyphs, so that a rule has something to be wrong about.
 *
 * Small sizes, because that is where a stroke is thin enough for the question
 * to arise at all.
 */
static void probeWide(LPCSTR face)
{
    static const char WIDE[] = "ABEKMNRSWXZabdefgjkmnostwy0123456789";
    static const int SIZES[] = { 10, 12, 14, 16, 18, 20, 24 };

    int size;
    int index;
    char name[64];

    for (size = 0; size < sizeof(SIZES) / sizeof(SIZES[0]); size++) {
        HFONT font = CreateFont(SIZES[size], 0, 0, 0, FW_NORMAL, 0, 0, 0,
                                ANSI_CHARSET, OUT_DEFAULT_PRECIS,
                                CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY,
                                DEFAULT_PITCH, face);

        wsprintf(name, "\"%s\",h=%d,weight=400,italic=0", (LPSTR)face, SIZES[size]);

        for (index = 0; WIDE[index]; index++) {
            probeGlyph(name, font, WIDE[index]);
        }

        if (font) {
            DeleteObject(font);
        }
    }
}

/*
 * The accented letters, which are the composite glyphs.
 *
 * A composite is assembled out of other glyphs -- an `A` and a grave accent --
 * and then carries a program of its own that fits the assembly. Nearly every
 * one of them in every one of these faces has such a program, which is a
 * quarter of the font, and nothing the probe asked for before this reaches any
 * of them: the letters and digits are all simple glyphs.
 *
 * The whole upper half of the character set rather than a chosen few, because
 * what is being asked is not whether one accent lands correctly but whether
 * this whole class of glyph is drawn the way Windows draws it.
 */
static void probeAccented(LPCSTR face)
{
    /* Chosen for what they land on rather than for spread. A component's
     * offset is rounded to the grid, so the sizes that say anything about how
     * it is rounded are the ones where the scaled offset comes out within a
     * sixty-fourth of the halfway mark -- which is nineteen, twenty-seven,
     * thirteen and fourteen pixels per em across these three faces, and these
     * are the cell heights that ask for them.
     */
    static const int SIZES[] = { 12, 16, 17, 18, 23, 31 };

    int size;
    int code;
    char name[64];

    for (size = 0; size < sizeof(SIZES) / sizeof(SIZES[0]); size++) {
        HFONT font = CreateFont(SIZES[size], 0, 0, 0, FW_NORMAL, 0, 0, 0,
                                ANSI_CHARSET, OUT_DEFAULT_PRECIS,
                                CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY,
                                DEFAULT_PITCH, face);

        wsprintf(name, "\"%s\",h=%d,weight=400,italic=0", (LPSTR)face, SIZES[size]);

        /* From the punctuation up, not just the letters. The accents that
         * compose them are characters in their own right down here -- the
         * diaeresis, the grave, the cedilla -- and a component that is drawn
         * wrongly inside a composite is far easier to read on its own.
         */
        for (code = 0xA0; code <= 0xFF; code++) {
            probeGlyph(name, font, (char)code);
        }

        if (font) {
            DeleteObject(font);
        }
    }
}

/*
 * A face in one of its styles, over the wide net.
 *
 * The bold and italic of an outline family are separate files with their own
 * outlines and their own programs -- Windows does not slant or embolden the
 * plain one to answer for them -- so nothing the plain file proved carries
 * over. `probeWide` asks the plain one at seven sizes; this asks the other
 * three at a few, which is enough to find a difference that is there without
 * tripling what has to be recorded.
 */
static void probeStyled(LPCSTR face, int weight, BYTE italic)
{
    static const char WIDE[] = "ABEKMNRSWXZabdefgjkmnostwy0123456789";
    static const int SIZES[] = { 12, 16, 24 };

    int size;
    int index;
    char name[64];

    for (size = 0; size < sizeof(SIZES) / sizeof(SIZES[0]); size++) {
        HFONT font = CreateFont(SIZES[size], 0, 0, 0, weight, italic, 0, 0,
                                ANSI_CHARSET, OUT_DEFAULT_PRECIS,
                                CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY,
                                DEFAULT_PITCH, face);

        wsprintf(name, "\"%s\",h=%d,weight=%d,italic=%d", (LPSTR)face, SIZES[size],
                 weight, (int)italic);

        for (index = 0; WIDE[index]; index++) {
            probeGlyph(name, font, WIDE[index]);
        }

        if (font) {
            DeleteObject(font);
        }
    }
}

/*
 * Two characters, for where the pen goes between them.
 *
 * Every other cell here draws one glyph, which says what a glyph looks like
 * and never what a string does. The step between two of them is a separate
 * question with a separate answer: what a face measures with and what it draws
 * with are two pieces of code, and nothing recorded so far makes them meet.
 *
 * Symbol slanted is where they can part. Windows has no italic Symbol, so the
 * upright is sheared -- drawn from the raw outline with no program run, and
 * measured with the scaler's unhinted advance rather than the hinted one the
 * upright would use. Whether the pen steps by the same number is what this
 * asks. At these sizes the two candidates differ by a whole pixel or more, so
 * the second glyph lands in a different column depending on the answer, and
 * the picture says which.
 *
 * The same character twice, so that anything the second cell shows which the
 * first does not is the step and not the letter. The upright is recorded
 * beside the slant at every size as the control: there the two candidates are
 * the same number, so its pair must come out at the sum of two known advances
 * or the instrument itself is wrong.
 *
 * The stack probe asked this first and could not answer it. Its residue
 * carries the box of a glyph the scan converter handled, and a two character
 * `TextOut` leaves something else at those offsets -- the words come back as a
 * clip of the cell rather than a box, at every size. So the string is built by
 * a path the single character call does not take, and pixels are the only
 * ground left to read it on.
 */
static void probePair(LPCSTR name, HFONT font, char character)
{
    HFONT previous;
    LPSTR at;
    int index;
    char text[3];

    if (font == NULL) {
        return;
    }

    previous = (HFONT)SelectObject(memory, font);

    PatBlt(memory, 0, 0, CELL_WIDTH, CELL_HEIGHT, WHITENESS);

    SetTextColor(memory, RGB(0, 0, 0));
    SetBkColor(memory, RGB(255, 255, 255));
    SetBkMode(memory, OPAQUE);

    text[0] = character;
    text[1] = character;
    text[2] = '\0';

    TextOut(memory, 2, 0, text, 2);

    GetBitmapBits(canvas, (LONG)CELL_BYTES, bits);

    at = probeResult;

    for (index = 0; index < CELL_BYTES; index++) {
        *at++ = HEX[(bits[index] >> 4) & 0x0f];
        *at++ = HEX[bits[index] & 0x0f];
    }

    *at = '\0';

    wsprintf(probeArgs, "%s,'%c%c'", (LPSTR)name, character, character);

    probe("glyph", probeArgs, probeResult);

    SelectObject(memory, previous);
}

/*
 * The sizes where the slant's two candidate advances disagree.
 *
 * Sixteen of them, with the character at each chosen for the widest
 * disagreement between the unhinted advance and the hinted one -- and small
 * enough at every size that two glyphs still land inside the cell, which is
 * what bounds the list at the top end rather than any lack of sizes. None is a
 * height Symbol answers with a strike; a strike has neither advance and would
 * be measuring something else.
 */
static void probePairs(void)
{
    static const int HEIGHTS[] = { 9,  11, 12, 14, 15, 17, 20, 22,
                                   23, 24, 28, 30, 32, 34, 36, 38 };
    static const char CHARS[] = "NyyTFpyzyyzztzzI";

    int size;
    int style;
    char name[64];

    for (size = 0; size < sizeof(HEIGHTS) / sizeof(HEIGHTS[0]); size++) {
        for (style = 1; style >= 0; style--) {
            HFONT font = CreateFont(HEIGHTS[size], 0, 0, 0, FW_NORMAL,
                                    (BYTE)style, 0, 0, ANSI_CHARSET,
                                    OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                                    DEFAULT_QUALITY, DEFAULT_PITCH, "Symbol");

            wsprintf(name, "\"Symbol\",h=%d,weight=400,italic=%d",
                     HEIGHTS[size], style);

            /* The single character too, at the same size and in the same pass,
             * so the pair has the letter alone to be read against without
             * depending on a sweep recorded for another purpose. */
            probeGlyph(name, font, CHARS[size]);
            probePair(name, font, CHARS[size]);

            if (font) {
                DeleteObject(font);
            }
        }
    }
}

/*
 * The bitmap faces, at a spread of sizes and in each style.
 *
 * These have no outline and no interpreter: every glyph is stored ink, picked
 * out of whichever strike the mapper settled on and blitted. So the questions
 * are different ones. Which strike answers a height, and whether it was drawn
 * more than once over; where in the character cell the stored ink lands; and
 * what the two synthesised styles do to it -- the one pixel smear that bold
 * is, and the shear that italic is, which leans from the bottom of the cell
 * and not from the baseline.
 *
 * Section 3 of `FONTS.md` has all of those measured from the *metrics*, which
 * say how wide the answer is and never what it looks like. This is the ink.
 *
 * Eight heights rather than three because the strikes are few and far apart --
 * MS Sans Serif has six and Courier three -- so a size sweep is mostly a sweep
 * over which strike answers, including the ones that answer by doubling a
 * smaller strike or by clamping to the smallest there is.
 */
static void probeBitmap(LPCSTR face, int weight, BYTE italic)
{
    static const char CHARS[] = "ABKMWagjmy1.";
    static const int SIZES[] = { 8, 10, 12, 13, 15, 16, 20, 24 };

    int size;
    int index;
    char name[64];

    for (size = 0; size < sizeof(SIZES) / sizeof(SIZES[0]); size++) {
        HFONT font = CreateFont(SIZES[size], 0, 0, 0, weight, italic, 0, 0,
                                ANSI_CHARSET, OUT_DEFAULT_PRECIS,
                                CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY,
                                DEFAULT_PITCH, face);

        wsprintf(name, "\"%s\",h=%d,weight=%d,italic=%d", (LPSTR)face, SIZES[size],
                 weight, (int)italic);

        for (index = 0; CHARS[index]; index++) {
            probeGlyph(name, font, CHARS[index]);
        }

        if (font) {
            DeleteObject(font);
        }
    }
}

/*
 * The plotter fonts, which are strokes rather than pixels or outlines.
 *
 * Roman, Modern and Script are the three that ship, and nothing has ever
 * recorded what they look like: the font probe measures them, so their widths
 * and heights are known to the pixel, but a width is not a picture. They are a
 * third kind of thing -- one design apiece, drawn at whatever size is asked for
 * by joining up runs of points, with no strikes to pick between and no hinting
 * to argue about -- so what a rasteriser does with them is its own question.
 *
 * Reachable only through `OEM_CHARSET`, which is also how the font probe gets
 * at them. A request in ANSI for any of these three names lands somewhere else
 * entirely.
 *
 * Sizes chosen to cross the design's own height rather than a strike's: Roman
 * and Modern are drawn at thirty-two units and Script at thirty-seven, so this
 * runs from well under to well over.
 */
static void probeStroke(LPCSTR face, int weight, BYTE italic)
{
    static const char CHARS[] = "ABKMWagjmy1.";
    static const int SIZES[] = { 8, 12, 16, 20, 24, 32, 40 };

    int size;
    int index;
    char name[64];

    for (size = 0; size < sizeof(SIZES) / sizeof(SIZES[0]); size++) {
        HFONT font = CreateFont(SIZES[size], 0, 0, 0, weight, italic, 0, 0,
                                OEM_CHARSET, OUT_DEFAULT_PRECIS,
                                CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY,
                                DEFAULT_PITCH, face);

        wsprintf(name, "\"%s\",h=%d,weight=%d,italic=%d,oem", (LPSTR)face, SIZES[size],
                 weight, (int)italic);

        for (index = 0; CHARS[index]; index++) {
            probeGlyph(name, font, CHARS[index]);
        }

        if (font) {
            DeleteObject(font);
        }
    }
}

static void probeSized(LPCSTR face, int height, int weight, BYTE italic)
{
    char name[64];

    HFONT font = CreateFont(height, 0, 0, 0, weight, italic, 0, 0, ANSI_CHARSET,
                            OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                            DEFAULT_QUALITY, DEFAULT_PITCH, face);

    wsprintf(name, "\"%s\",h=%d,weight=%d,italic=%d", (LPSTR)face, height, weight,
             (int)italic);

    probeFace(name, font);

    if (font) {
        DeleteObject(font);
    }
}

/* A stock font, which needs no describing because both sides agree on it. */
static void probeStock(int stock, LPCSTR name)
{
    probeFace(name, (HFONT)GetStockObject(stock));
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HDC screen;

    probeOpen(OUTPUT);

    screen = GetDC(NULL);
    memory = CreateCompatibleDC(screen);

    /* One plane, one bit -- a monochrome bitmap, whatever the display is. The
     * question a glyph answers is whether a pixel is inked, and asking it in
     * colour would drag the whole palette in with it.
     */
    canvas = CreateBitmap(CELL_WIDTH, CELL_HEIGHT, 1, 1, NULL);

    if (memory == NULL || canvas == NULL) {
        probe("CreateBitmap", "32x32x1", "failed");
        probeFinish();
        return 0;
    }

    SelectObject(memory, canvas);

    /* The stock fonts first. These are bitmap strikes we already draw, so they
     * are the check on the pipeline itself: if what we render disagrees here,
     * the disagreement is in the comparison rather than in a rasteriser.
     */
    probeNote("stock bitmap fonts, which are the control");
    probeStock(SYSTEM_FONT, "SYSTEM_FONT");
    probeStock(ANSI_VAR_FONT, "ANSI_VAR_FONT");
    probeStock(ANSI_FIXED_FONT, "ANSI_FIXED_FONT");

    probeNote("the same faces asked for by name and size");
    probeSized("MS Sans Serif", 16, FW_NORMAL, 0);
    probeSized("MS Sans Serif", 20, FW_NORMAL, 0);
    probeSized("Courier", 16, FW_NORMAL, 0);

    /* And the outlines, which is what this probe exists for. */
    probeNote("TrueType, which is what has no other ground truth");
    probeSized("Arial", 16, FW_NORMAL, 0);
    probeSized("Arial", 24, FW_NORMAL, 0);
    probeSized("Times New Roman", 16, FW_NORMAL, 0);
    probeSized("Times New Roman", 24, FW_NORMAL, 0);
    probeSized("Courier New", 16, FW_NORMAL, 0);

    probeNote("a wide net over the outline faces, for the rules a handful cannot settle");
    probeWide("Arial");
    probeWide("Times New Roman");
    probeWide("Courier New");

    probeNote("the bold and italic files, which are their own outlines and not synthesised");
    probeStyled("Arial", FW_BOLD, 0);
    probeStyled("Arial", FW_NORMAL, 1);
    probeStyled("Arial", FW_BOLD, 1);
    probeStyled("Times New Roman", FW_BOLD, 0);
    probeStyled("Times New Roman", FW_NORMAL, 1);
    probeStyled("Times New Roman", FW_BOLD, 1);
    probeStyled("Courier New", FW_BOLD, 0);
    probeStyled("Courier New", FW_NORMAL, 1);
    probeStyled("Courier New", FW_BOLD, 1);

    probeNote("the accented letters, which are composite glyphs with programs of their own");
    probeAccented("Arial");
    probeAccented("Times New Roman");
    probeAccented("Courier New");

    probeNote("the plotter fonts, which are strokes and have never been drawn here");
    probeStroke("Roman", FW_NORMAL, 0);
    probeStroke("Roman", FW_BOLD, 0);
    probeStroke("Roman", FW_NORMAL, 1);
    probeStroke("Modern", FW_NORMAL, 0);
    probeStroke("Script", FW_NORMAL, 0);

    probeNote("the bitmap faces, which are strikes rather than outlines");
    probeBitmap("System", FW_NORMAL, 0);
    probeBitmap("System", FW_BOLD, 0);
    probeBitmap("System", FW_NORMAL, 1);
    probeBitmap("Fixedsys", FW_NORMAL, 0);
    probeBitmap("Fixedsys", FW_BOLD, 0);
    probeBitmap("Fixedsys", FW_NORMAL, 1);
    probeBitmap("MS Sans Serif", FW_NORMAL, 0);
    probeBitmap("MS Sans Serif", FW_BOLD, 0);
    probeBitmap("MS Sans Serif", FW_NORMAL, 1);
    probeBitmap("MS Serif", FW_NORMAL, 0);
    probeBitmap("MS Serif", FW_BOLD, 0);
    probeBitmap("MS Serif", FW_NORMAL, 1);
    probeBitmap("Courier", FW_NORMAL, 0);
    probeBitmap("Courier", FW_BOLD, 0);
    probeBitmap("Courier", FW_NORMAL, 1);
    probeBitmap("Small Fonts", FW_NORMAL, 0);
    probeBitmap("Small Fonts", FW_BOLD, 0);
    probeBitmap("Small Fonts", FW_NORMAL, 1);
    probeBitmap("Symbol", FW_NORMAL, 0);
    probeBitmap("Symbol", FW_BOLD, 0);
    probeBitmap("Symbol", FW_NORMAL, 1);

    probeNote("and the styles, which are synthesised for some faces and not others");
    probeSized("MS Sans Serif", 16, FW_BOLD, 0);
    probeSized("MS Sans Serif", 16, FW_NORMAL, 1);
    probeSized("Arial", 16, FW_BOLD, 0);
    probeSized("Arial", 16, FW_NORMAL, 1);

    probeNote("two characters, for the step the pen takes between them");
    probePairs();

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
