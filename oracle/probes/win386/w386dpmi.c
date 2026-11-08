/*
 * The DPMI calls WATCOM's Win386 supervisor makes as it starts its 32-bit
 * program, made again here one at a time with the arguments it gives them,
 * each answer recorded (`kb/topics/win386.md`). A 16-bit program
 * (`PROBE_WIN16`, built by `build-probes.mjs`'s `buildWin386` as the other
 * probes are), kept with the Win386 probes because only 386 enhanced mode's
 * host answers the supervisor (`record.mjs --mode enhanced`).
 *
 * The supervisor's order (`W386VER.EXE` seg1, its code bound from
 * `binw/win386.ext`): the program's memory from 0501h (`3768`), the
 * selectors' increment from 0003h, a code selector from 0000h and two data
 * selectors in a row, each given a base 64 KiB into the block (0007h), the
 * rights of 32-bit code or data, page-granular, at the caller's privilege
 * (0009h, `3624`-`3686`) and a limit of FFFFFFFFh (0008h); then 000Bh of
 * the first data selector, the limit's bits tested for 4 GiB (`3707`-
 * `372f`), and 0006h of its base (`03ea`). Then fifty selectors of 64 KiB
 * data for 16-bit aliases (`39b8`-`3a0e`), and one more for a block the
 * program asks for (`342a`-`34ab`). A descriptor's bytes are recorded but
 * for its base, which is where each host's memory is.
 *
 * * `alloc`: 0501h, the block's offset in its page and whether a handle
 *   came; 0003h; 0000h of one, of two and of fifty, the selectors' low bits
 *   and how far apart.
 * * `code`, `data`: 0007h, 0009h and 0008h on each, its bytes after.
 * * `flat`: 000Bh's limit bits as the supervisor tests them; 0006h's base
 *   against the one set.
 * * `alias`: 0009h F3h and 0008h FFFFh on the first two of the fifty.
 * * `block`: 0000h, 0009h, 0007h and 0008h of one more as `342a` makes it.
 * * `use`: a byte written through the data selector with a 32-bit
 *   address, read back through an alias of the same place.
 * * `free`: 0001h of each and 0502h of the block.
 */

#define PROBE_WIN16
#define PROBE_FLUSH
#include "probe.h"
#include "dpmiregs.h"

#define OUTPUT "C:\\ORACLE\\W386DPMI.OUT"

static BYTE bytes[8];

/* A descriptor's bytes but its base's: limit, access, flags and limit. */
static void show(LPCSTR group, LPCSTR name, UINT selector)
{
    set(0x000B, selector, 0, 0, 0, (UINT)(BYTE FAR *)bytes);
    dpmi();

    if (rCarry) {
        wsprintf(probeResult, "cf=1 ax=%04x", rAX);
    } else {
        wsprintf(probeResult, "limit %02x%02x, access %02x, flags %02x", bytes[1], bytes[0],
                 bytes[5], bytes[6]);
    }

    probe(group, name, probeResult);
}

/* 0007h, 0009h and 0008h of a selector, as `3624` makes them. */
static void make(LPCSTR group, UINT selector, UINT baseHigh, UINT baseLow, UINT rights,
                 UINT limitHigh, UINT limitLow)
{
    char name[32];

    call(group, "0007h", 0x0007, selector, baseHigh, baseLow);
    wsprintf(name, "0009h %04xh", rights);
    call(group, name, 0x0009, selector, rights, 0);
    wsprintf(name, "0008h %04x%04xh", limitHigh, limitLow);
    call(group, name, 0x0008, selector, limitHigh, limitLow);
    show(group, "bytes", selector);
}

