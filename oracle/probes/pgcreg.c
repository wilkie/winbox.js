/*
 * The control registers read at a program's privilege: `MOV EAX,CR0`,
 * `CR2` and `CR3`, and `SMSW` (`kb/guides/paging.md`, "The probes that
 * would measure the rest"). The 80386 raises a general protection fault
 * for `MOV` from a control register at any privilege but 0, and lets
 * `SMSW` run at any. Recorded in each mode (`record.mjs --mode enhanced`),
 * under the probe's own handlers (0203h) for exceptions 06h, 0Dh and 0Eh.
 *
 * * `cpl`: the privilege the probe runs at, CS's low two bits.
 * * `read`: each instruction, EAX (or AX) set to 5A5A5A5Ah first: the
 *   handler's record (its vector, the error code and whether CS:IP was the
 *   instruction), or, where none was called, the value read. A
 *   control register's value is given where the instruction ran.
 */

#define PROBE_FLUSH
#include "probe.h"
#include "dpmiregs.h"
#include "pgreach.h"

#define OUTPUT "C:\\ORACLE\\PGCREG.OUT"

static WORD lowWord, highWord;

/* Each its instruction first, 3 bytes, after EAX is set; then EAX kept. */
static void __declspec(naked) __far readCR0(void)
{
    _asm {
        db 0Fh, 20h, 0C0h /* mov eax, cr0 */
        retf
    }
}

static void __declspec(naked) __far readCR2(void)
{
    _asm {
        db 0Fh, 20h, 0D0h /* mov eax, cr2 */
        retf
    }
}

static void __declspec(naked) __far readCR3(void)
{
    _asm {
        db 0Fh, 20h, 0D8h /* mov eax, cr3 */
        retf
    }
}

static void __declspec(naked) __far readMSW(void)
{
    _asm {
        db 0Fh, 01h, 0E0h /* smsw ax */
        retf
    }
}

static void run(LPCSTR name, FARPROC how)
{
    excCalls = 0;
    excCode = 0;
    excVector = 0;
    target = how;
    _asm {
        db 66h, 0B8h, 5Ah, 5Ah, 5Ah, 5Ah /* mov eax, 5A5A5A5Ah */
        call dword ptr target
        mov lowWord, ax
        db 66h, 0C1h, 0E8h, 10h /* shr eax, 16 */
        mov highWord, ax
    }

    if (excCalls) {
        reachSay(excCalls, how);
    } else {
        wsprintf(probeResult, "eax=%04x%04x", highWord, lowWord);
    }
    probe("read", name, probeResult);
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

    run("mov eax, cr0", (FARPROC)readCR0);
    run("mov eax, cr2", (FARPROC)readCR2);
    run("mov eax, cr3", (FARPROC)readCR3);
    run("smsw ax", (FARPROC)readMSW);

    reachClose();
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
