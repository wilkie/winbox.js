/*
 * Whether KERNEL gives the pages of its global heap back when a block is
 * freed (`kb/guides/paging.md`, "The probes that would measure the
 * rest"): blocks of 64 KiB and more from `GlobalAlloc`, freed, the heap
 * compacted, and each block's old linear address read again through a
 * selector of the probe's own, a stale alias. Recorded in each mode
 * (`record.mjs --mode enhanced`), under the probe's own handler for
 * exception 0Eh (0203h).
 *
 * * `alloc`: `GlobalAlloc(GMEM_FIXED)` of 64 KiB, 128 KiB and 1 MiB:
 *   given or not, and `GlobalSize`.
 * * `layout`: each block's linear address (`GetSelectorBase`), and how
 *   far each lies past the one before.
 * * `before`: a byte written through the block's own selector at five
 *   places, each in a page of its own (`place`), then read through the
 *   alias: whether it faults, and the byte as written or not.
 * * `free`: `GlobalFree` of each, its answer.
 * * `compact`: `GlobalCompact(-1)`, whether it answered more than nought.
 * * `after`: the same five bytes of each block read through the alias:
 *   the handler's record, or the byte as written, nought or other; then
 *   each page of each block read at its start: how many fault, and the
 *   first and last that do.
 */

#define PROBE_FLUSH
#include "probe.h"
#include "dpmiregs.h"
#include "pgreach.h"

#define OUTPUT "C:\\ORACLE\\PGHEAP.OUT"

DWORD FAR PASCAL GetSelectorBase(UINT);

#define BLOCKS 3

static const DWORD sizes[BLOCKS] = {0x10000L, 0x20000L, 0x100000L};
static const char *names[BLOCKS] = {"64 KiB", "128 KiB", "1 MiB"};
static HGLOBAL blocks[BLOCKS];
static DWORD bases[BLOCKS];

/* Five places in a block, each in a page of its own: its first byte, the
 * second page's, the middle, the last page's and its last byte. */
#define PLACES 5

static DWORD place(UINT block, UINT which)
{
    switch (which) {
    case 0:
        return 0;
    case 1:
        return 0x1000;
    case 2:
        return sizes[block] / 2;
    case 3:
        return sizes[block] - 0x1000;
    default:
        return sizes[block] - 1;
    }
}

static const char *placeNames[PLACES] = {"first", "second page", "middle", "last page", "last"};

/* The byte written at each place, by the block and the place. */
static BYTE stamp(UINT block, UINT which)
{
    return (BYTE)(0xA0 + block * 4 + which);
}

static void through(LPCSTR group, UINT block, UINT which)
{
    char label[48];
    UINT calls;
    DWORD linear = bases[block] + place(block, which);

    calls = reach(linear, (FARPROC)readByte);
    reachSay(calls, (FARPROC)readByte);
    if (calls == 0) {
        wsprintf(probeResult, "no fault, %s",
                 (LPSTR)(reachValue == stamp(block, which) ? "as written"
                         : reachValue == 0                 ? "nought"
                                                           : "other"));
    }
    wsprintf(label, "%s %s", (LPSTR)names[block], (LPSTR)placeNames[which]);
    probe(group, label, probeResult);
}

/* How many of a block's pages fault as each is read at its start, and the
 * first and last that do. */
static void faulting(UINT block)
{
    DWORD pages = sizes[block] >> 12;
    DWORD page, count = 0, first = 0, last = 0;

    for (page = 0; page < pages; page++) {
        if (reach(bases[block] + (page << 12), (FARPROC)readByte)) {
            if (count == 0) {
                first = page;
            }
            last = page;
            count++;
        }
    }

    if (count) {
        wsprintf(probeResult, "%lu of %lu, pages %lu to %lu", count, pages, first, last);
    } else {
        wsprintf(probeResult, "none of %lu", pages);
    }
    wsprintf(probeArgs, "%s pages faulting", (LPSTR)names[block]);
    probe("after", probeArgs, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    UINT i, which;

    probeOpen(OUTPUT);

    if (!reachOpen(REACH_0E)) {
        probe("alloc", "0000h", "refused");
        probeFinish();
        return 0;
    }

    for (i = 0; i < BLOCKS; i++) {
        blocks[i] = GlobalAlloc(GMEM_FIXED, sizes[i]);
        if (blocks[i]) {
            wsprintf(probeResult, "given, size %08lx", GlobalSize(blocks[i]));
            bases[i] = GetSelectorBase((UINT)blocks[i]);
        } else {
            lstrcpy(probeResult, "refused");
        }
        probe("alloc", names[i], probeResult);
    }

    for (i = 0; i < BLOCKS; i++) {
        if (!blocks[i]) {
            continue;
        }
        wsprintf(probeResult, "%08lx", bases[i]);
        probe("layout", names[i], probeResult);
        if (i > 0 && blocks[i - 1]) {
            wsprintf(probeResult, "%ld", (long)(bases[i] - bases[i - 1]));
            wsprintf(probeArgs, "%s past the one before", (LPSTR)names[i]);
            probe("layout", probeArgs, probeResult);
        }
    }

    for (i = 0; i < BLOCKS; i++) {
        BYTE __huge *bytes;

        if (!blocks[i]) {
            continue;
        }
        bytes = (BYTE __huge *)GlobalLock(blocks[i]);
        for (which = 0; which < PLACES; which++) {
            bytes[place(i, which)] = stamp(i, which);
        }
        GlobalUnlock(blocks[i]);
        for (which = 0; which < PLACES; which++) {
            through("before", i, which);
        }
    }

    for (i = 0; i < BLOCKS; i++) {
        if (blocks[i]) {
            wsprintf(probeResult, "%04x", (UINT)GlobalFree(blocks[i]));
            probe("free", names[i], probeResult);
        }
    }

    probe("compact", "GlobalCompact(-1)", GlobalCompact((DWORD)-1L) ? "more than nought" : "nought");

    for (i = 0; i < BLOCKS; i++) {
        if (!blocks[i]) {
            continue;
        }
        for (which = 0; which < PLACES; which++) {
            through("after", i, which);
        }
        faulting(i);
    }

    reachClose();
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
