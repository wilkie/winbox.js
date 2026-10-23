/*
 * Program Manager's groups as windows and files: [ShowGroup] with each
 * show command from 0 to 10, and after each the group's text, which group
 * is current and the windows; which group is current for an AddItem in a
 * later conversation; [CreateGroup] given a path where a group file is
 * already; items of the same name, and [DeleteItem] of that name; and the
 * forty groups Program Manager holds at most.
 */

#define PROBE_FLUSH
#include "probe.h"
#include <ddeml.h>
#include "pmprobe.h"

#pragma library("ddeml")

#define OUTPUT "C:\\ORACLE\\PMGROUPS.OUT"

int PASCAL WinMain(HINSTANCE module, HINSTANCE previous, LPSTR command, int show)
{
    char line[80];
    int i;

    (void)previous;
    (void)command;
    (void)show;
    probeOpen(OUTPUT);
    ddeOpen(module);
    connect(TRUE);

    if (!conv) {
        probeFinish();
        return 0;
    }

    execute("[CreateGroup(Shown)][AddItem(C:\\WINDOWS\\CALC.EXE)]");
    execute("[CreateGroup(Other)][AddItem(C:\\WINDOWS\\CLOCK.EXE)]");
    windows("made");

    for (i = 0; i <= 11; i++) {
        wsprintf(line, "[ShowGroup(Shown,%d)]", i);
        execute(line);
        request("Shown");
        request("Other");
        windows(line);
        /* Which group an AddItem now goes to. */
        wsprintf(line, "[AddItem(C:\\WINDOWS\\NOTEPAD.EXE,After %d)]", i);
        execute(line);
    }

    execute("[ShowGroup(Shown,-1)]");
    execute("[ShowGroup(Shown,1x)]");
    execute("[ShowGroup(Shown,x)]");
    execute("[ShowGroup(\"shown\",1)]");
    request("Shown");
    request("Other");

    /* The current group in a later conversation. */
    execute("[ShowGroup(Other,1)]");
    disconnect();
    connect(FALSE);
    execute("[AddItem(C:\\WINDOWS\\WRITE.EXE,Later)]");
    request("Other");

    /* A path where a group's file is already. */
    copyFile("C:\\WINDOWS\\ACCESSOR.GRP", "C:\\WINDOWS\\COPIED.GRP");
    execute("[CreateGroup(Not Its Name,C:\\WINDOWS\\COPIED.GRP)]");
    request("Groups");
    request("Not Its Name");
    execute("[CreateGroup(Main Again,C:\\WINDOWS\\MAIN.GRP)]");
    request("Groups");
    execute("[CreateGroup(No Extension,C:\\WINDOWS\\NOEXT)]");
    execute("[CreateGroup(Spaced Path,C:\\WINDOWS\\A B.GRP)]");
    execute("[CreateGroup(Elsewhere,C:\\TEMP\\ELSE.GRP)]");
    text("paths", "C:\\WINDOWS\\PROGMAN.INI");
    windows("paths");

    /* Items of the same name. */
    execute("[CreateGroup(Twins)][AddItem(C:\\WINDOWS\\CALC.EXE,Twin)]"
            "[AddItem(C:\\WINDOWS\\CLOCK.EXE,Twin)][AddItem(C:\\WINDOWS\\NOTEPAD.EXE,twin)]");
    request("Twins");
    execute("[DeleteItem(TWIN)]");
    request("Twins");
    execute("[ReplaceItem(Twin)][AddItem(C:\\WINDOWS\\SOL.EXE,Replaced)]");
    request("Twins");
    execute("[CreateGroup(Twins)][CreateGroup(TWINS)]");
    request("Groups");

    /* Forty groups at most. */
    for (i = 0; i < 40; i++) {
        wsprintf(line, "[CreateGroup(Many %d)]", i);
        execute(line);
    }

    request("Groups");
    text("many", "C:\\WINDOWS\\PROGMAN.INI");
    execute("[AddItem(C:\\WINDOWS\\CALC.EXE,Where)]");
    request("Many 39");
    request("Many 30");
    execute("[DeleteGroup(Many 0)]");
    execute("[CreateGroup(After Many)]");
    request("Groups");
    text("after-many", "C:\\WINDOWS\\PROGMAN.INI");

    DdeDisconnect(conv);
    DdeFreeStringHandle(instance, service);
    DdeUninitialize(instance);
    probeFinish();
    return 0;
}
