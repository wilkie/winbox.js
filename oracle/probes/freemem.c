/*
 * What a program is told of free memory, and the local heap's handle delta.
 *
 * The numbers depend on the machine Windows runs on, here DOSBox's, so they
 * are recorded to see their size and how they stand to each other:
 *
 * * `free`: `GetFreeSpace(0)`, and `GlobalCompact` of 0 and of -1, in K.
 * * `order`: whether `GlobalCompact(0)` is no more than `GetFreeSpace(0)`.
 * * `delta`: `LocalHandleDelta(0)`, and what it answers after being set.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\FREEMEM.OUT"

/* Not in the import library: found by name. */
typedef UINT (FAR PASCAL *DELTA)(UINT);

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    DELTA LocalHandleDelta = (DELTA)GetProcAddress(GetModuleHandle("KERNEL"), "LOCALHANDLEDELTA");
    DWORD space;
    DWORD largest;
    DWORD compacted;

    probeOpen(OUTPUT);

    space = GetFreeSpace(0);
    largest = GlobalCompact(0);
    compacted = GlobalCompact((DWORD)-1);

    wsprintf(probeResult, "%lu", space / 1024);
    probe("free", "GetFreeSpace", probeResult);
    wsprintf(probeResult, "%lu", largest / 1024);
    probe("free", "GlobalCompact-0", probeResult);
    wsprintf(probeResult, "%lu", compacted / 1024);
    probe("free", "GlobalCompact-all", probeResult);
    probe("order", "largest-within-free", largest <= space ? "yes" : "no");

    wsprintf(probeResult, "%u", LocalHandleDelta(0));
    probe("delta", "default", probeResult);
    wsprintf(probeResult, "%u", LocalHandleDelta(16));
    probe("delta", "set-16", probeResult);
    wsprintf(probeResult, "%u", LocalHandleDelta(0));
    probe("delta", "after", probeResult);

    probeFinish();

    return 0;
}
