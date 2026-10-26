/*
 * KERNEL's resource handlers: the procedure `LoadResource` calls for each
 * type, which `SetResourceHandler` changes; and `AllocResource` and
 * `DirectResAlloc`, which a handler makes a resource's block with. The
 * probe's resources (`reshand.rc`): RCDATA 1 and 2, type 300 number 300,
 * and type MYTYPE named NAMED.
 *
 * * `set`: SetResourceHandler of RCDATA: the handler it had -- whether its
 *   selector is KERNEL's code's (FatalExit's), and its offset; again, the
 *   probe's handler back; of a type the probe has none of (RT_BITMAP),
 *   nought; then of type 300 and of MYTYPE by name.
 * * `load`: LoadResource of RCDATA 1, the probe's handler calling the one
 *   it replaced: what the handler was given (the block, nought or not; the
 *   instance, or its module as GetExePtr gives it; the resource's handle),
 *   whether LoadResource answers what the
 *   handler did, and the bytes; again, whether the handler is called; after
 *   FreeResource, again, the block it is given against the first.
 * * `own`: LoadResource of type 300 and of MYTYPE, whose handler makes a
 *   block of its own and fills it: the handler's calls by LoadResource and
 *   by LockResource after it; the answer against the block the handler was
 *   given and the one it made; GlobalFlags of the answer; the bytes; and the
 *   size of the block made, after.
 * * `alloc`: AllocResource of RCDATA 2, with a size of nought and of 100:
 *   GlobalSize, GlobalFlags, and whether the handle is a selector's.
 * * `direct`: DirectResAlloc with flags 0 and 1030h, 64 bytes: GlobalSize
 *   and GlobalFlags.
 */

#define PROBE_FLUSH
#include "probe.h"

#define OUTPUT "C:\\ORACLE\\RESHAND.OUT"

typedef HGLOBAL(FAR PASCAL *Handler)(HGLOBAL, HINSTANCE, HRSRC);
typedef DWORD(FAR PASCAL *DwordOfWord)(WORD);
typedef HGLOBAL(FAR PASCAL *AllocRes)(HINSTANCE, HRSRC, DWORD);
typedef HGLOBAL(FAR PASCAL *DirectRes)(HINSTANCE, WORD, WORD);
typedef DWORD(FAR PASCAL *SetHandler)(HINSTANCE, LPCSTR, FARPROC);

static HINSTANCE self;
static HMODULE kernel;
static Handler before;
static int calls;
static HGLOBAL givenBlock;
static HINSTANCE givenInstance;
static HRSRC givenResource;
static HGLOBAL made;

static FARPROC entry(UINT ordinal)
{
    return GetProcAddress(kernel, MAKEINTRESOURCE(ordinal));
}

HGLOBAL FAR PASCAL __export Chained(HGLOBAL block, HINSTANCE instance, HRSRC resource)
{
    calls++;
    givenBlock = block;
    givenInstance = instance;
    givenResource = resource;
    made = before(block, instance, resource);
    return made;
}

HGLOBAL FAR PASCAL __export Own(HGLOBAL block, HINSTANCE instance, HRSRC resource)
{
    HGLOBAL mine = GlobalAlloc(GMEM_MOVEABLE, 16);
    LPSTR text = GlobalLock(mine);

    calls++;
    lstrcpy(text, "made here");
    givenBlock = block;
    GlobalUnlock(mine);
    made = mine;
    (void)block;
    (void)instance;
    (void)resource;
    return mine;
}

static void set(void)
{
    SetHandler setHandler = (SetHandler)entry(67);
    DWORD old;
    WORD kernelCode = (WORD)((DWORD)entry(1) >> 16);

    old = setHandler(self, RT_RCDATA, (FARPROC)Chained);
    before = (Handler)old;
    wsprintf(probeResult, "sel=%s,off=%x", (LPSTR)((WORD)(old >> 16) == kernelCode ? "kernel" : "other"),
             (WORD)old);
    probe("set", "rcdata", probeResult);

    old = setHandler(self, RT_RCDATA, (FARPROC)Chained);
    wsprintf(probeResult, "%s", (LPSTR)(old == (DWORD)(FARPROC)Chained ? "chained" : "other"));
    probe("set", "rcdata-again", probeResult);

    wsprintf(probeResult, "%lx", setHandler(self, RT_BITMAP, (FARPROC)Chained));
    probe("set", "bitmap", probeResult);

    old = setHandler(self, MAKEINTRESOURCE(300), (FARPROC)Own);
    wsprintf(probeResult, "%s", (LPSTR)((WORD)(old >> 16) == kernelCode ? "kernel" : "other"));
    probe("set", "300", probeResult);

    old = setHandler(self, "MYTYPE", (FARPROC)Own);
    wsprintf(probeResult, "%s", (LPSTR)((WORD)(old >> 16) == kernelCode ? "kernel" : "other"));
    probe("set", "mytype", probeResult);
}

