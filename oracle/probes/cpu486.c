/*
 * The 486's and the Pentium's instructions as the oracle's processor runs
 * them at a program's privilege (`kb/topics/the-processor.md`, "Which
 * processor"): BSWAP, XADD and CMPXCHG, their results and the flags after
 * them; INVD and WBINVD; CPUID and RDTSC; and the EFLAGS bits a
 * program toggles to tell a 386 from a 486 (AC, bit 18) and a 486 from one
 * with CPUID (ID, bit 21). Recorded in each mode (`record.mjs --mode
 * enhanced`), under the probe's own handlers (0203h) for exceptions 06h,
 * 0Dh and 0Eh.
 *
 * * `cpl`: the privilege the probe runs at, CS's low two bits.
 * * `eflags`: EFLAGS' bits 16 to 21 as PUSHFD stores them; whether AC and
 *   ID can be set and cleared with POPFD; whether either, set, outlives a
 *   PUSHF and POPF of a word.
 * * Each instruction: EAX, ECX and EDX set first (and the double word at
 *   BX, `mem`), the arithmetic flags all clear or all set; then the
 *   registers, the double word and the arithmetic flags after (OF, SF, ZF,
 *   AF, PF, CF: `08D5h`), or the handler's record (its vector, the error
 *   code and whether CS:IP was the instruction).
 * * `cpuid`: each leaf asked, EAX, EBX, ECX and EDX after.
 * * `rdtsc`: whether it ran, whether the counter moved between two reads
 *   in a row, and how far it moved in a millisecond of `GetTickCount`'s,
 *   over at least 110 of them: whether it is a thousand or more (the rate
 *   is DOSBox's cycles a millisecond, which `cycles=max` leaves to the
 *   host: 10^4 in one recording, 10^5 in another).
 *
 * INVLPG is not here: at a privilege but 0 the recorder's DOSBox, whose
 * dynamic core is `core_dynrec`, stops altogether as it translates it
 * ("DynrecCore: illegal option in invlpg nonpriviledged",
 * `core_dynrec/decoder_opcodes.h`), and its register form likewise
 * (`dyn_grp7_2`).
 */

#define PROBE_FLUSH
#include "probe.h"
#include "dpmiregs.h"
#include "pgreach.h"

#define OUTPUT "C:\\ORACLE\\CPU486.OUT"

#define ARITH 0x08D5UL

static DWORD inEAX, inECX, inEDX, inFlags;
static DWORD outEAX, outEBX, outECX, outEDX, outFlags;
static DWORD cell;
static DWORD efNow, efAfter;

/* Each tested instruction the routine's first, then RETF. */
static void __declspec(naked) __far bswapEAX(void) { _asm { db 66h, 0Fh, 0C8h } _asm retf }
static void __declspec(naked) __far bswapECX(void) { _asm { db 66h, 0Fh, 0C9h } _asm retf }
static void __declspec(naked) __far bswapEDX(void) { _asm { db 66h, 0Fh, 0CAh } _asm retf }
static void __declspec(naked) __far bswapAX(void) { _asm { db 0Fh, 0C8h } _asm retf }
static void __declspec(naked) __far bswapDX(void) { _asm { db 0Fh, 0CAh } _asm retf }

/* XADD r/m, reg: modrm C8h is AL/AX/EAX, CL/CX/ECX the register; 0Fh [BX]. */
static void __declspec(naked) __far xaddB(void) { _asm { db 0Fh, 0C0h, 0C8h } _asm retf }
static void __declspec(naked) __far xaddW(void) { _asm { db 0Fh, 0C1h, 0C8h } _asm retf }
static void __declspec(naked) __far xaddD(void) { _asm { db 66h, 0Fh, 0C1h, 0C8h } _asm retf }
static void __declspec(naked) __far xaddMB(void) { _asm { db 0Fh, 0C0h, 0Fh } _asm retf }
static void __declspec(naked) __far xaddMW(void) { _asm { db 0Fh, 0C1h, 0Fh } _asm retf }
static void __declspec(naked) __far xaddMD(void) { _asm { db 66h, 0Fh, 0C1h, 0Fh } _asm retf }

