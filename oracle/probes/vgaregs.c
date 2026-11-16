/*
 * The VGA's own registers as a Windows program reads them on the VGA's
 * driver, as the catalog's programs read them (`kb/topics/io-ports.md`):
 * Microsoft's Fine Artist and Creative Writer read the sixteen palette
 * registers through the attribute controller (3DAh to reset its flip-flop,
 * the index at 3C0h, the register at 3C1h) and each one's DAC register
 * through 3C7h and 3C9h (`ARTIST.EXE` seg14 `6a1c`-`6a6f`); MUSCLE.VBX
 * looks for a Hercules card by reading the monochrome status port, 3BAh,
 * until bit 7 turns over (seg1 `07ec`-`0809`). Recorded in each mode
 * (`record.mjs --mode enhanced`), under the probe's own handlers (0203h)
 * for exceptions 06h, 0Dh and 0Eh, so a read or write that faults is seen.
 * Nothing is written that the screen shows otherwise: each register is
 * written back with what it held.
 *
 * * `mono`: 3BAh read 1,000 times: the first byte, and the bits that were
 *   ever seen set and ever seen clear.
 * * `attr`: 3DAh read, then each attribute register 00h-14h, its index
 *   written to 3C0h with bit 5 set (the screen left on), read at 3C1h;
 *   and 3C0h read back after the index, the index and bit 5.
 * * `attr-write`: register 01h written back with what it held, its index
 *   written with bit 5 clear (as Fine Artist writes it) and with it set,
 *   read back each time; 3C0h then 20h.
 * * `dac`: the DAC's state (3C7h), its write index (3C8h) and its mask
 *   (3C6h) as Windows left them; then each register 00h-FFh read through
 *   3C7h and 3C9h, the first sixteen and 3Fh, 40h and FFh written out and
 *   a sum of all 768 bytes; then 3C7h and 3C8h again.
 * * `dac-step`: after 3C7h is written 05h and two bytes read at 3C9h,
 *   3C8h, and the third byte; then 3C7h written 07h and three bytes read,
 *   and the next three without writing 3C7h: the read index steps on.
 * * `dac-write`: register 07h written back through 3C8h and 3C9h with
 *   what it held, then 3C8h read, and 07h read back.
 */

#include "probe.h"
#include "dpmiregs.h"
#include "pgreach.h"

#define OUTPUT "C:\\ORACLE\\VGAREGS.OUT"

static BYTE inPort(WORD port)
{
    BYTE value;

    _asm {
        mov dx, port
        in al, dx
        mov value, al
    }

    return value;
}

static void outPort(WORD port, BYTE value)
{
    _asm {
        mov dx, port
        mov al, value
        out dx, al
    }
}

static int faulted(LPCSTR function, LPCSTR args)
{
    if (!excCalls) {
        return 0;
    }

    wsprintf(probeResult, "fault calls=%u vector=%02x code=%04x", excCalls, excVector, excCode);
    probe(function, args, probeResult);
    excCalls = 0;
    return 1;
}

static void mono(void)
{
    UINT reads;
    BYTE first = 0, set = 0, clear = 0;

    excCalls = 0;
    excSkip = 1;
    for (reads = 0; reads < 1000; reads++) {
        BYTE value = inPort(0x3BA);

        if (reads == 0) {
            first = value;
        }
        set |= value;
        clear |= (BYTE)~value;
    }

    if (faulted("mono", "3ba")) {
        return;
    }

    wsprintf(probeResult, "%02x", first);
    probe("mono", "3ba first", probeResult);
    wsprintf(probeResult, "set=%02x clear=%02x", set, clear);
    probe("mono", "3ba bits over 1000 reads", probeResult);
}

/* An attribute register read, the flip-flop reset first. */
static BYTE attrRead(BYTE index, BYTE *back)
{
    BYTE value;

    _asm cli
    inPort(0x3DA);
    outPort(0x3C0, (BYTE)(index | 0x20));
    *back = inPort(0x3C0);
    value = inPort(0x3C1);
    inPort(0x3DA);
    _asm sti

    return value;
}

static void attr(void)
{
    BYTE index, value, back;

    excCalls = 0;
    excSkip = 1;
    for (index = 0; index <= 0x14; index++) {
        value = attrRead(index, &back);
        wsprintf(probeArgs, "%02x", index);
        if (faulted("attr", probeArgs)) {
            continue;
        }
        wsprintf(probeResult, "%02x (3c0 %02x)", value, back);
        probe("attr", probeArgs, probeResult);
    }
}