static void load(void)
{
    HRSRC found = FindResource(self, MAKEINTRESOURCE(1), RT_RCDATA);
    HGLOBAL loaded;
    HGLOBAL first;
    LPSTR text;

    calls = 0;
    loaded = LoadResource(self, found);
    text = LockResource(loaded);
    wsprintf(probeResult, "calls=%d,block=%s,instance=%s,resource=%s,answer=%s,text=%s", calls,
             (LPSTR)(givenBlock ? "some" : "0"), (LPSTR)(givenInstance == self                        ? "self"
                     : givenInstance == (HINSTANCE)(WORD)((DwordOfWord)entry(133))((WORD)self) ? "module"
                                                                    : "other"),
             (LPSTR)(givenResource == found ? "found" : "other"),
             (LPSTR)(loaded == made ? "made" : "other"), text ? text : (LPSTR) "-");
    probe("load", "first", probeResult);
    UnlockResource(loaded);
    first = loaded;

    calls = 0;
    loaded = LoadResource(self, found);
    wsprintf(probeResult, "calls=%d,same=%s", calls, (LPSTR)(loaded == first ? "yes" : "no"));
    probe("load", "again", probeResult);

    FreeResource(loaded);
    FreeResource(loaded);

    calls = 0;
    givenBlock = 0;
    loaded = LoadResource(self, found);
    text = LockResource(loaded);
    wsprintf(probeResult, "calls=%d,block=%s,same=%s,text=%s", calls,
             (LPSTR)(givenBlock == first ? "first" : givenBlock ? "other" : "0"),
             (LPSTR)(loaded == first ? "yes" : "no"), text ? text : (LPSTR) "-");
    probe("load", "freed", probeResult);
    UnlockResource(loaded);
    FreeResource(loaded);
}

/* One resource of a type whose handler makes its own block: LoadResource's
 * answer against the block the handler was given and the one it made, the
 * handler's calls before and after LockResource, the bytes, and the block
 * made after. */
static void ownOne(LPCSTR name, HRSRC found)
{
    HGLOBAL loaded;
    LPSTR text;
    int loading;
    WORD flags;

    calls = 0;
    givenBlock = 0;
    made = 0;
    loaded = LoadResource(self, found);
    loading = calls;
    flags = GlobalFlags(loaded);
    text = LockResource(loaded);
    wsprintf(probeResult,
             "calls=%d,%d,answer=%s,given=%s,flags=%x,text=%s,made-size=%lx", loading, calls,
             (LPSTR)(loaded == made                  ? "made"
                     : loaded == givenBlock && loaded ? "given"
                                                      : "other"),
             (LPSTR)(givenBlock ? "some" : "0"), flags, text ? text : (LPSTR) "-",
             made ? GlobalSize(made) : 0L);
    probe("own", name, probeResult);
    UnlockResource(loaded);
}

static void own(void)
{
    ownOne("300", FindResource(self, MAKEINTRESOURCE(300), MAKEINTRESOURCE(300)));
    ownOne("mytype", FindResource(self, "NAMED", "MYTYPE"));
}

static void alloc(void)
{
    AllocRes allocRes = (AllocRes)entry(66);
    HRSRC found = FindResource(self, MAKEINTRESOURCE(2), RT_RCDATA);
    HGLOBAL block;

    block = allocRes(self, found, 0);
    wsprintf(probeResult, "size=%lx,flags=%x,odd=%d,res=%x", GlobalSize(block), GlobalFlags(block),
             (WORD)block & 1, SizeofResource(self, found));
    probe("alloc", "0", probeResult);
    GlobalFree(block);

    block = allocRes(self, found, 100);
    wsprintf(probeResult, "size=%lx,flags=%x,odd=%d", GlobalSize(block), GlobalFlags(block),
             (WORD)block & 1);
    probe("alloc", "100", probeResult);
    GlobalFree(block);
}

static void direct(void)
{
    DirectRes directRes = (DirectRes)entry(168);
    HGLOBAL block;

    block = directRes(self, 0, 64);
    wsprintf(probeResult, "size=%lx,flags=%x,odd=%d", GlobalSize(block), GlobalFlags(block),
             (WORD)block & 1);
    probe("direct", "0", probeResult);
    GlobalFree(block);

    block = directRes(self, 0x1030, 64);
    wsprintf(probeResult, "size=%lx,flags=%x,odd=%d", GlobalSize(block), GlobalFlags(block),
             (WORD)block & 1);
    probe("direct", "1030", probeResult);
    GlobalFree(block);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    self = instance;
    kernel = GetModuleHandle("KERNEL");

    probeOpen(OUTPUT);

    set();
    load();
    own();
    alloc();
    direct();

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
