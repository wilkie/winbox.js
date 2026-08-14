/*
 * Font mapping.
 *
 * A program does not choose a font. It describes one -- a name, a height, a
 * weight, a pitch -- and GDI finds the closest thing it actually has. That
 * matching is the single largest source of "looks nearly right but not quite"
 * in an implementation written from a manual, because almost none of it is
 * written down: which of several installed sizes wins for a height between
 * them, what happens to a request for bold when no bold exists, whether the
 * name that comes back is the one that was asked for or the one that was
 * found.
 *
 * It is also immediately load-bearing. Clock reads `sFont` out of `CLOCK.INI`
 * and asks for it by name; the answer decides how large the clock face is
 * drawn and where its digits sit.
 *
 * What is installed matters as much as what is asked for, so this probe is
 * only meaningful next to the `[fonts]` section of the `WIN.INI` it ran
 * against. On the oracle's installation that is six bitmap families and four
 * TrueType ones, which is the interesting case precisely because the two kinds
 * answer differently.
 *
 * The height is where most of the subtlety is. A positive `lfHeight` asks for
 * a cell that tall, including the internal leading; a negative one asks for
 * the characters themselves to be that tall, which is a different and smaller
 * number; and zero asks for whatever the mapper likes. All three are probed
 * against the same face so the difference between them is visible rather than
 * inferred.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\FONT.OUT"

/* The string every mapped font is measured with.
 *
 * Mixed case with an ascender, a descender and a space, so a font that is the
 * right height but the wrong shape shows it.
 */
#define SPECIMEN "Wg jpq 128"

static HDC dc;

/*
 * Records everything about one font request.
 *
 * The request goes in the argument field in the order `CreateFont` takes it,
 * so a record says what was asked for as well as what came back -- the two
 * together are the mapping, and either alone is not.
 */
static void probeFont(int height, int width, int weight, BYTE italic,
                      BYTE underline, BYTE strikeout, BYTE charset,
                      BYTE pitch, LPCSTR face)
{
    HFONT font;
    HFONT previous;
    TEXTMETRIC tm;
    char resolved[64];
    DWORD extent;

    /* Every field that was asked for, because the argument is what identifies
     * the record: two requests that differ only in underlining and record the
     * same arguments are two answers to the same question, and there is no way
     * to tell afterwards which answer belonged to which.
     */
    wsprintf(probeArgs,
             "\"%s\",h=%d,w=%d,weight=%d,italic=%d,under=%d,strike=%d,charset=%d,pitch=%d",
             (LPSTR)face, height, width, weight, (int)italic, (int)underline,
             (int)strikeout, (int)charset, (int)pitch);

    font = CreateFont(height, width, 0, 0, weight, italic, underline, strikeout,
                      charset, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                      DEFAULT_QUALITY, pitch, face);

    if (font == NULL) {
        probe("CreateFont face", probeArgs, "no font");
        return;
    }

    previous = (HFONT)SelectObject(dc, font);

    /* What GDI says the font is called now. Whether this is the requested name
     * or the name of the file that was actually opened is one of the things
     * being measured: a substituted face could reasonably answer either way,
     * and only one of them is what happens.
     */
    GetTextFace(dc, sizeof(resolved), resolved);
    wsprintf(probeResult, "\"%s\"", (LPSTR)resolved);
    probe("CreateFont face", probeArgs, probeResult);

    GetTextMetrics(dc, &tm);

    /* Split the way the text probe splits it, so a font that came back the
     * right size but the wrong shape says which.
     */
    wsprintf(probeResult, "height=%d,ascent=%d,descent=%d,internal=%d,external=%d",
             tm.tmHeight, tm.tmAscent, tm.tmDescent,
             tm.tmInternalLeading, tm.tmExternalLeading);
    probe("CreateFont heights", probeArgs, probeResult);

    wsprintf(probeResult, "ave=%d,max=%d,weight=%d,overhang=%d",
             tm.tmAveCharWidth, tm.tmMaxCharWidth, tm.tmWeight, tm.tmOverhang);
    probe("CreateFont widths", probeArgs, probeResult);

    wsprintf(probeResult, "italic=%d,underlined=%d,struckout=%d,pitch=%d,charset=%d",
             tm.tmItalic, tm.tmUnderlined, tm.tmStruckOut,
             tm.tmPitchAndFamily, tm.tmCharSet);
    probe("CreateFont style", probeArgs, probeResult);

    extent = GetTextExtent(dc, SPECIMEN, lstrlen(SPECIMEN));
    wsprintf(probeResult, "width=%d,height=%d", LOWORD(extent), HIWORD(extent));
    probe("CreateFont extent", probeArgs, probeResult);

    SelectObject(dc, previous);
    DeleteObject(font);
}

