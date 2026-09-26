/*
 * What a program's selectors are to the processor: each one's access rights
 * and limit, as `LAR` and `LSL` give them, and whether `VERR` and `VERW` find
 * it readable and writable -- from the program's own privilege.
 *
 * Libraries check a pointer this way before they use it -- `OLESVR.DLL` does
 * for every one it is given -- so the answers have to be Windows' own.
 *
 * * `sel`: for each selector, `lar=` the access rights word (the access byte
 *   in its high byte) or `-` when `LAR` refuses it, `lsl=` the limit or `-`,
 *   and `verr=`, `verw=` 1 or 0: the null selector, blocks from
 *   `GlobalAlloc` of each kind and size, and one freed.
 * * `code`: the same but the limit, for a segment of USER's code -- whose
 *   size is USER's own business.
 *
 * The program's own segments are not recorded: what they are depends on the
 * program. Its code showed FBh and its data F3h, as the blocks here do.
 *
 * The instructions are written as bytes: the compiler's assembler knows only
 * the 8086's.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\SELINFO.OUT"

/* LAR BX,AX; the flags in AH, the rights in DX. */
extern unsigned long larOf(unsigned selector);
#pragma aux larOf = \
    "xor bx, bx" \
    0x0f 0x02 0xd8 \
    "lahf" \
    "mov dx, bx" \
    parm [ax] value [dx ax] modify [bx];

/* LSL BX,AX. */
extern unsigned long lslOf(unsigned selector);
#pragma aux lslOf = \
    "xor bx, bx" \
    0x0f 0x03 0xd8 \
    "lahf" \
    "mov dx, bx" \
    parm [ax] value [dx ax] modify [bx];

/* VERR AX. */
extern unsigned verrOf(unsigned selector);
#pragma aux verrOf = \
    0x0f 0x00 0xe0 \
    "lahf" \
    parm [ax] value [ax];

/* VERW AX. */
extern unsigned verwOf(unsigned selector);
#pragma aux verwOf = \
    0x0f 0x00 0xe8 \
    "lahf" \
    parm [ax] value [ax];

#define ZERO(flags) (((flags) >> 8) & 0x40)

static void look(LPCSTR function, LPCSTR name, unsigned selector, BOOL limits)
{
    unsigned long lar = larOf(selector);
    unsigned long lsl = lslOf(selector);
    char rights[8];
    char limit[8];

    if (ZERO(lar)) {
        wsprintf(rights, "%04x", (unsigned)(lar >> 16));
    } else {
        lstrcpy(rights, "-");
    }

    if (ZERO(lsl)) {
        wsprintf(limit, "%04x", (unsigned)(lsl >> 16));
    } else {
        lstrcpy(limit, "-");
    }

    if (limits) {
        wsprintf(probeResult, "lar=%s,lsl=%s,verr=%d,verw=%d", (LPSTR)rights, (LPSTR)limit,
                 ZERO(verrOf(selector)) ? 1 : 0, ZERO(verwOf(selector)) ? 1 : 0);
    } else {
        wsprintf(probeResult, "lar=%s,verr=%d,verw=%d", (LPSTR)rights,
                 ZERO(verrOf(selector)) ? 1 : 0, ZERO(verwOf(selector)) ? 1 : 0);
    }

    probe(function, name, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HGLOBAL moveable;
    HGLOBAL fixed;
    HGLOBAL discardable;
    HGLOBAL big;
    HGLOBAL freed;
    unsigned selector;

    probeOpen(OUTPUT);

    look("sel", "null", 0, TRUE);
    look("sel", "null-rpl3", 3, TRUE);

    moveable = GlobalAlloc(GMEM_MOVEABLE, 100);
    look("sel", "moveable-locked", SELECTOROF(GlobalLock(moveable)), TRUE);
    GlobalUnlock(moveable);

    fixed = GlobalAlloc(GMEM_FIXED, 100);
    look("sel", "fixed", SELECTOROF(GlobalLock(fixed)), TRUE);
    GlobalUnlock(fixed);

    discardable = GlobalAlloc(GMEM_MOVEABLE | GMEM_DISCARDABLE, 1000);
    look("sel", "discardable", SELECTOROF(GlobalLock(discardable)), TRUE);
    GlobalUnlock(discardable);

    big = GlobalAlloc(GMEM_MOVEABLE, 70000L);
    look("sel", "big", SELECTOROF(GlobalLock(big)), TRUE);
    GlobalUnlock(big);

    freed = GlobalAlloc(GMEM_FIXED, 100);
    selector = SELECTOROF(GlobalLock(freed));
    GlobalUnlock(freed);
    GlobalFree(freed);
    look("sel", "freed", selector, TRUE);

    look("code", "user", SELECTOROF((FARPROC)GetProcAddress(GetModuleHandle("USER"), "GetFocus")),
         FALSE);

    GlobalFree(moveable);
    GlobalFree(fixed);
    GlobalFree(discardable);
    GlobalFree(big);
    probeFinish();

    return 0;
}
