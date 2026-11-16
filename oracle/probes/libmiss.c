/*
 * A library that imports from a module that is nowhere, loaded by
 * `LoadLibrary`. KERNEL loads each module a module references as it loads
 * it (`KRNL386.EXE` seg2 `1923`-`19b6`), keeping the first error any of
 * them answered (seg2 `1996`-`199b`), and where there was one the load
 * fails with it (seg2 `19d1`-`19db`).
 *
 * * `load`: `LoadLibrary("LIBMISSD.DLL")`'s answer: `error=` and the
 *   number below 32, or `inst`.
 * * `after`: whether a module LIBMISSD is there afterwards (`GetModuleHandle`).
 * * `again`: a second `LoadLibrary`'s answer, the same way.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\LIBMISS.OUT"

static void describe(HINSTANCE library)
{
    if ((UINT)library < 32) {
        wsprintf(probeResult, "error=%u", (UINT)library);
    } else {
        lstrcpy(probeResult, "inst");
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HINSTANCE library;

    probeOpen(OUTPUT);
    SetErrorMode(SEM_NOOPENFILEERRORBOX | SEM_FAILCRITICALERRORS);

    library = LoadLibrary("LIBMISSD.DLL");
    describe(library);
    probe("load", "LIBMISSD.DLL", probeResult);

    probe("after", "GetModuleHandle", GetModuleHandle("LIBMISSD") ? "found" : "0");

    if ((UINT)library >= 32) {
        FreeLibrary(library);
    }

    library = LoadLibrary("LIBMISSD.DLL");
    describe(library);
    probe("again", "LIBMISSD.DLL", probeResult);

    if ((UINT)library >= 32) {
        FreeLibrary(library);
    }

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
