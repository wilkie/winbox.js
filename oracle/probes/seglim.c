/*
 * The processor's segment checks the Rust core and `fault_vector` were
 * found to lack (`kb/topics/cpu-accuracy.md`): an access through a data
 * segment that expands down, above and below its limit, through a register
 * other than SS and through SS; and an instruction fetched past its code
 * segment's limit. The 80386 manual has an expand-down segment's offsets
 * run from limit + 1 to FFFFh, or FFFFFFFFh with the B bit, and anything
 * else fault; and a fetch past CS's limit raise #GP(0).
 *
 * Each segment is a selector of the probe's own from `AllocSelector`,
 * written with INT 31h 000Ch from DS's descriptor (000Bh), its base, limit,
 * access byte and flags changed. The faults are caught by the probe's
 * handlers for exceptions 0Dh and 0Ch (INT 31h 0203h), which note the
 * fault and send the faulting code on to a far return; each is set back
 * after.
 *
 * * `setup`: each DPMI call's carry.
 * * `up16`: a control, the same block as data expanding up, limit 0FFFh:
 *   a byte at the limit and one past it.
 * * `down16`: data, expanding down, limit 0FFFh, B clear, over a block of
 *   128 KiB whose byte at x is `pattern(x)`. Bytes and words read at
 *   offsets below, at and above the limit, and at the top of the 64 KiB;
 *   each `read al=..` (`ok=1` where it is the block's byte there) or
 *   `fault vec=.. code=.. at-start=..`, whether the fault's IP is the
 *   instruction's own.
 * * `down32`: the same segment with the B bit, read with 32-bit addresses,
 *   and once with a 16-bit address at FFFFh.
 * * `fetch`: code, `nop; nop; mov al, 5; retf` at offset nought, its limit
 *   4, 3, 2 and 1: `ran al=..`, or the fault and its IP.
 * * `stack`: SS made an expand-down alias of the stack's own segment,
 *   limit 00FFh, and a byte read through BP above and below the limit.
 */

#define PROBE_FLUSH
#include "probe.h"
#include "dpmiregs.h"

#define OUTPUT "C:\\ORACLE\\SEGLIM.OUT"

DWORD FAR PASCAL GetSelectorBase(UINT);

static WORD excCalls, excVector, excCode, excIP, excCS;
static WORD resumeIP, resumeCS;
static FARPROC target;
static BYTE bytes[8];
static WORD after, savedSS, testSelector, testOffset, testHigh;

/* A handler for exception 0Dh: the error code, IP and CS noted, and the
 * faulting code sent on to `resumeCS:resumeIP`. */
static void __declspec(naked) __far onGP(void)
{
    _asm {
        push bp
        mov bp, sp
        push ax
        inc word ptr excCalls
        mov word ptr excVector, 0Dh
        mov ax, [bp+6]
        mov excCode, ax
        mov ax, [bp+8]
        mov excIP, ax
        mov ax, [bp+0Ah]
        mov excCS, ax
        mov ax, resumeIP
        mov [bp+8], ax
        mov ax, resumeCS
        mov [bp+0Ah], ax
        pop ax
        pop bp
        retf
    }
}

/* The same for exception 0Ch, a stack fault. */
static void __declspec(naked) __far onSS(void)
{
    _asm {
        push bp
        mov bp, sp
        push ax
        inc word ptr excCalls
        mov word ptr excVector, 0Ch
        mov ax, [bp+6]
        mov excCode, ax
        mov ax, [bp+8]
        mov excIP, ax
        mov ax, [bp+0Ah]
        mov excCS, ax
        mov ax, resumeIP
        mov [bp+8], ax
        mov ax, resumeCS
        mov [bp+0Ah], ax
        pop ax
        pop bp
        retf
    }
}

/* Where a faulting read goes on: its far return. */
static void __declspec(naked) __far resume(void)
{
    _asm retf
}

/* Where a faulting read through BP goes on: BP back, and its far return. */
static void __declspec(naked) __far resumeBP(void)
{
    _asm {
        pop bp
        retf
    }
}

/* Reads through ES at BX (EBX), each its first instruction. */
static void __declspec(naked) __far readByte16(void)
{
    _asm {
        mov al, es:[bx]
        retf
    }
}

static void __declspec(naked) __far readWord16(void)
{
    _asm {
        mov ax, es:[bx]
        retf
    }
}

static void __declspec(naked) __far readByte32(void)
{
    _asm {
        db 26h, 67h, 8Ah, 03h /* mov al, es:[ebx] */
        retf
    }
}

static void __declspec(naked) __far readWord32(void)
{
    _asm {
        db 26h, 67h, 8Bh, 03h /* mov ax, es:[ebx] */
        retf
    }
}

/* A byte through SS at BX, read as [bp]: the read three bytes in. */
static void __declspec(naked) __far readStack(void)
{
    _asm {
        push bp
        mov bp, bx
        mov al, [bp]
        pop bp
        retf
    }
}

