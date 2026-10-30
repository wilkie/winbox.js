/*
 * SHELL's box for finding a program, its procedure ordinal 101,
 * FindExeDlgProc (`SHELL.DLL` seg8 `010e`): `ShellExecute` of a file whose
 * association names a program `WinExec` cannot find shows it (seg4 `0fee`,
 * SHELL's unnamed ordinal 119 at seg8 `0570`) -- where the association is
 * the registry's (`0abf`, after `RegQueryValue`), not WIN.INI's
 * [extensions]. The association is to FINDEXEX.EXE, which is not on the
 * path: the probe's second program (`findexe.child.c`) copied to
 * C:\ORACLE\HIDE under that name. Driven from a timer while the box is up.
 *
 * * `box`: its caption, owner, each control's id, class and text, and the
 *   focus.
 * * `asked`: a message box it showed: caption, controls, the button pressed.
 * * `answer`: what `ShellExecute` answered (`instance` above 32), WIN.INI's
 *   [programs] line for FINDEXEX.EXE after, for: the association in WIN.INI's
 *   [extensions] only; then in the registry: Cancel; a folder without
 *   the program and OK, the message's OK, then Cancel; the folder with it
 *   and OK; and again, with the line in WIN.INI.
 * * `child`: the lines the program wrote, its command line each time it ran.
 */

#define PROBE_FLUSH
#include "probe.h"
#include <direct.h>
#include <shellapi.h>

#define OUTPUT "C:\\ORACLE\\FINDEXE.OUT"
#define DOCUMENT "C:\\ORACLE\\FINDEXE.ZZQ"
#define LOG "C:\\ORACLE\\FINDEXE.TXT"
#define FOLDER "C:\\ORACLE\\HIDE"
#define PROGRAM "C:\\ORACLE\\HIDE\\FINDEXEX.EXE"

static HWND main;
static HWND box;
static int step;
static int waited;
static int plan;
static LPCSTR folder;

BOOL CALLBACK __export Child(HWND window, LPARAM lParam)
{
    char kind[32];
    char text[256];

    GetClassName(window, kind, sizeof(kind));
    GetWindowText(window, text, sizeof(text));
    wsprintf(probeResult, "%d %s %s%s", GetDlgCtrlID(window), (LPSTR)kind, (LPSTR)text,
             (LPSTR)(IsWindowEnabled(window) ? "" : " (disabled)"));
    probe((LPCSTR)lParam, "control", probeResult);

    return TRUE;
}

static void describe(HWND window, LPCSTR what)
{
    char text[128];
    HWND owner = GetWindow(window, GW_OWNER);
    HWND focus = GetFocus();

    GetWindowText(window, text, sizeof(text));
    probe(what, "caption", text);
    probe(what, "owner", owner == main ? "main" : owner ? "other" : "none");
    EnumChildWindows(window, (WNDENUMPROC)Child, (LPARAM)(LPSTR)what);
    wsprintf(probeResult, "%d", focus && IsChild(window, focus) ? GetDlgCtrlID(focus) : -1);
    probe(what, "focus", probeResult);
}

/* How many ticks a step waits for its box before it gives up. */
#define PATIENCE 20

void CALLBACK __export Tick(HWND window, UINT message, UINT id, DWORD time)
{
    HWND active = GetActiveWindow();

    /* The box, found by its caption once it is up. */
    if (!box) {
        box = FindWindow(NULL, "Program Not Found");

        if (!box) {
            if (++waited > PATIENCE) {
                probe("box", "never up", "");
                KillTimer(NULL, id);
            }

            return;
        }
    }

    step++;

    if (step == 1) {
        if (plan == 0) {
            describe(box, "box");
            PostMessage(box, WM_COMMAND, IDCANCEL, 0L);
            KillTimer(NULL, id);
            return;
        }

        SetDlgItemText(box, 203, folder);
        PostMessage(box, WM_COMMAND, IDOK, 0L);

        if (plan == 2) {
            KillTimer(NULL, id);
        }

        return;
    }

    if (step == 2) {
        /* The message the box asks with, owned by it and active. */
        if (active == box || !active) {
            if (++waited <= PATIENCE) {
                step--;
                return;
            }

            probe("asked", "none", "");
        } else {
            describe(active, "asked");
            /* Its one button, OK, is button 2, IDCANCEL. */
            PostMessage(active, WM_COMMAND, IDCANCEL, 0L);
        }

        return;
    }

    PostMessage(box, WM_COMMAND, IDCANCEL, 0L);
    KillTimer(NULL, id);

    (void)window;
    (void)message;
    (void)time;
}

