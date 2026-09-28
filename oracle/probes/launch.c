/*
 * Starts a program of the corpus, as Program Manager would: its full path
 * is in C:\ORACLE\LAUNCH.TXT, as the recorder writes it, and it is started
 * from its own folder.
 * The probe then waits, taking its messages, so that the program runs on and
 * the screen can be taken (`record.mjs launch --corpus <id> --shoot starting:<s>`).
 *
 * * `starting`: the program's path, before it is started: WinExec answers
 *   only once the program waits for a message, which a program that polls
 *   never does.
 * * `started`: WinExec's answer, `inst` for an instance, or the error.
 */

#include "probe.h"
#include <direct.h>

#define OUTPUT "C:\\ORACLE\\LAUNCH.OUT"

static void record(LPCSTR function, LPCSTR args, LPCSTR result)
{
    probe(function, args, result);
    _lclose(probeHandle);
    probeHandle = _lopen(OUTPUT, OF_WRITE);
    _llseek(probeHandle, 0, 2);
}

#define probe record

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    char folder[128];
    char path[128];
    char *slash;
    HFILE file;
    int length;
    UINT answer;
    MSG msg;

    probeOpen(OUTPUT);

    file = _lopen("C:\\ORACLE\\LAUNCH.TXT", OF_READ);
    length = file == HFILE_ERROR ? 0 : _lread(file, path, sizeof(path) - 1);

    if (file != HFILE_ERROR) {
        _lclose(file);
    }

    path[length < 0 ? 0 : length] = '\0';
    lstrcpy(folder, path);
    slash = folder + lstrlen(folder);

    while (slash > folder && *slash != '\\') {
        slash--;
    }

    *slash = '\0';
    chdir(folder);

    probe("starting", path, "yes");
    answer = WinExec(path, SW_SHOWNORMAL);

    if (answer > 32) {
        lstrcpy(probeResult, "inst");
    } else {
        wsprintf(probeResult, "%u", answer);
    }

    probe("started", path, probeResult);

    /* Not `probeFinish`, which ends the session: Windows is left running for
     * the recorder to take the screen and stop. */
    _lclose(probeHandle);

    /* On, taking messages, until the recorder stops Windows. */
    while (GetMessage(&msg, NULL, 0, 0)) {
        DispatchMessage(&msg);
    }

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
