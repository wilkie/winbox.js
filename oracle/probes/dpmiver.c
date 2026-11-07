/*
 * DPMI's version, INT 31h function 0400h, as the WATCOM Win386 supervisor
 * asks it before it runs a 32-bit program or library (Sierra's Setup's
 * SMACKE16.DLL, seg1 `0099`-`00c8`): it keeps AH, AL, BX, CL, DH and DL,
 * and says "Not running on a 386 DPMI implementation" unless BX's bit 0,
 * a 32-bit host, is set. Each register is set to a mark first, so that
 * one the call leaves is told from one it writes.
 *
 * * `version`: AX, BX, CX, DX and the carry after 0400h, with BX, CX and
 *   DX 5A5Ah before.
 * * `flags`: `GetWinFlags`, the mode Windows runs in.
 * * `mode`: INT 2Fh function 1600h, the enhanced-mode check: AX after.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\DPMIVER.OUT"

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    UINT rax = 0;
    UINT rbx = 0;
    UINT rcx = 0;
    UINT rdx = 0;
    UINT carry = 0;
    UINT mode = 0;

    probeOpen(OUTPUT);

    _asm {
        mov ax, 0400h
        mov bx, 5a5ah
        mov cx, 5a5ah
        mov dx, 5a5ah
        int 31h
        mov rax, ax
        mov rbx, bx
        mov rcx, cx
        mov rdx, dx
        sbb ax, ax
        mov carry, ax
    }

    wsprintf(probeResult, "ax=%04x bx=%04x cx=%04x dx=%04x cf=%d", rax, rbx, rcx, rdx,
             carry ? 1 : 0);
    probe("version", "0400h", probeResult);

    wsprintf(probeResult, "%04lx", GetWinFlags());
    probe("flags", "GetWinFlags", probeResult);

    _asm {
        mov ax, 1600h
        int 2fh
        mov mode, ax
    }

    wsprintf(probeResult, "ax=%04x", mode);
    probe("mode", "1600h", probeResult);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
