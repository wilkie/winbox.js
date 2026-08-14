/*
 * What a global handle actually is.
 *
 * The memory probe left a contradiction behind. `GlobalLock` on real Windows
 * returns a pointer whose selector is not the handle -- for `GMEM_FIXED` as
 * well as moveable blocks -- and the usual account says a fixed global handle
 * *is* its selector. One of those is wrong, and until it is settled there is no
 * model of the handle table, only a discrepancy.
 *
 * So this asks the questions that make the relationship visible, and asks them
 * about the same block from several directions:
 *
 *   - does `GlobalHandle` turn a locked pointer back into the handle it came
 *     from, and is the answer the same for fixed and moveable blocks?
 *   - what is the numerical relationship between a handle and its selector?
 *     Not their values, which are the allocator's business, but whether they
 *     differ by a constant, or in their low bits, or not at all.
 *   - does locking twice give the same pointer, and does the lock count in
 *     `GlobalFlags` follow?
 *   - does a moveable block keep its address across an unlock and a relock,
 *     when other allocations have happened in between? That is the question
 *     that decides whether "moveable" means anything here.
 *   - does `GlobalReAlloc` keep the handle, and does it keep the address?
 *
 * The last two are what matter for compatibility. A program that locks a
 * moveable block, allocates, and keeps using the old pointer is relying on the
 * block not having moved, and thirty years of software has that bug latent in
 * it. Whether it is a bug here depends on whether we move blocks at all.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\HANDLES.OUT"

/* Ties a handle to the selector its pointer carries. */
static void probeIdentity(WORD flags, LPCSTR name)
{
    HGLOBAL handle = GlobalAlloc(flags, 256);
    DWORD pointer;
    WORD selector;

    if (handle == NULL) {
        probe("identity", name, "failed");
        return;
    }

    pointer = (DWORD)GlobalLock(handle);
    selector = HIWORD(pointer);

    /* The values themselves are the allocator's to choose, so what gets
     * recorded is the relationship: whether they are equal, what separates
     * them, and whether the difference is in the low three bits -- which is
     * where a selector keeps its table and privilege bits, and so where a
     * handle and a selector would differ if one were derived from the other.
     */
    wsprintf(probeResult,
             "equal=%d,difference=%d,low3=%d/%d",
             (int)(selector == handle),
             (int)((short)selector - (short)handle),
             (int)(handle & 7),
             (int)(selector & 7));

    probe("identity", name, probeResult);

    GlobalUnlock(handle);
    GlobalFree(handle);
}

/* Asks whether a locked pointer can be turned back into its handle. */
static void probeRoundTrip(WORD flags, LPCSTR name)
{
    HGLOBAL handle = GlobalAlloc(flags, 256);
    LPSTR pointer;
    HGLOBAL back;

    if (handle == NULL) {
        probe("GlobalHandle", name, "failed");
        return;
    }

    pointer = (LPSTR)GlobalLock(handle);
    back = (HGLOBAL)GlobalHandle(HIWORD((DWORD)pointer));

    wsprintf(probeResult, "recovered=%d", (int)(back == handle));
    probe("GlobalHandle", name, probeResult);

    GlobalUnlock(handle);
    GlobalFree(handle);
}

/* Follows the lock count through repeated locks. */
static void probeLockCount(WORD flags, LPCSTR name)
{
    HGLOBAL handle = GlobalAlloc(flags, 256);
    DWORD first;
    DWORD second;

    if (handle == NULL) {
        probe("lock count", name, "failed");
        return;
    }

    wsprintf(probeArgs, "%s", (LPSTR)name);

    first = (DWORD)GlobalLock(handle);
    second = (DWORD)GlobalLock(handle);

    /* The low byte of GlobalFlags is the lock count. A fixed block is always
     * addressable and may not bother counting.
     */
    wsprintf(probeResult,
             "same=%d,count=%d",
             (int)(first == second),
             (int)(GlobalFlags(handle) & 0x00FF));

    probe("lock count", probeArgs, probeResult);

    GlobalUnlock(handle);
    GlobalUnlock(handle);
    GlobalFree(handle);
}

