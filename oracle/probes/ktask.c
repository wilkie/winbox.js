/*
 * KERNEL's small calls about tasks, modules and selectors, each reached by
 * its ordinal through GetProcAddress: what each answers for the probe's
 * own task and module. A selector's or a handle's number is the
 * allocator's: each is recorded by what it is the same as.
 *
 * * `task`: GetCurrentTask's DX; IsTask of the task and of nought; GetTaskDS against the instance; GetCurrentPDB's AX against
 *   TOOLHELP's prefix for the task; GetTaskQueue, SetTaskQueue of 1234h and back; PostEvent and the
 *   events TOOLHELP counts before and after;
 *   SetPriority by 5, back by 5, by 100, by -100 and back to nought.
 * * `kernelpsp`: whether GetCurrentPDB's DX is a prefix (CD 20) too, not
 *   the task's.
 * * `identity`: IsTask of the instance, GetExePtr of the task, and whether
 *   the task is the instance.
 * * `module`: GetExePtr of the instance, the module, a global block, USER's
 *   module, the code segment and 1234h, as the module (`module`),
 *   USER's (`user`), nought or `other`; GetExeVersion; GetAppCompatFlags of
 *   the task; IsSharedSelector of the data segment, of USER's instance and
 *   of a global block.
 * * `memory`: GlobalHandleNoRIP of the data segment against GlobalHandle;
 *   GetFreeMemInfo; LimitEmsPages and GetCurPID.
 * * `debug`: GetWinDebugInfo, SetWinDebugInfo, DiagQuery, and FatalExitHook
 *   of a procedure and back.
 * * `string`: Reserved1 to Reserved5, KERNEL's ordinals 77 to 80 and 87,
 *   given strings: an offset moved for 1 and 2, the string made for 3 and
 *   4, the comparison for 5.
 * * `selector`: SetSelectorBase, SetSelectorLimit and SelectorAccessRights
 *   on a selector from AllocSelector of a fixed block of 1000h bytes, each
 *   answer and what the selector is after; AllocSelectorArray of three,
 *   each's distance from the first, rights, base and limit; AllocAlias of
 *   the block's selector, what DX holds, and its rights, base and limit.
 */

#define PROBE_FLUSH
#include "probe.h"

#include <toolhelp.h>

#define OUTPUT "C:\\ORACLE\\KTASK.OUT"

typedef DWORD(FAR PASCAL *DwordOfVoid)(void);
typedef DWORD(FAR PASCAL *DwordOfWord)(WORD);
typedef DWORD(FAR PASCAL *DwordOfWordWord)(WORD, WORD);
typedef DWORD(FAR PASCAL *DwordOfWordWordWord)(WORD, WORD, WORD);
typedef DWORD(FAR PASCAL *DwordOfWordDword)(WORD, DWORD);
typedef DWORD(FAR PASCAL *DwordOfFar)(LPVOID);
typedef DWORD(FAR PASCAL *DwordOfFarWord)(LPVOID, WORD);
typedef DWORD(FAR PASCAL *DwordOfFarFar)(LPVOID, LPVOID);

DWORD FAR PASCAL GetSelectorBase(UINT);
DWORD FAR PASCAL GetSelectorLimit(UINT);

static HMODULE kernel;
static HINSTANCE self;
static HMODULE module;
static HMODULE user;

static FARPROC entry(UINT ordinal)
{
    return GetProcAddress(kernel, MAKEINTRESOURCE(ordinal));
}

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

/* LAR BX,AX; the flags in AH, the rights in DX. */
extern unsigned long larOf(unsigned selector);
#pragma aux larOf = \
    "xor bx, bx" \
    0x0f 0x02 0xd8 \
    "lahf" \
    "mov dx, bx" \
    parm [ax] value [dx ax] modify [bx];

static void rights(LPSTR out, UINT selector)
{
    unsigned long lar = larOf(selector);

    if ((lar >> 8) & 0x40) {
        wsprintf(out, "%04x", (UINT)(lar >> 16));
    } else {
        lstrcpy(out, "-");
    }
}

static LPCSTR who(UINT value)
{
    if (value == 0) {
        return "0";
    }

    if (value == (UINT)module) {
        return "module";
    }

    if (value == (UINT)user) {
        return "user";
    }

    return "other";
}

