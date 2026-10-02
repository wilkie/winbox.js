/*
 * Whether `GlobalFree` gives a block's room back for the next `GlobalAlloc`,
 * and how many blocks there is room for.
 *
 * * `cycle`: a block of 1,024 bytes allocated and freed, 20,000 times over:
 *   how many of the allocations failed.
 * * `hold`: blocks of 1,024 bytes allocated and kept, until one fails or
 *   10,000 are held: how many there were. Then all are freed.
 * * `after`: one more block of 1,024 bytes, once they are freed: `ok` or
 *   `failed`.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\GCYCLE.OUT"

#define HOLD 10000

static HGLOBAL held[HOLD];

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    long failed = 0;
    long i;
    int count = 0;
    HGLOBAL one;

    probeOpen(OUTPUT);

    for (i = 0; i < 20000L; i++) {
        HGLOBAL block = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, 1024);

        if (!block) {
            failed++;
        } else {
            GlobalFree(block);
        }
    }

    wsprintf(probeResult, "failed=%ld", failed);
    probe("cycle", "20000", probeResult);

    while (count < HOLD) {
        HGLOBAL block = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, 1024);

        if (!block) {
            break;
        }

        held[count++] = block;
    }

    wsprintf(probeResult, "%d", count);
    probe("hold", "1024", probeResult);

    while (count > 0) {
        GlobalFree(held[--count]);
    }

    one = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, 1024);
    probe("after", "1024", one ? "ok" : "failed");

    if (one) {
        GlobalFree(one);
    }

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
