/*
 * How many instructions a second Windows runs under the recorder's DOSBox
 * (`cycles=max`), for the workloads of winbox.js's own benchmark
 * (`bench/cpu.ts`), the same instructions, so the two can be set side by
 * side. Timings, not answers: they vary with the host and from run to run,
 * and are kept in `fixtures/timings/`, not replayed.
 *
 * Each workload's instructions are the body of a `LOOP` with CX 65535. It is
 * run, pass after pass, until at least two seconds by `GetTickCount` have
 * passed, three times over:
 *
 * * `rate`: the workload and the run, as instructions a millisecond -- the
 *   body's instructions and the `LOOP`, 65,535 times a pass -- then the
 *   passes and the milliseconds.
 *
 * `alu`: register arithmetic, eight instructions. `memory`: loads and
 * stores through BX, six. `stack`: pushes and pops, six. `mixed`:
 * arithmetic against memory, seven. `loop`: `LOOP` alone, as `speed` has it.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\CPURATE.OUT"

static BYTE buffer[64];

static void passAlu(void)
{
    _asm {
        mov cx, 65535
        mov bx, 3
        mov dx, 5
    top:
        add ax, bx
        sub ax, cx
        xor ax, dx
        and ax, bx
        or ax, cx
        shl ax, 1
        inc ax
        dec ax
        loop top
    }
}

static void passMemory(void)
{
    _asm {
        lea bx, buffer
        mov cx, 65535
    top:
        mov al, [bx]
        mov [bx], al
        mov ax, [bx]
        mov [bx], ax
        mov ax, [bx+10h]
        mov [bx+20h], ax
        loop top
    }
}

static void passStack(void)
{
    _asm {
        mov cx, 65535
    top:
        push ax
        push bx
        push dx
        pop dx
        pop bx
        pop ax
        loop top
    }
}

static void passMixed(void)
{
    _asm {
        lea bx, buffer
        mov cx, 65535
    top:
        mov ax, [bx]
        add ax, [bx+2]
        mov [bx+4], ax
        sub ax, [bx+6]
        mov [bx], ax
        inc bx
        dec bx
        loop top
    }
}

static void passLoop(void)
{
    _asm {
        mov cx, 65535
    top:
        loop top
    }
}

static void measure(LPCSTR name, void (*pass)(void), int body)
{
    int run;

    for (run = 1; run <= 3; run++) {
        DWORD start = GetTickCount();
        DWORD elapsed;
        long passes = 0;

        do {
            pass();
            passes++;
            elapsed = GetTickCount() - start;
        } while (elapsed < 2000);

        wsprintf(probeArgs, "%s,%d", name, run);
        wsprintf(probeResult, "%ld,%ld,%ld", (long)((passes * 65535L * (body + 1)) / (long)elapsed),
                 passes, (long)elapsed);
        probe("rate", probeArgs, probeResult);
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    probeOpen(OUTPUT);

    measure("loop", passLoop, 0);
    measure("alu", passAlu, 8);
    measure("memory", passMemory, 6);
    measure("stack", passStack, 6);
    measure("mixed", passMixed, 7);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