static void copyProgram(void)
{
    static char buffer[1024];
    /* The recorder puts the probe's second program in C:\WINDOWS. */
    HFILE from = _lopen("C:\\WINDOWS\\FINDEXEC.EXE", OF_READ);
    HFILE to;
    UINT count;

    mkdir(FOLDER);
    to = _lcreat(PROGRAM, 0);

    while ((count = _lread(from, buffer, sizeof(buffer))) != 0 && count != (UINT)-1) {
        _lwrite(to, buffer, count);
    }

    _lclose(from);
    _lclose(to);
}

static void run(int which, LPCSTR given, LPCSTR what, BOOL timed)
{
    UINT answer;
    char line[128];

    plan = which;
    folder = given;
    step = 0;
    waited = 0;
    box = NULL;

    if (timed) {
        SetTimer(NULL, 0, 300, (TIMERPROC)Tick);
    }

    answer = (UINT)ShellExecute(main, NULL, DOCUMENT, NULL, NULL, SW_SHOWNORMAL);
    GetProfileString("programs", "FINDEXEX.EXE", "(none)", line, sizeof(line));
    if (answer > 32) {
        wsprintf(probeResult, "instance programs=%s", (LPSTR)line);
    } else {
        wsprintf(probeResult, "%u programs=%s", answer, (LPSTR)line);
    }

    probe("answer", what, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    OFSTRUCT of;
    HFILE file;
    char line[256];
    MSG msg;
    int count;
    int at;
    int start;

    probeOpen(OUTPUT);
    OpenFile(LOG, &of, OF_DELETE);
    copyProgram();
    file = _lcreat(DOCUMENT, 0);
    _lwrite(file, "zzq", 3);
    _lclose(file);
    WriteProfileString("programs", "FINDEXEX.EXE", NULL);
    WriteProfileString("extensions", "zzq", "FINDEXEX.EXE ^.zzq");

    main = CreateWindow("STATIC", "Main", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 10, 10, 300, 200,
                        NULL, NULL, instance, NULL);
    SetActiveWindow(main);

    run(0, NULL, "ini only", FALSE);
    WriteProfileString("extensions", "zzq", NULL);
    RegSetValue(HKEY_CLASSES_ROOT, ".zzq", REG_SZ, "zzqfile", 7);
    RegSetValue(HKEY_CLASSES_ROOT, "zzqfile\\shell\\open\\command", REG_SZ,
                "FINDEXEX.EXE %1", 15);

    run(0, NULL, "cancel", TRUE);
    run(1, "C:\\WINDOWS", "folder without it", TRUE);
    run(2, FOLDER, "folder with it", TRUE);
    run(3, NULL, "again", FALSE);

    /* Time for the program started to run and end. */
    for (count = 0; count < 50; count++) {
        while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
            DispatchMessage(&msg);
        }

        Yield();
    }

    file = _lopen(LOG, OF_READ);

    if (file != HFILE_ERROR) {
        count = _lread(file, line, sizeof(line) - 1);
        line[count < 0 ? 0 : count] = '\0';
        _lclose(file);

        for (at = 0, start = 0; line[at]; at++) {
            if (line[at] == '\r') {
                line[at] = '\0';
                probe("child", "line", line + start);
                start = at + 2;
            }
        }
    } else {
        probe("child", "line", "(no file)");
    }

    WriteProfileString("programs", "FINDEXEX.EXE", NULL);
    RegDeleteKey(HKEY_CLASSES_ROOT, "zzqfile");
    RegDeleteKey(HKEY_CLASSES_ROOT, ".zzq");
    OpenFile(DOCUMENT, &of, OF_DELETE);
    OpenFile(PROGRAM, &of, OF_DELETE);
    OpenFile(LOG, &of, OF_DELETE);
    rmdir(FOLDER);
    DestroyWindow(main);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
