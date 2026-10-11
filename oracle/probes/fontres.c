/*
 * fontres -- fonts added and removed: AddFontResource and RemoveFontResource.
 *
 * Control Panel's Fonts adds the font it shows the sample of, and installs a
 * font with `AddFontResource` before writing it into `WIN.INI` `[fonts]`;
 * removing one, it calls `RemoveFontResource` with what `[fonts]` says. GDI
 * keeps a table of the files added, each with a count of its adds
 * (`GDI.EXE` seg2 `0beb`), and the faces of each, which `EnumFonts` and
 * `EnumFontFamilies` walk.
 *
 * Records, each a call and what it answered, and after each step what the
 * enumeration sees:
 *
 * * `add`, `remove`: the file and the answer.
 * * `families`: every family `EnumFontFamilies` hands out, in order.
 * * `faces`: how many fonts `EnumFonts` hands out for a face, and their
 *   heights.
 * * `face`: what a font made by name maps to, `GetTextFace` and its height.
 * * `fontchange`: how many `WM_FONTCHANGE` a top-level window was sent.
 *
 * Steps: a raster file that is not installed, added twice and removed three
 * times; one by its bare name; one by its module's handle; a `.FOT` made
 * for an installed TrueType face, which names the same face; an installed
 * `.FOT` removed and added again; an installed raster file removed and added
 * again; and files that are no fonts.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\FONTRES.OUT"

static HDC screen;
static FARPROC familyProc;
static FARPROC faceProc;
static LPSTR out;
static int count;
static int fontChanges;

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

LRESULT FAR PASCAL _export WindowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_FONTCHANGE) {
        fontChanges++;
    }

    return DefWindowProc(window, message, wParam, lParam);
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

static void face(LPCSTR when, LPCSTR name, int height)
{
    HFONT font = CreateFont(height, 0, 0, 0, FW_NORMAL, 0, 0, 0, ANSI_CHARSET,
                            OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY,
                            DEFAULT_PITCH, name);
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
    HINSTANCE library;
    MSG msg;
    int answer;

    probeOpen(OUTPUT);

    memset(&wc, 0, sizeof(wc));
    wc.lpfnWndProc = WindowProc;
    wc.hInstance = instance;
    wc.lpszClassName = "FontRes";
    RegisterClass(&wc);
    window = CreateWindow("FontRes", "FontRes", WS_OVERLAPPEDWINDOW, 0, 0, 100, 100, NULL, NULL,
                          instance, NULL);

    screen = GetDC(NULL);
    familyProc = MakeProcInstance((FARPROC)FamilyProc, instance);
    faceProc = MakeProcInstance((FARPROC)FaceProc, instance);

    families("start");
    faces("start", "Terminal");

    probeNote("a raster file not installed: added twice, removed three times");
    add("C:\\WINDOWS\\SYSTEM\\EGA80WOA.FON");
    families("added");
    faces("added", "Terminal");
    add("C:\\WINDOWS\\SYSTEM\\EGA80WOA.FON");
    faces("twice", "Terminal");
    remove("C:\\WINDOWS\\SYSTEM\\EGA80WOA.FON");
    faces("removed once", "Terminal");
    remove("C:\\WINDOWS\\SYSTEM\\EGA80WOA.FON");
    families("removed twice");
    faces("removed twice", "Terminal");
    remove("C:\\WINDOWS\\SYSTEM\\EGA80WOA.FON");

    probeNote("by its bare name, and removed by it");
    add("CGA40WOA.FON");
    faces("bare", "Terminal");
    remove("CGA40WOA.FON");
    faces("bare removed", "Terminal");

    probeNote("by a module's handle");
    library = LoadLibrary("C:\\WINDOWS\\SYSTEM\\CGA80WOA.FON");
    wsprintf(probeResult, "%s", (LPSTR)(library > HINSTANCE_ERROR ? "loaded" : "failed"));
    probe("LoadLibrary", "CGA80WOA.FON", probeResult);
    answer = AddFontResource((LPCSTR)MAKELP(0, library));
    wsprintf(probeResult, "%d", answer);
    probe("add", "handle", probeResult);
    faces("handle", "Terminal");
    answer = RemoveFontResource((LPCSTR)MAKELP(0, library));
    wsprintf(probeResult, "%d", answer);
    probe("remove", "handle", probeResult);
    faces("handle removed", "Terminal");
    FreeLibrary(library);

    probeNote("a .FOT made for Wingdings, which names the same face");
    OpenFile("C:\\ORACLE\\WD2.FOT", (OFSTRUCT *)probeResult, OF_DELETE);
    answer = CreateScalableFontResource(0, "C:\\ORACLE\\WD2.FOT", "WINGDING.TTF",
                                        "C:\\WINDOWS\\SYSTEM");
    wsprintf(probeResult, "%d", answer);
    probe("CreateScalableFontResource", "WD2.FOT", probeResult);
    add("C:\\ORACLE\\WD2.FOT");
    families("wd2");
    remove("C:\\ORACLE\\WD2.FOT");
    families("wd2 removed");

    probeNote("an installed .FOT removed, then added again");
    remove("WINGDING.FOT");
    families("wingding removed");
    remove("WINGDING.FOT");
    face("wingding removed", "Wingdings", 20);
    add("WINGDING.FOT");
    families("wingding again");
    face("wingding again", "Wingdings", 20);

    probeNote("an installed raster file removed, then added again");
    remove("SERIFE.FON");
    families("serife removed");
    faces("serife removed", "MS Serif");
    face("serife removed", "MS Serif", 13);
    add("SERIFE.FON");
    families("serife again");
    faces("serife again", "MS Serif");
    face("serife again", "MS Serif", 13);

    probeNote("files that are no fonts, each followed by what the enumeration sees");
    add("C:\\NOFILE.FON");
    faces("nofile", "Terminal");
    add("C:\\WINDOWS\\WIN.INI");
    faces("win.ini", "Terminal");
    add("C:\\WINDOWS\\SYSTEM\\ARIAL.TTF");
    faces("arial.ttf", "Terminal");
    add("C:\\WINDOWS\\SYSTEM\\VER.DLL");
    faces("ver.dll", "Terminal");
    add("C:\\WINDOWS\\SYSTEM\\SOUND.DRV");
    faces("sound.drv", "Terminal");
    remove("C:\\NOFILE.FON");
    remove("C:\\WINDOWS\\SYSTEM\\EGA40WOA.FON");
    remove("C:\\WINDOWS\\WIN.INI");
    families("end");

    while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
        DispatchMessage(&msg);
    }

    wsprintf(probeResult, "%d", fontChanges);
    probe("fontchange", "", probeResult);

    ReleaseDC(NULL, screen);
    DestroyWindow(window);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
