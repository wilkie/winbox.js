/*
 * WinExec: one program starting another. The other, WINEXECC.EXE
 * (`winexec.child.c`), writes a line to C:\ORACLE\CHILD.TXT at each step.
 *
 * * `exec`: WinExec's answer, `inst` for an instance, for a command line
 *   and a way to show.
 * * `lines`: how many lines the other program has written, at each point.
 * * `child`: the other program's lines, at the end.
 * * `same`: whether what WinExec answered is the instance of the window the
 *   program made, and whether two starts are two instances.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\WINEXEC.OUT"
#define LOG "C:\\ORACLE\\CHILD.TXT"

/* Each record is closed into the file, so a hang leaves those before it. */
static void record(LPCSTR function, LPCSTR args, LPCSTR result)
{
    probe(function, args, result);
    _lclose(probeHandle);
    probeHandle = _lopen(OUTPUT, OF_WRITE);
    _llseek(probeHandle, 0, 2);
}

#define probe record

static char text[1200];

/* The other program's lines, and how many. */
static int readLog(void)
{
    HFILE file = _lopen(LOG, OF_READ);
    int length;
    int lines = 0;
    int i;

    text[0] = '\0';

    if (file == HFILE_ERROR) {
        return 0;
    }

    length = _lread(file, text, sizeof(text) - 1);
    _lclose(file);
    text[length < 0 ? 0 : length] = '\0';

    for (i = 0; text[i]; i++) {
        if (text[i] == '\n') {
            lines++;
        }
    }

    return lines;
}

static void lines(LPCSTR when)
{
    wsprintf(probeResult, "%d", readLog());
    probe("lines", when, probeResult);
}

static void exec(LPCSTR what, LPCSTR command, UINT show, UINT *answer)
{
    *answer = WinExec(command, show);

    if (*answer > 32) {
        lstrcpy(probeResult, "inst");
    } else {
        wsprintf(probeResult, "%u", *answer);
    }

    probe("exec", what, probeResult);
}

/* Lets the others run until a window of theirs is there, or a while passes. */
static HWND waitFor(LPCSTR title, int count)
{
    DWORD start = GetTickCount();
    MSG msg;
    HWND found;

    for (;;) {
        found = FindWindow("WinExecChild", title);

        if (found && (count <= 1 || GetWindow(found, GW_HWNDNEXT))) {
            return found;
        }

        if (GetTickCount() - start > 5000) {
            return found;
        }

        if (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
            DispatchMessage(&msg);
        } else {
            Yield();
        }
    }
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
    UINT first;
    UINT second;
    UINT error;
    HWND window;
    HWND other;
    HFILE file;

    probeOpen(OUTPUT);

    file = _lcreat(LOG, 0);
    _lclose(file);

    exec("child with arguments", "WINEXECC.EXE alpha  beta", SW_SHOWMINNOACTIVE, &first);
    lines("just after");
    Yield();
    lines("after a yield");
    window = waitFor("Child", 1);
    lines("its window there");

    wsprintf(probeResult, "%s", (LPSTR)(window && (UINT)GetWindowWord(window, GWW_HINSTANCE) == first
                                            ? "yes"
                                            : "no"));
    probe("same", "answer is the window's instance", probeResult);

    exec("again", "WINEXECC", SW_SHOWNORMAL, &second);
    settle();
    lines("second there");
    probe("same", "two instances", (LPSTR)(second != first ? "yes" : "no"));

    exec("no such file", "NOSUCH.EXE", SW_SHOW, &error);
    exec("no such path", "C:\\NODIR\\NOSUCH.EXE", SW_SHOW, &error);
    exec("empty", "", SW_SHOW, &error);

    while ((other = FindWindow("WinExecChild", NULL)) != NULL) {
        SendMessage(other, WM_CLOSE, 0, 0L);
        settle();
    }

    settle();
    readLog();
    probe("child", "all", text);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
