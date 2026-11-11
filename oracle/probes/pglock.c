/*
 * DPMI's locking and paging hints over pages present and not
 * (`kb/guides/paging.md`, "The probes that would measure the rest").
 * Recorded in each mode (`record.mjs --mode enhanced`), under the probe's
 * own handler for exception 0Eh (0203h); in standard mode DOSX answers
 * them with nothing done.
 *
 * * `setup`: a 0501h block of 2000h bytes, and how many pages from its
 *   base on are read without a fault, up to 16 (`pgtouch`'s scan): the
 *   first that faults is the edge used below.
 * * `lock`: 0600h and 0601h (the carry and AX) over the block's two pages;
 *   over a range of two pages, the last present before the edge and the
 *   edge itself; over the edge's page alone; and with a size of nought.
 * * `nest`: the block's first page locked twice and unlocked three times.
 * * `locked read`: 80000000h, not present, locked with 0600h, then read:
 *   the handler's record; then unlocked.
 * * `real`: 0602h and 0603h over a block of `GlobalDosAlloc`'s, of 1000h
 *   bytes, by its linear address.
 * * `hint`: a byte written to the block's first page; 0702h over the page,
 *   then the byte read; 0703h over the page, then the byte read: the
 *   handler's record, and whether the byte is the one written, nought or
 *   other.
 */

#define PROBE_FLUSH
#include "probe.h"
#include "dpmiregs.h"
#include "pgreach.h"

#define OUTPUT "C:\\ORACLE\\PGLOCK.OUT"

DWORD FAR PASCAL GetSelectorBase(UINT);

static void range(LPCSTR group, LPCSTR name, UINT function, DWORD linear, DWORD size)
{
    set(function, HIWORD(linear), LOWORD(linear), 0, HIWORD(size), LOWORD(size));
    dpmi();
    report(group, name);
}

/* The byte at a linear address through the probe's selector: the handler's
 * record, or the byte as the one written, nought or other. */
static void byteAt(LPCSTR group, LPCSTR name, DWORD linear, BYTE written)
{
    UINT calls = reach(linear, (FARPROC)readByte);

    reachSay(calls, (FARPROC)readByte);
    if (calls == 0) {
        wsprintf(probeResult, "no fault, %s",
                 (LPSTR)(reachValue == written ? "as written" : reachValue == 0 ? "nought" : "other"));
    }
    probe(group, name, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    DWORD block = 0, edge = 0, dos = 0;
    UINT blockSI = 0, blockDI = 0, pages = 0, calls = 0;
    DWORD dosBlock;

    probeOpen(OUTPUT);

    if (!reachOpen(REACH_0E)) {
        probe("setup", "0000h", "refused");
        probeFinish();
        return 0;
    }

    call("setup", "0501h 2000h", 0x0501, 0, 0x2000, 0);
    if (rCarry) {
        reachClose();
        probeFinish();
        return 0;
    }
    block = ((DWORD)rBX << 16) | rCX;
    blockSI = rSI;
    blockDI = rDI;

    while (pages < 16) {
        calls = reach(block + ((DWORD)pages << 12), (FARPROC)readByte);
        if (calls) {
            break;
        }
        pages++;
    }
    if (calls && calls != 0xFFFF) {
        wsprintf(probeResult, "%u pages, then code=%04x", pages, excCode);
    } else {
        wsprintf(probeResult, "%u pages, no fault", pages);
    }
    probe("setup", "pages from the block", probeResult);
    edge = block + ((DWORD)pages << 12);

    /* --- lock and unlock --- */
    range("lock", "0600h block", 0x0600, block, 0x2000);
    range("lock", "0601h block", 0x0601, block, 0x2000);
    range("lock", "0600h across the edge", 0x0600, edge - 0x1000, 0x2000);
    range("lock", "0601h across the edge", 0x0601, edge - 0x1000, 0x2000);
    range("lock", "0600h the edge", 0x0600, edge, 0x1000);
    range("lock", "0601h the edge", 0x0601, edge, 0x1000);
    range("lock", "0600h size 0", 0x0600, block, 0);
    range("lock", "0601h size 0", 0x0601, block, 0);

    /* --- nested --- */
    range("nest", "0600h first", 0x0600, block, 0x1000);
    range("nest", "0600h second", 0x0600, block, 0x1000);
    range("nest", "0601h first", 0x0601, block, 0x1000);
    range("nest", "0601h second", 0x0601, block, 0x1000);
    range("nest", "0601h third", 0x0601, block, 0x1000);

    /* --- a page not present, locked, then read --- */
    range("locked read", "0600h 80000000h", 0x0600, 0x80000000L, 0x1000);
    byteAt("locked read", "read 80000000h", 0x80000000L, 0xA5);
    range("locked read", "0601h 80000000h", 0x0601, 0x80000000L, 0x1000);

    /* --- a block of conventional memory --- */
    dosBlock = GlobalDosAlloc(0x1000);
    if (dosBlock) {
        dos = GetSelectorBase(LOWORD(dosBlock));
        range("real", "0602h", 0x0602, dos, 0x1000);
        range("real", "0603h", 0x0603, dos, 0x1000);
        GlobalDosFree(LOWORD(dosBlock));
    } else {
        probe("real", "GlobalDosAlloc", "refused");
    }

    /* --- paging hints --- */
    reachValue = 0xA5;
    calls = reach(block, (FARPROC)writeByte);
    reachSay(calls, (FARPROC)writeByte);
    probe("hint", "write", probeResult);
    range("hint", "0702h", 0x0702, block, 0x1000);
    byteAt("hint", "read after 0702h", block, 0xA5);
    range("hint", "0703h", 0x0703, block, 0x1000);
    byteAt("hint", "read after 0703h", block, 0xA5);

    reachClose();
    set(0x0502, 0, 0, 0, blockSI, blockDI);
    dpmi();
    report("setup", "0502h");

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
