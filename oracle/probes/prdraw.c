/*
 * Figures, text and a picture drawn on a page through the PostScript
 * driver, `pscript`, for the Apple LaserWriter Plus, printing to a file
 * named as its port, Print Manager's spooler off: pens of styles and
 * widths, brushes hollow, hatched and solid, a polygon, a round
 * rectangle, a pie, a mapping mode, a clip, text of colours, modes and a
 * font of its own, `ExtTextOut`'s opaque rectangle, and a DIB stretched.
 * Recorded on the installation with a printer, `vgaprint`.
 *
 * * `call`: each call's answer.
 * * `size`: the file's size once the document is done.
 * * `line`: each line the driver wrote from its page on, as it wrote it;
 *   the prolog before is [[probe:prdoc]]'s.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\PRDRAW.OUT"
#define PRINTED "C:\\ORACLE\\PRDRAW.PRN"
#define DRIVER "pscript"
#define DEVICE "Apple LaserWriter Plus"

static void exact(LPCSTR name, int answer)
{
    wsprintf(probeResult, "%d", answer);
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

/* An 8 by 8 DIB of sixteen colours: its header, its table and its rows. */
static struct {
    BITMAPINFOHEADER header;
    RGBQUAD colors[16];
} picture = {{sizeof(BITMAPINFOHEADER), 8, 8, 1, 4, BI_RGB, 0, 0, 0, 16, 0}};

static BYTE bits[32];

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static DOCINFO doc = {sizeof(DOCINFO), "Drawn", NULL};
    static POINT chain[4] = {{300, 1200}, {500, 1100}, {700, 1300}, {900, 1150}};
    static POINT star[5] = {{1300, 1100}, {1500, 1500}, {1100, 1250}, {1500, 1250}, {1100, 1500}};
    OFSTRUCT info;
    HDC dc;
    HPEN pen;
    HBRUSH brush;
    HFONT font;
    RECT box;
    int i;

    probeOpen(OUTPUT);
    WriteProfileString("windows", "spooler", "no");
    OpenFile(PRINTED, &info, OF_DELETE);

    for (i = 0; i < 16; i++) {
        picture.colors[i].rgbRed = (BYTE)(i & 1 ? 255 : 0);
        picture.colors[i].rgbGreen = (BYTE)(i & 2 ? 255 : 0);
        picture.colors[i].rgbBlue = (BYTE)(i & 4 ? 255 : 0);
    }

    for (i = 0; i < 32; i++) {
        bits[i] = (BYTE)(i * 0x13);
    }

    dc = CreateDC(DRIVER, DEVICE, PRINTED, NULL);
    exact("StartDoc", StartDoc(dc, &doc));
    exact("StartPage", StartPage(dc));

    /* A dashed red line, thin. */
    pen = CreatePen(PS_DASH, 1, RGB(255, 0, 0));
    SelectObject(dc, pen);
    MoveTo(dc, 300, 300);
    exact("LineTo dashed", LineTo(dc, 1500, 400));

    /* A chain three wide in blue. */
    SelectObject(dc, GetStockObject(BLACK_PEN));
    DeleteObject(pen);
    pen = CreatePen(PS_SOLID, 3, RGB(0, 0, 255));
    SelectObject(dc, pen);
    exact("Polyline", Polyline(dc, chain, 4));

    /* A hatched rectangle with no outline. */
    SelectObject(dc, GetStockObject(NULL_PEN));
    brush = CreateHatchBrush(HS_CROSS, RGB(0, 128, 0));
    SelectObject(dc, brush);
    exact("Rectangle hatched", Rectangle(dc, 300, 500, 700, 800));

    /* A star, filled alternately with a solid brush, outlined in blue. */
    SelectObject(dc, pen);
    SelectObject(dc, GetStockObject(GRAY_BRUSH));
    DeleteObject(brush);
    exact("Polygon", Polygon(dc, star, 5));
    SetPolyFillMode(dc, WINDING);
    exact("Polygon winding", Polygon(dc, star, 5));
    SetPolyFillMode(dc, ALTERNATE);

    /* A hollow ellipse with a wide pen inside its frame. */
    SelectObject(dc, GetStockObject(BLACK_PEN));
    DeleteObject(pen);
    pen = CreatePen(PS_INSIDEFRAME, 20, RGB(0, 0, 0));
    SelectObject(dc, pen);
    SelectObject(dc, GetStockObject(HOLLOW_BRUSH));
    exact("Ellipse inside", Ellipse(dc, 800, 500, 1200, 800));
    exact("Ellipse circle", Ellipse(dc, 1300, 500, 1600, 800));

    /* A round rectangle and a pie, light grey. */
    SelectObject(dc, GetStockObject(BLACK_PEN));
    DeleteObject(pen);
    SelectObject(dc, GetStockObject(LTGRAY_BRUSH));
    exact("RoundRect", RoundRect(dc, 300, 1600, 800, 1900, 100, 60));
    exact("Pie", Pie(dc, 900, 1600, 1300, 1900, 1300, 1600, 900, 1750));
    exact("Arc", Arc(dc, 1400, 1600, 1800, 1900, 1800, 1750, 1400, 1750));
    exact("Chord", Chord(dc, 1900, 1600, 2200, 1900, 2200, 1600, 1900, 1900));

    /* A rectangle in tenths of a millimetre. */
    SetMapMode(dc, MM_LOMETRIC);
    exact("Rectangle lometric", Rectangle(dc, 200, -1700, 600, -1900));
    SetMapMode(dc, MM_TEXT);

    /* A rectangle and a line across a clip. */
    SaveDC(dc);
    IntersectClipRect(dc, 600, 2300, 1200, 2600);
    exact("Rectangle clipped", Rectangle(dc, 500, 2200, 1000, 2500));
    MoveTo(dc, 500, 2400);
    exact("LineTo clipped", LineTo(dc, 1400, 2400));
    RestoreDC(dc, -1);

    /* Text, transparent and blue; opaque in a rectangle; in a font of its own. */
    SetBkMode(dc, TRANSPARENT);
    SetTextColor(dc, RGB(0, 0, 255));
    exact("TextOut transparent", TextOut(dc, 300, 2700, "Transparent", 11));
    SetBkMode(dc, OPAQUE);
    SetTextColor(dc, RGB(0, 0, 0));
    SetBkColor(dc, RGB(192, 192, 192));
    SetRect(&box, 300, 2800, 1000, 2900);
    exact("ExtTextOut opaque", ExtTextOut(dc, 320, 2820, ETO_OPAQUE, &box, "Opaque", 6, NULL));
    SetBkColor(dc, RGB(255, 255, 255));
    font = CreateFont(60, 0, 0, 0, FW_BOLD, 0, 0, 0, ANSI_CHARSET, OUT_DEFAULT_PRECIS,
                      CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY, VARIABLE_PITCH | FF_SWISS, "Helvetica");
    SelectObject(dc, font);
    exact("TextOut font", TextOut(dc, 1200, 2700, "Helvetica", 9));
    SelectObject(dc, GetStockObject(DEVICE_DEFAULT_FONT));
    DeleteObject(font);

    /* The picture, stretched ten times. */
    exact("StretchDIBits", StretchDIBits(dc, 1800, 300, 80, 80, 0, 0, 8, 8, bits,
                                         (BITMAPINFO FAR *)&picture, DIB_RGB_COLORS, SRCCOPY));

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
