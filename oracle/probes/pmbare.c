/*
 * Program Manager with nothing of its own on the drive: the probe deletes
 * PROGMAN.INI and the installation's group files, MAIN.GRP, ACCESSOR.GRP
 * and STARTUP.GRP, and starts PROGMAN.EXE, as a WinBox installation that
 * has never run it would have it. What Program Manager then writes as it
 * starts; its windows, placed with no Window= to go by; the groups it
 * answers with none; an AddItem with no group to put it in; an installer's
 * script -- ddeinst's, then Caribbean Treasure's SETUP.EXE's strings exactly
 * as it sends them -- and each group's text and file, whole, in
 * hexadecimal; and PROGMAN.INI after [ExitProgman(1)].
 *
 * Recorded on more than one display: the group file carries the screen's
 * resolution and its icons' format, and the windows' places depend on the
 * screen's size.
 */

#define PROBE_FLUSH
#include "probe.h"
#include <ddeml.h>
#include "pmprobe.h"

#pragma library("ddeml")

#define OUTPUT "C:\\ORACLE\\PMBARE.OUT"

/* One command in a conversation of its own, as SETUP.EXE sends each: a
 * second's timeout, the string's length counting its nought. */
static void caribb(LPCSTR command)
{
    DWORD result = 0xAAAAAAAAL;
    HDDEDATA answer;
    HCONV one = DdeConnect(instance, service, service, NULL);

    if (!one) {
        probe("caribb", command, "no conversation");
        return;
    }

    answer = DdeClientTransaction((LPBYTE)command, lstrlen(command) + 1, one, 0, CF_TEXT,
                                  XTYP_EXECUTE, 1000, &result);
    wsprintf(probeResult, "%d,%x,%x", answer != 0, DdeGetLastError(instance), LOWORD(result));
    probe("caribb", command, probeResult);
    DdeDisconnect(one);
}

int PASCAL WinMain(HINSTANCE module, HINSTANCE previous, LPSTR command, int show)
{
    (void)previous;
    (void)command;
    (void)show;
    probeOpen(OUTPUT);

    removeFile("C:\\WINDOWS\\PROGMAN.INI");
    removeFile("C:\\WINDOWS\\MAIN.GRP");
    removeFile("C:\\WINDOWS\\ACCESSOR.GRP");
    removeFile("C:\\WINDOWS\\STARTUP.GRP");
    text("before", "C:\\WINDOWS\\PROGMAN.INI");

    ddeOpen(module);
    connect(TRUE);

    if (!conv) {
        probeFinish();
        return 0;
    }

    /* What it wrote as it started. */
    text("started", "C:\\WINDOWS\\PROGMAN.INI");
    windows("started");
    request("Groups");
    request("PROGMAN");

    /* No group to add to. */
    execute("[AddItem(C:\\WINDOWS\\NOTEPAD.EXE)]");
    execute("[ShowGroup(Main,1)]");
    execute("[DeleteItem(Notepad)]");
    execute("[ReplaceItem(Notepad)]");
    text("no-group", "C:\\WINDOWS\\PROGMAN.INI");

    /* ddeinst's script. */
    execute("[CreateGroup(WinBox Games)]"
            "[AddItem(C:\\WINDOWS\\SOL.EXE,Solitaire)]"
            "[AddItem(C:\\WINDOWS\\WINMINE.EXE,Minesweeper)]"
            "[ShowGroup(WinBox Games,1)]");
    text("ddeinst", "C:\\WINDOWS\\PROGMAN.INI");
    windows("ddeinst");
    request("Groups");
    request("WinBox Games");
    bytes("WINBOXGA.GRP", "C:\\WINDOWS\\WINBOXGA.GRP");

    /* Caribbean Treasure's SETUP.EXE, its strings as it sends them. */
    disconnect();
    caribb("[CreateGroup(Games)]");
    caribb("[ReplaceItem(Caribbean Treasure)]");
    caribb("[AddItem(c:\\windows\\games\\carrib.exe,Caribbean Treasure,,,,,c:\\windows\\games)]");
    connect(FALSE);

    text("caribb", "C:\\WINDOWS\\PROGMAN.INI");
    windows("caribb");
    request("Groups");
    request("Games");
    bytes("GAMES.GRP", "C:\\WINDOWS\\GAMES.GRP");

    /* Every item of a group placed where there is room: a row, and the
     * next. */
    execute("[CreateGroup(Rows)]");
    execute("[AddItem(C:\\WINDOWS\\NOTEPAD.EXE)][AddItem(C:\\WINDOWS\\CALC.EXE)]"
            "[AddItem(C:\\WINDOWS\\CARDFILE.EXE)][AddItem(C:\\WINDOWS\\CLOCK.EXE)]"
            "[AddItem(C:\\WINDOWS\\WRITE.EXE)][AddItem(C:\\WINDOWS\\PBRUSH.EXE)]"
            "[AddItem(C:\\WINDOWS\\TERMINAL.EXE)][AddItem(C:\\WINDOWS\\CALENDAR.EXE)]"
            "[AddItem(C:\\WINDOWS\\RECORDER.EXE)][AddItem(C:\\WINDOWS\\CHARMAP.EXE)]"
            "[AddItem(C:\\WINDOWS\\NOTHERE.EXE)][AddItem(C:\\WINDOWS\\DOSPRMPT.PIF)]");
    windows("rows");
    request("Rows");
    bytes("ROWS.GRP", "C:\\WINDOWS\\ROWS.GRP");

    /* And saved as it ends. */
    execute("[ExitProgman(1)]");
    gone();
    text("exited", "C:\\WINDOWS\\PROGMAN.INI");
    bytes("WINBOXGA.GRP after", "C:\\WINDOWS\\WINBOXGA.GRP");

    DdeFreeStringHandle(instance, service);
    DdeUninitialize(instance);
    probeFinish();
    return 0;
}
