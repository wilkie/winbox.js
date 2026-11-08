/*
 * The DPMI host's exception handlers and protected mode interrupt vectors,
 * INT 31h 0202h-0205h, recorded in each mode (`record.mjs --mode enhanced`;
 * `kb/topics/dpmi-functions.md`). Each handler the probe puts in is taken
 * out again, the one before it set back.
 *
 * * `exception`: 0202h of 0, 6, 0Dh, 0Eh, 10h, 11h, 1Fh and 20h: the
 *   carry, AX where set, and whether the handler's selector is code.
 * * `divide`: 0203h of exception 0 to the probe's handler; a divide by
 *   nought; what the handler was given -- how often it was called, the
 *   error code, whether the frame's CS:IP is the instruction that faulted,
 *   its flags' interrupt flag, whether its SS:SP is the caller's, whether
 *   the handler's own stack is the caller's, and the return address's
 *   privilege -- and that the program went on past it, the handler having
 *   moved IP on. 0203h back.
 * * `protection`: the same for 0Dh, a general protection fault: ES loaded
 *   with FFF7h.
 * * `vector`: 0204h of 21h; 0205h of 61h to the probe's handler and INT
 *   61h, how often it was called; 0205h of 21h to a handler that counts
 *   and goes on to the one before it, and INT 21h 30h through it: how often
 *   it was called, and AL. Each set back.
 */

#define PROBE_FLUSH
#include "probe.h"
#include "dpmiregs.h"

#define OUTPUT "C:\\ORACLE\\DPMIEXC.OUT"

static WORD excCalls, excCode, excIP, excCS, excFlags, excSP, excSS, excOwnSS, excRetCS;
static WORD excSkip = 2;
static WORD callerSP, callerSS;
static FARPROC target;
static WORD intCalls;
static DWORD oldInt21;
static WORD chainCalls;

/* An exception handler: the frame above a far return address -- the error
 * code, IP, CS, the flags, SP, SS -- noted, and IP moved on past the
 * instruction. DS is the faulting code's, the probe's. */
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
        mov ax, [bp+0Ch]
        mov excFlags, ax
        mov ax, [bp+0Eh]
        mov excSP, ax
        mov ax, [bp+10h]
        mov excSS, ax
        mov ax, ss
        mov excOwnSS, ax
        mov ax, [bp+4]
        mov excRetCS, ax
        mov ax, excSkip
        add [bp+8], ax
        pop ax
        pop bp
        retf
    }
}

/* A divide by nought, its first instruction: AX 1, BL nought. */
static void __declspec(naked) __far divide(void)
{
    _asm {
        div bl
        retf
    }
}

/* ES loaded with BX, its first instruction. */
static void __declspec(naked) __far loadES(void)
{
    _asm {
        mov es, bx
        retf
    }
}

/* A protected mode interrupt's handler, counting. */
static void __declspec(naked) __far counted(void)
{
    _asm {
        inc word ptr intCalls
        iret
    }
}

/* INT 21h's, counting and going on to the one before. */
static void __declspec(naked) __far chained(void)
{
    _asm {
        inc word ptr chainCalls
        jmp dword ptr oldInt21
    }
}

static void exception(UINT number)
{
    char name[24];
    UINT rights = 0, valid = 0, selector;

    wsprintf(name, "0202h %02xh", number);
    call("exception", name, 0x0202, number, 0, 0);
    if (!rCarry) {
        selector = rCX;
        _asm {
            mov bx, selector
            db 0fh, 02h, 0c3h /* lar ax, bx */
            jnz bad
            mov rights, ax
            mov valid, 1
        bad:
        }
        wsprintf(name, "0202h %02xh handler", number);
        probe("exception", name, !valid ? "no selector" : (rights & 0x0800) ? "code" : "data");
    }
}

