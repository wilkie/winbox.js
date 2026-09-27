/*
 * ShellExecute: a program, and a file, opened. The program, SHELLEXC.EXE
 * (`shellex.child.c`), writes a line to C:\ORACLE\CHILD.TXT at each step.
 *
 * * `exec`: ShellExecute's answer, `inst` for an instance.
 * * `child`: the program's lines, at the end.
 * * `notepad`: the title of the window a text file opened in.
 */

#include "probe.h"
#include <shellapi.h>

#define OUTPUT "C:\\ORACLE\\SHELLEX.OUT"
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

static void exec(LPCSTR what, LPCSTR verb, LPCSTR file, LPCSTR parameters, LPCSTR directory,
                 int show)
{
    UINT answer = (UINT)ShellExecute(NULL, verb, file, parameters, directory, show);

    if (answer > 32) {
        lstrcpy(probeResult, "inst");
    } else {
        wsprintf(probeResult, "%u", answer);
    }

    probe("exec", what, probeResult);
}

static void settle(void)
{
    DWORD start = GetTickCount();
    MSG msg;

    while (GetTickCount() - start < 700) {
        if (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
            DispatchMessage(&msg);
        } else {
            Yield();
        }
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HFILE file;
    HWND window;
    int length;

    probeOpen(OUTPUT);

    file = _lcreat(LOG, 0);
    _lclose(file);
    file = _lcreat("C:\\ORACLE\\SAMPLE.TXT", 0);
    _lwrite(file, "hello", 5);
    _lclose(file);
    file = _lcreat("C:\\ORACLE\\SAMPLE.XYZ", 0);
    _lclose(file);

    exec("program with parameters", "open", "SHELLEXC.EXE", "one two", NULL, SW_SHOWNORMAL);
    exec("program, no verb", NULL, "SHELLEXC", "", NULL, SW_SHOWMINIMIZED);
    exec("text file", "open", "C:\\ORACLE\\SAMPLE.TXT", NULL, NULL, SW_SHOWNORMAL);
    settle();

    window = FindWindow("Notepad", NULL);
    text[0] = '\0';

    if (window) {
        GetWindowText(window, text, 100);
    }

    probe("notepad", "title", text[0] ? text : "none");

    exec("no such file", "open", "C:\\ORACLE\\NOTHERE.TXT", NULL, NULL, SW_SHOW);
    exec("no association", "open", "C:\\ORACLE\\SAMPLE.XYZ", NULL, NULL, SW_SHOW);
    exec("print a program", "print", "SHELLEXC.EXE", NULL, NULL, SW_SHOW);

    if (window) {
        PostMessage(window, WM_CLOSE, 0, 0L);
        settle();
    }

    while ((window = FindWindow("WinExecChild", NULL)) != NULL) {
        SendMessage(window, WM_CLOSE, 0, 0L);
        settle();
    }

    file = _lopen(LOG, OF_READ);
    length = _lread(file, text, sizeof(text) - 1);
    _lclose(file);
    text[length < 0 ? 0 : length] = '\0';
    probe("child", "all", text);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
