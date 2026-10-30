/*
 * A program that imports what its libraries do not export: KERNEL's loader
 * binds each such import to KERNEL's `UndefDynlink` (`KRNL386.EXE` seg1
 * `73b9`-`73f8`), so the program loads and runs, and is ended only when it
 * calls one (seg1 `72d4`-`72eb`, "Call to Undefined Dynalink" through
 * `FatalAppExit`'s routine).
 *
 * The probe starts UNDEFDLC.EXE (`undefdl.child.c`), whose records come
 * first, and waits for it to end. Then:
 *
 * * `exec`: WinExec's answer, `inst` for an instance.
 * * `after`: whether the program has ended, by its module's usage.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\UNDEFDL.OUT"

static void settle(DWORD span, HINSTANCE started)
{
    DWORD start = GetTickCount();
    MSG msg;

    while (GetTickCount() - start < span) {
        if (started && !GetModuleUsage(started)) {
            return;
        }

        if (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
            DispatchMessage(&msg);
        } else {
            Yield();
        }
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    UINT answer;

    /* Made empty, and closed while the program adds its records. */
    probeOpen(OUTPUT);
    _lclose(probeHandle);

    answer = WinExec("UNDEFDLC.EXE", SW_SHOWNORMAL);
    settle(30000, answer > 32 ? (HINSTANCE)answer : NULL);

    probeHandle = _lopen(OUTPUT, OF_WRITE);
    _llseek(probeHandle, 0L, 2);

    if (answer > 32) {
        probe("exec", "UNDEFDLC.EXE", "inst");
    } else {
        wsprintf(probeResult, "%u", answer);
        probe("exec", "UNDEFDLC.EXE", probeResult);
    }

    probe("after", "usage",
          (LPSTR)(answer > 32 && GetModuleUsage((HINSTANCE)answer) ? "running" : "ended"));
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
