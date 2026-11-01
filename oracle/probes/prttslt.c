/*
 * The glyphs GDI's TrueType engine slants itself, for a face with no italic
 * of its own, asked of `EngineGetGlyphBmp` at ems where GDI's slant and the
 * display's part, with a driver of the probe's own (`prttslt.dll.c`,
 * `PRTTSLTD`) whose `Glyphs` logs each glyph's record and rows.
 *
 * GDI's slant adds `(57h * m00) >> 8` to the engine's matrix's `m10` (seg1
 * `6f22`-`6fce`), 13 at an em of 40 and 18 at 53, where the display's
 * synthesis leans by `floor(em / 3)`, 17 there. `prtteng` asks at 40 alone.
 *
 * Records: `EngineSetFontContext`, `EngineGetGlyphBmp` and `row`, and the
 * probe's own calls.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\PRTTSLT.OUT"
#define LOG "C:\\ORACLE\\PRTTSLT.LOG"
#define LIBRARY "C:\\WINDOWS\\PRTTSLTD.DLL"
#define DRIVER_FILE "C:\\WINDOWS\\PRTTSLTD.DRV"
#define DRIVER "PRTTSLTD"

static char chunk[4096];

static void install(void)
{
    OFSTRUCT info;
    HFILE from = OpenFile(LIBRARY, &info, OF_READ);
    HFILE to = _lcreat(DRIVER_FILE, 0);
    int read;

    while ((read = _lread(from, chunk, sizeof(chunk))) > 0) {
        _lwrite(to, chunk, read);
    }

    _lclose(from);
    _lclose(to);
}

/* The driver's log read back as records, and taken away. */
static void drained(void)
{
    OFSTRUCT info;
    HFILE file = OpenFile(LOG, &info, OF_READ);
    static char line[1000];
    int length = 0;
    int read;
    int at;

    if (file == HFILE_ERROR) {
        return;
    }

    while ((read = _lread(file, chunk, sizeof(chunk))) > 0) {
        for (at = 0; at < read; at++) {
            if (chunk[at] == '\n') {
                LPSTR args;
                LPSTR result;

                if (length > 0 && line[length - 1] == '\r') {
                    length--;
                }

                line[length] = '\0';
                args = line;

                while (*args && *args != '\t') {
                    args++;
                }

                if (*args) {
                    *args++ = '\0';
                }

                result = args;

                while (*result && *result != '\t') {
                    result++;
                }

                if (*result) {
                    *result++ = '\0';
                }

                probe(line, args, result);
                length = 0;
            } else if (length < (int)sizeof(line) - 1) {
                line[length++] = chunk[at];
            }
        }
    }

    _lclose(file);
    OpenFile(LOG, &info, OF_DELETE);
}

typedef void(FAR PASCAL *GLYPHSPROC)(HDC, LPSTR, LPSTR);

static GLYPHSPROC glyphs;

/* The face at an em, slanted as asked, realized in the driver's context and
 * its characters' glyphs asked for. */
static void slanted(HDC dc, LPSTR face, BYTE charset, int em, BYTE italic, LPSTR characters)
{
    char name[40];
    TEXTMETRIC metrics;
    HFONT made = CreateFont(-em, 0, 0, 0, 400, italic, 0, 0, charset, OUT_DEFAULT_PRECIS,
                            CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY, DEFAULT_PITCH, face);
    HFONT old = SelectObject(dc, made);

    wsprintf(name, "%s%s %d", face, (LPSTR)(italic ? " slanted" : ""), em);
    GetTextMetrics(dc, &metrics);
    wsprintf(probeResult, "%d %d %d %d", metrics.tmHeight, metrics.tmAscent,
             metrics.tmAveCharWidth, metrics.tmOverhang);
    probe("metrics", name, probeResult);
    drained();

    glyphs(dc, name, characters);
    drained();

    SelectObject(dc, old);
    DeleteObject(made);
    drained();
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static int ems[] = {40, 48, 52, 53, 54, 60, 64, 72};
    OFSTRUCT info;
    HDC dc;
    int i;

    probeOpen(OUTPUT);
    OpenFile(LOG, &info, OF_DELETE);
    install();

    dc = CreateDC(DRIVER, "Probe", "LPT1:", NULL);
    wsprintf(probeResult, "%d", dc != NULL);
    probe("call", "CreateDC", probeResult);
    drained();

    glyphs = (GLYPHSPROC)GetProcAddress(GetModuleHandle(DRIVER), "GLYPHS");

    if (dc && glyphs) {
        for (i = 0; i < sizeof(ems) / sizeof(ems[0]); i++) {
            slanted(dc, "Wingdings", SYMBOL_CHARSET, ems[i], 1, "Aal\351");
            slanted(dc, "Symbol", SYMBOL_CHARSET, ems[i], 1, "aSW");
        }

        slanted(dc, "Wingdings", SYMBOL_CHARSET, 53, 0, "Aal\351");

        wsprintf(probeResult, "%d", DeleteDC(dc));
        probe("call", "DeleteDC", probeResult);
        drained();
    }

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
