/*
 * A self-loading program: its header's flags have 0800h (`build-probes.mjs`
 * sets the bit, `PROBE_SELF_LOADING`), and its first segment starts with
 * the loader's table KERNEL reads (`KRNL386.EXE` seg2 `1ea6`): `A0`, then
 * far pointers to its boot procedure and to the procedure that loads a
 * segment, and the places KERNEL fills with its own. Watcom puts the table
 * at the segment's start, and nothing in the first segment refers to the
 * others: KERNEL loads it, with its relocations, before the loader runs.
 *
 * The loader is the least it can be. `Boot` gives each segment but the
 * first a block of nothing through KERNEL's `MyAlloc` -- a handle with no
 * memory -- owned by the module (`SetOwner`), and loads none of them.
 * `Load` gives a segment's block its size (the data segment's with the
 * stack and the heap the header asks for), reads its bytes from the file at
 * its sector, and marks it in the segment table loaded; none of the
 * segments has relocations. Without a file's handle (FFFFh) it opens the
 * program's own file. Each writes what it saw into the code segment, through
 * an alias, and the program reads it back once it runs.
 *
 * Segment 1 is the code, segment 2 a far variable no code refers to
 * (`later`, 1234h), segment 3 the data.
 *
 * * `boot`: how many times `Boot` was called; whether its module was the
 *   program's (`GetModuleHandle`); whether its file's handle was open (a
 *   seek from where it was answered); whether ES was the first segment.
 * * `table`: the pointer KERNEL wrote at 0Ch -- its offset in hexadecimal,
 *   and whether the word it points at is `GlobalMasterHandle`'s selector;
 *   whether those at 10h, 14h and 24h were written, and all in one segment.
 * * `segments`: each segment's flags in the table as `Boot` found them, in
 *   hexadecimal, and whether it had a handle -- the first's the code's
 *   selector less one.
 * * `myalloc`: what `MyAlloc` answered for the far variable's segment, a
 *   block of nothing: `sel=0,handle` for no selector in AX and a handle in
 *   DX, `sel=handle+1` for the selector one more than the handle, or the
 *   two. `SetOwner` is given the handle.
 * * `load`: each call of `Load`, in order: the segment's number and its
 *   file's handle -- `none` for FFFFh, `open`, or `closed` where a seek
 *   failed (it then answers nought, loading nothing).
 * * `later`: the far variable read through its segment's handle, which
 *   `Load` had not been asked for: in hexadecimal.
 * * `entry`: whether KERNEL's `EntryAddrProc` for USER's ordinal 1 is
 *   `GetProcAddress`'s answer.
 * * `exit`: a record the table's exit procedure writes, if it is called.
 */

#define PROBE_SELF_LOADING
#define PROBE_FLUSH
#include "probe.h"

#pragma off(check_stack)

#define OUTPUT "C:\\ORACLE\\SELFLD.OUT"

#define SIGNATURE 0x3041
#define NO_FILE 0xffff
#define LOADED 0x0004
#define ALLOCATED 0x0002
#define CALLS 8

/* KERNEL's, which Watcom's headers do not declare (ordinals 170 and 28). */
UINT WINAPI AllocCSToDSAlias(UINT selector);
DWORD WINAPI GlobalMasterHandle(void);

typedef DWORD(FAR PASCAL *MYALLOC)(WORD flags, WORD size, WORD shift);
typedef DWORD(FAR PASCAL *ENTRYADDR)(HANDLE module, WORD ordinal);
typedef void(FAR PASCAL *SETOWNER)(WORD selector, HANDLE owner);

/* The table, as `KRNL386.EXE` seg2 `1ee6`-`1f2c` reads and writes it. */
typedef struct {
    WORD signature;
    WORD reserved;
    FARPROC boot;
    FARPROC load;
    WORD FAR *heap;
    MYALLOC myAlloc;
    ENTRYADDR entryAddr;
    FARPROC exitProc;
    WORD unused[4];
    SETOWNER setOwner;
} LoaderTable;

/* What the loader saw, kept in the code segment. */
typedef struct {
    WORD boots;
    WORD module;
    WORD fileOpen;
    WORD es;
    WORD flags[4];
    WORD handles[4];
    WORD allocSelector;
    WORD allocHandle;
    WORD calls;
    WORD callSegment[CALLS];
    WORD callFile[CALLS];
} Seen;

WORD FAR PASCAL Boot(HANDLE module, HFILE file);
WORD FAR PASCAL Load(HANDLE module, HFILE file, WORD segment);
void FAR PASCAL Leave(void);

