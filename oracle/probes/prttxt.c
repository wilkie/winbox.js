/*
 * GDI's `EngineExtTextOut` drawing a string of a TrueType font onto a
 * printer driver's device: a driver of the probe's own, `PRTTXTD`
 * (`prttxt.dll.c`), whose fonts are GDI's TrueType ones, hands each string
 * to the engine and logs what GDI calls back with, drawing it on a band of
 * its own with `DMExtTextOut`. The probe reads the driver's log back as its
 * records.
 *
 * * `engine`: the engine's answer, for the driver's own font.
 * * `drawn`: what GDI hands the driver's `ExtTextOut` then -- the place,
 *   the count, the options, the clip, the `DRAWMODE` and `TEXTXFORM`, the
 *   widths and the opaque rectangle.
 * * `font`, `glyph`: the font GDI hands it, its header and each of the
 *   string's characters: width, whether its glyph is there, the glyph's sum.
 * * `dmexttextout`, `band`, `bandrows`: `DMExtTextOut`'s answer on the
 *   band, and the band after, a monochrome bitmap 128 by 64.
 * * `output`, `bitblt`, `pixel`, `strblt`: any of those GDI asks.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\PRTTXT.OUT"
#define LOG "C:\\ORACLE\\PRTTXT.LOG"
#define LIBRARY "C:\\WINDOWS\\PRTTXTD.DLL"
#define DRIVER_FILE "C:\\WINDOWS\\PRTTXTD.DRV"
#define DRIVER "PRTTXTD"

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
    static char line[1500];
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
typedef void(FAR PASCAL *CLEARPROC)(void);

static CLEARPROC clearBand;

/* A font of a face at a height, turned and slanted as asked, and strings
 * drawn in it. */
static void font(HDC dc, LPSTR name, LPSTR face, int height, int escapement, BYTE italic,
                 BYTE charset, int weight)
{
    static int widths[] = {30, 25, 20};
    static RECT opaque = {4, 4, 100, 50};
    HFONT made = CreateFont(height, 0, escapement, escapement, weight, italic, 0, 0, charset,
                            OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY,
                            DEFAULT_PITCH, face);
    HFONT old = SelectObject(dc, made);

    probeNote(name);

    clearBand();
    SetBkMode(dc, TRANSPARENT);
    TextOut(dc, 10, 10, "Ab", 2);
    probe("textout", name, "Ab");
    drained();

    if (!escapement) {
        clearBand();
        SetBkMode(dc, OPAQUE);
        ExtTextOut(dc, 8, 6, ETO_OPAQUE, &opaque, "xAy", 3, widths);
        probe("exttextout", name, "xAy");
        drained();

        clearBand();
        SetBkMode(dc, TRANSPARENT);
        SetTextCharacterExtra(dc, 2);
        TextOut(dc, 2, 30, "Wing", 4);
        SetTextCharacterExtra(dc, 0);
        probe("textout extra", name, "Wing");
        drained();
    }

    SelectObject(dc, old);
    DeleteObject(made);
    drained();
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    OFSTRUCT info;
    HDC dc;
    HMODULE module;
    CONTEXTPROC setContext;

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
        clearBand = (CLEARPROC)GetProcAddress(module, "CLEARBAND");

        if (setContext && clearBand) {
            setContext(dc);
            font(dc, "Arial", "Arial", -24, 0, 0, ANSI_CHARSET, 400);
            font(dc, "Arial bold", "Arial", -18, 0, 0, ANSI_CHARSET, 700);
            font(dc, "Wingdings slanted", "Wingdings", -20, 0, 1, SYMBOL_CHARSET, 400);
            font(dc, "Arial turned", "Arial", -24, 900, 0, ANSI_CHARSET, 400);
            font(dc, "Arial 45", "Arial", -24, 450, 0, ANSI_CHARSET, 400);
        }

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
