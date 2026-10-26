/*
 * TOOLHELP's walks of the tasks, the modules and the window classes; its
 * stack trace; MemoryRead and MemoryWrite; TimerCount and MemManInfo; and
 * TaskGetCSIP and TerminateApp on a program of the probe's own,
 * THTASKC.EXE (`thtask.child.c`), which waits in its message loop.
 *
 * What a selector or a handle is, is the allocator's: each is recorded by
 * what it is the same as -- the probe's task, instance, module, queue,
 * prefix -- not its number.
 *
 * * `task`: TaskFirst's answer and the walk of TaskNext, each entry the
 *   probe's own (`self`) or not, with its fields as relations -- not its
 *   parent, which for the shell is a handle `IsTask` refuses; then
 *   TaskFindHandle of the probe's task, of 1234h, and with a wrong size.
 * * `child`: the walk again with THTASKC running: the order of the two,
 *   and the child's fields; TaskGetCSIP of it and of the probe; after
 *   TerminateApp of it with NO_UAE_BOX, IsTask of it, the walk's count and
 *   whether its window is there.
 * * `module`: ModuleFirst's first name; whether the walk reaches the
 *   probe's own module -- which others there are, and in what order, is
 *   the installation's; ModuleFindName of `USER` and of `user`;
 *   ModuleFindHandle of the probe's module -- its file's name, not where
 *   it is -- of nought, and with a wrong size.
 * * `class`: the walk of ClassFirst and ClassNext: each class's name, `*`
 *   after it where its instance is the probe's; and with a wrong size.
 * * `stack`: StackTraceCSIPFirst from a function two calls in, and each
 *   frame of StackTraceNext after it: its kind, whether its code is the
 *   probe's, its segment number, its module, and its BP less the first.
 * * `memory`: MemoryRead and MemoryWrite of a block of 100 bytes from
 *   GlobalAlloc, at offsets in it, at its end and past it; and of the
 *   probe's own code segment.
 * * `timer`: TimerCount's answer, whether its two counts are equal, and
 *   whether its count is from GetTickCount before it up to 55 above
 *   GetTickCount after it; and with a wrong size.
 * * `memman`: MemManInfo's answer and its page size, with dwSize nought.
 */

#include "probe.h"

#include <toolhelp.h>
#include <string.h>

#define OUTPUT "C:\\ORACLE\\THTASK.OUT"

typedef BOOL(FAR PASCAL *IsTaskProc)(HTASK);
typedef HANDLE(FAR PASCAL *GetTaskQueueProc)(HTASK);
typedef UINT(FAR PASCAL *GetCurrentPDBProc)(void);

static IsTaskProc isTask;
static GetTaskQueueProc getTaskQueue;
static GetCurrentPDBProc getCurrentPDB;
static HINSTANCE self;

static UINT ourSS(void)
{
    UINT value;

    _asm mov value, ss
    return value;
}

static UINT ourCS(void)
{
    UINT value;

    _asm mov value, cs
    return value;
}

static UINT ourBP(void)
{
    UINT value;

    _asm mov value, bp
    return value;
}

static LPCSTR same(BOOL equal)
{
    return equal ? "same" : "other";
}

/* A task entry's fields, as relations to the task `task` of instance `inst`. */
static void describeTask(LPSTR out, TASKENTRY FAR *entry, HTASK task, HINSTANCE inst,
                         HMODULE module, HTASK parent)
{
    wsprintf(out,
             "inst=%s,module=%s,ss=%s,top=%x,min=%x,bottom=%x,events=%u,queue=%s,name=%s,"
             "psp=%s,parent=%s",
             same(entry->hInst == inst), same(entry->hModule == module),
             (LPSTR)(entry->wSS == ((UINT)inst | 1) ? "inst+1" : "other"), entry->wStackTop,
             entry->wStackMinimum, entry->wStackBottom, entry->wcEvents,
             (LPSTR)(entry->hQueue == 0 ? "0" : same(entry->hQueue == getTaskQueue(task))),
             (LPSTR)entry->szModule,
             (LPSTR)(task == GetCurrentTask() ? same(entry->wPSPOffset == getCurrentPDB())
                                              : "-"),
             (LPSTR)(parent == 0 ? "-" : entry->hTaskParent == 0 ? "0"
                     : entry->hTaskParent == parent ? "same"
                     : isTask(entry->hTaskParent)   ? "task"
                                                    : "other"));
}

