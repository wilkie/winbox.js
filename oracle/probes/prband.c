/*
 * Bands: what a program sees of `NEXTBAND`, and what GDI does for a driver
 * that bands. Recorded on the installation with a printer, `vgaprint`.
 *
 * * The PostScript driver, `pscript`, for the Apple LaserWriter Plus,
 *   printing to a file, Print Manager's spooler off: whether it supports
 *   `NEXTBAND` and `BANDINFO`, its `RASTERCAPS`, and a page printed by the
 *   program's own loop of `NEXTBAND`s, a rectangle in each band; then a
 *   page begun with `StartPage`, banded so, and ended with `EndPage`.
 * * A driver of the probe's own (`prband.dll.c`, as `prdrv.dll.c`), which
 *   logs each call GDI makes to it: on a device that does not band, the
 *   program's loop of `NEXTBAND`s; on one that does (`RC_BANDING`), the
 *   program's loop, then pages drawn and ended with `EndPage`, which GDI
 *   bands itself; a page aborted; a context deleted with a page drawn.
 *
 * * `call`: each call's answer; `band`: each band's rectangle, as
 *   `NEXTBAND` gave it, after its answer.
 * * `size`, `line`: the file the PostScript driver wrote, each line from
 *   its first page on.
 * * `driver`: each line of the driver's log, as it was written.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\PRBAND.OUT"
#define PRINTED "C:\\ORACLE\\PRBAND.PRN"
#define LOG "C:\\ORACLE\\PRDRV.LOG"
#define LIBRARY "C:\\WINDOWS\\PRBANDD.DLL"
#define DRIVER_FILE "C:\\WINDOWS\\PRBANDD.DRV"
#define DRIVER "PRBANDD"

static void exact(LPCSTR name, long answer)
{
    wsprintf(probeResult, "%ld", answer);
    probe("call", name, probeResult);
}

static char chunk[4096];
static char line[512];

/* Each line of the PostScript file from its first page on. */
static void lines(void)
{
    OFSTRUCT info;
    HFILE file = OpenFile(PRINTED, &info, OF_READ);
    long size;
    int read;
    int at;
    int length = 0;
    int count = 0;
    BOOL paged = FALSE;

    if (file == HFILE_ERROR) {
        probe("size", "document", "none");
        return;
    }

    size = _llseek(file, 0, 2);
    _llseek(file, 0, 0);
    wsprintf(probeResult, "%ld", size);
    probe("size", "document", probeResult);

    while ((read = _lread(file, chunk, sizeof(chunk))) > 0) {
        for (at = 0; at < read; at++) {
            if (chunk[at] == '\n') {
                if (length > 0 && line[length - 1] == '\r') {
                    length--;
                }

                line[length] = '\0';

                if (!paged && lstrcmp(line, "%%Page: 1 1") == 0) {
                    paged = TRUE;
                }

                if (paged) {
                    wsprintf(probeArgs, "%d", count);
                    probe("line", probeArgs, line);
                }

                count++;
                length = 0;
            } else if (length < 300) {
                line[length++] = chunk[at];
            }
        }
    }

    _lclose(file);
}

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

static int queried(HDC dc, int escape)
{
    return Escape(dc, QUERYESCSUPPORT, sizeof(int), (LPCSTR)&escape, NULL);
}

/*
 * The program's own loop of bands: `NEXTBAND` until it gives an empty
 * rectangle, a figure drawn in each, at most six.
 */
/* The PostScript driver answers `NEXTBAND` and `NEWFRAME` with its job,
 * the handle `OpenJob` gave it: the size of the block it names, shifted
 * back left (as `prdoc.c`). */
static BOOL jobs;

static void answered(LPSTR out, int answer)
{
    if (jobs && answer > 0) {
        wsprintf(out, "job %ld", GlobalSize((HGLOBAL)(answer << 1)));
    } else {
        wsprintf(out, "%d", answer);
    }
}

static void banded(HDC dc, LPCSTR name, int left, int top, int right, int bottom, BOOL drain)
{
    RECT band;
    int answer;
    int i;

    for (i = 0; i < 6; i++) {
        SetRect(&band, -1, -1, -1, -1);
        answer = Escape(dc, NEXTBAND, 0, NULL, &band);
        wsprintf(probeArgs, "%s %d", name, i);
        answered(probeResult, answer);
        wsprintf(probeResult + lstrlen(probeResult), " %d,%d,%d,%d", band.left, band.top,
                 band.right, band.bottom);
        probe("band", probeArgs, probeResult);

        if (answer <= 0 || IsRectEmpty(&band)) {
            break;
        }

        Rectangle(dc, left, top, right, bottom);

        if (drain) {
            drained();
        }
    }
}

static DOCINFO doc = {sizeof(DOCINFO), "Bands", NULL};

