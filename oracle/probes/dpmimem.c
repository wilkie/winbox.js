/*
 * The DPMI host's memory, its interrupt flag and its watchpoints, INT 31h
 * 0100h-0102h, 0500h-0503h, 0600h-0604h, 0700h-0703h, 0800h, 0900h-0902h
 * and 0B00h-0B03h, recorded in each mode (`record.mjs --mode enhanced`;
 * `kb/topics/dpmi-functions.md`). Where memory is, is not recorded: only
 * what does not depend on it.
 *
 * * `dos`: 0100h of a paragraph and of FFFFh: the carry, AX, BX; 0101h and
 *   0102h of the probe's data segment, which is no DOS block.
 * * `block`: 0501h of 1000h bytes, 18000h, nought and 7FFFFFFFh: the
 *   carry, AX where set; whether SI equals DI and their low three bits;
 *   the base's low twelve bits; `LAR` and `LSL` of SI as a selector, and
 *   whether 0006h of it is the base. 0502h of each and of the first
 *   again. Last, after a record that it is called, 0503h making
 *   a block of 1000h bytes 800h: the base, the handle, `LSL` after.
 * * `page`: 0600h-0603h on the first block, 0604h's BX and CX, 0702h,
 *   0703h, 0700h, 0701h; 0800h of F0000h and of FE000000h, whether BX:CX came back as
 *   they went.
 * * `interrupts`: 0902h, 0900h, 0902h, 0901h, 0902h: AL after each, and
 *   the flags' IF after each.
 * * `watch`: 0B00h on a word of the probe's, written: the carry, AX; 0B02h
 *   of it; 0B03h; 0B01h. 0B00h of three bytes; five of them in turn, each
 *   cleared after.
 */

#define PROBE_FLUSH
#include "probe.h"
#include "dpmiregs.h"

#define OUTPUT "C:\\ORACLE\\DPMIMEM.OUT"

static WORD watched;

static void selector(LPCSTR name, UINT value)
{
    UINT rights = 0;
    UINT limit = 0;
    UINT valid = 0;

    _asm {
        mov bx, value
        xor cx, cx
        db 0fh, 02h, 0c3h /* lar ax, bx */
        jnz bad
        mov rights, ax
        db 0fh, 03h, 0cbh /* lsl cx, bx */
        mov limit, cx
        mov valid, 1
    bad:
    }

    if (valid) {
        wsprintf(probeResult, "rights=%04x limit=%04x", rights & 0xff00, limit);
    } else {
        lstrcpy(probeResult, "refused");
    }

    probe("block", name, probeResult);
}

/* 0501h: the block's handle in `handle`, its base in `base`. */
static int block(LPCSTR name, UINT high, UINT low, DWORD *handle, DWORD *base)
{
    char text[48];

    set(0x0501, high, low, 0, 0, 0);
    dpmi();
    report("block", name);
    if (rCarry) {
        return 0;
    }

    *handle = ((DWORD)rSI << 16) | rDI;
    *base = ((DWORD)rBX << 16) | rCX;
    wsprintf(text, "%s handle", name);
    wsprintf(probeResult, "si=di:%u low=%u%u", rSI == rDI, rSI & 7, rDI & 7);
    probe("block", text, probeResult);
    wsprintf(text, "%s base", name);
    wsprintf(probeResult, "%03lx", *base & 0xFFFL);
    probe("block", text, probeResult);
    wsprintf(text, "%s selector", name);
    selector(text, rSI);
    set(0x0006, (UINT)(*handle >> 16), 0, 0, 0, 0);
    dpmi();
    wsprintf(text, "%s selector base", name);
    probe("block", text,
          rCarry ? "refused" : (((DWORD)rCX << 16 | rDX) == *base ? "the block's" : "another"));
    return 1;
}

static void freeBlock(LPCSTR name, DWORD handle)
{
    set(0x0502, 0, 0, 0, (UINT)(handle >> 16), (UINT)handle);
    dpmi();
    report("block", name);
}

