/*
 * Which of the first megabyte's pages from C0000h keep a write, under the
 * probe's own handlers for exceptions 0Dh and 0Eh: `pgwrite` found the
 * write dropped at C0000h and F0000h and kept at FFFF0h, in both modes
 * (`kb/guides/paging.md`, "ROM"). DOSBox's machine makes C0000h-C7FFFh and
 * F0000h-FFFFFh ROM (`src/hardware/memory.cpp`); this measures each page.
 * Recorded in each mode (`record.mjs --mode enhanced`).
 *
 * * `rom`: at FF0h of each 4 KiB page from C0000h to FF000h, through a
 *   selector of the probe's own based there (0007h): the byte read, its
 *   complement written, and the byte read again -- "as before", "as
 *   written" or "other", or the handlers' record where one was called.
 *   The byte before is written back where it changed. A0000h-BFFFFh, the
 *   video memory, is left alone.
 */

#define PROBE_FLUSH
#include "probe.h"
#include "dpmiregs.h"
#include "pgreach.h"

#define OUTPUT "C:\\ORACLE\\PGROM.OUT"

static void page(DWORD linear)
{
    char label[16];
    UINT calls;
    BYTE before, after;

    wsprintf(label, "%05lXh", linear);

    calls = reach(linear, (FARPROC)readByte);
    if (calls != 0) {
        reachSay(calls, (FARPROC)readByte);
        probe("rom", label, probeResult);
        return;
    }
    before = reachValue;

    reachValue = (BYTE)~before;
    calls = reach(linear, (FARPROC)writeByte);
    if (calls != 0) {
        reachSay(calls, (FARPROC)writeByte);
        probe("rom", label, probeResult);
        return;
    }

    calls = reach(linear, (FARPROC)readByte);
    after = reachValue;
    if (calls != 0) {
        reachSay(calls, (FARPROC)readByte);
        probe("rom", label, probeResult);
        return;
    }

    if (after != before) {
        reachValue = before;
        reach(linear, (FARPROC)writeByte);
    }

    lstrcpy(probeResult, after == before            ? "as before"
                         : after == (BYTE)~before ? "as written"
                                                  : "other");
    probe("rom", label, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    DWORD linear;

    probeOpen(OUTPUT);

    if (!reachOpen(REACH_0D | REACH_0E)) {
        probe("setup", "0000h", "refused");
        probeFinish();
        return 0;
    }

    for (linear = 0xC0FF0L; linear <= 0xFFFF0L; linear += 0x1000L) {
        page(linear);
    }

    reachClose();
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
