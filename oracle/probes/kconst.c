/*
 * KERNEL's exports that are numbers rather than functions: `__AHSHIFT`,
 * `__AHINCR`, `__WINFLAGS`, and the selectors for the first megabyte's
 * fixed places, `__0000H`, `__0040H`, `__A000H`, `__B000H`, `__B800H`,
 * `__C000H`, `__D000H`, `__E000H`, `__F000H` and `__ROMBIOS`. The file
 * holds each as a constant entry (segment FEh) of the real-mode paragraph;
 * KERNEL makes the selectors as it starts.
 *
 * * `proc`: `GetProcAddress` of KERNEL's ordinal: for a number the whole
 *   double word; for a selector its high word, its table (bit 2: `ldt` or
 *   `gdt`) and its privilege -- which selector it is is the allocator's.
 * * `sel`: for each selector, its base less `__0000H`'s, as KERNEL's
 *   `GetSelectorBase` gives them -- where the first megabyte is in linear
 *   memory is the machine's -- its limit, and the access rights `LAR`
 *   reads (`-` refused).
 * * `order`: the selectors from the lowest number up, by the paragraph
 *   they are for, and whether each is 8 above the one before (`adjacent`).
 * * `same`: the selectors that are the same number as another of them.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\KCONST.OUT"

DWORD FAR PASCAL GetSelectorBase(UINT);
DWORD FAR PASCAL GetSelectorLimit(UINT);

/* LAR BX,AX; the flags in AH, the rights in DX. */
extern unsigned long larOf(unsigned selector);
#pragma aux larOf = \
    "xor bx, bx" \
    0x0f 0x02 0xd8 \
    "lahf" \
    "mov dx, bx" \
    parm [ax] value [dx ax] modify [bx];

#define ZERO(flags) (((flags) >> 8) & 0x40)

static const struct {
    UINT ordinal;
    LPCSTR name;
    BOOL selector;
} constants[] = {
    { 113, "__AHSHIFT", FALSE },
    { 114, "__AHINCR", FALSE },
    { 178, "__WINFLAGS", FALSE },
    { 183, "__0000H", TRUE },
    { 193, "__0040H", TRUE },
    { 174, "__A000H", TRUE },
    { 181, "__B000H", TRUE },
    { 182, "__B800H", TRUE },
    { 195, "__C000H", TRUE },
    { 179, "__D000H", TRUE },
    { 190, "__E000H", TRUE },
    { 194, "__F000H", TRUE },
    { 173, "__ROMBIOS", TRUE },
};

#define COUNT (sizeof(constants) / sizeof(constants[0]))

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HMODULE kernel = GetModuleHandle("KERNEL");
    UINT values[COUNT];
    BOOL taken[COUNT];
    DWORD first = 0;
    BOOL based = FALSE;
    UINT previousValue = 0;
    BOOL adjacent = TRUE;
    UINT i;
    UINT j;

    probeOpen(OUTPUT);

    for (i = 0; i < COUNT; i++) {
        DWORD address = (DWORD)GetProcAddress(kernel, MAKEINTRESOURCE(constants[i].ordinal));

        values[i] = (UINT)address;
        taken[i] = FALSE;

        if (constants[i].selector) {
            wsprintf(probeResult, "%04x,%s,rpl=%u", (UINT)(address >> 16),
                     (LPSTR)(values[i] & 4 ? "ldt" : "gdt"), values[i] & 3);
        } else {
            wsprintf(probeResult, "%08lx", address);
        }

        probe("proc", constants[i].name, probeResult);
    }

    for (i = 0; i < COUNT; i++) {
        unsigned long lar;
        char rights[8];

        if (!constants[i].selector) {
            continue;
        }

        if (!based) {
            based = TRUE;
            first = GetSelectorBase(values[i]);
        }

        lar = larOf(values[i]);

        if (ZERO(lar)) {
            wsprintf(rights, "%04x", (unsigned)(lar >> 16));
        } else {
            lstrcpy(rights, "-");
        }

        wsprintf(probeResult, "base=%lx,limit=%lx,lar=%s", GetSelectorBase(values[i]) - first,
                 GetSelectorLimit(values[i]), (LPSTR)rights);
        probe("sel", constants[i].name, probeResult);
    }

    /* From the lowest up, `__ROMBIOS` left out: it is `__F000H`'s. */
    probeResult[0] = '\0';

    for (;;) {
        UINT lowest = COUNT;

        for (i = 0; i < COUNT - 1; i++) {
            if (constants[i].selector && !taken[i] &&
                (lowest == COUNT || values[i] < values[lowest])) {
                lowest = i;
            }
        }

        if (lowest == COUNT) {
            break;
        }

        if (probeResult[0] && values[lowest] != previousValue + 8) {
            adjacent = FALSE;
        }

        taken[lowest] = TRUE;
        previousValue = values[lowest];
        lstrcat(probeResult, constants[lowest].name);
        lstrcat(probeResult, " ");
    }

    lstrcat(probeResult, adjacent ? "adjacent" : "apart");
    probe("order", "selectors", probeResult);

    for (i = 0; i < COUNT; i++) {
        for (j = 0; j < i; j++) {
            if (constants[i].selector && constants[j].selector && values[i] == values[j]) {
                wsprintf(probeArgs, "%s", constants[i].name);
                wsprintf(probeResult, "%s", constants[j].name);
                probe("same", probeArgs, probeResult);
            }
        }
    }

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