LoaderTable __based(__segname("_CODE")) table = {
    SIGNATURE, 0, (FARPROC)Boot, (FARPROC)Load, 0, 0, 0, (FARPROC)Leave, {0, 0, 0, 0}, 0};

Seen __based(__segname("_CODE")) seen = {0};

/* Strings the loader passes KERNEL, in the code segment: an initialised
 * local array would be copied from the data segment through DS, which is not
 * the program's while the loader runs. */
const char __based(__segname("_CODE")) outputPath[] = OUTPUT;
const char __based(__segname("_CODE")) exitLine[] = "exit\t\tcalled\r\n";

/* Segment 2: nothing refers to it. */
int __far later = 0x1234;

static WORD currentCs(void)
{
    WORD value;

    _asm {
        mov ax, cs
        mov value, ax
    }

    return value;
}

/* SS: the loader runs on KERNEL's caller's stack with DS not its own, so a
 * far pointer to a local is made with SS, never the DS the compiler takes. */
static WORD currentSs(void)
{
    WORD value;

    _asm {
        mov ax, ss
        mov value, ax
    }

    return value;
}

static LoaderTable volatile FAR *loaderTable(void)
{
    return (LoaderTable volatile FAR *)MAKELP(currentCs(), (WORD)&table);
}

/* `seen`, writable: through an alias of the code segment, freed after. */
static Seen volatile FAR *seenThrough(WORD alias)
{
    return (Seen volatile FAR *)MAKELP(alias, (WORD)&seen);
}

static WORD entryOf(HANDLE module, WORD segment)
{
    return *(WORD FAR *)MAKELP(module, 0x22) + (segment - 1) * 10;
}

WORD FAR PASCAL Boot(HANDLE module, HFILE file)
{
    WORD alias;
    WORD esValue;
    WORD count;
    WORD i;
    Seen volatile FAR *out;
    LoaderTable volatile FAR *t = loaderTable();

    _asm {
        mov ax, es
        mov esValue, ax
    }

    alias = AllocCSToDSAlias(currentCs());
    out = seenThrough(alias);
    out->boots++;
    out->module = (WORD)module;
    out->fileOpen = _llseek(file, 0L, 1) != HFILE_ERROR;
    out->es = esValue;
    count = *(WORD FAR *)MAKELP(module, 0x1c);

    for (i = 0; i < count && i < 4; i++) {
        WORD entry = entryOf(module, i + 1);

        out->flags[i] = *(WORD FAR *)MAKELP(module, entry + 4);
        out->handles[i] = *(WORD FAR *)MAKELP(module, entry + 8);
    }

    /* Each segment but the first a handle with no memory, the module's. */
    for (i = 2; i <= count; i++) {
        WORD entry = entryOf(module, i);
        DWORD given = t->myAlloc(*(WORD FAR *)MAKELP(module, entry + 4), 0, 0);

        if (i == 2) {
            out->allocSelector = LOWORD(given);
            out->allocHandle = HIWORD(given);
        }

        t->setOwner(HIWORD(given), module);
        *(WORD FAR *)MAKELP(module, entry + 8) = HIWORD(given);
    }

    FreeSelector(alias);
    /* What `LoadModule` goes on with: below 20h it is an error's number
     * (`KRNL386.EXE` seg2 `1652`-`1658`), and nothing else reads it. The
     * first segment's selector, 20h or more in Windows and in WinBox. */
    return currentCs();
}

WORD FAR PASCAL Load(HANDLE module, HFILE file, WORD segment)
{
    WORD alias;
    WORD entry = entryOf(module, segment);
    WORD sector = *(WORD FAR *)MAKELP(module, entry);
    WORD length = *(WORD FAR *)MAKELP(module, entry + 2);
    WORD flags = *(WORD FAR *)MAKELP(module, entry + 4);
    WORD minimum = *(WORD FAR *)MAKELP(module, entry + 6);
    WORD handle = *(WORD FAR *)MAKELP(module, entry + 8);
    WORD shift = *(WORD FAR *)MAKELP(module, 0x32);
    DWORD size = minimum;
    WORD state;
    HFILE opened = HFILE_ERROR;
    Seen volatile FAR *out;
    char path[128];


    if (file == (HFILE)NO_FILE) {
        LPSTR at = (LPSTR)MAKELP(currentSs(), (WORD)path);

        state = 0;
        GetModuleFileName(module, at, sizeof(path));
        opened = _lopen(at, OF_READ);
        file = opened;
    } else {
        state = _llseek(file, 0L, 1) == HFILE_ERROR ? 2 : 1;
    }

    alias = AllocCSToDSAlias(currentCs());
    out = seenThrough(alias);

    if (out->calls < CALLS) {
        out->callSegment[out->calls] = segment;
        out->callFile[out->calls] = state;
        out->calls++;
    }

    FreeSelector(alias);

    if (state == 2) {
        return 0;
    }

    if (segment == *(WORD FAR *)MAKELP(module, 0x0e)) {
        size += *(WORD FAR *)MAKELP(module, 0x12) + *(WORD FAR *)MAKELP(module, 0x10);
    }

    handle = (WORD)GlobalReAlloc((HGLOBAL)handle, size, GMEM_MOVEABLE);
    _llseek(file, (LONG)sector << shift, 0);
    _lread(file, MAKELP(handle | 1, 0), length);

    if (opened != HFILE_ERROR) {
        _lclose(opened);
    }

    *(WORD FAR *)MAKELP(module, entry + 8) = handle;
    *(WORD FAR *)MAKELP(module, entry + 4) = flags | LOADED | ALLOCATED;
    return handle;
}