static int walkTasks(HTASK child, LPSTR order)
{
    TASKENTRY entry;
    int count = 0;
    BOOL more;

    order[0] = '\0';
    entry.dwSize = sizeof(entry);

    for (more = TaskFirst(&entry); more; more = TaskNext(&entry)) {
        count++;
        lstrcat(order, entry.hTask == GetCurrentTask() ? "self "
                       : entry.hTask == child           ? "child "
                                                        : "other ");

        if (entry.hTask == GetCurrentTask() && !child) {
            describeTask(probeResult, &entry, GetCurrentTask(), self, GetModuleHandle("THTASK"),
                         0);
            probe("task", "self", probeResult);
        }

        if (entry.hTask == child && child) {
            HWND window = FindWindow("ThTaskC", NULL);

            describeTask(probeResult, &entry, child,
                         (HINSTANCE)GetWindowWord(window, GWW_HINSTANCE),
                         GetModuleHandle("THTASKC"), GetCurrentTask());
            probe("child", "entry", probeResult);
        }

        if (count > 50) {
            break;
        }
    }

    wsprintf(probeResult, "%s%s", (LPSTR)(entry.hNext == 0 ? "last " : "next "), order);

    return count;
}

static void tasks(void)
{
    TASKENTRY entry;
    char order[200];
    HWND window = NULL;
    HTASK child;
    DWORD csip;
    int count;
    int i;

    count = walkTasks(0, order);
    wsprintf(probeArgs, "%d", count);
    probe("task", "walk", probeResult);

    entry.dwSize = sizeof(entry);
    wsprintf(probeResult, "%d", TaskFindHandle(&entry, GetCurrentTask()));

    if (entry.hTask == GetCurrentTask()) {
        lstrcat(probeResult, ":");
        describeTask(probeResult + lstrlen(probeResult), &entry, GetCurrentTask(), self,
                     GetModuleHandle("THTASK"), 0);
    }

    probe("task", "find-self", probeResult);

    wsprintf(probeResult, "%d", TaskFindHandle(&entry, (HTASK)0x1234));
    probe("task", "find-1234", probeResult);

    entry.dwSize = sizeof(entry) - 1;
    wsprintf(probeResult, "%d", TaskFindHandle(&entry, GetCurrentTask()));
    probe("task", "find-size", probeResult);

    WinExec("THTASKC.EXE", SW_SHOWNORMAL);

    for (i = 0; i < 200 && !window; i++) {
        MSG msg;

        window = FindWindow("ThTaskC", NULL);

        while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
            DispatchMessage(&msg);
        }

        Yield();
    }

    if (!window) {
        probe("child", "started", "no");
        return;
    }

    child = GetWindowTask(window);
    count = walkTasks(child, order);
    probe("child", "walk", probeResult);

    csip = TaskGetCSIP(child);
    probe("child", "csip", csip ? "nonzero" : "0");

    wsprintf(probeResult, "%lx", TaskGetCSIP(GetCurrentTask()));
    probe("child", "csip-self", probeResult);

    TerminateApp(child, NO_UAE_BOX);

    for (i = 0; i < 50; i++) {
        Yield();
    }

    wsprintf(probeResult, "istask=%d,window=%d", isTask(child), FindWindow("ThTaskC", NULL) != NULL);
    probe("child", "terminated", probeResult);

    count = walkTasks(0, order);
    wsprintf(probeArgs, "%d", count);
    probe("child", "walk-after", probeResult);
}

/* A path's file: what follows its last backslash. Where the probe is run
 * from is the machine's. */
static LPSTR fileOf(LPSTR path)
{
    LPSTR file = path;

    for (; *path; path++) {
        if (*path == '\\') {
            file = path + 1;
        }
    }

    return file;
}

