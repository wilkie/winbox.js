/*
 * `FastWindowFrame` and `Death` on a printer's context: the PostScript
 * driver's, recorded on the installation with a printer (`vgaprint`).
 * `FastWindowFrame` (`GDI.EXE` seg1 `420e`) answers nought unless the
 * context's driver has `RC_GDI20_OUTPUT` and its clip is one rectangle;
 * `Death` (seg1 `2067`) is the context's driver's `Disable`, given its
 * `PDEVICE` -- the PostScript driver's frees what the device holds and
 * answers 1 (`PSCRIPT.DRV` seg12 `0000`-`0044`). `Death` comes last: the
 * device is spent after it, and the context is not deleted.
 */

#include "probe.h"
#include "visprobe.h"

#define OUTPUT "C:\\ORACLE\\VISPRN.OUT"
#define PRINTED "C:\\ORACLE\\VISPRN.PRN"
#define DRIVER "pscript"
#define DEVICE "Apple LaserWriter Plus"

typedef int(FAR PASCAL *DEATHPROC)(HDC);

static void answer(LPCSTR what, long value)
{
    wsprintf(probeResult, "%ld", value);
    probe(what, "", probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    OFSTRUCT info;
    HDC dc;
    RECT rect;
    DEATHPROC death;

    probeOpen(OUTPUT);
    visImports();
    death = (DEATHPROC)gdiOrdinal(121);
    WriteProfileString("windows", "spooler", "no");
    OpenFile(PRINTED, &info, OF_DELETE);

    dc = CreateDC(DRIVER, DEVICE, PRINTED, NULL);
    probe("CreateDC", "", dc ? "handle" : "0");

    if (dc) {
        SetRect(&rect, 100, 100, 600, 400);
        answer("FastWindowFrame", (long)pFastWindowFrame(dc, &rect, 4, 3, PATCOPY));
        answer("Death", (long)death(dc));
    }

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
