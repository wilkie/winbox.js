/*
 * What a block of the local heap holds when it is given where a freed one
 * was, with `LMEM_ZEROINIT` and without.
 *
 * Each case: a moveable block of 150 bytes, locked, filled with AAh and
 * freed, then another moveable one of 150 allocated in the program's own
 * heap, and locked.
 *
 * * `same`: whether the second's bytes are where the first's were.
 * * `zeroinit`, `plain`: its 150 bytes, as how many are nought, how many
 *   AAh, and how many anything else.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\LZERO.OUT"

static void one(LPCSTR name, UINT flags)
{
    HLOCAL old = LocalAlloc(LMEM_MOVEABLE, 150);
    BYTE NEAR *p = (BYTE NEAR *)LocalLock(old);
    HLOCAL block;
    BYTE NEAR *q;
    int i;
    int zero = 0;
    int aa = 0;
    int other = 0;

    for (i = 0; i < 150; i++) {
        p[i] = 0xaa;
    }

    LocalUnlock(old);
    LocalFree(old);

    block = LocalAlloc(LMEM_MOVEABLE | flags, 150);
    q = (BYTE NEAR *)LocalLock(block);
    probe("same", name, q == p ? "same" : "other");

    for (i = 0; i < 150; i++) {
        if (q[i] == 0) {
            zero++;
        } else if (q[i] == 0xaa) {
            aa++;
        } else {
            other++;
        }
    }

    wsprintf(probeResult, "zero=%d,aa=%d,other=%d", zero, aa, other);
    probe(name, "150", probeResult);
    LocalUnlock(block);
    LocalFree(block);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    probeOpen(OUTPUT);

    one("zeroinit", LMEM_ZEROINIT);
    one("plain", 0);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
