/*
 * A Win386 program with more than 64 KiB of 32-bit code: EIP past FFFFh
 * (`kb/topics/win386.md`). In a code segment whose D bit is set, EIP is 32
 * bits -- fetches, relative jumps and calls, `RET`, `RETF` and `IRETD` of
 * double words, far `CALL` and `JMP` with a six-byte pointer -- and the
 * limit checked is the whole EIP's. Recorded in 386 enhanced mode only
 * (`record.mjs --mode enhanced`). Built by `build-probes.mjs` as
 * `buildWin386` builds every `oracle/probes/win386` program.
 *
 * The source's order is the code's: `wcc386` emits the functions as they
 * come, and `wlink` puts this object's code first. The functions before
 * `crossing` lie low, below 10000h; `crossing` holds a loop whose body is
 * 72 KiB of `NOP`s, so that it spans 10000h wherever it starts; the
 * functions after it lie high, past 10000h.
 *
 * * `eip low` and `eip high`: the EIP a call pushes, in `WinMain` (low)
 *   and in a function past the loop (high), and whether it is past FFFFh.
 * * `near call`: a near `CALL` from low code landing past FFFFh, and the
 *   value the function returns with `RET` to the low caller.
 * * `near return`: from high code, a near `CALL` to a low function, whose
 *   `RET` returns to an EIP past FFFFh.
 * * `far call`: `CALL FWORD` (a far call of a double word) from low code
 *   to a high function, which returns with `RETF`.
 * * `far return`: from high code, `CALL FWORD` to a low function whose
 *   `RETF` returns to an EIP past FFFFh.
 * * `iretd`: from high code, `PUSHFD` and `CALL FWORD` to a low function
 *   whose `IRETD` returns to an EIP past FFFFh.
 * * `far jump`: `JMP FWORD` from low code to a high function, which jumps
 *   back the same way.
 * * `loop`: the loop of `crossing`, its body across 10000h, run three
 *   times: a backward jump from past FFFFh to below it.
 */

#include <stdio.h>
#include <stdlib.h>

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\W386EIP.OUT"

/* 16 NOPs, doubled to 72 KiB (4,608 times 16 bytes). */
#define NOPS16 _asm { db 90h, 90h, 90h, 90h, 90h, 90h, 90h, 90h, 90h, 90h, 90h, 90h, 90h, 90h, 90h, 90h }
#define NOPS32 NOPS16 NOPS16
#define NOPS64 NOPS32 NOPS32
#define NOPS128 NOPS64 NOPS64
#define NOPS256 NOPS128 NOPS128
#define NOPS512 NOPS256 NOPS256
#define NOPS1K NOPS512 NOPS512
#define NOPS2K NOPS1K NOPS1K
#define NOPS4K NOPS2K NOPS2K
#define NOPS8K NOPS4K NOPS4K
#define NOPS16K NOPS8K NOPS8K
#define NOPS32K NOPS16K NOPS16K
#define NOPS64K NOPS32K NOPS32K
#define NOPS72K NOPS64K NOPS8K

/* A far pointer of the 32-bit code: its offset, then its selector. */
static unsigned long farTo[2];
static unsigned long farBack[2];
static unsigned long lowValue;

static unsigned long highNear(void);
static unsigned long highCalls(void);
static unsigned long highFar(void);
static void highJump(void);
static unsigned long crossing(unsigned long times);

/* The EIP its caller's `CALL` pushed: where the caller goes on. */
static unsigned long __declspec(naked) callerEip(void)
{
    _asm {
        mov eax, [esp]
        ret
    }
}

/* A low function called near from high code: its `RET` goes past FFFFh. */
static unsigned long lowNear(unsigned long value)
{
    lowValue = callerEip();
    return value * 3 + 1;
}

/* Called far: `RETF` of a double word, to the caller's EIP. */
static unsigned long __declspec(naked) lowFar(void)
{
    _asm {
        mov eax, [esp]
        mov lowValue, eax
        mov eax, 0x4c4f4652
        retf
    }
}

