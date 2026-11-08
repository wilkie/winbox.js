/*
 * INT 31h 0503h growing a block where it can grow in place, and last a
 * function DOSX's table does not have, 000Eh (`kb/topics/dpmi-functions.md`).
 * Recorded in each mode (`record.mjs --mode enhanced`).
 *
 * * `grow`: 0501h of 1000h bytes and 0503h making it 2000h at once: the
 *   carry, AX where set, whether the base moved; 0502h of it. Then three
 *   blocks of 1000h bytes, the second freed, and 0503h making the first
 *   1800h, which the second's room and its own hold; then 0503h making the
 *   third 800h, smaller; 0502h of each.
 * * `calling`, then `outside`: 000Eh, DPMI 1.0's, with ES:DI a buffer and
 *   CX nought: the carry, AX where set.
 */

#define PROBE_FLUSH
#include "probe.h"
#include "dpmiregs.h"

#define OUTPUT "C:\\ORACLE\\DPMIGRW.OUT"

static BYTE buffer[16];

/* 0501h: the handle, nought where refused; the base in `base`. */
static DWORD block(LPCSTR name, UINT high, UINT low, DWORD *base)
{
    set(0x0501, high, low, 0, 0, 0);
    dpmi();
    report("grow", name);
    *base = ((DWORD)rBX << 16) | rCX;
    return rCarry ? 0 : (((DWORD)rSI << 16) | rDI);
}

/* 0503h: the handle after, the same where refused. */
static DWORD resize(LPCSTR name, DWORD handle, UINT high, UINT low, DWORD base)
{
    char text[40];

    set(0x0503, high, low, 0, (UINT)(handle >> 16), (UINT)handle);
    dpmi();
    report("grow", name);
    if (rCarry) {
        return handle;
    }
    wsprintf(text, "%s base", name);
    probe("grow", text, (((DWORD)rBX << 16) | rCX) == base ? "the same" : "moved");
    return ((DWORD)rSI << 16) | rDI;
}

static void release(LPCSTR name, DWORD handle)
{
    set(0x0502, 0, 0, 0, (UINT)(handle >> 16), (UINT)handle);
    dpmi();
    report("grow", name);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    DWORD a, x, y, z, base, xBase, zBase;

    probeOpen(OUTPUT);

    probe("calling", "0503h at once", "yes");
    a = block("0501h alone", 0, 0x1000, &base);
    if (a) {
        a = resize("0503h alone 2000h", a, 0, 0x2000, base);
        release("0502h alone", a);
    }

    probe("calling", "0503h into a freed block", "yes");
    x = block("0501h x", 0, 0x1000, &xBase);
    y = block("0501h y", 0, 0x1000, &base);
    z = block("0501h z", 0, 0x1000, &zBase);
    if (x && y && z) {
        release("0502h y", y);
        x = resize("0503h x 1800h", x, 0, 0x1800, xBase);
        z = resize("0503h z 800h", z, 0, 0x0800, zBase);
        release("0502h x", x);
        release("0502h z", z);
    }

    probe("calling", "000Eh", "yes");
    set(0x000E, 0, 0, 0, 0, (UINT)(BYTE FAR *)buffer);
    dpmi();
    report("outside", "000Eh");

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
