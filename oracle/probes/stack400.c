/*
 * A program that asks for a stack of 400h bytes (`PROBE_STACK_400`: its
 * header's word at 12h), less than the 1400h KERNEL makes a program's
 * stack at least (`KRNL386.EXE` seg2 `123d`-`124f`), the stack's size the
 * task is started with in BX (seg2 `2579`) and its data segment is sized
 * by (seg1 `7690`). `stackpos`'s records for it.
 *
 * * `header`: the three words `InitTask` writes into the data segment's
 *   header, at 0Ah, 0Ch and 0Eh -- the stack's top, the lowest it has
 *   reached, and its bottom -- in hex; and the bottom less the top.
 * * `local`: where a local of `WinMain` is, in hex.
 * * `sizes`: the segment's size (`GlobalSize` of its handle), in hex.
 */

#define PROBE_STACK_400

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\STACK400.OUT"

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

    wsprintf(probeResult, "%04x", header[7] - header[5]);
    probe("header", "bottom less top", probeResult);

    wsprintf(probeResult, "%04x", (WORD)(DWORD)(LPVOID)&local);
    probe("local", "winmain", probeResult);

    wsprintf(probeResult, "%lx", GlobalSize((HGLOBAL)GlobalHandle(data)));
    probe("sizes", "data", probeResult);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
