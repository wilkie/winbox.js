/*
 * The DPMI host's descriptor services, INT 31h 0000h-000Dh, made and undone
 * on descriptors of the probe's own, recorded in each mode (`record.mjs
 * --mode enhanced`; `kb/topics/dpmi-functions.md`). A descriptor's eight
 * bytes are recorded where the probe set every one of them; where the
 * machine's memory shows in them -- the base of a block of the probe's, of
 * the first megabyte -- only what does not depend on it.
 *
 * * `alloc`: 0000h of one descriptor: the carry, the selector's low three
 *   bits, its bytes (000Bh); 0000h of three, how far apart they are;
 *   0000h after a 0001h, whether the one freed is given again.
 * * `base`, `limit`, `rights`: 0007h, 0008h and 0009h on it, each followed
 *   by its bytes; 0006h of the base set.
 * * `set`: 000Ch of bytes the probe made, and 000Bh of them back.
 * * `table`: 000Bh of the descriptor through its global-table selector;
 *   the highest selector 000Bh answers.
 * * `alias`: 000Ah of the descriptor, of the probe's code, of nought and of
 *   an execute-only segment.
 * * `free`: 0001h of the descriptor, twice; of a global-table selector;
 *   `LAR` of it after.
 * * `specific`: 000Dh of the fifth descriptor and the seventeenth; 0001h of
 *   the first.
 * * `segment`: 0002h of 0040h twice and of B800h: the same selector or
 *   not, the access byte, limit and base in the first megabyte, and
 *   whether it is KERNEL's `__0040H`.
 */

#define PROBE_FLUSH
#include "probe.h"
#include "dpmiregs.h"

#define OUTPUT "C:\\ORACLE\\DPMILDT.OUT"

static BYTE bytes[8];

/* 000Bh of a selector into `bytes`; nought where refused. */
static int read(UINT selector)
{
    set(0x000B, selector, 0, 0, 0, (UINT)(BYTE FAR *)bytes);
    dpmi();
    return !rCarry;
}

static void show(LPCSTR group, LPCSTR name, UINT selector)
{
    if (read(selector)) {
        wsprintf(probeResult, "%02x %02x %02x %02x %02x %02x %02x %02x", bytes[0], bytes[1],
                 bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7]);
    } else {
        wsprintf(probeResult, "cf=1 ax=%04x", rAX);
    }

    probe(group, name, probeResult);
}

/* `LAR` of a selector: its access byte and flags, or that it is refused. */
static void lar(LPCSTR group, LPCSTR name, UINT selector)
{
    UINT rights = 0;
    UINT valid = 0;

    _asm {
        mov bx, selector
        db 0fh, 02h, 0c3h /* lar ax, bx */
        jnz bad
        mov rights, ax
        mov valid, 1
    bad:
    }

    if (valid) {
        wsprintf(probeResult, "%04x", rights & 0xff00);
    } else {
        lstrcpy(probeResult, "refused");
    }

    probe(group, name, probeResult);
}

static void limit(LPCSTR name, UINT selector, UINT high, UINT low)
{
    call("limit", name, 0x0008, selector, high, low);
    show("limit", name, selector);
}