static BYTE pattern(DWORD at)
{
    return (BYTE)(at ^ (at >> 8) ^ ((at >> 16) * 0x40));
}

static WORD offsetOf(FARPROC proc)
{
    return LOWORD((DWORD)proc);
}

/* A descriptor written over `selector`: DS's, its base, limit, access byte
 * and flags changed. */
static void describe(LPCSTR group, UINT selector, DWORD base, WORD limit, BYTE access, BYTE flags)
{
    set(0x000b, ourDS(), 0, 0, 0, (unsigned)(WORD)(DWORD)(BYTE FAR *)bytes);
    dpmi();
    report(group, "000Bh");
    bytes[0] = (BYTE)limit;
    bytes[1] = (BYTE)(limit >> 8);
    bytes[2] = (BYTE)base;
    bytes[3] = (BYTE)(base >> 8);
    bytes[4] = (BYTE)(base >> 16);
    bytes[5] = access;
    bytes[6] = flags;
    bytes[7] = (BYTE)(base >> 24);
    set(0x000c, selector, 0, 0, 0, (unsigned)(WORD)(DWORD)(BYTE FAR *)bytes);
    dpmi();
    report(group, "000Ch");
}

/* The record of a call through `target`: what it read, or its fault. */
static void outcome(LPCSTR group, LPCSTR what, WORD start, int checked, BYTE expected)
{
    if (excCalls == 0) {
        if (checked == 1) {
            wsprintf(probeResult, "read al=%02x ok=%u", after & 0xff, (after & 0xff) == expected);
        } else if (checked == 2) {
            lstrcpy(probeResult, "read");
        } else {
            wsprintf(probeResult, "ran al=%02x", after & 0xff);
        }
    } else {
        wsprintf(probeResult, "fault vec=%02x code=%04x calls=%u ip=+%x", excVector, excCode,
                 excCalls, excIP - start);
    }

    probe(group, what, probeResult);
}

/* A read through ES of `selector` at `offset`, the high word of EBX
 * `high`. */
