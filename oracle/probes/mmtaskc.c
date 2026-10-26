/*
 * MMSYSTEM's mmTaskCreate, and KERNEL's LoadModule answering the task it
 * started in DX.
 *
 * * `load`: LoadModule of the probe's own program MMTASKCC.EXE
 *   (`mmtaskc.child.c`), which waits a fifth of a second: AX an instance or
 *   not, and
 *   whether DX is a task whose module is MMTASKCC (TOOLHELP's
 *   TaskFindHandle while it is there); LoadModule of a file that is
 *   nowhere: AX, and DX.
 * * `create`: mmTaskCreate of a procedure of the probe's, with 12345678h:
 *   the answer; then, once the procedure (through its instance thunk) has
 *   run, what it found -- the double word, whether its task is the one
 *   mmTaskCreate gave, its task's module's name -- and whether that task
 *   is gone after.
 * * `none`: mmTaskCreate with no place for the task: the answer, and the
 *   double word the procedure is given.
 */

#define PROBE_FLUSH
#include "probe.h"
#include <toolhelp.h>

#define OUTPUT "C:\\ORACLE\\MMTASKC.OUT"

typedef UINT(FAR PASCAL *TaskCreate)(FARPROC, HTASK FAR *, DWORD);

static volatile int ran;
static DWORD given;
static HTASK seenTask;
static char seenModule[12];
static FARPROC thunk;

/* In the global segment, not on the stack: the procedure runs on the
 * task's stack, whose segment is not the probe's DS. */
static TASKENTRY procEntry;

void FAR PASCAL __export TaskProc(DWORD instance)
{
    given = instance;
    seenTask = GetCurrentTask();
    procEntry.dwSize = sizeof(procEntry);
    TaskFindHandle(&procEntry, seenTask);
    lstrcpy(seenModule, procEntry.szModule);
    ran = 1;
}

static void settle(int times)
{
    MSG message;
    int i;

    for (i = 0; i < times; i++) {
        while (PeekMessage(&message, NULL, 0, 0, PM_REMOVE)) {
            DispatchMessage(&message);
        }

        Yield();
    }
}

static WORD loadDX;

static void load(void)
{
    struct {
        WORD environment;
        LPSTR tail;
        LPVOID show;
        LPVOID reserved;
    } block;
    WORD show[2];
    char tail[2];
    HINSTANCE answer;
    TASKENTRY entry;
    BOOL found;
    int i;

    show[0] = 2;
    show[1] = SW_SHOWNORMAL;
    tail[0] = 0;
    tail[1] = 0x0d;
    block.environment = 0;
    block.tail = tail;
    block.show = show;
    block.reserved = NULL;

    answer = LoadModule("MMTASKCC.EXE", &block);
    _asm mov loadDX, dx

    entry.dwSize = sizeof(entry);
    found = TaskFindHandle(&entry, (HTASK)loadDX);
    wsprintf(probeResult, "ax=%s,dx=%s", (LPSTR)((UINT)answer >= 32 ? "instance" : "error"),
             (LPSTR)(found && !lstrcmp(entry.szModule, "MMTASKCC") ? "task" : "other"));
    probe("load", "MMTASKCC", probeResult);

    for (i = 0; i < 100 && GetModuleHandle("MMTASKCC"); i++) {
        settle(1);
    }

    answer = LoadModule("NOWHERE.EXE", &block);
    _asm mov loadDX, dx
    wsprintf(probeResult, "ax=%x,dx=%x", (UINT)answer, loadDX);
    probe("load", "NOWHERE", probeResult);
}

static void create(void)
{
    TaskCreate taskCreate =
        (TaskCreate)GetProcAddress(GetModuleHandle("MMSYSTEM"), "mmTaskCreate");
    HTASK task = 0;
    UINT answer;
    int i;

    ran = 0;
    answer = taskCreate(thunk, &task, 0x12345678L);
    wsprintf(probeResult, "%x,task=%s", answer, (LPSTR)(task ? "some" : "0"));
    probe("create", "answer", probeResult);

    for (i = 0; i < 200 && !ran; i++) {
        settle(1);
    }

    wsprintf(probeResult, "ran=%d,given=%lx,task=%s,module=%s", ran, given,
             (LPSTR)(seenTask == task ? "created" : "other"), (LPSTR)seenModule);
    probe("create", "proc", probeResult);

    for (i = 0; i < 100 && IsTask(task); i++) {
        settle(1);
    }

    wsprintf(probeResult, "%s", (LPSTR)(IsTask(task) ? "running" : "gone"));
    probe("create", "after", probeResult);
}

static void none(void)
{
    TaskCreate taskCreate =
        (TaskCreate)GetProcAddress(GetModuleHandle("MMSYSTEM"), "mmTaskCreate");
    UINT answer;
    int i;

    ran = 0;
    answer = taskCreate(thunk, NULL, 1L);
    wsprintf(probeResult, "%x", answer);
    probe("none", "answer", probeResult);

    for (i = 0; i < 200 && !ran; i++) {
        settle(1);
    }

    wsprintf(probeResult, "ran=%d,given=%lx", ran, given);
    probe("none", "proc", probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    probeOpen(OUTPUT);
    thunk = MakeProcInstance((FARPROC)TaskProc, instance);

    load();
    create();
    none();

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
