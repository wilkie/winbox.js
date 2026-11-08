/*
 * INT 31h of a function DOSX's table does not have: 000Eh, DPMI 1.0's
 * "get multiple descriptors", with ES:DI a buffer and CX nought, after a
 * record that it is called (`kb/topics/dpmi-functions.md`). Recorded in
 * each mode (`record.mjs --mode enhanced`).
 *
 * * `calling`: before the call.
 * * `outside`: its carry, and AX where set; then 0E01h, 1.0's coprocessor
 *   emulation, with BX nought, the same.
 */

#define PROBE_FLUSH
#include "probe.h"
#include "dpmiregs.h"

#define OUTPUT "C:\\ORACLE\\DPMIOUT.OUT"

static BYTE buffer[16];

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    probeOpen(OUTPUT);

    probe("calling", "000Eh", "yes");
    set(0x000E, 0, 0, 0, 0, (UINT)(BYTE FAR *)buffer);
    dpmi();
    report("outside", "000Eh");

    probe("calling", "0E01h", "yes");
    call("outside", "0E01h", 0x0E01, 0, 0, 0);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