/*
 * Records one face plain, emboldened and slanted at a spread of sizes.
 *
 * The sizes are chosen to cross every strike a bitmap family is installed in
 * and then to go past the largest, where Windows stretches a smaller strike
 * instead. Nothing here assumes which sizes exist -- an installed size and an
 * interpolated one are both worth having, and which is which comes out of the
 * heights that come back.
 */
static void probeStyles(LPCSTR face)
{
    static const int HEIGHTS[] = { 13, 16, 20, 24, 29, 37, 50, 100 };

    int index;

    for (index = 0; index < sizeof(HEIGHTS) / sizeof(HEIGHTS[0]); index++) {
        int height = HEIGHTS[index];

        probeFont(height, 0, FW_NORMAL, 0, 0, 0, ANSI_CHARSET, DEFAULT_PITCH, face);
        probeFont(height, 0, FW_BOLD, 0, 0, 0, ANSI_CHARSET, DEFAULT_PITCH, face);
        probeFont(height, 0, FW_NORMAL, 1, 0, 0, ANSI_CHARSET, DEFAULT_PITCH, face);
    }
}

/*
 * Records a vector face across a wide spread of sizes.
 *
 * A vector font is not a set of strikes. There is one design -- Roman is
 * stored at thirty-two pixels -- and Windows renders it at whatever size was
 * asked for, so the whole business of picking the nearest installed size and
 * stretching it by whole numbers does not apply. What replaces it is the
 * question: given a design at one size and a request at another, what do the
 * metrics become?
 *
 * Halving the design height does not halve the widths -- the first recording
 * showed a thirty-two pixel Roman with an average width of nineteen answering
 * a sixteen pixel request with an average of six -- so the horizontal and
 * vertical scales are not the same number, and one measurement cannot say what
 * either of them is. Hence the spread.
 */
static void probeVector(LPCSTR face, BYTE charset)
{
    /* Enough sizes to see where the thresholds are rather than that there are
     * some. The cluster from 24 to 34 straddles the point where emboldening
     * starts to cost a pixel, and the ones past 64 say whether it keeps
     * costing more.
     */
    static const int HEIGHTS[] = { 8, 12, 16, 20, 24, 28, 30, 32, 34, 40, 48,
                                   64, 96, 100, 128, 160 };

    int index;

    for (index = 0; index < sizeof(HEIGHTS) / sizeof(HEIGHTS[0]); index++) {
        int height = HEIGHTS[index];

        /* Plain, emboldened and slanted at every size rather than at two of
         * them. Emboldening a stroke font behaves differently at sixteen
         * pixels and at forty -- the widths and the overhang gain a pixel at
         * the larger size and not at the smaller -- and two sizes say only
         * that a threshold exists, not where it is.
         */
        probeFont(height, 0, FW_NORMAL, 0, 0, 0, charset, DEFAULT_PITCH, face);
        probeFont(height, 0, FW_BOLD, 0, 0, 0, charset, DEFAULT_PITCH, face);
        probeFont(height, 0, FW_NORMAL, 1, 0, 0, charset, DEFAULT_PITCH, face);
    }

    /* Negative and zero mean the same things they mean for a bitmap face, and
     * whether a scalable one honours them the same way is worth having.
     */
    probeFont(-16, 0, FW_NORMAL, 0, 0, 0, charset, DEFAULT_PITCH, face);
    probeFont(0, 0, FW_NORMAL, 0, 0, 0, charset, DEFAULT_PITCH, face);

    // A width asked for as well, which a scalable face can satisfy exactly.
    probeFont(32, 8, FW_NORMAL, 0, 0, 0, charset, DEFAULT_PITCH, face);
    probeFont(32, 20, FW_NORMAL, 0, 0, 0, charset, DEFAULT_PITCH, face);

}