static UINT events(void)
{
    TASKENTRY entry;

    entry.dwSize = sizeof(entry);
    TaskFindHandle(&entry, GetCurrentTask());
    return entry.wcEvents;
}

static void tasks(void)
{
    TASKENTRY te;
    DWORD answer;
    WORD pdb;
    WORD top;
    UINT queue;

    answer = ((DwordOfVoid)entry(36))();
    wsprintf(probeResult, "ax=%s,dx=%s", (LPSTR)((WORD)answer == GetCurrentTask() ? "task" : "other"),
             (LPSTR)((WORD)(answer >> 16) == GetCurrentTask() ? "task" : "other"));
    probe("task", "GetCurrentTask", probeResult);

    wsprintf(probeResult, "task=%s,0=%x",
             (LPSTR)((WORD)((DwordOfWord)entry(320))(GetCurrentTask()) == GetCurrentTask() ? "task"
                                                                                           : "other"),
             (WORD)((DwordOfWord)entry(320))(0));
    probe("task", "IsTask", probeResult);

    /* Whether the task is its instance: it is not, on Windows. */
    wsprintf(probeResult, "istask=%x,exeptr=%s,same=%d", (WORD)((DwordOfWord)entry(320))((WORD)self),
             who((WORD)((DwordOfWord)entry(133))(GetCurrentTask())), GetCurrentTask() == (HTASK)self);
    probe("identity", "instance", probeResult);

    answer = ((DwordOfVoid)entry(155))();
    wsprintf(probeResult, "ax=%s,dx=%s", (LPSTR)((WORD)answer == (WORD)self ? "instance" : "other"),
             (LPSTR)((WORD)(answer >> 16) == (WORD)self ? "instance" : "other"));
    probe("task", "GetTaskDS", probeResult);

    te.dwSize = sizeof(te);
    TaskFindHandle(&te, GetCurrentTask());
    answer = ((DwordOfVoid)entry(37))();
    pdb = (WORD)answer;
    top = (WORD)(answer >> 16);
    wsprintf(probeResult, "%s", (LPSTR)(pdb == te.wPSPOffset ? "pdb" : "other"));
    probe("task", "GetCurrentPDB", probeResult);

    /* DX: KERNEL's own prefix, the one DOS made as it started KERNEL. */
    wsprintf(probeResult, "%s",
             (LPSTR)(top == pdb                                                        ? "same"
                     : (larOf(top) >> 8) & 0x40 && *(WORD FAR *)MAKELP(top, 0) == 0x20cd ? "psp"
                                                                                          : "other"));
    probe("kernelpsp", "GetCurrentPDB", probeResult);

    queue = (WORD)((DwordOfWord)entry(35))(0);
    wsprintf(probeResult, "%s", (LPSTR)(queue == te.hQueue && queue ? "toolhelp" : "other"));
    probe("task", "GetTaskQueue", probeResult);

    answer = ((DwordOfWordWord)entry(34))(0, 0x1234);
    wsprintf(probeResult, "%s,then=%x", (LPSTR)((WORD)answer == queue ? "queue" : "other"),
             (WORD)((DwordOfWord)entry(35))(GetCurrentTask()));
    ((DwordOfWordWord)entry(34))(0, queue);
    probe("task", "SetTaskQueue", probeResult);

    wsprintf(probeResult, "before=%u", events());
    answer = ((DwordOfWord)entry(31))(0);
    wsprintf(probeResult + lstrlen(probeResult), ",answer=%s,after=%u",
             (LPSTR)((WORD)answer == GetCurrentTask() ? "task" : "other"), events());
    probe("task", "PostEvent", probeResult);

    wsprintf(probeResult, "%d,%d,%d,%d,%d", (int)(WORD)((DwordOfWordWord)entry(32))(0, 5),
             (int)(WORD)((DwordOfWordWord)entry(32))(0, (WORD)-5),
             (int)(WORD)((DwordOfWordWord)entry(32))(0, 100),
             (int)(WORD)((DwordOfWordWord)entry(32))(0, (WORD)-100),
             (int)(WORD)((DwordOfWordWord)entry(32))(0, 32));
    probe("task", "SetPriority", probeResult);
}

