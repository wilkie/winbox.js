/*
 * MSCDEX's register calls through the multiplex interrupt, INT 2Fh, as a
 * program makes them from Windows -- File Manager asks for each drive
 * whether it is a CD-ROM. DOSBox installs its own MSCDEX whether or not a
 * disc is mounted (`dos_mscdex.cpp`); here none is.
 *
 * Each record: AX, BX, CX, DX and the carry after the call (`regcall.h`),
 * BX 0B0Bh, CX 0C0Ch and DX 0D0Dh before unless said.
 *
 * * `1500`: the installation check, the number of CD-ROM drives in BX and
 *   the first in CX.
 * * `150b`: whether a drive is a CD-ROM, CX the drive, nought for A:, for
 *   0 to 27.
 * * `150c`: MSCDEX's version in BX.
 * * `1100`: the network redirector's installation check, which MSCDEX
 *   answers.
 */

#include "probe.h"
#include "regcall.h"

#ifndef OUTPUT
#define OUTPUT "C:\\ORACLE\\MSCDEX.OUT"
#endif

static void multiplex(LPCSTR name, LPCSTR args, unsigned ax, unsigned cx)
{
    regs.ax = ax;
    regs.bx = 0x0b0b;
    regs.cx = cx;
    regs.dx = 0x0d0d;
    call2f();
    regsText(probeResult);
    probe(name, args, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    unsigned drive;

    probeOpen(OUTPUT);

    multiplex("1500", "", 0x1500, 0x0c0c);

    for (drive = 0; drive < 28; drive++) {
        wsprintf(probeArgs, "%u", drive);
        multiplex("150b", probeArgs, 0x150b, drive);
    }

    multiplex("150c", "", 0x150c, 0x0c0c);
    multiplex("1100", "", 0x1100, 0x0c0c);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
