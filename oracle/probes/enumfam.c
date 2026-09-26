/*
 * The fonts a screen device context has, as `EnumFontFamilies` hands them
 * out: which families, in what order, and what it says of each.
 *
 * Character Map fills its font list this way. What a family is said to be
 * is a `LOGFONT` -- extended with a full name and a style for a TrueType one
 * -- and a `NEWTEXTMETRIC`, and a type: raster, device, TrueType. Which fonts
 * a screen has depends on the display, whose raster fonts are its own, so
 * this is recorded on each.
 *
 * Records:
 *
 * * `family`: each call with no name, in order: the type, the `LOGFONT`, the
 *   full name and style, and the metrics.
 * * `style`: each call for a family by name, `family,index`, the same.
 * * `answer`: what each `EnumFontFamilies` answered, and the calls it made:
 *   everything, a family by name, a name that is no font, and a callback
 *   that answers nought at once.
 * * `font` and `fontname`: the same of `EnumFonts`, the older call, whose
 *   callback is given a `LOGFONT` and a `TEXTMETRIC` alone -- every face, then
 *   each face by name -- and `oldanswer`, what it answered.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\ENUMFAM.OUT"

static char families[40][LF_FACESIZE];
static int familyCount = 0;
static int calls = 0;
static char current[LF_FACESIZE];
static BOOL styles = FALSE;

/* One call's worth, as a record's result. */
static void describe(const ENUMLOGFONT FAR *font, const NEWTEXTMETRIC FAR *metric, int type)
{
    const LOGFONT FAR *lf = &font->elfLogFont;
    char name[80];
    char style[40];

    /* The full name and style are only a TrueType font's: copied only then,
     * so a raster font's bytes past the LOGFONT are not read as text. */
    if (type & TRUETYPE_FONTTYPE) {
        lstrcpyn(name, (LPCSTR)font->elfFullName, sizeof(name));
        lstrcpyn(style, (LPCSTR)font->elfStyle, sizeof(style));
    } else {
        name[0] = '\0';
        style[0] = '\0';
    }

    wsprintf(probeResult,
             "type=%d,lf=%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%s,full=%s,style=%s,"
             "tm=%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d,"
             "ntm=%lx:%u:%u:%u",
             type, lf->lfHeight, lf->lfWidth, lf->lfEscapement, lf->lfOrientation,
             lf->lfWeight, lf->lfItalic, lf->lfUnderline, lf->lfStrikeOut, lf->lfCharSet,
             lf->lfOutPrecision, lf->lfClipPrecision, lf->lfQuality, lf->lfPitchAndFamily,
             (LPCSTR)lf->lfFaceName, (LPSTR)name, (LPSTR)style, metric->tmHeight,
             metric->tmAscent, metric->tmDescent, metric->tmInternalLeading,
             metric->tmExternalLeading, metric->tmAveCharWidth, metric->tmMaxCharWidth,
             metric->tmWeight, metric->tmItalic, metric->tmUnderlined, metric->tmStruckOut,
             metric->tmFirstChar, metric->tmLastChar, metric->tmDefaultChar,
             metric->tmBreakChar, metric->tmPitchAndFamily, metric->tmCharSet,
             metric->tmOverhang, metric->tmDigitizedAspectX, metric->tmDigitizedAspectY,
             (type & TRUETYPE_FONTTYPE) ? metric->ntmFlags : 0L,
             (type & TRUETYPE_FONTTYPE) ? metric->ntmSizeEM : 0,
             (type & TRUETYPE_FONTTYPE) ? metric->ntmCellHeight : 0,
             (type & TRUETYPE_FONTTYPE) ? metric->ntmAvgWidth : 0);
}

int FAR PASCAL _export FamilyProc(const ENUMLOGFONT FAR *font, const NEWTEXTMETRIC FAR *metric,
                                  int type, LPARAM data)
{
    calls++;
    describe(font, metric, type);

    if (styles) {
        wsprintf(probeArgs, "%s,%d", (LPSTR)current, calls - 1);
        probe("style", probeArgs, probeResult);
    } else {
        wsprintf(probeArgs, "%d", calls - 1);
        probe("family", probeArgs, probeResult);

        if (familyCount < 40) {
            lstrcpyn(families[familyCount++], (LPCSTR)font->elfLogFont.lfFaceName, LF_FACESIZE);
        }
    }

    /* The answer the enumeration is to give back: the data, as it came. */
    return (int)data;
}

static char faces[40][LF_FACESIZE];
static int faceCount = 0;
static BOOL byName = FALSE;

