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

    wsprintf(probeArgs, "%s,'%c'", (LPSTR)name, character);
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

    probeNote("and the styles, which are synthesised for some faces and not others");
    probeSized("MS Sans Serif", 16, FW_BOLD, 0);
    probeSized("MS Sans Serif", 16, FW_NORMAL, 1);
    probeSized("Arial", 16, FW_BOLD, 0);
    probeSized("Arial", 16, FW_NORMAL, 1);

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
