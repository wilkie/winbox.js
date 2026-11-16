/*
 * DOS's long-file-name functions, INT 21h AH 71h, which Windows 95's DOS
 * has and Windows 3.1's does not. A program written for both (WinZip's
 * self-extractor, `716Ch` to open itself, `7160h` for a path's true name)
 * calls each first and takes the carry with AX 7100h as "not here", then
 * calls DOS's own function.
 *
 * For each AL, a function `71xx`: AX, BX, CX, DX and the carry after INT
 * 21h with AX 71xxh, BX 1234h, CX 0, DX 5678h and DS:DX the probe's own
 * buffer holding a path (`regcall.h`).
 */

#include "probe.h"
#include "regcall.h"

#define OUTPUT "C:\\ORACLE\\LFN71.OUT"

static char path[64] = "C:\\ORACLE\\LFN71.EXE";

static const unsigned functions[] = {0x7139, 0x713a, 0x713b, 0x7141, 0x7143, 0x7147, 0x714e,
                                     0x714f, 0x7156, 0x7160, 0x716c, 0x71a0, 0x71a1, 0x71a6};

static void lfn(unsigned function)
{
    char name[8];

    wsprintf(name, "%04x", function);
    regs.ax = function;
    regs.bx = 0x1234;
    regs.cx = 0;
    regs.dx = (unsigned)(unsigned long)(char far *)path;
    regs.ds = 0;
    call21();
    regsText(probeResult);
    probe(name, "", probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    unsigned i;

    probeOpen(OUTPUT);

    for (i = 0; i < sizeof functions / sizeof functions[0]; i++) {
        lfn(functions[i]);
    }

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
