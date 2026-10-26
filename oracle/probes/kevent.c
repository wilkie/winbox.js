/*
 * KERNEL's task events: what PostEvent gives and WaitEvent takes.
 *
 * * `pending`: PostEvent of the probe's own task twice, then WaitEvent
 *   twice: each WaitEvent's answer, and the task's events as TOOLHELP
 *   counts them before and after each.
 * * `child`: the events of a program started from the probe, KEVENTC.EXE
 *   (`kevent.child.c`), as it reads its own first thing in WinMain, after
 *   its start-up: written to the probe's file by it.
 * * `wait`: WaitEvent with none pending, KEVENTC.EXE started first and
 *   told the probe's task, which it posts an event once a timer of its
 *   own has come, writing the probe's events first: the answer,
 *   and the events after.
 */

#define PROBE_FLUSH
#include "probe.h"
#include <toolhelp.h>

#define OUTPUT "C:\\ORACLE\\KEVENT.OUT"

typedef DWORD(FAR PASCAL *DwordOfWord)(WORD);

static HMODULE kernel;

static FARPROC entry(UINT ordinal)
{
    return GetProcAddress(kernel, MAKEINTRESOURCE(ordinal));
}

static UINT events(void)
{
    TASKENTRY entry;

    entry.dwSize = sizeof(entry);
    TaskFindHandle(&entry, GetCurrentTask());
    return entry.wcEvents;
}

static void pending(void)
{
    UINT before;
    UINT answer;

    before = events();
    ((DwordOfWord)entry(31))(0);
    ((DwordOfWord)entry(31))(0);
    wsprintf(probeResult, "before=%u,after=%u", before, events());
    probe("pending", "post-twice", probeResult);

    answer = (UINT)((DwordOfWord)entry(30))(0);
    wsprintf(probeResult, "%x,events=%u", answer, events());
    probe("pending", "wait-1", probeResult);

    answer = (UINT)((DwordOfWord)entry(30))(0);
    wsprintf(probeResult, "%x,events=%u", answer, events());
    probe("pending", "wait-2", probeResult);
}

static void wait(void)
{
    char line[40];
    UINT answer;

    /* The probe's file closed while the program writes to it. */
    _lclose(probeHandle);
    probeHandle = HFILE_ERROR;

    wsprintf(line, "KEVENTC.EXE %x", GetCurrentTask());
    WinExec(line, SW_SHOWNORMAL);

    answer = (UINT)((DwordOfWord)entry(30))(0);

    probeHandle = _lopen(probePath, OF_WRITE);
    _llseek(probeHandle, 0L, 2);

    wsprintf(probeResult, "%x,events=%u", answer, events());
    probe("wait", "none-pending", probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    int i;

    kernel = GetModuleHandle("KERNEL");

    probeOpen(OUTPUT);

    pending();
    wait();

    /* The program ended before the probe does. */
    for (i = 0; i < 200 && GetModuleHandle("KEVENTC"); i++) {
        Yield();
    }

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
