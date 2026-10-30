/*
 * USER's ordinal 343, GetFilePortName, called by ordinal: the "Print To
 * File" box a printer's driver shows for the port FILE: (`USER.EXE` seg1
 * `9c7c`, its procedure `9d0f`, its dialog 10). Driven from a timer while
 * it is up; each step's records come from the timer.
 *
 * * `box`: its caption, its owner (`main` where it is the probe's active
 *   window), each control's id, class and text, whether OK is enabled, and
 *   which control has the focus.
 * * `again`: ordinal 343 called while the box is up.
 * * `typed`: OK enabled once the name is set.
 * * `asked`: a message box the box showed: its caption and its controls'
 *   texts, then the button pressed.
 * * `answer`: what ordinal 343 answered, the `OFSTRUCT`'s path and whether
 *   the file is there after, for: Cancel; a new file's name and OK; the
 *   same name and OK, the question answered No, then Cancel; the same, Yes;
 *   a name on a drive that is not there and OK, the error's OK, then
 *   Cancel.
 */

#define PROBE_FLUSH
#include "probe.h"
#include <string.h>

#define OUTPUT "C:\\ORACLE\\FILPORT.OUT"
#define TARGET "C:\\ORACLE\\FILPORT.TXT"

typedef int(FAR PASCAL *FILEPORT)(OFSTRUCT FAR *);

static FILEPORT getFilePortName;
static HWND main;
static HWND dialog;
static int step;
static int waited;
static int plan;
static LPCSTR name;
static UINT press;

BOOL CALLBACK __export Child(HWND window, LPARAM lParam)
{
    char kind[32];
    char text[128];

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
    OFSTRUCT other;
    HWND asked;

    /* The box, found by its caption once it is up. */
    if (!dialog) {
        dialog = FindWindow(NULL, "Print To File");

        if (!dialog) {
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
            RECT box;

            describe(dialog, "box");
            GetWindowRect(dialog, &box);
            wsprintf(probeResult, "%d %d %d %d", box.left, box.top, box.right, box.bottom);
            probe("box", "rect", probeResult);
            wsprintf(probeResult, "%d", getFilePortName(&other));
            probe("again", "while up", probeResult);
            PostMessage(dialog, WM_COMMAND, IDCANCEL, 0L);
            KillTimer(NULL, id);
            return;
        }

        SetDlgItemText(dialog, 10, name);
        wsprintf(probeResult, "%d", IsWindowEnabled(GetDlgItem(dialog, IDOK)));
        probe("typed", "ok enabled", probeResult);
        PostMessage(dialog, WM_COMMAND, IDOK, 0L);

        if (plan == 1) {
            KillTimer(NULL, id);
        }

        return;
    }

    if (step == 2) {
        /* The question or the error: a message box captioned "FILE:". */
        asked = FindWindow(NULL, "FILE:");

        if (!asked) {
            if (++waited <= PATIENCE) {
                step--;
                return;
            }

            probe("asked", "none", "");
        } else {
            describe(asked, "asked");
            wsprintf(probeResult, "%u", press);
            probe("asked", "press", probeResult);
            PostMessage(asked, WM_COMMAND, press, 0L);
        }

        if (plan == 3) {
            KillTimer(NULL, id);
        }

        return;
    }

    PostMessage(dialog, WM_COMMAND, IDCANCEL, 0L);
    KillTimer(NULL, id);

    (void)window;
    (void)message;
    (void)time;
}

static void run(int which, LPCSTR given, UINT button, LPCSTR what)
{
    OFSTRUCT of;
    OFSTRUCT test;
    int answer;

    plan = which;
    name = given;
    press = button;
    step = 0;
    waited = 0;
    dialog = NULL;
    _fmemset(&of, 0, sizeof(of));
    SetTimer(NULL, 0, 300, (TIMERPROC)Tick);
    answer = getFilePortName(&of);
    wsprintf(probeResult, "%d %s %s", answer, (LPSTR)of.szPathName,
             (LPSTR)(OpenFile(TARGET, &test, OF_EXIST) != HFILE_ERROR ? "there" : "not there"));
    probe("answer", what, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    OFSTRUCT of;
    HFILE file;

    probeOpen(OUTPUT);
    OpenFile(TARGET, &of, OF_DELETE);

    getFilePortName = (FILEPORT)GetProcAddress(GetModuleHandle("USER"), MAKEINTRESOURCE(343));
    main = CreateWindow("STATIC", "Main", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 10, 10, 300, 200,
                        NULL, NULL, instance, NULL);
    SetActiveWindow(main);

    probeNote("start");
    run(0, NULL, 0, "cancel");
    run(1, TARGET, 0, "new file");
    run(2, TARGET, IDNO, "there, no");
    run(3, TARGET, IDYES, "there, yes");

    file = _lopen(TARGET, OF_READ);
    wsprintf(probeResult, "%ld", file == HFILE_ERROR ? -1L : _llseek(file, 0L, 2));
    probe("answer", "size after", probeResult);

    if (file != HFILE_ERROR) {
        _lclose(file);
    }

    /* A message box with OK alone has it as button 2, IDCANCEL (seen
     * below as `asked control`), so that Escape ends it too. */
    run(2, "Q:\\NOPE\\FILPORT.TXT", IDCANCEL, "no drive");

    OpenFile(TARGET, &of, OF_DELETE);
    DestroyWindow(main);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
