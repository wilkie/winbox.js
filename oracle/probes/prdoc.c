/*
 * A page printed through a Windows printer driver: the PostScript driver,
 * `pscript`, for the Apple LaserWriter Plus, printing to a file named as
 * its port, Print Manager's spooler off. Recorded on the installation with
 * a printer, `vgaprint`; the run puts the driver on the drive.
 *
 * * `dc`: whether `CreateDC` of the driver, the device and the file gave a
 *   device context.
 * * `call`: each call's answer.
 * * `size`: the file's size once the document is done.
 * * `line`: each line the driver wrote, as it wrote it.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\PRDOC.OUT"
#define PRINTED "C:\\ORACLE\\PRDOC.PRN"
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

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static DOCINFO doc = {sizeof(DOCINFO), "Probe", NULL};
    OFSTRUCT info;
    HDC dc;
    HPEN pen;
    HBRUSH brush;

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

    exact("StartDoc", StartDoc(dc, &doc));
    exact("StartPage", StartPage(dc));
    exact("TextOut", TextOut(dc, 300, 300, "Printed", 7));
    exact("Rectangle", Rectangle(dc, 300, 400, 900, 700));
    pen = CreatePen(PS_SOLID, 10, RGB(0, 0, 0));
    brush = CreateSolidBrush(RGB(128, 128, 128));
    SelectObject(dc, pen);
    SelectObject(dc, brush);
    exact("MoveTo", (int)MoveTo(dc, 300, 800));
    exact("LineTo", LineTo(dc, 900, 1000));
    exact("Ellipse", Ellipse(dc, 1000, 400, 1400, 700));
    SelectObject(dc, GetStockObject(BLACK_PEN));
    SelectObject(dc, GetStockObject(WHITE_BRUSH));
    DeleteObject(pen);
    DeleteObject(brush);
    exact("EndPage", EndPage(dc));
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
