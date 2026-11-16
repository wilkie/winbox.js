/*
 * ARPL, as a Windows program runs it: Dr. Seuss's ABC and Race (`RACE.EXE`
 * seg7 `3dec`) raise a selector's requested privilege to their own code's
 * with `arpl [bp-2], ax`, AX their CS, before loading it. Recorded in each
 * mode (`record.mjs --mode enhanced`).
 *
 * * `cpl`: the privilege the probe runs at, CS's low two bits.
 * * `arpl`: ARPL of a register, the destination's word and the source's,
 *   and after it the destination and the zero flag: each requested
 *   privilege 0-3 against each 0-3, the destination's other bits kept.
 * * `arpl-memory`: ARPL of a word in memory, the probe's DS with its
 *   requested privilege cleared, against CS.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\ARPLSEL.OUT"

static WORD after;
static WORD zero;
static WORD memory;

static void arplRegister(WORD destination, WORD source)
{
    WORD result, flags;

    _asm {
        mov ax, destination
        mov cx, source
        db 63h, 0C8h /* arpl ax, cx */
        pushf
        pop dx
        mov result, ax
        mov flags, dx
    }

    after = result;
    zero = (flags >> 6) & 1;
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WORD code, data, flags;
    WORD rpl, wanted;

    probeOpen(OUTPUT);

    _asm {
        mov ax, cs
        mov code, ax
        mov ax, ds
        mov data, ax
    }
    wsprintf(probeResult, "%u", code & 3);
    probe("cpl", "CS", probeResult);

    for (rpl = 0; rpl < 4; rpl++) {
        for (wanted = 0; wanted < 4; wanted++) {
            arplRegister((WORD)(0x1234 & ~3 | rpl), wanted);
            wsprintf(probeArgs, "%04x, %04x", 0x1234 & ~3 | rpl, wanted);
            wsprintf(probeResult, "%04x zf=%u", after, zero);
            probe("arpl", probeArgs, probeResult);
        }
    }

    memory = (WORD)(data & ~3);
    _asm {
        mov ax, cs
        mov bx, offset memory
        db 63h, 07h /* arpl [bx], ax */
        pushf
        pop dx
        mov flags, dx
    }
    wsprintf(probeArgs, "DS with RPL 0, CS");
    wsprintf(probeResult, "rpl=%u same selector=%u zf=%u", memory & 3,
             (memory & ~3) == (data & ~3), (flags >> 6) & 1);
    probe("arpl-memory", probeArgs, probeResult);

    probeFinish();
    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
