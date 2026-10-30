/*
 * KERNEL's EMSCopy (160), whose entry in the file, seg1 `a940`, is where
 * KERNEL cuts its first code segment once it has started (`KRNL386.EXE`
 * seg1 `b565`-`b573`): what is there when a program calls it.
 *
 * * `entry`: the limit of the entry's selector, and whether its offset is
 *   past it.
 * * `call`: EMSCopy of seven noughts, with AX 1234h and DX 5678h: AX and DX
 *   after, and the bytes of arguments left on the stack.
 */

#define PROBE_FLUSH
#include "probe.h"

#define OUTPUT "C:\\ORACLE\\EMSCOPY.OUT"

DWORD FAR PASCAL GetSelectorLimit(UINT);

static FARPROC target;
static WORD rax, rdx, spBefore, spAfter;

static void callSeven(void)
{
    _asm {
        push si
        push di
        push es
        push bx
        push cx
        mov spBefore, sp
        xor ax, ax
        push ax
        push ax
        push ax
        push ax
        push ax
        push ax
        push ax
        mov ax, 1234h
        mov dx, 5678h
        call dword ptr target
        mov rax, ax
        mov rdx, dx
        mov spAfter, sp
        mov sp, spBefore
        pop cx
        pop bx
        pop es
        pop di
        pop si
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    DWORD address;
    DWORD limit;

    probeOpen(OUTPUT);

    address = (DWORD)GetProcAddress(GetModuleHandle("KERNEL"), MAKEINTRESOURCE(160));
    limit = GetSelectorLimit(HIWORD(address));
    wsprintf(probeResult, "offset=%x,limit=%lx,past=%s", LOWORD(address), limit,
             (LPSTR)((DWORD)LOWORD(address) > limit ? "yes" : "no"));
    probe("entry", "EMSCopy", probeResult);

    target = (FARPROC)address;
    callSeven();
    wsprintf(probeResult, "ax=%x,dx=%x,left=%u", rax, rdx, spBefore - spAfter);
    probe("call", "EMSCopy", probeResult);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