/*
 * Asks whether a block stays where it was.
 *
 * Between the two locks the heap is stirred: several blocks are allocated and
 * the ones between are freed, which is the situation a compacting allocator
 * would take as an invitation to move things.
 */
static void probeStability(WORD flags, LPCSTR name)
{
    HGLOBAL handle = GlobalAlloc(flags, 256);
    HGLOBAL filler[8];
    DWORD before;
    DWORD after;
    int index;

    if (handle == NULL) {
        probe("stability", name, "failed");
        return;
    }

    before = (DWORD)GlobalLock(handle);
    GlobalUnlock(handle);

    for (index = 0; index < 8; index++) {
        filler[index] = GlobalAlloc(GMEM_MOVEABLE, 4096);
    }

    for (index = 0; index < 8; index += 2) {
        if (filler[index] != NULL) {
            GlobalFree(filler[index]);
            filler[index] = NULL;
        }
    }

    GlobalCompact(0);

    after = (DWORD)GlobalLock(handle);

    wsprintf(probeResult, "moved=%d", (int)(before != after));
    probe("stability", name, probeResult);

    GlobalUnlock(handle);
    GlobalFree(handle);

    for (index = 0; index < 8; index++) {
        if (filler[index] != NULL) {
            GlobalFree(filler[index]);
        }
    }
}

/* Asks what survives a resize. */
static void probeReAlloc(WORD flags, DWORD from, DWORD to, LPCSTR name)
{
    HGLOBAL handle = GlobalAlloc(flags, from);
    HGLOBAL resized;
    DWORD before;
    DWORD after;

    if (handle == NULL) {
        probe("GlobalReAlloc", name, "failed");
        return;
    }

    before = (DWORD)GlobalLock(handle);
    GlobalUnlock(handle);

    resized = GlobalReAlloc(handle, to, flags);

    wsprintf(probeArgs, "%s,%lu->%lu", (LPSTR)name, from, to);

    if (resized == NULL) {
        lstrcpy(probeResult, "failed");
    } else {
        after = (DWORD)GlobalLock(resized);

        wsprintf(probeResult,
                 "same-handle=%d,same-address=%d,size=%lu",
                 (int)(resized == handle),
                 (int)(before == after),
                 GlobalSize(resized));

        GlobalUnlock(resized);
        GlobalFree(resized);
    }

    probe("GlobalReAlloc", probeArgs, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    probeOpen(OUTPUT);

    probeNote("is a handle its selector");
    probeIdentity(GMEM_MOVEABLE, "moveable");
    probeIdentity(GMEM_FIXED, "fixed");
    probeIdentity(GMEM_MOVEABLE | GMEM_DISCARDABLE, "discardable");

    probeNote("and can a pointer be turned back into one");
    probeRoundTrip(GMEM_MOVEABLE, "moveable");
    probeRoundTrip(GMEM_FIXED, "fixed");

    probeNote("locking twice");
    probeLockCount(GMEM_MOVEABLE, "moveable");
    probeLockCount(GMEM_FIXED, "fixed");

    probeNote("does an unlocked block stay put");
    probeStability(GMEM_MOVEABLE, "moveable");
    probeStability(GMEM_FIXED, "fixed");

    probeNote("GlobalReAlloc");
    probeReAlloc(GMEM_MOVEABLE, 256, 1024, "moveable grow");
    probeReAlloc(GMEM_MOVEABLE, 1024, 256, "moveable shrink");
    probeReAlloc(GMEM_FIXED, 256, 1024, "fixed grow");
    probeReAlloc(GMEM_MOVEABLE, 256, 256, "moveable same");

    probeFinish();
    return 0;
}
