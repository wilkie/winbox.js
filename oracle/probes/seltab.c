/*
 * KERNEL's selector table, as a program reaches it through THHOOK (KERNEL
 * ordinal 332): the length at 22Eh, the place at 230h in the global
 * heap's own block (THHOOK's 21Ah), one entry of four bytes for each eight
 * selector values. Director's projectors count the entries that are not
 * nought this way, to know how many selectors are in use.
 *
 * * `thhook`: 22Eh, 230h, the heap's block's limit, and whether the table
 *   ends inside it.
 * * `count`: the entries that are not nought, counted as Director counts
 *   them (a selector of the probe's own over the table): whether there are
 *   any, and fewer than 7000 (`range`); then the count's change after each
 *   of: a moveable block allocated, freed; a block of 128 KiB (two
 *   selectors) allocated, freed; AllocSelector, FreeSelector.
 * * `entry`: the entry of the probe's DS, its CS, a moveable block, the
 *   second selector of the 128 KiB block, a block freed, a selector of
 *   AllocSelector's, the heap's own block, nought where it is: and where
 *   it is not, what the arena it points to holds, as TOOLHELP reads one
 *   (TOOLHELP.DLL seg1 060f): +08h the block's base, +0Ch its size, +10h
 *   its handle, +12h its owner, +14h its lock count, +16h its flags;
 *   whether the entry is an offset in the heap's own block (else it is
 *   read as linear), and whether it is a multiple of 20h.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\SELTAB.OUT"

DWORD FAR PASCAL GetSelectorBase(UINT);
DWORD FAR PASCAL GetSelectorLimit(UINT);
UINT FAR PASCAL SetSelectorBase(UINT, DWORD);
UINT FAR PASCAL SetSelectorLimit(UINT, DWORD);

typedef DWORD(FAR PASCAL *DwordOfVoid)(void);

static HMODULE kernel;
static WORD heapSelector;
static WORD tableLength;
static DWORD tableStart;
static WORD reader;

static UINT ourDS(void)
{
    UINT value;

    _asm mov value, ds
    return value;
}

static UINT ourCS(void)
{
    UINT value;

    _asm mov value, cs
    return value;
}

/* Bytes at a linear address, through a selector of the probe's own. */
static void readLinear(DWORD linear, void FAR *to, WORD count)
{
    BYTE FAR *from;
    BYTE FAR *into = (BYTE FAR *)to;
    WORD at;

    SetSelectorBase(reader, linear);
    SetSelectorLimit(reader, 0xffffL);
    from = (BYTE FAR *)MAKELP(reader, 0);

    for (at = 0; at < count; at++) {
        into[at] = from[at];
    }
}

/* The table's entry for a selector; nought past the table. */
static DWORD entryOf(WORD selector)
{
    WORD offset = (selector & ~7) >> 1;
    DWORD value = 0;

    if (offset >= tableLength) {
        return 0;
    }

    readLinear(GetSelectorBase(heapSelector) + tableStart + offset, &value, 4);
    return value;
}

/* The entries that are not nought, counted as Director's projector counts
 * them: a selector over the table, its limit the table's length. */
static WORD countEntries(void)
{
    DWORD FAR *table;
    WORD at;
    WORD count = 0;

    SetSelectorBase(reader, GetSelectorBase(heapSelector) + tableStart);
    SetSelectorLimit(reader, (DWORD)tableLength);
    table = (DWORD FAR *)MAKELP(reader, 0);

    for (at = 0; at < tableLength / 4; at++) {
        if (table[at] != 0) {
            count++;
        }
    }

    return count;
}

static void thhookWords(void)
{
    WORD FAR *words = (WORD FAR *)GetProcAddress(kernel, MAKEINTRESOURCE(332));
    DWORD limit;

    heapSelector = words[1];
    tableLength = words[0x16 / 2];
    tableStart = *(DWORD FAR *)&words[0x18 / 2];
    limit = GetSelectorLimit(heapSelector);

    wsprintf(probeResult, "%x", tableLength);
    probe("thhook", "22e length", probeResult);
    wsprintf(probeResult, "%lx", tableStart);
    probe("thhook", "230 start", probeResult);
    wsprintf(probeResult, "%lx", limit);
    probe("thhook", "heap block limit", probeResult);
    wsprintf(probeResult, "%s", (LPSTR)(tableStart + tableLength <= limit + 1 ? "yes" : "no"));
    probe("thhook", "table inside the heap block", probeResult);
    wsprintf(probeResult, "%ld", (long)(limit + 1 - (tableStart + tableLength)));
    probe("thhook", "bytes past the table", probeResult);
}

