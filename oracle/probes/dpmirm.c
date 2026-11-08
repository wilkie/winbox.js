/*
 * The DPMI host's calls into real mode, INT 31h 0300h-0304h, and the real
 * mode interrupt vectors, 0200h and 0201h, recorded in each mode
 * (`record.mjs --mode enhanced`; `kb/topics/dpmi-functions.md`). Every
 * call is one Windows' own real mode answers harmlessly -- DOS's and the
 * BIOS's -- or one of the probe's own callbacks, called through the host
 * itself.
 *
 * * `dos`: 0300h of INT 21h with a structure of the probe's (the host's
 *   stack, SS:SP nought): DOS's version (30h); the current drive (19h);
 *   the current folder of C: (47h) into a block of DOS memory from
 *   `GlobalDosAlloc`; `C:\WINDOWS\WIN.INI` opened (3D00h), its first 16
 *   bytes read (3Fh) into the block and closed (3Eh); a file that is not
 *   there opened. For each, the carry 0300h answers and the structure's
 *   carry and AX after; the folder and the bytes read as text.
 * * `bios`: 0300h of INT 12h, the conventional memory's size.
 * * `stack`: 0300h of DOS's version with one word copied to the real mode
 *   stack (CX 1); the structure's SS and SP after.
 * * `callback`: 0303h of a callback to the probe's own procedure: the
 *   carry, DX and CX. 0301h of it, as a far call,
 *   and 0302h, as an interrupt: the carry, and the structure's AX, BX
 *   and CX after, set by the procedure. What the procedure saw: how often
 *   it was called, whether ES:DI was the structure given to 0303h, the
 *   structure's AX and BX as the call left them, its SS and SP nought or
 *   not, and the interrupt flag. 0300h of INT 60h with its real mode
 *   vector set to the callback (0201h), and the vector set back.
 *   0304h of it, twice, and of nought. 0303h until refused: how many.
 * * `vector`: 0200h of 60h, 0201h of it to 1234h:5678h and 0200h again,
 *   set back; whether 0200h of 50h-57h is 0200h of 08h-0Fh.
 */

#define PROBE_FLUSH
#include "probe.h"
#include "dpmiregs.h"

#define OUTPUT "C:\\ORACLE\\DPMIRM.OUT"

/* The real mode call structure, 32h bytes. */
typedef struct {
    DWORD edi, esi, ebp, reserved, ebx, edx, ecx, eax;
    WORD flags, es, ds, fs, gs, ip, cs, sp, ss;
} RMCS;

static RMCS rm;
static RMCS cbRegs;

/* What the callback saw. */
static WORD cbCalls, cbStackSel, cbStackOff, cbES, cbDI, cbFlags, cbAX, cbBX, cbSP, cbSS;
/* What it takes off the real mode stack: 4 for a far call, 6 for an
 * interrupt. */
static WORD cbPop = 4;

/* Called by the host in protected mode: DS:SI the real mode stack, ES:DI
 * the structure given to 0303h, which is in the probe's data segment. It
 * returns as the real mode code was called -- the return address off the
 * stack into the structure, and the flags for an interrupt -- with AX
 * 4321h and CX 9. */
static void __declspec(naked) __far callback(void)
{
    _asm {
        push ax
        push bx
        mov ax, ds
        push es
        pop ds
        mov cbStackSel, ax
        mov cbStackOff, si
        inc word ptr cbCalls
        mov ax, es
        mov cbES, ax
        mov cbDI, di
        pushf
        pop ax
        mov cbFlags, ax
        mov ax, word ptr es:[di+1Ch]
        mov cbAX, ax
        mov ax, word ptr es:[di+10h]
        mov cbBX, ax
        mov ax, word ptr es:[di+2Eh]
        mov cbSP, ax
        mov ax, word ptr es:[di+30h]
        mov cbSS, ax
        push ds
        mov ax, cbStackSel
        mov ds, ax
        mov ax, [si]
        mov bx, [si+2]
        pop ds
        mov word ptr es:[di+2Ah], ax
        mov word ptr es:[di+2Ch], bx
        mov ax, cbPop
        add word ptr es:[di+2Eh], ax
        cmp ax, 6
        jne done
        push ds
        mov ax, cbStackSel
        mov ds, ax
        mov ax, [si+4]
        pop ds
        mov word ptr es:[di+20h], ax
    done:
        mov word ptr es:[di+1Ch], 4321h
        mov word ptr es:[di+18h], 9
        pop bx
        pop ax
        iret
    }
}

/* 0300h-0302h with `rm`: the carry 0300h answers. */
static void real(LPCSTR group, LPCSTR name, UINT function, UINT vector, UINT words)
{
    set(function, vector, words, 0, 0, (UINT)(RMCS FAR *)&rm);
    dpmi();
    report(group, name);
}

static void clear(void)
{
    _fmemset(&rm, 0, sizeof(rm));
}

