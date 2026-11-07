/*
 * What a program can see of the mode Windows runs in, standard (`win /s`,
 * DOSX.EXE the DPMI host) or 386 enhanced (`win /3`, WIN386.EXE's VMM):
 * recorded in each mode (`record.mjs --mode enhanced`) to be set side by
 * side (`kb/guides/enhanced-mode.md`). Nothing here depends on where memory
 * is: selectors and addresses are told only as present or not.
 *
 * * `windows`: INT 2Fh 160Ah (AX 160Ah, BX and CX 5A5Ah before): AX, BX,
 *   CX after; INT 2Fh 1683h, the virtual machine's number (BX); 1686h, the
 *   processor's mode (AX).
 * * `vxd`: INT 2Fh 1684h for each device's number in BX, ES:DI nought
 *   before: whether ES:DI is an entry point after.
 * * `dpmi`: INT 31h, function by function, with harmless arguments, each
 *   thing made let go again: the carry, and AX where the carry is set (the
 *   error, in 1.0's words); for some, a value besides. Last, after
 *   `kernel`, what standard mode's DOSX does not come back from: 0503h,
 *   noted as called before it is, then DPMI 1.0's functions.
 * * `free`: function 0500h's twelve doublewords, in hexadecimal.
 * * `kernel`: `__AHINCR` and `__AHSHIFT`; the privilege level of the
 *   probe's code (CS's low bits); `LAR` and `LSL` of the probe's code and
 *   data selectors; `GetFreeSpace(0)` in kilobytes; whether `GlobalAlloc`
 *   gives blocks of 1, 4, 8 and 15 megabytes; KERNEL's file.
 */

#include <string.h>

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\ENHMODE.OUT"

/* The registers, global, where the inline assembly reaches them. */
static unsigned rAX, rBX, rCX, rDX, rSI, rDI, rES, rCarry;

/* A buffer for the calls that take ES:DI: 0500h's 30h bytes, 0300h's 32h,
 * 000Bh's eight. */
static BYTE buffer[64];

static char vendor[] = "MS-DOS";

/* The procedure 0303h is given; never called. */
static void FAR PASCAL callback(void)
{
}

static void dpmi(void)
{
    _asm {
        push si
        push di
        push es
        mov ax, rES
        mov es, ax
        mov ax, rAX
        mov bx, rBX
        mov cx, rCX
        mov dx, rDX
        mov si, rSI
        mov di, rDI
        int 31h
        mov rAX, ax
        mov rBX, bx
        mov rCX, cx
        mov rDX, dx
        mov rSI, si
        mov rDI, di
        sbb ax, ax
        mov rCarry, ax
        pop es
        pop di
        pop si
    }
}

static void multiplex(void)
{
    _asm {
        push si
        push di
        push es
        mov ax, rES
        mov es, ax
        mov ax, rAX
        mov bx, rBX
        mov cx, rCX
        mov dx, rDX
        mov di, rDI
        int 2fh
        mov rAX, ax
        mov rBX, bx
        mov rCX, cx
        mov rDX, dx
        mov rDI, di
        mov ax, es
        mov rES, ax
        pop es
        pop di
        pop si
    }
}

static void set(unsigned ax, unsigned bx, unsigned cx, unsigned dx, unsigned si, unsigned di)
{
    rAX = ax;
    rBX = bx;
    rCX = cx;
    rDX = dx;
    rSI = si;
    rDI = di;
    rES = (UINT)((DWORD)(BYTE FAR *)buffer >> 16);
}

/* A call's record: the carry, and AX where it is set. */
static void report(LPCSTR function)
{
    if (rCarry) {
        wsprintf(probeResult, "cf=1 ax=%04x", rAX);
    } else {
        lstrcpy(probeResult, "cf=0");
    }

    probe("dpmi", function, probeResult);
}

static void call(LPCSTR function, unsigned ax, unsigned bx, unsigned cx, unsigned dx)
{
    set(ax, bx, cx, dx, 0, 0);
    dpmi();
    report(function);
}

static UINT ourDS(void)
{
    UINT value = 0;

    _asm {
        mov ax, ds
        mov value, ax
    }

    return value;
}

static UINT ourCS(void)
{
    UINT value = 0;

    _asm {
        mov ax, cs
        mov value, ax
    }

    return value;
}

