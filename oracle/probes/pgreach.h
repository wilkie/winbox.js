/*
 * A byte read or written at a linear address through a selector of the
 * probe's own, its base set with DPMI 0007h, under exception handlers of
 * the probe's own (0203h): the paging probes' common part
 * (`kb/guides/paging.md`, `pgtouch` the first). Include after `probe.h`
 * and `dpmiregs.h`.
 *
 * `reachOpen` takes the selector (0000h, its limit FFFFh with 0008h) and
 * puts in the handlers for the vectors asked; `reachClose` puts back what
 * was there and frees the selector. A handler notes which vector it took,
 * the error code and CS:IP, counts the call, and moves IP on by `excSkip`
 * past the instruction, which `readByte`, `writeByte` and the probes' own
 * instructions of 3 bytes make 3.
 */

#ifndef PGREACH_H
#define PGREACH_H

static WORD excCalls, excCode, excIP, excCS, excVector;
static WORD excSkip = 3;
static WORD probeSel;
static FARPROC target;

/* A byte's value as `readByte` left it in AL, or the byte `writeByte`
 * writes. */
static BYTE reachValue;

/* The three handlers, alike but for the vector each notes. */
static void __declspec(naked) __far handler06(void)
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
        mov word ptr excVector, 06h
        mov ax, excSkip
        add [bp+8], ax
        pop ax
        pop bp
        retf
    }
}

static void __declspec(naked) __far handler0D(void)
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
        mov word ptr excVector, 0Dh
        mov ax, excSkip
        add [bp+8], ax
        pop ax
        pop bp
        retf
    }
}

static void __declspec(naked) __far handler0E(void)
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
        mov word ptr excVector, 0Eh
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

static struct {
    WORD vector;
    FARPROC handler;
    WORD oldCX, oldDX;
    WORD put;
} reachHandlers[] = {
    {0x06, (FARPROC)handler06, 0, 0, 0},
    {0x0D, (FARPROC)handler0D, 0, 0, 0},
    {0x0E, (FARPROC)handler0E, 0, 0, 0},
};

#define REACH_06 1
#define REACH_0D 2
#define REACH_0E 4

/* The selector taken and the handlers asked for put in; nought where 0000h
 * refused a selector. */
static UINT reachOpen(UINT vectors)
{
    UINT i;

    set(0x0000, 0, 1, 0, 0, 0);
    dpmi();
    if (rCarry) {
        return 0;
    }
    probeSel = rAX;
    set(0x0008, probeSel, 0, 0xFFFF, 0, 0);
    dpmi();

    for (i = 0; i < sizeof(reachHandlers) / sizeof(reachHandlers[0]); i++) {
        if (!(vectors & (1 << i))) {
            continue;
        }
        set(0x0202, reachHandlers[i].vector, 0, 0, 0, 0);
        dpmi();
        reachHandlers[i].oldCX = rCX;
        reachHandlers[i].oldDX = rDX;
        set(0x0203, reachHandlers[i].vector, HIWORD((DWORD)reachHandlers[i].handler),
            LOWORD((DWORD)reachHandlers[i].handler), 0, 0);
        dpmi();
        reachHandlers[i].put = !rCarry;
    }

    return 1;
}

static void reachClose(void)
{
    UINT i;

    for (i = 0; i < sizeof(reachHandlers) / sizeof(reachHandlers[0]); i++) {
        if (reachHandlers[i].put) {
            set(0x0203, reachHandlers[i].vector, reachHandlers[i].oldCX, reachHandlers[i].oldDX,
                0, 0);
            dpmi();
            reachHandlers[i].put = 0;
        }
    }

    set(0x0001, probeSel, 0, 0, 0, 0);
    dpmi();
}

/* DX:CX's double word set with 0007h as the probe selector's base. */
static UINT based(DWORD linear)
{
    set(0x0007, probeSel, HIWORD(linear), LOWORD(linear), 0, 0);
    dpmi();
    return !rCarry;
}

/* A byte read or written at `at` of the selector as it is based: the
 * handlers' calls. `reachValue` is the byte written, or AL after a read
 * (5Ah before it, so a read stepped over leaves 5Ah). */
static UINT reachAt(UINT at, FARPROC how)
{
    UINT sel = probeSel;
    BYTE value = reachValue;

    if (how == (FARPROC)readByte) {
        value = 0x5A;
    }

    excCalls = 0;
    excCode = 0;
    excVector = 0;
    target = how;
    _asm {
        push es
        mov ax, sel
        mov es, ax
        mov bx, at
        mov al, value
        call dword ptr target
        pop es
        mov value, al
    }
    reachValue = value;

    return excCalls;
}

/* The same at a linear address: FFFFh where 0007h refused the base. */
static UINT reach(DWORD linear, FARPROC how)
{
    if (!based(linear)) {
        return 0xFFFF;
    }

    return reachAt(0, how);
}

/* The handlers' record of the last reach: "no fault", or the calls, the
 * vector, the error code and whether CS:IP was the instruction. */
static void reachSay(UINT calls, FARPROC how)
{
    if (calls == 0xFFFF) {
        lstrcpy(probeResult, "0007h refused");
    } else if (calls == 0) {
        lstrcpy(probeResult, "no fault");
    } else {
        wsprintf(probeResult, "fault calls=%u vector=%02x code=%04x at-fault=%u", calls,
                 excVector, excCode,
                 excIP == LOWORD((DWORD)how) && excCS == HIWORD((DWORD)how));
    }
}

#endif