/* The exit procedure: a record, if KERNEL ever calls it. */
void FAR PASCAL Leave(void)
{
    HFILE out = _lopen((LPSTR)MAKELP(currentCs(), (WORD)outputPath), OF_WRITE);

    _llseek(out, 0L, 2);
    _lwrite(out, (LPSTR)MAKELP(currentCs(), (WORD)exitLine), sizeof(exitLine) - 1);
    _lclose(out);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HMODULE module;
    HMODULE user;
    WORD code;
    WORD i;
    Seen volatile FAR *in;
    LoaderTable volatile FAR *t;
    WORD FAR *heap;
    WORD master;

    probeOpen(OUTPUT);
    module = GetModuleHandle("SELFLD");
    code = currentCs();
    in = (Seen volatile FAR *)MAKELP(code, (WORD)&seen);
    t = loaderTable();

    wsprintf(probeResult, "calls=%d,module=%s,file=%s,es=%s", in->boots,
             in->module == (WORD)module ? (LPSTR) "same" : (LPSTR) "other",
             in->fileOpen ? (LPSTR) "open" : (LPSTR) "closed",
             in->es == code ? (LPSTR) "first" : (LPSTR) "other");
    probe("boot", "", probeResult);

    heap = t->heap;
    master = HIWORD(GlobalMasterHandle());
    wsprintf(probeResult, "heap=%x,%s,procs=%s,%s", LOWORD((DWORD)heap),
             heap && *heap == master ? (LPSTR) "master" : (LPSTR) "other",
             t->myAlloc && t->entryAddr && t->setOwner ? (LPSTR) "written" : (LPSTR) "missing",
             HIWORD((DWORD)t->myAlloc) == HIWORD((DWORD)t->entryAddr) &&
                     HIWORD((DWORD)t->myAlloc) == HIWORD((DWORD)t->setOwner)
                 ? (LPSTR) "one segment"
                 : (LPSTR) "apart");
    probe("table", "", probeResult);

    for (i = 0; i < 3; i++) {
        WORD handle = in->handles[i];

        wsprintf(probeArgs, "%d", i + 1);
        wsprintf(probeResult, "%04x %s", in->flags[i],
                 handle == 0              ? (LPSTR) "none"
                 : handle + 1 == code     ? (LPSTR) "cs-1"
                                          : (LPSTR) "other");
        probe("segments", probeArgs, probeResult);
    }

    if (in->allocSelector == in->allocHandle + 1) {
        lstrcpy(probeResult, "sel=handle+1");
    } else if (in->allocSelector == 0 && in->allocHandle != 0) {
        lstrcpy(probeResult, "sel=0,handle");
    } else {
        wsprintf(probeResult, "%04x %04x", in->allocSelector, in->allocHandle);
    }

    probe("myalloc", "", probeResult);

    {
        WORD handle = *(WORD FAR *)MAKELP(module, entryOf(module, 2) + 8);
        int value = *(int FAR *)MAKELP(handle | 1, 0);

        probeResult[0] = '\0';

        for (i = 0; i < in->calls; i++) {
            wsprintf(probeResult + lstrlen(probeResult), i ? ",%d:%s" : "%d:%s",
                     in->callSegment[i],
                     in->callFile[i] == 0   ? (LPSTR) "none"
                     : in->callFile[i] == 1 ? (LPSTR) "open"
                                            : (LPSTR) "closed");
        }

        probe("load", "", probeResult);

        wsprintf(probeResult, "%x", value);
        probe("later", "", probeResult);
    }

    user = GetModuleHandle("USER");
    probe("entry", "USER 1",
          t->entryAddr(user, 1) == (DWORD)GetProcAddress(user, MAKEINTRESOURCE(1))
              ? "same"
              : "other");

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
