/*
 * DOS's and the multiplex interrupt's register calls, as a program makes
 * them from Windows: INT 21h or INT 2Fh with every general register set
 * beforehand, and every one read back afterwards, the carry flag with them.
 *
 * Set `regs` (and `regs.ds`, for a call that takes a buffer at DS:DX; nought
 * keeps the probe's own), call `call21` or `call2f`, read `regs` again.
 * `regsText` writes them as a record's result: "AX BX CX DX c", c the carry.
 */

#ifndef REGCALL_H
#define REGCALL_H

struct Regs {
    unsigned ax, bx, cx, dx, ds, flags;
};

static struct Regs regs;

/* The registers, global, where the inline assembly reaches them. */
static unsigned rAX, rBX, rCX, rDX, rDS, rFlags;

static void regsIn(void)
{
    rAX = regs.ax;
    rBX = regs.bx;
    rCX = regs.cx;
    rDX = regs.dx;
    rDS = regs.ds;
}

static void regsOut(void)
{
    regs.ax = rAX;
    regs.bx = rBX;
    regs.cx = rCX;
    regs.dx = rDX;
    regs.flags = rFlags;
}

static void call21(void)
{
    regsIn();

    _asm {
        push si
        push di
        push ds
        mov ax, rDS
        or ax, ax
        jnz given
        mov ax, ds
    given:
        push ax
        mov ax, rAX
        mov bx, rBX
        mov cx, rCX
        mov dx, rDX
        pop ds
        int 21h
        pushf
        pop si
        pop ds
        mov rAX, ax
        mov rBX, bx
        mov rCX, cx
        mov rDX, dx
        mov rFlags, si
        pop di
        pop si
    }

    regsOut();
}

static void call2f(void)
{
    regsIn();

    _asm {
        push si
        push di
        push ds
        mov ax, rAX
        mov bx, rBX
        mov cx, rCX
        mov dx, rDX
        int 2Fh
        pushf
        pop si
        pop ds
        mov rAX, ax
        mov rBX, bx
        mov rCX, cx
        mov rDX, dx
        mov rFlags, si
        pop di
        pop si
    }

    regsOut();
}

/* The registers after a call, as a record's result. */
static void regsText(char *into)
{
    wsprintf(into, "%04x %04x %04x %04x %u", regs.ax, regs.bx, regs.cx, regs.dx,
             regs.flags & 1);
}

#endif
