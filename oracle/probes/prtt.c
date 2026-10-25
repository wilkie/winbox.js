/*
 * A TrueType face printed through a Windows printer driver: the PostScript
 * driver, `pscript`, for the Apple LaserWriter Plus, printing to a file
 * named as its port, Print Manager's spooler off, as `prdoc`. Wingdings,
 * which the driver has no printer font to put in its place, so the driver
 * asks GDI's TrueType engine for it -- its widths, and its glyphs to send.
 * Recorded on the installation with a printer, `vgaprint`.
 *
 * * `dc`: whether `CreateDC` gave a device context.
 * * `call`: each call's answer.
 * * `widths`: `GetCharWidth` of Wingdings' `a` to `h`, and of Arial's,
 *   which the driver puts Helvetica in place of.
 * * `extent`: `GetTextExtent` of a string of each.
 * * `size`: the file's size once the document is done.
 * * `line`: each line the driver wrote, as it wrote it.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\PRTT.OUT"
#define PRINTED "C:\\ORACLE\\PRTT.PRN"
#define DRIVER "pscript"
#define DEVICE "Apple LaserWriter Plus"

static void exact(LPCSTR name, int answer)
{
    wsprintf(probeResult, "%d", answer);
    probe("call", name, probeResult);
}

static char chunk[2048];
static char line[512];

/* Each line of the file, a carriage return before its line feed left off,
 * and no more than 300 of its bytes. */
static void lines(void)
{
    OFSTRUCT info;
    HFILE file = OpenFile(PRINTED, &info, OF_READ);
    long size;
    int read;
    int at;
    int length = 0;
    int count = 0;

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
                wsprintf(probeArgs, "%d", count++);
                probe("line", probeArgs, line);
                length = 0;
            } else if (length < 300) {
                line[length++] = chunk[at];
            }
        }
    }

    if (length > 0) {
        line[length] = '\0';
        wsprintf(probeArgs, "%d", count++);
        probe("line", probeArgs, line);
    }

    _lclose(file);
}

static void measure(HDC dc, LPCSTR name)
{
    int widths[8];
    int i;
    LPSTR at;
    DWORD extent;

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

    extent = GetTextExtent(dc, "abcdefgh", 8);
    wsprintf(probeResult, "%d,%d", LOWORD(extent), HIWORD(extent));
    probe("extent", name, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static DOCINFO doc = {sizeof(DOCINFO), "Probe", NULL};
    OFSTRUCT info;
    HDC dc;
    HFONT wingdings, arial, old;

    probeOpen(OUTPUT);
    WriteProfileString("windows", "spooler", "no");
    OpenFile(PRINTED, &info, OF_DELETE);

    dc = CreateDC(DRIVER, DEVICE, PRINTED, NULL);
    probe("dc", "made", dc ? "1" : "0");

    if (!dc) {
        WriteProfileString("windows", "spooler", "yes");
        probeFinish();
        return 0;
    }

    wingdings = CreateFont(-100, 0, 0, 0, 400, 0, 0, 0, SYMBOL_CHARSET, OUT_DEFAULT_PRECIS,
                           CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY, DEFAULT_PITCH, "Wingdings");
    arial = CreateFont(-100, 0, 0, 0, 400, 0, 0, 0, ANSI_CHARSET, OUT_DEFAULT_PRECIS,
                       CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY, DEFAULT_PITCH, "Arial");

    exact("StartDoc", StartDoc(dc, &doc));
    exact("StartPage", StartPage(dc));

    old = SelectObject(dc, wingdings);
    measure(dc, "Wingdings");
    exact("TextOut", TextOut(dc, 300, 300, "abcd", 4));

    SelectObject(dc, arial);
    measure(dc, "Arial");
    exact("TextOut", TextOut(dc, 300, 600, "abcd", 4));

    SelectObject(dc, old);
    exact("EndPage", EndPage(dc) > 0);
    exact("EndDoc", EndDoc(dc));
    exact("DeleteDC", DeleteDC(dc));
    DeleteObject(wingdings);
    DeleteObject(arial);

    lines();

    WriteProfileString("windows", "spooler", "yes");
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
