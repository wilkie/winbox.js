/*
 * GDI's `EngineExtTextOut` in two things `prttxt` and `prttx2` do not
 * reach, with a driver of the probe's own (`prttstk.dll.c`) whose module is
 * named `MGXWMF` and which logs the count, place and widths of every string
 * GDI hands back to its `ExtTextOut`.
 *
 * * The count cut to what GDI's stack holds (seg1 `62a5`-`62c0`): the
 *   driver's `DrawLimited` puts the task's stack limit, the word at 0Ah of
 *   the stack's segment, so many bytes below its stack pointer for the
 *   call, a margin a byte at a time across where the count is cut.
 * * The context's flag 40h at 0Bh (seg1 `62d0`), which `CreateDC` sets
 *   where the driver is named by the atom of `MGXWMF.DRV` (seg1
 *   `0249`-`024f`; seg2 `0254`-`0259`): the same driver, loaded as
 *   `C:\WINDOWS\MGXWMF.DRV`, made a context of once as `MGXWMF` and once as
 *   `MGXWMF.DRV`, each given `jAWj` to draw.
 * * `DMExtTextOut`'s emboldening taken off where the `GDIINFO` GDI last
 *   drew text for has no `TC_EA_DOUBLE` (seg13 `0011`-`0072`).
 *
 * Records: `limited` and `direct`, the engine's answer to the driver's own
 * call; `drawn`, GDI's call back; `emboldened`, the band
 * `DMExtTextOut` drew; and the probe's own calls.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\PRTTSTK.OUT"
#define LOG "C:\\ORACLE\\PRTTSTK.LOG"
#define LIBRARY "C:\\WINDOWS\\PRTTSTKD.DLL"
#define DRIVER_FILE "C:\\WINDOWS\\MGXWMF.DRV"

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

typedef void(FAR PASCAL *CONTEXTPROC)(HDC);
typedef void(FAR PASCAL *DIRECTPROC)(LPSTR, int, int, LPSTR, int);
typedef void(FAR PASCAL *LIMITEDPROC)(WORD, LPSTR, int);
typedef void(FAR PASCAL *EMBOLDENEDPROC)(LPSTR, WORD, WORD, BYTE);

static HINSTANCE library;

/*
 * `DMExtTextOut` asked by the driver for an emboldened string, after text
 * drawn on a memory context of the display's and after text drawn on the
 * driver's context: GDI's `[063Eh]`, the `GDIINFO` of the context it last
 * drew text for (seg1 `31d8`), the display's or the driver's, whose
 * `dpText` has no `TC_EA_DOUBLE`. Then after the extent of a TrueType
 * string on the driver's context (seg1 `3cb4`, which passes `3bd8` by), and
 * after a font realized for the driver (seg3 `20c4`).
 */
static void emboldenedAfter(HDC dc)
{
    EMBOLDENEDPROC emboldened = (EMBOLDENEDPROC)GetProcAddress(library, "EMBOLDENED");
    HDC memory = CreateCompatibleDC(NULL);
    TEXTMETRIC metrics;
    HFONT made;
    HFONT old;

    if (!emboldened || !memory) {
        return;
    }

    TextOut(memory, 0, 0, "x", 1);
    emboldened("display", 700, 0x200, 0);
    emboldened("display", 700, 0, 0);
    emboldened("display", 400, 0, 0);
    drained();

    TextOut(dc, 10, 10, "AW", 2);
    drained();
    emboldened("printer", 700, 0x200, 0);
    emboldened("printer", 700, 0, 0);
    emboldened("printer", 700, 0x600, 1);
    drained();

    TextOut(memory, 0, 0, "x", 1);
    GetTextExtent(dc, "AW", 2);
    emboldened("extent", 700, 0x200, 0);
    drained();

    TextOut(memory, 0, 0, "x", 1);
    made = CreateFont(-20, 0, 0, 0, 400, 0, 0, 0, ANSI_CHARSET, OUT_DEFAULT_PRECIS,
                      CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY, DEFAULT_PITCH, "Arial");
    old = SelectObject(dc, made);
    GetTextMetrics(dc, &metrics);
    emboldened("realized", 700, 0x200, 0);
    drained();
    SelectObject(dc, old);
    DeleteObject(made);
    DeleteDC(memory);
    drained();
}

/* A context on the driver by the name given, Arial at an em of 24
 * realized in it, and `jAWj` drawn; then the margins, where asked. */
static void drawnOn(LPSTR driver, BOOL margins)
{
    CONTEXTPROC setContext = (CONTEXTPROC)GetProcAddress(library, "SETCONTEXT");
    DIRECTPROC direct = (DIRECTPROC)GetProcAddress(library, "DRAWDIRECT");
    LIMITEDPROC limited = (LIMITEDPROC)GetProcAddress(library, "DRAWLIMITED");
    HDC dc = CreateDC(driver, "Probe", "LPT1:", NULL);
    TEXTMETRIC metrics;
    HFONT made;
    HFONT old;
    WORD margin;

    wsprintf(probeResult, "%d", dc != NULL);
    probe("CreateDC", driver, probeResult);
    drained();

    if (!dc || !setContext || !direct || !limited) {
        return;
    }

    setContext(dc);
    made = CreateFont(-24, 0, 0, 0, 400, 0, 0, 0, ANSI_CHARSET, OUT_DEFAULT_PRECIS,
                      CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY, DEFAULT_PITCH, "Arial");
    old = SelectObject(dc, made);
    GetTextMetrics(dc, &metrics);
    drained();

    direct(driver, 10, 10, "jAWj", 4);
    drained();
    direct(driver, 30, 20, "fiji", 4);
    drained();

    if (margins) {
        limited(0x200, "abcdefghijklmnop", 16);
        drained();

        for (margin = 0x4e0; margin < 0x560; margin++) {
            limited(margin, "abcdefghijklmnop", 16);
            drained();
        }

        limited(0x2000, "abcdefghijklmnop", 16);
        drained();

        emboldenedAfter(dc);
    }

    SelectObject(dc, old);
    DeleteObject(made);
    wsprintf(probeResult, "%d", DeleteDC(dc));
    probe("DeleteDC", driver, probeResult);
    drained();
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    OFSTRUCT info;

    probeOpen(OUTPUT);
    OpenFile(LOG, &info, OF_DELETE);
    install();

    library = LoadLibrary(DRIVER_FILE);
    wsprintf(probeResult, "%d", library >= (HINSTANCE)32);
    probe("LoadLibrary", DRIVER_FILE, probeResult);

    if (library >= (HINSTANCE)32) {
        drawnOn("MGXWMF", TRUE);
        drawnOn("MGXWMF.DRV", FALSE);
        drawnOn("mgxwmf.drv", FALSE);
        FreeLibrary(library);
    }

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
