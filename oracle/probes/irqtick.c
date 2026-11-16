/*
 * The timer's interrupt, 08h, reaching a program's own handler, recorded in
 * each mode (`record.mjs --mode enhanced`; `kb/topics/hardware-interrupts.md`).
 * `win3_act123_a`'s `DOVOICE.DLL` sets INT 08h through INT 21h 25h and
 * counts ten ticks to time its voice. Each handler the probe puts in is
 * taken out again, the one before it set back.
 *
 * * `vector`: INT 21h 3508h before: whether its selector is code, its
 *   offset, whether it is the selector of SYSTEM's `InquireSystem`
 *   (ordinal 1), and the module that owns it (TOOLHELP's
 *   `GlobalEntryHandle`, `ModuleFindHandle`); 0204h of 08h, whether the same; 0200h of 08h and 1Ch,
 *   the real-mode vectors, whether nought.
 * * `hook`: 2508h to the probe's handler, and 3508h after it, whether the
 *   probe's.
 * * `rate`: the handler counting and going on to the one before
 *   (`pushf`, a far call), as `DOVOICE` does: from a tick, 20 ticks, and
 *   the milliseconds `GetTickCount` moved over them, rounded to the tick's
 *   (`about 1099` within 1090-1110). The same through 0205h.
 * * `entry`: what the handler found at the first of them: SS the task's,
 *   and if so how far below the waiting loop's SP it was entered; the
 *   frame's CS the probe's code and its flags' interrupt flag; the
 *   interrupt flag inside the handler; DS and ES the probe's; the frame's
 *   CS's privilege.
 * * `nochain`: the handler counting and going on to nothing, without an
 *   end of interrupt: over ten ticks' worth of a loop timed by the
 *   ticks before it, how many ticks it saw (`one` or `several`) and
 *   whether `GetTickCount` moved; then the handler before set back, an end
 *   of interrupt written to 20h where one tick alone came, and whether
 *   ticks and `GetTickCount` go on again.
 * * `int1c`: 251Ch to a counting handler with no 08h of the probe's: the
 *   ticks it saw while `GetTickCount` moved 1,099 ms (`about 20` within
 *   19-21), and whether its SS was the task's.
 * * `realmode`: 0201h of 08h to a handler of the probe's in DOS's memory
 *   (`GlobalDOSAlloc`) that counts, writes an end of interrupt and returns,
 *   going on to nothing (one that jumps on to the vector before hangs
 *   standard mode): over ten ticks' worth of the loop, how many ticks it
 *   saw and whether `GetTickCount` moved. The vector before set back.
 * * `port61`: the system control port, 61h, read three times, as
 *   `DOVOICE` reads it to drive the speaker.
 */

#define PROBE_FLUSH
#include "probe.h"
#include "dpmiregs.h"
#include <toolhelp.h>

#define OUTPUT "C:\\ORACLE\\IRQTICK.OUT"

DWORD FAR PASCAL GlobalDOSAlloc(DWORD bytes);
UINT FAR PASCAL GlobalDOSFree(UINT selector);

static volatile WORD ticks;
static WORD chainOn = 1;
static DWORD old08;
static WORD firstSS, firstSP, firstDS, firstES, frameIP, frameCS, frameFlags, entryFlags;
static WORD loopSP;
static volatile WORD ticks1c;
static WORD ss1c;
static DWORD old1c;

/* INT 08h's handler: DS the probe's data, a tick counted, the first's
 * registers and frame noted, and the handler before called where
 * `chainOn`, as an interrupt is. */
