/*
 * An item run as Program Manager runs it: File Open (`WM_COMMAND` 102 to its
 * frame, what a double-click on an item posts, `PROGMAN.EXE` seg2 `1b64`)
 * runs the current group's first item (seg5 `067d`-`06a1`), the one an
 * AddItem has just put first, by seg5 `03e7`: its command and working
 * directory, `DoEnvironmentSubst`, the directory tried, then `ShellExecute`
 * (seg5 `01b3`) shown normally or minimized.
 *
 * A group made by DDE, then for each kind of item an AddItem and File Open:
 * a program with arguments; one with a working directory; one by its name
 * alone; one minimized; a document of an extension WIN.INI's [extensions]
 * gives to the program; a program that is not there; a document of an
 * extension nothing is associated with; and a working directory that is not
 * there, the box answered Cancel and then, opened again, OK. The program is
 * the probe's second (`pmitem.child.c`), PMITEMC.EXE in C:\WINDOWS.
 *
 * * `box`: a box Program Manager showed, its caption, each control's id,
 *   class and text, and the button the probe pressed.
 * * `child`: each line the program wrote as it ran: its command line,
 *   current directory, show command and file.
 */

#define PROBE_FLUSH
#include "probe.h"
#include <ddeml.h>
#include <direct.h>
#include "pmprobe.h"

#pragma library("ddeml")

#define OUTPUT "C:\\ORACLE\\PMITEM.OUT"
#define LOG "C:\\ORACLE\\PMITEM.TXT"
#define FOLDER "C:\\ORACLE\\PMDIR"
#define DOCUMENT "C:\\ORACLE\\PMITEM.PMI"
#define LONELY "C:\\ORACLE\\PMITEM.ZQX"

/* File Open, the menu's command. */
#define IDM_OPEN 102

static HWND frame;
static long logged;
/* The button to press, by its text, and its id once found. */
static LPCSTR wanted;
static int pressing;

BOOL CALLBACK __export Control(HWND window, LPARAM lParam)
{
    char kind[32];
    char text[256];

    GetClassName(window, kind, sizeof(kind));
    GetWindowText(window, text, sizeof(text));
    wsprintf(probeResult, "%d %s %s", GetDlgCtrlID(window), (LPSTR)kind, (LPSTR)text);
    probe("box", (LPCSTR)lParam, probeResult);

    if (!lstrcmpi(kind, "Button") && !lstrcmp(text, wanted)) {
        pressing = GetDlgCtrlID(window);
    }

    return TRUE;
}

/* The lines the program wrote since the last look. */
static int lines(LPCSTR label)
{
    static char text[1024];
    HFILE file = _lopen(LOG, OF_READ);
    int got;
    int at;
    int start;
    int count = 0;

    if (file == HFILE_ERROR) {
        return 0;
    }

    _llseek(file, logged, 0);
    got = _lread(file, text, sizeof(text) - 1);
    _lclose(file);

    if (got <= 0) {
        return 0;
    }

    text[got] = '\0';

    for (at = 0, start = 0; text[at]; at++) {
        if (text[at] == '\r') {
            text[at] = '\0';
            probe("child", label, text + start);
            start = at + 2;
            count++;
        }
    }

    logged += start;
    return count;
}

/* Waits for a line from the program or a box of Program Manager's: the box,
 * or nought. */
static HWND wait(LPCSTR label)
{
    HWND popup;
    int i;

    for (i = 0; i < 80; i++) {
        settle(1);
        popup = GetLastActivePopup(frame);

        if (popup && popup != frame && IsWindow(popup)) {
            return popup;
        }

        if (lines(label)) {
            return NULL;
        }
    }

    return NULL;
}

/* The current group's first item opened by File Open; a box answered by
 * the button of that text. */
static void open(LPCSTR label, LPCSTR button)
{
    char caption[128];
    HWND box;
    int i;

    PostMessage(frame, WM_COMMAND, IDM_OPEN, 0L);
    box = wait(label);

    if (!box) {
        probe("box", label, "none");
        return;
    }

    GetWindowText(box, caption, sizeof(caption));
    probe("box", label, caption);
    wanted = button;
    pressing = IDCANCEL;
    EnumChildWindows(box, (WNDENUMPROC)Control, (LPARAM)label);
    wsprintf(probeResult, "%s %d", button, pressing);
    probe("pressed", label, probeResult);
    PostMessage(box, WM_COMMAND, pressing, 0L);

    for (i = 0; i < 40 && IsWindow(box); i++) {
        settle(1);
    }

    probe("closed", label, IsWindow(box) ? "no" : "yes");

    box = wait(label);
    probe("after", label, box ? "another box" : "");

    if (box) {
        PostMessage(box, WM_COMMAND, IDCANCEL, 0L);
        settle(20);
    }
}

static void item(LPCSTR label, LPCSTR command, LPCSTR button)
{
    execute(command);
    open(label, button);
}

int PASCAL WinMain(HINSTANCE module, HINSTANCE previous, LPSTR command, int show)
{
    OFSTRUCT of;
    HFILE file;

    probeOpen(OUTPUT);
    OpenFile(LOG, &of, OF_DELETE);
    mkdir(FOLDER);
    file = _lcreat(DOCUMENT, 0);
    _lwrite(file, "pmi", 3);
    _lclose(file);
    file = _lcreat(LONELY, 0);
    _lwrite(file, "zqx", 3);
    _lclose(file);
    WriteProfileString("extensions", "pmi", "PMITEMC.EXE ^.pmi");

    ddeOpen(module);
    connect(TRUE);

    if (!conv) {
        probeFinish();
        return 0;
    }

    frame = FindWindow("Progman", NULL);
    execute("[CreateGroup(PM Item)]");

    item("args", "[AddItem(C:\\WINDOWS\\PMITEMC.EXE one two,Args)]", "OK");
    item("directory", "[AddItem(C:\\WINDOWS\\PMITEMC.EXE dir,Dir,,,,,C:\\ORACLE\\PMDIR)]", "OK");
    item("lower", "[AddItem(c:\\windows\\pmitemc.exe Low Case,Low,,,,,c:\\oracle\\pmdir)]", "OK");
    item("bare", "[AddItem(PMITEMC.EXE bare,Bare)]", "OK");
    item("minimized", "[AddItem(C:\\WINDOWS\\PMITEMC.EXE min,Min,,,,,,,1)]", "OK");
    item("document", "[AddItem(C:\\ORACLE\\PMITEM.PMI,Doc)]", "OK");
    item("missing", "[AddItem(C:\\WINDOWS\\NOSUCH.EXE gone,Missing)]", "OK");
    item("unassociated", "[AddItem(C:\\ORACLE\\PMITEM.ZQX,Lonely)]", "OK");
    item("bad-directory", "[AddItem(C:\\WINDOWS\\PMITEMC.EXE bad,Bad,,,,,C:\\NOSUCH)]", "Cancel");
    open("bad-directory-ok", "OK");

    execute("[DeleteGroup(PM Item)]");
    execute("[ExitProgman(0)]");
    gone();

    WriteProfileString("extensions", "pmi", NULL);
    OpenFile(DOCUMENT, &of, OF_DELETE);
    OpenFile(LONELY, &of, OF_DELETE);
    OpenFile(LOG, &of, OF_DELETE);
    rmdir(FOLDER);

    disconnect();
    DdeFreeStringHandle(instance, service);
    DdeUninitialize(instance);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
