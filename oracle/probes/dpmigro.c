/*
 * INT 31h 0503h growing a block where the block after it is not free, and
 * what of Windows goes on while it is called (`kb/topics/dpmi-functions.md`).
 * Recorded in each mode (`record.mjs --mode enhanced`); standard mode's
 * DOSX was found not to come back from a 0503h (`enhmode`).
 *
 * A second program, `DPMIGROC.EXE`, writes a `tick` record to the same
 * file at each of its timer's messages, every 200 ms, fifteen times. The
 * probe lets it write three or so, then:
 *
 * * `calling`: a record that 0503h is called. `grow`: 0501h of 1000h bytes twice;
 *   0503h making the first 2000h bytes: the carry, AX where set, and
 *   whether the base moved; 0502h of both.
 *
 * then lets the other program write its others, and ends. Where 0503h does
 * not come back, the records after the call say what else still ran.
 */

#define PROBE_FLUSH
#include "probe.h"

/* Each record written at the file's end as it is now: opened again first,
 * so that the other program's records written since are seen and not
 * written over. */
static void probeAtEnd(LPCSTR function, LPCSTR args, LPCSTR result)
{
    _lclose(probeHandle);
    probeHandle = _lopen(probePath, OF_WRITE);
    _llseek(probeHandle, 0L, 2);
    probe(function, args, result);
}

#define probe probeAtEnd
#include "dpmiregs.h"

#define OUTPUT "C:\\ORACLE\\DPMIGRO.OUT"

static void pump(DWORD milliseconds)
{
    DWORD until = GetTickCount() + milliseconds;
    MSG msg;

    while (GetTickCount() < until) {
        while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
            TranslateMessage(&msg);
            DispatchMessage(&msg);
        }
        Yield();
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    UINT started;
    DWORD first = 0, second = 0, base = 0;

    probeOpen(OUTPUT);

    started = WinExec("DPMIGROC.EXE", SW_SHOWMINNOACTIVE);
    probe("grow", "WinExec", started > 32 ? "started" : "refused");

    pump(700);

    probe("calling", "0503h 2000h", "yes");
    set(0x0501, 0, 0x1000, 0, 0, 0);
    dpmi();
    report("grow", "0501h first");
    if (!rCarry) {
        first = ((DWORD)rSI << 16) | rDI;
        base = ((DWORD)rBX << 16) | rCX;
    }
    set(0x0501, 0, 0x1000, 0, 0, 0);
    dpmi();
    report("grow", "0501h second");
    if (!rCarry) {
        second = ((DWORD)rSI << 16) | rDI;
    }

    if (first) {
        set(0x0503, 0, 0x2000, 0, (UINT)(first >> 16), (UINT)first);
        dpmi();
        report("grow", "0503h 2000h");
        if (!rCarry) {
            probe("grow", "0503h 2000h base",
                  (((DWORD)rBX << 16) | rCX) == base ? "the same" : "moved");
            first = ((DWORD)rSI << 16) | rDI;
        }
        set(0x0502, 0, 0, 0, (UINT)(first >> 16), (UINT)first);
        dpmi();
        report("grow", "0502h first");
    }
    if (second) {
        set(0x0502, 0, 0, 0, (UINT)(second >> 16), (UINT)second);
        dpmi();
        report("grow", "0502h second");
    }

    probe("grow", "returned", "yes");
    pump(3500);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
