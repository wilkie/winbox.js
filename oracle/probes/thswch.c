/*
 * TOOLHELP's TaskSetCSIP and TaskSwitch: a task sent somewhere else. The
 * probe starts THSWCHC.EXE (`thswch.child.c`), which posts it the
 * address of its procedure `Jumped` and then waits without end; `Jumped`
 * writes `child jumped <mode>` and ends the program.
 *
 * * `set`: the program waiting in GetMessage (mode 1). TaskGetCSIP of it;
 *   TaskSetCSIP of it to `Jumped`: whether the answer is what TaskGetCSIP
 *   gave; TaskGetCSIP after, whether `Jumped`; TaskSetCSIP of the probe's
 *   own task, and of 1234h. Then a message posted to the program's task:
 *   whether it went to `Jumped` (its record) and ended.
 * * `switch`: the program giving the processor up with Yield (mode 2),
 *   half a second after it started.
 *   TaskSwitch to `Jumped`: the answer, after the program's record; that
 *   it ended; TaskSwitch of the probe's own task, and of 1234h.
 */

#define PROBE_FLUSH
#include "probe.h"
#include <toolhelp.h>

#define OUTPUT "C:\\ORACLE\\THSWCH.OUT"

static DWORD jumped;
static HTASK child;

LRESULT CALLBACK __export Proc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_USER + 1) {
        jumped = (DWORD)lParam;
        return 0;
    }

    return DefWindowProc(window, message, wParam, lParam);
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

/* The program's task: the task of THSWCHC's module. */
static HTASK childTask(void)
{
    TASKENTRY entry;
    BOOL more;

    entry.dwSize = sizeof(entry);

    for (more = TaskFirst(&entry); more; more = TaskNext(&entry)) {
        if (!lstrcmp(entry.szModule, "THSWCHC")) {
            return entry.hTask;
        }
    }

    return 0;
}

/* The probe's file closed while the program may write to it, and opened
 * again after. */
static void quiet(void)
{
    _lclose(probeHandle);
    probeHandle = HFILE_ERROR;
}

static void loud(void)
{
    probeHandle = _lopen(probePath, OF_WRITE);
    _llseek(probeHandle, 0L, 2);
}

static void start(LPCSTR line)
{
    int i;

    jumped = 0;
    WinExec(line, SW_SHOWNORMAL);

    for (i = 0; i < 200 && !jumped; i++) {
        settle(1);
    }

    child = childTask();
}

static void ended(LPCSTR name)
{
    int i;

    for (i = 0; i < 200 && GetModuleHandle("THSWCHC"); i++) {
        settle(1);
    }

    wsprintf(probeResult, "%s", (LPSTR)(GetModuleHandle("THSWCHC") ? "running" : "ended"));
    probe(name, "ended", probeResult);
}

static void set(void)
{
    DWORD before;
    DWORD answer;

    start("THSWCHC.EXE 1");
    before = TaskGetCSIP(child);

    answer = TaskSetCSIP(child, (WORD)(jumped >> 16), (WORD)jumped);
    wsprintf(probeResult, "%s,%s", (LPSTR)(answer == before ? "before" : "other"),
             (LPSTR)(answer ? "set" : "0"));
    probe("set", "TaskSetCSIP", probeResult);

    answer = TaskGetCSIP(child);
    wsprintf(probeResult, "%s", (LPSTR)(answer == jumped ? "jumped" : "other"));
    probe("set", "TaskGetCSIP-after", probeResult);

    wsprintf(probeResult, "%lx", TaskSetCSIP(GetCurrentTask(), 0x1234, 0x5678));
    probe("set", "own", probeResult);

    quiet();
    PostAppMessage(child, WM_USER, 0, 0L);
    ended("set-quiet");
    loud();
    ended("set");
}

static void taskSwitch(void)
{
    DWORD answer;

    start("THSWCHC.EXE 2");

    /* Half a second, so that the program is giving the processor up. */
    {
        DWORD begun = GetTickCount();

        while (GetTickCount() - begun < 500) {
            settle(1);
        }
    }

    quiet();
    answer = TaskSwitch(child, jumped);
    loud();

    wsprintf(probeResult, "%x", (WORD)answer);
    probe("switch", "TaskSwitch", probeResult);
    ended("switch");

    wsprintf(probeResult, "%x", (WORD)TaskSwitch(GetCurrentTask(), jumped));
    probe("switch", "own", probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;

    probeOpen(OUTPUT);

    kind.style = 0;
    kind.lpfnWndProc = Proc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = NULL;
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "THSwchP";
    RegisterClass(&kind);
    CreateWindow("THSwchP", "Probe", WS_OVERLAPPEDWINDOW, 0, 0, 100, 100, NULL, NULL, instance,
                 NULL);

    set();
    taskSwitch();

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
