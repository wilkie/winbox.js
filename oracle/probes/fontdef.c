/*
 * fontdef -- a font file removed while a font made from it is realised.
 *
 * GDI counts, for each file in its font table, the fonts realised from it
 * that are in its cache (`GDI.EXE` seg3 `0ddd`). `RemoveFontResource` that
 * takes the last add away from a file with such a font does not let the
 * file go (seg6 `01b8`): its faces stay in the face table, hidden from
 * enumeration and the mapper because the file has no adds, until the last
 * of its fonts leaves the cache (seg6 `0302`, `0179`).
 *
 * Records:
 *
 * * `add`, `remove`: the file and the answer.
 * * `families`: every family `EnumFontFamilies` hands out, in order.
 * * `faces`: how many fonts `EnumFonts` hands out for a face, and their
 *   heights.
 * * `face`: what a font made then by name maps to, `GetTextFace` and its
 *   height.
 * * `held`: `GetTextFace` and the height of the font a window's DC holds.
 *
 * Steps: MS Serif at 13 made and realised in a window's DC; `SERIFE.FON`
 * removed; added again; removed again; the font taken out of the DC; added
 * and removed; the font deleted; added again. Then Wingdings, a TrueType
 * face, likewise; and MS Serif realised in a DC whose mapping is not one
 * to one, then taken out of it.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\FONTDEF.OUT"

static HDC screen;
static HDC held;
static FARPROC familyProc;
static FARPROC faceProc;
static LPSTR out;
static int count;

int FAR PASCAL _export FamilyProc(const ENUMLOGFONT FAR *font, const NEWTEXTMETRIC FAR *metric,
                                  int type, LPARAM data)
{
    out += wsprintf(out, "%s%s", (LPSTR)(out == probeResult ? "" : "|"),
                    (LPSTR)font->elfLogFont.lfFaceName);
    (void)metric;
    (void)type;
    (void)data;
    return 1;
}

int FAR PASCAL _export FaceProc(const LOGFONT FAR *font, const TEXTMETRIC FAR *metric, int type,
                                LPARAM data)
{
    count++;
    out += wsprintf(out, " %d", metric->tmHeight);
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

static HFONT make(LPCSTR name, int height, BYTE charSet)
{
    return CreateFont(height, 0, 0, 0, FW_NORMAL, 0, 0, 0, charSet, OUT_DEFAULT_PRECIS,
                      CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY, DEFAULT_PITCH, name);
}

static void face(LPCSTR when, LPCSTR name, int height, BYTE charSet)
{
    HFONT font = make(name, height, charSet);
    HFONT previous = (HFONT)SelectObject(screen, font);
    TEXTMETRIC metric;
    char got[LF_FACESIZE];

    GetTextFace(screen, sizeof(got), got);
    GetTextMetrics(screen, &metric);
    wsprintf(probeArgs, "%s,%s,%d", when, name, height);
    wsprintf(probeResult, "%s,%d", (LPSTR)got, metric.tmHeight);
    probe("face", probeArgs, probeResult);
    SelectObject(screen, previous);
    DeleteObject(font);
}

static void holding(LPCSTR when, HDC dc)
{
    TEXTMETRIC metric;
    char got[LF_FACESIZE];

    GetTextFace(dc, sizeof(got), got);
    GetTextMetrics(dc, &metric);
    wsprintf(probeResult, "%s,%d", (LPSTR)got, metric.tmHeight);
    probe("held", when, probeResult);
}

static int add(LPCSTR file)
{
    int answer = AddFontResource(file);

    wsprintf(probeResult, "%d", answer);
    probe("add", file, probeResult);
    return answer;
}

static BOOL remove(LPCSTR file)
{
    BOOL answer = RemoveFontResource(file);

    wsprintf(probeResult, "%d", answer);
    probe("remove", file, probeResult);
    return answer;
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS wc;
    HWND window;
    HFONT font;
    HFONT stock;

    probeOpen(OUTPUT);

    memset(&wc, 0, sizeof(wc));
    wc.lpfnWndProc = DefWindowProc;
    wc.hInstance = instance;
    wc.lpszClassName = "FontDef";
    RegisterClass(&wc);
    window = CreateWindow("FontDef", "FontDef", WS_OVERLAPPEDWINDOW, 0, 0, 100, 100, NULL, NULL,
                          instance, NULL);

    screen = GetDC(NULL);
    held = GetDC(window);
    familyProc = MakeProcInstance((FARPROC)FamilyProc, instance);
    faceProc = MakeProcInstance((FARPROC)FaceProc, instance);
    stock = (HFONT)GetStockObject(SYSTEM_FONT);

    families("start");
    faces("start", "MS Serif");

    probeNote("MS Serif at 13 realised in a window's DC, then SERIFE.FON removed");
    font = make("MS Serif", 13, ANSI_CHARSET);
    SelectObject(held, font);
    holding("realised", held);
    remove("SERIFE.FON");
    families("removed");
    faces("removed", "MS Serif");
    holding("removed", held);
    face("removed", "MS Serif", 13, ANSI_CHARSET);
    SelectObject(screen, font);
    holding("removed-screen", screen);
    SelectObject(screen, stock);
    remove("SERIFE.FON");

    probeNote("added again while its font is realised");
    add("SERIFE.FON");
    families("again");
    faces("again", "MS Serif");
    face("again", "MS Serif", 13, ANSI_CHARSET);
    remove("SERIFE.FON");
    families("removed-2");

    probeNote("the font taken out of the DC, not deleted");
    SelectObject(held, stock);
    holding("deselected", held);
    families("deselected");
    add("SERIFE.FON");
    families("deselected-again");
    remove("SERIFE.FON");

    probeNote("the font deleted");
    DeleteObject(font);
    families("deleted");
    faces("deleted", "MS Serif");
    face("deleted", "MS Serif", 13, ANSI_CHARSET);
    add("SERIFE.FON");
    families("deleted-again");
    faces("deleted-again", "MS Serif");

    probeNote("Wingdings realised in the window's DC, then WINGDING.FOT removed");
    font = make("Wingdings", 20, SYMBOL_CHARSET);
    SelectObject(held, font);
    holding("wingding", held);
    remove("WINGDING.FOT");
    families("wingding removed");
    holding("wingding removed", held);
    face("wingding removed", "Wingdings", 20, SYMBOL_CHARSET);
    remove("WINGDING.FOT");
    add("WINGDING.FOT");
    families("wingding again");
    SelectObject(held, stock);
    DeleteObject(font);
    face("wingding deleted", "Wingdings", 20, SYMBOL_CHARSET);

    probeNote("MS Serif realised in a DC mapping two units to a pixel, then taken out of it");
    SetMapMode(held, MM_ANISOTROPIC);
    SetWindowExt(held, 2, 2);
    SetViewportExt(held, 1, 1);
    font = make("MS Serif", 26, ANSI_CHARSET);
    SelectObject(held, font);
    holding("scaled", held);
    remove("SERIFE.FON");
    families("scaled removed");
    SelectObject(held, stock);
    add("SERIFE.FON");
    families("scaled again");
    remove("SERIFE.FON");
    DeleteObject(font);
    SetMapMode(held, MM_TEXT);
    add("SERIFE.FON");
    families("end");

    ReleaseDC(window, held);
    ReleaseDC(NULL, screen);
    DestroyWindow(window);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