static void postscript(void)
{
    OFSTRUCT info;
    HDC dc;

    probeNote("pscript");
    WriteProfileString("windows", "spooler", "no");
    OpenFile(PRINTED, &info, OF_DELETE);

    dc = CreateDC("pscript", "Apple LaserWriter Plus", PRINTED, NULL);
    exact("CreateDC", dc != NULL);
    exact("QUERYESCSUPPORT NEXTBAND", queried(dc, NEXTBAND));
    exact("QUERYESCSUPPORT BANDINFO", queried(dc, BANDINFO));
    exact("RASTERCAPS", GetDeviceCaps(dc, RASTERCAPS));

    exact("StartDoc", StartDoc(dc, &doc));
    jobs = TRUE;
    banded(dc, "pscript", 300, 300, 900, 700, FALSE);
    exact("StartPage", StartPage(dc));
    banded(dc, "pscript page", 400, 400, 1000, 800, FALSE);
    jobs = FALSE;
    exact("EndPage", EndPage(dc));
    exact("EndDoc", EndDoc(dc));
    exact("DeleteDC", DeleteDC(dc));

    WriteProfileString("windows", "spooler", "yes");
    lines();
}

static void driver(void)
{
    OFSTRUCT info;
    POINT at;
    DWORD position;
    HDC dc;

    install();
    OpenFile(LOG, &info, OF_DELETE);

    /* A device that does not band: `NEXTBAND` is the driver's. */
    probeNote("plain");
    dc = CreateDC(DRIVER, "Plain", "LPT1:", NULL);
    exact("CreateDC", dc != NULL);
    exact("RASTERCAPS", GetDeviceCaps(dc, RASTERCAPS));
    exact("StartDoc", StartDoc(dc, &doc));
    drained();
    banded(dc, "plain", 10, 10, 50, 40, TRUE);
    exact("StartPage", StartPage(dc));
    banded(dc, "plain page", 10, 10, 50, 40, TRUE);
    exact("EndPage", EndPage(dc));
    exact("EndDoc", EndDoc(dc));
    exact("DeleteDC", DeleteDC(dc));
    drained();

    /* A device that bands, banded by the program. */
    probeNote("band");
    dc = CreateDC(DRIVER, "Band", "LPT1:", NULL);
    exact("CreateDC", dc != NULL);
    exact("RASTERCAPS", GetDeviceCaps(dc, RASTERCAPS));
    drained();
    exact("StartDoc", StartDoc(dc, &doc));
    SetTextColor(dc, RGB(255, 0, 0));
    Rectangle(dc, 1, 1, 9, 9);
    drained();
    banded(dc, "band", 10, 10, 50, 40, TRUE);
    exact("GetTextColor after bands", GetTextColor(dc));

    /* Pages drawn and ended, which GDI bands. */
    probeNote("pages");
    exact("StartPage", StartPage(dc));
    SetTextColor(dc, RGB(0, 0, 255));
    exact("GetTextColor", GetTextColor(dc));
    exact("Rectangle", Rectangle(dc, 5, 5, 60, 45));
    MoveTo(dc, 0, 0);
    exact("LineTo", LineTo(dc, 63, 47));
    position = GetCurrentPosition(dc);
    wsprintf(probeResult, "%d,%d", LOWORD(position), HIWORD(position));
    probe("call", "GetCurrentPosition", probeResult);
    SelectObject(dc, GetStockObject(GRAY_BRUSH));
    exact("Ellipse", Ellipse(dc, 10, 10, 30, 30));
    SaveDC(dc);
    IntersectClipRect(dc, 0, 0, 32, 48);
    exact("Rectangle clipped", Rectangle(dc, 20, 20, 50, 30));
    RestoreDC(dc, -1);
    drained();
    exact("EndPage", EndPage(dc));
    drained();
    exact("GetTextColor after page", GetTextColor(dc));
    position = GetCurrentPosition(dc);
    wsprintf(probeResult, "%d,%d", LOWORD(position), HIWORD(position));
    probe("call", "GetCurrentPosition after page", probeResult);
    at.x = 0;
    exact("StartPage second", StartPage(dc));
    exact("Rectangle second", Rectangle(dc, 20, 20, 40, 40));
    exact("EndPage second", EndPage(dc));
    drained();
    exact("Escape NEWFRAME", Escape(dc, NEWFRAME, 0, NULL, NULL));
    drained();
    exact("EndDoc", EndDoc(dc));
    drained();

    /* A page aborted. */
    probeNote("abort");
    exact("StartDoc", StartDoc(dc, &doc));
    exact("StartPage", StartPage(dc));
    Rectangle(dc, 5, 5, 20, 20);
    exact("AbortDoc", AbortDoc(dc));
    drained();

    /* A context deleted with a page drawn. */
    probeNote("deleted");
    exact("StartDoc", StartDoc(dc, &doc));
    Rectangle(dc, 5, 5, 20, 20);
    exact("DeleteDC", DeleteDC(dc));
    drained();
    (void)at;
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    probeOpen(OUTPUT);
    postscript();
    driver();
    probeFinish();
    return 0;
}