static void descriptor(LPCSTR name, UINT selector)
{
    UINT rights = 0;
    UINT limit = 0;
    UINT valid = 0;

    _asm {
        mov bx, selector
        xor cx, cx
        db 0fh, 02h, 0c3h /* lar ax, bx */
        jnz bad
        mov rights, ax
        db 0fh, 03h, 0cbh /* lsl cx, bx */
        mov limit, cx
        mov valid, 1
    bad:
    }

    wsprintf(probeResult, "valid=%u rights=%04x limit-is-ffff=%u", valid, rights & 0xff00,
             limit == 0xffff);
    probe("kernel", name, probeResult);
}

static const struct {
    UINT id;
    LPCSTR name;
} devices[] = {
    {0x0001, "VMM"},      {0x0003, "VPICD"},    {0x0004, "VDMAD"},    {0x0005, "VTD"},
    {0x0006, "V86MMGR"},  {0x0007, "PageSwap"}, {0x0008, "Parity"},   {0x0009, "Reboot"},
    {0x000A, "VDD"},      {0x000B, "VSD"},      {0x000C, "VMD"},      {0x000D, "VKD"},
    {0x000E, "VCD"},      {0x0010, "BlockDev"}, {0x0011, "VMCPD"},    {0x0012, "EBIOS"},
    {0x0013, "BIOSXlat"}, {0x0015, "DOSMGR"},   {0x0017, "SHELL"},    {0x0018, "VMPoll"},
    {0x001B, "VFD"},      {0x0021, "PageFile"}, {0x0026, "VPOWERD"},  {0x0442, "VTDAPI"},
};

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    UINT i;
    UINT selector;
    UINT ds = ourDS();
    UINT cs = ourCS();
    DWORD dw;
    char name[128];
    static const DWORD sizes[] = {0x100000L, 0x400000L, 0x800000L, 0xF00000L};

    probeOpen(OUTPUT);

    /* --- INT 2Fh: Windows' own --- */
    rAX = 0x160A;
    rBX = 0x5A5A;
    rCX = 0x5A5A;
    rDX = 0;
    rDI = 0;
    rES = 0;
    multiplex();
    wsprintf(probeResult, "ax=%04x bx=%04x cx=%04x", rAX, rBX, rCX);
    probe("windows", "160Ah", probeResult);

    rAX = 0x1683;
    rBX = 0x5A5A;
    multiplex();
    wsprintf(probeResult, "ax=%04x bx=%04x", rAX, rBX);
    probe("windows", "1683h", probeResult);

    rAX = 0x1686;
    multiplex();
    wsprintf(probeResult, "ax=%04x", rAX);
    probe("windows", "1686h", probeResult);

    for (i = 0; i < sizeof(devices) / sizeof(devices[0]); i++) {
        rAX = 0x1684;
        rBX = devices[i].id;
        rES = 0;
        rDI = 0;
        multiplex();
        wsprintf(probeResult, "%s", (rES || rDI) ? (LPSTR) "entry" : (LPSTR) "none");
        wsprintf(name, "1684h %04x %s", devices[i].id, devices[i].name);
        probe("vxd", name, probeResult);
    }

    /* --- INT 31h, function by function --- */

    /* 0000h one descriptor; 0003h; then on it 0006h-0009h, 000Bh, 000Ch;
     * 0001h frees it. */
    set(0x0000, 0, 1, 0, 0, 0);
    dpmi();
    report("0000h");
    selector = rCarry ? 0 : rAX;

    set(0x0003, 0, 0, 0, 0, 0);
    dpmi();
    report("0003h");
    wsprintf(probeResult, "%04x", rAX);
    probe("dpmi", "0003h increment", probeResult);

    call("0006h", 0x0006, ds, 0, 0);
    call("0007h", 0x0007, selector, 0x0001, 0x0000);
    call("0008h", 0x0008, selector, 0, 0x0fff);
    call("0009h", 0x0009, selector, 0x00f2, 0);
    set(0x000B, selector, 0, 0, 0, (UINT)(BYTE FAR *)buffer);
    dpmi();
    report("000Bh");
    set(0x000C, selector, 0, 0, 0, (UINT)(BYTE FAR *)buffer);
    dpmi();
    report("000Ch");
    call("0001h", 0x0001, selector, 0, 0);

    /* 0002h: the BIOS's data as a segment. */
    call("0002h", 0x0002, 0x0040, 0, 0);

    /* 000Ah: an alias of the probe's code; freed. */
    set(0x000A, cs, 0, 0, 0, 0);
    dpmi();
    report("000Ah");
    if (!rCarry) {
        call("000Ah free", 0x0001, rAX, 0, 0);
    }

    /* 000Dh: a particular descriptor, the fifth of the table's first
     * sixteen; freed if given. */
    set(0x000D, 0x0024 | 4 | 3, 0, 0, 0, 0);
    dpmi();
    report("000Dh");
    if (!rCarry) {
        call("000Dh free", 0x0001, 0x0024 | 4 | 3, 0, 0);
    }

    /* 0.9's lock and unlock of a selector's memory, undocumented. */
    call("0004h", 0x0004, ds, 0, 0);
    call("0005h", 0x0005, ds, 0, 0);

    /* 0100h a paragraph of DOS's memory; 0102h makes it two; 0101h frees
     * it. */
    set(0x0100, 1, 0, 0, 0, 0);
    dpmi();
    report("0100h");
    if (!rCarry) {
        selector = rDX;
        call("0102h", 0x0102, 2, 0, selector);
        call("0101h", 0x0101, 0, 0, selector);
    }

    /* 0200h-0205h: each vector read and set again as it was. */
    set(0x0200, 0x21, 0, 0, 0, 0);
    dpmi();
    report("0200h");
    call("0201h", 0x0201, 0x21, rCX, rDX);

    set(0x0202, 0x0D, 0, 0, 0, 0);
    dpmi();
    report("0202h");
    call("0203h", 0x0203, 0x0D, rCX, rDX);

    set(0x0204, 0x21, 0, 0, 0, 0);
    dpmi();
    report("0204h");
    call("0205h", 0x0205, 0x21, rCX, rDX);

    /* 0300h: DOS's version, INT 21h function 30h, in real mode; the host's
     * stack. */
    _fmemset(buffer, 0, sizeof(buffer));
    buffer[0x1D] = 0x30;
    set(0x0300, 0x21, 0, 0, 0, (UINT)(BYTE FAR *)buffer);
    dpmi();
    report("0300h");
    wsprintf(probeResult, "al=%02x", buffer[0x1C]);
    probe("dpmi", "0300h dos", probeResult);

    /* 0303h a real-mode callback to `callback`; 0304h frees it. */
    {
        FARPROC proc = (FARPROC)callback;
        UINT procSeg = (UINT)((DWORD)proc >> 16);
        UINT procOff = (UINT)(DWORD)proc;

        rAX = 0x0303;
        rSI = procOff;
        rDI = (UINT)(BYTE FAR *)buffer;
        rES = (UINT)((DWORD)(BYTE FAR *)buffer >> 16);
        rDX = procSeg;

        _asm {
            push si
            push di
            push es
            push ds
            mov ax, rES
            mov es, ax
            mov si, rSI
            mov di, rDI
            mov ax, rDX
            push ax
            mov ax, rAX
            pop ds
            int 31h
            pop ds
            mov rCX, cx
            mov rDX, dx
            mov rAX, ax
            sbb ax, ax
            mov rCarry, ax
            pop es
            pop di
            pop si
        }

        report("0303h");
        if (!rCarry) {
            call("0304h", 0x0304, 0, rCX, rDX);
        }
    }

    set(0x0305, 0, 0, 0, 0, 0);
    dpmi();
    report("0305h");
    if (!rCarry) {
        wsprintf(probeResult, "%04x", rAX);
        probe("dpmi", "0305h size", probeResult);
    }

    call("0306h", 0x0306, 0, 0, 0);

    /* 0500h: the free memory's information. */
    _fmemset(buffer, 0xff, sizeof(buffer));
    set(0x0500, 0, 0, 0, 0, (UINT)(BYTE FAR *)buffer);
    dpmi();
    report("0500h");
    for (i = 0; i < 12; i++) {
        wsprintf(name, "0500h %u", i);
        wsprintf(probeResult, "%08lx", ((DWORD FAR *)buffer)[i]);
        probe("free", name, probeResult);
    }

    /* 0501h a page of memory; 0600h-0601h lock and unlock it; 0702h,
     * 0703h; 0502h frees it. */
    set(0x0501, 0, 0x1000, 0, 0, 0);
    dpmi();
    report("0501h");
    if (!rCarry) {
        UINT addrHi = rBX, addrLo = rCX, handleHi = rSI, handleLo = rDI;

        set(0x0600, addrHi, addrLo, 0, 0, 0x1000);
        dpmi();
        report("0600h");
        set(0x0601, addrHi, addrLo, 0, 0, 0x1000);
        dpmi();
        report("0601h");
        set(0x0702, addrHi, addrLo, 0, 0, 0x1000);
        dpmi();
        report("0702h");
        set(0x0703, addrHi, addrLo, 0, 0, 0x1000);
        dpmi();
        report("0703h");
        set(0x0502, 0, 0, 0, handleHi, handleLo);
        dpmi();
        report("0502h");
    }

    /* 0602h/0603h on the first kilobyte of conventional memory, as it
     * already is. */
    set(0x0602, 0, 0, 0, 0, 0x0400);
    dpmi();
    report("0602h");
    set(0x0603, 0, 0, 0, 0, 0x0400);
    dpmi();
    report("0603h");

    set(0x0604, 0, 0, 0, 0, 0);
    dpmi();
    report("0604h");
    if (!rCarry) {
        wsprintf(probeResult, "%04x%04x", rBX, rCX);
        probe("dpmi", "0604h size", probeResult);
    }

    /* 0800h: the VGA's memory's physical address, A0000h, 64 kilobytes. */
    set(0x0800, 0x000A, 0x0000, 0, 0x0001, 0x0000);
    dpmi();
    report("0800h");

    /* 0900h-0902h: the virtual interrupt flag, read, cleared and set
     * again. */
    call("0902h", 0x0902, 0, 0, 0);
    wsprintf(probeResult, "al=%02x", rAX & 0xff);
    probe("dpmi", "0902h state", probeResult);
    call("0900h", 0x0900, 0, 0, 0);
    call("0901h", 0x0901, 0, 0, 0);

    /* 0A00h: a vendor's entry point, "MS-DOS". */
    rAX = 0x0A00;
    rSI = (UINT)(char FAR *)vendor;
    rES = 0;
    rDI = 0;
    _asm {
        push si
        push di
        push es
        mov si, rSI
        mov ax, rAX
        int 31h
        mov rAX, ax
        sbb ax, ax
        mov rCarry, ax
        pop es
        pop di
        pop si
    }
    report("0A00h");

    /* 0B02h: a watchpoint that was never set. */
    call("0B02h", 0x0B02, 0, 0, 0);

    /* --- KERNEL's side --- */
    dw = (DWORD)GetProcAddress(GetModuleHandle("KERNEL"), MAKEINTRESOURCE(114));
    wsprintf(probeResult, "%04x", (UINT)dw);
    probe("kernel", "__AHINCR", probeResult);
    dw = (DWORD)GetProcAddress(GetModuleHandle("KERNEL"), MAKEINTRESOURCE(113));
    wsprintf(probeResult, "%04x", (UINT)dw);
    probe("kernel", "__AHSHIFT", probeResult);

    wsprintf(probeResult, "%u", cs & 3);
    probe("kernel", "privilege", probeResult);
    descriptor("code", cs);
    descriptor("data", ds);

    wsprintf(probeResult, "%lu", GetFreeSpace(0) >> 10);
    probe("kernel", "GetFreeSpace", probeResult);

    for (i = 0; i < sizeof(sizes) / sizeof(sizes[0]); i++) {
        HGLOBAL block = GlobalAlloc(GMEM_MOVEABLE, sizes[i]);

        wsprintf(name, "GlobalAlloc %lu", sizes[i] >> 20);
        probe("kernel", name, block ? "given" : "refused");

        if (block) {
            GlobalFree(block);
        }
    }

    GetModuleFileName(GetModuleHandle("KERNEL"), name, sizeof(name));
    probe("kernel", "file", name);

    /* --- INT 31h: what standard mode's DOSX does not come back from,
     * last, a record before saying it was called (`kb/guides/
     * enhanced-mode.md`) --- 0503h, a page from 0501h made two pages, then
     * freed; DPMI 1.0's functions, which DOSX's table lacks. */
    probe("dpmi", "0503h", "calling");
    set(0x0501, 0, 0x1000, 0, 0, 0);
    dpmi();
    if (!rCarry) {
        UINT handleHi = rSI, handleLo = rDI;

        set(0x0503, 0, 0x2000, 0, handleHi, handleLo);
        dpmi();
        report("0503h");
        if (!rCarry) {
            handleHi = rSI;
            handleLo = rDI;
        }

        set(0x0502, 0, 0, 0, handleHi, handleLo);
        dpmi();
    }

    set(0x000E, 0, 0, 0, 0, (UINT)(BYTE FAR *)buffer);
    dpmi();
    report("000Eh");
    call("0210h", 0x0210, 0x0D, 0, 0);
    set(0x0401, 0, 0, 0, 0, (UINT)(BYTE FAR *)buffer);
    dpmi();
    report("0401h");
    call("0504h", 0x0504, 0, 0, 0);
    call("0E00h", 0x0E00, 0, 0, 0);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
