/*
 * GDI's TrueType engine as a printer's driver puts it to work, seen from a
 * driver of the probe's own (`prtteng.dll.c`), which realizes every font
 * through `EngineRealizeFont`, answers widths with `EngineGetCharWidth`
 * and extents with `EngineExtTextOut`, and, asked, puts the font it
 * realized last to `EngineSetFontContext`, `EngineGetGlyphBmp`,
 * `EngineGetCharWidth` and `GetPhysicalFontHandle`, logging what each
 * answers.
 *
 * Fonts: Arial at an em of 40 dots, Wingdings, Wingdings slanted by GDI
 * (it has no italic file), and Arial turned 90 degrees, at 300 dots an
 * inch.
 *
 * * `realize`, `fields`, `charwidth`, `extent`, `drawn`, and each engine
 *   export's name: what the driver logged, as it logged it.
 * * `widths`, `textextent`: the program's own `GetCharWidth` and
 *   `GetTextExtent` on the context, plain and with a character extra.
 * * `EngineMakeFontDir`: its answer and the bytes it wrote, of Arial's and
 *   Wingdings' files, hidden and not.
 * * `ConvertOutlineFontFile`: whether it answers nought, and the same
 *   twice.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\PRTTENG.OUT"
#define LOG "C:\\ORACLE\\PRTTENG.LOG"
#define LIBRARY "C:\\WINDOWS\\PRTTENGD.DLL"
#define DRIVER_FILE "C:\\WINDOWS\\PRTTENGD.DRV"
#define DRIVER "PRTTENGD"

DWORD FAR PASCAL EngineMakeFontDir(HDC, LPVOID, LPCSTR);
WORD FAR PASCAL ConvertOutlineFontFile(LPCSTR, LPCSTR, LPCSTR);

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

/* Each line of the driver's log so far as a record, the log emptied
 * after: its function, arguments and result apart by tabs. */
static void drained(void)
{
    OFSTRUCT info;
    HFILE file = OpenFile(LOG, &info, OF_READ);
    static char line[700];
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

typedef void(FAR PASCAL *CONTEXTPROC)(HDC);
typedef void(FAR PASCAL *EXERCISEPROC)(HDC, LPSTR);

static void measure(HDC dc, LPSTR name)
{
    int widths[8];
    int i;
    DWORD extent;
    LPSTR at;

    for (i = 0; i < 8; i++) {
        widths[i] = -1;
    }

    wsprintf(probeResult, "%d", GetCharWidth(dc, 'a', 'h', widths));
    at = probeResult + lstrlen(probeResult);

    for (i = 0; i < 8; i++) {
        wsprintf(at, " %d", widths[i]);
        at += lstrlen(at);
    }

    probe("widths", name, probeResult);
    drained();

    extent = GetTextExtent(dc, "abcdefgh", 8);
    wsprintf(probeResult, "%u,%u", LOWORD(extent), HIWORD(extent));
    probe("textextent", name, probeResult);
    drained();

    extent = GetTextExtent(dc, "A\005B", 3);
    wsprintf(probeArgs, "%s low", name);
    wsprintf(probeResult, "%u,%u", LOWORD(extent), HIWORD(extent));
    probe("textextent", probeArgs, probeResult);
    drained();

    SetTextCharacterExtra(dc, 3);
    extent = GetTextExtent(dc, "abcdefgh", 8);
    wsprintf(probeArgs, "%s extra", name);
    wsprintf(probeResult, "%u,%u", LOWORD(extent), HIWORD(extent));
    probe("textextent", probeArgs, probeResult);
    SetTextCharacterExtra(dc, 0);
    drained();
}

static void font(HDC dc, LPSTR name, LPSTR face, int escapement, BYTE italic, BYTE charset)
{
    HMODULE module = GetModuleHandle(DRIVER);
    EXERCISEPROC exercise = (EXERCISEPROC)GetProcAddress(module, "EXERCISE");
    TEXTMETRIC metrics;
    HFONT made = CreateFont(-40, 0, escapement, escapement, 400, italic, 0, 0, charset,
                            OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY,
                            DEFAULT_PITCH, face);
    HFONT old = SelectObject(dc, made);

    probeNote(name);
    GetTextMetrics(dc, &metrics);
    wsprintf(probeResult, "%d %d %d", metrics.tmHeight, metrics.tmAscent, metrics.tmAveCharWidth);
    probe("metrics", name, probeResult);
    drained();

    measure(dc, name);

    if (exercise) {
        exercise(dc, name);
    }

    drained();

    TextOut(dc, 10, 10, "Ab", 2);
    drained();

    SelectObject(dc, old);
    DeleteObject(made);
    drained();
}

static unsigned char directory[256];

static void fontDir(LPSTR file, BOOL hidden)
{
    DWORD answer;
    int i;
    LPSTR at;

    for (i = 0; i < sizeof(directory); i++) {
        directory[i] = 0x55;
    }

    answer = EngineMakeFontDir((HDC)hidden, directory, file);
    wsprintf(probeArgs, "%s %d", file, hidden);
    wsprintf(probeResult, "%ld", answer);
    at = probeResult + lstrlen(probeResult);

    for (i = 0; i < (int)answer && i < 160; i++) {
        wsprintf(at, "%s%02X", (LPSTR)(i ? "" : " "), directory[i]);
        at += 2 + (i ? 0 : 1);
    }

    wsprintf(at, " then %02X", directory[(int)answer < 255 && (int)answer > 0 ? (int)answer : 255]);
    probe("EngineMakeFontDir", probeArgs, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    OFSTRUCT info;
    HDC dc;
    HMODULE module;
    CONTEXTPROC setContext;
    WORD first;
    WORD second;

    probeOpen(OUTPUT);
    OpenFile(LOG, &info, OF_DELETE);
    install();

    dc = CreateDC(DRIVER, "Probe", "LPT1:", NULL);
    wsprintf(probeResult, "%d", dc != NULL);
    probe("call", "CreateDC", probeResult);
    drained();

    if (dc) {
        module = GetModuleHandle(DRIVER);
        setContext = (CONTEXTPROC)GetProcAddress(module, "SETCONTEXT");

        if (setContext) {
            setContext(dc);
        }

        font(dc, "Arial", "Arial", 0, 0, ANSI_CHARSET);
        font(dc, "Wingdings", "Wingdings", 0, 0, SYMBOL_CHARSET);
        font(dc, "Wingdings slanted", "Wingdings", 0, 1, SYMBOL_CHARSET);
        font(dc, "Arial turned", "Arial", 900, 0, ANSI_CHARSET);

        wsprintf(probeResult, "%d", DeleteDC(dc));
        probe("call", "DeleteDC", probeResult);
        drained();
    }

    fontDir("C:\\WINDOWS\\SYSTEM\\ARIAL.TTF", TRUE);
    fontDir("C:\\WINDOWS\\SYSTEM\\ARIAL.TTF", FALSE);
    fontDir("C:\\WINDOWS\\SYSTEM\\WINGDING.TTF", TRUE);
    fontDir("C:\\WINDOWS\\SYSTEM\\NOSUCH.TTF", TRUE);

    first = ConvertOutlineFontFile(NULL, NULL, NULL);
    second = ConvertOutlineFontFile("C:\\WINDOWS\\SYSTEM\\ARIAL.TTF", NULL, NULL);
    wsprintf(probeResult, "%s %s", (LPSTR)(first ? "some" : "nought"),
             (LPSTR)(first == second ? "same" : "other"));
    probe("ConvertOutlineFontFile", "twice", probeResult);

    probeFinish();
    return 0;
}
