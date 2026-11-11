/*
 * A write to a page that is not present, and writes to the first
 * megabyte's ROM, under the probe's own handlers for exceptions 0Dh and
 * 0Eh (`kb/guides/paging.md`, "The probes that would measure the rest").
 * Recorded in each mode (`record.mjs --mode enhanced`); in standard mode
 * DOSX does not page.
 *
 * * `write`: a byte written through a selector of the probe's own, its
 *   base set (0007h) to each address: the first page of a 0501h block of
 *   1 byte; 80000000h, C0000000h and FFFFF000h, which `pgtouch` found not
 *   present in enhanced mode; in enhanced mode only, the page past the
 *   block (in standard mode it is DOSX's). Each: whether a handler was
 *   called, its vector, the error code and whether CS:IP was the write.
 * * `rom`: at C0000h (the video BIOS), F0000h and FFFF0h (the system
 *   BIOS): the byte read, then its complement written, then read again:
 *   each reach's record and whether the byte read after is the byte
 *   before or the one written. The byte before is written back where it
 *   changed.
 * * `read`: after the writes, a read of the block's page and of
 *   80000000h: whether the byte written is there.
 */

#define PROBE_FLUSH
#include "probe.h"
#include "dpmiregs.h"
#include "pgreach.h"

#define OUTPUT "C:\\ORACLE\\PGWRITE.OUT"

static void write(LPCSTR name, DWORD linear)
{
    UINT calls;

    reachValue = 0xA5;
    calls = reach(linear, (FARPROC)writeByte);
    reachSay(calls, (FARPROC)writeByte);
    probe("write", name, probeResult);
}

static void readBack(LPCSTR name, DWORD linear)
{
    UINT calls = reach(linear, (FARPROC)readByte);

    reachSay(calls, (FARPROC)readByte);
    if (calls == 0) {
        wsprintf(probeResult, "no fault, %s", (LPSTR)(reachValue == 0xA5 ? "written" : "other"));
    }
    probe("read", name, probeResult);
}

static void rom(LPCSTR name, DWORD linear)
{
    char label[48];
    UINT calls;
    BYTE before, after;

    calls = reach(linear, (FARPROC)readByte);
    reachSay(calls, (FARPROC)readByte);
    wsprintf(label, "%s read", name);
    probe("rom", label, probeResult);
    before = reachValue;

    reachValue = (BYTE)~before;
    calls = reach(linear, (FARPROC)writeByte);
    reachSay(calls, (FARPROC)writeByte);
    wsprintf(label, "%s write", name);
    probe("rom", label, probeResult);

    calls = reach(linear, (FARPROC)readByte);
    after = reachValue;
    reachSay(calls, (FARPROC)readByte);
    if (calls == 0) {
        wsprintf(probeResult, "no fault, %s",
                 (LPSTR)(after == before ? "as before" : after == (BYTE)~before ? "as written"
                                                                               : "other"));
    }
    wsprintf(label, "%s read after", name);
    probe("rom", label, probeResult);

    if (calls == 0 && after != before) {
        reachValue = before;
        reach(linear, (FARPROC)writeByte);
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    DWORD block = 0;
    UINT blockSI = 0, blockDI = 0;
    UINT got;
    BOOL enhanced = (GetWinFlags() & WF_ENHANCED) != 0;

    probeOpen(OUTPUT);

    call("setup", "0501h 1", 0x0501, 0, 1, 0);
    got = !rCarry;
    if (got) {
        block = ((DWORD)rBX << 16) | rCX;
        blockSI = rSI;
        blockDI = rDI;
    }

    if (!reachOpen(REACH_0D | REACH_0E)) {
        probe("setup", "0000h", "refused");
        probeFinish();
        return 0;
    }
    probe("setup", "handlers", "put in");

    if (got) {
        write("block", block);
        if (enhanced) {
            write("past the block", block + 0x1000);
        }
    }
    write("80000000h", 0x80000000L);
    write("C0000000h", 0xC0000000L);
    write("FFFFF000h", 0xFFFFF000L);

    rom("C0000h", 0xC0000L);
    rom("F0000h", 0xF0000L);
    rom("FFFF0h", 0xFFFF0L);

    if (got) {
        readBack("block", block);
    }
    readBack("80000000h", 0x80000000L);

    reachClose();
    if (got) {
        set(0x0502, 0, 0, 0, blockSI, blockDI);
        dpmi();
        report("setup", "0502h");
    }

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
