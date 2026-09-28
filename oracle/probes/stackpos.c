/*
 * Where a program's stack is in its data segment: after the data the file
 * holds, or after the whole of the data it asks for, the uninitialised too.
 *
 * * `header`: the three words `InitTask` writes into the data segment's
 *   header, at 0Ah, 0Ch and 0Eh -- the stack's top, the lowest it has
 *   reached, and its bottom -- in hex.
 * * `local`: where a local of `WinMain` is, in hex.
 * * `static`: where an uninitialised static array begins and ends, in hex.
 * * `sizes`: the segment's size (`GlobalSize` of its handle), in hex.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\STACKPOS.OUT"

/* Uninitialised, so not in the file: the data the program asks for past
 * what it holds. */
static char unset[3000];

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WORD FAR *header;
    WORD local;
    WORD data;

    _asm mov data, ds;

    probeOpen(OUTPUT);

    header = (WORD FAR *)MAKELP(data, 0);

    wsprintf(probeResult, "%04x %04x %04x", header[5], header[6], header[7]);
    probe("header", "stack", probeResult);

    wsprintf(probeResult, "%04x", (WORD)(DWORD)(LPVOID)&local);
    probe("local", "winmain", probeResult);

    wsprintf(probeResult, "%04x %04x", (WORD)(DWORD)(LPVOID)unset,
             (WORD)(DWORD)(LPVOID)(unset + sizeof(unset)));
    probe("static", "unset", probeResult);

    wsprintf(probeResult, "%lx", GlobalSize((HGLOBAL)GlobalHandle(data)));
    probe("sizes", "data", probeResult);

    unset[0] = 1;
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
