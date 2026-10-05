/*
 * A global block's lock count, and what freeing a locked block does: as
 * Cell Wars frees a block it may have locked more than it unlocked --
 * GlobalHandle of its selector, GlobalUnlock, GlobalFree -- and reads it
 * again afterwards through a far pointer it kept.
 *
 * Each case allocates 64 bytes, with the flags it names, and:
 *
 * * `flags`: GlobalFlags after each step, in hexadecimal (its low byte the
 *   lock count).
 * * `lock`: what GlobalLock answers (`ok` for a pointer, else `null`), and
 *   `unlock`: what GlobalUnlock answers, at each step.
 * * `free`: what GlobalFree answers (nought for freed, else the handle as
 *   `handle`), and then `after`: whether the handle still names a block --
 *   GlobalSize, GlobalFlags --, what GlobalHandle of the old selector
 *   answers, and whether the old pointer is still readable (IsBadReadPtr).
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\GLOCKS.OUT"

static void step(LPCSTR name, LPCSTR what, LPCSTR result)
{
    char args[64];

    wsprintf(args, "%s,%s", name, what);
    probe("step", args, result);
}

static void flags(LPCSTR name, LPCSTR when, HGLOBAL handle)
{
    char result[32];

    wsprintf(result, "flags=%x", GlobalFlags(handle));
    step(name, when, result);
}

/* A block of `kind`, locked `locks` times, unlocked `unlocks` times, freed. */
static void block(LPCSTR name, UINT kind, int locks, int unlocks, BOOL byHandleOfSelector)
{
    char result[96];
    char when[32];
    HGLOBAL handle = GlobalAlloc(kind, 64);
    void FAR *pointer = NULL;
    HGLOBAL freed;
    int i;

    flags(name, "allocated", handle);

    for (i = 0; i < locks; i++) {
        pointer = GlobalLock(handle);
        wsprintf(result, "%s", pointer ? (LPSTR)"ok" : (LPSTR)"null");
        wsprintf(when, "lock%d", i + 1);
        step(name, when, result);
        wsprintf(when, "after-lock%d", i + 1);
        flags(name, when, handle);
    }

    if (byHandleOfSelector && pointer) {
        DWORD found = GlobalHandle(SELECTOROF(pointer));

        wsprintf(result, "%s", LOWORD(found) == (UINT)handle ? (LPSTR)"same" : (LPSTR)"other");
        step(name, "handle-of-selector", result);
    }

    for (i = 0; i < unlocks; i++) {
        wsprintf(result, "%d", GlobalUnlock(handle));
        wsprintf(when, "unlock%d", i + 1);
        step(name, when, result);
        wsprintf(when, "after-unlock%d", i + 1);
        flags(name, when, handle);
    }

    freed = GlobalFree(handle);
    wsprintf(result, "%s", freed == NULL ? (LPSTR)"0" : freed == handle ? (LPSTR)"handle"
                                                                            : (LPSTR)"other");
    step(name, "free", result);

    wsprintf(result, "size=%lu,flags=%x", GlobalSize(handle), GlobalFlags(handle));
    step(name, "after-handle", result);

    if (pointer) {
        DWORD found = GlobalHandle(SELECTOROF(pointer));

        wsprintf(result, "handle=%s,readable=%s",
                 found == 0 ? (LPSTR)"0" : LOWORD(found) == (UINT)handle ? (LPSTR)"same" : (LPSTR)"other",
                 IsBadReadPtr(pointer, 8) ? (LPSTR)"no" : (LPSTR)"yes");
        step(name, "after-pointer", result);
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    probeOpen(OUTPUT);

    block("moveable-0", GMEM_MOVEABLE, 0, 0, FALSE);
    block("moveable-1-1", GMEM_MOVEABLE, 1, 1, FALSE);
    block("moveable-1-0", GMEM_MOVEABLE, 1, 0, FALSE);
    block("moveable-2-1", GMEM_MOVEABLE, 2, 1, TRUE);
    block("moveable-3-1", GMEM_MOVEABLE, 3, 1, FALSE);
    block("moveable-1-2", GMEM_MOVEABLE, 1, 2, FALSE);
    block("fixed-1-0", GMEM_FIXED, 1, 0, FALSE);
    block("fixed-2-1", GMEM_FIXED, 2, 1, FALSE);
    block("discardable-2-1", GMEM_MOVEABLE | GMEM_DISCARDABLE, 2, 1, FALSE);
    block("discardable-1-0", GMEM_MOVEABLE | GMEM_DISCARDABLE, 1, 0, TRUE);

    probeFinish();

    return 0;
}
