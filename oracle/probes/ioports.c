/*
 * A program's own IN and OUT, at its own privilege, as the catalog's
 * programs make them (`kb/topics/io-ports.md`): Windsock and Windows Speed
 * read the CMOS's 64 registers one by one through 70h and 71h; WinWayout
 * waits for the VGA's vertical retrace at 3DAh; SmartSurf reads the modem
 * status register at the COM port it was given, port 0 where none was.
 * Recorded in each mode (`record.mjs --mode enhanced`), under the probe's
 * own handlers (0203h) for exceptions 06h, 0Dh and 0Eh, so an IN or OUT
 * that faults is seen and stepped over. Nothing is written but the CMOS's
 * register number (70h, NMI left enabled, as the programs write it) and a
 * byte to a port no device decodes (343Ah).
 *
 * * `cpl`: the privilege the probe runs at, CS's low two bits.
 * * `flags`: IOPL (FLAGS bits 12-13) and IF as PUSHF stores them; again
 *   after a POPF of 0202h, IOPL nought in the word; and after DPMI's
 *   0300h simulating INT 12h with the structure's flags nought.
 * * `in`: each port read, and the byte (AL 5Ah before it), or the
 *   handler's record. Ports 0000h and 0001h, DMA channel 0's address and
 *   count, each twice (the controller's flip-flop takes low byte then
 *   high); 0201h, the game port, which no joystick answers.
 * * `cmos`: each register 00h-3Fh chosen at 70h and read at 71h. The
 *   clock's (00h, 02h, 04h, 06h-09h, 32h) are the host's time: only
 *   whether each is two BCD digits is kept. Status A's update bit (7) and
 *   status C's two timer bits (6 and 4) follow the time as well, and are
 *   masked off.
 * * `retrace`: 3DAh read 200,000 times: whether vertical retrace (bit 3)
 *   was seen set and seen clear, the display-enable bit (0) likewise, and
 *   the other bits ORed together over every read.
 * * `out`: a byte written to 343Ah, and the handler's record.
 * * `counter2`: the 8253's counter 2 as Windsock's benchmark uses it, mode
 *   4 from 0000h, gated on through port 61h's bit 0, read twice a while
 *   apart: whether the first read is not nought and the second below the
 *   first; then its status by the read-back command (E8h).
 */

#include "probe.h"
#include "dpmiregs.h"
#include "pgreach.h"

#define OUTPUT "C:\\ORACLE\\IOPORTS.OUT"

static WORD ioPort;
static BYTE ioValue;

/* IN AL,DX; and OUT DX,AL: one byte each, which the handlers step over. */
static void __declspec(naked) __far inDX(void)
{
    _asm in al, dx
    _asm retf
}

static void __declspec(naked) __far outDX(void)
{
    _asm out dx, al
    _asm retf
}

/* The instruction run with DX the port and AL `ioValue`; AL kept after. */
static UINT runPort(FARPROC how)
{
    WORD port = ioPort;
    BYTE value = ioValue;

    excCalls = 0;
    excCode = 0;
    excVector = 0;
    excSkip = 1;
    target = how;
    _asm {
        mov dx, port
        mov al, value
        call dword ptr target
        mov value, al
    }
    ioValue = value;

    return excCalls;
}

static void sayPort(UINT calls, FARPROC how, int byte)
{
    if (calls) {
        reachSay(calls, how);
    } else if (byte) {
        wsprintf(probeResult, "%02x", ioValue);
    } else {
        lstrcpy(probeResult, "no fault");
    }
}

static void readPort(WORD port, LPCSTR note)
{
    UINT calls;

    ioPort = port;
    ioValue = 0x5A;
    calls = runPort((FARPROC)inDX);
    sayPort(calls, (FARPROC)inDX, 1);
    wsprintf(probeArgs, "%04x %s", port, note);
    probe("in", probeArgs, probeResult);
}

static BYTE cmosRead(BYTE index)
{
    BYTE value;

    _asm {
        mov al, index
        out 70h, al
        in al, 71h
        mov value, al
    }

    return value;
}

static int isBcd(BYTE value)
{
    return (value & 0x0F) <= 9 && (value >> 4) <= 9;
}

static void cmos(void)
{
    UINT index;

    for (index = 0; index < 0x40; index++) {
        BYTE value;

        excCalls = 0;
        excSkip = 2;
        _asm cli
        value = cmosRead((BYTE)index);
        _asm sti
        if (excCalls) {
            wsprintf(probeArgs, "%02x", index);
            wsprintf(probeResult, "fault calls=%u vector=%02x code=%04x", excCalls, excVector,
                     excCode);
            probe("cmos", probeArgs, probeResult);
            continue;
        }

        wsprintf(probeArgs, "%02x", index);
        switch (index) {
        case 0x00:
        case 0x02:
        case 0x04:
        case 0x06:
        case 0x07:
        case 0x08:
        case 0x09:
        case 0x32:
            wsprintf(probeResult, "bcd=%u", isBcd(value));
            break;
        case 0x0A:
            wsprintf(probeResult, "%02x (bit 7 masked)", value & 0x7F);
            break;
        case 0x0C:
            wsprintf(probeResult, "%02x (bits 6, 4 masked)", value & ~0x50);
            break;
        default:
            wsprintf(probeResult, "%02x", value);
        }
        probe("cmos", probeArgs, probeResult);
    }
}

/* The real mode call structure, 32h bytes. */
typedef struct {
    DWORD edi, esi, ebp, reserved, ebx, edx, ecx, eax;
    WORD flags, es, ds, fs, gs, ip, cs, sp, ss;
} RMCS;

