/*
 * The BIOS's equipment word, `INT 11h`, as a Windows program is answered
 * it, and what `GetDriveType` and DOS make of the floppy drives it counts.
 * With no image mounted; `biosequa` has a floppy image as A:, `biosequ2`
 * floppy images as A: and B:, and `biosequd` floppy images as A: and D:,
 * B: with nothing.
 *
 * DOSBox's BIOS sets the word once as it starts (`ints/bios.cpp`
 * 1039-1073) and counts each floppy image mounted, whatever its letter:
 * the first sets bit 0, the second bits 6-7 to one, a third no more
 * (`imageDisk::imageDisk`, `ints/bios_disk.cpp` 219-229; `fatDrive`,
 * `drive_fat.cpp` 648). `INT11_Handler` answers the word (364-367).
 * `SYSTEM.DRV` reads it once (seg1 `01e4`-`020b`) for `GetDriveType`.
 *
 * * `int11`: AX after `INT 11h`, AX 1111h before.
 * * `cmos`: the CMOS's register 14h, the equipment byte.
 * * `type`: `GetDriveType` of drives 0 to 4, A: to E:.
 * * `select`: DOS's 0Eh of the drive, then 19h: AL after each, the drive
 *   made current again after.
 */

#ifndef OUTPUT
#define OUTPUT "C:\\ORACLE\\BIOSEQU.OUT"
#endif

#include "probe.h"

static UINT equipment(void)
{
    UINT value;

    _asm {
        mov ax, 1111h
        int 11h
        mov value, ax
    }

    return value;
}

static UINT cmos(UINT index)
{
    UINT value;

    _asm {
        mov ax, index
        out 70h, al
        in al, 71h
        xor ah, ah
        mov value, ax
    }

    return value;
}

static UINT select(UINT drive)
{
    UINT value;

    _asm {
        mov ah, 0eh
        mov dx, drive
        int 21h
        xor ah, ah
        mov value, ax
    }

    return value;
}

static UINT current(void)
{
    UINT value;

    _asm {
        mov ah, 19h
        int 21h
        xor ah, ah
        mov value, ax
    }

    return value;
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    UINT drive, was, selected;

    probeOpen(OUTPUT);

    wsprintf(probeResult, "%04x", equipment());
    probe("int11", "", probeResult);

    wsprintf(probeResult, "%02x", cmos(0x14));
    probe("cmos", "14", probeResult);

    for (drive = 0; drive < 5; drive++) {
        wsprintf(probeArgs, "%u", drive);
        wsprintf(probeResult, "%u", GetDriveType(drive));
        probe("type", probeArgs, probeResult);
    }

    was = current();

    for (drive = 0; drive < 5; drive++) {
        wsprintf(probeArgs, "%u", drive);
        selected = select(drive);
        wsprintf(probeResult, "count=%u current=%u", selected, current());
        select(was);
        probe("select", probeArgs, probeResult);
    }

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
