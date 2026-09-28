/*
 * TOOLHELP's SystemHeapInfo and GlobalHandleToSel: how full USER's and
 * GDI's heaps are, where they are, and a global handle's selector.
 *
 * * `info`: `SystemHeapInfo`'s answer, then the two percentages free, for
 *   the structure's size and for a wrong one (the fields then as left).
 * * `percent`: `GetFreeSystemResources` for 1 and 2, beside them.
 * * `segment`: for USER's and GDI's heap handles, the handle's relation to
 *   its selector from `GlobalHandleToSel` (`same`, `plus1`, `minus1` or
 *   `other`), and to the data segment of the module (`ds` when the
 *   selector is the one `GetModuleHandle`'s module's instance names, as
 *   `LoadLibrary` of it answers).
 * * `select`: `GlobalHandleToSel` of a moveable block's handle, and of a
 *   fixed block's, beside `GlobalLock`'s selector: `same`, `plus1`,
 *   `minus1` or `other`; and of nought.
 */

#include "probe.h"

#include <toolhelp.h>

#define OUTPUT "C:\\ORACLE\\SYSHEAP.OUT"

static LPCSTR relation(WORD from, WORD to)
{
    if (from == to) {
        return "same";
    }

    if (from + 1 == to) {
        return "plus1";
    }

    if (from - 1 == to) {
        return "minus1";
    }

    return "other";
}

static void segment(LPCSTR name, HGLOBAL handle, LPCSTR module)
{
    WORD selector = GlobalHandleToSel(handle);
    HINSTANCE instance = LoadLibrary(module);

    wsprintf(probeResult, "%s %s", relation((WORD)handle, selector),
             (LPSTR)((WORD)instance == selector ? "ds" : relation((WORD)instance, selector)));
    probe("segment", name, probeResult);

    FreeLibrary(instance);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    SYSHEAPINFO info;
    HGLOBAL moveable;
    HGLOBAL fixed;
    BOOL answer;

    probeOpen(OUTPUT);

    info.dwSize = sizeof(info);
    answer = SystemHeapInfo(&info);
    wsprintf(probeResult, "%d %u %u", answer, info.wUserFreePercent, info.wGDIFreePercent);
    probe("info", "size", probeResult);

    wsprintf(probeResult, "%u %u", GetFreeSystemResources(2), GetFreeSystemResources(1));
    probe("percent", "user-gdi", probeResult);

    segment("user", info.hUserSegment, "USER.EXE");
    segment("gdi", info.hGDISegment, "GDI.EXE");

    info.dwSize = 4;
    info.wUserFreePercent = 0x1234;
    info.wGDIFreePercent = 0x5678;
    answer = SystemHeapInfo(&info);
    wsprintf(probeResult, "%d %x %x", answer, info.wUserFreePercent, info.wGDIFreePercent);
    probe("info", "wrong-size", probeResult);

    moveable = GlobalAlloc(GMEM_MOVEABLE, 64);
    fixed = GlobalAlloc(GMEM_FIXED, 64);

    wsprintf(probeResult, "%s", relation(HIWORD(GlobalLock(moveable)), GlobalHandleToSel(moveable)));
    probe("select", "moveable", probeResult);
    wsprintf(probeResult, "%s", relation(HIWORD(GlobalLock(fixed)), GlobalHandleToSel(fixed)));
    probe("select", "fixed", probeResult);
    wsprintf(probeResult, "%x", GlobalHandleToSel(0));
    probe("select", "none", probeResult);

    GlobalUnlock(moveable);
    GlobalFree(moveable);
    GlobalFree(fixed);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
