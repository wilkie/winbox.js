/*
 * fontboot -- the fonts Windows starts with, under `WIN.INI` settings made
 * before it starts: recorded once for each preset `fontboot.<preset>.ini`
 * (`record.mjs --ini <preset>`).
 *
 * * `fonts`: `[fonts]` lines that are paths outside the system directory, a
 *   name with no extension, a name alone, and a file that is not there.
 *   USER adds each line's value at start-up, `.FON` put after a value with
 *   no `.` in it (`USER.EXE` seg3 `1b9a`).
 * * `ttoff`: `[TrueType]` `TTEnable=0`, which GDI reads at start-up
 *   (`GDI.EXE` seg2 `110e`): with it nought, GDI makes no TrueType table.
 * * `ttonly`: `[TrueType]` `TTOnly=1`, bit 8 of GDI's flags (seg2 `1129`),
 *   which enumeration reads (seg5 `0249`, `04a0`).
 *
 * Records:
 *
 * * `profile`: the `[TrueType]` key as `GetProfileString` reads it.
 * * `rasterizer`: `GetRasterizerCaps`'s answer, `nSize` and `wFlags`.
 * * `families`: every family `EnumFontFamilies` hands out, in order, each
 *   with its `FontType`.
 * * `all`: how many fonts `EnumFonts` hands out with no face named.
 * * `faces`: how many fonts `EnumFonts` hands out for a face, and their
 *   heights.
 * * `face`: what a font made by name maps to, `GetTextFace` and its height.
 * * `add`, `remove`: `AddFontResource` and `RemoveFontResource`.
 * * `scalable`: `CreateScalableFontResource`'s answer.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\FONTBOOT.OUT"

static HDC screen;
static FARPROC familyProc;
static FARPROC faceProc;
static LPSTR out;
static int count;

int FAR PASCAL _export FamilyProc(const ENUMLOGFONT FAR *font, const NEWTEXTMETRIC FAR *metric,
                                  int type, LPARAM data)
{
    out += wsprintf(out, "%s%s:%d", (LPSTR)(out == probeResult ? "" : "|"),
                    (LPSTR)font->elfLogFont.lfFaceName, type);
    (void)metric;
    (void)data;
    return 1;
}

int FAR PASCAL _export FaceProc(const LOGFONT FAR *font, const TEXTMETRIC FAR *metric, int type,
                                LPARAM data)
{
    count++;

    if (out) {
        out += wsprintf(out, " %d", metric->tmHeight);
    }

    (void)font;
    (void)type;
    (void)data;
    return 1;
}

static void families(LPCSTR when)
{
    out = probeResult;
    *out = '\0';
    EnumFontFamilies(screen, NULL, (FONTENUMPROC)familyProc, 0L);
    probe("families", when, probeResult);
}

static void all(LPCSTR when)
{
    count = 0;
    out = NULL;
    EnumFonts(screen, NULL, (FONTENUMPROC)faceProc, 0L);
    wsprintf(probeResult, "%d", count);
    probe("all", when, probeResult);
}

static void faces(LPCSTR when, LPCSTR face)
{
    char heights[400];

    count = 0;
    out = heights;
    *out = '\0';
    EnumFonts(screen, face, (FONTENUMPROC)faceProc, 0L);
    wsprintf(probeArgs, "%s,%s", when, face);
    wsprintf(probeResult, "%d:%s", count, (LPSTR)heights);
    probe("faces", probeArgs, probeResult);
}

static void face(LPCSTR name, int height, BYTE charSet)
{
    HFONT font = CreateFont(height, 0, 0, 0, FW_NORMAL, 0, 0, 0, charSet, OUT_DEFAULT_PRECIS,
                            CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY, DEFAULT_PITCH, name);
    HFONT previous = (HFONT)SelectObject(screen, font);
    TEXTMETRIC metric;
    char got[LF_FACESIZE];

    GetTextFace(screen, sizeof(got), got);
    GetTextMetrics(screen, &metric);
    wsprintf(probeArgs, "%s,%d,%d", name, height, charSet);
    wsprintf(probeResult, "%s,%d", (LPSTR)got, metric.tmHeight);
    probe("face", probeArgs, probeResult);
    SelectObject(screen, previous);
    DeleteObject(font);
}

static void addRemove(LPCSTR file)
{
    int added = AddFontResource(file);
    BOOL removed = RemoveFontResource(file);

    wsprintf(probeResult, "%d", added);
    probe("add", file, probeResult);
    wsprintf(probeResult, "%d", removed);
    probe("remove", file, probeResult);
}

static void profile(LPCSTR key)
{
    char value[64];

    GetProfileString("TrueType", key, "(none)", value, sizeof(value));
    probe("profile", key, value);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    RASTERIZER_STATUS status;
    BOOL answer;

    probeOpen(OUTPUT);

    screen = GetDC(NULL);
    familyProc = MakeProcInstance((FARPROC)FamilyProc, instance);
    faceProc = MakeProcInstance((FARPROC)FaceProc, instance);

    profile("TTEnable");
    profile("TTOnly");

    _fmemset(&status, 0xcc, sizeof(status));
    answer = GetRasterizerCaps(&status, sizeof(status));
    wsprintf(probeResult, "%d,%d,%x", answer, status.nSize, status.wFlags);
    probe("rasterizer", "", probeResult);

    families("boot");
    all("boot");
    faces("boot", "Terminal");
    faces("boot", "Arial");
    faces("boot", "Courier New");
    faces("boot", "MS Sans Serif");

    face("Arial", 20, ANSI_CHARSET);
    face("Times New Roman", 30, ANSI_CHARSET);
    face("Courier New", 16, ANSI_CHARSET);
    face("Wingdings", 20, SYMBOL_CHARSET);
    face("MS Sans Serif", 13, ANSI_CHARSET);
    face("Terminal", 8, OEM_CHARSET);
    face("", 18, ANSI_CHARSET);
    face("No Such Face", 30, ANSI_CHARSET);
    face("No Such Face", 20, ANSI_CHARSET);
    face("No Such Face", 13, ANSI_CHARSET);
    face("No Such Face", 15, ANSI_CHARSET);

    probeNote("files already added at start-up, added and removed");
    addRemove("ARIAL.FOT");
    addRemove("SERIFE.FON");
    addRemove("C:\\FONTS\\TERM.FON");
    addRemove("CGA80WOA.FON");
    addRemove("EGA40WOA.FON");
    faces("after", "Terminal");

    OpenFile("C:\\ORACLE\\ARIAL2.FOT", (OFSTRUCT *)probeResult, OF_DELETE);
    answer = CreateScalableFontResource(0, "C:\\ORACLE\\ARIAL2.FOT", "ARIAL.TTF",
                                        "C:\\WINDOWS\\SYSTEM");
    wsprintf(probeResult, "%d", answer);
    probe("scalable", "ARIAL2.FOT", probeResult);

    ReleaseDC(NULL, screen);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