static void __declspec(naked) __far tick08(void)
{
    _asm {
        push ds
        push ax
        push bx
        mov ax, seg ticks
        mov ds, ax
        inc word ptr ticks
        cmp word ptr ticks, 1
        jne counted
        mov ax, sp
        add ax, 6
        mov firstSP, ax
        mov ax, ss
        mov firstSS, ax
        mov bx, sp
        mov ax, ss:[bx+4]
        mov firstDS, ax
        mov ax, es
        mov firstES, ax
        mov ax, ss:[bx+6]
        mov frameIP, ax
        mov ax, ss:[bx+8]
        mov frameCS, ax
        mov ax, ss:[bx+0Ah]
        mov frameFlags, ax
        pushf
        pop ax
        mov entryFlags, ax
    counted:
        cmp word ptr chainOn, 0
        je done
        pushf
        call dword ptr old08
    done:
        pop bx
        pop ax
        pop ds
        iret
    }
}

/* INT 1Ch's: counted, its SS noted, and on to the one before. */
static void __declspec(naked) __far tick1c(void)
{
    _asm {
        push ds
        push ax
        mov ax, seg ticks1c
        mov ds, ax
        inc word ptr ticks1c
        mov ax, ss
        mov ss1c, ax
        pushf
        call dword ptr old1c
        pop ax
        pop ds
        iret
    }
}

static WORD ourSS(void)
{
    WORD value;

    _asm {
        mov ax, ss
        mov value, ax
    }
    return value;
}

static DWORD getVector(BYTE vector)
{
    WORD sel = 0, off = 0;

    _asm {
        push es
        mov ah, 35h
        mov al, vector
        int 21h
        mov off, bx
        mov bx, es
        mov sel, bx
        pop es
    }
    return ((DWORD)sel << 16) | off;
}

static void setVector(BYTE vector, DWORD handler)
{
    WORD sel = HIWORD(handler), off = LOWORD(handler);

    _asm {
        push ds
        mov dx, off
        mov ax, sel
        mov ds, ax
        mov ah, 25h
        mov al, vector
        int 21h
        pop ds
    }
}

/* Waits for the tick count to reach `target`, no longer than `ms` by
 * GetTickCount nor `spins` turns; whether it did. */
static BOOL waitTicks(WORD target, DWORD ms)
{
    DWORD start = GetTickCount();
    DWORD spins = 0;

    _asm mov loopSP, sp
    while (ticks < target) {
        if (GetTickCount() - start > ms || ++spins > 40000000L) {
            return FALSE;
        }
    }
    return TRUE;
}

/* Waits in a loop of no calls for the tick count to reach `target`, SP
 * noted first; whether it did within 40,000,000 turns. */
static BOOL spinTicks(WORD target)
{
    volatile DWORD n = 0;

    _asm mov loopSP, sp
    while (ticks < target) {
        if (++n > 40000000L) {
            return FALSE;
        }
    }
    return TRUE;
}

/* The module that owns a selector's block, by TOOLHELP. */
static void owner(UINT selector)
{
    GLOBALENTRY global;
    MODULEENTRY module;

    global.dwSize = sizeof(global);
    module.dwSize = sizeof(module);
    if (!GlobalEntryHandle(&global, (HGLOBAL)selector)) {
        probe("vector", "3508h owner", "no entry");
    } else if (!ModuleFindHandle(&module, (HMODULE)global.hOwner)) {
        probe("vector", "3508h owner", "no module");
    } else {
        probe("vector", "3508h owner", module.szModule);
    }
}

static void about(LPSTR out, DWORD ms)
{
    if (ms >= 1090 && ms <= 1110) {
        lstrcpy(out, "about 1099");
    } else {
        wsprintf(out, "%lu", ms);
    }
}