/* Called far after `PUSHFD`: `IRETD`, to the caller's EIP. */
static unsigned long __declspec(naked) lowIret(void)
{
    _asm {
        mov eax, [esp]
        mov lowValue, eax
        mov eax, 0x49524554
        iretd
    }
}

/* CS. */
static unsigned short __declspec(naked) codeSelector(void)
{
    _asm {
        xor eax, eax
        mov ax, cs
        ret
    }
}

static void logEip(const char *name, unsigned long eip)
{
    wsprintf(probeResult, "%08lx, past ffff %s", eip, eip > 0xffffL ? "yes" : "no");
    probe("eip", name, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    unsigned long value, code;
    unsigned short selector;

    probeOpen(OUTPUT);

    selector = codeSelector();

    logEip("low", callerEip());
    logEip("crossing", (unsigned long)crossing);
    logEip("high", (unsigned long)highNear);

    value = highNear();
    wsprintf(probeResult, "%08lx", value);
    probe("near call", "returned", probeResult);

    value = highCalls();
    wsprintf(probeResult, "%08lx", value);
    probe("high calls", "returned", probeResult);

    farTo[0] = (unsigned long)highFar;
    farTo[1] = selector;
    _asm {
        call fword ptr farTo
        mov value, eax
    }
    wsprintf(probeResult, "%08lx, came back low", value);
    probe("far call", "returned", probeResult);

    lowValue = 0;
    farTo[0] = (unsigned long)highJump;
    farTo[1] = selector;
    _asm {
        call next
    next:
        pop eax
        add eax, 20
        mov farBack, eax
        jmp fword ptr farTo
        nop
        nop
        nop
        nop
        nop
        nop
        nop
        nop
        nop
    }
    code = callerEip();
    logEip("far jump went", lowValue);
    wsprintf(probeResult, "%s", code > 0xffffL ? "high" : "low");
    probe("far jump", "came back", probeResult);

    value = crossing(3);
    wsprintf(probeResult, "%lu", value);
    probe("loop", "times round", probeResult);
    logEip("loop ended", lowValue);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}

/* The loop across 10000h: its body 72 KiB of NOPs, then its count and a
 * jump back to its top. The EIP after the loop is kept in `lowValue`. */
static unsigned long crossing(unsigned long times)
{
    unsigned long count;

    for (count = 0; count < times; count++) {
        NOPS72K
    }

    lowValue = callerEip();
    return count;
}

/* High: past 10000h. */
static unsigned long highNear(void)
{
    logEip("high near", callerEip());
    return 0x48494748;
}

/* From high code, a near call and a far one to low functions, and an
 * `IRETD` back. */
static unsigned long highCalls(void)
{
    unsigned long value, back;
    unsigned short selector;

    value = lowNear(5);
    wsprintf(probeResult, "%lu", value);
    probe("near return", "returned", probeResult);
    logEip("near return to", lowValue);
    logEip("near return at", callerEip());

    selector = codeSelector();
    farTo[0] = (unsigned long)lowFar;
    farTo[1] = selector;
    lowValue = 0;
    _asm {
        call fword ptr farTo
        mov value, eax
    }
    back = callerEip();
    wsprintf(probeResult, "%08lx", value);
    probe("far return", "returned", probeResult);
    logEip("far return to", lowValue);
    logEip("far return at", back);

    farTo[0] = (unsigned long)lowIret;
    lowValue = 0;
    _asm {
        pushfd
        call fword ptr farTo
        mov value, eax
    }
    back = callerEip();
    wsprintf(probeResult, "%08lx", value);
    probe("iretd", "returned", probeResult);
    logEip("iretd to", lowValue);
    logEip("iretd at", back);

    return 0x43414c4c;
}

/* Called far from low code: `RETF` back. */
static unsigned long __declspec(naked) highFar(void)
{
    _asm {
        mov eax, 0x48464152
        retf
    }
}

/* Jumped to far from low code: notes its EIP and jumps back the same way. */
static void __declspec(naked) highJump(void)
{
    _asm {
        call here
    here:
        pop eax
        mov lowValue, eax
        mov ax, cs
        mov word ptr farBack + 4, ax
        jmp fword ptr farBack
    }
}
