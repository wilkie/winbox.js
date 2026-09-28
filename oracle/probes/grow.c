/*
 * GlobalReAlloc growing a block past 64 KiB, so that it needs more
 * selectors than it was given: as Bubble Girl's engine grows its buffers.
 *
 * * `answer`: what GlobalReAlloc answered, as `same` for the handle it was
 *   given, `other` for another, or `0`.
 * * `selector`: whether GlobalLock's selector after is `same` as before, or
 *   `other`.
 * * `kept`: whether the block's first 32 KiB are as they were written.
 * * `size`: GlobalSize after, in hex.
 * * `limits`: the limits of the block's selector and the next one on, by
 *   the huge step (`__AHINCR`), in hex; `bad` for a selector that is not.
 * * `zero`: whether bytes past the old size are nought, where
 *   GMEM_ZEROINIT was asked for.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\GROW.OUT"

extern WORD _AHINCR;

static void answer(LPCSTR name, HGLOBAL before, HGLOBAL after)
{
    probe("answer", name, !after ? "0" : after == before ? "same" : "other");
}

static WORD selectorOf(HGLOBAL block)
{
    WORD selector = HIWORD((DWORD)GlobalLock(block));

    GlobalUnlock(block);
    return selector;
}

static void fill(HGLOBAL block)
{
    BYTE __huge *at = (BYTE __huge *)GlobalLock(block);
    long i;

    for (i = 0; i < 0x8000L; i++) {
        at[i] = (BYTE)(i * 7);
    }

    GlobalUnlock(block);
}

static BOOL intact(HGLOBAL block)
{
    BYTE __huge *at = (BYTE __huge *)GlobalLock(block);
    BOOL good = TRUE;
    long i;

    for (i = 0; i < 0x8000L && good; i++) {
        good = at[i] == (BYTE)(i * 7);
    }

    GlobalUnlock(block);
    return good;
}

static void limits(LPCSTR name, HGLOBAL block)
{
    WORD selector = selectorOf(block);
    DWORD first = GetSelectorLimit(selector);
    DWORD second = GetSelectorLimit(selector + (WORD)(&_AHINCR));

    wsprintf(probeResult, "%lx %lx", first, second);
    probe("limits", name, probeResult);
}

static void grow(LPCSTR name, UINT flags, UINT reflags, BOOL locked)
{
    HGLOBAL block = GlobalAlloc(flags, 0x8000L);
    WORD before;
    HGLOBAL after;

    fill(block);
    before = selectorOf(block);

    if (locked) {
        GlobalLock(block);
    }

    after = GlobalReAlloc(block, 0x15000L, reflags);
    answer(name, block, after);

    if (locked) {
        GlobalUnlock(block);
    }

    if (after) {
        block = after;
        probe("selector", name, selectorOf(block) == before ? "same" : "other");
        probe("kept", name, intact(block) ? "yes" : "no");
        wsprintf(probeResult, "%lx", GlobalSize(block));
        probe("size", name, probeResult);
        limits(name, block);

        if (reflags & GMEM_ZEROINIT) {
            BYTE __huge *at = (BYTE __huge *)GlobalLock(block);
            long i;
            BOOL zero = TRUE;

            for (i = 0x8000L; i < 0x15000L && zero; i++) {
                zero = at[i] == 0;
            }

            GlobalUnlock(block);
            probe("zero", name, zero ? "yes" : "no");
        }

        /* And back down under 64 KiB. */
        after = GlobalReAlloc(block, 0x4000L, GMEM_MOVEABLE);
        answer("shrink", block, after);

        if (after) {
            block = after;
            wsprintf(probeResult, "%lx", GlobalSize(block));
            probe("size", "shrink", probeResult);
            limits("shrink", block);
        }
    }

    GlobalFree(block);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    probeOpen(OUTPUT);

    grow("moveable", GMEM_MOVEABLE, GMEM_MOVEABLE, FALSE);
    grow("moveable-zero", GMEM_MOVEABLE, GMEM_MOVEABLE | GMEM_ZEROINIT, FALSE);
    grow("moveable-nocompact", GMEM_MOVEABLE, GMEM_MOVEABLE | GMEM_NOCOMPACT, FALSE);
    grow("locked", GMEM_MOVEABLE, GMEM_MOVEABLE, TRUE);
    grow("fixed", GMEM_FIXED, 0, FALSE);
    grow("fixed-moveable", GMEM_FIXED, GMEM_MOVEABLE, FALSE);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
