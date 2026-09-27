/*
 * GlobalLock and GlobalUnlock given handles that name no block, as
 * Control Panel's printers applet gives it the 1 Print Manager passes:
 *
 * * `lock`: what GlobalLock answers, as a far pointer in hex, and what
 *   GlobalUnlock answers after; `ds` for the probe's own data segment.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\GLOCK.OUT"

unsigned GetDS(void);
#pragma aux GetDS = "mov ax,ds" value[ax];

static void lock(LPCSTR what, HGLOBAL handle)
{
    DWORD pointer = (DWORD)GlobalLock(handle);
    BOOL unlocked = GlobalUnlock(handle);

    if (pointer && HIWORD(pointer) == GetDS() && !LOWORD(pointer)) {
        wsprintf(probeResult, "ds/%d", unlocked);
    } else {
        wsprintf(probeResult, "%08lx/%d", pointer, unlocked);
    }

    probe("lock", what, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HGLOBAL freed;

    probeOpen(OUTPUT);

    freed = GlobalAlloc(GMEM_MOVEABLE, 16);
    GlobalFree(freed);

    lock("0", 0);
    lock("1", (HGLOBAL)1);
    lock("2", (HGLOBAL)2);
    lock("7", (HGLOBAL)7);
    lock("freed", freed);
    lock("ffff", (HGLOBAL)0xffff);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
