/*
 * DOS's functions 1Fh and 32h, a drive's parameter block, as a Windows
 * program is given it, and what a program writing into DOS's table of
 * media bytes (1Ch's DS:BX) finds after.
 *
 * DOSBox answers both with AL nought, DS its fake table of drive numbers
 * (`dos.tables.dpb`, 26 bytes, each its own place) and BX the drive's
 * place in it; AL FFh where no drive is mounted (`dos.cpp` 427-442).
 * DOSX's table gives 32h a segment back in DS (0032h) and 1Fh nothing;
 * KERNEL takes 32h to `15f4` (`KRNL386.EXE` seg1).
 *
 * B: is a floppy image and D: a CD-ROM image (`drvdpb.mounts`).
 *
 * * `dpb`: 32h of drives 0 (the current one), 1 (A:, nothing mounted),
 *   2 (B:), 3 (C:), 4 (D:), 5 (E:, not there) and 26 (Z:), and 1Fh
 *   (`default`): AX, BX, CX and DX after (AX 32AAh or 1FAAh, BX 0B0Bh,
 *   CX 0C0Ch before, DL the drive).
 * * `segment`: DS after it -- `own` where it is the program's own data
 *   segment, else its base from `__0000H`'s, its limit, access byte and
 *   table bits, and whether DPMI's 0002h of its paragraph gives it.
 * * `block`: the 33 bytes at DS:BX, as File Manager copies them, for a
 *   call that answered AL nought and a DS not the program's own.
 * * `mediawrite`: C:'s byte in the table of media bytes, as 1Ch points at
 *   it, before; after the program writes 55h there (`written`); after 1Ch
 *   of Z: (`other`); after 1Ch of C: again (`again`); and after 36h of C:
 *   (`space`). Then F8h is written back.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\DRVDPB.OUT"

DWORD FAR PASCAL GetSelectorBase(UINT);
DWORD FAR PASCAL GetSelectorLimit(UINT);

static DWORD firstMegabyte;

static UINT outAx, outBx, outCx, outDx, outDs;

static void call(UINT function, UINT drive)
{
    UINT a, b, c, d, s;

    _asm {
        push ds
        mov ax, function
        mov ah, al
        mov al, 0AAh
        mov dx, drive
        mov bx, 0B0Bh
        mov cx, 0C0Ch
        int 21h
        mov a, ax
        mov b, bx
        mov c, cx
        mov d, dx
        mov s, ds
        pop ds
    }

    outAx = a;
    outBx = b;
    outCx = c;
    outDx = d;
    outDs = s;
}

static UINT rights(UINT selector)
{
    UINT value = 0;

    _asm {
        mov bx, selector
        xor ax, ax
        db 0fh, 02h, 0c3h /* lar ax, bx */
        jnz bad
        mov value, ax
    bad:
    }

    return value;
}

static UINT segmentOf(UINT paragraph)
{
    UINT value = 0;

    _asm {
        mov ax, 0002h
        mov bx, paragraph
        int 31h
        jc bad
        mov value, ax
    bad:
    }

    return value;
}

static UINT ownDs(void)
{
    UINT s;

    _asm mov s, ds

    return s;
}

static void record(LPSTR args, UINT function, UINT drive)
{
    UINT selector;
    DWORD base;
    BYTE FAR *at;
    char *out;
    unsigned i;

    call(function, drive);
    wsprintf(probeResult, "%04x %04x %04x %04x", outAx, outBx, outCx, outDx);
    probe("dpb", args, probeResult);

    selector = outDs;

    if (selector == ownDs()) {
        probe("segment", args, "own");
        return;
    }

    base = GetSelectorBase(selector) - firstMegabyte;
    wsprintf(probeResult, "base=%08lx limit=%08lx access=%02x bits=%x dpmi=%s", base,
             GetSelectorLimit(selector), rights(selector) >> 8, selector & 7,
             (LPSTR)(segmentOf((UINT)(base >> 4)) == selector ? "same" : "other"));
    probe("segment", args, probeResult);

    if ((outAx & 0xff) != 0) {
        return;
    }

    at = (BYTE FAR *)MAKELP(selector, outBx);
    out = probeResult;
    for (i = 0; i < 0x21; i++) {
        out += wsprintf(out, i ? " %02x" : "%02x", at[i]);
    }
    probe("block", args, probeResult);
}

static BYTE FAR *mediaOfC(void)
{
    call(0x1c, 3);
    return (BYTE FAR *)MAKELP(outDs, outBx);
}

static void space(UINT drive)
{
    _asm {
        mov ah, 36h
        mov dx, drive
        int 21h
    }
}

static const UINT drives[] = {0, 1, 2, 3, 4, 5, 26};

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    unsigned i;
    BYTE FAR *c;

    probeOpen(OUTPUT);
    firstMegabyte = GetSelectorBase(
        (UINT)(DWORD)GetProcAddress(GetModuleHandle("KERNEL"), MAKEINTRESOURCE(183)));

    for (i = 0; i < sizeof drives / sizeof drives[0]; i++) {
        wsprintf(probeArgs, "%u", drives[i]);
        record(probeArgs, 0x32, drives[i]);
    }

    record("default", 0x1f, 0);

    c = mediaOfC();
    wsprintf(probeResult, "%02x", *c);
    probe("mediawrite", "before", probeResult);
    *c = 0x55;
    wsprintf(probeResult, "%02x", *c);
    probe("mediawrite", "written", probeResult);
    call(0x1c, 26);
    wsprintf(probeResult, "%02x", *c);
    probe("mediawrite", "other", probeResult);
    c = mediaOfC();
    wsprintf(probeResult, "%02x", *c);
    probe("mediawrite", "again", probeResult);
    space(3);
    wsprintf(probeResult, "%02x", *c);
    probe("mediawrite", "space", probeResult);
    *c = 0xf8;

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
