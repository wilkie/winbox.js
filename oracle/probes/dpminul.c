/*
 * INT 31h 0502h, freeing a memory block, given the handle nought, after a
 * record that it is called; then 0101h, freeing DOS memory, given the
 * selector nought (`kb/topics/dpmi-functions.md`). Recorded in each mode
 * (`record.mjs --mode enhanced`).
 *
 * * `calling`: before each call.
 * * `nought`: each call's carry, and AX where set.
 */

#define PROBE_FLUSH
#include "probe.h"
#include "dpmiregs.h"

#define OUTPUT "C:\\ORACLE\\DPMINUL.OUT"

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    probeOpen(OUTPUT);

    probe("calling", "0502h", "yes");
    call("nought", "0502h", 0x0502, 0, 0, 0);

    probe("calling", "0101h", "yes");
    call("nought", "0101h", 0x0101, 0, 0, 0);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
