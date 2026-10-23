/*
 * Program Manager as Windows' shell, as an installation has it: recorded
 * with SYSTEM.INI's shell= left naming PROGMAN.EXE and WIN.INI's run=
 * naming this probe (`pmshell.progman.ini`), so Program Manager starts
 * first and starts the probe, as it starts what run= names.
 *
 * What the probe was started with; the tasks running; what Program Manager
 * wrote as it started; [ExitProgman], refused to the shell; what it does
 * with WM_QUERYENDSESSION and WM_ENDSESSION -- the settings saved -- sent
 * it as Windows sends them when it ends; and its groups and windows.
 */

#define PROBE_FLUSH
#include "probe.h"
#include <ddeml.h>
#include "pmprobe.h"

#pragma library("ddeml")

#define OUTPUT "C:\\ORACLE\\PMSHELL.OUT"

int PASCAL WinMain(HINSTANCE module, HINSTANCE previous, LPSTR command, int show)
{
    HWND frame;
    char path[128];
    LONG answer;

    (void)previous;
    probeOpen(OUTPUT);

    GetModuleFileName(module, path, sizeof(path));
    wsprintf(probeResult, "show=%d:command=%s:path=%s", show, (LPSTR)command, (LPSTR)path);
    probe("WinMain", "", probeResult);
    wsprintf(probeResult, "%d", GetNumTasks());
    probe("GetNumTasks", "", probeResult);
    frame = FindWindow("Progman", NULL);
    probe("FindWindow", "Progman", frame ? "running" : "none");
    GetProfileString("windows", "run", "(none)", path, sizeof(path));
    probe("GetProfileString", "windows,run", path);
    GetPrivateProfileString("boot", "shell", "(none)", path, sizeof(path), "SYSTEM.INI");
    probe("GetPrivateProfileString", "boot,shell", path);

    text("started", "C:\\WINDOWS\\PROGMAN.INI");
    windows("started");

    ddeOpen(module);
    connect(FALSE);

    if (!conv) {
        probeFinish();
        return 0;
    }

    request("Groups");
    execute("[ExitProgman(1)]");
    execute("[ExitProgman(0)]");
    execute("[ExitProgman]");
    settle(20);
    probe("FindWindow", "Progman", FindWindow("Progman", NULL) ? "running" : "gone");
    text("exit-refused", "C:\\WINDOWS\\PROGMAN.INI");

    /* Changed, so a save shows: a group made, and the frame moved. */
    execute("[CreateGroup(Shell Group)][AddItem(C:\\WINDOWS\\CALC.EXE)]");
    MoveWindow(frame, 10, 20, 400, 300, TRUE);
    settle(5);
    text("changed", "C:\\WINDOWS\\PROGMAN.INI");

    /* Windows ending: asked, then told it is not ending, then told it is. */
    answer = SendMessage(frame, WM_QUERYENDSESSION, 0, 0L);
    wsprintf(probeResult, "%ld", answer);
    probe("SendMessage", "WM_QUERYENDSESSION", probeResult);
    SendMessage(frame, WM_ENDSESSION, FALSE, 0L);
    text("endsession-false", "C:\\WINDOWS\\PROGMAN.INI");
    SendMessage(frame, WM_ENDSESSION, TRUE, 0L);
    text("endsession-true", "C:\\WINDOWS\\PROGMAN.INI");
    windows("endsession");
    probe("FindWindow", "Progman", FindWindow("Progman", NULL) ? "running" : "gone");

    request("Groups");
    request("Shell Group");

    disconnect();
    DdeFreeStringHandle(instance, service);
    DdeUninitialize(instance);
    probeFinish();
    return 0;
}
