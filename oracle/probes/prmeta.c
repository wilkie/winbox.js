/*
 * A metafile played on a page through the PostScript driver, `pscript`,
 * for the Apple LaserWriter Plus, printing to a file named as its port,
 * Print Manager's spooler off, as [[probe:prdraw]] prints: colours, a
 * mode, a pen and a brush of its own, figures and text, played whole by
 * `PlayMetaFile` on the first page and a record at a time by
 * `PlayMetaFileRecord` from `EnumMetaFile`'s procedure on the second.
 * Recorded on the installation with a printer, `vgaprint`.
 *
 * * `call`: each call's answer.
 * * `color`: the text and background colours the context has after each
 *   playing.
 * * `size`: the file's size once the document is done.
 * * `line`: each line the driver wrote from its first page on, as it
 *   wrote it.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\PRMETA.OUT"
#define PRINTED "C:\\ORACLE\\PRMETA.PRN"
#define DRIVER "pscript"
#define DEVICE "Apple LaserWriter Plus"

static void exact(LPCSTR name, long answer)
{
    wsprintf(probeResult, "%ld", answer);
    probe("call", name, probeResult);
}

static void colors(LPCSTR when, HDC dc)
{
    wsprintf(probeResult, "%lx %lx", GetTextColor(dc), GetBkColor(dc));
    probe("color", when, probeResult);
}

static char chunk[2048];
static char line[512];

/* Each line of the file from its first page on, a carriage return before
 * its line feed left off, and no more than 300 of its bytes. */
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

    if (length > 0 && paged) {
        line[length] = '\0';
        wsprintf(probeArgs, "%d", count);
        probe("line", probeArgs, line);
    }

    _lclose(file);
}

static int played;

int FAR PASCAL _export Record(HDC hdc, HANDLETABLE FAR *table, METARECORD FAR *record, int objects,
                              LPARAM data)
{
    PlayMetaFileRecord(hdc, table, record, objects);
    played++;
    (void)data;
    return 1;
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static DOCINFO doc = {sizeof(DOCINFO), "Played", NULL};
    static POINT chain[3] = {{300, 1200}, {600, 1100}, {900, 1250}};
    static POINT wedge[3] = {{1100, 1100}, {1500, 1300}, {1100, 1300}};
    OFSTRUCT info;
    HDC dc;
    HDC meta;
    HMETAFILE file;
    HPEN pen;
    HBRUSH brush;
    RECT box;
    FARPROC proc;

    probeOpen(OUTPUT);
    WriteProfileString("windows", "spooler", "no");
    OpenFile(PRINTED, &info, OF_DELETE);

    /* The metafile: colours and a mode, a red pen three wide and a green
     * brush, hatched, then figures and text. */
    meta = CreateMetaFile(NULL);
    SetTextColor(meta, RGB(0, 0, 255));
    SetBkColor(meta, RGB(192, 192, 192));
    SetBkMode(meta, OPAQUE);
    pen = CreatePen(PS_SOLID, 3, RGB(255, 0, 0));
    brush = CreateHatchBrush(HS_DIAGCROSS, RGB(0, 128, 0));
    SelectObject(meta, pen);
    SelectObject(meta, brush);
    Rectangle(meta, 300, 300, 700, 600);
    Ellipse(meta, 800, 300, 1200, 600);
    MoveTo(meta, 300, 800);
    LineTo(meta, 1200, 900);
    Polyline(meta, chain, 3);
    Polygon(meta, wedge, 3);
    TextOut(meta, 300, 1500, "Played", 6);
    SetTextColor(meta, RGB(255, 0, 0));
    SetBkColor(meta, RGB(255, 255, 0));
    SetRect(&box, 300, 1700, 1000, 1800);
    ExtTextOut(meta, 320, 1720, ETO_OPAQUE, &box, "Opaque", 6, NULL);
    file = CloseMetaFile(meta);
    DeleteObject(pen);
    DeleteObject(brush);

    dc = CreateDC(DRIVER, DEVICE, PRINTED, NULL);
    exact("StartDoc", StartDoc(dc, &doc));

    /* Played whole. */
    exact("StartPage", StartPage(dc));
    colors("before", dc);
    exact("PlayMetaFile", PlayMetaFile(dc, file));
    colors("played", dc);
    exact("EndPage", EndPage(dc) > 0);

    /* A record at a time, the colours put back first. */
    exact("StartPage", StartPage(dc));
    SetTextColor(dc, RGB(0, 0, 0));
    SetBkColor(dc, RGB(255, 255, 255));
    proc = MakeProcInstance((FARPROC)Record, instance);
    exact("EnumMetaFile", EnumMetaFile(dc, file, (MFENUMPROC)proc, 0));
    FreeProcInstance(proc);
    exact("played", played);
    colors("enumerated", dc);
    exact("EndPage", EndPage(dc) > 0);

    exact("EndDoc", EndDoc(dc));
    exact("DeleteDC", DeleteDC(dc));
    DeleteMetaFile(file);

    lines();

    WriteProfileString("windows", "spooler", "yes");
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
