/*
 * A block of linear memory bigger than the machine's 16 MB, touched page by
 * page (`kb/guides/paging.md`, "The probes that would measure the rest"):
 * whether every page is there, committed and paged out to the swap file
 * and back, and how long a page takes (`kb/topics/timing.md`). Recorded in
 * each mode (`record.mjs --mode enhanced`), under the probe's own handler
 * for exception 0Eh (0203h).
 *
 * * `free`: DPMI 0500h before: the largest free block, in KiB; the free
 *   pages; and whether the paging file's size is known (not FFFFFFFFh).
 * * `alloc`: 0501h of 24 MiB; where that is refused, of the largest free
 *   block 0500h answered. The carry and AX, and the size given, in KiB.
 * * `touch`: a byte written at the start of each page, its page number's
 *   low byte plus 1, through a selector of the probe's own whose base steps
 *   64 KiB at a time; then each page read back: the pages, the faults in
 *   each pass, and how many pages read back hold their byte.
 * * `time`: each pass's milliseconds by `GetTickCount`, the write's and the
 *   read's, and a second read's: DOSBox's host's time, not replayed.
 * * `free after`: 0500h's largest free block again, in KiB, while the block
 *   is held; then 0502h.
 */

#define PROBE_FLUSH
#include "probe.h"
#include "dpmiregs.h"
#include "pgreach.h"

#define OUTPUT "C:\\ORACLE\\PGBIG.OUT"

#define ASKED 0x1800000L

/* 0500h's structure: its first double word the largest free block in
 * bytes, the fifth the free pages, the ninth the paging file's size in
 * pages. */
static DWORD info[12];

static void freeInfo(void)
{
    UINT i;

    for (i = 0; i < 12; i++) {
        info[i] = 0;
    }
    set(0x0500, 0, 0, 0, 0, 0);
    rDI = LOWORD((DWORD)(void __far *)info);
    rES = HIWORD((DWORD)(void __far *)info);
    dpmi();
}

/* Each page from the block's start: written (`write`) or read. The pages
 * read back holding their byte are counted in `held`; the faults in
 * the answer. */
static DWORD held;

static DWORD pass(DWORD block, DWORD pages, BOOL write)
{
    DWORD page, faults = 0;

    held = 0;
    for (page = 0; page < pages; page++) {
        UINT at = (UINT)((page & 15) << 12);
        BYTE stampValue = (BYTE)(page + 1);

        if ((page & 15) == 0) {
            based(block + (page << 12));
        }
        if (write) {
            reachValue = stampValue;
            faults += reachAt(at, (FARPROC)writeByte);
        } else {
            UINT calls = reachAt(at, (FARPROC)readByte);

            faults += calls;
            if (!calls && reachValue == stampValue) {
                held++;
            }
        }
    }

    return faults;
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    DWORD block = 0, size = ASKED, pages, faults;
    DWORD start;
    UINT blockSI = 0, blockDI = 0;

    probeOpen(OUTPUT);

    if (!reachOpen(REACH_0E)) {
        probe("free", "0000h", "refused");
        probeFinish();
        return 0;
    }

    freeInfo();
    report("free", "0500h");
    wsprintf(probeResult, "%lu", info[0] >> 10);
    probe("free", "largest block KiB", probeResult);
    wsprintf(probeResult, "%lu", info[4]);
    probe("free", "free pages", probeResult);
    probe("free", "paging file", info[8] == 0xFFFFFFFFL ? "unknown" : "known");

    set(0x0501, HIWORD(size), LOWORD(size), 0, 0, 0);
    dpmi();
    report("alloc", "0501h 24 MiB");
    if (rCarry) {
        size = info[0] & ~0xFFFL;
        set(0x0501, HIWORD(size), LOWORD(size), 0, 0, 0);
        dpmi();
        report("alloc", "0501h the largest");
    }
    if (rCarry) {
        reachClose();
        probeFinish();
        return 0;
    }
    block = ((DWORD)rBX << 16) | rCX;
    blockSI = rSI;
    blockDI = rDI;
    wsprintf(probeResult, "%lu", size >> 10);
    probe("alloc", "KiB given", probeResult);
    pages = size >> 12;

    start = GetTickCount();
    faults = pass(block, pages, TRUE);
    wsprintf(probeResult, "%lu", GetTickCount() - start);
    probe("time", "write ms", probeResult);
    wsprintf(probeResult, "%lu pages, %lu faults", pages, faults);
    probe("touch", "write", probeResult);

    start = GetTickCount();
    faults = pass(block, pages, FALSE);
    wsprintf(probeResult, "%lu", GetTickCount() - start);
    probe("time", "read ms", probeResult);
    wsprintf(probeResult, "%lu pages, %lu faults, %lu held", pages, faults, held);
    probe("touch", "read", probeResult);

    start = GetTickCount();
    faults = pass(block, pages, FALSE);
    wsprintf(probeResult, "%lu", GetTickCount() - start);
    probe("time", "read again ms", probeResult);
    wsprintf(probeResult, "%lu pages, %lu faults, %lu held", pages, faults, held);
    probe("touch", "read again", probeResult);

    freeInfo();
    wsprintf(probeResult, "%lu", info[0] >> 10);
    probe("free after", "largest block KiB", probeResult);

    reachClose();
    set(0x0502, 0, 0, 0, blockSI, blockDI);
    dpmi();
    report("free after", "0502h");

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