static void modules(void)
{
    MODULEENTRY entry;
    BOOL more;
    BOOL seen = FALSE;
    HMODULE found;
    int count = 0;

    entry.dwSize = sizeof(entry);
    more = ModuleFirst(&entry);
    wsprintf(probeResult, "%d:%s", more, (LPSTR)entry.szModule);
    probe("module", "first", probeResult);


    for (; more && count < 100; more = ModuleNext(&entry), count++) {
        if (entry.hModule == GetModuleHandle("THTASK")) {
            seen = TRUE;
        }
    }

    wsprintf(probeResult, "%d", seen);
    probe("module", "walk-self", probeResult);

    entry.dwSize = sizeof(entry);
    found = ModuleFindName(&entry, "USER");
    wsprintf(probeResult, "%s,name=%s,path=%s", same(found == GetModuleHandle("USER")),
             (LPSTR)entry.szModule, (LPSTR)entry.szExePath);
    probe("module", "find-USER", probeResult);

    wsprintf(probeResult, "%d", ModuleFindName(&entry, "user") != NULL);
    probe("module", "find-user", probeResult);

    found = ModuleFindHandle(&entry, GetModuleHandle("THTASK"));
    wsprintf(probeResult, "%s,name=%s,file=%s,usage=%u,module=%s", same(found == GetModuleHandle("THTASK")),
             (LPSTR)entry.szModule, (LPSTR)fileOf(entry.szExePath), entry.wcUsage,
             same(entry.hModule == GetModuleHandle("THTASK")));
    probe("module", "find-self", probeResult);

    wsprintf(probeResult, "%d", ModuleFindHandle(&entry, NULL) != NULL);
    probe("module", "find-0", probeResult);

    entry.dwSize = sizeof(entry) + 1;
    wsprintf(probeResult, "%d", ModuleFirst(&entry));
    probe("module", "first-size", probeResult);
}

LRESULT CALLBACK __export Proc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    return DefWindowProc(window, message, wParam, lParam);
}

static void classes(void)
{
    CLASSENTRY entry;
    WNDCLASS kind;
    BOOL more;
    int count = 0;

    kind.style = 0;
    kind.lpfnWndProc = Proc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = self;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = NULL;
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "ThTaskP";
    RegisterClass(&kind);

    probeResult[0] = '\0';
    entry.dwSize = sizeof(entry);

    for (more = ClassFirst(&entry); more && count < 60; more = ClassNext(&entry), count++) {
        lstrcat(probeResult, entry.szClassName);
        lstrcat(probeResult, entry.hInst == (HMODULE)self ? "* " : " ");
    }

    probe("class", "walk", probeResult);

    entry.dwSize = sizeof(entry) - 2;
    wsprintf(probeResult, "%d", ClassFirst(&entry));
    probe("class", "first-size", probeResult);
}

static void frames(void)
{
    STACKTRACEENTRY entry;
    UINT first;
    int count = 0;
    BOOL more;

    entry.dwSize = sizeof(entry);
    first = ourBP();
    more = StackTraceCSIPFirst(&entry, ourSS(), ourCS(), (UINT)(DWORD)(LPVOID)frames, first);
    wsprintf(probeResult, "%d:task=%s,ss=%s,bp=%x,cs=%s,module=%s,segment=%u,flags=%u", more,
             same(entry.hTask == GetCurrentTask()), same(entry.wSS == ourSS()),
             entry.wBP - first, same(entry.wCS == ourCS()),
             same(entry.hModule == GetModuleHandle("THTASK")), entry.wSegment, entry.wFlags);
    probe("stack", "first", probeResult);

    while (more && count < 20) {
        more = StackTraceNext(&entry);
        count++;
        wsprintf(probeArgs, "next-%d", count);

        if (more) {
            wsprintf(probeResult, "1:bp=%x,cs=%s,module=%s,segment=%u,flags=%u",
                     entry.wBP - first, same(entry.wCS == ourCS()),
                     same(entry.hModule == GetModuleHandle("THTASK")), entry.wSegment,
                     entry.wFlags);
        } else {
            lstrcpy(probeResult, "0");
        }

        probe("stack", probeArgs, probeResult);
    }

    entry.dwSize = sizeof(entry) + 2;
    wsprintf(probeResult, "%d", StackTraceCSIPFirst(&entry, ourSS(), ourCS(), 0, ourBP()));
    probe("stack", "first-size", probeResult);
}