/* 20 ticks from a tick, and GetTickCount over them. */
static void rate(LPCSTR group)
{
    DWORD t0, t1;
    char ms[24];

    ticks = 0;
    if (!waitTicks(1, 3000)) {
        probe(group, "20 ticks", "no tick");
        return;
    }
    ticks = 0;
    t0 = GetTickCount();
    if (!waitTicks(20, 5000)) {
        wsprintf(probeResult, "%u ticks", ticks);
        probe(group, "20 ticks", probeResult);
        return;
    }
    t1 = GetTickCount();
    about(ms, t1 - t0);
    wsprintf(probeResult, "ms=%s", (LPSTR)ms);
    probe(group, "20 ticks", probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    DWORD before, pm, t0, t1, dos;
    FARPROC inquire;
    UINT rights = 0, valid = 0, selector;
    DWORD perTick;
    WORD seen, oldRmSeg, oldRmOff, rmSeg, rmSel;
    BYTE __far *code;
    probeOpen(OUTPUT);

    /* --- the vectors before --- */
    before = getVector(0x08);
    selector = HIWORD(before);
    _asm {
        mov bx, selector
        db 0fh, 02h, 0c3h /* lar ax, bx */
        jnz bad
        mov rights, ax
        mov valid, 1
    bad:
    }
    inquire = GetProcAddress(GetModuleHandle("SYSTEM"), MAKEINTRESOURCE(1));
    wsprintf(probeResult, "%s offset=%04x system=%u",
             (LPSTR)(!valid ? "no selector" : (rights & 0x0800) ? "code" : "data"), LOWORD(before),
             HIWORD(before) == HIWORD((DWORD)inquire));
    probe("vector", "3508h", probeResult);
    owner(selector);

    set(0x0204, 0x08, 0, 0, 0, 0);
    dpmi();
    pm = ((DWORD)rCX << 16) | rDX;
    wsprintf(probeResult, "cf=%u same=%u", rCarry ? 1 : 0, pm == before);
    probe("vector", "0204h 08h", probeResult);

    set(0x0200, 0x08, 0, 0, 0, 0);
    dpmi();
    wsprintf(probeResult, "cf=%u nought=%u", rCarry ? 1 : 0, rCX == 0 && rDX == 0);
    probe("vector", "0200h 08h", probeResult);
    oldRmSeg = rCX;
    oldRmOff = rDX;

    set(0x0200, 0x1c, 0, 0, 0, 0);
    dpmi();
    wsprintf(probeResult, "cf=%u nought=%u", rCarry ? 1 : 0, rCX == 0 && rDX == 0);
    probe("vector", "0200h 1Ch", probeResult);

    /* --- hooked through INT 21h 25h, going on to the one before --- */
    old08 = before;
    chainOn = 1;
    ticks = 0;
    setVector(0x08, (DWORD)(FARPROC)tick08);
    wsprintf(probeResult, "ours=%u", getVector(0x08) == (DWORD)(FARPROC)tick08);
    probe("hook", "2508h then 3508h", probeResult);

    rate("rate");

    /* The first of a run of ticks, its registers noted. */
    ticks = 0;
    if (spinTicks(1)) {
        if (firstSS == ourSS()) {
            wsprintf(probeResult, "task=1 below=%u", loopSP - firstSP);
        } else {
            lstrcpy(probeResult, "task=0");
        }
        probe("entry", "stack", probeResult);
        wsprintf(probeResult, "cs=%u if=%u rpl=%u", frameCS == ourCS(), (frameFlags >> 9) & 1,
                 frameCS & 3);
        probe("entry", "frame", probeResult);
        wsprintf(probeResult, "if=%u tf=%u", (entryFlags >> 9) & 1, (entryFlags >> 8) & 1);
        probe("entry", "flags", probeResult);
        wsprintf(probeResult, "ds=%u es=%u", firstDS == ourDS(), firstES == ourDS());
        probe("entry", "segments", probeResult);
    } else {
        probe("entry", "stack", "no tick");
    }

    /* A loop's turns over two ticks, timed by the ticks. */
    ticks = 0;
    waitTicks(1, 3000);
    ticks = 0;
    {
        volatile DWORD n = 0;

        while (ticks < 2 && n < 40000000L) {
            n++;
        }
        perTick = n;
    }

    /* --- going on to nothing, without an end of interrupt --- */
    chainOn = 0;
    ticks = 0;
    t0 = GetTickCount();
    {
        volatile DWORD n = 0;

        while (n < perTick * 5) {
            n++;
        }
    }
    t1 = GetTickCount();
    seen = ticks;
    wsprintf(probeResult, "ticks=%s tickcount-moved=%u",
             (LPSTR)(seen == 0 ? "none" : seen == 1 ? "one" : "several"), t1 != t0);
    probe("nochain", "window", probeResult);
    setVector(0x08, before);
    if (seen < 2) {
        _asm {
            mov al, 20h
            out 20h, al
        }
    }
    chainOn = 1;
    setVector(0x08, (DWORD)(FARPROC)tick08);
    rate("nochain");
    setVector(0x08, before);
    wsprintf(probeResult, "ours=%u", getVector(0x08) == (DWORD)(FARPROC)tick08);
    probe("hook", "2508h back then 3508h", probeResult);

    /* --- through DPMI 0205h --- */
    set(0x0205, 0x08, HIWORD((DWORD)(FARPROC)tick08), LOWORD((DWORD)(FARPROC)tick08), 0, 0);
    dpmi();
    wsprintf(probeResult, "cf=%u", rCarry ? 1 : 0);
    probe("hook", "0205h 08h", probeResult);
    rate("rate0205");
    set(0x0205, 0x08, HIWORD(pm), LOWORD(pm), 0, 0);
    dpmi();

    /* --- INT 1Ch alone --- */
    old1c = getVector(0x1c);
    ticks1c = 0;
    ss1c = 0;
    setVector(0x1c, (DWORD)(FARPROC)tick1c);
    t0 = GetTickCount();
    while (GetTickCount() - t0 < 1099) {
    }
    seen = ticks1c;
    setVector(0x1c, old1c);
    wsprintf(probeResult, "ticks=%s task=%u",
             (LPSTR)(seen >= 19 && seen <= 21 ? "about 20" : seen == 0 ? "none" : "other"),
             ss1c == ourSS());
    probe("int1c", "1099 ms", probeResult);

    /* --- a real-mode vector through 0201h --- */
    dos = GlobalDOSAlloc(16);
    if (!dos) {
        probe("realmode", "GlobalDOSAlloc", "nought");
    } else {
        rmSeg = HIWORD(dos);
        rmSel = LOWORD(dos);
        code = (BYTE __far *)MAKELP(rmSel, 0);
        code[0] = 0x2e; /* inc word ptr cs:[000Eh] */
        code[1] = 0xff;
        code[2] = 0x06;
        code[3] = 0x0e;
        code[4] = 0x00;
        code[5] = 0x50; /* push ax */
        code[6] = 0xb0; /* mov al, 20h */
        code[7] = 0x20;
        code[8] = 0xe6; /* out 20h, al */
        code[9] = 0x20;
        code[10] = 0x58; /* pop ax */
        code[11] = 0xcf; /* iret */
        code[0x0e] = 0;
        code[0x0f] = 0;
        set(0x0201, 0x08, rmSeg, 0, 0, 0);
        dpmi();
        wsprintf(probeResult, "cf=%u", rCarry ? 1 : 0);
        probe("realmode", "0201h 08h", probeResult);
        t0 = GetTickCount();
        {
            volatile DWORD n = 0;

            while (n < perTick * 5) {
                n++;
            }
        }
        t1 = GetTickCount();
        set(0x0201, 0x08, oldRmSeg, oldRmOff, 0, 0);
        dpmi();
        seen = *(WORD __far *)(code + 0x0e);
        wsprintf(probeResult, "ticks=%s tickcount-moved=%u",
                 (LPSTR)(seen == 0 ? "none" : seen == 1 ? "one" : "several"), t1 != t0);
        probe("realmode", "window", probeResult);
        GlobalDOSFree(rmSel);
    }

    {
        BYTE p1, p2, p3;

        _asm {
            in al, 61h
            mov p1, al
            in al, 61h
            mov p2, al
            in al, 61h
            mov p3, al
        }
        wsprintf(probeResult, "%02x %02x %02x", p1, p2, p3);
        probe("port61", "three reads", probeResult);
    }

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