/* CMPXCHG r/m, reg: modrm D1h is CL/CX/ECX, DL/DX/EDX the register; 17h [BX]. */
static void __declspec(naked) __far cmpxB(void) { _asm { db 0Fh, 0B0h, 0D1h } _asm retf }
static void __declspec(naked) __far cmpxW(void) { _asm { db 0Fh, 0B1h, 0D1h } _asm retf }
static void __declspec(naked) __far cmpxD(void) { _asm { db 66h, 0Fh, 0B1h, 0D1h } _asm retf }
static void __declspec(naked) __far cmpxMB(void) { _asm { db 0Fh, 0B0h, 17h } _asm retf }
static void __declspec(naked) __far cmpxMW(void) { _asm { db 0Fh, 0B1h, 17h } _asm retf }
static void __declspec(naked) __far cmpxMD(void) { _asm { db 66h, 0Fh, 0B1h, 17h } _asm retf }

static void __declspec(naked) __far invd(void) { _asm { db 0Fh, 08h } _asm retf }
static void __declspec(naked) __far wbinvd(void) { _asm { db 0Fh, 09h } _asm retf }
static void __declspec(naked) __far cpuid(void) { _asm { db 0Fh, 0A2h } _asm retf }
static void __declspec(naked) __far rdtsc(void) { _asm { db 0Fh, 31h } _asm retf }

/* EFLAGS as PUSHFD stores it. */
static DWORD readFlags(void)
{
    _asm {
        db 66h
        pushf
        pop word ptr efNow
        pop word ptr efNow+2
    }
    return efNow;
}

/* EFLAGS loaded with POPFD, then read back with PUSHFD. */
static DWORD loadFlags(DWORD value)
{
    efNow = value;
    _asm {
        push word ptr efNow+2
        push word ptr efNow
        db 66h
        popf
        db 66h
        pushf
        pop word ptr efAfter
        pop word ptr efAfter+2
    }
    return efAfter;
}

/* EFLAGS loaded with POPFD, then a word of it pushed and popped with PUSHF
 * and POPF, then read back with PUSHFD. */
static DWORD wordRoundTrip(DWORD value)
{
    efNow = value;
    _asm {
        push word ptr efNow+2
        push word ptr efNow
        db 66h
        popf
        pushf
        popf
        db 66h
        pushf
        pop word ptr efAfter
        pop word ptr efAfter+2
    }
    return efAfter;
}

/* The routine called with the registers and flags set, BX at `cell`; the
 * registers and flags read back after. */
static void runIt(FARPROC how, UINT skip)
{
    excCalls = 0;
    excCode = 0;
    excVector = 0;
    excSkip = skip;
    target = how;
    _asm {
        push bx
        push si
        push di
        mov bx, offset cell
        db 66h
        mov ax, word ptr inEAX
        db 66h
        mov cx, word ptr inECX
        db 66h
        mov dx, word ptr inEDX
        push word ptr inFlags+2
        push word ptr inFlags
        db 66h
        popf
        call dword ptr target
        db 66h
        pushf
        pop word ptr outFlags
        pop word ptr outFlags+2
        db 66h
        mov word ptr outEAX, ax
        db 66h
        mov word ptr outECX, cx
        db 66h
        mov word ptr outEDX, dx
        db 66h
        mov word ptr outEBX, bx
        pop di
        pop si
        pop bx
    }
}

static void say(LPCSTR function, LPCSTR args, FARPROC how)
{
    if (excCalls) {
        reachSay(excCalls, how);
    } else {
        wsprintf(probeResult, "eax=%08lx ecx=%08lx edx=%08lx mem=%08lx flags=%04lx", outEAX,
                 outECX, outEDX, cell, outFlags & ARITH);
    }
    probe(function, args, probeResult);
}

/* An instruction run with the arithmetic flags all clear, then all set. */
static void both(LPCSTR function, LPCSTR name, FARPROC how, UINT skip, DWORD eax, DWORD ecx,
                 DWORD edx, DWORD mem)
{
    DWORD base = readFlags() & ~ARITH;
    UINT set;

    for (set = 0; set < 2; set++) {
        inEAX = eax;
        inECX = ecx;
        inEDX = edx;
        cell = mem;
        inFlags = set ? base | ARITH : base;
        runIt(how, skip);
        wsprintf(probeArgs, "%s / flags %s", name, set ? "set" : "clear");
        say(function, probeArgs, how);
    }
}

