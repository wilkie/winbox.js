/*
 * When WinExec hands the processor back to the program that called it. The
 * program started, EXECPKC.EXE (`execpk.child.c`), writes a line to
 * C:\ORACLE\CHILD.TXT as it starts and after each of four times it gives up
 * the processor -- by PeekMessage, by Yield, by PeekMessage with PM_NOYIELD,
 * or not at all -- and never waits for a message. For each way:
 *
 * * `order`: the lines it has written when WinExec returns, after one Yield
 *   more, and after the probe has let it run for half a second.
 * * `count`: GetNumTasks when WinExec returns.
 *
 * KERNEL's LoadModule gives up the processor once, by Yield, after making
 * the task (`KRNL386.EXE` seg2 `1321`, `13a1`-`13a8`; seg1 `7d21`).
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\EXECPK.OUT"
#define LOG "C:\\ORACLE\\CHILD.TXT"

static void record(LPCSTR function, LPCSTR args, LPCSTR result)
{
    probe(function, args, result);
    _lclose(probeHandle);
    probeHandle = _lopen(OUTPUT, OF_WRITE);
    _llseek(probeHandle, 0, 2);
}

#define probe record

static char text[1600];
static int seen;

/* The lines written since last asked, `|` between. */
static void since(LPCSTR function, LPCSTR what)
{
    HFILE file = _lopen(LOG, OF_READ);
    int length;
    int i;
    int lines = 0;
    char out[400];
    int at = 0;

    length = _lread(file, text, sizeof(text) - 1);
    _lclose(file);
    text[length < 0 ? 0 : length] = '\0';
    out[0] = '\0';

    for (i = 0; text[i]; i++) {
        if (text[i] == '\r') {
            continue;
        }

        if (text[i] == '\n') {
            lines++;

            if (lines > seen && at && out[at - 1] != '|') {
                out[at++] = '|';
            }

            continue;
        }

        if (lines >= seen && at < (int)sizeof(out) - 2) {
            out[at++] = text[i];
        }
    }

    out[at] = '\0';
    seen = lines;
    probe(function, what, out[0] ? out : "none");
}

static void settle(void)
{
    DWORD start = GetTickCount();
    MSG msg;

    while (GetTickCount() - start < 500) {
        if (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
            DispatchMessage(&msg);
        } else {
            Yield();
        }
    }
}

static void way(LPCSTR command, LPCSTR name)
{
    char what[60];
    UINT answer;
    int tasks;

    answer = WinExec(command, SW_SHOWNORMAL);
    tasks = GetNumTasks();
    wsprintf(what, "%s, WinExec returned", name);
    since("order", what);
    wsprintf(probeResult, "%d %d", answer > 32, tasks);
    wsprintf(what, "%s, started and tasks", name);
    probe("count", what, probeResult);

    Yield();
    wsprintf(what, "%s, one Yield", name);
    since("order", what);

    settle();
    wsprintf(what, "%s, settled", name);
    since("order", what);

    wsprintf(probeResult, "%d", GetNumTasks());
    wsprintf(what, "%s, tasks settled", name);
    probe("count", what, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HFILE file;

    probeOpen(OUTPUT);

    file = _lcreat(LOG, 0);
    _lclose(file);

    wsprintf(probeResult, "%d", GetNumTasks());
    probe("count", "tasks before", probeResult);

    way("EXECPKC.EXE P", "PeekMessage");
    way("EXECPKC.EXE Y", "Yield");
    way("EXECPKC.EXE N", "PM_NOYIELD");
    way("EXECPKC.EXE X", "none");

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
