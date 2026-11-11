/*
 * Which linear pages a program can reach, and what a reach of one that is
 * not there does, recorded in each mode (`record.mjs --mode enhanced`;
 * `kb/guides/paging.md`). In standard mode DOSX does not page, and nothing
 * here should fault.
 *
 * * `layout`: where things are, by linear address: the probe's data and
 *   code segments, a block of 10h bytes from `GlobalAlloc`, and two blocks
 *   of 1 byte from DPMI 0501h, one after the other: each base, and how far
 *   the second block lies past the first; a block of 3001h bytes.
 * * `dpmi`: DPMI 1.0's 0504h-0509h, with harmless arguments, the carry and
 *   AX, in enhanced mode only (DOSX never returns from a function not in
 *   its table: `dpmiout`); 0600h and 0601h, lock and unlock, of the first 0501h block's page,
 *   of the page past it, of 80000000h and of FFFFF000h.
 * * `touch`: the probe's handler put in for exception 0Eh with 0203h, then
 *   a byte read through a selector of the probe's own, its base set
 *   (0007h) to each linear address and its limit FFFFh, at offset nought:
 *   the first 0501h block, its last byte, the page past it; the
 *   `GlobalAlloc` block's page and the page 1000h and 10000h past it; the
 *   probe's own far pointer to its data taken as a linear address, as a
 *   Win386 routine given a `DLL_PTR` takes it; 400h and 110000h; 80000000h,
 *   C0000000h and FFFFF000h. Each: whether the handler was called, and the
 *   error code and whether the frame's CS:IP is the read that faulted. In
 *   enhanced mode only, a write to the first block's page and the page past
 *   it, the same way.
 * * `scan`: with the handler still in, how many pages from each 0501h
 *   block's base on are read without a fault, up to 1024, and the first
 *   fault's error code; and whether the page before each is read. Then
 *   the block of 3001h freed (0502h) and the `GlobalAlloc` block freed, and
 *   each one's base read again (`touch`). Then 0203h back.
 */

#define PROBE_FLUSH
#include "probe.h"
#include "dpmiregs.h"

#define OUTPUT "C:\\ORACLE\\PGTOUCH.OUT"

DWORD FAR PASCAL GetSelectorBase(UINT);

static WORD excCalls, excCode, excIP, excCS;
static WORD excSkip = 3;
static WORD probeSel, probeOff;
static FARPROC target;
static char buffer[16];

/* An exception handler: the error code and CS:IP noted, and IP moved on
 * past the instruction. */
static void __declspec(naked) __far handler(void)
{
    _asm {
        push bp
        mov bp, sp
        push ax
        inc word ptr excCalls
        mov ax, [bp+6]
        mov excCode, ax
        mov ax, [bp+8]
        mov excIP, ax
        mov ax, [bp+0Ah]
        mov excCS, ax
        mov ax, excSkip
        add [bp+8], ax
        pop ax
        pop bp
        retf
    }
}

/* A byte read through ES at BX, its first instruction (3 bytes). */
static void __declspec(naked) __far readByte(void)
{
    _asm {
        mov al, es:[bx]
        retf
    }
}

/* A byte written through ES at BX, its first instruction (3 bytes). */
static void __declspec(naked) __far writeByte(void)
{
    _asm {
        mov es:[bx], al
        retf
    }
}

/* DX:CX's double word set with 0007h as the probe selector's base. */
static UINT based(DWORD linear)
{
    set(0x0007, probeSel, HIWORD(linear), LOWORD(linear), 0, 0);
    dpmi();
    return !rCarry;
}

/* A byte read or written at a linear address: the handler's calls, or
 * FFFFh where 0007h refused the base. */
static UINT reach(DWORD linear, FARPROC how)
{
    UINT sel = probeSel;

    if (!based(linear)) {
        return 0xFFFF;
    }

    excCalls = 0;
    excCode = 0;
    target = how;
    _asm {
        push es
        mov ax, sel
        mov es, ax
        xor bx, bx
        mov al, 5Ah
        call dword ptr target
        pop es
    }

    return excCalls;
}

