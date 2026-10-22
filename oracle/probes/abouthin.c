/*
 * The instance SHELL's About box is made with: `ShellAbout` hands
 * `DialogBoxParam` SHELL's own instance, which its entry point stored at
 * [350h] (`SHELL.DLL` seg9 `002b`, seg2 `0010`). Read from a timer while the
 * box is up:
 *
 * * `instance`: the box's `GWW_HINSTANCE`, and that of its first line's
 *   static (101) and of its OK button (1), each as `shell` where it is the
 *   instance `LoadLibrary` gives for `SHELL.DLL`, `own` for the probe's,
 *   `zero`, else `other`.
 * * `answer`: what `ShellAbout` answered.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\ABOUTHIN.OUT"

typedef int(FAR PASCAL *ABOUTPROC)(HWND, LPCSTR, LPCSTR, HICON);

static HINSTANCE shell;
static HINSTANCE own;

static LPCSTR named(HWND window)
{
    HINSTANCE instance = (HINSTANCE)GetWindowWord(window, GWW_HINSTANCE);

    return !window              ? "none"
           : instance == shell ? "shell"
           : instance == own   ? "own"
           : !instance         ? "zero"
                               : "other";
}

void CALLBACK __export Tick(HWND window, UINT message, UINT id, DWORD time)
{
    HWND dialog = GetActiveWindow();

    KillTimer(NULL, id);
    probe("instance", "box", named(dialog));
    probe("instance", "static 101", named(GetDlgItem(dialog, 101)));
    probe("instance", "button 1", named(GetDlgItem(dialog, 1)));
    PostMessage(dialog, WM_COMMAND, IDOK, 0L);

    (void)window;
    (void)message;
    (void)time;
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static char app[] = "Probe";
    ABOUTPROC shellAbout;
    int answer;

    probeOpen(OUTPUT);

    own = instance;
    shell = LoadLibrary("SHELL.DLL");
    shellAbout = (ABOUTPROC)GetProcAddress(shell, "ShellAbout");

    SetTimer(NULL, 0, 300, (TIMERPROC)Tick);
    answer = shellAbout(NULL, app, "Other stuff", NULL);
    wsprintf(probeResult, "%d", answer);
    probe("answer", "", probeResult);

    FreeLibrary(shell);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
