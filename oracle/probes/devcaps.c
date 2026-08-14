/*
 * What a display driver says about itself.
 *
 * `GetDeviceCaps` is how a program finds out what it is drawing on, and the
 * answers are not properties of Windows -- they are properties of whichever
 * driver was installed. A program asks how many colours it has and lays itself
 * out differently for sixteen than for two hundred and fifty-six; it asks for
 * `LOGPIXELSY` and sizes a font from it; it asks `ASPECTX` and `ASPECTY` and
 * draws a circle that is round only if it believed the answer.
 *
 * So this is the one probe whose fixture is meaningless without knowing which
 * driver produced it. The recorder installs Windows once per display profile
 * and runs this against each, and the fixture is named for the profile rather
 * than for the probe.
 *
 * It is called `devcaps` rather than `display` because Windows already has a
 * module of that name -- the display driver itself is `DISPLAY` -- and an
 * application whose module name collides with a system driver does not load.
 * It fails silently and early, before its first line of output, which is a
 * confusing way to find out.
 *
 * Everything here is a single number from a single call, which makes the whole
 * probe a table. That is deliberate: the interesting comparison is between two
 * drivers rather than between two calls, and a table diffs.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\DEVCAPS.OUT"

static HDC dc;

static void probeCap(int index, LPCSTR name)
{
    wsprintf(probeResult, "%d", GetDeviceCaps(dc, index));
    probe("GetDeviceCaps", name, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    probeOpen(OUTPUT);

    dc = GetDC(NULL);

    if (dc == NULL) {
        probe("GetDC", "NULL", "failed");
        probeFinish();
        return 0;
    }

    /* The size and shape of the surface. HORZSIZE and VERTSIZE are in
     * millimetres, which is how a driver describes a physical screen it has
     * only been told the resolution of.
     */
    probeNote("the surface");
    probeCap(HORZRES, "HORZRES");
    probeCap(VERTRES, "VERTRES");
    probeCap(HORZSIZE, "HORZSIZE");
    probeCap(VERTSIZE, "VERTSIZE");
    probeCap(ASPECTX, "ASPECTX");
    probeCap(ASPECTY, "ASPECTY");
    probeCap(ASPECTXY, "ASPECTXY");
    probeCap(LOGPIXELSX, "LOGPIXELSX");
    probeCap(LOGPIXELSY, "LOGPIXELSY");

    /* How colour is stored and how much of it there is. A sixteen colour VGA
     * reports one bit across four planes rather than four bits on one, which
     * is the difference between a planar and a packed frame buffer and is
     * visible to anything that builds a bitmap by hand.
     */
    probeNote("colour");
    probeCap(BITSPIXEL, "BITSPIXEL");
    probeCap(PLANES, "PLANES");
    probeCap(NUMCOLORS, "NUMCOLORS");
    probeCap(NUMRESERVED, "NUMRESERVED");
    probeCap(SIZEPALETTE, "SIZEPALETTE");
    probeCap(COLORRES, "COLORRES");

    probeNote("what the driver can do");
    probeCap(DRIVERVERSION, "DRIVERVERSION");
    probeCap(TECHNOLOGY, "TECHNOLOGY");
    probeCap(RASTERCAPS, "RASTERCAPS");
    probeCap(CURVECAPS, "CURVECAPS");
    probeCap(LINECAPS, "LINECAPS");
    probeCap(POLYGONALCAPS, "POLYGONALCAPS");
    probeCap(TEXTCAPS, "TEXTCAPS");
    probeCap(CLIPCAPS, "CLIPCAPS");

    probeNote("its stock objects");
    probeCap(NUMBRUSHES, "NUMBRUSHES");
    probeCap(NUMPENS, "NUMPENS");
    probeCap(NUMFONTS, "NUMFONTS");
    probeCap(NUMMARKERS, "NUMMARKERS");

    probeNote("the metrics that follow from it");
    wsprintf(probeResult, "%d", GetSystemMetrics(SM_CXSCREEN));
    probe("GetSystemMetrics", "SM_CXSCREEN", probeResult);
    wsprintf(probeResult, "%d", GetSystemMetrics(SM_CYSCREEN));
    probe("GetSystemMetrics", "SM_CYSCREEN", probeResult);
    wsprintf(probeResult, "%d", GetSystemMetrics(SM_CYCAPTION));
    probe("GetSystemMetrics", "SM_CYCAPTION", probeResult);
    wsprintf(probeResult, "%d", GetSystemMetrics(SM_CXBORDER));
    probe("GetSystemMetrics", "SM_CXBORDER", probeResult);
    wsprintf(probeResult, "%d", GetSystemMetrics(SM_CYBORDER));
    probe("GetSystemMetrics", "SM_CYBORDER", probeResult);
    wsprintf(probeResult, "%d", GetSystemMetrics(SM_CXFRAME));
    probe("GetSystemMetrics", "SM_CXFRAME", probeResult);
    wsprintf(probeResult, "%d", GetSystemMetrics(SM_CYFRAME));
    probe("GetSystemMetrics", "SM_CYFRAME", probeResult);
    wsprintf(probeResult, "%d", GetSystemMetrics(SM_CYMENU));
    probe("GetSystemMetrics", "SM_CYMENU", probeResult);
    wsprintf(probeResult, "%d", GetSystemMetrics(SM_CXICON));
    probe("GetSystemMetrics", "SM_CXICON", probeResult);
    wsprintf(probeResult, "%d", GetSystemMetrics(SM_CYICON));
    probe("GetSystemMetrics", "SM_CYICON", probeResult);

    ReleaseDC(NULL, dc);

    probeFinish();
    return 0;
}