static void middle(void)
{
    frames();
}

static void outer(void)
{
    middle();
}

static void memory(void)
{
    HGLOBAL block = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, 100);
    BYTE FAR *bytes = (BYTE FAR *)GlobalLock(block);
    UINT selector = (UINT)((DWORD)bytes >> 16);
    BYTE buffer[64];
    static const DWORD offsets[] = { 0, 10, 90, 100, 127, 128, 200 };
    DWORD count;
    int i;

    for (i = 0; i < 100; i++) {
        bytes[i] = (BYTE)(i + 1);
    }

    for (i = 0; i < sizeof(offsets) / sizeof(offsets[0]); i++) {
        lstrcpy((LPSTR)buffer, "untouched");
        count = MemoryRead(selector, offsets[i], buffer, 50);
        wsprintf(probeArgs, "read-%lu", offsets[i]);
        wsprintf(probeResult, "%lu:%u", count, buffer[0]);
        probe("memory", probeArgs, probeResult);
    }

    for (i = 0; i < 50; i++) {
        buffer[i] = (BYTE)(0xa0 + i);
    }

    count = MemoryWrite(selector, 60, buffer, 50);
    wsprintf(probeResult, "%lu:%u,%u", count, bytes[60], bytes[99]);
    probe("memory", "write-60", probeResult);

    count = MemoryWrite(selector, 128, buffer, 4);
    wsprintf(probeResult, "%lu", count);
    probe("memory", "write-128", probeResult);

    count = MemoryRead((UINT)(GlobalHandle(selector) & ~1), 0, buffer, 4);
    wsprintf(probeResult, "%lu:%u", count, buffer[0]);
    probe("memory", "read-handle", probeResult);

    count = MemoryRead(ourCS(), 0, buffer, 8);
    wsprintf(probeResult, "%lu:%s", count,
             same(_fmemcmp(buffer, (BYTE FAR *)((DWORD)ourCS() << 16), 8) == 0));
    probe("memory", "read-code", probeResult);

    count = MemoryWrite(ourCS(), 0, buffer, 2);
    wsprintf(probeResult, "%lu:%s", count, same(_fmemcmp(buffer, (BYTE FAR *)((DWORD)ourCS() << 16), 2) == 0));
    probe("memory", "write-code", probeResult);

    count = MemoryRead(0, 0, buffer, 4);
    wsprintf(probeResult, "%lu", count);
    probe("memory", "read-0", probeResult);

    GlobalUnlock(block);
    GlobalFree(block);
}

static void timers(void)
{
    TIMERINFO info;
    BOOL answer;
    DWORD before;
    DWORD after;

    info.dwSize = sizeof(info);
    before = GetTickCount();
    answer = TimerCount(&info);
    after = GetTickCount();
    wsprintf(probeResult, "%d:equal=%d,between=%d", answer, info.dwmsSinceStart == info.dwmsThisVM,
             info.dwmsSinceStart >= before && info.dwmsSinceStart < after + 55);
    probe("timer", "count", probeResult);

    info.dwSize = sizeof(info) + 4;
    wsprintf(probeResult, "%d", TimerCount(&info));
    probe("timer", "size", probeResult);
}

static void memman(void)
{
    MEMMANINFO info;
    BOOL answer;

    info.dwSize = 0;
    info.wPageSize = 0;
    answer = MemManInfo(&info);
    wsprintf(probeResult, "%d:page=%x,size=%lu", answer, info.wPageSize, info.dwSize);
    probe("memman", "info", probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HMODULE kernel = GetModuleHandle("KERNEL");

    self = instance;
    isTask = (IsTaskProc)GetProcAddress(kernel, MAKEINTRESOURCE(320));
    getTaskQueue = (GetTaskQueueProc)GetProcAddress(kernel, MAKEINTRESOURCE(35));
    getCurrentPDB = (GetCurrentPDBProc)GetProcAddress(kernel, MAKEINTRESOURCE(37));

    probeOpen(OUTPUT);

    tasks();
    modules();
    classes();
    outer();
    memory();
    timers();
    memman();

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
