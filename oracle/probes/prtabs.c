/*
 * Text measured and drawn with its tabs expanded on a page through the
 * PostScript driver, `pscript`, for the Apple LaserWriter Plus, printing
 * to a file named as its port, Print Manager's spooler off: USER's
 * `TabbedTextOut` with no stops, one stop, one stop of nought and several
 * stops with tabs past the last, transparent and opaque, a tab at the
 * end, in the device's default font and in a font of variable pitch; and
 * GDI's `GetTextExtent` of no characters, of some, and in a mapping mode.
 * Recorded on the installation with a printer, `vgaprint`.
 *
 * * `call`: each call's answer, a `DWORD`'s as its two words.
 * * `size`: the file's size once the document is done.
 * * `line`: each line the driver wrote from its page on, as it wrote it;
 *   the prolog before is [[probe:prdoc]]'s.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\PRTABS.OUT"
#define PRINTED "C:\\ORACLE\\PRTABS.PRN"
#define DRIVER "pscript"
#define DEVICE "Apple LaserWriter Plus"

static void exact(LPCSTR name, int answer)
{
    wsprintf(probeResult, "%d", answer);
    probe("call", name, probeResult);
}

static void pair(LPCSTR name, DWORD answer)
{
    wsprintf(probeResult, "%d %d", (int)LOWORD(answer), (int)HIWORD(answer));
    probe("call", name, probeResult);
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

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static DOCINFO doc = {sizeof(DOCINFO), "Tabs", NULL};
    static char text[] = "One\tTwo\tThree\tFour\tFive";
    static char ending[] = "Ends\t";
    static int one[1] = {300};
    static int nought[1] = {0};
    static int several[2] = {250, 700};
    OFSTRUCT info;
    HDC dc;
    HFONT font;

    probeOpen(OUTPUT);
    WriteProfileString("windows", "spooler", "no");
    OpenFile(PRINTED, &info, OF_DELETE);

    dc = CreateDC(DRIVER, DEVICE, PRINTED, NULL);
    exact("StartDoc", StartDoc(dc, &doc));
    exact("StartPage", StartPage(dc));

    pair("GetTextExtent none", GetTextExtent(dc, "Tab", 0));
    pair("GetTextExtent Tab", GetTextExtent(dc, "Tab", 3));

    /* Transparent: no stops, one, one of nought, several. */
    SetBkMode(dc, TRANSPARENT);
    pair("TabbedTextOut default", TabbedTextOut(dc, 300, 300, text, 23, 0, NULL, 0));
    pair("TabbedTextOut one", TabbedTextOut(dc, 300, 400, text, 23, 1, one, 300));
    pair("TabbedTextOut nought", TabbedTextOut(dc, 300, 500, text, 23, 1, nought, 0));
    pair("TabbedTextOut several", TabbedTextOut(dc, 300, 600, text, 23, 2, several, 300));
    pair("TabbedTextOut ending", TabbedTextOut(dc, 300, 700, ending, 5, 0, NULL, 0));

    /* Opaque on grey. */
    SetBkMode(dc, OPAQUE);
    SetBkColor(dc, RGB(192, 192, 192));
    pair("TabbedTextOut opaque", TabbedTextOut(dc, 300, 800, text, 23, 1, one, 300));
    pair("TabbedTextOut opaque ending", TabbedTextOut(dc, 300, 900, ending, 5, 1, one, 300));
    SetBkColor(dc, RGB(255, 255, 255));
    SetBkMode(dc, TRANSPARENT);

    /* A variable pitch's average. */
    font = CreateFont(60, 0, 0, 0, FW_NORMAL, 0, 0, 0, ANSI_CHARSET, OUT_DEFAULT_PRECIS,
                      CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY, VARIABLE_PITCH | FF_SWISS, "Helvetica");
    SelectObject(dc, font);
    pair("GetTextExtent Helvetica", GetTextExtent(dc, "Tab", 3));
    pair("TabbedTextOut Helvetica", TabbedTextOut(dc, 300, 1100, text, 23, 0, NULL, 0));

    /* Measured in tenths of a millimetre. */
    SetMapMode(dc, MM_LOMETRIC);
    pair("GetTextExtent lometric", GetTextExtent(dc, "Tab", 3));
    SetMapMode(dc, MM_TEXT);
    SelectObject(dc, GetStockObject(DEVICE_DEFAULT_FONT));
    DeleteObject(font);

    exact("EndPage", EndPage(dc) > 0);
    exact("EndDoc", EndDoc(dc));
    exact("DeleteDC", DeleteDC(dc));

    lines();

    WriteProfileString("windows", "spooler", "yes");
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
