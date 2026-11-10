/*
 * A program's data segment's limit, and its code segment's: what KERNEL's
 * loader makes them. KERNEL allocates a segment its minimum allocation and
 * two bytes, and the data segment its stack and its heap more (`KRNL386.EXE`
 * seg1 `7678`-`76a7`); the global heap rounds the block. Recorded in each
 * mode (`record.mjs --mode enhanced`).
 *
 * * `header`: the probe's own data segment's minimum allocation, its stack
 *   and its heap, from its file's header, and their sum with two.
 * * `ds`: `LSL` of DS, `GetSelectorLimit` of it and `GlobalSize` of its
 *   handle, in hexadecimal; then the same after a `LocalAlloc` the heap has
 *   no room for, which grows the segment.
 * * `cs`: `LSL` of CS, and its segment's length and minimum allocation from
 *   the file's header.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\DSLIMIT.OUT"

DWORD FAR PASCAL GetSelectorLimit(UINT);

static UINT ourDS(void)
{
    UINT value = 0;

    _asm {
        mov ax, ds
        mov value, ax
    }

    return value;
}

static UINT ourCS(void)
{
    UINT value = 0;

    _asm {
        mov ax, cs
        mov value, ax
    }

    return value;
}

static UINT limitOf(UINT selector)
{
    UINT limit = 0;

    _asm {
        mov bx, selector
        xor cx, cx
        db 0fh, 03h, 0cbh /* lsl cx, bx */
        mov limit, cx
    }

    return limit;
}

static void data(LPCSTR when)
{
    UINT ds = ourDS();

    wsprintf(probeResult, "lsl=%04x limit=%lx size=%lx", limitOf(ds), GetSelectorLimit(ds),
             GlobalSize(GlobalHandle(ds)));
    probe("ds", when, probeResult);
}

/* A word of the program's own file. */
static UINT wordAt(HFILE file, LONG offset)
{
    UINT value = 0;

    _llseek(file, offset, 0);
    _lread(file, &value, 2);
    return value;
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    char path[128];
    HFILE file;
    LONG ne;
    LONG table;
    UINT automatic, heap, stack, code, minimum, codeLength, codeMinimum;
    HLOCAL block;

    probeOpen(OUTPUT);

    /* The file's header: `NE` at the word at 3Ch; the automatic data
     * segment's number at 0Eh, the heap at 10h, the stack at 12h, CS at
     * 16h, the segment table's offset at 22h; each entry eight bytes, its
     * length at 2 and its minimum allocation at 6. */
    GetModuleFileName(instance, path, sizeof(path));
    file = _lopen(path, OF_READ);
    ne = (LONG)wordAt(file, 0x3cL);
    table = ne + (LONG)wordAt(file, ne + 0x22);
    automatic = wordAt(file, ne + 0x0e);
    heap = wordAt(file, ne + 0x10);
    stack = wordAt(file, ne + 0x12);
    code = wordAt(file, ne + 0x16);
    minimum = wordAt(file, table + 8L * (automatic - 1) + 6);
    codeLength = wordAt(file, table + 8L * (code - 1) + 2);
    codeMinimum = wordAt(file, table + 8L * (code - 1) + 6);
    _lclose(file);

    wsprintf(probeResult, "minimum=%x stack=%x heap=%x sum=%lx", minimum, stack, heap,
             (DWORD)minimum + 2 + stack + heap);
    probe("header", "data", probeResult);

    data("start");
    block = LocalAlloc(LMEM_FIXED, 0x3000);
    wsprintf(probeArgs, "after LocalAlloc 3000h (%s)", (LPSTR)(block ? "given" : "refused"));
    data(probeArgs);

    wsprintf(probeResult, "lsl=%04x length=%x minimum=%x", limitOf(ourCS()), codeLength,
             codeMinimum);
    probe("cs", "start", probeResult);

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
