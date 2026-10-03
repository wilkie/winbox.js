/*
 * Whether a segment register keeps the descriptor it loaded when Windows
 * changes the descriptor under it: GlobalReAlloc moving a block while FS
 * holds its selector. No 16-bit code Windows runs for the probe loads FS, so
 * what FS reaches afterwards is what its own loaded descriptor says.
 *
 * A moveable block of 100h bytes, 11h at its offset nought, and a fixed one
 * allocated after it, so that growing the first to 4000h cannot be done
 * where it is. FS is loaded with the first's selector, the first grown, a
 * 22h written at its offset nought through a pointer from GlobalLock, and
 * the byte read back through FS.
 *
 * * `moved`: whether GetSelectorBase moved, and whether GlobalLock gave the
 *   same selector again.
 * * `fs`: the byte through FS: `new` for 22h, what the new descriptor
 *   reaches; `old` for the byte at the old base, read through a selector of
 *   the probe's own made from the block's descriptor with the base put back
 *   (DPMI 000Bh and 000Ch); else both bytes.
 *
 * FS is loaded and read in bytes, the compiler taking 8086 instructions.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\SEGREG.OUT"

DWORD FAR PASCAL GetSelectorBase(UINT);

static BYTE bytes[8];

/* An INT 31h descriptor call on `selector` with ES:DI at `bytes`. */
static void dpmi(UINT function, UINT selector)
{
    BYTE FAR *buffer = bytes;
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
        pop di
        pop es
    }
}

/* The byte at a linear address, through a selector made for it. */
static BYTE byteAt(UINT like, DWORD linear)
{
    UINT own = AllocSelector(like);
    BYTE value;

    dpmi(0x000b, own);
    bytes[2] = (BYTE)linear;
    bytes[3] = (BYTE)(linear >> 8);
    bytes[4] = (BYTE)(linear >> 16);
    bytes[7] = (BYTE)(linear >> 24);
    dpmi(0x000c, own);
    value = *(BYTE FAR *)MAKELP(own, 0);
    FreeSelector(own);
    return value;
}

static void loadFs(UINT selector)
{
    _asm {
        mov ax, selector
        db 8eh, 0e0h /* mov fs, ax */
    }
}

static UINT fsSelector(void)
{
    UINT value = 0;

    _asm {
        db 8ch, 0e0h /* mov ax, fs */
        mov value, ax
    }

    return value;
}

static BYTE readFs(void)
{
    BYTE value = 0;

    _asm {
        push bx
        xor bx, bx
        db 64h, 8ah, 07h /* mov al, fs:[bx] */
        mov value, al
        pop bx
    }

    return value;
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HGLOBAL block;
    HGLOBAL after;
    HGLOBAL grown;
    BYTE FAR *p;
    BYTE FAR *q;
    UINT selector;
    DWORD base;
    BYTE value;
    BYTE old;
    BYTE before;
    UINT held;

    probeOpen(OUTPUT);

    block = GlobalAlloc(GMEM_MOVEABLE, 0x100);
    after = GlobalAlloc(GMEM_FIXED, 0x100);
    p = (BYTE FAR *)GlobalLock(block);
    selector = (UINT)((DWORD)p >> 16);
    p[0] = 0x11;
    GlobalUnlock(block);
    base = GetSelectorBase(selector);

    loadFs(selector);
    before = readFs();
    grown = GlobalReAlloc(block, 0x4000, GMEM_MOVEABLE);
    q = (BYTE FAR *)GlobalLock(grown);
    q[0] = 0x22;
    held = fsSelector();
    value = readFs();

    wsprintf(probeResult, "%02X", before);
    probe("before", "100", probeResult);

    wsprintf(probeResult, "base=%s,selector=%s",
             (LPSTR)(GetSelectorBase(selector) != base ? "moved" : "same"),
             (LPSTR)((UINT)((DWORD)q >> 16) == selector ? "same" : "other"));
    probe("moved", "4000", probeResult);

    if (held == selector) {
        probe("selector", "4000", "same");
    } else {
        wsprintf(probeResult, "%04X", held);
        probe("selector", "4000", probeResult);
    }
    old = byteAt(selector, base);

    if (value == 0x22) {
        probe("fs", "4000", "new");
    } else if (value == old) {
        probe("fs", "4000", "old");
    } else {
        wsprintf(probeResult, "fs=%02X,old=%02X", value, old);
        probe("fs", "4000", probeResult);
    }

    loadFs(0);
    GlobalUnlock(grown);
    GlobalFree(grown);
    GlobalFree(after);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