/* The structure's carry and AX after. */
static void result(LPCSTR group, LPCSTR name)
{
    char text[48];

    wsprintf(text, "%s result", name);
    wsprintf(probeResult, "cf=%u ax=%04x", rm.flags & 1, (UINT)rm.eax);
    probe(group, text, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    DWORD dos;
    UINT para, sel, handle, i, count;
    LPSTR text;
    UINT cbSeg = 0, cbOff = 0, savedCX, savedDX, given;
    FARPROC proc = (FARPROC)callback;
    UINT procSeg = (UINT)((DWORD)proc >> 16);
    UINT procOff = (UINT)(DWORD)proc;
    UINT callbacks[40];
    UINT callbackSegs[40];
    char name[48];

    probeOpen(OUTPUT);

    dos = GlobalDosAlloc(512);
    para = HIWORD(dos);
    sel = LOWORD(dos);
    text = (LPSTR)MAKELP(sel, 0);
    probe("dos", "GlobalDosAlloc", dos ? "given" : "refused");

    /* --- INT 21h through 0300h --- */
    clear();
    rm.eax = 0x3000;
    real("dos", "30h", 0x0300, 0x21, 0);
    wsprintf(probeResult, "al=%02x ah=%02x", (UINT)rm.eax & 0xff, ((UINT)rm.eax >> 8) & 0xff);
    probe("dos", "30h version", probeResult);
    wsprintf(probeResult, "ss=%04x sp=%04x", rm.ss, rm.sp);
    probe("stack", "30h ss:sp after", probeResult);

    clear();
    rm.eax = 0x1900;
    real("dos", "19h", 0x0300, 0x21, 0);
    wsprintf(probeResult, "al=%02x", (UINT)rm.eax & 0xff);
    probe("dos", "19h drive", probeResult);

    if (dos) {
        clear();
        rm.eax = 0x4700;
        rm.edx = 3;
        rm.ds = para;
        rm.esi = 0;
        text[0] = 0;
        real("dos", "47h", 0x0300, 0x21, 0);
        result("dos", "47h");
        probe("dos", "47h folder", text);

        lstrcpy(text, "C:\\WINDOWS\\WIN.INI");
        clear();
        rm.eax = 0x3D00;
        rm.ds = para;
        rm.edx = 0;
        real("dos", "3D00h", 0x0300, 0x21, 0);
        probe("dos", "3D00h handle", (rm.flags & 1) ? "none" : ((UINT)rm.eax > 4 ? "given" : "low"));
        handle = (UINT)rm.eax;

        if (!(rm.flags & 1)) {
            clear();
            rm.eax = 0x3F00;
            rm.ebx = handle;
            rm.ecx = 16;
            rm.ds = para;
            rm.edx = 0x100;
            real("dos", "3Fh", 0x0300, 0x21, 0);
            result("dos", "3Fh");
            text[0x110] = 0;
            probe("dos", "3Fh bytes", text + 0x100);

            clear();
            rm.eax = 0x3E00;
            rm.ebx = handle;
            real("dos", "3Eh", 0x0300, 0x21, 0);
            wsprintf(probeResult, "cf=%u", rm.flags & 1);
            probe("dos", "3Eh result", probeResult);
        }

        lstrcpy(text, "C:\\NOSUCH.FIL");
        clear();
        rm.eax = 0x3D00;
        rm.ds = para;
        rm.edx = 0;
        real("dos", "3D00h missing", 0x0300, 0x21, 0);
        result("dos", "3D00h missing");
    }

    /* --- INT 12h --- */
    clear();
    real("bios", "12h", 0x0300, 0x12, 0);
    wsprintf(probeResult, "ax=%04x", (UINT)rm.eax);
    probe("bios", "12h size", probeResult);

    /* --- a word on the real mode stack --- */
    clear();
    rm.eax = 0x3000;
    _asm push ax
    real("stack", "30h one word", 0x0300, 0x21, 1);
    _asm pop ax
    wsprintf(probeResult, "al=%02x", (UINT)rm.eax & 0xff);
    probe("stack", "30h one word version", probeResult);

    /* --- callbacks --- */
    rAX = 0x0303;
    rSI = procOff;
    rDI = (UINT)(RMCS FAR *)&cbRegs;
    _asm {
        push si
        push di
        push es
        push ds
        push ds
        pop es
        mov si, rSI
        mov di, rDI
        mov ax, procSeg
        push ax
        mov ax, rAX
        pop ds
        int 31h
        pop ds
        mov rCX, cx
        mov rDX, dx
        mov rAX, ax
        sbb ax, ax
        mov rCarry, ax
        pop es
        pop di
        pop si
    }
    report("callback", "0303h");
    if (!rCarry) {
        cbSeg = rCX;
        cbOff = rDX;
        wsprintf(probeResult, "dx=%04x cx=%04x", cbOff, cbSeg);
        probe("callback", "0303h address", probeResult);

        clear();
        rm.cs = cbSeg;
        rm.ip = cbOff;
        rm.eax = 0x1234;
        rm.ebx = 0x5678;
        rm.flags = 0x0202;
        cbPop = 4;
        real("callback", "0301h", 0x0301, 0, 0);
        wsprintf(probeResult, "ax=%04x bx=%04x cx=%04x", (UINT)rm.eax, (UINT)rm.ebx, (UINT)rm.ecx);
        probe("callback", "0301h result", probeResult);
        wsprintf(probeResult,
                 "calls=%u es:di=%u ax=%04x bx=%04x ss:sp-nought=%u if=%u", cbCalls,
                 cbDI == (UINT)(RMCS FAR *)&cbRegs && cbES == ourDS(), cbAX, cbBX,
                 cbSS == 0 && cbSP == 0, (cbFlags >> 9) & 1);
        probe("callback", "0301h seen", probeResult);

        clear();
        rm.cs = cbSeg;
        rm.ip = cbOff;
        rm.eax = 0x2345;
        rm.ebx = 0x6789;
        rm.flags = 0x0202;
        cbPop = 6;
        real("callback", "0302h", 0x0302, 0, 0);
        wsprintf(probeResult, "ax=%04x bx=%04x cx=%04x", (UINT)rm.eax, (UINT)rm.ebx, (UINT)rm.ecx);
        probe("callback", "0302h result", probeResult);
        wsprintf(probeResult, "calls=%u ax=%04x bx=%04x", cbCalls, cbAX, cbBX);
        probe("callback", "0302h seen", probeResult);

        /* INT 60h in real mode, its vector the callback. */
        call("callback", "0200h 60h", 0x0200, 0x60, 0, 0);
        savedCX = rCX;
        savedDX = rDX;
        call("callback", "0201h 60h", 0x0201, 0x60, cbSeg, cbOff);
        clear();
        rm.eax = 0x3456;
        rm.flags = 0x0202;
        cbPop = 6;
        real("callback", "0300h 60h", 0x0300, 0x60, 0);
        wsprintf(probeResult, "ax=%04x cx=%04x", (UINT)rm.eax, (UINT)rm.ecx);
        probe("callback", "0300h 60h result", probeResult);
        wsprintf(probeResult, "calls=%u ax=%04x", cbCalls, cbAX);
        probe("callback", "0300h 60h seen", probeResult);
        call("callback", "0201h 60h back", 0x0201, 0x60, savedCX, savedDX);

        call("callback", "0304h", 0x0304, 0, cbSeg, cbOff);
        call("callback", "0304h twice", 0x0304, 0, cbSeg, cbOff);
    }
    call("callback", "0304h nought", 0x0304, 0, 0, 0);

    count = 0;
    for (i = 0; i < 40; i++) {
        rAX = 0x0303;
        rDI = (UINT)(RMCS FAR *)&cbRegs;
        _asm {
            push si
            push di
            push es
            push ds
            push ds
            pop es
            mov si, procOff
            mov di, rDI
            mov ax, procSeg
            push ax
            mov ax, rAX
            pop ds
            int 31h
            pop ds
            mov rCX, cx
            mov rDX, dx
            mov rAX, ax
            sbb ax, ax
            mov rCarry, ax
            pop es
            pop di
            pop si
        }
        if (rCarry) {
            break;
        }
        callbackSegs[count] = rCX;
        callbacks[count++] = rDX;
    }
    wsprintf(probeResult, "%u ax=%04x", count, rAX);
    probe("callback", "0303h until refused", probeResult);
    if (count) {
        wsprintf(probeResult, "dx=%04x", callbacks[count - 1]);
        probe("callback", "0303h last", probeResult);
    }
    given = 0;
    for (i = 0; i < count; i++) {
        call("callback", "0304h each", 0x0304, 0, callbackSegs[i], callbacks[i]);
        given += !rCarry;
    }
    wsprintf(probeResult, "%u", given);
    probe("callback", "0304h each freed", probeResult);

    /* --- 0200h and 0201h --- */
    call("vector", "0200h 60h", 0x0200, 0x60, 0, 0);
    savedCX = rCX;
    savedDX = rDX;
    call("vector", "0201h 60h", 0x0201, 0x60, 0x1234, 0x5678);
    call("vector", "0200h 60h again", 0x0200, 0x60, 0, 0);
    wsprintf(probeResult, "%04x:%04x", rCX, rDX);
    probe("vector", "0200h 60h value", probeResult);
    call("vector", "0201h 60h back", 0x0201, 0x60, savedCX, savedDX);
    count = 0;
    for (i = 0; i < 8; i++) {
        UINT cx, dx;

        call("vector", "0200h 50h-57h", 0x0200, 0x50 + i, 0, 0);
        cx = rCX;
        dx = rDX;
        call("vector", "0200h 08h-0Fh", 0x0200, 0x08 + i, 0, 0);
        count += (cx == rCX && dx == rDX);
    }
    wsprintf(name, "%u of 8", count);
    probe("vector", "0200h 50h-57h as 08h-0Fh", name);

    if (dos) {
        GlobalDosFree(sel);
    }

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