static void counts(void)
{
    WORD before = countEntries();
    WORD after;
    HGLOBAL block;
    HGLOBAL big;
    UINT selector;

    wsprintf(probeResult, "any=%s,below-7000=%s", (LPSTR)(before ? "yes" : "no"),
             (LPSTR)(before < 7000 ? "yes" : "no"));
    probe("count", "range", probeResult);

    block = GlobalAlloc(GMEM_MOVEABLE, 100);
    after = countEntries();
    wsprintf(probeResult, "%d", (int)(after - before));
    probe("count", "moveable allocated", probeResult);
    before = after;
    GlobalFree(block);
    after = countEntries();
    wsprintf(probeResult, "%d", (int)(after - before));
    probe("count", "moveable freed", probeResult);

    before = countEntries();
    big = GlobalAlloc(GMEM_MOVEABLE, 0x20000L);
    after = countEntries();
    wsprintf(probeResult, "%d", (int)(after - before));
    probe("count", "128k allocated", probeResult);
    before = after;
    GlobalFree(big);
    after = countEntries();
    wsprintf(probeResult, "%d", (int)(after - before));
    probe("count", "128k freed", probeResult);

    before = countEntries();
    selector = AllocSelector(ourDS());
    after = countEntries();
    wsprintf(probeResult, "%d", (int)(after - before));
    probe("count", "AllocSelector", probeResult);
    before = after;
    FreeSelector(selector);
    after = countEntries();
    wsprintf(probeResult, "%d", (int)(after - before));
    probe("count", "FreeSelector", probeResult);
}

/* What an arena holds, against what the probe knows of the block. */
static void arena(LPCSTR what, WORD selector, HGLOBAL handle)
{
    DWORD at = entryOf(selector);
    BYTE bytes[0x20];
    DWORD heapBase = GetSelectorBase(heapSelector);
    DWORD heapLimit = GetSelectorLimit(heapSelector);
    BOOL inside;
    WORD owner;
    WORD pdb = GetCurrentPDB();
    char ownerName[16];

    if (at == 0) {
        probe("entry", what, "nought");
        return;
    }

    /* An offset in the heap's own block where it falls inside it, as
     * KERNEL reads one with DS that block (seg1 297c); else linear. */
    inside = at + sizeof bytes <= heapLimit + 1;
    readLinear(inside ? heapBase + at : at, bytes, sizeof bytes);
    owner = *(WORD *)&bytes[0x12];

    if (owner == pdb) {
        lstrcpy(ownerName, "pdb");
    } else if (owner == (WORD)GetModuleHandle("SELTAB")) {
        lstrcpy(ownerName, "module");
    } else if (owner == (WORD)GetCurrentTask()) {
        lstrcpy(ownerName, "task");
    } else {
        wsprintf(ownerName, "%x", owner);
    }

    wsprintf(probeResult,
             "place=%s,aligned=%s,base=%s,size=%s,handle=%s,owner=%s,locks=%u,pagelocks=%u,flags=%x",
             (LPSTR)(inside ? "heap-block-offset" : "linear"), (LPSTR)((at & 0x1f) == 0 ? "20h" : "no"),
             (LPSTR)(*(DWORD *)&bytes[8] == GetSelectorBase(selector) ? "selector's" : "other"),
             (LPSTR)(handle == 0 ? "-" : *(DWORD *)&bytes[0xc] == GlobalSize(handle) ? "GlobalSize" : "other"),
             (LPSTR)(handle == 0 ? "-" : *(WORD *)&bytes[0x10] == (WORD)handle ? "handle" : "other"),
             (LPSTR)ownerName, bytes[0x14], bytes[0x15], bytes[0x16]);
    probe("entry", what, probeResult);
}

static void entries(void)
{
    HGLOBAL block = GlobalAlloc(GMEM_MOVEABLE, 100);
    HGLOBAL big = GlobalAlloc(GMEM_MOVEABLE, 0x20000L);
    HGLOBAL gone = GlobalAlloc(GMEM_MOVEABLE, 100);
    WORD bigSelector = HIWORD(GlobalHandle(HIWORD((DWORD)GlobalLock(big))));
    WORD goneSelector = HIWORD((DWORD)GlobalLock(gone));
    UINT own = AllocSelector(ourDS());
    DWORD second;

    GlobalUnlock(big);
    GlobalUnlock(gone);
    GlobalFree(gone);

    arena("ds", ourDS(), GlobalHandle(ourDS()));
    arena("cs", ourCS(), GlobalHandle(ourCS()));
    arena("moveable", HIWORD(GlobalHandle((UINT)block)), block);
    second = entryOf(bigSelector + 8);
    wsprintf(probeResult, "%s", (LPSTR)(second == 0 ? "nought" : second == entryOf(bigSelector) ? "first's" : "other"));
    probe("entry", "128k second selector", probeResult);
    arena("freed", goneSelector, 0);
    arena("AllocSelector", own, 0);
    arena("heap block", heapSelector, 0);

    FreeSelector(own);
    GlobalFree(big);
    GlobalFree(block);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    probeOpen(OUTPUT);
    kernel = GetModuleHandle("KERNEL");
    reader = AllocSelector(ourDS());

    thhookWords();
    counts();
    entries();

    FreeSelector(reader);
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
