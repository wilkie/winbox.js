/*
 * What a program finds of the machine's memory by asking the BIOS and the
 * CMOS itself, as InstallShield's SETUP.EXE (Widget Workshop's, from its
 * CD) does before its dialogs: INT 12h for the conventional memory, and
 * the CMOS's extended memory size, registers 17h and 18h, written to port
 * 70h and read from port 71h. And DOS's boot drive, INT 21h AX 3305h, which
 * it asks first.
 *
 * * `int12`: AX after INT 12h, AX 1212h before.
 * * `cmos`: the register asked for, written to port 70h; the byte read
 *   from port 71h. The registers DOSBox fills in once, as it starts: 14h
 *   the equipment, 15h-16h the base memory, 17h-18h and 30h-31h the
 *   extended -- not the clock's, which change, nor the floppy drives' and
 *   hard disks' (10h, 12h), which follow the images mounted.
 * * `3305`: AX BX CX DX and the carry after INT 21h AX 3305h (`regcall.h`).
 */

#include "probe.h"
#include "regcall.h"

#define OUTPUT "C:\\ORACLE\\BIOSMEM.OUT"

static unsigned conventional(void)
{
    unsigned value;

    _asm {
        mov ax, 1212h
        int 12h
        mov value, ax
    }

    return value;
}

static unsigned cmos(unsigned char index)
{
    unsigned char value;

    _asm {
        mov al, index
        out 70h, al
        in al, 71h
        mov value, al
    }

    return value;
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static const unsigned char registers[] = {0x14, 0x15, 0x16, 0x17, 0x18, 0x30, 0x31};
    unsigned at;

    probeOpen(OUTPUT);

    regs.ax = 0x3305;
    regs.bx = 0x0b0b;
    regs.cx = 0x0c0c;
    regs.dx = 0x0d0d;
    call21();
    regsText(probeResult);
    probe("3305", "", probeResult);

    wsprintf(probeResult, "%04x", conventional());
    probe("int12", "", probeResult);

    for (at = 0; at < sizeof(registers); at++) {
        wsprintf(probeArgs, "%02x", registers[at]);
        wsprintf(probeResult, "%02x", cmos(registers[at]));
        probe("cmos", probeArgs, probeResult);
    }

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
