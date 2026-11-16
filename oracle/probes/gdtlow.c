/*
 * The global table's low selectors, as a program loads them as real-mode
 * segments: Lucky's Investments (`LI.EXE` seg11 `167d`-`16cf`) reads the
 * BIOS's equipment word through selector 40h and, with one floppy drive or
 * none, DOS's byte at 0050h:0004h through selector 50h. Recorded in each
 * mode (`record.mjs --mode enhanced`), under the probe's own handler
 * (0203h) for exception 0Dh, so a load that faults is seen.
 *
 * * `gdt`: the global table's limit as SGDT stores it, and whether the
 *   selectors below are inside it.
 * * `sel`: each selector 08h-78h as a program writes it (RPL 0): LAR's
 *   access rights and LSL's limit, or that they clear ZF; whether loading
 *   it into ES faults; where it does not, its base by DPMI 0006h, and the
 *   bytes at offsets 4 and 10h-11h through it.
 * * `rpl3`: the same selectors with RPL 3, whether loading each faults.
 */

#include "probe.h"
#include "dpmiregs.h"
#include "pgreach.h"

#define OUTPUT "C:\\ORACLE\\GDTLOW.OUT"

static WORD loaded;
static BYTE table[6];

/* ES loaded with AX, a handler's step over `mov es, ax` (2 bytes). */
static void __declspec(naked) __far loadES(void)
{
    _asm {
        push es
        mov es, ax
        pop es
        retf
    }
}

static UINT tryLoad(WORD sel)
{
    excCalls = 0;
    excVector = 0;
    excCode = 0;
    excSkip = 2;
    target = (FARPROC)loadES;
    _asm {
        mov ax, sel
        call dword ptr target
    }

    return excCalls;
}

static BYTE readAt(WORD sel, WORD at)
{
    BYTE value;

    _asm {
        push es
        mov ax, sel
        mov es, ax
        mov bx, at
        mov al, es:[bx]
        pop es
        mov value, al
    }

    return value;
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WORD limit, sel, rights, zeroR, zeroL;
    DWORD segLimit;

    probeOpen(OUTPUT);

    if (!reachOpen(REACH_0D)) {
        probe("open", "0000h", "refused");
        probeFinish();
        return 0;
    }

    _asm {
        db 0Fh, 01h, 06h /* sgdt [table] */
        dw offset table
    }
    limit = (WORD)(table[0] | (table[1] << 8));
    wsprintf(probeResult, "covers 78h=%u", limit >= 0x7F);
    probe("gdt", "limit", probeResult);

    for (sel = 0x08; sel <= 0x78; sel += 8) {
        WORD lo, hi;

        _asm {
            mov bx, sel
            xor ax, ax
            db 0Fh, 02h, 0C3h /* lar ax, bx */
            pushf
            pop cx
            mov rights, ax
            mov zeroR, cx
            xor ax, ax
            xor dx, dx
            db 66h, 0Fh, 03h, 0C3h /* lsl eax, bx */
            pushf
            pop cx
            mov zeroL, cx
            mov lo, ax
            db 66h, 0C1h, 0E8h, 10h /* shr eax, 16 */
            mov hi, ax
        }
        segLimit = ((DWORD)hi << 16) | lo;
        wsprintf(probeArgs, "%04x", sel);

        if (zeroR & 0x40) {
            wsprintf(probeResult, "lar=%04x", rights);
        } else {
            lstrcpy(probeResult, "lar none");
        }
        if (zeroL & 0x40) {
            wsprintf(probeResult + lstrlen(probeResult), " lsl=%08lx", segLimit);
        } else {
            lstrcat(probeResult, " lsl none");
        }

        if (tryLoad(sel)) {
            wsprintf(probeResult + lstrlen(probeResult), " load fault %02x code=%04x", excVector,
                     excCode);
        } else {
            set(0x0006, sel, 0, 0, 0, 0);
            dpmi();
            if (rCarry) {
                wsprintf(probeResult + lstrlen(probeResult), " loads, 0006h refused %04x", rAX);
            } else {
                wsprintf(probeResult + lstrlen(probeResult), " loads, base=%04x%04x", rCX, rDX);
            }
            if (!(zeroL & 0x40) || segLimit >= 0x11) {
                excCalls = 0;
                excSkip = 3;
                wsprintf(probeResult + lstrlen(probeResult), " [4]=%02x [10]=%02x %02x",
                         readAt(sel, 4), readAt(sel, 0x10), readAt(sel, 0x11));
                if (excCalls) {
                    lstrcat(probeResult, " (a read faulted)");
                }
            }
        }
        probe("sel", probeArgs, probeResult);
    }

    for (sel = 0x0B; sel <= 0x7B; sel += 8) {
        wsprintf(probeArgs, "%04x", sel);
        if (tryLoad(sel)) {
            wsprintf(probeResult, "fault %02x code=%04x", excVector, excCode);
        } else {
            lstrcpy(probeResult, "loads");
        }
        probe("rpl3", probeArgs, probeResult);
    }

    reachClose();
    probeFinish();
    (void)loaded;
    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
