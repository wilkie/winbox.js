/*
 * How `GlobalAlloc` and `GlobalReAlloc` round a size, as `GlobalSize`
 * reports it after. KERNEL's default local notify procedure grows a heap's
 * segment by `GlobalReAlloc` and lays the heap's new end by `GlobalSize`
 * (`KRNL386.EXE` seg1 `8e52`-`8e66`); `locinfo`'s heap ended where a size of
 * 3510h, not a multiple of 32, put it.
 *
 * * `alloc`: `GlobalSize` of a block allocated with the size, moveable and
 *   fixed, in hexadecimal.
 * * `realloc`: `GlobalSize` of a block of 100h, moveable and fixed, after
 *   `GlobalReAlloc` to the size.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\GRROUND.OUT"

static const DWORD SIZES[] = { 0x101, 0x110, 0x111, 0x120, 0x130, 0x2ff0, 0x3510, 0x3511, 0x3520 };

static void alloc(UINT flags, LPCSTR kind, DWORD size)
{
    HGLOBAL block = GlobalAlloc(flags, size);

    wsprintf(probeArgs, "%s %lx", kind, size);
    wsprintf(probeResult, "%lx", block ? GlobalSize(block) : 0L);
    probe("alloc", probeArgs, probeResult);

    if (block) {
        GlobalFree(block);
    }
}

static void realloc(UINT flags, LPCSTR kind, DWORD size)
{
    HGLOBAL block = GlobalAlloc(flags, 0x100);
    HGLOBAL grown = block ? GlobalReAlloc(block, size, GMEM_MOVEABLE) : NULL;

    wsprintf(probeArgs, "%s %lx", kind, size);
    wsprintf(probeResult, "%lx", grown ? GlobalSize(grown) : 0L);
    probe("realloc", probeArgs, probeResult);

    GlobalFree(grown ? grown : block);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    int i;

    probeOpen(OUTPUT);

    for (i = 0; i < sizeof(SIZES) / sizeof(SIZES[0]); i++) {
        alloc(GMEM_MOVEABLE, "moveable", SIZES[i]);
        alloc(GMEM_FIXED, "fixed", SIZES[i]);
        realloc(GMEM_MOVEABLE, "moveable", SIZES[i]);
        realloc(GMEM_FIXED, "fixed", SIZES[i]);
    }

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
