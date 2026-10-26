/*
 * TOOLHELP's views of the heaps: GlobalInfo, GlobalEntryHandle,
 * GlobalEntryModule, the walk of GlobalFirst and GlobalNext, LocalInfo,
 * and the walk of LocalFirst and LocalNext.
 *
 * Where a block is, and which selector or handle it has, is the
 * allocator's: each is recorded by what it is the same as.
 *
 * * `ginfo`: GlobalInfo's answer, whether it counts any blocks, and with
 *   a wrong size.
 * * `gentry`: GlobalEntryHandle of a moveable block of 100 bytes, locked
 *   and not, a fixed one, a shared one, the probe's data and code
 *   segments, its module, and of 1234h: the answer; whether
 *   the address is the selector's base; the size, the lock counts and the
 *   flags; whether a local heap is in it; the owner as the probe's task
 *   (`task`), module (`module`) or `other`; the type and its datum. Of
 *   the module, only the answer, the address, the block, the owner and the
 *   type: what KERNEL keeps for a module is its own.
 * * `gtask`: the same of the task.
 * * `gmodule`: GlobalEntryModule of the probe's segments 0 to 3, the same
 *   fields, and whether the block is the segment's.
 * * `gwalk`: the walk of GlobalFirst and GlobalNext for all blocks: the
 *   first and the last entry's type, and whether it meets the moveable
 *   block and the data segment; and with a wrong size.
 * * `linfo`: LocalInfo of the probe's data segment, and with a wrong size.
 * * `lwalk`: the walk of LocalFirst and LocalNext of the probe's data
 *   segment after three blocks are made and one freed: each entry's
 *   handle (`addr` where it is the block's address), address, size,
 *   flags, lock count, type, heap (`ds`), heap type; and with a wrong size.
 * * `lsystem`: LocalFirst of USER's heap and of GDI's, from
 *   SystemHeapInfo: the answer and the heap type.
 */

#include "probe.h"

#include <toolhelp.h>

#define OUTPUT "C:\\ORACLE\\THHEAP.OUT"

DWORD FAR PASCAL GetSelectorBase(UINT);

static HMODULE module;

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

static LPCSTR ownerOf(HGLOBAL owner)
{
    if (owner == (HGLOBAL)GetCurrentTask()) {
        return "task";
    }

    if (owner == (HGLOBAL)module) {
        return "module";
    }

    return owner ? "other" : "0";
}

static void describe(LPSTR out, BOOL answer, GLOBALENTRY FAR *entry, HGLOBAL handle)
{
    if (entry->wType == GT_MODULE || entry->wType == GT_TASK) {
        wsprintf(out, "%d:base=%d,block=%s,owner=%s,type=%u", answer,
                 entry->dwAddress == GetSelectorBase(GlobalHandleToSel(entry->hBlock)),
                 (LPSTR)(entry->hBlock == handle                   ? "same"
                         : (UINT)entry->hBlock == (UINT)handle + 1 ? "plus1"
                         : (UINT)entry->hBlock + 1 == (UINT)handle ? "minus1"
                                                                   : "other"),
                 ownerOf(entry->hOwner), entry->wType);
        return;
    }

    wsprintf(out,
             "%d:base=%d,size=%lx,block=%d,lock=%u,pagelock=%u,flags=%x,heap=%d,owner=%s,"
             "type=%u,data=%u",
             answer, entry->dwAddress == GetSelectorBase(GlobalHandleToSel(entry->hBlock)),
             entry->dwBlockSize, entry->hBlock == handle, entry->wcLock, entry->wcPageLock,
             entry->wFlags, entry->wHeapPresent, ownerOf(entry->hOwner), entry->wType,
             entry->wData);
}

static void entryOf(LPCSTR function, LPCSTR name, HGLOBAL handle)
{
    GLOBALENTRY entry;
    BOOL answer;

    entry.dwSize = sizeof(entry);
    answer = GlobalEntryHandle(&entry, handle);

    if (answer) {
        describe(probeResult, answer, &entry, handle);
    } else {
        lstrcpy(probeResult, "0");
    }

    probe(function, name, probeResult);
}

static void entry(LPCSTR name, HGLOBAL handle)
{
    entryOf("gentry", name, handle);
}