static void seen(LPCSTR group, FARPROC faulted)
{
    wsprintf(probeResult, "calls=%u code=%04x at-fault=%u if=%u caller-stack=%u", excCalls,
             excCode, excIP == LOWORD((DWORD)faulted) && excCS == HIWORD((DWORD)faulted),
             (excFlags >> 9) & 1, excSS == callerSS && excSP == callerSP - 4);
    probe(group, "seen", probeResult);
    wsprintf(probeResult, "own-stack-caller's=%u return-rpl=%u", excOwnSS == callerSS,
             excRetCS & 3);
    probe(group, "handler", probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    UINT oldCX, oldDX, after = 0;
    FARPROC proc;
    static const UINT numbers[] = {0x00, 0x06, 0x0D, 0x0E, 0x10, 0x11, 0x1F, 0x20};
    UINT i;

    probeOpen(OUTPUT);

    for (i = 0; i < sizeof(numbers) / sizeof(numbers[0]); i++) {
        exception(numbers[i]);
    }

    /* --- a divide by nought --- */
    call("divide", "0202h", 0x0202, 0x00, 0, 0);
    oldCX = rCX;
    oldDX = rDX;
    proc = (FARPROC)handler;
    call("divide", "0203h", 0x0203, 0x00, HIWORD((DWORD)proc), LOWORD((DWORD)proc));
    if (!rCarry) {
        target = (FARPROC)divide;
        excCalls = 0;
        _asm {
            mov ax, ss
            mov callerSS, ax
            mov ax, 1
            xor bx, bx
            mov callerSP, sp
            call dword ptr target
            mov after, ax
        }
        probe("divide", "went on", "yes");
        wsprintf(probeResult, "%04x", after);
        probe("divide", "ax", probeResult);
        seen("divide", (FARPROC)divide);
        call("divide", "0203h back", 0x0203, 0x00, oldCX, oldDX);
    }

    /* --- a general protection fault --- */
    call("protection", "0202h", 0x0202, 0x0D, 0, 0);
    oldCX = rCX;
    oldDX = rDX;
    call("protection", "0203h", 0x0203, 0x0D, HIWORD((DWORD)proc), LOWORD((DWORD)proc));
    if (!rCarry) {
        target = (FARPROC)loadES;
        excCalls = 0;
        _asm {
            push es
            mov ax, ss
            mov callerSS, ax
            mov bx, 0FFF7h
            mov callerSP, sp
            call dword ptr target
            pop es
        }
        probe("protection", "went on", "yes");
        seen("protection", (FARPROC)loadES);
        call("protection", "0203h back", 0x0203, 0x0D, oldCX, oldDX);
    }

    /* --- protected mode vectors --- */
    call("vector", "0204h 21h", 0x0204, 0x21, 0, 0);
    oldInt21 = ((DWORD)rCX << 16) | rDX;

    call("vector", "0204h 61h", 0x0204, 0x61, 0, 0);
    oldCX = rCX;
    oldDX = rDX;
    proc = (FARPROC)counted;
    call("vector", "0205h 61h", 0x0205, 0x61, HIWORD((DWORD)proc), LOWORD((DWORD)proc));
    if (!rCarry) {
        _asm int 61h
        wsprintf(probeResult, "%u", intCalls);
        probe("vector", "INT 61h calls", probeResult);
        call("vector", "0205h 61h back", 0x0205, 0x61, oldCX, oldDX);
    }

    proc = (FARPROC)chained;
    call("vector", "0205h 21h", 0x0205, 0x21, HIWORD((DWORD)proc), LOWORD((DWORD)proc));
    if (!rCarry) {
        _asm {
            mov ax, 3000h
            int 21h
            mov after, ax
        }
        call("vector", "0205h 21h back", 0x0205, 0x21, HIWORD(oldInt21), LOWORD(oldInt21));
        wsprintf(probeResult, "calls=%u al=%02x", chainCalls, after & 0xff);
        probe("vector", "INT 21h 30h chained", probeResult);
    }

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
