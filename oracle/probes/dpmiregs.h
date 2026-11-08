/*
 * INT 31h with every register the DPMI functions take, for the probes of
 * the DPMI host's functions (`dpmildt`, `dpmimem`, `dpmirm`, `dpmiexc`,
 * `dpmigro`): set the globals, call `dpmi()`, read them back. `rCarry` is
 * the carry after, nought or not.
 */

#ifndef DPMIREGS_H
#define DPMIREGS_H

static unsigned rAX, rBX, rCX, rDX, rSI, rDI, rES, rCarry;

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
        mov ax, es
        mov rES, ax
        pop es
        pop di
        pop si
    }
}

/* The registers set for a call, ES the data segment unless `rES` is set
 * after. */
static void set(unsigned ax, unsigned bx, unsigned cx, unsigned dx, unsigned si, unsigned di)
{
    rAX = ax;
    rBX = bx;
    rCX = cx;
    rDX = dx;
    rSI = si;
    rDI = di;
    _asm mov ax, ds
    _asm mov rES, ax
}

/* A call's record: the carry, and AX where it is set. */
static void report(LPCSTR group, LPCSTR function)
{
    if (rCarry) {
        wsprintf(probeResult, "cf=1 ax=%04x", rAX);
    } else {
        lstrcpy(probeResult, "cf=0");
    }

    probe(group, function, probeResult);
}

static void call(LPCSTR group, LPCSTR function, unsigned ax, unsigned bx, unsigned cx,
                 unsigned dx)
{
    set(ax, bx, cx, dx, 0, 0);
    dpmi();
    report(group, function);
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

/* The flags as they are now. */
static UINT flagsNow(void)
{
    UINT value = 0;

    _asm {
        pushf
        pop ax
        mov value, ax
    }

    return value;
}

#endif