static void freeSelector(LPCSTR name, UINT selector)
{
    call("free", name, 0x0001, selector, 0, 0);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show_)
{
    UINT step, code, data, aliases, more;
    UINT blockHigh, blockLow, handleHigh, handleLow, baseHigh;
    UINT privilege = (ourCS() & 3) << 5;
    BYTE value = 0;

    probeOpen(OUTPUT);

    /* --- the program's memory: 0501h of 16000h bytes, as for W386VER --- */
    call("alloc", "0501h 00016000h", 0x0501, 0x0001, 0x6000, 0);
    blockHigh = rBX;
    blockLow = rCX;
    handleHigh = rSI;
    handleLow = rDI;
    wsprintf(probeResult, "offset in page %03x, handle %s", blockLow & 0x0fff,
             (handleHigh | handleLow) ? "given" : "nought");
    probe("alloc", "0501h block", probeResult);

    /* The segments' base: 64 KiB into the block (`039e`-`03ad`). */
    baseHigh = blockHigh + 1;

    call("alloc", "0003h", 0x0003, 0, 0, 0);
    step = rAX;
    wsprintf(probeResult, "%04x", step);
    probe("alloc", "0003h increment", probeResult);

    /* --- the code selector --- */
    call("alloc", "0000h one", 0x0000, 0, 1, 0);
    code = rAX;
    wsprintf(probeResult, "%u", code & 7);
    probe("alloc", "0000h one low bits", probeResult);
    make("code", code, baseHigh, blockLow, 0xC09B + privilege, 0xFFFF, 0xFFFF);

    /* --- two data selectors in a row --- */
    call("alloc", "0000h two", 0x0000, 0, 2, 0);
    data = rAX;
    wsprintf(probeResult, "%u", data & 7);
    probe("alloc", "0000h two low bits", probeResult);
    make("data", data, baseHigh, blockLow, 0xC093 + privilege, 0xFFFF, 0xFFFF);
    make("data", data + step, baseHigh, blockLow, 0xC093 + privilege, 0xFFFF, 0xFFFF);

    /* --- the supervisor's test of the limit, and the base --- */
    set(0x000B, data, 0, 0, 0, (UINT)(BYTE FAR *)bytes);
    dpmi();
    probe("flat", "000Bh limit 4 GiB",
          !rCarry && (bytes[6] & 0x0f) == 0x0f && bytes[0] == 0xff && bytes[1] == 0xff
              ? "yes"
              : "no");
    call("flat", "0006h", 0x0006, data, 0, 0);
    wsprintf(probeResult, "%s", rCX == baseHigh && rDX == blockLow ? "the base set" : "another");
    probe("flat", "0006h base", probeResult);

    /* --- fifty selectors for aliases --- */
    call("alloc", "0000h fifty", 0x0000, 0, 0x32, 0);
    aliases = rAX;
    wsprintf(probeResult, "%u", aliases & 7);
    probe("alloc", "0000h fifty low bits", probeResult);
    call("alias", "0009h 00F3h first", 0x0009, aliases, 0x0093 + privilege, 0);
    call("alias", "0008h 0000FFFFh first", 0x0008, aliases, 0x0000, 0xFFFF);
    show("alias", "first bytes", aliases);
    call("alias", "0009h 00F3h second", 0x0009, aliases + step, 0x0093 + privilege, 0);
    call("alias", "0008h 0000FFFFh second", 0x0008, aliases + step, 0x0000, 0xFFFF);
    show("alias", "second bytes", aliases + step);
    /* The first of them on the flat segments' base. */
    call("alias", "0007h", 0x0007, aliases, baseHigh, blockLow);

    /* --- one more, for a block of the program's (`342a`) --- */
    call("alloc", "0000h one more", 0x0000, 0, 1, 0);
    more = rAX;
    make("block", more, baseHigh, blockLow, 0x0093 + privilege, 0x0000, 0xFFFF);

    /* --- a byte through the flat data selector, a 32-bit address, and
     * back through the alias --- */
    _asm {
        push es
        push di
        mov es, data
        db 66h, 0bfh, 00h, 50h, 00h, 00h /* mov edi, 5000h */
        mov al, 5ah
        db 67h, 26h, 88h, 07h /* mov es:[edi], al */
        mov es, aliases
        mov di, 5000h
        mov al, es:[di]
        mov value, al
        pop di
        pop es
    }
    wsprintf(probeResult, "%02x", value);
    probe("use", "flat 5000h through the alias", probeResult);

    /* --- given back --- */
    freeSelector("0001h one more", more);
    freeSelector("0001h first alias", aliases);
    freeSelector("0001h second data", data + step);
    freeSelector("0001h data", data);
    freeSelector("0001h code", code);
    /* 0502h takes the handle in SI:DI. */
    set(0x0502, 0, 0, 0, handleHigh, handleLow);
    dpmi();
    report("free", "0502h block");

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show_;
    return 0;
}
