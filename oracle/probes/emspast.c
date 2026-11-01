/*
 * What lies past the end of KERNEL's first code segment, where EMSCopy's
 * entry (160, seg1 `a940`) is: the probe `emscopy` found that a call to
 * it comes back with AX 81h and six bytes popped. A far call to an offset
 * past a code segment's limit is a general protection fault on a 386, but
 * DOSBox 0.74 checks no offset against a code segment's limit (`cpu.cpp`,
 * `CPU_CALL`): it runs whatever lies in memory there. This finds what.
 *
 * * `entry`: the entry's offset and its selector's limit.
 * * `block`: the global heap's block that holds the entry's linear address
 *   (TOOLHELP's GlobalFirst and GlobalNext over every block): whether it is
 *   the block of the entry's own selector, its type, its owner's module
 *   name, its datum (a code or data block's segment number), and where in
 *   it the entry falls.
 * * `bytes`: the 32 bytes at that linear address, read through a selector
 *   of the probe's own.
 * * `call`: EMSCopy of seven noughts, with AX 1234h and DX 5678h, as
 *   `emscopy` calls it: AX and DX after, and the bytes left on the stack.
 */

#define PROBE_FLUSH
#include "probe.h"

#include <toolhelp.h>

#define OUTPUT "C:\\ORACLE\\EMSPAST.OUT"

DWORD FAR PASCAL GetSelectorBase(UINT);
DWORD FAR PASCAL GetSelectorLimit(UINT);
UINT FAR PASCAL SetSelectorBase(UINT, DWORD);
UINT FAR PASCAL SetSelectorLimit(UINT, DWORD);

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

static LPCSTR typeName(WORD type)
{
    switch (type) {
    case GT_UNKNOWN:
        return "unknown";
    case GT_DGROUP:
        return "dgroup";
    case GT_DATA:
        return "data";
    case GT_CODE:
        return "code";
    case GT_TASK:
        return "task";
    case GT_RESOURCE:
        return "resource";
    case GT_MODULE:
        return "module";
    case GT_FREE:
        return "free";
    case GT_INTERNAL:
        return "internal";
    case GT_SENTINEL:
        return "sentinel";
    case GT_BURGERMASTER:
        return "burgermaster";
    }
    return "other";
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    DWORD address;
    DWORD base;
    DWORD linear;
    GLOBALENTRY entry;
    MODULEENTRY module;
    BOOL more;
    BOOL found = FALSE;
    UINT selector;
    BYTE FAR *bytes;
    int i;
    char *out;

    probeOpen(OUTPUT);

    address = (DWORD)GetProcAddress(GetModuleHandle("KERNEL"), MAKEINTRESOURCE(160));
    base = GetSelectorBase(HIWORD(address));
    linear = base + LOWORD(address);
    wsprintf(probeResult, "offset=%x,limit=%lx", LOWORD(address), GetSelectorLimit(HIWORD(address)));
    probe("entry", "EMSCopy", probeResult);

    entry.dwSize = sizeof(entry);
    more = GlobalFirst(&entry, GLOBAL_ALL);
    while (more) {
        if (entry.dwAddress <= linear && linear < entry.dwAddress + entry.dwBlockSize) {
            module.dwSize = sizeof(module);
            module.szModule[0] = 0;
            if (entry.hOwner) {
                ModuleFindHandle(&module, (HMODULE)entry.hOwner);
            }
            wsprintf(probeResult, "own=%s,type=%s,owner=%s,datum=%u,at=%lx,size=%lx",
                     (LPSTR)(entry.dwAddress == base ? "yes" : "no"), (LPSTR)typeName(entry.wType),
                     (LPSTR)module.szModule, entry.wData, linear - entry.dwAddress,
                     entry.dwBlockSize);
            probe("block", "EMSCopy", probeResult);
            found = TRUE;
        }
        more = GlobalNext(&entry, GLOBAL_ALL);
    }
    if (!found) {
        probe("block", "EMSCopy", "none");
    }

    selector = AllocSelector(HIWORD((DWORD)(LPVOID)&found));
    SetSelectorBase(selector, linear);
    SetSelectorLimit(selector, 0x1f);
    bytes = (BYTE FAR *)MAKELP(selector, 0);
    out = probeResult;
    for (i = 0; i < 32; i++) {
        out += wsprintf(out, "%02x", bytes[i]);
    }
    FreeSelector(selector);
    probe("bytes", "EMSCopy", probeResult);

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
