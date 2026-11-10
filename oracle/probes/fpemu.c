/*
 * WIN87EM's emulator, recorded on a machine without a coprocessor
 * (`record.mjs`'s `WITHOUT_COPROCESSOR`: `NOFPU.COM` clears the BIOS's equipment word's
 * coprocessor bit before Windows starts; KERNEL reads it, `KRNL386.EXE`
 * seg1 `aa67`). The OS fixups make each floating-point instruction an
 * `INT 34h` to `3Dh`, and the emulator carries it out.
 *
 * * `flags`: `GetWinFlags`' coprocessor bit, 400h.
 * * `site`: the first bytes of `sum`, a function of floating-point
 *   instructions, after it has run: as the fixups left them, or as
 *   something wrote them back.
 * * `value`: what instructions left, times a thousand, rounded: 1 + 1 in
 *   C; the square root of 2; 10 / 4 by `FDIVR`; the constants pi and
 *   log2(e); `FCHS`; `FXCH`; an integer stored and loaded.
 * * `word`: the status word `FSTSW` stores after `FLD1`, and its TOP; the
 *   control word `FSTCW` stores. The waiting forms, which the compiler
 *   gives an `FWAIT` and a fixup: the no-wait forms it leaves as they are,
 *   and they would run on DOSBox's own unit.
 * * `report`: INT 3Eh's vector made the probe's, which keeps AX and
 *   returns; for each instruction, the AX it was given (or none), how
 *   often it was called, and whether the program went on past the
 *   instruction: `FNOP`, BX 1200h, and again BX 3400h; `FLDZ` `FLD1`
 *   `FDIVRP` (1 / 0); `FSQRT` of -1; `FINIT`; `FLDENV`. The vector then
 *   put back.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\FPEMU.OUT"

static WORD fpeCode;
static WORD fpeCalls;
static WORD fpPassed;
static DWORD oldVector;
static double fpResult;
static WORD fpWord;
static long fpInteger;
static BYTE fpEnvironment[14];

/* INT 3Eh's procedure: AX kept, counted. WIN87EM calls it with DS its own
 * (`WIN87EM.DLL` seg1 `6eb`-`71e`), on the program's stack, whose segment
 * is the probe's data. */
static void __declspec(naked) __far reported(void)
{
    _asm {
        mov word ptr ss:fpeCode, ax
        inc word ptr ss:fpeCalls
        retf
    }
}

static double sum(double a, double b)
{
    return a + b;
}

static void value(LPCSTR name)
{
    wsprintf(probeResult, "%ld", (long)(fpResult * 1000.0 + (fpResult < 0 ? -0.5 : 0.5)));
    probe("value", name, probeResult);
}

static void reportedAs(LPCSTR name)
{
    if (fpeCalls) {
        wsprintf(probeResult, "AX %04x calls %u passed %u", fpeCode, fpeCalls, fpPassed);
    } else {
        wsprintf(probeResult, "none passed %u", fpPassed);
    }

    probe("report", name, probeResult);
    fpeCode = 0;
    fpeCalls = 0;
    fpPassed = 0;
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    BYTE FAR *site;
    WORD vecOffset, vecSegment;
    int i;
    char *out;

    probeOpen(OUTPUT);

    wsprintf(probeResult, "%04x", (UINT)(GetWinFlags() & 0x400));
    probe("flags", "GetWinFlags & 400h", probeResult);

    fpResult = sum(1.0, 1.0);
    value("1 + 1");

    site = (BYTE FAR *)sum;
    out = probeResult;
    for (i = 0; i < 24; i++) {
        out += wsprintf(out, "%02x", site[i]);
    }
    probe("site", "sum", probeResult);

    _asm {
        fld1
        fadd st, st
        fsqrt
        fstp fpResult
    }
    value("sqrt 2");

    _asm {
        fld1
        fadd st, st
        fadd st, st
        mov fpWord, 10
        fild fpWord
        fdivr st(1), st
        fstp st(0)
        fstp fpResult
    }
    value("4 fdivr 10");

    _asm {
        fldpi
        fstp fpResult
    }
    value("pi");

    _asm {
        fldl2e
        fstp fpResult
    }
    value("log2 e");

    _asm {
        fld1
        fchs
        fstp fpResult
    }
    value("fchs 1");

    _asm {
        fld1
        fldz
        fxch st(1)
        fstp fpResult
        fstp st(0)
    }
    value("fxch");

    _asm {
        fldpi
        fistp fpInteger
        fild fpInteger
        fstp fpResult
    }
    value("fistp pi");

    _asm {
        fld1
        fstsw fpWord
        fstp st(0)
    }
    wsprintf(probeResult, "%04x top %u", fpWord, (fpWord >> 11) & 7);
    probe("word", "fstsw after fld1", probeResult);

    _asm {
        fstcw fpWord
    }
    wsprintf(probeResult, "%04x", fpWord);
    probe("word", "fstcw", probeResult);

    _asm {
        mov ax, 353eh
        int 21h
        mov word ptr oldVector, bx
        mov word ptr oldVector+2, es
    }

    vecOffset = LOWORD((DWORD)(FARPROC)reported);
    vecSegment = HIWORD((DWORD)(FARPROC)reported);
    _asm {
        push ds
        mov dx, vecOffset
        mov ax, vecSegment
        mov ds, ax
        mov ax, 253eh
        int 21h
        pop ds
    }

    _asm {
        push bx
        mov bx, 1200h
        fnop
        mov fpPassed, 1
        pop bx
    }
    reportedAs("fnop, BX 1200h");

    _asm {
        push bx
        mov bx, 3400h
        fnop
        mov fpPassed, 1
        pop bx
    }
    reportedAs("fnop, BX 3400h");

    _asm {
        fldz
        fld1
        fdivrp st(1), st
        mov fpPassed, 1
        fstp fpResult
    }
    reportedAs("1 / 0");

    _asm {
        fld1
        fchs
        fsqrt
        mov fpPassed, 1
        fstp fpResult
    }
    reportedAs("sqrt -1");

    _asm {
        finit
        mov fpPassed, 1
    }
    reportedAs("finit");

    _asm {
        fldenv fpEnvironment
        mov fpPassed, 1
    }
    reportedAs("fldenv");

    vecOffset = LOWORD(oldVector);
    vecSegment = HIWORD(oldVector);
    _asm {
        push ds
        mov dx, vecOffset
        mov ax, vecSegment
        mov ds, ax
        mov ax, 253eh
        int 21h
        pop ds
    }

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
