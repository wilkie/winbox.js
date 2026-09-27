/*
 * `LocalReAlloc`: what a block keeps when it is given a new size.
 *
 * Each block is filled through its pointer with a pattern -- byte `i` is
 * `0x40 + i` -- and a block allocated after it, so that growing it cannot
 * happen where it is. Then:
 *
 * * `re`: for each step, whether the answer is the handle given, another
 *   value, or nought; whether the block moved; its size after; how many of
 *   the pattern's bytes it kept, from the start; and its bytes past the
 *   pattern, up to eight, as hexadecimal, where they are defined: a block
 *   shrunk keeps them, and `LMEM_ZEROINIT` makes the gained ones noughts;
 *   otherwise they are whatever the heap held there, and not recorded.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\LOCALRE.OUT"

static void fill(LPSTR at, int count)
{
    int index;

    for (index = 0; index < count; index++) {
        at[index] = (char)(0x40 + index);
    }
}

static void step(LPCSTR name, HLOCAL given, HLOCAL answer, char NEAR *before, int pattern,
                 BOOL moveable, BOOL defined)
{
    char NEAR *after;
    int kept = 0;
    int index;
    int size;
    LPSTR out;

    if (!answer) {
        wsprintf(probeResult, "answer=0");
        probe("re", name, probeResult);
        return;
    }

    after = moveable ? (char NEAR *)LocalLock(answer) : (char NEAR *)answer;
    size = LocalSize(answer);

    while (kept < pattern && kept < size && after[kept] == (char)(0x40 + kept)) {
        kept++;
    }

    wsprintf(probeResult, "answer=%s,moved=%d,size=%d,kept=%d,past=",
             (LPSTR)(answer == given ? "same" : "other"), after != before ? 1 : 0, size, kept);
    out = probeResult + lstrlen(probeResult);

    for (index = pattern; defined && index < size && index < pattern + 8; index++) {
        wsprintf(out, "%02x", (BYTE)after[index]);
        out += 2;
    }

    if (moveable) {
        LocalUnlock(answer);
    }

    probe("re", name, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HLOCAL block;
    HLOCAL fence;
    HLOCAL answer;
    char NEAR *at;

    probeOpen(OUTPUT);

    /* A moveable block, grown past its neighbour. */
    block = LocalAlloc(LMEM_MOVEABLE, 16);
    fence = LocalAlloc(LMEM_FIXED, 16);
    at = (char NEAR *)LocalLock(block);
    fill(at, 16);
    LocalUnlock(block);
    answer = LocalReAlloc(block, 200, LMEM_MOVEABLE);
    step("moveable-grow", block, answer, at, 16, TRUE, FALSE);

    /* And shrunk. */
    at = (char NEAR *)LocalLock(block);
    LocalUnlock(block);
    answer = LocalReAlloc(block, 6, LMEM_MOVEABLE);
    step("moveable-shrink", block, answer, at, 6, TRUE, TRUE);

    /* Grown with the new bytes asked for as noughts. */
    at = (char NEAR *)LocalLock(block);
    fill(at, 6);
    LocalUnlock(block);
    answer = LocalReAlloc(block, 40, LMEM_MOVEABLE | LMEM_ZEROINIT);
    step("moveable-zeroinit", block, answer, at, 6, TRUE, TRUE);
    LocalFree(block);
    LocalFree(fence);

    /* Shrunk from 64 to each size, and grown from 16 where there is room. */
    {
        static const int SIZES[] = { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 30, 34, 38, 42, 46, 50, 54, 56, 58, 60 };
        char name[24];
        int index;

        for (index = 0; index < 23; index++) {
            block = LocalAlloc(LMEM_MOVEABLE, 64);
            fence = LocalAlloc(LMEM_FIXED, 16);
            at = (char NEAR *)LocalLock(block);
            fill(at, 64);
            LocalUnlock(block);
            answer = LocalReAlloc(block, SIZES[index], LMEM_MOVEABLE);
            wsprintf(name, "shrink-%d", SIZES[index]);
            step(name, block, answer, at, SIZES[index], TRUE, TRUE);
            LocalFree(block);
            LocalFree(fence);
        }

        block = LocalAlloc(LMEM_MOVEABLE, 16);
        at = (char NEAR *)LocalLock(block);
        fill(at, 16);
        LocalUnlock(block);
        answer = LocalReAlloc(block, 30, LMEM_MOVEABLE);
        step("grow-last", block, answer, at, 16, TRUE, FALSE);
        LocalFree(block);
    }

    /* A fixed block, which may move only when told it may. */
    block = LocalAlloc(LMEM_FIXED, 16);
    fence = LocalAlloc(LMEM_FIXED, 16);
    fill((LPSTR)(char NEAR *)block, 16);
    answer = LocalReAlloc(block, 200, 0);
    step("fixed-grow-stay", block, answer, (char NEAR *)block, 16, FALSE, FALSE);
    answer = LocalReAlloc(block, 200, LMEM_MOVEABLE);
    step("fixed-grow-move", block, answer, (char NEAR *)block, 16, FALSE, FALSE);
    LocalFree(answer ? answer : block);
    LocalFree(fence);

    probeFinish();

    return 0;
}
