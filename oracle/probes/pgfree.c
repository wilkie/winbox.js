/*
 * Which pages of a freed block still read, and why (`kb/guides/paging.md`,
 * "The freed block's pages"): `pgheap` found three of a freed 1 MiB
 * block's pages still read, the three it had touched but its first.
 * WIN386's `_PageFree` (VMM object 1 `31e6`) clears the page table entry
 * of a block's first page alone; a page given a frame keeps it in the
 * table, and one never given a frame faults. This probe touches some
 * pages by a write and some by a read alone, frees, and reads every page.
 * Recorded in each mode (`record.mjs --mode enhanced`), under the probe's
 * own handler for exception 0Eh (0203h).
 *
 * A page's mark: `w` read with no fault, the byte as written; `0` no fault
 * and nought; `o` no fault and another byte; `x` a fault.
 *
 * * `free`: a 0501h block of 16 pages; pages 0, 2, 5 and 9 written, 7 and
 *   11 read alone, the rest untouched; 0502h; then the 17 pages from its
 *   base (the last past the block) read, a mark each.
 * * `heap`: `GlobalAlloc(GMEM_FIXED)` of 1 MiB, its base; pages 0, 2 and 5
 *   written through its own selector, 7 read alone through the probe's;
 *   `GlobalFree`; its 256 pages read: the faults, and each page that does
 *   not fault with its mark; then `GlobalCompact(-1)` and the same again.
 * * `where`: `GlobalAlloc(GMEM_FIXED)` of 192, 256, 384, 512 and 768 KiB,
 *   each freed before the next: its base.
 * * `resize`: a 0501h block of 8 pages, each written; 0503h to 2 pages:
 *   the carry, whether it moved, and the 9 pages from the old base read;
 *   0503h to 12 pages: whether it moved, and the 13 pages from its base
 *   read; 0502h.
 * * `largest`: 0500h's largest free block (KiB) and free pages; again
 *   after 0501h of 1 MiB, after each of its pages is written, and after
 *   0502h.
 * * `lock`: a 0501h block of 4 pages, pages 1 and 2 written, freed; 0600h
 *   and 0601h of page 1 (which still reads) and of page 0 (which faults);
 *   page 1 read.
 */

#define PROBE_FLUSH
#include "probe.h"
#include "dpmiregs.h"
#include "pgreach.h"

#define OUTPUT "C:\\ORACLE\\PGFREE.OUT"

DWORD FAR PASCAL GetSelectorBase(UINT);

/* The byte written to a page: by its number. */
static BYTE stamp(DWORD page)
{
    return (BYTE)(0xB0 + (page & 0x3F));
}

/* A page's mark, read at its start. */
static char mark(DWORD linear, DWORD page)
{
    UINT calls = reach(linear, (FARPROC)readByte);

    if (calls == 0xFFFF) {
        return '?';
    }
    if (calls) {
        return 'x';
    }
    if (reachValue == stamp(page)) {
        return 'w';
    }
    return reachValue == 0 ? '0' : 'o';
}

/* `pages` pages from `base`, a mark each, as one string. */
static void marks(LPCSTR group, LPCSTR name, DWORD base, UINT pages)
{
    UINT page;

    for (page = 0; page < pages && page < 40; page++) {
        probeResult[page] = mark(base + ((DWORD)page << 12), page);
    }
    probeResult[page] = 0;
    probe(group, name, probeResult);
}

/* `pages` pages from `base`: how many fault, and those that do not, each
 * with its mark, up to twelve. */
static void scan(LPCSTR group, LPCSTR name, DWORD base, UINT pages)
{
    char reads[12 * 8];
    UINT page, faults = 0, listed = 0;
    char *at = reads;

    reads[0] = 0;
    for (page = 0; page < pages; page++) {
        char m = mark(base + ((DWORD)page << 12), page);

        if (m == 'x') {
            faults++;
        } else if (listed < 12) {
            at += wsprintf(at, " %u%c", page, m);
            listed++;
        }
    }
    wsprintf(probeResult, "%u of %u fault; read:%s", faults, pages,
             (LPSTR)(listed ? reads : " none"));
    probe(group, name, probeResult);
}

static void writePage(DWORD base, DWORD page)
{
    reachValue = stamp(page);
    reach(base + (page << 12), (FARPROC)writeByte);
}

static void readPage(DWORD base, DWORD page)
{
    reach(base + (page << 12), (FARPROC)readByte);
}

/* 0501h of `size`: the base, and the handle in `handleSI`:`handleDI`;
 * nought where refused. */
static UINT handleSI, handleDI;

static DWORD allocate(LPCSTR group, LPCSTR name, DWORD size)
{
    set(0x0501, HIWORD(size), LOWORD(size), 0, 0, 0);
    dpmi();
    report(group, name);
    if (rCarry) {
        return 0;
    }
    handleSI = rSI;
    handleDI = rDI;
    return ((DWORD)rBX << 16) | rCX;
}

static void release(LPCSTR group)
{
    set(0x0502, 0, 0, 0, handleSI, handleDI);
    dpmi();
    report(group, "0502h");
}

static DWORD info[12];