static void modules(void)
{
    HGLOBAL block = GlobalAlloc(GMEM_MOVEABLE, 64);
    HINSTANCE userInstance = LoadLibrary("USER");
    DwordOfWord getExePtr = (DwordOfWord)entry(133);
    DwordOfWord isShared = (DwordOfWord)entry(345);

    wsprintf(probeResult, "instance=%s,module=%s,block=%s,user=%s,code=%s,1234=%s",
             who((WORD)getExePtr((WORD)self)), who((WORD)getExePtr((WORD)module)),
             who((WORD)getExePtr((WORD)block)), who((WORD)getExePtr((WORD)user)),
             who((WORD)getExePtr(ourCS())), who((WORD)getExePtr(0x1234)));
    probe("module", "GetExePtr", probeResult);

    wsprintf(probeResult, "%x", (WORD)((DwordOfVoid)entry(105))());
    probe("module", "GetExeVersion", probeResult);

    wsprintf(probeResult, "%lx", ((DwordOfWord)entry(354))(0));
    probe("module", "GetAppCompatFlags", probeResult);

    wsprintf(probeResult, "data=%u,user=%u,block=%u", (WORD)isShared(ourDS()),
             (WORD)isShared((WORD)userInstance), (WORD)isShared((WORD)block));
    probe("module", "IsSharedSelector", probeResult);

    FreeLibrary(userInstance);
    GlobalFree(block);
}

static void memory(void)
{
    wsprintf(probeResult, "%s", (LPSTR)(((DwordOfWord)entry(159))(ourDS()) == GlobalHandle(ourDS())
                                           ? "same"
                                           : "other"));
    probe("memory", "GlobalHandleNoRIP", probeResult);

    wsprintf(probeResult, "%lx", ((DwordOfVoid)entry(316))());
    probe("memory", "GetFreeMemInfo", probeResult);

    wsprintf(probeResult, "%lx", ((DwordOfWordWord)entry(156))(100, 0));
    probe("memory", "LimitEmsPages", probeResult);

    wsprintf(probeResult, "%lx", ((DwordOfWordWord)entry(157))(0, 0));
    probe("memory", "GetCurPID", probeResult);
}

BOOL FAR PASCAL __export Hook(LPSTR text)
{
    (void)text;
    return 0;
}

static void debugs(void)
{
    BYTE buffer[64];
    DwordOfFar hook = (DwordOfFar)entry(318);
    FARPROC proc = MakeProcInstance((FARPROC)Hook, self);
    DWORD first;
    DWORD second;

    wsprintf(probeResult, "%x", (WORD)((DwordOfFarWord)entry(355))(buffer, 0));
    probe("debug", "GetWinDebugInfo", probeResult);

    wsprintf(probeResult, "%x", (WORD)((DwordOfFar)entry(356))(buffer));
    probe("debug", "SetWinDebugInfo", probeResult);

    wsprintf(probeResult, "%x", (WORD)((DwordOfVoid)entry(339))());
    probe("debug", "DiagQuery", probeResult);

    first = hook(proc);
    second = hook((LPVOID)first);
    wsprintf(probeResult, "first=%lx,second=%s", first,
             (LPSTR)(second == (DWORD)proc ? "proc" : "other"));
    probe("debug", "FatalExitHook", probeResult);

    FreeProcInstance(proc);
}

static void strings(void)
{
    static char text[] = "abc\xc0\xe9\xd7z";
    static const struct {
        LPCSTR a;
        LPCSTR b;
    } pairs[] = {
        { "abc", "ABD" }, { "b", "A" }, { "aB", "Ab" }, { "", "" }, { "a", "" },
        { "", "a" },      { "\xc0", "\xe0" }, { "[", "a" }, { "Z", "_" },
    };
    char copy[16];
    LPSTR at;
    int i;

    at = (LPSTR)((DwordOfFar)entry(77))(text);
    wsprintf(probeResult, "%d", (int)(at - (LPSTR)text));
    probe("string", "Reserved1", probeResult);

    at = (LPSTR)((DwordOfFarFar)entry(78))(text, text + 3);
    wsprintf(probeResult, "%d", (int)(at - (LPSTR)text));
    probe("string", "Reserved2", probeResult);

    lstrcpy(copy, text);
    ((DwordOfFar)entry(79))(copy);
    for (i = 0; copy[i]; i++) {
        wsprintf(probeResult + 2 * i, "%02x", (BYTE)copy[i]);
    }
    probe("string", "Reserved3", probeResult);

    lstrcpy(copy, "ABC\xc0\xc9\xd7Z");
    ((DwordOfFar)entry(80))(copy);
    for (i = 0; copy[i]; i++) {
        wsprintf(probeResult + 2 * i, "%02x", (BYTE)copy[i]);
    }
    probe("string", "Reserved4", probeResult);

    probeResult[0] = '\0';

    for (i = 0; i < sizeof(pairs) / sizeof(pairs[0]); i++) {
        wsprintf(probeResult + lstrlen(probeResult), "%d ",
                 (int)(WORD)((DwordOfFarFar)entry(87))((LPVOID)pairs[i].a, (LPVOID)pairs[i].b));
    }

    probe("string", "Reserved5", probeResult);
}