static void interrupts(LPCSTR name, UINT function)
{
    char text[32];

    call("interrupts", name, function, 0, 0, 0);
    wsprintf(text, "%s al", name);
    wsprintf(probeResult, "%02x", rAX & 0xff);
    probe("interrupts", text, probeResult);
    wsprintf(text, "%s if", name);
    wsprintf(probeResult, "%u", (flagsNow() >> 9) & 1);
    probe("interrupts", text, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    DWORD first = 0, second = 0, base = 0, other = 0;
    DWORD linear;
    UINT handles[5];
    UINT i;
    char name[32];

    probeOpen(OUTPUT);

    /* --- DOS's memory --- */
    call("dos", "0100h 1", 0x0100, 1, 0, 0);
    wsprintf(probeResult, "bx=%04x", rBX);
    probe("dos", "0100h 1 bx", probeResult);
    if (!rCarry) {
        call("dos", "0101h given", 0x0101, 0, 0, rDX);
    }
    call("dos", "0100h FFFFh", 0x0100, 0xFFFF, 0, 0);
    wsprintf(probeResult, "bx=%04x", rBX);
    probe("dos", "0100h FFFFh bx", probeResult);
    call("dos", "0102h", 0x0102, 2, 0, ourDS());
    wsprintf(probeResult, "bx=%04x", rBX);
    probe("dos", "0102h bx", probeResult);
    call("dos", "0101h data", 0x0101, 0, 0, ourDS());

    /* --- 0501h-0503h --- */
    if (block("0501h 1000h", 0, 0x1000, &first, &base)) {
        /* Locking and paging, on the first block. */
        linear = base;
        set(0x0600, (UINT)(linear >> 16), (UINT)linear, 0, 0, 0x0800);
        dpmi();
        report("page", "0600h");
        set(0x0601, (UINT)(linear >> 16), (UINT)linear, 0, 0, 0x0800);
        dpmi();
        report("page", "0601h");
        set(0x0702, (UINT)(linear >> 16), (UINT)linear, 0, 0, 0x0800);
        dpmi();
        report("page", "0702h");
        set(0x0703, (UINT)(linear >> 16), (UINT)linear, 0, 0, 0x0800);
        dpmi();
        report("page", "0703h");
        set(0x0700, (UINT)(linear >> 16), (UINT)linear, 0, 0, 0x0800);
        dpmi();
        report("page", "0700h");
        set(0x0701, (UINT)(linear >> 16), (UINT)linear, 0, 0, 0x0800);
        dpmi();
        report("page", "0701h");
    }

    if (block("0501h 18000h", 0x0001, 0x8000, &second, &other)) {
        freeBlock("0502h 18000h", second);
    }
    block("0501h nought", 0, 0, &second, &other);
    block("0501h 7FFFFFFFh", 0x7FFF, 0xFFFF, &second, &other);

    if (first) {
        freeBlock("0502h 1000h", first);
        freeBlock("0502h 1000h twice", first);
    }

    set(0x0602, 0, 0, 0, 0, 0x0400);
    dpmi();
    report("page", "0602h");
    set(0x0603, 0, 0, 0, 0, 0x0400);
    dpmi();
    report("page", "0603h");
    call("page", "0604h", 0x0604, 0, 0, 0);
    wsprintf(probeResult, "bx=%04x cx=%04x", rBX, rCX);
    probe("page", "0604h size", probeResult);

    set(0x0800, 0x000F, 0x0000, 0, 0x0000, 0x1000);
    dpmi();
    report("page", "0800h F0000h");
    probe("page", "0800h F0000h address", (rBX == 0x000F && rCX == 0) ? "as given" : "another");
    set(0x0800, 0xFE00, 0x0000, 0, 0x0000, 0x1000);
    dpmi();
    report("page", "0800h FE000000h");
    probe("page", "0800h FE000000h address",
          (rBX == 0xFE00 && rCX == 0) ? "as given" : "another");

    /* --- 0900h-0902h --- */
    wsprintf(probeResult, "%u", (flagsNow() >> 9) & 1);
    probe("interrupts", "before if", probeResult);
    interrupts("0902h", 0x0902);
    interrupts("0900h", 0x0900);
    interrupts("0902h after 0900h", 0x0902);
    interrupts("0901h", 0x0901);
    interrupts("0902h after 0901h", 0x0902);
    _asm cli
    interrupts("0902h after cli", 0x0902);
    _asm sti

    /* --- 0B00h-0B03h --- */
    _asm mov ax, ds
    _asm mov i, ax
    set(0x0006, i, 0, 0, 0, 0);
    dpmi();
    linear = (((DWORD)rCX << 16) | rDX) + (UINT)(WORD FAR *)&watched;

    set(0x0B00, (UINT)(linear >> 16), (UINT)linear, 0x0102, 0, 0);
    dpmi();
    report("watch", "0B00h word written");
    if (!rCarry) {
        UINT handle = rBX;

        wsprintf(probeResult, "%04x", handle);
        probe("watch", "0B00h handle", probeResult);
        call("watch", "0B02h", 0x0B02, handle, 0, 0);
        wsprintf(probeResult, "ax=%04x", rAX);
        probe("watch", "0B02h state", probeResult);
        call("watch", "0B03h", 0x0B03, handle, 0, 0);
        call("watch", "0B01h", 0x0B01, handle, 0, 0);
        call("watch", "0B01h twice", 0x0B01, handle, 0, 0);
    }

    set(0x0B00, (UINT)(linear >> 16), (UINT)linear, 0x0103, 0, 0);
    dpmi();
    report("watch", "0B00h three bytes");
    if (!rCarry) {
        call("watch", "0B01h three bytes", 0x0B01, rBX, 0, 0);
    }
    set(0x0B00, (UINT)(linear >> 16), (UINT)linear, 0x0302, 0, 0);
    dpmi();
    report("watch", "0B00h kind 3");
    if (!rCarry) {
        call("watch", "0B01h kind 3", 0x0B01, rBX, 0, 0);
    }

    for (i = 0; i < 5; i++) {
        set(0x0B00, (UINT)(linear >> 16), (UINT)linear, 0x0001, 0, 0);
        dpmi();
        wsprintf(name, "0B00h %u", i);
        report("watch", name);
        handles[i] = rCarry ? 0xFFFF : rBX;
        if (!rCarry) {
            wsprintf(name, "0B00h %u handle", i);
            wsprintf(probeResult, "%04x", rBX);
            probe("watch", name, probeResult);
        }
    }
    for (i = 0; i < 5; i++) {
        if (handles[i] != 0xFFFF) {
            wsprintf(name, "0B01h %u", i);
            call("watch", name, 0x0B01, handles[i], 0, 0);
        }
    }
    call("watch", "0B02h never", 0x0B02, 0x0007, 0, 0);

    /* --- 0503h, last: what standard mode's DOSX may not come back from
     * (`enhmode`), a record before saying it is called --- */
    probe("calling", "0503h 800h", "yes");
    if (block("0501h last", 0, 0x1000, &first, &base)) {
        DWORD after;

        set(0x0503, 0, 0x0800, 0, (UINT)(first >> 16), (UINT)first);
        dpmi();
        report("block", "0503h 800h");
        if (!rCarry) {
            after = ((DWORD)rBX << 16) | rCX;
            probe("block", "0503h 800h base", after == base ? "the same" : "moved");
            wsprintf(probeResult, "si=di:%u same:%u", rSI == rDI,
                     ((DWORD)rSI << 16 | rDI) == first);
            probe("block", "0503h 800h handle", probeResult);
            first = ((DWORD)rSI << 16) | rDI;
            selector("0503h 800h selector", rSI);
        }

        freeBlock("0502h last", first);
    }

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