static void rights(LPCSTR name, UINT selector, UINT value)
{
    call("rights", name, 0x0009, selector, value, 0);
    show("rights", name, selector);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show_)
{
    UINT one, first, again, alias, given, at;
    UINT ds = ourDS();
    UINT cs = ourCS();
    char name[32];

    probeOpen(OUTPUT);

    /* --- 0000h --- */
    call("alloc", "0000h one", 0x0000, 0, 1, 0);
    one = rAX;
    wsprintf(probeResult, "%u", one & 7);
    probe("alloc", "0000h low bits", probeResult);
    show("alloc", "0000h bytes", one);

    /* --- 0007h and 0006h --- */
    call("base", "0007h 00012340h", 0x0007, one, 0x0001, 0x2340);
    show("base", "0007h bytes", one);
    call("base", "0006h", 0x0006, one, 0, 0);
    wsprintf(probeResult, "%04x%04x", rCX, rDX);
    probe("base", "0006h value", probeResult);
    call("base", "0007h FEDCBA98h", 0x0007, one, 0xFEDC, 0xBA98);
    show("base", "0007h high bytes", one);
    call("base", "0007h 00012340h again", 0x0007, one, 0x0001, 0x2340);

    /* --- 0008h --- */
    limit("0008h FFFFh", one, 0x0000, 0xFFFF);
    limit("0008h 0FFFFFh", one, 0x000F, 0xFFFF);
    limit("0008h 100FFFh", one, 0x0010, 0x0FFF);
    limit("0008h 123456h", one, 0x0012, 0x3456);
    limit("0008h FFFFFFFFh", one, 0xFFFF, 0xFFFF);
    limit("0008h 0", one, 0x0000, 0x0000);
    limit("0008h 0FFFh", one, 0x0000, 0x0FFF);

    /* --- 0009h --- */
    rights("0009h 00F2h", one, 0x00F2);
    rights("0009h 00FAh", one, 0x00FA);
    rights("0009h 40F2h", one, 0x40F2);
    rights("0009h 80F2h", one, 0x80F2);
    rights("0009h 10F2h", one, 0x10F2);
    rights("0009h 0092h", one, 0x0092);
    rights("0009h 0072h", one, 0x0072);
    rights("0009h 00E2h", one, 0x00E2);
    rights("0009h 0082h", one, 0x0082);
    rights("0009h 00F0h", one, 0x00F0);
    rights("0009h 00F2h again", one, 0x00F2);

    /* --- 000Ch and 000Bh --- */
    bytes[0] = 0x34;
    bytes[1] = 0x12;
    bytes[2] = 0x9A;
    bytes[3] = 0x78;
    bytes[4] = 0x56;
    bytes[5] = 0xF3;
    bytes[6] = 0x40;
    bytes[7] = 0x00;
    set(0x000C, one, 0, 0, 0, (UINT)(BYTE FAR *)bytes);
    dpmi();
    report("set", "000Ch data");
    show("set", "000Ch data bytes", one);
    bytes[5] = 0x82;
    set(0x000C, one, 0, 0, 0, (UINT)(BYTE FAR *)bytes);
    dpmi();
    report("set", "000Ch system");
    show("set", "000Ch system bytes", one);
    bytes[5] = 0x93;
    bytes[6] = 0x00;
    set(0x000C, one, 0, 0, 0, (UINT)(BYTE FAR *)bytes);
    dpmi();
    report("set", "000Ch ring 0");
    show("set", "000Ch ring 0 bytes", one);
    call("set", "0009h F2h back", 0x0009, one, 0x00F2, 0);

    /* --- the table --- */
    show("table", "000Bh global", one & ~4);
    set(0x000B, 0, 0, 0, 0, (UINT)(BYTE FAR *)bytes);
    dpmi();
    report("table", "000Bh nought");
    for (at = 0xFFFF; at > 0x0007; at -= 8) {
        if (read(at)) {
            break;
        }
    }
    wsprintf(probeResult, "%04x", at);
    probe("table", "000Bh highest", probeResult);

    /* --- 000Ah --- */
    set(0x000A, one, 0, 0, 0, 0);
    dpmi();
    report("alias", "000Ah of it");
    if (!rCarry) {
        alias = rAX;
        show("alias", "000Ah of it bytes", alias);
        call("alias", "000Ah of it free", 0x0001, alias, 0, 0);
    }

    set(0x000A, cs, 0, 0, 0, 0);
    dpmi();
    report("alias", "000Ah of code");
    if (!rCarry) {
        alias = rAX;
        if (read(alias)) {
            wsprintf(probeResult, "access=%02x flags=%02x", bytes[5], bytes[6] & 0xF0);
            probe("alias", "000Ah of code bytes", probeResult);
        }
        call("alias", "000Ah of code free", 0x0001, alias, 0, 0);
    }

    call("alias", "000Ah of nought", 0x000A, 0, 0, 0);
    call("alias", "0009h F8h", 0x0009, one, 0x00F8, 0);
    call("alias", "000Ah of execute-only", 0x000A, one, 0, 0);
    if (!rCarry) {
        call("alias", "000Ah of execute-only free", 0x0001, rAX, 0, 0);
    }
    call("alias", "0009h F2h back", 0x0009, one, 0x00F2, 0);

    /* --- 0001h --- */
    call("free", "0001h", 0x0001, one, 0, 0);
    lar("free", "0001h lar", one);
    if (read(one)) {
        wsprintf(probeResult, "access=%02x flags=%02x", bytes[5], bytes[6]);
    } else {
        wsprintf(probeResult, "cf=1 ax=%04x", rAX);
    }
    probe("free", "0001h bytes", probeResult);
    call("free", "0001h twice", 0x0001, one, 0, 0);
    call("free", "0001h global", 0x0001, 0x0040, 0, 0);
    call("free", "0001h nought", 0x0001, 0, 0, 0);

    /* --- 0000h again --- */
    call("alloc", "0000h after free", 0x0000, 0, 1, 0);
    again = rAX;
    probe("alloc", "0000h after free given", again == one ? "the one freed" : "another");
    call("alloc", "0000h three", 0x0000, 0, 3, 0);
    first = rAX;
    if (!rCarry) {
        show("alloc", "0000h three third", first + 16);
        call("alloc", "0001h first", 0x0001, first, 0, 0);
        call("alloc", "0001h second", 0x0001, first + 8, 0, 0);
        call("alloc", "0001h third", 0x0001, first + 16, 0, 0);
    }
    call("alloc", "0001h again", 0x0001, again, 0, 0);

    /* --- 000Dh --- */
    call("specific", "000Dh 0027h", 0x000D, 0x0027, 0, 0);
    if (!rCarry) {
        show("specific", "000Dh 0027h bytes", 0x0027);
        call("specific", "000Dh 0027h twice", 0x000D, 0x0027, 0, 0);
        call("specific", "0001h 0027h", 0x0001, 0x0027, 0, 0);
        lar("specific", "0001h 0027h lar", 0x0027);
    }
    call("specific", "000Dh 0087h", 0x000D, 0x0087, 0, 0);
    if (!rCarry) {
        call("specific", "0001h 0087h", 0x0001, 0x0087, 0, 0);
    }
    call("specific", "000Dh 0020h", 0x000D, 0x0020, 0, 0);
    if (!rCarry) {
        call("specific", "0001h 0020h", 0x0001, 0x0020, 0, 0);
    }

    /* --- 0002h --- */
    call("segment", "0002h 0040h", 0x0002, 0x0040, 0, 0);
    given = rAX;
    call("segment", "0002h 0040h twice", 0x0002, 0x0040, 0, 0);
    probe("segment", "0002h 0040h twice given", rAX == given ? "the same" : "another");
    if (read(given)) {
        wsprintf(probeResult, "access=%02x flags=%02x limit=%02x%02x base=%lx", bytes[5],
                 bytes[6], bytes[1], bytes[0],
                 ((DWORD)bytes[2] | ((DWORD)bytes[3] << 8) | ((DWORD)bytes[4] << 16)) & 0xFFFFFL);
        probe("segment", "0002h 0040h bytes", probeResult);
    }
    lstrcpy(name, given & 4 ? "local" : "global");
    probe("segment", "0002h 0040h table", name);
    probe("segment", "0002h 0040h kernel's",
          given == LOWORD((DWORD)GetProcAddress(GetModuleHandle("KERNEL"), MAKEINTRESOURCE(193)))
              ? "the same"
              : "another");
    call("segment", "0002h B800h", 0x0002, 0xB800, 0, 0);
    if (!rCarry && read(rAX)) {
        wsprintf(probeResult, "access=%02x flags=%02x limit=%02x%02x base=%lx", bytes[5],
                 bytes[6], bytes[1], bytes[0],
                 ((DWORD)bytes[2] | ((DWORD)bytes[3] << 8) | ((DWORD)bytes[4] << 16)) & 0xFFFFFL);
        probe("segment", "0002h B800h bytes", probeResult);
    }

    /* --- 0006h of what is no descriptor of the probe's --- */
    call("base", "0006h nought", 0x0006, 0, 0, 0);

    (void)ds;
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show_;
    return 0;
}
