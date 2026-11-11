/*
 * A 16-bit program that calls `w386lib`'s routine 2 with a far pointer to
 * its buffer as a `DLL_PTR`: under WIN386 the routine's store reaches a
 * page WIN386 has not given the program, and KERNEL shows its box for a
 * Page Fault (`kb/guides/paging.md`, `kb/topics/win386.md`). The library
 * is `pgw386.dll.c`, `PGW386D.DLL`, the routine the same as
 * `w386lib.dll.c`'s. Recorded in 386 enhanced mode only (`record.mjs --mode
 * enhanced`): in standard mode the library's supervisor stops at its box.
 *
 * KERNEL's box has no window and no program runs while it is up: the
 * probe is recorded with `--shoot fill:3` and the box's Close pressed
 * (`--then Return:4`). The screens are what the box says. No first box,
 * with an Ignore, is offered for a fault in the supervisor's 32-bit code:
 * after Close the program has ended, and its last record is the call's.
 *
 * * `load`: `LoadLibrary` of it, and `GetProcAddress` of `DLL2`.
 * * `fill`: the call made, then what it returned and the buffer after
 *   (`.` where it was not written).
 */

#define PROBE_WIN16
#define PROBE_FLUSH
#include "probe.h"

#define OUTPUT "C:\\ORACLE\\PGW386.OUT"

typedef long(FAR PASCAL *ROUTINE)(LPSTR);

static char buffer[32];

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HINSTANCE library;
    ROUTINE fill;
    long answer;

    probeOpen(OUTPUT);

    library = LoadLibrary("PGW386D.DLL");

    if ((UINT)library < 32) {
        wsprintf(probeResult, "refused, %u", (UINT)library);
        probe("load", "LoadLibrary", probeResult);
        probeFinish();
        return 0;
    }

    probe("load", "LoadLibrary", "given");
    fill = (ROUTINE)GetProcAddress(library, "DLL2");
    probe("load", "DLL2", fill ? "found" : "none");

    if (fill) {
        lstrcpy(buffer, ".");
        probe("fill", "DLL2", "calling");
        answer = fill(buffer);
        wsprintf(probeResult, "%ld", answer);
        probe("fill", "returned", probeResult);
        probe("fill", "buffer", buffer);
    }

    FreeLibrary(library);
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
