/*
 * DOS's IOCTL functions `drvioctl` does not ask: 4402h to 4407h, 440Ah to
 * 440Ch, 4410h to 4412h and an unknown 44FFh, and 440Dh's minor codes
 * other than 46h, 60h and 66h, as a Windows program is answered them.
 *
 * DOSBox's `DOS_IOCTL` (`dos_ioctl.cpp` 30-218): AL below 4, 6, 7, 0Ah,
 * 0Ch and 10h take a handle in BX, error 6 for one not open; the others
 * below 12h but 0Bh a drive in BL, error 0Fh for one not there; AL 12h
 * and above error 1. Of them it answers 02h and 03h for a device that has
 * a control channel, 06h, 07h and 0Bh (DX nought refused); the rest error
 * 1.
 *
 * Each call is made with BX the handle or drive, CX 0004h, DS:DX a buffer
 * of 64 bytes patterned 40h, 41h, ... and SI and DI 5151h and 7171h.
 *
 * * `handle`: AX's function, of a file open on C: (`file`), at its start
 *   and at its end (`end`, 4406h), of handle 1 (`std`) and handle 99, not
 *   open (`bad`): the carry, AX and DX after.
 * * `drive`: AX's function, BL nought (the current drive), 3 (C:) and 5
 *   (E:, not there): the carry, AX and DX after.
 * * `generic`: 440Dh with CL the minor code, CH 08h, BL 3 (C:): the carry
 *   and AX after, and whether the buffer was written.
 * * `function`: 4412h, 4413h and 44FFh of C:.
 */

#define PROBE_FLUSH
#include "probe.h"

#define OUTPUT "C:\\ORACLE\\IOCTLALL.OUT"
#define FILE "C:\\ORACLE\\IOCTLALL.DAT"

static BYTE buffer[64];

static UINT outFlags, outAx, outDx;

static void fill(void)
{
    unsigned i;

    for (i = 0; i < sizeof buffer; i++) {
        buffer[i] = (BYTE)(0x40 + i);
    }
}

static int written(void)
{
    unsigned i;

    for (i = 0; i < sizeof buffer; i++) {
        if (buffer[i] != (BYTE)(0x40 + i)) {
            return 1;
        }
    }

    return 0;
}

static void ioctl(UINT function, UINT target, UINT count)
{
    UINT ra, rd, flg;
    UINT at = (UINT)(DWORD)(BYTE FAR *)buffer;

    fill();
    _asm {
        push si
        push di
        mov ax, function
        mov bx, target
        mov cx, count
        mov dx, at
        mov si, 5151h
        mov di, 7171h
        int 21h
        mov ra, ax
        mov rd, dx
        pushf
        pop ax
        mov flg, ax
        pop di
        pop si
    }

    outFlags = flg;
    outAx = ra;
    outDx = rd;
}

static void result(LPCSTR function, LPCSTR args)
{
    wsprintf(probeResult, "carry=%u ax=%04x dx=%04x", outFlags & 1, outAx, outDx);
    probe(function, args, probeResult);
}

static const UINT byHandle[] = {0x4402, 0x4403, 0x4406, 0x4407, 0x440a, 0x440c, 0x4410};
static const UINT byDrive[] = {0x4404, 0x4405, 0x440b, 0x4411};
static const UINT drives[] = {0, 3, 5};
/* The minor codes. 40h and 41h, set the device's parameters and write a
 * track, are not asked: under Windows each stopped DOSBox, the machine
 * ending with no record after. */
static const UINT minors[] = {0x47, 0x67, 0x68, 0x6a, 0x6b, 0x42, 0x62, 0x4a, 0x00, 0x61};
static const UINT others[] = {0x4412, 0x4413, 0x44ff};

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    unsigned i, j;
    HFILE file;

    probeOpen(OUTPUT);

    file = _lcreat(FILE, 0);
    _lwrite(file, "ioctl", 5);
    _llseek(file, 0, 0);

    for (i = 0; i < sizeof byHandle / sizeof byHandle[0]; i++) {
        wsprintf(probeArgs, "%04x file", byHandle[i]);
        ioctl(byHandle[i], file, 4);
        result("handle", probeArgs);
        wsprintf(probeArgs, "%04x std", byHandle[i]);
        ioctl(byHandle[i], 1, 4);
        result("handle", probeArgs);
        wsprintf(probeArgs, "%04x bad", byHandle[i]);
        ioctl(byHandle[i], 99, 4);
        result("handle", probeArgs);
    }

    _llseek(file, 0, 2);
    ioctl(0x4406, file, 4);
    result("handle", "4406 end");
    _lclose(file);

    for (i = 0; i < sizeof byDrive / sizeof byDrive[0]; i++) {
        for (j = 0; j < sizeof drives / sizeof drives[0]; j++) {
            wsprintf(probeArgs, "%04x %u", byDrive[i], drives[j]);
            ioctl(byDrive[i], drives[j], 4);
            result("drive", probeArgs);
        }
    }

    /* 440Bh with DX nought: DX is the buffer's offset otherwise. */
    _asm {
        mov ax, 440bh
        mov bx, 3
        mov cx, 1
        xor dx, dx
        int 21h
        mov outAx, ax
        mov outDx, dx
        pushf
        pop ax
        mov outFlags, ax
    }
    result("drive", "440b dx0");

    for (i = 0; i < sizeof others / sizeof others[0]; i++) {
        wsprintf(probeArgs, "%04x", others[i]);
        ioctl(others[i], 3, 4);
        result("function", probeArgs);
    }

    for (i = 0; i < sizeof minors / sizeof minors[0]; i++) {
        wsprintf(probeArgs, "%02x", minors[i]);
        ioctl(0x440d, 3, 0x0800 | minors[i]);
        wsprintf(probeResult, "carry=%u ax=%04x buffer=%s", outFlags & 1, outAx,
                 (LPSTR)(written() ? "written" : "untouched"));
        probe("generic", probeArgs, probeResult);
    }

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
