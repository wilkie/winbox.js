/*
 * MSCDEX's calls that write a buffer at ES:BX, made as a Windows program
 * must make them: through DPMI's 0300h, `INT 2Fh`, the buffer
 * `GlobalDosAlloc`'s below 1 MB. A CD-ROM image is D: and another E:
 * (`mscdbuf.mounts`).
 *
 * DOSBox's `MSCDEX_Handler` (`dos_mscdex.cpp` 1075-1167): 150Dh writes each
 * CD-ROM drive's number from nought for A: (`GetDrives`, 182-185); 1501h
 * five bytes a drive, the subunit and a far pointer to its driver's header
 * (`GetDriverInfo`, 423-429), a segment of DOSBox's own DOS memory taken
 * as the first disc is mounted (317-361).
 *
 * * `call`: the function, its buffer of 32 bytes patterned 60h, 61h, ...
 *   before: the carry 0300h answers, the structure's AX, BX, CX and DX and
 *   carry after, and the buffer's first 16 bytes.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\MSCDBUF.OUT"
#define BUFFER 32

typedef struct {
    DWORD edi, esi, ebp, reserved, ebx, edx, ecx, eax;
    WORD flags, es, ds, fs, gs, ip, cs, sp, ss;
} RMCS;

static RMCS rm;

static unsigned real2f(void)
{
    RMCS far *at = &rm;
    unsigned where = (unsigned)(unsigned long)at;
    unsigned carry = 0;

    _asm {
        push di
        push es
        mov ax, ds
        mov es, ax
        mov di, where
        mov ax, 0300h
        mov bx, 002fh
        xor cx, cx
        int 31h
        pop es
        pop di
        jnc done
        mov carry, 1
    done:
    }

    return carry;
}

static void call(unsigned function, unsigned para, unsigned char far *buffer)
{
    unsigned i, carry;
    char *to;

    for (i = 0; i < BUFFER; i++) {
        buffer[i] = (unsigned char)(0x60 + i);
    }

    _fmemset(&rm, 0, sizeof rm);
    rm.eax = function;
    rm.ebx = 0;
    rm.ecx = 0x0c0c;
    rm.edx = 0x0d0d;
    rm.es = para;
    rm.ds = para;
    carry = real2f();

    to = probeResult;
    to += wsprintf(to, "dpmi=%u ax=%04x bx=%04x cx=%04x dx=%04x carry=%u buffer=", carry,
                   (unsigned)rm.eax, (unsigned)rm.ebx, (unsigned)rm.ecx, (unsigned)rm.edx,
                   rm.flags & 1);

    for (i = 0; i < 16; i++) {
        to += wsprintf(to, i ? " %02x" : "%02x", buffer[i]);
    }

    wsprintf(probeArgs, "%04x", function);
    probe("call", probeArgs, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    DWORD dos;
    unsigned char far *buffer;

    probeOpen(OUTPUT);

    dos = GlobalDosAlloc(BUFFER);
    probe("alloc", "GlobalDosAlloc", dos ? "given" : "refused");

    if (dos) {
        buffer = (unsigned char far *)MAKELP(LOWORD(dos), 0);
        call(0x1500, HIWORD(dos), buffer);
        call(0x150d, HIWORD(dos), buffer);
        call(0x1501, HIWORD(dos), buffer);
        GlobalDosFree(LOWORD(dos));
    }

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