static void describe(LPSTR out, UINT selector, DWORD base)
{
    char lar[8];

    rights(lar, selector);
    wsprintf(out, "lar=%s,base=%lx,limit=%lx", (LPSTR)lar, GetSelectorBase(selector) - base,
             GetSelectorLimit(selector));
}

static void selectors(void)
{
    HGLOBAL block = GlobalAlloc(GMEM_FIXED, 0x1000);
    UINT data = (UINT)((DWORD)GlobalLock(block) >> 16);
    DWORD base = GetSelectorBase(data);
    UINT selector = AllocSelector(data);
    UINT array;
    DWORD answer;
    int i;

    answer = ((DwordOfWordDword)entry(187))(selector, base + 16);
    wsprintf(probeResult, "%s:", (LPSTR)((WORD)answer == selector ? "selector" : "other"));
    describe(probeResult + lstrlen(probeResult), selector, base);
    probe("selector", "SetSelectorBase", probeResult);

    answer = ((DwordOfWordDword)entry(189))(selector, 0x12345L);
    wsprintf(probeResult, "%x:", (WORD)answer);
    describe(probeResult + lstrlen(probeResult), selector, base);
    probe("selector", "SetSelectorLimit", probeResult);

    answer = ((DwordOfWordWordWord)entry(196))(selector, 0, 0);
    wsprintf(probeResult, "get=%x", (WORD)answer);
    answer = ((DwordOfWordWordWord)entry(196))(selector, 1, 0xffff);
    wsprintf(probeResult + lstrlen(probeResult), ",set=%x,then=%x", (WORD)answer,
             (WORD)((DwordOfWordWordWord)entry(196))(selector, 0, 0));
    answer = ((DwordOfWordWordWord)entry(196))(selector, 1, 0x0018);
    wsprintf(probeResult + lstrlen(probeResult), ",code=%x,then=%x", (WORD)answer,
             (WORD)((DwordOfWordWordWord)entry(196))(selector, 0, 0));
    lstrcat(probeResult, ":");
    describe(probeResult + lstrlen(probeResult), selector, base);
    probe("selector", "SelectorAccessRights", probeResult);

    FreeSelector(selector);

    array = (UINT)((DwordOfWord)entry(206))(3);

    for (i = 0; i < 3; i++) {
        wsprintf(probeArgs, "AllocSelectorArray-%d", i);
        wsprintf(probeResult, "%d:", array ? (int)(array + 8 * i - array) : -1);
        describe(probeResult + lstrlen(probeResult), array + 8 * i, 0);
        probe("selector", probeArgs, probeResult);
    }

    for (i = 0; i < 3; i++) {
        FreeSelector(array + 8 * i);
    }

    answer = ((DwordOfWord)entry(172))(data);
    selector = (WORD)answer;
    wsprintf(probeResult, "dx=%s:", (LPSTR)((WORD)(answer >> 16) == data ? "given" : "other"));
    describe(probeResult + lstrlen(probeResult), selector, base);
    probe("selector", "AllocAlias", probeResult);
    FreeSelector(selector);
    GlobalUnlock(block);
    GlobalFree(block);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    kernel = GetModuleHandle("KERNEL");
    self = instance;
    module = GetModuleHandle("KTASK");
    user = GetModuleHandle("USER");

    probeOpen(OUTPUT);

    tasks();
    modules();
    memory();
    debugs();
    strings();
    selectors();

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
