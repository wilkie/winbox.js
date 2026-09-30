/*
 * A local heap made by `LocalInit` in a block of `GlobalAlloc`'s, as the
 * Visual Basic runtime makes one, asked for more than it has.
 *
 * For a moveable block and then a fixed one, each 2,080 bytes: `LocalInit`
 * from 16 to 2,080, then with DS the block's, as the runtime calls them, a
 * block of 49 bytes and one of 638 (`LHND`), then blocks of 49 until
 * `LocalAlloc` fails or eighty have been made, then `LocalReAlloc` of the
 * 638 to 660.
 *
 * * `init`: `LocalInit`'s answer, and the block's `GlobalSize` before.
 * * `alloc`: each block that made the block's size change, or failed: its
 *   number, its offset (or nought), and the block's `GlobalSize` after.
 * * `count`: how many blocks of 49 were made, and the size at the end.
 * * `realloc`: `LocalReAlloc`'s answer, as whether it is nought, and the
 *   block's size after.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\LHEAPSEG.OUT"

extern UINT GetDS(void);
#pragma aux GetDS = "mov ax,ds" value[ax];

extern void SetDS(UINT);
#pragma aux SetDS = "mov ds,ax" parm[ax];

static HLOCAL allocIn(UINT segment, UINT flags, UINT size)
{
    HLOCAL block;
    UINT ds = GetDS();

    SetDS(segment);
    block = LocalAlloc(flags, size);
    SetDS(ds);

    return block;
}

static HLOCAL reallocIn(UINT segment, HLOCAL block, UINT size, UINT flags)
{
    HLOCAL answer;
    UINT ds = GetDS();

    SetDS(segment);
    answer = LocalReAlloc(block, size, flags);
    SetDS(ds);

    return answer;
}

static void heapIn(LPCSTR name, UINT flags)
{
    HGLOBAL global = GlobalAlloc(flags, 2080);
    UINT segment = SELECTOROF(GlobalLock(global));
    DWORD size = GlobalSize(global);
    HLOCAL big;
    HLOCAL block;
    int made = 0;
    int n;

    wsprintf(probeArgs, "%s", name);
    wsprintf(probeResult, "%d,%lu", LocalInit(segment, 16, 2080), size);
    probe("init", probeArgs, probeResult);

    allocIn(segment, LHND, 49);
    big = allocIn(segment, LHND, 638);
    wsprintf(probeArgs, "%s,638", name);
    wsprintf(probeResult, "%x,%lu", (UINT)big, GlobalSize(global));
    probe("alloc", probeArgs, probeResult);
    size = GlobalSize(global);

    for (n = 0; n < 80; n++) {
        block = allocIn(segment, LHND, 49);

        if (!block || GlobalSize(global) != size) {
            wsprintf(probeArgs, "%s,%d", name, n);
            wsprintf(probeResult, "%x,%lu", (UINT)block, GlobalSize(global));
            probe("alloc", probeArgs, probeResult);
            size = GlobalSize(global);
        }

        if (!block) {
            break;
        }

        made++;
    }

    wsprintf(probeResult, "%d,%lu", made, GlobalSize(global));
    probe("count", name, probeResult);

    block = reallocIn(segment, big, 660, LMEM_MOVEABLE | LMEM_ZEROINIT);
    wsprintf(probeResult, "%s,%lu", (LPSTR)(block ? "yes" : "no"), GlobalSize(global));
    probe("realloc", name, probeResult);

    GlobalUnlock(global);
    GlobalFree(global);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    probeOpen(OUTPUT);

    heapIn("moveable", GMEM_MOVEABLE | GMEM_ZEROINIT);
    heapIn("fixed", GMEM_FIXED | GMEM_ZEROINIT);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