static void eflags(void)
{
    DWORD start = readFlags();
    DWORD bit, after, back;
    static const struct {
        LPCSTR name;
        DWORD bit;
    } bits[] = {{"AC", 0x00040000UL}, {"ID", 0x00200000UL}};
    UINT i;

    wsprintf(probeResult, "%02lx", (start >> 16) & 0x3F);
    probe("eflags", "high", probeResult);

    for (i = 0; i < 2; i++) {
        bit = bits[i].bit;
        after = loadFlags(start ^ bit);
        back = loadFlags(after ^ bit);
        wsprintf(probeResult, "turned=%u back=%u", (after ^ start) & bit ? 1 : 0,
                 (back ^ after) & bit ? 1 : 0);
        probe("eflags", bits[i].name, probeResult);

        after = loadFlags(start | bit);
        if (after & bit) {
            after = wordRoundTrip(start | bit);
            wsprintf(probeResult, "kept=%u", after & bit ? 1 : 0);
        } else {
            lstrcpy(probeResult, "not set");
        }
        wsprintf(probeArgs, "%s after pushf/popf", bits[i].name);
        probe("eflags", probeArgs, probeResult);
        loadFlags(start);
    }

    wsprintf(probeResult, "%02lx", (readFlags() >> 16) & 0x3F);
    probe("eflags", "high after", probeResult);
}

static void leaf(DWORD which)
{
    inEAX = which;
    inECX = 0;
    inEDX = 0;
    inFlags = readFlags();
    cell = 0;
    excCalls = 0;
    runIt((FARPROC)cpuid, 2);
    wsprintf(probeArgs, "eax=%08lx", which);
    if (excCalls) {
        reachSay(excCalls, (FARPROC)cpuid);
    } else {
        wsprintf(probeResult, "eax=%08lx ebx=%08lx ecx=%08lx edx=%08lx", outEAX, outEBX, outECX,
                 outEDX);
    }
    probe("cpuid", probeArgs, probeResult);
}

static DWORD tscLow, tscHigh;

static UINT readTsc(void)
{
    inEAX = 0;
    inECX = 0;
    inEDX = 0;
    inFlags = readFlags();
    runIt((FARPROC)rdtsc, 2);
    tscLow = outEAX;
    tscHigh = outEDX;
    return excCalls;
}

