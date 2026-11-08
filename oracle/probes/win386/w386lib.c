/*
 * A 16-bit program that loads a WATCOM Win386 library and calls into its
 * 32-bit code, as Lode Runner's setup loads Sierra's `SMACKE16.DLL`
 * (`kb/topics/win386.md`). The library is `w386lib.dll.c`, `W386LIBD.DLL`
 * beside Windows. Kept with the Win386 probes and recorded in 386 enhanced
 * mode only (`record.mjs --mode enhanced`): in standard mode the library's
 * supervisor stops at its box.
 *
 * * `load`: `LoadLibrary` of it, whether an instance came; and
 *   `GetProcAddress` of `DLL1`, `DLL2`, `DLL3`, `DLL129`, `Win386LibEntry`
 *   and `WIN386LIBENTRY`, whether each is found.
 * * `call`: routine 1 through `DLL1`, and through `Win386LibEntry`, by its
 *   ordinal, 130, with the routine's number last (by its name, as the
 *   library keeps it or in capitals, it is not found: KERNEL upper-cases
 *   the name asked for, and the library keeps it in mixed case); routine
 *   3, `GetWinFlags` from
 *   32 bits after a block of 100,000 bytes. Routine 2, with a buffer of
 *   the program's as a `DLL_PTR`, is not called: under WIN386 it ends the
 *   program with a page fault in the supervisor's code (`186F:2124`).
 * * `free`: `FreeLibrary`, and `GetModuleHandle` of it after.
 */

#define PROBE_WIN16
#define PROBE_FLUSH
#include "probe.h"

#define OUTPUT "C:\\ORACLE\\W386LIB.OUT"

typedef long(FAR PASCAL *SUM)(long, long, short);
typedef long(FAR PASCAL *SUMBY)(long, long, short, short);
typedef long(FAR PASCAL *FLAGS)(void);

static void found(HINSTANCE library, LPCSTR name)
{
    probe("load", name, GetProcAddress(library, name) ? "found" : "none");
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HINSTANCE library;

    probeOpen(OUTPUT);

    library = LoadLibrary("W386LIBD.DLL");

    if ((UINT)library < 32) {
        wsprintf(probeResult, "refused, %u", (UINT)library);
        probe("load", "LoadLibrary", probeResult);
        probeFinish();
        return 0;
    }

    probe("load", "LoadLibrary", "given");
    found(library, "DLL1");
    found(library, "DLL2");
    found(library, "DLL3");
    found(library, "DLL129");
    found(library, "Win386LibEntry");
    found(library, "WIN386LIBENTRY");

    {
        SUM sum = (SUM)GetProcAddress(library, "DLL1");
        SUMBY entry = (SUMBY)GetProcAddress(library, MAKEINTRESOURCE(130));
        FLAGS flags = (FLAGS)GetProcAddress(library, "DLL3");

        if (sum) {
            wsprintf(probeResult, "%ld", sum(100000L, -3L, 7));
            probe("call", "DLL1 100000, -3, 7", probeResult);
        }

        if (entry) {
            wsprintf(probeResult, "%ld", entry(70000L, 5L, -2, 1));
            probe("call", "ordinal 130 70000, 5, -2, 1", probeResult);
        }

        if (flags) {
            wsprintf(probeResult, "%04lx", flags());
            probe("call", "DLL3 GetWinFlags", probeResult);
        }
    }

    FreeLibrary(library);
    probe("free", "GetModuleHandle after", GetModuleHandle("W386LIBD") ? "loaded" : "gone");

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
