/*
 * What GDI lets go of as a printer's context is deleted, and in what order,
 * seen from a driver of the probe's own (`prdrv.dll.c`), which logs each
 * call GDI makes to it and, at its `Disable`, as it is freed (`WEP`) and
 * when the probe asks (`Report`), whether each font it realized is still
 * there.
 *
 * * A context on a device of its own, with a font of the program's
 *   realized and deleted, and the default font realized as it was made.
 * * Two contexts sharing a device, the first deleted, then the second.
 * * Two contexts each on a device of its own, deleted in turn.
 *
 * * `call`: each call's answer.
 * * `driver`: each line of the driver's log, as it was written.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\PRDRV.OUT"
#define LOG "C:\\ORACLE\\PRDRV.LOG"
#define LIBRARY "C:\\WINDOWS\\PRDRVD.DLL"
#define DRIVER_FILE "C:\\WINDOWS\\PRDRVD.DRV"
#define DRIVER "PRDRVD"

static void exact(LPCSTR name, long answer)
{
    wsprintf(probeResult, "%ld", answer);
    probe("call", name, probeResult);
}

static char chunk[4096];

/* The driver's file, as GDI looks for it: its name and `.DRV`. */
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

static int lineCount;

/* Each line of the driver's log so far, the log emptied after. */
static void drained(void)
{
    OFSTRUCT info;
    HFILE file = OpenFile(LOG, &info, OF_READ);
    char line[400];
    int length = 0;
    int read;
    int at;

    if (file == HFILE_ERROR) {
        return;
    }

    while ((read = _lread(file, chunk, sizeof(chunk))) > 0) {
        for (at = 0; at < read; at++) {
            if (chunk[at] == '\n') {
                if (length > 0 && line[length - 1] == '\r') {
                    length--;
                }

                line[length] = '\0';
                wsprintf(probeArgs, "%d", lineCount++);
                probe("driver", probeArgs, line);
                length = 0;
            } else if (length < (int)sizeof(line) - 1) {
                line[length++] = chunk[at];
            }
        }
    }

    _lclose(file);
    OpenFile(LOG, &info, OF_DELETE);
}

typedef void(FAR PASCAL *REPORTPROC)(LPSTR);

/* The driver asked whether its fonts are there, where it is loaded. */
static void report(LPSTR when)
{
    HMODULE module = GetModuleHandle(DRIVER);
    REPORTPROC proc;

    if (!module) {
        probe("call", when, "unloaded");
        return;
    }

    proc = (REPORTPROC)GetProcAddress(module, "REPORT");

    if (proc) {
        proc(when);
    }
}

static HFONT probeFont(void)
{
    return CreateFont(20, 0, 0, 0, FW_NORMAL, 0, 0, 0, ANSI_CHARSET, OUT_DEFAULT_PRECIS,
                      CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY, FIXED_PITCH | FF_MODERN, "Probe");
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    OFSTRUCT info;
    TEXTMETRIC metrics;
    HDC dc;
    HDC other;
    HFONT font;
    HFONT kept;

    probeOpen(OUTPUT);
    OpenFile(LOG, &info, OF_DELETE);
    install();

    /* A context on a device of its own, a font of the program's realized
     * and deleted. */
    probeNote("own");
    dc = CreateDC(DRIVER, "Plain", "LPT1:", NULL);
    exact("CreateDC", dc != NULL);
    drained();

    font = probeFont();
    SelectObject(dc, font);
    exact("GetTextMetrics", GetTextMetrics(dc, &metrics));
    exact("tmHeight", metrics.tmHeight);
    report("realized");
    drained();

    SelectObject(dc, GetStockObject(DEVICE_DEFAULT_FONT));
    exact("DeleteObject", DeleteObject(font));
    report("font deleted");
    drained();

    exact("DeleteDC", DeleteDC(dc));
    report("deleted");
    drained();

    /* A font kept by the program past the context it was realized on. */
    probeNote("kept");
    dc = CreateDC(DRIVER, "Plain", "LPT1:", NULL);
    kept = probeFont();
    SelectObject(dc, kept);
    exact("GetTextMetrics", GetTextMetrics(dc, &metrics));
    SelectObject(dc, GetStockObject(DEVICE_DEFAULT_FONT));
    drained();
    exact("DeleteDC", DeleteDC(dc));
    drained();
    exact("DeleteObject", DeleteObject(kept));
    drained();

    /* Two contexts sharing a device. */
    probeNote("shared");
    dc = CreateDC(DRIVER, "Shared M", "LPT1:", NULL);
    exact("CreateDC first", dc != NULL);
    drained();
    other = CreateDC(DRIVER, "Shared M", "LPT1:", NULL);
    exact("CreateDC second", other != NULL);
    drained();

    font = probeFont();
    SelectObject(dc, font);
    exact("GetTextMetrics first", GetTextMetrics(dc, &metrics));
    drained();
    SelectObject(other, font);
    exact("GetTextMetrics second", GetTextMetrics(other, &metrics));
    report("both realized");
    drained();

    SelectObject(dc, GetStockObject(DEVICE_DEFAULT_FONT));
    exact("DeleteDC first", DeleteDC(dc));
    report("first deleted");
    drained();

    SelectObject(other, GetStockObject(DEVICE_DEFAULT_FONT));
    exact("DeleteDC second", DeleteDC(other));
    drained();
    exact("DeleteObject", DeleteObject(font));
    drained();

    /* Two contexts each on a device of its own. */
    probeNote("two");
    dc = CreateDC(DRIVER, "Plain", "LPT1:", NULL);
    other = CreateDC(DRIVER, "Plain", "LPT1:", NULL);
    exact("CreateDC both", dc != NULL && other != NULL);
    drained();
    exact("DeleteDC first", DeleteDC(dc));
    report("first deleted");
    drained();
    exact("DeleteDC second", DeleteDC(other));
    drained();

    probeFinish();
    return 0;
}
