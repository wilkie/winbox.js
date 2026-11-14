/*
 * Where DOS's functions 1Bh and 1Ch leave DS:BX, the media byte of a drive,
 * as a Windows program is given it. `diskfree` found DS a selector not the
 * program's and the byte F8h for C:; this records what that selector is.
 *
 * DOSBox keeps a word for each drive, A: first, in a table of its own DOS's
 * memory (`dos.tables.mediaid`, `dos_tables.cpp`), and answers DS its
 * segment and BX the drive's word (`DOS_GetAllocationInfo`,
 * `dos_files.cpp`). Under Windows DOSX turns a segment DOS gives back in
 * DS into a selector (its function table, 1Bh's and 1Ch's way back 0032h).
 *
 * * `call`: for 1Ch of drives 0 (the current one), 1 (A:), 3 (C:),
 *   26 (Z:) and 27 (no drive), and 1Bh (`default`), AX, BX, CX and DX
 *   after, in hexadecimal (AX 1CAAh or 1BAAh, BX 0B0Bh and CX 0C0Ch before
 *   it, DL the drive).
 * * `segment`: DS after it -- its base, counted from `__0000H`'s (the
 *   first megabyte's own selector, KERNEL's ordinal 183), its limit, its access byte (`LAR`),
 *   its table and privilege bits, whether DPMI's 0002h of its base's
 *   paragraph gives the same selector, and whether the call made again
 *   gives it again.
 * * `media`: the two bytes at DS:BX, for the drives that are there.
 * * `table`: the 26 drives' words from DS:BX less the drive's place, as
 *   C:'s call gives it, A: first.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\DISKMED.OUT"

DWORD FAR PASCAL GetSelectorBase(UINT);
DWORD FAR PASCAL GetSelectorLimit(UINT);

static DWORD firstMegabyte;

static UINT outAx, outBx, outCx, outDx, outDs;

static void allocation(UINT function, UINT drive)
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

static void record(LPSTR args, UINT function, UINT drive)
{
    UINT selector;
    UINT again;
    DWORD base;
    BYTE FAR *at;

    allocation(function, drive);
    wsprintf(probeResult, "%04x %04x %04x %04x", outAx, outBx, outCx, outDx);
    probe("call", args, probeResult);

    selector = outDs;
    base = GetSelectorBase(selector) - firstMegabyte;
    allocation(function, drive);
    again = outDs == selector;
    wsprintf(probeResult, "base=%08lx limit=%08lx access=%02x bits=%x dpmi=%s again=%s", base,
             GetSelectorLimit(selector), rights(selector) >> 8, selector & 7,
             (LPSTR)(segmentOf((UINT)(base >> 4)) == selector ? "same" : "other"),
             (LPSTR)(again ? "same" : "other"));
    probe("segment", args, probeResult);

    if ((outAx & 0xff) == 0xff) {
        return;
    }

    at = (BYTE FAR *)MAKELP(outDs, outBx);
    wsprintf(probeResult, "%02x %02x", at[0], at[1]);
    probe("media", args, probeResult);
}

static const UINT drives[] = {0, 1, 3, 26, 27};

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    unsigned i;
    BYTE FAR *at;
    char *out;

    probeOpen(OUTPUT);
    firstMegabyte = GetSelectorBase(
        (UINT)(DWORD)GetProcAddress(GetModuleHandle("KERNEL"), MAKEINTRESOURCE(183)));

    for (i = 0; i < sizeof drives / sizeof drives[0]; i++) {
        wsprintf(probeArgs, "%u", drives[i]);
        record(probeArgs, 0x1c, drives[i]);
    }

    record("default", 0x1b, 0);

    allocation(0x1c, 3);
    at = (BYTE FAR *)MAKELP(outDs, outBx - 4);
    out = probeResult;
    for (i = 0; i < 26; i++) {
        out += wsprintf(out, i ? " %02x%02x" : "%02x%02x", at[2 * i + 1], at[2 * i]);
    }
    probe("table", "", probeResult);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
