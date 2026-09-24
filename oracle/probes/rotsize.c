/*
 * What size a rotated font is, which is not the size an upright one is.
 *
 * The census found that turning a TrueType face moves its metrics: Arial at a
 * cell of sixteen reports an internal leading of three upright and two turned,
 * and `tmHeight - tmInternalLeading` is the em, so the *pixel size changes*.
 * Arial goes from thirteen per em to fourteen, Times from fourteen to fifteen,
 * Courier from thirteen to fourteen, Arial at a cell of thirty-two from
 * twenty-seven to twenty-nine.
 *
 * 8f and 8r measured the upright rule at length: the cell is looked up in
 * `VDMX`, which quantises, and the size is the one whose grid-fitted cell
 * fits. A rotated cell is not a cell in the table's sense -- the table records
 * what an *upright* rendering measures -- so the obvious reading is that the
 * turned font does not consult it and computes the size some other way.
 *
 * This is `tiepick`'s instrument pointed at that question: every cell from
 * eight to seventy-two in four faces, recorded upright and at a right angle,
 * so the two size rules can be read off side by side. A right angle because
 * it is the one angle where nothing can be blamed on a fractional transform.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\ROTSIZE.OUT"

static HDC dc;

static const char SPECIMEN[] = "Windows";

static void probeAsk(LPCSTR face, int height, int escapement)
{
    TEXTMETRIC tm;
    HFONT font;
    HFONT previous;
    DWORD extent;
    char picked[LF_FACESIZE];

    wsprintf(probeArgs, "\"%s\",h=%d,esc=%d", (LPSTR)face, height, escapement);

    font = CreateFont(height, 0, escapement, escapement, FW_NORMAL, 0, 0, 0,
                      ANSI_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                      DEFAULT_QUALITY, DEFAULT_PITCH, face);

    if (font == NULL) {
        probe("rotate heights", probeArgs, "no font");
        return;
    }

    previous = (HFONT)SelectObject(dc, font);

    GetTextFace(dc, LF_FACESIZE, picked);
    GetTextMetrics(dc, &tm);
    extent = GetTextExtent(dc, SPECIMEN, lstrlen(SPECIMEN));

    wsprintf(probeResult,
             "face=\"%s\",height=%d,ascent=%d,descent=%d,internal=%d,external=%d,"
             "average=%d,maximum=%d,extent=%d:%d",
             (LPSTR)picked, tm.tmHeight, tm.tmAscent, tm.tmDescent,
             tm.tmInternalLeading, tm.tmExternalLeading,
             tm.tmAveCharWidth, tm.tmMaxCharWidth,
             LOWORD(extent), HIWORD(extent));
    probe("rotate heights", probeArgs, probeResult);

    SelectObject(dc, previous);
    DeleteObject(font);
}

static void sweep(LPCSTR face)
{
    int height;

    for (height = 8; height <= 72; height++) {
        probeAsk(face, height, 0);
        probeAsk(face, height, 900);
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    probeOpen(OUTPUT);

    dc = GetDC(NULL);

    probeNote("every cell upright and turned, so the two size rules sit side by side");

    sweep("Arial");
    sweep("Times New Roman");
    sweep("Courier New");
    sweep("Arial Bold");

    ReleaseDC(NULL, dc);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
