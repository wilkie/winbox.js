/*
 * A moveable block grown by GlobalReAlloc across 64 KiB, 1 MiB and on, and
 * what its selectors are to the processor after each step: the limit, the
 * granularity, the selectors after the first, and a 32-bit `rep stosw`
 * across the block's old end -- as Klik & Play's KNPS.DLL clears a block it
 * has grown past a megabyte (`rep a32 stosw`, KNPS.DLL seg1 `4ad1`).
 *
 * * `grow`: for each size, GlobalReAlloc(GMEM_MOVEABLE) of the same block:
 *   `same` or `other` handle, GlobalSize, then of the selector GlobalLock
 *   gives: `lsl=` its limit, all 32 bits of `LSL`; `g=` its granularity bit
 *   and `d=` its big bit, from the high word of a 32-bit `LAR`.
 * * `tiles`: the selectors after the first, one for each 64 KiB more of the
 *   block: `n=` how many; `base=1` where each one's base is the first's and
 *   64 KiB for each before it (GetSelectorBase), else the first that is not
 *   and how far it is; `lsl=1` where each one's limit is the first's less
 *   64 KiB for each before it, else the first that is not and its limit;
 *   `g=` the granularity bit of the second and of the last.
 * * `fill`: 16 words of a pattern written with `rep a32 stosw` through the
 *   selector, from 16 bytes before the block's old end to 16 after, and read
 *   again with 32-bit offsets: the word before the old end, the word at it,
 *   and the last word written; then whether the pattern the step before
 *   wrote at its own old end was kept as the block grew (`kept=`).
 *
 * The 32-bit instructions are written as bytes: the compiler's assembler
 * knows only the 8086's. The probe's own code is 16-bit, as KNPS's is: the
 * address-size prefix (67h) makes each address EDI's or ESI's.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\GBIGSEL.OUT"

DWORD FAR PASCAL GetSelectorBase(UINT);

/* LSL EBX,EAX: the whole limit, nought where LSL refuses. */
extern unsigned long lsl32(unsigned selector);
#pragma aux lsl32 = \
    0x66 0x33 0xdb \
    0x66 0x0f 0xb7 0xc0 \
    0x66 0x0f 0x03 0xd8 \
    "mov ax, bx" \
    0x66 0xc1 0xeb 0x10 \
    "mov dx, bx" \
    parm [ax] value [dx ax] modify [bx];

/* LAR EBX,EAX: the high word, the descriptor's byte 6 in its low byte. */
extern unsigned lar32High(unsigned selector);
#pragma aux lar32High = \
    0x66 0x33 0xdb \
    0x66 0x0f 0xb7 0xc0 \
    0x66 0x0f 0x02 0xd8 \
    0x66 0xc1 0xeb 0x10 \
    "mov ax, bx" \
    parm [ax] value [ax] modify [bx];

/* REP A32 STOSW: CX words of SI at ES:EDI, EDI = DX:AX. */
extern void fill32(unsigned selector, unsigned long offset, unsigned count, unsigned value);
#pragma aux fill32 = \
    "push es" \
    "mov es, bx" \
    0x66 0x0f 0xb7 0xf8 \
    0x66 0xc1 0xe2 0x10 \
    0x66 0x0b 0xfa \
    0x66 0x0f 0xb7 0xc9 \
    "mov ax, si" \
    "cld" \
    0xf3 0x67 0xab \
    "pop es" \
    parm [bx] [dx ax] [cx] [si] modify [di cx dx ax];

/* MOV AX,ES:[EDI], EDI = DX:AX. */
extern unsigned peek32(unsigned selector, unsigned long offset);
#pragma aux peek32 = \
    "push es" \
    "mov es, bx" \
    0x66 0x0f 0xb7 0xf8 \
    0x66 0xc1 0xe2 0x10 \
    0x66 0x0b 0xfa \
    0x67 0x26 0x8b 0x07 \
    "pop es" \
    parm [bx] [dx ax] value [ax] modify [di dx];

static const DWORD sizes[] = {
    0x8000L, 0x10000L, 0x10001L, 0x18000L, 0xFFFE0L, 0x100000L,
    0x100001L, 0x14E000L, 0x200000L, 0x123456L, 0x80000L,
};

#define COUNT (sizeof(sizes) / sizeof(sizes[0]))

static void tiles(LPCSTR args, unsigned selector, DWORD size, DWORD limit)
{
    unsigned n = (unsigned)((size + 0xFFFFL) >> 16);
    DWORD base = GetSelectorBase(selector);
    char bases[24];
    char limits[24];
    unsigned k;

    lstrcpy(bases, "1");
    lstrcpy(limits, "1");

    for (k = 1; k < n; k++) {
        unsigned tile = selector + 8 * k;
        DWORD at = GetSelectorBase(tile);
        DWORD reach = lsl32(tile);

        if (bases[0] == '1' && at - base != (DWORD)k << 16) {
            wsprintf(bases, "%u:%lx", k, at - base);
        }

        if (limits[0] == '1' && reach != limit - ((DWORD)k << 16)) {
            wsprintf(limits, "%u:%lx", k, reach);
        }
    }

    if (n > 1) {
        wsprintf(probeResult, "n=%u,base=%s,lsl=%s,g=%u/%u", n, (LPSTR)bases, (LPSTR)limits,
                 (lar32High(selector + 8) >> 7) & 1, (lar32High(selector + 8 * (n - 1)) >> 7) & 1);
    } else {
        wsprintf(probeResult, "n=%u", n);
    }

    probe("tiles", args, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HGLOBAL block;
    DWORD old;
    DWORD mark = 0;
    unsigned pattern = 0;
    unsigned i;

    probeOpen(OUTPUT);

    block = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, 0x40L);
    old = GlobalSize(block);

    for (i = 0; i < COUNT; i++) {
        HGLOBAL grown = GlobalReAlloc(block, sizes[i], GMEM_MOVEABLE);
        char args[16];
        unsigned selector;
        DWORD size;
        DWORD limit;
        unsigned high;
        DWORD from;
        DWORD end;
        unsigned kept;

        wsprintf(args, "%lx", sizes[i]);

        if (!grown) {
            probe("grow", args, "0");
            continue;
        }

        size = GlobalSize(grown);
        selector = SELECTOROF(GlobalLock(grown));
        limit = lsl32(selector);
        high = lar32High(selector);
        wsprintf(probeResult, "%s %lx lsl=%lx,g=%u,d=%u", (LPSTR)(grown == block ? "same" : "other"),
                 size, limit, (high >> 7) & 1, (high >> 6) & 1);
        probe("grow", args, probeResult);
        block = grown;

        tiles(args, selector, size, limit);

        /* The pattern the step before wrote, where it wrote it. */
        kept = mark && mark < size ? peek32(selector, mark) == pattern : 2;

        if (size > old && old >= 0x10) {
            from = old - 0x10;
            end = old + 0x10 <= size ? old + 0x10 : size;
            pattern = 0x5A00 + i;
            fill32(selector, from, (unsigned)((end - from) / 2), pattern);
            wsprintf(probeResult, "%04x %04x %04x kept=%u", peek32(selector, old - 2),
                     peek32(selector, old), peek32(selector, end - 2), kept);
            mark = old;
        } else {
            wsprintf(probeResult, "none kept=%u", kept);
        }

        probe("fill", args, probeResult);
        GlobalUnlock(block);
        old = size;
    }

    GlobalFree(block);
    probeFinish();

    return 0;
}
