/*
 * DPMI's descriptor calls, as SimTower makes them: it reads its own code
 * segment's descriptor with INT 31h function 000Bh, sets the D bit (byte 6,
 * 40h) to make it 32-bit code, and writes it back with 000Ch.
 *
 * On a selector of the probe's own from `AllocSelector`, copied from its
 * data segment:
 *
 * * `get`: 000Bh's carry; the access byte and byte 6's flags, the high
 *   nibble; and whether the base and limit in the bytes are KERNEL's
 *   `GetSelectorBase` and `GetSelectorLimit`. Where memory is, and how big
 *   the data segment is, are not recorded: they are the machine's.
 * * `set`: 000Ch with byte 6 or'd with 40h and the base moved on 10h: the
 *   carry, then the same of 000Bh's bytes again, and how far KERNEL's base
 *   moved.
 * * `bad`: 000Bh of selector 0FFFh, which no table holds: the carry, and
 *   AX.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\DPMIDESC.OUT"

DWORD FAR PASCAL GetSelectorBase(UINT);
DWORD FAR PASCAL GetSelectorLimit(UINT);

static BYTE bytes[8];

static int dpmi(UINT function, UINT selector, BYTE FAR *buffer, UINT *ax)
{
    UINT carry = 0;
    UINT result = 0;
    UINT bufferSeg = (UINT)((DWORD)buffer >> 16);
    UINT bufferOff = (UINT)(DWORD)buffer;

    _asm {
        push es
        push di
        mov ax, function
        mov bx, selector
        mov es, bufferSeg
        mov di, bufferOff
        int 31h
        mov result, ax
        sbb cx, cx
        mov carry, cx
        pop di
        pop es
    }

    *ax = result;
    return carry ? 1 : 0;
}

static void describe(LPSTR at, UINT selector)
{
    DWORD base = (DWORD)bytes[2] | ((DWORD)bytes[3] << 8) | ((DWORD)bytes[4] << 16) |
                 ((DWORD)bytes[7] << 24);
    DWORD limit = (DWORD)bytes[0] | ((DWORD)bytes[1] << 8) | ((DWORD)(bytes[6] & 0x0f) << 16);

    wsprintf(at, "access=%02x,flags=%x,base=%s,limit=%s", bytes[5], bytes[6] >> 4,
             (LPSTR)(base == GetSelectorBase(selector) ? "kernel" : "other"),
             (LPSTR)(limit == GetSelectorLimit(selector) ? "kernel" : "other"));
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    UINT selector;
    UINT ax;
    int carry;
    DWORD base;

    probeOpen(OUTPUT);

    _asm mov ax, ds
    _asm mov selector, ax
    selector = AllocSelector(selector);

    carry = dpmi(0x000b, selector, (BYTE FAR *)bytes, &ax);
    wsprintf(probeResult, "cf=%d:", carry);
    describe(probeResult + lstrlen(probeResult), selector);
    probe("get", "copy", probeResult);

    base = ((DWORD)bytes[2] | ((DWORD)bytes[3] << 8) | ((DWORD)bytes[4] << 16)) + 0x10;
    bytes[2] = (BYTE)base;
    bytes[3] = (BYTE)(base >> 8);
    bytes[4] = (BYTE)(base >> 16);
    bytes[6] |= 0x40;

    carry = dpmi(0x000c, selector, (BYTE FAR *)bytes, &ax);
    wsprintf(probeResult, "cf=%d", carry);
    probe("set", "carry", probeResult);

    carry = dpmi(0x000b, selector, (BYTE FAR *)bytes, &ax);
    wsprintf(probeResult, "cf=%d:", carry);
    describe(probeResult + lstrlen(probeResult), selector);
    probe("set", "read-back", probeResult);

    wsprintf(probeResult, "%lx", GetSelectorBase(selector) - (base - 0x10));
    probe("set", "moved", probeResult);

    carry = dpmi(0x000b, 0x0fff, (BYTE FAR *)bytes, &ax);
    wsprintf(probeResult, "cf=%d,ax=%x", carry, ax);
    probe("bad", "0fff", probeResult);

    FreeSelector(selector);
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