static void attrWrite(void)
{
    BYTE held, after, back;

    excCalls = 0;
    excSkip = 1;
    held = attrRead(0x01, &back);

    _asm cli
    inPort(0x3DA);
    outPort(0x3C0, 0x01);
    back = inPort(0x3C0);
    outPort(0x3C0, held);
    outPort(0x3C0, 0x20);
    _asm sti
    after = attrRead(0x01, &back);
    if (faulted("attr-write", "01 bit 5 clear")) {
        return;
    }
    wsprintf(probeResult, "held=%02x after=%02x", held, after);
    probe("attr-write", "01 bit 5 clear", probeResult);

    _asm cli
    inPort(0x3DA);
    outPort(0x3C0, 0x21);
    outPort(0x3C0, held);
    _asm sti
    after = attrRead(0x01, &back);
    if (faulted("attr-write", "01 bit 5 set")) {
        return;
    }
    wsprintf(probeResult, "held=%02x after=%02x", held, after);
    probe("attr-write", "01 bit 5 set", probeResult);
}

static BYTE dacBytes[768];

static void dacState(LPCSTR when)
{
    BYTE state, write, mask;

    state = inPort(0x3C7);
    write = inPort(0x3C8);
    mask = inPort(0x3C6);
    if (faulted("dac", when)) {
        return;
    }
    wsprintf(probeResult, "state=%02x write=%02x mask=%02x", state, write, mask);
    probe("dac", when, probeResult);
}

static void dac(void)
{
    UINT index;
    DWORD sum = 0;

    excCalls = 0;
    excSkip = 1;
    dacState("as Windows left it");

    _asm cli
    outPort(0x3C7, 0);
    for (index = 0; index < 768; index++) {
        dacBytes[index] = inPort(0x3C9);
    }
    _asm sti
    if (faulted("dac", "read")) {
        return;
    }

    for (index = 0; index < 768; index++) {
        sum += dacBytes[index];
    }

    for (index = 0; index < 256; index++) {
        if (index < 16 || index == 0x3F || index == 0x40 || index == 0xFF) {
            wsprintf(probeArgs, "%02x", index);
            wsprintf(probeResult, "%02x %02x %02x", dacBytes[index * 3], dacBytes[index * 3 + 1],
                     dacBytes[index * 3 + 2]);
            probe("dac", probeArgs, probeResult);
        }
    }
    wsprintf(probeResult, "%lu", sum);
    probe("dac", "sum of 768", probeResult);
    dacState("after reading all 256");
}

static void dacStep(void)
{
    BYTE a, b, c, write, d[6];

    excCalls = 0;
    excSkip = 1;
    _asm cli
    outPort(0x3C7, 0x05);
    a = inPort(0x3C9);
    b = inPort(0x3C9);
    write = inPort(0x3C8);
    c = inPort(0x3C9);
    _asm sti
    if (faulted("dac-step", "05")) {
        return;
    }
    wsprintf(probeResult, "%02x %02x 3c8=%02x %02x", a, b, write, c);
    probe("dac-step", "05, two bytes, 3c8, the third", probeResult);

    _asm cli
    outPort(0x3C7, 0x07);
    d[0] = inPort(0x3C9);
    d[1] = inPort(0x3C9);
    d[2] = inPort(0x3C9);
    d[3] = inPort(0x3C9);
    d[4] = inPort(0x3C9);
    d[5] = inPort(0x3C9);
    _asm sti
    if (faulted("dac-step", "07")) {
        return;
    }
    wsprintf(probeResult, "%02x %02x %02x %02x %02x %02x", d[0], d[1], d[2], d[3], d[4], d[5]);
    probe("dac-step", "07, six bytes", probeResult);
}

static void dacWrite(void)
{
    BYTE r, g, b, write, r2, g2, b2;

    excCalls = 0;
    excSkip = 1;
    _asm cli
    outPort(0x3C7, 0x07);
    r = inPort(0x3C9);
    g = inPort(0x3C9);
    b = inPort(0x3C9);
    outPort(0x3C8, 0x07);
    outPort(0x3C9, r);
    outPort(0x3C9, g);
    outPort(0x3C9, b);
    write = inPort(0x3C8);
    outPort(0x3C7, 0x07);
    r2 = inPort(0x3C9);
    g2 = inPort(0x3C9);
    b2 = inPort(0x3C9);
    _asm sti
    if (faulted("dac-write", "07")) {
        return;
    }
    wsprintf(probeResult, "held=%02x %02x %02x 3c8=%02x after=%02x %02x %02x", r, g, b, write, r2,
             g2, b2);
    probe("dac-write", "07 written back", probeResult);
    dacState("after the write");
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    probeOpen(OUTPUT);

    if (!reachOpen(REACH_06 | REACH_0D | REACH_0E)) {
        probe("open", "0000h", "refused");
        probeFinish();
        return 0;
    }

    mono();
    attr();
    attrWrite();
    dac();
    dacStep();
    dacWrite();

    reachClose();

    probeFinish();
    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