static void largest(LPCSTR name)
{
    UINT i;

    for (i = 0; i < 12; i++) {
        info[i] = 0;
    }
    set(0x0500, 0, 0, 0, 0, 0);
    rDI = LOWORD((DWORD)(void __far *)info);
    rES = HIWORD((DWORD)(void __far *)info);
    dpmi();
    wsprintf(probeResult, "cf=%u largest %lu KiB, free pages %lu", rCarry ? 1 : 0, info[0] >> 10,
             info[4]);
    probe("largest", name, probeResult);
}

static void lockRange(LPCSTR name, UINT function, DWORD linear)
{
    set(function, HIWORD(linear), LOWORD(linear), 0, 0, 0x1000);
    dpmi();
    report("lock", name);
}

static const DWORD wheres[] = {0x30000L, 0x40000L, 0x60000L, 0x80000L, 0xC0000L};
static const char *whereNames[] = {"192 KiB", "256 KiB", "384 KiB", "512 KiB", "768 KiB"};

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    DWORD base, moved;
    HGLOBAL global;
    UINT i;

    probeOpen(OUTPUT);

    if (!reachOpen(REACH_0E)) {
        probe("free", "0000h", "refused");
        probeFinish();
        return 0;
    }

    /* --- free: pages written, read alone and untouched --- */
    base = allocate("free", "0501h 16 pages", 0x10000L);
    if (base) {
        writePage(base, 0);
        writePage(base, 2);
        writePage(base, 5);
        writePage(base, 9);
        readPage(base, 7);
        readPage(base, 11);
        release("free");
        marks("free", "after 0502h", base, 17);
    }

    /* --- heap: a block of KERNEL's of 1 MiB --- */
    global = GlobalAlloc(GMEM_FIXED, 0x100000L);
    if (global) {
        BYTE __huge *bytes = (BYTE __huge *)GlobalLock(global);

        base = GetSelectorBase((UINT)global);
        wsprintf(probeResult, "%08lx", base);
        probe("heap", "GlobalAlloc 1 MiB", probeResult);
        bytes[0] = stamp(0);
        bytes[0x2000L] = stamp(2);
        bytes[0x5000L] = stamp(5);
        GlobalUnlock(global);
        readPage(base, 7);
        wsprintf(probeResult, "%04x", (UINT)GlobalFree(global));
        probe("heap", "GlobalFree", probeResult);
        scan("heap", "after GlobalFree", base, 256);
        probe("heap", "GlobalCompact(-1)",
              GlobalCompact((DWORD)-1L) ? "more than nought" : "nought");
        scan("heap", "after GlobalCompact", base, 256);
    } else {
        probe("heap", "GlobalAlloc 1 MiB", "refused");
    }

    /* --- where: KERNEL's blocks by their size --- */
    for (i = 0; i < sizeof(wheres) / sizeof(wheres[0]); i++) {
        global = GlobalAlloc(GMEM_FIXED, wheres[i]);
        if (global) {
            wsprintf(probeResult, "%08lx", GetSelectorBase((UINT)global));
            GlobalFree(global);
        } else {
            lstrcpy(probeResult, "refused");
        }
        probe("where", whereNames[i], probeResult);
    }

    /* --- resize --- */
    base = allocate("resize", "0501h 8 pages", 0x8000L);
    if (base) {
        DWORD page;

        for (page = 0; page < 8; page++) {
            writePage(base, page);
        }
        set(0x0503, 0, 0x2000, 0, handleSI, handleDI);
        dpmi();
        report("resize", "0503h 2 pages");
        if (!rCarry) {
            moved = ((DWORD)rBX << 16) | rCX;
            handleSI = rSI;
            handleDI = rDI;
            probe("resize", "2 pages moved", moved == base ? "no" : "yes");
            marks("resize", "old base after 2 pages", base, 9);
            base = moved;
        }
        set(0x0503, 0, 0xC000, 0, handleSI, handleDI);
        dpmi();
        report("resize", "0503h 12 pages");
        if (!rCarry) {
            moved = ((DWORD)rBX << 16) | rCX;
            handleSI = rSI;
            handleDI = rDI;
            probe("resize", "12 pages moved", moved == base ? "no" : "yes");
            marks("resize", "base after 12 pages", moved, 13);
        }
        release("resize");
    }

    /* --- largest: 0500h as a block is given, touched and freed --- */
    largest("before");
    base = allocate("largest", "0501h 1 MiB", 0x100000L);
    if (base) {
        DWORD page;

        largest("given");
        for (page = 0; page < 256; page++) {
            writePage(base, page);
        }
        largest("written");
        release("largest");
        largest("freed");
    }

    /* --- lock: a freed block's pages --- */
    base = allocate("lock", "0501h 4 pages", 0x4000L);
    if (base) {
        writePage(base, 1);
        writePage(base, 2);
        release("lock");
        lockRange("0600h page 1", 0x0600, base + 0x1000);
        lockRange("0601h page 1", 0x0601, base + 0x1000);
        lockRange("0600h page 0", 0x0600, base);
        lockRange("0601h page 0", 0x0601, base);
        marks("lock", "pages after", base, 4);
    }

    reachClose();
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
