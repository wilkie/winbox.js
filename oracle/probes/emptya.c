/*
 * DOSBox's A: with nothing mounted, as a Windows program finds it: the
 * BIOS's floppy drive, which DOS takes for no drive. Each call is made of
 * A: with the registers set as `regcall.h` sets them, and AX BX CX DX and
 * the carry recorded after.
 *
 * DOSBox's `DOS_MakeName` refuses a path on a drive not mounted, path not
 * found (`dos_files.cpp` 75-78); 36h, 47h and the IOCTL calls refuse the
 * drive itself.
 *
 * * `call`: the function and its path or drive.
 * * `type`: `GetDriveType(0)`.
 */

#include "probe.h"
#include "regcall.h"

#define OUTPUT "C:\\ORACLE\\EMPTYA.OUT"

static char file[] = "A:\\X.TXT";
static char root[] = "A:\\";
static char folder[] = "A:\\D";
static char all[] = "A:\\*.*";
static char made[] = "A:\\N.TXT";
static char current[] = "A:X.TXT";
static BYTE area[64];
static char where[80];

static void call(LPCSTR args, unsigned ax, char *path, unsigned cx, unsigned dx)
{
    regs.ax = ax;
    regs.bx = (ax >> 8) == 0x44 ? 1 : 0x0b0b;
    regs.cx = cx;
    regs.dx = path ? (unsigned)(DWORD)(char FAR *)path : dx;
    regs.ds = 0;
    call21();
    regsText(probeResult);
    probe("call", args, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    unsigned place, outAx, outCarry;

    probeOpen(OUTPUT);

    wsprintf(probeResult, "%u", GetDriveType(0));
    probe("type", "0", probeResult);

    regs.ax = 0x1a00;
    regs.dx = (unsigned)(DWORD)(BYTE FAR *)area;
    regs.ds = 0;
    call21();

    call("3d00 A:\\X.TXT", 0x3d00, file, 0x0c0c, 0);
    call("3d00 A:X.TXT", 0x3d00, current, 0x0c0c, 0);
    call("3c00 A:\\N.TXT", 0x3c00, made, 0, 0);
    call("4300 A:\\", 0x4300, root, 0x0c0c, 0);
    call("4300 A:\\X.TXT", 0x4300, file, 0x0c0c, 0);
    call("3b00 A:\\", 0x3b00, root, 0x0c0c, 0);
    call("3900 A:\\D", 0x3900, folder, 0x0c0c, 0);
    call("4e00 A:\\*.*", 0x4e00, all, 0x16, 0);
    call("3600 1", 0x3600, NULL, 0x0c0c, 1);
    call("1c00 1", 0x1caa, NULL, 0x0c0c, 1);
    call("4408 1", 0x4408, NULL, 0x0c0c, 0x0d0d);

    place = (unsigned)(DWORD)(char FAR *)where;
    _asm {
        push si
        mov ah, 47h
        mov dl, 1
        mov si, place
        int 21h
        pushf
        pop bx
        and bx, 1
        mov outCarry, bx
        mov outAx, ax
        pop si
    }
    wsprintf(probeResult, "ax=%04x carry=%u", outAx, outCarry);
    probe("call", "4700 1", probeResult);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