/* The ordinary case: a face by name at a plain size. */
static void probeFace(LPCSTR face, int height)
{
    probeFont(height, 0, FW_NORMAL, 0, 0, 0, ANSI_CHARSET, DEFAULT_PITCH, face);
}

/*
 * Records that the two ways of asking are the same way.
 *
 * `CreateFontIndirect` takes a structure where `CreateFont` takes fourteen
 * arguments. They are documented as equivalent; equivalent is a claim, and
 * this is what makes it a measurement.
 */
static void probeIndirect(LPCSTR face, int height)
{
    LOGFONT lf;
    HFONT font;
    HFONT previous;
    char resolved[64];
    TEXTMETRIC tm;
    int at;

    /* Zeroed by hand: the SDK has no FillMemory in this version, and a
     * structure with rubbish in its unused fields would be measuring the
     * rubbish.
     */
    for (at = 0; at < (int)sizeof(lf); at++) {
        ((LPSTR)&lf)[at] = 0;
    }

    lf.lfHeight = height;
    lf.lfWeight = FW_NORMAL;
    lf.lfCharSet = ANSI_CHARSET;
    lstrcpy(lf.lfFaceName, face);

    wsprintf(probeArgs, "\"%s\",h=%d", (LPSTR)face, height);

    font = CreateFontIndirect(&lf);

    if (font == NULL) {
        probe("CreateFontIndirect", probeArgs, "no font");
        return;
    }

    previous = (HFONT)SelectObject(dc, font);

    GetTextFace(dc, sizeof(resolved), resolved);
    GetTextMetrics(dc, &tm);

    wsprintf(probeResult, "\"%s\",height=%d,ave=%d,weight=%d",
             (LPSTR)resolved, tm.tmHeight, tm.tmAveCharWidth, tm.tmWeight);
    probe("CreateFontIndirect", probeArgs, probeResult);

    SelectObject(dc, previous);
    DeleteObject(font);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    probeOpen(OUTPUT);

    dc = GetDC(NULL);

    if (dc == NULL) {
        probe("GetDC", "NULL", "failed");
        probeFinish();
        return 0;
    }

    /* The bitmap families, at the sizes they are installed in and at sizes
     * between them. `MS Sans Serif` is installed at 8, 10, 12, 14, 18 and 24
     * point, which on a 96 dpi display is not the same as those numbers of
     * pixels -- the height asked for here is in pixels, and which strike that
     * lands on is the question.
     */
    probeNote("a face that exists, at heights around its installed sizes");
    probeFace("MS Sans Serif", 13);
    probeFace("MS Sans Serif", 16);
    probeFace("MS Sans Serif", 20);
    probeFace("MS Sans Serif", 25);
    probeFace("MS Sans Serif", 37);
    probeFace("MS Sans Serif", 100);
    probeFace("MS Sans Serif", 1);

    probeNote("the same face asked for by character height rather than cell");
    probeFace("MS Sans Serif", -8);
    probeFace("MS Sans Serif", -11);
    probeFace("MS Sans Serif", -16);

    probeNote("and with no height at all");
    probeFace("MS Sans Serif", 0);

    probeNote("the other installed bitmap faces");
    probeFace("Courier", 16);
    probeFace("MS Serif", 16);
    probeFace("System", 16);
    probeFace("Terminal", 16);
    probeFace("Fixedsys", 16);
    probeFace("Symbol", 16);

    /* The substitutions in `[FontSubstitutes]`. Whether the answer to
     * `GetTextFace` is the name asked for or the name substituted in is the
     * whole of what these measure.
     */
    probeNote("faces that WIN.INI redirects somewhere else");
    probeFace("Helv", 16);
    probeFace("Tms Rmn", 16);
    probeFace("Helvetica", 16);
    probeFace("Times", 16);

    probeNote("the TrueType faces, which are outlines rather than strikes");
    probeFace("Arial", 16);
    probeFace("Arial", 37);
    probeFace("Times New Roman", 16);
    probeFace("Courier New", 16);
    probeFace("WingDings", 16);

    probeNote("names that are not installed under any spelling");
    probeFace("Nonesuch", 16);
    probeFace("", 16);
    probeFace("MS Sans Serif Extra Bold Condensed", 16);

    /* Case and spacing in a face name. A program reading a name out of an INI
     * file passes on whatever was written there, which is not necessarily how
     * the font was installed.
     */
    probeNote("the same name spelled differently");
    probeFace("ms sans serif", 16);
    probeFace("MS SANS SERIF", 16);
    probeFace("MSSansSerif", 16);

    probeNote("weights, on a family with no bold strike installed");
    probeFont(16, 0, FW_NORMAL, 0, 0, 0, ANSI_CHARSET, DEFAULT_PITCH, "MS Sans Serif");
    probeFont(16, 0, FW_BOLD, 0, 0, 0, ANSI_CHARSET, DEFAULT_PITCH, "MS Sans Serif");
    probeFont(16, 0, FW_HEAVY, 0, 0, 0, ANSI_CHARSET, DEFAULT_PITCH, "MS Sans Serif");
    probeFont(16, 0, FW_LIGHT, 0, 0, 0, ANSI_CHARSET, DEFAULT_PITCH, "MS Sans Serif");
    probeFont(16, 0, FW_BOLD, 0, 0, 0, ANSI_CHARSET, DEFAULT_PITCH, "Arial");

    probeNote("styles that have to be synthesised for a bitmap face");
    probeFont(16, 0, FW_NORMAL, 1, 0, 0, ANSI_CHARSET, DEFAULT_PITCH, "MS Sans Serif");
    probeFont(16, 0, FW_NORMAL, 0, 1, 0, ANSI_CHARSET, DEFAULT_PITCH, "MS Sans Serif");
    probeFont(16, 0, FW_NORMAL, 0, 0, 1, ANSI_CHARSET, DEFAULT_PITCH, "MS Sans Serif");
    probeFont(16, 0, FW_NORMAL, 1, 1, 1, ANSI_CHARSET, DEFAULT_PITCH, "MS Sans Serif");

    /* The same two styles at every size the face is installed in, and at one
     * beyond them all.
     *
     * `tmOverhang` is what a synthesised style adds to a whole string over and
     * above the characters in it, and one measurement of it says nothing about
     * where the number comes from: an emboldening that smears one pixel and a
     * slant that leans over seven look like constants until the cell height
     * changes underneath them. Seven pixels of lean on a sixteen pixel cell is
     * a plausible constant and an equally plausible fraction of the height,
     * and only measuring both at several sizes separates them.
     *
     * The stretched size at the end matters most: it is the one case where the
     * strike being drawn is not the size that was asked for, so an overhang
     * that follows the strike and one that follows the request give different
     * answers.
     */
    probeNote("bold and slanted at every size, to find what the overhang follows");
    probeStyles("MS Sans Serif");
    probeStyles("Courier");
    probeStyles("MS Serif");

    /* A face that is already bold in the file, so a request for bold has
     * nothing to synthesise, and one that is fixed pitch.
     */
    probeNote("the same on faces that answer it differently");
    probeFont(16, 0, FW_BOLD, 0, 0, 0, ANSI_CHARSET, DEFAULT_PITCH, "System");
    probeFont(16, 0, FW_NORMAL, 1, 0, 0, ANSI_CHARSET, DEFAULT_PITCH, "System");
    probeFont(16, 0, FW_BOLD, 0, 0, 0, ANSI_CHARSET, DEFAULT_PITCH, "Fixedsys");
    probeFont(16, 0, FW_NORMAL, 1, 0, 0, ANSI_CHARSET, DEFAULT_PITCH, "Fixedsys");

    /* Bold and slanted together, which neither of the pairs above covers: the
     * two overhangs could add, or the larger could win.
     */
    /* The three stroke fonts, which are outlines in a `.FON` container: one
     * design apiece, rendered at whatever size is asked for.
     */
    probeNote("the vector faces, which have one design and no strikes");
    probeVector("Roman", OEM_CHARSET);
    probeVector("Modern", OEM_CHARSET);
    probeVector("Script", OEM_CHARSET);

    probeNote("both at once");
    probeFont(16, 0, FW_BOLD, 1, 0, 0, ANSI_CHARSET, DEFAULT_PITCH, "MS Sans Serif");
    probeFont(24, 0, FW_BOLD, 1, 0, 0, ANSI_CHARSET, DEFAULT_PITCH, "MS Sans Serif");
    probeFont(37, 0, FW_BOLD, 1, 0, 0, ANSI_CHARSET, DEFAULT_PITCH, "MS Sans Serif");

    /* With no face named, the pitch and family are all the mapper has to go
     * on, and this is how a program asks for "any fixed-pitch font".
     */
    probeNote("no name, chosen by pitch and family instead");
    probeFont(16, 0, FW_NORMAL, 0, 0, 0, ANSI_CHARSET, FIXED_PITCH, "");
    probeFont(16, 0, FW_NORMAL, 0, 0, 0, ANSI_CHARSET, VARIABLE_PITCH, "");
    probeFont(16, 0, FW_NORMAL, 0, 0, 0, ANSI_CHARSET,
              (BYTE)(VARIABLE_PITCH | FF_ROMAN), "");
    probeFont(16, 0, FW_NORMAL, 0, 0, 0, ANSI_CHARSET,
              (BYTE)(VARIABLE_PITCH | FF_SWISS), "");
    probeFont(16, 0, FW_NORMAL, 0, 0, 0, ANSI_CHARSET,
              (BYTE)(FIXED_PITCH | FF_MODERN), "");

    probeNote("character sets, which steer the mapping on their own");
    probeFont(16, 0, FW_NORMAL, 0, 0, 0, OEM_CHARSET, DEFAULT_PITCH, "");
    probeFont(16, 0, FW_NORMAL, 0, 0, 0, OEM_CHARSET, DEFAULT_PITCH, "MS Sans Serif");
    probeFont(16, 0, FW_NORMAL, 0, 0, 0, SYMBOL_CHARSET, DEFAULT_PITCH, "");
    probeFont(16, 0, FW_NORMAL, 0, 0, 0, ANSI_CHARSET, DEFAULT_PITCH, "Terminal");

    /* A width other than zero asks for characters that wide, which for a
     * bitmap face means choosing a strike by width instead of by height.
     */
    probeNote("an average width asked for as well as a height");
    probeFont(16, 8, FW_NORMAL, 0, 0, 0, ANSI_CHARSET, DEFAULT_PITCH, "MS Sans Serif");
    probeFont(16, 16, FW_NORMAL, 0, 0, 0, ANSI_CHARSET, DEFAULT_PITCH, "MS Sans Serif");
    probeFont(0, 8, FW_NORMAL, 0, 0, 0, ANSI_CHARSET, DEFAULT_PITCH, "MS Sans Serif");

    probeNote("the same requests through CreateFontIndirect");
    probeIndirect("MS Sans Serif", 16);
    probeIndirect("MS Sans Serif", -11);
    probeIndirect("Arial", 16);
    probeIndirect("Nonesuch", 16);
    probeIndirect("", 0);

    ReleaseDC(NULL, dc);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
