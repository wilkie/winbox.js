/*
 * A WATCOM Win386 program: 32-bit code the Win386 supervisor (WIN386.EXT,
 * bound to it by wbind) starts once DPMI's function 0400h says a 32-bit
 * host, as Sierra's SMACKE16.DLL is started (`kb/guides/enhanced-mode.md`).
 * In standard mode the supervisor shows "Not running on a 386 DPMI
 * implementation" and the program never runs, so there is no fixture of
 * that mode, only the screen; in 386 enhanced mode it records:
 *
 * * `run pointer`: the size of a pointer, 4 in 32-bit code.
 * * `run GetWinFlags`: the flags, in hexadecimal.
 * * `run malloc 2MB`: whether the C library gives a block of 2 MB, its last
 *   byte written.
 *
 * Built by `build-probes.mjs` (`buildWin386`, with Open Watcom's
 * `wcc386 -bt=windows`, `wlink system win386` and `wbind -n`, the
 * supervisor `binw/win386.ext`) into `oracle/build/win386`, and recorded
 * with `record.mjs w386ver --mode enhanced`: `record.mjs` reads that folder
 * in enhanced mode alone, as a recording in standard mode would stop at the
 * supervisor's box (`kb/topics/win386.md`).
 */

#include <stdio.h>
#include <stdlib.h>

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\W386VER.OUT"

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    char *big;

    probeOpen(OUTPUT);

    wsprintf(probeResult, "%d", (int)sizeof(void *));
    probe("run", "pointer", probeResult);

    wsprintf(probeResult, "%04lx", GetWinFlags());
    probe("run", "GetWinFlags", probeResult);

    big = malloc(2L * 1024 * 1024);
    probe("run", "malloc 2MB", big ? "given" : "refused");

    if (big) {
        big[2L * 1024 * 1024 - 1] = 1;
        free(big);
    }

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
