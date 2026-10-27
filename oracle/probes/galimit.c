/*
 * The sizes GlobalAlloc, GlobalReAlloc and GlobalDosAlloc grant and refuse,
 * around KERNEL's limits: 64 KiB, 1 MiB, 16 MiB less 64 KiB (the most a
 * block's 255 selectors reach), 16 MiB, and sizes far past them, as
 * OLECLI's GlobalAlloc(2, 68000000h). Sizes are in hex, free memory in
 * bytes, in hex.
 *
 * * `free`: GetFreeSpace(0) and GlobalCompact(0) as the probe starts, and
 *   GetFreeSpace(0) at the end.
 * * `alloc`: GlobalAlloc of a size with flags moveable, fixed or
 *   moveable+DDESHARE: `0` for refused, else GlobalSize of the block, then
 *   how much less GetFreeSpace(0) answers while it is held, and whether it
 *   answers as before once it is freed (`back`), or by how much it differs.
 * * `largest`: the largest moveable block GlobalAlloc grants, found by
 *   halving, to 1000h; GlobalCompact(0) and GetFreeSpace(0) just before;
 *   GlobalSize of it; and whether 1000h more is refused.
 * * `realloc`: a moveable or fixed block of 40h bytes given a size by
 *   GlobalReAlloc(GMEM_MOVEABLE): `0`, `same` or `other`, then GlobalSize
 *   of the block after.
 * * `dosalloc`: GlobalDosAlloc of a size: `0`, or GlobalSize of the block.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\GALIMIT.OUT"

static const DWORD sizes[] = {
    0x0L,        0x1L,        0xFFFFL,     0x10000L,    0x100000L,
    0x100001L,   0xFE0000L,   0xFF0000L,   0xFF0001L,   0xFFFFFFL,
    0x1000000L,  0x1000001L,  0x68000000L, 0xFFFFFFFFL,
};

#define COUNT (sizeof(sizes) / sizeof(sizes[0]))

static void alloc(LPCSTR flagName, UINT flags, DWORD size)
{
    DWORD before = GetFreeSpace(0);
    HGLOBAL block = GlobalAlloc(flags, size);
    char args[40];

    wsprintf(args, "%s %lx", flagName, size);

    if (!block) {
        DWORD after = GetFreeSpace(0);

        if (after == before) {
            probe("alloc", args, "0 same");
        } else {
            wsprintf(probeResult, "0 %lx", before - after);
            probe("alloc", args, probeResult);
        }

        return;
    }

    {
        DWORD held = GetFreeSpace(0);
        DWORD granted = GlobalSize(block);
        DWORD after;

        GlobalFree(block);
        after = GetFreeSpace(0);

        if (after == before) {
            wsprintf(probeResult, "%lx %lx back", granted, before - held);
        } else {
            wsprintf(probeResult, "%lx %lx %lx", granted, before - held, before - after);
        }

        probe("alloc", args, probeResult);
    }
}

static BOOL fits(DWORD size)
{
    HGLOBAL block = GlobalAlloc(GMEM_MOVEABLE, size);

    if (!block) {
        return FALSE;
    }

    GlobalFree(block);
    return TRUE;
}

static void largest(void)
{
    DWORD compact = GlobalCompact(0);
    DWORD space = GetFreeSpace(0);
    DWORD low = 0x100000L;
    DWORD high = 0x1000000L;
    HGLOBAL block;

    /* low fits, high does not. */
    while (high - low > 0x1000L) {
        DWORD middle = low + ((high - low) / 2 & ~0xFFFL);

        if (fits(middle)) {
            low = middle;
        } else {
            high = middle;
        }
    }

    wsprintf(probeResult, "%lx", compact);
    probe("largest", "compact-before", probeResult);
    wsprintf(probeResult, "%lx", space);
    probe("largest", "free-before", probeResult);
    wsprintf(probeResult, "%lx", low);
    probe("largest", "granted", probeResult);

    block = GlobalAlloc(GMEM_MOVEABLE, low);
    wsprintf(probeResult, "%lx", block ? GlobalSize(block) : 0L);
    probe("largest", "size", probeResult);

    if (block) {
        GlobalFree(block);
    }

    probe("largest", "1000-more", fits(low + 0x1000L) ? "granted" : "refused");
}

static void resize(LPCSTR flagName, UINT flags, DWORD size)
{
    HGLOBAL block = GlobalAlloc(flags, 0x40L);
    HGLOBAL after = GlobalReAlloc(block, size, GMEM_MOVEABLE);
    char args[40];

    wsprintf(args, "%s %lx", flagName, size);
    wsprintf(probeResult, "%s %lx", (LPSTR)(!after ? "0" : after == block ? "same" : "other"),
             GlobalSize(after ? after : block));
    probe("realloc", args, probeResult);
    GlobalFree(after ? after : block);
}

static void dosalloc(DWORD size)
{
    DWORD both = GlobalDosAlloc(size);
    char args[40];

    wsprintf(args, "%lx", size);

    if (!both) {
        probe("dosalloc", args, "0");
        return;
    }

    wsprintf(probeResult, "%lx", GlobalSize((HGLOBAL)LOWORD(both)));
    probe("dosalloc", args, probeResult);
    GlobalDosFree(LOWORD(both));
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    unsigned i;

    probeOpen(OUTPUT);

    wsprintf(probeResult, "%lx", GetFreeSpace(0));
    probe("free", "start", probeResult);
    wsprintf(probeResult, "%lx", GlobalCompact(0));
    probe("free", "compact", probeResult);

    for (i = 0; i < COUNT; i++) {
        alloc("moveable", GMEM_MOVEABLE, sizes[i]);
        alloc("fixed", GMEM_FIXED, sizes[i]);
        alloc("ddeshare", GMEM_MOVEABLE | GMEM_DDESHARE, sizes[i]);
    }

    /* As OLECLI asks. */
    alloc("olecli", 2, 0x68000000L);

    largest();

    for (i = 0; i < COUNT; i++) {
        resize("moveable", GMEM_MOVEABLE, sizes[i]);
        resize("fixed", GMEM_FIXED, sizes[i]);
    }

    for (i = 0; i < COUNT; i++) {
        dosalloc(sizes[i]);
    }

    wsprintf(probeResult, "%lx", GetFreeSpace(0));
    probe("free", "end", probeResult);

    probeFinish();

    return 0;
}
