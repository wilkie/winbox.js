/*
 * GDI's `[063Eh]`, the `GDIINFO` of the context GDI last handled text for,
 * as `GetCharWidth` sets it (`GDI.EXE` seg3 `20c4`): to the context's
 * device information where the device's `dpRaster` has `RC_GDI20_OUTPUT`
 * (10h, `20bd`), before the font is realized. Seen as `prttstk` sees it,
 * through `DMExtTextOut` asked by the driver for an emboldened string
 * (`prttstk.dll.c`, built again as `PRTTCWD.DLL`): the display's `dpText`
 * has `TC_EA_DOUBLE` and the driver's has not, so the string is emboldened
 * where `[063Eh]` is the display's and plain where it is the driver's.
 *
 * Records: `GetCharWidth` with the widths' sum, and `emboldened`, the band
 * `DMExtTextOut` drew, after each.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\PRTTCW.OUT"
#define LOG "C:\\ORACLE\\PRTTSTK.LOG"
#define LIBRARY "C:\\WINDOWS\\PRTTCWD.DLL"
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
typedef void(FAR PASCAL *EMBOLDENEDPROC)(LPSTR, WORD, WORD, BYTE);

static HINSTANCE library;
static EMBOLDENEDPROC emboldened;

/* The widths of `first` to `last` on a context: the answer, their sum and
 * the first. */
static void widths(LPSTR name, HDC dc, WORD first, WORD last)
{
    static int buffer[256];
    int answer;
    long sum = 0;
    int at;

    for (at = 0; at < 256; at++) {
        buffer[at] = 0;
    }

    answer = GetCharWidth(dc, first, last, buffer);

    for (at = 0; at < 256; at++) {
        sum += buffer[at];
    }

    wsprintf(probeArgs, "%s %u %u", name, first, last);
    wsprintf(probeResult, "%d sum=%ld first=%d", answer, sum, buffer[0]);
    probe("GetCharWidth", probeArgs, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    OFSTRUCT info;
    CONTEXTPROC setContext;
    DIRECTPROC direct;
    HDC dc;
    HDC memory;
    HFONT made;
    HFONT other;
    HFONT old;
    HFONT memoryOld;
    TEXTMETRIC metrics;

    probeOpen(OUTPUT);
    OpenFile(LOG, &info, OF_DELETE);
    install();

    library = LoadLibrary(DRIVER_FILE);
    wsprintf(probeResult, "%d", library >= (HINSTANCE)32);
    probe("LoadLibrary", DRIVER_FILE, probeResult);

    if (library < (HINSTANCE)32) {
        probeFinish();
        return 0;
    }

    setContext = (CONTEXTPROC)GetProcAddress(library, "SETCONTEXT");
    direct = (DIRECTPROC)GetProcAddress(library, "DRAWDIRECT");
    emboldened = (EMBOLDENEDPROC)GetProcAddress(library, "EMBOLDENED");
    dc = CreateDC("MGXWMF", "Probe", "LPT1:", NULL);
    memory = CreateCompatibleDC(NULL);
    wsprintf(probeResult, "%d %d", dc != NULL, memory != NULL);
    probe("CreateDC", "MGXWMF", probeResult);
    drained();

    if (!dc || !memory || !setContext || !direct || !emboldened) {
        probeFinish();
        return 0;
    }

    setContext(dc);
    made = CreateFont(-24, 0, 0, 0, 400, 0, 0, 0, ANSI_CHARSET, OUT_DEFAULT_PRECIS,
                      CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY, DEFAULT_PITCH, "Arial");
    old = SelectObject(dc, made);
    GetTextMetrics(dc, &metrics);
    direct("MGXWMF", 10, 10, "AW", 2);
    drained();

    /* The display's, then the driver's after its widths. */
    TextOut(memory, 0, 0, "x", 1);
    emboldened("display", 700, 0x200, 0);
    drained();

    TextOut(memory, 0, 0, "x", 1);
    widths("printer", dc, 'A', 'W');
    emboldened("printer", 700, 0x200, 0);
    emboldened("printer", 700, 0x600, 1);
    drained();

    /* The driver's text, then the display's widths. */
    TextOut(dc, 10, 10, "AW", 2);
    drained();
    widths("memory", memory, 'A', 'W');
    emboldened("memory", 700, 0x200, 0);
    drained();

    /* One character, and the last before the first. */
    TextOut(memory, 0, 0, "x", 1);
    widths("one", dc, 'A', 'A');
    emboldened("one", 700, 0x200, 0);
    drained();

    TextOut(memory, 0, 0, "x", 1);
    widths("reversed", dc, 'W', 'A');
    emboldened("reversed", 700, 0x200, 0);
    drained();

    /* A font not yet realized for the driver: its widths realize it. */
    TextOut(memory, 0, 0, "x", 1);
    other = CreateFont(-30, 0, 0, 0, 700, 1, 0, 0, ANSI_CHARSET, OUT_DEFAULT_PRECIS,
                       CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY, DEFAULT_PITCH, "Times New Roman");
    SelectObject(dc, other);
    widths("unrealized", dc, 'A', 'W');
    drained();
    SelectObject(dc, made);
    emboldened("unrealized", 700, 0x200, 0);
    drained();

    /* The display's stock font, its widths on the memory context after the
     * driver's text. */
    TextOut(dc, 10, 10, "AW", 2);
    drained();
    memoryOld = SelectObject(memory, GetStockObject(ANSI_VAR_FONT));
    widths("memoryvar", memory, 'A', 'W');
    emboldened("memoryvar", 700, 0x200, 0);
    drained();
    SelectObject(memory, memoryOld);

    SelectObject(dc, old);
    DeleteObject(made);
    DeleteObject(other);
    DeleteDC(memory);
    wsprintf(probeResult, "%d", DeleteDC(dc));
    probe("DeleteDC", "MGXWMF", probeResult);
    drained();
    FreeLibrary(library);
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