static void globals(HGLOBAL moveable)
{
    GLOBALINFO info;
    GLOBALENTRY ge;
    HGLOBAL fixed = GlobalAlloc(GMEM_FIXED, 100);
    HGLOBAL shared = GlobalAlloc(GMEM_MOVEABLE | GMEM_SHARE, 100);
    BOOL answer;
    BOOL more;
    UINT first = 0xffff;
    UINT last = 0xffff;
    BOOL metBlock = FALSE;
    BOOL metData = FALSE;
    UINT segment;
    long count = 0;

    info.dwSize = sizeof(info);
    answer = GlobalInfo(&info);
    wsprintf(probeResult, "%d:items=%d", answer, info.wcItems > 0);
    probe("ginfo", "info", probeResult);

    info.dwSize = sizeof(info) + 2;
    wsprintf(probeResult, "%d", GlobalInfo(&info));
    probe("ginfo", "size", probeResult);

    entry("moveable", moveable);
    GlobalLock(moveable);
    entry("moveable-locked", moveable);
    GlobalUnlock(moveable);
    entry("fixed", fixed);
    entry("shared", shared);
    entry("data", (HGLOBAL)GlobalHandle(ourDS()));
    entry("code", (HGLOBAL)GlobalHandle(ourCS()));
    entry("module", (HGLOBAL)module);
    entryOf("gtask", "task", (HGLOBAL)GetCurrentTask());
    entry("1234", (HGLOBAL)0x1234);

    for (segment = 0; segment <= 3; segment++) {
        ge.dwSize = sizeof(ge);
        answer = GlobalEntryModule(&ge, module, segment);
        wsprintf(probeArgs, "%u", segment);

        if (answer) {
            describe(probeResult, answer, &ge,
                     segment == 1 ? (HGLOBAL)GlobalHandle(ourCS())
                                  : (HGLOBAL)GlobalHandle(ourDS()));
        } else {
            lstrcpy(probeResult, "0");
        }

        probe("gmodule", probeArgs, probeResult);
    }

    ge.dwSize = sizeof(ge);

    for (more = GlobalFirst(&ge, GLOBAL_ALL); more && count < 20000;
         more = GlobalNext(&ge, GLOBAL_ALL), count++) {
        if (first == 0xffff) {
            first = ge.wType;
        }

        last = ge.wType;
        metBlock |= ge.hBlock == moveable;
        metData |= ge.hBlock == (HGLOBAL)GlobalHandle(ourDS());
    }

    wsprintf(probeResult, "first=%u,last=%u,block=%d,data=%d", first, last, metBlock, metData);
    probe("gwalk", "all", probeResult);

    ge.dwSize = sizeof(ge) - 4;
    wsprintf(probeResult, "%d", GlobalFirst(&ge, GLOBAL_ALL));
    probe("gwalk", "size", probeResult);

    GlobalFree(fixed);
    GlobalFree(shared);
}

static void locals(void)
{
    LOCALINFO info;
    LOCALENTRY entry;
    SYSHEAPINFO system;
    HLOCAL fixed = LocalAlloc(LMEM_FIXED, 10);
    HLOCAL moveable = LocalAlloc(LMEM_MOVEABLE, 20);
    HLOCAL gone = LocalAlloc(LMEM_FIXED, 30);
    BOOL answer;
    BOOL more;
    int count = 0;

    LocalLock(moveable);
    LocalFree(gone);

    info.dwSize = sizeof(info);
    answer = LocalInfo(&info, (HGLOBAL)ourDS());
    wsprintf(probeResult, "%d:items=%u", answer, info.wcItems);
    probe("linfo", "ds", probeResult);

    info.dwSize = sizeof(info) + 2;
    wsprintf(probeResult, "%d", LocalInfo(&info, (HGLOBAL)ourDS()));
    probe("linfo", "size", probeResult);

    entry.dwSize = sizeof(entry);

    for (more = LocalFirst(&entry, (HGLOBAL)ourDS()); more && count < 100;
         more = LocalNext(&entry), count++) {
        wsprintf(probeArgs, "%d", count);
        wsprintf(probeResult,
                 "handle=%s,address=%x,size=%x,flags=%u,lock=%u,type=%u,heap=%s,heaptype=%u",
                 (LPSTR)(entry.hHandle == (HLOCAL)entry.wAddress ? "addr"
                         : entry.hHandle == moveable              ? "moveable"
                                                                  : "other"),
                 entry.wAddress, entry.wSize, entry.wFlags, entry.wcLock, entry.wType,
                 (LPSTR)(entry.hHeap == ourDS() ? "ds" : "other"), entry.wHeapType);
        probe("lwalk", probeArgs, probeResult);
    }

    system.dwSize = sizeof(system);
    SystemHeapInfo(&system);

    entry.dwSize = sizeof(entry);
    answer = LocalFirst(&entry, system.hUserSegment);
    wsprintf(probeResult, "%d:heaptype=%u", answer, entry.wHeapType);
    probe("lsystem", "user", probeResult);

    entry.dwSize = sizeof(entry);
    answer = LocalFirst(&entry, system.hGDISegment);
    wsprintf(probeResult, "%d:heaptype=%u", answer, entry.wHeapType);
    probe("lsystem", "gdi", probeResult);

    entry.dwSize = sizeof(entry) - 2;
    wsprintf(probeResult, "%d", LocalFirst(&entry, (HGLOBAL)ourDS()));
    probe("lwalk", "size", probeResult);

    LocalUnlock(moveable);
    LocalFree(moveable);
    LocalFree(fixed);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HGLOBAL moveable;

    module = GetModuleHandle("THHEAP");
    moveable = GlobalAlloc(GMEM_MOVEABLE, 100);

    probeOpen(OUTPUT);

    globals(moveable);
    locals();

    GlobalFree(moveable);
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