/* `EnumFonts`' callback: the `LOGFONT` and `TEXTMETRIC` alone. */
int FAR PASCAL _export FontProc(const LOGFONT FAR *lf, const TEXTMETRIC FAR *metric, int type,
                                LPARAM data)
{
    calls++;
    wsprintf(probeResult,
             "type=%d,lf=%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%s,"
             "tm=%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d:%d",
             type, lf->lfHeight, lf->lfWidth, lf->lfEscapement, lf->lfOrientation, lf->lfWeight,
             lf->lfItalic, lf->lfUnderline, lf->lfStrikeOut, lf->lfCharSet, lf->lfOutPrecision,
             lf->lfClipPrecision, lf->lfQuality, lf->lfPitchAndFamily, (LPCSTR)lf->lfFaceName,
             metric->tmHeight, metric->tmAscent, metric->tmDescent, metric->tmInternalLeading,
             metric->tmExternalLeading, metric->tmAveCharWidth, metric->tmMaxCharWidth,
             metric->tmWeight, metric->tmItalic, metric->tmUnderlined, metric->tmStruckOut,
             metric->tmFirstChar, metric->tmLastChar, metric->tmDefaultChar, metric->tmBreakChar,
             metric->tmPitchAndFamily, metric->tmCharSet, metric->tmOverhang,
             metric->tmDigitizedAspectX, metric->tmDigitizedAspectY);

    if (byName) {
        wsprintf(probeArgs, "%s,%d", (LPSTR)current, calls - 1);
        probe("fontname", probeArgs, probeResult);
    } else {
        wsprintf(probeArgs, "%d", calls - 1);
        probe("font", probeArgs, probeResult);

        if (faceCount < 40) {
            lstrcpyn(faces[faceCount++], (LPCSTR)lf->lfFaceName, LF_FACESIZE);
        }
    }

    return (int)data;
}

int FAR PASCAL _export StopProc(const ENUMLOGFONT FAR *font, const NEWTEXTMETRIC FAR *metric,
                                int type, LPARAM data)
{
    calls++;
    return 0;
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    FARPROC family;
    FARPROC stop;
    HDC screen;
    int answer;
    int index;

    probeOpen(OUTPUT);

    screen = GetDC(NULL);
    family = MakeProcInstance((FARPROC)FamilyProc, instance);
    stop = MakeProcInstance((FARPROC)StopProc, instance);

    /* Every family, each answering 7. */
    calls = 0;
    answer = EnumFontFamilies(screen, NULL, (FONTENUMPROC)family, 7L);
    wsprintf(probeResult, "%d,calls=%d", answer, calls);
    probe("answer", "all", probeResult);

    /* Each family's styles, by its name, each answering 1. */
    styles = TRUE;

    for (index = 0; index < familyCount; index++) {
        lstrcpy(current, families[index]);
        calls = 0;
        answer = EnumFontFamilies(screen, families[index], (FONTENUMPROC)family, 1L);
        wsprintf(probeArgs, "family:%s", (LPSTR)families[index]);
        wsprintf(probeResult, "%d,calls=%d", answer, calls);
        probe("answer", probeArgs, probeResult);
    }

    /* A name that is no font's. */
    lstrcpy(current, "Nothing");
    calls = 0;
    answer = EnumFontFamilies(screen, "Nothing", (FONTENUMPROC)family, 1L);
    wsprintf(probeResult, "%d,calls=%d", answer, calls);
    probe("answer", "nothing", probeResult);

    /* A callback that answers nought: how many calls it gets. */
    calls = 0;
    answer = EnumFontFamilies(screen, NULL, (FONTENUMPROC)stop, 0L);
    wsprintf(probeResult, "%d,calls=%d", answer, calls);
    probe("answer", "stop", probeResult);

    /* The older call: every face, then each by name. */
    {
        FARPROC font = MakeProcInstance((FARPROC)FontProc, instance);

        calls = 0;
        answer = EnumFonts(screen, NULL, (OLDFONTENUMPROC)font, (LPARAM)5L);
        wsprintf(probeResult, "%d,calls=%d", answer, calls);
        probe("oldanswer", "all", probeResult);

        byName = TRUE;

        for (index = 0; index < faceCount; index++) {
            lstrcpy(current, faces[index]);
            calls = 0;
            answer = EnumFonts(screen, faces[index], (OLDFONTENUMPROC)font, (LPARAM)1L);
            wsprintf(probeArgs, "face:%s", (LPSTR)faces[index]);
            wsprintf(probeResult, "%d,calls=%d", answer, calls);
            probe("oldanswer", probeArgs, probeResult);
        }

        FreeProcInstance(font);
    }

    FreeProcInstance(family);
    FreeProcInstance(stop);
    ReleaseDC(NULL, screen);
    probeFinish();

    return 0;
}