static RMCS rm;

static WORD flagsWord(void)
{
    WORD flags;

    _asm {
        pushf
        pop ax
        mov flags, ax
    }

    return flags;
}

static void sayFlags(LPCSTR args, WORD flags)
{
    wsprintf(probeResult, "iopl=%u if=%u", (flags >> 12) & 3, (flags >> 9) & 1);
    probe("flags", args, probeResult);
}

/* FLAGS after POPF of 0202h, IOPL nought in the word popped. */
static WORD afterPopf(void)
{
    WORD flags;

    _asm {
        pushf
        mov ax, 0202h
        push ax
        popf
        pushf
        pop ax
        mov flags, ax
        popf
    }

    return flags;
}

/* FLAGS after INT 31h 0300h, INT 12h in real mode, its structure's flags
 * nought. */
static WORD afterRealCall(void)
{
    RMCS far *at = &rm;
    unsigned where = (unsigned)(unsigned long)at;
    unsigned i;

    for (i = 0; i < sizeof rm; i++) {
        ((unsigned char *)&rm)[i] = 0;
    }

    _asm {
        push di
        push es
        mov ax, ds
        mov es, ax
        mov di, where
        mov ax, 0300h
        mov bx, 0012h
        xor cx, cx
        int 31h
        pop es
        pop di
    }

    return flagsWord();
}

/* Counter 2 of the 8253 as Windsock times its benchmark on it: mode 4,
 * both bytes, from 0000h, gated on through port 61h (the speaker's data
 * bit off), read twice a while apart; then its status by the read-back
 * command. Port 61h put back after. */
static void counter2(void)
{
    BYTE before, low1, high1, low2, high2, status;
    WORD first, second;

    excCalls = 0;
    _asm {
        cli
        in al, 61h
        mov before, al
        mov al, 0B8h
        out 43h, al
        mov al, before
        and al, 0FCh
        or al, 1
        out 61h, al
        xor al, al
        out 42h, al
        out 42h, al
        mov cx, 200
    spin1:
        loop spin1
        in al, 42h
        mov low1, al
        in al, 42h
        mov high1, al
        mov cx, 200
    spin2:
        loop spin2
        in al, 42h
        mov low2, al
        in al, 42h
        mov high2, al
        mov al, 0E8h
        out 43h, al
        in al, 42h
        mov status, al
        mov al, before
        out 61h, al
        sti
    }

    if (excCalls) {
        wsprintf(probeResult, "fault calls=%u vector=%02x code=%04x", excCalls, excVector,
                 excCode);
        probe("counter2", "mode 4", probeResult);
        return;
    }

    first = (WORD)(low1 | (high1 << 8));
    second = (WORD)(low2 | (high2 << 8));
    wsprintf(probeResult, "started=%u moved=%u", first != 0, second < first);
    probe("counter2", "mode 4 from 0000h, two reads", probeResult);
    wsprintf(probeResult, "%02x", status);
    probe("counter2", "status", probeResult);
}

static void retrace(void)
{
    DWORD reads;
    BYTE value, any = 0;
    UINT seenSet = 0, seenClear = 0, enableSet = 0, enableClear = 0;

    excCalls = 0;
    excSkip = 1;
    for (reads = 0; reads < 200000UL; reads++) {
        _asm {
            mov dx, 3DAh
            in al, dx
            mov value, al
        }
        any |= value;
        if (value & 0x08) {
            seenSet = 1;
        } else {
            seenClear = 1;
        }
        if (value & 0x01) {
            enableSet = 1;
        } else {
            enableClear = 1;
        }
    }

    if (excCalls) {
        wsprintf(probeResult, "fault calls=%u vector=%02x code=%04x", excCalls, excVector,
                 excCode);
        probe("retrace", "3da", probeResult);
        return;
    }
    wsprintf(probeResult, "set=%u clear=%u", seenSet, seenClear);
    probe("retrace", "bit 3", probeResult);
    wsprintf(probeResult, "set=%u clear=%u", enableSet, enableClear);
    probe("retrace", "bit 0", probeResult);
    wsprintf(probeResult, "%02x", any & 0xF6);
    probe("retrace", "other bits", probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WORD flags, code;
    UINT calls;

    probeOpen(OUTPUT);

    _asm {
        mov ax, cs
        mov code, ax
        pushf
        pop ax
        mov flags, ax
    }
    wsprintf(probeResult, "%u", code & 3);
    probe("cpl", "CS", probeResult);
    wsprintf(probeResult, "iopl=%u if=%u", (flags >> 12) & 3, (flags >> 9) & 1);
    probe("flags", "PUSHF", probeResult);
    sayFlags("after POPF of 0202h", afterPopf());
    sayFlags("after 0300h INT 12h, its flags nought", afterRealCall());

    if (!reachOpen(REACH_06 | REACH_0D | REACH_0E)) {
        probe("open", "0000h", "refused");
        probeFinish();
        return 0;
    }

    readPort(0x0000, "first");
    readPort(0x0000, "second");
    readPort(0x0001, "first");
    readPort(0x0001, "second");
    readPort(0x0201, "");

    ioPort = 0x343A;
    ioValue = 0x00;
    calls = runPort((FARPROC)outDX);
    sayPort(calls, (FARPROC)outDX, 0);
    probe("out", "343a", probeResult);

    cmos();
    retrace();
    counter2();

    reachClose();

    probeFinish();
    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