static void readES(LPCSTR group, LPCSTR what, FARPROC reader, UINT selector, DWORD offset,
                   DWORD base)
{
    target = reader;
    resumeIP = offsetOf((FARPROC)resume);
    _asm mov ax, cs
    _asm mov resumeCS, ax
    excCalls = 0;
    testSelector = selector;
    testOffset = LOWORD(offset);
    testHigh = HIWORD(offset);
    _asm {
        push es
        push bx
        mov bx, testHigh
        db 66h, 0C1h, 0E3h, 10h /* shl ebx, 16 */
        mov bx, testOffset
        mov es, testSelector
        mov ax, 0EEEEh
        call dword ptr target
        mov after, ax
        db 66h, 33h, 0DBh /* xor ebx, ebx */
        pop bx
        pop es
    }
    outcome(group, what, offsetOf(reader), 1, pattern(offset));
    (void)base;
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HGLOBAL block, codeBlock;
    BYTE __huge *data;
    BYTE FAR *code;
    DWORD base, codeBase, at;
    UINT down, alias, stack;
    UINT oldGPCX, oldGPDX, oldSSCX, oldSSDX;
    FARPROC proc;
    WORD limit, stackBase;
    static const BYTE program[] = {0x90, 0x90, 0xb0, 0x05, 0xcb};
    UINT i;

    probeOpen(OUTPUT);

    block = GlobalAlloc(GMEM_FIXED, 0x20000L);
    data = (BYTE __huge *)GlobalLock(block);
    for (at = 0; at < 0x20000L; at++) {
        data[at] = pattern(at);
    }
    base = GetSelectorBase(HIWORD((DWORD)data));

    codeBlock = GlobalAlloc(GMEM_FIXED, 16);
    code = (BYTE FAR *)GlobalLock(codeBlock);
    for (i = 0; i < sizeof(program); i++) {
        code[i] = program[i];
    }
    codeBase = GetSelectorBase(HIWORD((DWORD)code));

    down = AllocSelector(ourDS());
    alias = AllocSelector(ourDS());
    stack = AllocSelector(ourDS());

    call("setup", "0202h 0Dh", 0x0202, 0x0D, 0, 0);
    oldGPCX = rCX;
    oldGPDX = rDX;
    call("setup", "0202h 0Ch", 0x0202, 0x0C, 0, 0);
    oldSSCX = rCX;
    oldSSDX = rDX;
    proc = (FARPROC)onGP;
    call("setup", "0203h 0Dh", 0x0203, 0x0D, HIWORD((DWORD)proc), LOWORD((DWORD)proc));
    proc = (FARPROC)onSS;
    call("setup", "0203h 0Ch", 0x0203, 0x0C, HIWORD((DWORD)proc), LOWORD((DWORD)proc));

    /* --- a control: data expanding up, limit 0FFFh, F3h --- */
    describe("up16", down, base, 0x0fff, 0xf3, 0x00);
    readES("up16", "byte 0fff", (FARPROC)readByte16, down, 0x0fff, base);
    readES("up16", "byte 1000", (FARPROC)readByte16, down, 0x1000, base);

    /* --- expand-down data, B clear: F7h, flags nought --- */
    describe("down16", down, base, 0x0fff, 0xf7, 0x00);
    readES("down16", "byte 0000", (FARPROC)readByte16, down, 0x0000, base);
    readES("down16", "byte 0800", (FARPROC)readByte16, down, 0x0800, base);
    readES("down16", "byte 0fff", (FARPROC)readByte16, down, 0x0fff, base);
    readES("down16", "byte 1000", (FARPROC)readByte16, down, 0x1000, base);
    readES("down16", "byte 8000", (FARPROC)readByte16, down, 0x8000, base);
    readES("down16", "byte ffff", (FARPROC)readByte16, down, 0xffff, base);
    readES("down16", "word 0ffe", (FARPROC)readWord16, down, 0x0ffe, base);
    readES("down16", "word 0fff", (FARPROC)readWord16, down, 0x0fff, base);
    readES("down16", "word 1000", (FARPROC)readWord16, down, 0x1000, base);
    readES("down16", "word fffe", (FARPROC)readWord16, down, 0xfffe, base);
    readES("down16", "word ffff", (FARPROC)readWord16, down, 0xffff, base);

    /* --- the same with the B bit: flags 40h --- */
    describe("down32", down, base, 0x0fff, 0xf7, 0x40);
    readES("down32", "byte 00000fff", (FARPROC)readByte32, down, 0x0fffL, base);
    readES("down32", "byte 00001000", (FARPROC)readByte32, down, 0x1000L, base);
    readES("down32", "byte 0000ffff", (FARPROC)readByte32, down, 0xffffL, base);
    readES("down32", "byte 00010000", (FARPROC)readByte32, down, 0x10000L, base);
    readES("down32", "word 0000ffff", (FARPROC)readWord32, down, 0xffffL, base);
    readES("down32", "word 0001fffe", (FARPROC)readWord32, down, 0x1fffeL, base);
    readES("down32", "word 16-bit ffff", (FARPROC)readWord16, down, 0xffffL, base);
    readES("down32", "word 16-bit 0fff", (FARPROC)readWord16, down, 0x0fffL, base);

    /* --- a fetch past the code segment's limit: code, readable, FBh --- */
    for (limit = 4; limit >= 1; limit--) {
        char what[16];

        describe("fetch", alias, codeBase, limit, 0xfb, 0x00);
        target = (FARPROC)(((DWORD)alias) << 16);
        resumeIP = offsetOf((FARPROC)resume);
        _asm mov ax, cs
        _asm mov resumeCS, ax
        excCalls = 0;
        _asm {
            mov ax, 0EEEEh
            call dword ptr target
            mov after, ax
        }
        wsprintf(what, "limit %u", limit);
        outcome("fetch", what, 0, 0, 0);
        if (excCalls) {
            wsprintf(probeResult, "%u", excCS == alias);
            probe("fetch", "fault's cs is the alias", probeResult);
        }
    }

    /* --- SS expanding down: the stack's own segment, limit 00FFh --- */
    _asm mov ax, ss
    _asm mov stackBase, ax
    describe("stack", stack, GetSelectorBase(stackBase), 0x00ff, 0xf7, 0x00);
    for (i = 0; i < 2; i++) {
        target = (FARPROC)readStack;
        resumeIP = offsetOf((FARPROC)resumeBP);
        _asm mov ax, cs
        _asm mov resumeCS, ax
        excCalls = 0;
        /* Above the limit: SP's own offset, where the stack is; below it, 10h. */
        _asm mov testOffset, sp
        if (i == 1) {
            testOffset = 0x10;
        }
        testSelector = stack;
        _asm {
            push bx
            mov ax, ss
            mov savedSS, ax
            mov bx, testOffset
            mov ax, 0EEEEh
            mov ss, testSelector
            call dword ptr target
            mov ss, savedSS
            mov after, ax
            pop bx
        }
        outcome("stack", i == 0 ? "byte at sp" : "byte 0010", offsetOf((FARPROC)readStack), 2, 0);
    }

    call("setup", "0203h 0Dh back", 0x0203, 0x0D, oldGPCX, oldGPDX);
    call("setup", "0203h 0Ch back", 0x0203, 0x0C, oldSSCX, oldSSDX);

    FreeSelector(down);
    FreeSelector(alias);
    FreeSelector(stack);
    GlobalUnlock(codeBlock);
    GlobalFree(codeBlock);
    GlobalUnlock(block);
    GlobalFree(block);
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
