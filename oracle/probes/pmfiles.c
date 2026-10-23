/*
 * Group files an installer writes itself, before Program Manager starts:
 * a copy of MAIN.GRP named as Group4= in PROGMAN.INI with Order= left as
 * it was, a copy of ACCESSOR.GRP at Group6= past a gap, and keys Program
 * Manager does not take (Group07=, Groupx=) -- and PROGMAN.INI's
 * display.drv= set to another display's, so every group is taken for one
 * made on another screen. Then the groups it answers, MAIN.GRP's bytes
 * after, PROGMAN.INI, and what a CreateGroup writes of it.
 *
 * Not here: a file it cannot open or finds damaged. Program Manager says
 * so as it starts in a system-modal box (`PROGMAN.EXE` seg4 0313-03b3,
 * seg1 00ec), which stops every other task, the probe too.
 */

#define PROBE_FLUSH
#include "probe.h"
#include <ddeml.h>
#include "pmprobe.h"

#pragma library("ddeml")

#define OUTPUT "C:\\ORACLE\\PMFILES.OUT"

int PASCAL WinMain(HINSTANCE module, HINSTANCE previous, LPSTR command, int show)
{
    (void)previous;
    (void)command;
    (void)show;
    probeOpen(OUTPUT);

    bytes("MAIN.GRP before", "C:\\WINDOWS\\MAIN.GRP");

    /* What an installer puts there. */
    copyFile("C:\\WINDOWS\\MAIN.GRP", "C:\\WINDOWS\\PMCOPY.GRP");
    copyFile("C:\\WINDOWS\\ACCESSOR.GRP", "C:\\WINDOWS\\PMGAP.GRP");
    copyFile("C:\\WINDOWS\\STARTUP.GRP", "C:\\WINDOWS\\PMZERO.GRP");

    WritePrivateProfileString("Groups", "Group4", "C:\\WINDOWS\\PMCOPY.GRP", "PROGMAN.INI");
    WritePrivateProfileString("Groups", "Group6", "C:\\WINDOWS\\PMGAP.GRP", "PROGMAN.INI");
    WritePrivateProfileString("Groups", "Group07", "C:\\WINDOWS\\PMZERO.GRP", "PROGMAN.INI");
    WritePrivateProfileString("Groups", "Groupx", "C:\\WINDOWS\\PMZERO.GRP", "PROGMAN.INI");
    WritePrivateProfileString("Settings", "display.drv", "other.drv", "PROGMAN.INI");
    text("before", "C:\\WINDOWS\\PROGMAN.INI");

    ddeOpen(module);
    connect(TRUE);

    if (!conv) {
        probeFinish();
        return 0;
    }

    text("started", "C:\\WINDOWS\\PROGMAN.INI");
    windows("started");
    request("Groups");
    request("Main");
    request("Accessories");
    request("StartUp");
    bytes("MAIN.GRP after", "C:\\WINDOWS\\MAIN.GRP");
    bytes("PMCOPY.GRP after", "C:\\WINDOWS\\PMCOPY.GRP");

    execute("[CreateGroup(New One)]");
    text("created", "C:\\WINDOWS\\PROGMAN.INI");
    request("Groups");

    disconnect();
    DdeFreeStringHandle(instance, service);
    DdeUninitialize(instance);
    probeFinish();
    return 0;
}