static void timestamp(void)
{
    DWORD firstLow, firstHigh, start, ticks, span, perMs;

    if (readTsc()) {
        reachSay(excCalls, (FARPROC)rdtsc);
        probe("rdtsc", "run", probeResult);
        return;
    }
    probe("rdtsc", "run", "no fault");
    firstLow = tscLow;
    firstHigh = tscHigh;
    readTsc();
    wsprintf(probeResult, "%u",
             (tscHigh > firstHigh || (tscHigh == firstHigh && tscLow > firstLow)) ? 1 : 0);
    probe("rdtsc", "moved between two", probeResult);

    start = GetTickCount();
    readTsc();
    firstLow = tscLow;
    firstHigh = tscHigh;
    do {
        ticks = GetTickCount() - start;
    } while (ticks < 110);
    readTsc();
    span = tscLow - firstLow;
    if (tscHigh != firstHigh && tscLow >= firstLow) {
        span = 0xFFFFFFFFUL;
    }
    perMs = span / ticks;
    wsprintf(probeResult, "at least 1000=%u", perMs >= 1000 ? 1 : 0);
    probe("rdtsc", "per millisecond", probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    probeOpen(OUTPUT);

    wsprintf(probeResult, "%u", ourCS() & 3);
    probe("cpl", "CS", probeResult);

    if (!reachOpen(REACH_06 | REACH_0D | REACH_0E)) {
        probe("cpl", "0000h", "refused");
        probeFinish();
        return 0;
    }

    eflags();

    both("bswap", "bswap eax", (FARPROC)bswapEAX, 3, 0x12345678UL, 0, 0, 0);
    both("bswap", "bswap ecx", (FARPROC)bswapECX, 3, 0, 0x89ABCDEFUL, 0, 0);
    both("bswap", "bswap edx", (FARPROC)bswapEDX, 3, 0, 0, 0x00FF8001UL, 0);
    both("bswap", "bswap ax", (FARPROC)bswapAX, 2, 0x12345678UL, 0, 0, 0);
    both("bswap", "bswap dx", (FARPROC)bswapDX, 2, 0, 0, 0x89ABCDEFUL, 0);

    both("xadd", "xadd al, cl", (FARPROC)xaddB, 3, 0x12345680UL, 0xABCDEF80UL, 0, 0);
    both("xadd", "xadd al, cl small", (FARPROC)xaddB, 3, 0x12345611UL, 0xABCDEF22UL, 0, 0);
    both("xadd", "xadd ax, cx", (FARPROC)xaddW, 3, 0x12348000UL, 0xABCD8000UL, 0, 0);
    both("xadd", "xadd eax, ecx", (FARPROC)xaddD, 4, 0x7FFFFFFFUL, 0x00000001UL, 0, 0);
    both("xadd", "xadd [bx], cl", (FARPROC)xaddMB, 3, 0, 0xABCDEF0FUL, 0, 0x55AA55F1UL);
    both("xadd", "xadd [bx], cx", (FARPROC)xaddMW, 3, 0, 0xABCD0001UL, 0, 0x55AAFFFFUL);
    both("xadd", "xadd [bx], ecx", (FARPROC)xaddMD, 4, 0, 0x80000000UL, 0, 0x80000000UL);

    both("cmpxchg", "cmpxchg cl, dl equal", (FARPROC)cmpxB, 3, 0x11223344UL, 0x55667744UL,
         0x99AABBCCUL, 0);
    both("cmpxchg", "cmpxchg cl, dl unequal", (FARPROC)cmpxB, 3, 0x11223310UL, 0x55667720UL,
         0x99AABBCCUL, 0);
    both("cmpxchg", "cmpxchg cx, dx equal", (FARPROC)cmpxW, 3, 0x11223344UL, 0x55663344UL,
         0x99AABBCCUL, 0);
    both("cmpxchg", "cmpxchg cx, dx unequal", (FARPROC)cmpxW, 3, 0x11221000UL, 0x55662000UL,
         0x99AABBCCUL, 0);
    both("cmpxchg", "cmpxchg ecx, edx equal", (FARPROC)cmpxD, 4, 0x11223344UL, 0x11223344UL,
         0x99AABBCCUL, 0);
    both("cmpxchg", "cmpxchg ecx, edx unequal", (FARPROC)cmpxD, 4, 0x10000000UL, 0x20000000UL,
         0x99AABBCCUL, 0);
    both("cmpxchg", "cmpxchg [bx], dl equal", (FARPROC)cmpxMB, 3, 0x11223344UL, 0, 0x99AABBCCUL,
         0x55667744UL);
    both("cmpxchg", "cmpxchg [bx], dl unequal", (FARPROC)cmpxMB, 3, 0x11223310UL, 0,
         0x99AABBCCUL, 0x55667720UL);
    both("cmpxchg", "cmpxchg [bx], dx equal", (FARPROC)cmpxMW, 3, 0x11223344UL, 0, 0x99AABBCCUL,
         0x55663344UL);
    both("cmpxchg", "cmpxchg [bx], dx unequal", (FARPROC)cmpxMW, 3, 0x11221000UL, 0,
         0x99AABBCCUL, 0x55662000UL);
    both("cmpxchg", "cmpxchg [bx], edx equal", (FARPROC)cmpxMD, 4, 0x11223344UL, 0,
         0x99AABBCCUL, 0x11223344UL);
    both("cmpxchg", "cmpxchg [bx], edx unequal", (FARPROC)cmpxMD, 4, 0x10000000UL, 0,
         0x99AABBCCUL, 0x20000000UL);

    leaf(0);
    leaf(1);
    leaf(2);
    leaf(0x80000000UL);

    timestamp();

    both("cache", "invd", (FARPROC)invd, 2, 0x11111111UL, 0x22222222UL, 0x33333333UL, 0);
    both("cache", "wbinvd", (FARPROC)wbinvd, 2, 0x11111111UL, 0x22222222UL, 0x33333333UL, 0);

    reachClose();
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
