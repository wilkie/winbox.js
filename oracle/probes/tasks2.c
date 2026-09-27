/*
 * More of how programs run together. The program started, TASKS2C.EXE
 * (`tasks2.child.c`), writes a line to C:\ORACLE\CHILD.TXT as it starts and
 * for each WM_USER it takes.
 *
 * * `cwd`: the probe's current directory, and after it changes it.
 * * `load`: LoadModule's answer, `inst` for an instance.
 * * `order`: the lines the programs have written since the last record,
 *   after messages posted to both and a Yield, or a DirectedYield to one.
 * * `count`: GetNumTasks, and GetModuleUsage of the program started.
 * * `child`: every line, at the end.
 */

#include "probe.h"
#include <direct.h>

#define OUTPUT "C:\\ORACLE\\TASKS2.OUT"
#define LOG "C:\\ORACLE\\CHILD.TXT"

static void record(LPCSTR function, LPCSTR args, LPCSTR result)
{
    probe(function, args, result);
    _lclose(probeHandle);
    probeHandle = _lopen(OUTPUT, OF_WRITE);
    _llseek(probeHandle, 0, 2);
}

#define probe record

typedef struct {
    WORD environment;
    LPSTR commandLine;
    LPVOID show;
    DWORD reserved;
} PARAMETERS;

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

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    char directory[80];
    char tail[40];
    UINT showing[2];
    PARAMETERS parameters;
    UINT answer;
    UINT first;
    HWND a;
    HWND b;
    HFILE file;

    probeOpen(OUTPUT);

    file = _lcreat(LOG, 0);
    _lclose(file);

    getcwd(directory, sizeof(directory));
    probe("cwd", "at start", directory);
    chdir("C:\\ORACLE");
    getcwd(directory, sizeof(directory));
    probe("cwd", "changed", directory);

    wsprintf(probeResult, "%d", GetNumTasks());
    probe("count", "tasks before", probeResult);

    first = WinExec("TASKS2C.EXE A", SW_SHOWNORMAL);
    since("order", "started by WinExec");

    lstrcpy(tail + 1, "B and more\r");
    tail[0] = (char)lstrlen(tail + 1) - 1;
    showing[0] = 2;
    showing[1] = SW_SHOWMINNOACTIVE;
    parameters.environment = 0;
    parameters.commandLine = tail;
    parameters.show = showing;
    parameters.reserved = 0;
    answer = (UINT)LoadModule("TASKS2C.EXE", &parameters);
    probe("load", "with parameters", (LPSTR)(answer > 32 ? "inst" : "error"));
    since("order", "started by LoadModule");

    answer = (UINT)LoadModule("NOSUCH.EXE", &parameters);
    wsprintf(probeResult, "%u", answer);
    probe("load", "no such file", probeResult);

    wsprintf(probeResult, "%d", GetNumTasks());
    probe("count", "tasks with two", probeResult);
    wsprintf(probeResult, "%d", GetModuleUsage(first));
    probe("count", "usage with two", probeResult);

    a = FindWindow("Tasks2Child", "A");
    b = FindWindow("Tasks2Child", "B and more");
    probe("order", "windows", (LPSTR)(a && b ? "both" : "missing"));

    PostMessage(a, WM_USER, 1, 0L);
    PostMessage(b, WM_USER, 2, 0L);
    Yield();
    since("order", "posted to A then B, one Yield");
    settle();
    since("order", "posted to A then B, settled");

    PostMessage(a, WM_USER, 3, 0L);
    PostMessage(b, WM_USER, 4, 0L);
    DirectedYield(GetWindowTask(b));
    since("order", "posted to A then B, DirectedYield to B");
    settle();
    since("order", "and settled");

    PostMessage(b, WM_USER, 5, 0L);
    PostMessage(a, WM_USER, 6, 0L);
    Yield();
    since("order", "posted to B then A, one Yield");
    settle();
    since("order", "posted to B then A, settled");

    SendMessage(a, WM_CLOSE, 0, 0L);
    settle();
    wsprintf(probeResult, "%d", GetNumTasks());
    probe("count", "tasks after one closed", probeResult);
    wsprintf(probeResult, "%d", GetModuleUsage(GetWindowWord(b, GWW_HINSTANCE)));
    probe("count", "usage after one closed", probeResult);

    SendMessage(b, WM_CLOSE, 0, 0L);
    settle();
    wsprintf(probeResult, "%d", GetNumTasks());
    probe("count", "tasks after both closed", probeResult);

    getcwd(directory, sizeof(directory));
    probe("cwd", "at end", directory);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
