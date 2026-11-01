/*
 * GDI's `EngineExtTextOut` in the two places `prttxt` does not reach, with
 * `prttxt`'s driver (`prttx2.dll.c`, `PRTTX2D`), which logs every `Output`'s
 * points, every `BitBlt` and every `StrBlt`.
 *
 * * A turned string on an opaque background, drawn by GDI itself for the
 *   driver (seg1 `3a1a`, into `6223`): the background is a polygon of the
 *   turned box GDI fills first (`63ea`-`64be`), and the opaque rectangle,
 *   given, a pattern blit.
 * * A driver without `RC_GDI20_OUTPUT`, the device "Plain": its own
 *   `DrawDirect` hands the engine a string, and GDI draws it with the
 *   driver's `StrBlt` a character at a time (seg8 `00e4`).
 *
 * Records as `prttxt`'s: `output`, `bitblt`, `strblt` and `direct`, the
 * last the engine's answer to `DrawDirect`.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\PRTTX2.OUT"
#define LOG "C:\\ORACLE\\PRTTX2.LOG"
#define LIBRARY "C:\\WINDOWS\\PRTTX2D.DLL"
#define DRIVER_FILE "C:\\WINDOWS\\PRTTX2D.DRV"
#define DRIVER "PRTTX2D"

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

typedef void(FAR PASCAL *DIRECTPROC)(LPSTR, int, int, WORD, LPRECT, LPSTR, int, WORD);

/* A turned font, its strings drawn on an opaque background by GDI. */
static void turned(HDC dc, LPSTR name, int escapement)
{
    static RECT opaque = {4, 4, 100, 50};
    HFONT made = CreateFont(-24, 0, escapement, escapement, 400, 0, 0, 0, ANSI_CHARSET,
                            OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY,
                            DEFAULT_PITCH, "Arial");
    HFONT old = SelectObject(dc, made);

    probeNote(name);

    clearBand();
    SetBkMode(dc, OPAQUE);
    TextOut(dc, 30, 40, "Ab", 2);
    probe("textout opaque", name, "Ab");
    drained();

    clearBand();
    ExtTextOut(dc, 30, 40, ETO_OPAQUE, &opaque, "Ab", 2, NULL);
    probe("exttextout opaque", name, "Ab");
    drained();

    SetBkMode(dc, TRANSPARENT);
    SelectObject(dc, old);
    DeleteObject(made);
    drained();
}

/* The engine drawing for the device without RC_GDI20_OUTPUT. */
static void plain(HDC dc, LPSTR name, int escapement)
{
    static RECT opaque = {4, 4, 100, 50};
    static RECT small = {12, 8, 40, 30};
    TEXTMETRIC metrics;
    HMODULE module = GetModuleHandle(DRIVER);
    DIRECTPROC direct = (DIRECTPROC)GetProcAddress(module, "DRAWDIRECT");
    HFONT made = CreateFont(-24, 0, escapement, escapement, 400, 0, 0, 0, ANSI_CHARSET,
                            OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY,
                            DEFAULT_PITCH, "Arial");
    HFONT old = SelectObject(dc, made);

    probeNote(name);
    GetTextMetrics(dc, &metrics);
    drained();

    if (direct) {
        direct(name, 10, 10, 0, NULL, "xAy", 3, TRANSPARENT);
        drained();
        direct(name, 10, 10, ETO_OPAQUE, &opaque, "xAy", 3, OPAQUE);
        drained();
        direct(name, 10, 10, ETO_CLIPPED, &small, "xAy", 3, TRANSPARENT);
        drained();
        direct(name, 10, 10, 0, NULL, "Ab", 2, OPAQUE);
        drained();
        direct(name, 10, 10, ETO_OPAQUE, &opaque, "", 0, OPAQUE);
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
            turned(dc, "Arial turned", 900);
            turned(dc, "Arial 30", 300);
        }

        wsprintf(probeResult, "%d", DeleteDC(dc));
        probe("call", "DeleteDC", probeResult);
        drained();
    }

    dc = CreateDC(DRIVER, "Plain", "LPT1:", NULL);
    wsprintf(probeResult, "%d", dc != NULL);
    probe("call", "CreateDC Plain", probeResult);
    drained();

    if (dc) {
        module = GetModuleHandle(DRIVER);
        setContext = (CONTEXTPROC)GetProcAddress(module, "SETCONTEXT");

        if (setContext) {
            setContext(dc);
            plain(dc, "Plain Arial", 0);
            plain(dc, "Plain Arial turned", 900);
        }

        wsprintf(probeResult, "%d", DeleteDC(dc));
        probe("call", "DeleteDC Plain", probeResult);
        drained();
    }

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
