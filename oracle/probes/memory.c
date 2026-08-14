/*
 * KERNEL memory management.
 *
 * A handle is not a comparable thing. `GlobalAlloc` hands back whatever the
 * allocator felt like, and two runs of real Windows need not agree with each
 * other, let alone with us -- so recording handle values would record noise.
 * What is comparable is everything derived from them: the size the allocator
 * settled on, the flags it reports back, whether the offset of a locked block
 * is zero, whether a handle survives being freed.
 *
 * The rounding is the interesting part and the part nobody documents. Windows
 * allocates in whatever granularity its heap works in, and `GlobalSize` reports
 * what you actually got rather than what you asked for, so a program that asks
 * for 1 byte and writes 32 may work by accident for thirty years. Whether we
 * round the same way decides whether such a program works here.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\MEMORY.OUT"

/* Records the size a global allocation actually came back as. */
static void probeGlobalSize(WORD flags, DWORD request)
{
    HGLOBAL handle = GlobalAlloc(flags, request);

    wsprintf(probeArgs, "0x%04X,%lu", flags, request);

    if (handle == NULL) {
        lstrcpy(probeResult, "failed");
    } else {
        wsprintf(probeResult, "%lu", GlobalSize(handle));
    }

    probe("GlobalAlloc+GlobalSize", probeArgs, probeResult);

    if (handle != NULL) {
        GlobalFree(handle);
    }
}

/* Records the flags a global allocation reports after it is made. */
static void probeGlobalFlags(WORD flags)
{
    HGLOBAL handle = GlobalAlloc(flags, 64);

    wsprintf(probeArgs, "0x%04X", flags);

    if (handle == NULL) {
        lstrcpy(probeResult, "failed");
    } else {
        /* The low byte is the lock count and the high byte the flags, so a
         * freshly made block should report a count of zero.
         */
        wsprintf(probeResult, "0x%04X", GlobalFlags(handle));
        GlobalFree(handle);
    }

    probe("GlobalFlags", probeArgs, probeResult);
}

/*
 * Records what locking a block gives back.
 *
 * The selector is the allocator's business, but the offset is not: a global
 * block starts at the beginning of its segment, and software relies on that.
 */
static void probeGlobalLock(WORD flags)
{
    HGLOBAL handle = GlobalAlloc(flags, 128);
    LPSTR pointer;

    wsprintf(probeArgs, "0x%04X", flags);

    if (handle == NULL) {
        probe("GlobalLock", probeArgs, "failed");
        return;
    }

    pointer = (LPSTR)GlobalLock(handle);

    if (pointer == NULL) {
        lstrcpy(probeResult, "null");
    } else {
        wsprintf(probeResult, "offset=%u,handle-is-selector=%d",
                 (WORD)((DWORD)pointer & 0xFFFF),
                 (int)(HIWORD((DWORD)pointer) == handle));
    }

    GlobalUnlock(handle);
    GlobalFree(handle);

    probe("GlobalLock", probeArgs, probeResult);
}

/* Records that freeing really does release the handle. */
static void probeGlobalFree(void)
{
    HGLOBAL handle = GlobalAlloc(GMEM_MOVEABLE, 256);
    HGLOBAL freed;

    if (handle == NULL) {
        probe("GlobalFree", "GMEM_MOVEABLE,256", "failed to allocate");
        return;
    }

    freed = GlobalFree(handle);

    wsprintf(probeResult, "returns=%s", freed == NULL ? "null" : "handle");
    probe("GlobalFree", "GMEM_MOVEABLE,256", probeResult);
}

/* The same questions of the local heap, which is a different allocator. */
static void probeLocalSize(WORD flags, WORD request)
{
    HLOCAL handle = LocalAlloc(flags, request);

    wsprintf(probeArgs, "0x%04X,%u", flags, request);

    if (handle == NULL) {
        lstrcpy(probeResult, "failed");
    } else {
        wsprintf(probeResult, "%u", LocalSize(handle));
        LocalFree(handle);
    }

    probe("LocalAlloc+LocalSize", probeArgs, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    probeOpen(OUTPUT);

    probeNote("what GlobalAlloc rounds a request up to");
    probeGlobalSize(GMEM_MOVEABLE, 1);
    probeGlobalSize(GMEM_MOVEABLE, 2);
    probeGlobalSize(GMEM_MOVEABLE, 15);
    probeGlobalSize(GMEM_MOVEABLE, 16);
    probeGlobalSize(GMEM_MOVEABLE, 17);
    probeGlobalSize(GMEM_MOVEABLE, 32);
    probeGlobalSize(GMEM_MOVEABLE, 100);
    probeGlobalSize(GMEM_MOVEABLE, 1024);
    probeGlobalSize(GMEM_MOVEABLE, 4096);
    probeGlobalSize(GMEM_MOVEABLE, 65536L);

    probeNote("and the same for fixed blocks");
    probeGlobalSize(GMEM_FIXED, 1);
    probeGlobalSize(GMEM_FIXED, 16);
    probeGlobalSize(GMEM_FIXED, 1024);

    probeNote("a request of nothing at all");
    probeGlobalSize(GMEM_MOVEABLE, 0);
    probeGlobalSize(GMEM_FIXED, 0);

    probeNote("zero-initialised memory is a flag, not a guarantee");
    probeGlobalSize(GMEM_MOVEABLE | GMEM_ZEROINIT, 100);
    probeGlobalSize(GMEM_FIXED | GMEM_ZEROINIT, 100);

    probeNote("GlobalFlags");
    probeGlobalFlags(GMEM_MOVEABLE);
    probeGlobalFlags(GMEM_FIXED);
    probeGlobalFlags(GMEM_MOVEABLE | GMEM_DISCARDABLE);

    probeNote("GlobalLock");
    probeGlobalLock(GMEM_MOVEABLE);
    probeGlobalLock(GMEM_FIXED);

    probeNote("GlobalFree");
    probeGlobalFree();

    probeNote("the local heap rounds differently");
    probeLocalSize(LMEM_MOVEABLE, 1);
    probeLocalSize(LMEM_MOVEABLE, 15);
    probeLocalSize(LMEM_MOVEABLE, 16);
    probeLocalSize(LMEM_MOVEABLE, 17);
    probeLocalSize(LMEM_MOVEABLE, 100);
    probeLocalSize(LMEM_FIXED, 1);
    probeLocalSize(LMEM_FIXED, 16);
    probeLocalSize(LMEM_FIXED, 100);

    probeFinish();
    return 0;
}
