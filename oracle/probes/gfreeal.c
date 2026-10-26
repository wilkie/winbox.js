/*
 * KERNEL's GlobalFreeAll, called by a program of the probe's own,
 * GFREEALC.EXE (`gfreeal.child.c`), on its own task's blocks: GlobalSize
 * of a moveable, a fixed and a shared block of its own before and after,
 * and the answer, written by it; then whether it ended.
 */

#define PROBE_FLUSH
#include "probe.h"

#define OUTPUT "C:\\ORACLE\\GFREEAL.OUT"

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    int i;
    MSG message;

    probeOpen(OUTPUT);
    _lclose(probeHandle);
    probeHandle = HFILE_ERROR;

    WinExec("GFREEALC.EXE", SW_SHOWNORMAL);

    for (i = 0; i < 200 && GetModuleHandle("GFREEALC"); i++) {
        while (PeekMessage(&message, NULL, 0, 0, PM_REMOVE)) {
            DispatchMessage(&message);
        }

        Yield();
    }

    probeHandle = _lopen(probePath, OF_WRITE);
    _llseek(probeHandle, 0L, 2);
    probe("ended", "child", GetModuleHandle("GFREEALC") ? "running" : "ended");

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
