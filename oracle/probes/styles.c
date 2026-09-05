/*
 * styles -- the wide net, cast over the faces the glyphs probe only sampled.
 *
 * The glyphs probe drew each regular outline face at ten heights over a hundred
 * and thirty-three characters, and each of the nine styled files -- bold,
 * italic and bold italic of Arial, Courier New and Times New Roman -- at three
 * heights over thirty-six. Those files are outlines of their own with programs
 * of their own, so this gives them the same net the regular faces had. It adds
 * Wingdings, which the glyphs probe never drew, and a sweep of the weight
 * field from a hundred to nine hundred, which asks the mapper where bold
 * begins.
 *
 * Same cell, same record, same field names as the glyphs probe, so it replays
 * through the same adapter and lands in its own fixture.
 */

#include <windows.h>

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\STYLES.OUT"

#define CELL_WIDTH  32
#define CELL_HEIGHT 32
#define ROW_BYTES   4
#define CELL_BYTES  (ROW_BYTES * CELL_HEIGHT)

static HDC memory;
static HBITMAP canvas;
static char bits[CELL_BYTES];

static const char HEX[] = "0123456789abcdef";

static const char WIDE[] = "ABEKMNRSWXZabdefgjkmnostwy0123456789";

/* Draws one character into the cell and writes the cell out, exactly as the
 * glyphs probe does. */
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

    TextOut(memory, 2, 0, text, 1);

    GetBitmapBits(canvas, (LONG)CELL_BYTES, bits);

    at = probeResult;

    for (index = 0; index < CELL_BYTES; index++) {
        *at++ = HEX[(bits[index] >> 4) & 0x0f];
        *at++ = HEX[bits[index] & 0x0f];
    }

    *at = '\0';

    /* Letters and digits go in as themselves; anything else as its code, since
     * a quote or a comma inside the argument list is not something the replay
     * can be asked to parse around. */
    if (((unsigned char)character >= '0' && (unsigned char)character <= '9') ||
        ((unsigned char)character >= 'A' && (unsigned char)character <= 'Z') ||
        ((unsigned char)character >= 'a' && (unsigned char)character <= 'z')) {
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

static HFONT makeFontIn(LPCSTR face, int height, int weight, BYTE italic, BYTE charset)
{
    return CreateFont(height, 0, 0, 0, weight, italic, 0, 0,
                      charset, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                      DEFAULT_QUALITY, DEFAULT_PITCH, face);
}

static HFONT makeFont(LPCSTR face, int height, int weight, BYTE italic)
{
    return makeFontIn(face, height, weight, italic, ANSI_CHARSET);
}

/* The thirty-six letters at the seven heights the regular faces had. */
static void probeWide(LPCSTR face, int weight, BYTE italic)
{
    static const int SIZES[] = { 10, 12, 14, 16, 18, 20, 24 };

    int size;
    int index;
    char name[64];

    for (size = 0; size < sizeof(SIZES) / sizeof(SIZES[0]); size++) {
        HFONT font = makeFont(face, SIZES[size], weight, italic);

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

/* The accented range at the six heights the regular faces had. */
static void probeAccented(LPCSTR face, int weight, BYTE italic)
{
    static const int SIZES[] = { 12, 16, 17, 18, 23, 31 };

    int size;
    int code;
    char name[64];

    for (size = 0; size < sizeof(SIZES) / sizeof(SIZES[0]); size++) {
        HFONT font = makeFont(face, SIZES[size], weight, italic);

        wsprintf(name, "\"%s\",h=%d,weight=%d,italic=%d", (LPSTR)face, SIZES[size],
                 weight, (int)italic);

        for (code = 0xA0; code <= 0xFF; code++) {
            probeGlyph(name, font, (char)code);
        }

        if (font) {
            DeleteObject(font);
        }
    }
}

/* Wingdings over its lower half, asked for with the symbol charset.
 *
 * Asked for with the ANSI charset, as the first recording did, the name loses
 * to the charset -- the mapper's rule -- and both Windows and this fall to a
 * bitmap face; that recording measured the fallback, not the font. `symbol`
 * in the record tells the replay which charset was asked for. */
static void probeWingdings(void)
{
    static const int SIZES[] = { 10, 12, 14, 16, 18, 20, 24 };

    int size;
    int code;
    char name[64];

    for (size = 0; size < sizeof(SIZES) / sizeof(SIZES[0]); size++) {
        HFONT font = makeFontIn("Wingdings", SIZES[size], FW_NORMAL, 0, SYMBOL_CHARSET);

        wsprintf(name, "\"Wingdings\",h=%d,weight=400,italic=0,symbol", SIZES[size]);

        for (code = 0x21; code <= 0x7E; code++) {
            probeGlyph(name, font, (char)code);
        }

        if (font) {
            DeleteObject(font);
        }
    }
}

/* Every hundred of weight at one height, which asks where bold begins. */
static void probeWeights(LPCSTR face)
{
    int weight;
    int index;
    char name[64];

    for (weight = 100; weight <= 900; weight += 100) {
        HFONT font = makeFont(face, 16, weight, 0);

        wsprintf(name, "\"%s\",h=16,weight=%d,italic=0", (LPSTR)face, weight);

        for (index = 0; WIDE[index]; index++) {
            probeGlyph(name, font, WIDE[index]);
        }

        if (font) {
            DeleteObject(font);
        }
    }
}

/* Every ten of weight from five hundred to seven hundred, on a few letters,
 * for exactly where synthesis begins -- on faces with a bold file, on a strike
 * family, and on an outline face that has no bold file at all. */
static void probeWeightsFine(LPCSTR face)
{
    static const char FEW[] = "Aao1";

    int weight;
    int index;
    char name[64];

    for (weight = 500; weight <= 700; weight += 10) {
        HFONT font = makeFont(face, 16, weight, 0);

        wsprintf(name, "\"%s\",h=16,weight=%d,italic=0", (LPSTR)face, weight);

        for (index = 0; FEW[index]; index++) {
            probeGlyph(name, font, FEW[index]);
        }

        if (font) {
            DeleteObject(font);
        }
    }
}

/* The metrics Windows reports for a face at each height, in the font probe's
 * record, so the pixel size it chose is read rather than inferred from how
 * tall its glyphs came out. */
static void probeMetrics(LPCSTR face, BYTE charset)
{
    static const int SIZES[] = { 10, 12, 14, 16, 18, 20, 24 };

    int size;

    for (size = 0; size < sizeof(SIZES) / sizeof(SIZES[0]); size++) {
        HFONT font = makeFontIn(face, SIZES[size], FW_NORMAL, 0, charset);
        HFONT previous;
        TEXTMETRIC tm;
        char resolved[64];

        if (font == NULL) {
            continue;
        }

        previous = (HFONT)SelectObject(memory, font);
        GetTextMetrics(memory, &tm);
        GetTextFace(memory, sizeof(resolved), resolved);

        wsprintf(probeArgs,
                 "\"%s\",h=%d,w=0,weight=400,italic=0,under=0,strike=0,charset=%d,pitch=0",
                 (LPSTR)face, SIZES[size], (int)charset);

        wsprintf(probeResult, "\"%s\"", (LPSTR)resolved);
        probe("CreateFont face", probeArgs, probeResult);

        wsprintf(probeResult, "italic=%d,underlined=%d,struckout=%d,pitch=%d,charset=%d",
                 (int)tm.tmItalic, (int)tm.tmUnderlined, (int)tm.tmStruckOut,
                 (int)tm.tmPitchAndFamily, (int)tm.tmCharSet);
        probe("CreateFont style", probeArgs, probeResult);
        wsprintf(probeResult, "height=%d,ascent=%d,descent=%d,internal=%d,external=%d",
                 tm.tmHeight, tm.tmAscent, tm.tmDescent,
                 tm.tmInternalLeading, tm.tmExternalLeading);
        probe("CreateFont heights", probeArgs, probeResult);

        wsprintf(probeResult, "ave=%d,max=%d,weight=%d,overhang=%d",
                 tm.tmAveCharWidth, tm.tmMaxCharWidth, tm.tmWeight, tm.tmOverhang);
        probe("CreateFont widths", probeArgs, probeResult);

        SelectObject(memory, previous);
        DeleteObject(font);
    }
}

static void probeStyle(LPCSTR face, int weight, BYTE italic)
{
    probeWide(face, weight, italic);
    probeAccented(face, weight, italic);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HDC screen;

    probeOpen(OUTPUT);

    screen = GetDC(NULL);
    memory = CreateCompatibleDC(screen);

    canvas = CreateBitmap(CELL_WIDTH, CELL_HEIGHT, 1, 1, NULL);

    if (memory == NULL || canvas == NULL) {
        probe("CreateBitmap", "32x32x1", "failed");
        probeFinish();
        return 0;
    }

    SelectObject(memory, canvas);

    probeNote("the styled files, given the net the regular faces had");
    probeStyle("Arial", FW_BOLD, 0);
    probeStyle("Arial", FW_NORMAL, 1);
    probeStyle("Arial", FW_BOLD, 1);
    probeStyle("Times New Roman", FW_BOLD, 0);
    probeStyle("Times New Roman", FW_NORMAL, 1);
    probeStyle("Times New Roman", FW_BOLD, 1);
    probeStyle("Courier New", FW_BOLD, 0);
    probeStyle("Courier New", FW_NORMAL, 1);
    probeStyle("Courier New", FW_BOLD, 1);

    probeNote("Wingdings, which had never been drawn");
    probeWingdings();

    probeNote("and the size Windows says it gave Wingdings, and a control");
    probeMetrics("Wingdings", SYMBOL_CHARSET);
    probeMetrics("Wingdings", ANSI_CHARSET);
    probeMetrics("Symbol", ANSI_CHARSET);

    probeNote("the weight field, every hundred, for where bold begins");
    probeWeights("Arial");
    probeWeights("Times New Roman");

    probeNote("and every ten of it between five and seven hundred");
    probeWeightsFine("Arial");
    probeWeightsFine("Times New Roman");
    probeWeightsFine("MS Sans Serif");
    probeWeightsFine("Symbol");

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
