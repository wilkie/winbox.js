/*
 * KERNEL's DebugBreak in the retail Windows, with no debugger: whether the
 * probe goes on past it (`after`), and the registers it keeps.
 */

#define PROBE_FLUSH
#include "probe.h"

#define OUTPUT "C:\\ORACLE\\KBREAK.OUT"

static FARPROC target;
static WORD rax, rbx, rcx, rdx;

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    probeOpen(OUTPUT);
    probe("break", "before", "");

    target = GetProcAddress(GetModuleHandle("KERNEL"), MAKEINTRESOURCE(203));

    _asm {
        mov ax, 1234h
        mov bx, 5678h
        mov cx, 9abh
        mov dx, 0cdeh
        call dword ptr target
        mov rax, ax
        mov rbx, bx
        mov rcx, cx
        mov rdx, dx
    }

    wsprintf(probeResult, "ax=%x,bx=%x,cx=%x,dx=%x", rax, rbx, rcx, rdx);
    probe("break", "after", probeResult);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
