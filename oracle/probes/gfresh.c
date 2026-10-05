/*
 * What a program's first global blocks hold, asked for without
 * `GMEM_ZEROINIT`: the blocks Borland's run-time library takes for its far
 * heap as a program starts, which TC Trekwar's game object is carved from.
 * Its field at 82h is read before anything writes it (corpus `trekwar`,
 * logical segment 9 offset 1ECBh).
 *
 * The three blocks Trekwar's library asks for, in its order: moveable,
 * 1000h bytes, then 2100h twice. Each one locked and read before anything
 * writes it, as how many of its bytes are nought, how many are anything
 * else, and the offset of the first that is not nought (-1 for none).
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\GFRESH.OUT"

static HGLOBAL blocks[3];

static void one(int n, DWORD size)
{
    HGLOBAL block = GlobalAlloc(GMEM_MOVEABLE, size);
    BYTE FAR *p = (BYTE FAR *)GlobalLock(block);
    UINT i;
    UINT zero = 0;
    UINT other = 0;
    int first = -1;

    blocks[n] = block;

    if (p == NULL) {
        wsprintf(probeArgs, "%d,%lx", n, size);
        probe("fresh", probeArgs, "null");
        return;
    }

    for (i = 0; i < (UINT)size; i++) {
        if (p[i] == 0) {
            zero++;
        } else {
            if (first < 0) {
                first = (int)i;
            }

            other++;
        }
    }

    wsprintf(probeArgs, "%d,%lx", n, size);
    wsprintf(probeResult, "zero=%u,other=%u,first=%d", zero, other, first);
    probe("fresh", probeArgs, probeResult);
    GlobalUnlock(block);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    int n;

    probeOpen(OUTPUT);

    one(0, 0x1000L);
    one(1, 0x2100L);
    one(2, 0x2100L);

    for (n = 0; n < 3; n++) {
        GlobalFree(blocks[n]);
    }

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
