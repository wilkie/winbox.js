/*
 * A program that reads a page that is not present, with no exception
 * handler of its own: what KERNEL shows (`kb/guides/paging.md`, "The probes
 * that would measure the rest"). The probe starts `PGBOXC.EXE`
 * (`pgbox.child.c`) and posts it WM_USER twice, on which it reads a byte at
 * the linear address 80000000h, which in 386 enhanced mode WIN386 has not
 * given it (`pgtouch`). Recorded in each mode (`record.mjs --mode
 * enhanced`); in standard mode nothing faults and no box shows.
 *
 * KERNEL's boxes have no window and no program runs while one is up
 * (`kb/topics/application-errors.md`): in enhanced mode the probe is
 * recorded with `--shoot posted:3`, the first box's Ignore pressed (`--then
 * Tab,Return:8`), then the second read's first box's Close (`--then
 * Return:4`), and the Application Error box's Close (`--then Return:4`).
 * The screens are what the boxes say.
 *
 * * `exec`: WinExec's answer, `inst` for an instance.
 * * `posted`: the first read asked for.
 * * `after read 1`: once the probe runs again, whether the program's window
 *   is there, and the program's answer to WM_USER + 1: how many of its
 *   reads went on past the instruction, and AL after the last (5Ah where
 *   the read was stepped over).
 * * `posted again`: the second read asked for.
 * * `after read 2`: whether the program's window is there, and whether it
 *   runs (`GetModuleUsage`). Where it still runs, it is closed after.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\PGBOX.OUT"

static void record(LPCSTR function, LPCSTR args, LPCSTR result)
{
    probe(function, args, result);
    _lclose(probeHandle);
    probeHandle = _lopen(OUTPUT, OF_WRITE);
    _llseek(probeHandle, 0, 2);
}

#define probe record

static void settle(DWORD span)
{
    DWORD start = GetTickCount();
    MSG msg;

    while (GetTickCount() - start < span) {
        if (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
            DispatchMessage(&msg);
        } else {
            Yield();
        }
    }
}

/* Lets the other tasks run until the program's window is gone, or `span`
 * has passed. */
static void settleUntilGone(DWORD span)
{
    DWORD start = GetTickCount();
    MSG msg;

    while (GetTickCount() - start < span && FindWindow("PgBoxChild", NULL)) {
        if (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
            DispatchMessage(&msg);
        } else {
            Yield();
        }
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HWND program;
    UINT answer;
    HINSTANCE started;
    DWORD state;

    probeOpen(OUTPUT);

    answer = WinExec("PGBOXC.EXE", SW_SHOWNORMAL);
    started = (HINSTANCE)answer;
    probe("exec", "program", (LPSTR)(answer > 32 ? "inst" : "error"));
    program = FindWindow("PgBoxChild", NULL);
    if (!program) {
        probe("exec", "window", "none");
        probeFinish();
        return 0;
    }

    PostMessage(program, WM_USER, 0, 0L);
    probe("posted", "read 1", "yes");
    settle(8000);

    program = FindWindow("PgBoxChild", NULL);
    probe("after read 1", "window", (LPSTR)(program ? "there" : "gone"));
    if (program) {
        state = SendMessage(program, WM_USER + 1, 0, 0L);
        wsprintf(probeResult, "%u", LOWORD(state));
        probe("after read 1", "reads gone on", probeResult);
        wsprintf(probeResult, "%02x", HIWORD(state));
        probe("after read 1", "AL", probeResult);

        PostMessage(program, WM_USER, 0, 0L);
        probe("posted again", "read 2", "yes");
        settleUntilGone(20000);

        program = FindWindow("PgBoxChild", NULL);
        probe("after read 2", "window", (LPSTR)(program ? "there" : "gone"));
        probe("after read 2", "usage", (LPSTR)(GetModuleUsage(started) ? "running" : "ended"));
        if (program) {
            state = SendMessage(program, WM_USER + 1, 0, 0L);
            wsprintf(probeResult, "%u", LOWORD(state));
            probe("after read 2", "reads gone on", probeResult);
            PostMessage(program, WM_CLOSE, 0, 0L);
            settleUntilGone(5000);
        }
    }

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
