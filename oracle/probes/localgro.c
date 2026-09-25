/*
 * A local heap asked for more than it has.
 *
 * A program's local heap is the end of its data segment, as big as its
 * module's header says. Notepad's is 2,048 bytes, and its first large
 * `LocalAlloc` asks for 3,072. This records what `LocalAlloc` does when a
 * request does not fit:
 *
 * * `dataseg`: the data segment's size, from `GlobalSize`, before anything is
 *   allocated.
 * * `grow`: three blocks of 1,000 bytes, then one of 3,072, fixed, then 4,096 at a time until
 *   `LocalAlloc` fails or twenty have been made: each block's offset, its
 *   `LocalSize`, and the data segment's size after it.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\LOCALGRO.OUT"

static DWORD segmentSize(void)
{
    static int anchor;
    HGLOBAL data = (HGLOBAL)LOWORD(GlobalHandle(SELECTOROF((LPVOID)&anchor)));

    return GlobalSize(data);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HLOCAL block;
    int index;

    probeOpen(OUTPUT);

    wsprintf(probeResult, "%lu", segmentSize());
    probe("dataseg", "start", probeResult);

    /* Sizes that are not a multiple of 32 first: a growth of the block and 540
     * bytes, and one of the block and 512 rounded up to 32, agree on every
     * multiple of 32. */
    for (index = 0; index < 3; index++) {
        block = LocalAlloc(LMEM_FIXED, 1000);
        wsprintf(probeArgs, "1000,%d", index);
        wsprintf(probeResult, "block=%04x,size=%u,segment=%lu", (UINT)block,
                 block ? LocalSize(block) : 0, segmentSize());
        probe("grow", probeArgs, probeResult);
    }

    block = LocalAlloc(LMEM_FIXED, 3072);
    wsprintf(probeResult, "block=%04x,size=%u,segment=%lu", (UINT)block,
             block ? LocalSize(block) : 0, segmentSize());
    probe("grow", "3072", probeResult);

    for (index = 0; index < 20; index++) {
        block = LocalAlloc(LMEM_FIXED, 4096);
        wsprintf(probeArgs, "4096,%d", index);
        wsprintf(probeResult, "block=%04x,size=%u,segment=%lu", (UINT)block,
                 block ? LocalSize(block) : 0, segmentSize());
        probe("grow", probeArgs, probeResult);

        if (!block) {
            break;
        }
    }

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