static void touch(LPCSTR name, DWORD linear, FARPROC how)
{
    UINT calls = reach(linear, how);

    if (calls == 0xFFFF) {
        lstrcpy(probeResult, "0007h refused");
    } else if (calls == 0) {
        lstrcpy(probeResult, "no fault");
    } else {
        wsprintf(probeResult, "fault calls=%u code=%04x at-fault=%u", calls, excCode,
                 excIP == LOWORD((DWORD)how) && excCS == HIWORD((DWORD)how));
    }

    probe("touch", name, probeResult);
}

/* How many pages from `linear` on are read without a fault, up to `most`,
 * and the first fault's error code. */
static void scan(LPCSTR name, DWORD linear, UINT most)
{
    UINT pages = 0;
    UINT calls = 0;

    while (pages < most) {
        calls = reach(linear + ((DWORD)pages << 12), (FARPROC)readByte);
        if (calls) {
            break;
        }
        pages++;
    }

    if (calls && calls != 0xFFFF) {
        wsprintf(probeResult, "%u pages, then code=%04x", pages, excCode);
    } else {
        wsprintf(probeResult, "%u pages, no fault", pages);
    }

    probe("scan", name, probeResult);
}

static void lock(LPCSTR name, UINT function, DWORD linear)
{
    set(function, HIWORD(linear), LOWORD(linear), 0, 0, 0x1000);
    dpmi();
    report("dpmi", name);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    DWORD first = 0, second = 0, biggest = 0, global = 0, pointer;
    UINT firstSI = 0, firstDI = 0, secondSI = 0, secondDI = 0, biggerSI = 0, biggerDI = 0;
    UINT gotFirst, gotSecond, bigger;
    UINT oldCX, oldDX;
    HGLOBAL block;
    FARPROC proc;
    static const UINT dpmi10[] = {0x0504, 0x0505, 0x0506, 0x0507, 0x0508, 0x0509};
    UINT i;

    probeOpen(OUTPUT);

    /* --- layout --- */
    wsprintf(probeResult, "%08lx", GetSelectorBase(ourDS()));
    probe("layout", "data segment", probeResult);
    wsprintf(probeResult, "%08lx", GetSelectorBase(ourCS()));
    probe("layout", "code segment", probeResult);

    block = GlobalAlloc(GMEM_FIXED, 0x10);
    if (block) {
        global = GetSelectorBase((UINT)block);
    }
    wsprintf(probeResult, "%08lx", global);
    probe("layout", "GlobalAlloc 10h", probeResult);

    call("layout", "0501h 1 first", 0x0501, 0, 1, 0);
    gotFirst = !rCarry;
    if (gotFirst) {
        first = ((DWORD)rBX << 16) | rCX;
        firstSI = rSI;
        firstDI = rDI;
        wsprintf(probeResult, "%08lx", first);
        probe("layout", "0501h 1 first base", probeResult);
    }

    call("layout", "0501h 1 second", 0x0501, 0, 1, 0);
    gotSecond = !rCarry;
    if (gotSecond) {
        second = ((DWORD)rBX << 16) | rCX;
        secondSI = rSI;
        secondDI = rDI;
        wsprintf(probeResult, "%08lx", second);
        probe("layout", "0501h 1 second base", probeResult);
    }

    if (gotFirst && gotSecond) {
        wsprintf(probeResult, "%ld", (long)(second - first));
        probe("layout", "second past first", probeResult);
    }

    call("layout", "0501h 3001h", 0x0501, 0, 0x3001, 0);
    bigger = !rCarry;
    if (bigger) {
        biggest = ((DWORD)rBX << 16) | rCX;
        biggerSI = rSI;
        biggerDI = rDI;
        wsprintf(probeResult, "%08lx", biggest);
        probe("layout", "0501h 3001h base", probeResult);
    }

    /* --- DPMI 1.0's paging functions, locking --- */
    for (i = 0; (GetWinFlags() & WF_ENHANCED) && i < sizeof(dpmi10) / sizeof(dpmi10[0]); i++) {
        char name[8];

        wsprintf(name, "%04xh", dpmi10[i]);
        set(dpmi10[i], 0, 0, 0, 0, 0x1000);
        dpmi();
        report("dpmi", name);
    }

    if (gotFirst) {
        lock("0600h block", 0x0600, first);
        lock("0601h block", 0x0601, first);
        lock("0600h past the block", 0x0600, first + 0x1000);
        lock("0601h past the block", 0x0601, first + 0x1000);
    }
    lock("0600h 80000000h", 0x0600, 0x80000000L);
    lock("0601h 80000000h", 0x0601, 0x80000000L);
    lock("0600h FFFFF000h", 0x0600, 0xFFFFF000L);
    lock("0601h FFFFF000h", 0x0601, 0xFFFFF000L);

    /* --- touches --- */
    call("touch", "0000h", 0x0000, 0, 1, 0);
    if (rCarry) {
        probeFinish();
        return 0;
    }
    probeSel = rAX;
    call("touch", "0008h", 0x0008, probeSel, 0, 0xFFFF);

    call("touch", "0202h", 0x0202, 0x0E, 0, 0);
    oldCX = rCX;
    oldDX = rDX;
    proc = (FARPROC)handler;
    call("touch", "0203h", 0x0203, 0x0E, HIWORD((DWORD)proc), LOWORD((DWORD)proc));
    if (!rCarry) {
        if (gotFirst) {
            touch("block", first, (FARPROC)readByte);
            /* The block's last byte, through a base 0FFFh on. */
            touch("block's last byte", first + 0x0FFF, (FARPROC)readByte);
            touch("past the block", first + 0x1000, (FARPROC)readByte);
        }
        if (global) {
            touch("GlobalAlloc", global, (FARPROC)readByte);
            touch("GlobalAlloc + 1000h", global + 0x1000, (FARPROC)readByte);
            touch("GlobalAlloc + 10000h", global + 0x10000L, (FARPROC)readByte);
        }

        pointer = (DWORD)(LPSTR)buffer;
        touch("far pointer as linear", pointer, (FARPROC)readByte);
        touch("400h", 0x400, (FARPROC)readByte);
        touch("110000h", 0x110000L, (FARPROC)readByte);
        touch("80000000h", 0x80000000L, (FARPROC)readByte);
        touch("C0000000h", 0xC0000000L, (FARPROC)readByte);
        touch("FFFFF000h", 0xFFFFF000L, (FARPROC)readByte);

        /* Only where WIN386 pages: in standard mode the page past the
         * block is DOSX's, and a write there would be into its memory. */
        if (gotFirst && (GetWinFlags() & WF_ENHANCED)) {
            touch("write block", first, (FARPROC)writeByte);
            touch("write past the block", first + 0x1000, (FARPROC)writeByte);
        }

        /* How far present pages go past each block, and before them. */
        if (gotFirst) {
            scan("from the first block", first, 1024);
            scan("before the first block", first - 0x1000, 1);
        }
        if (gotSecond) {
            scan("from the second block", second, 1024);
            scan("before the second block", second - 0x1000, 1);
        }
        if (bigger) {
            scan("from a block of 3001h", biggest, 1024);
        }

        /* What was freed: the block of 3001h and the GlobalAlloc block,
         * read again after. */
        if (bigger) {
            set(0x0502, 0, 0, 0, biggerSI, biggerDI);
            dpmi();
            report("layout", "0502h 3001h");
            bigger = 0;
            touch("freed block of 3001h", biggest, (FARPROC)readByte);
        }
        if (block) {
            GlobalFree(block);
            block = 0;
            touch("freed GlobalAlloc", global, (FARPROC)readByte);
        }

        call("touch", "0203h back", 0x0203, 0x0E, oldCX, oldDX);
    }

    call("touch", "0001h", 0x0001, probeSel, 0, 0);
    if (bigger) {
        set(0x0502, 0, 0, 0, biggerSI, biggerDI);
        dpmi();
        report("layout", "0502h 3001h");
    }
    if (gotSecond) {
        set(0x0502, 0, 0, 0, secondSI, secondDI);
        dpmi();
        report("layout", "0502h second");
    }
    if (gotFirst) {
        set(0x0502, 0, 0, 0, firstSI, firstDI);
        dpmi();
        report("layout", "0502h first");
    }
    if (block) {
        GlobalFree(block);
    }

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
