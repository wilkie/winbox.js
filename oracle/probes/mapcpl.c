/*
 * The MIDI Mapper's Control Panel applet, called as Control Panel calls it
 * (`CONTROL.EXE` seg1 `4ff`, `6f8`), on the installation with a sound card
 * (`--display vgasound`): for how an applet of WinBox's own mapper must
 * answer, and how the applet and the mapper MMSYSTEM opens keep out of each
 * other's way.
 *
 * * `walk`: the installable drivers walked as Control Panel walks them,
 *   first instances only, each driver's file loaded as a library and asked
 *   for `CPlApplet`: how many have one, the alias of the one that has,
 *   and whether loading its file gave the driver's own module.
 * * `init`, `count`, `inquire`, `newinquire`: what the applet answers
 *   `CPL_INIT`, `CPL_GETCOUNT`, `CPL_INQUIRE` and `CPL_NEWINQUIRE` for its
 *   one applet, and what it filled in.
 * * `open`: what opening `MIDI_MAPPER` answers with the applet initialised,
 *   while its dialog is up, and after it has closed, with the mapper's
 *   channel mask once opened.
 * * `dialog`: the applet's dialog as `CPL_DBLCLK` shows it: its caption,
 *   the setups its combo box lists, the one selected, the description, the
 *   text of its button 1 and whether the combo box is enabled; then again
 *   once "Ad Lib general" is chosen in it, told as USER tells it of a
 *   choice (`CBN_SELCHANGE`, then `CBN_SELENDOK`). Button 1 pressed closes
 *   it.
 * * `dblclk`: what `CPL_DBLCLK` answered.
 * * `current`: `MIDIMAP.CFG`'s current setup's number (the word at 6).
 * * `box`: the message box `CPL_DBLCLK` shows with the mapper open, its
 *   caption and text, Enter pressed on it.
 * * `select`, `stop`, `exit`: what `CPL_SELECT`, `CPL_STOP` and `CPL_EXIT`
 *   answer.
 */

#define PROBE_FLUSH
#include "probe.h"
#include <mmsystem.h>

#define OUTPUT "C:\\ORACLE\\MAPCPL.OUT"

#define CPL_INIT 1
#define CPL_GETCOUNT 2
#define CPL_INQUIRE 3
#define CPL_SELECT 4
#define CPL_DBLCLK 5
#define CPL_STOP 6
#define CPL_EXIT 7
#define CPL_NEWINQUIRE 8

typedef struct {
    int idIcon;
    int idName;
    int idInfo;
    LONG lData;
} CPLINFO;

typedef struct {
    DWORD dwSize;
    DWORD dwFlags;
    DWORD dwHelpContext;
    LONG lData;
    HICON hIcon;
    char szName[32];
    char szInfo[64];
    char szHelpFile[128];
} NEWCPLINFO;

typedef struct {
    UINT length;
    HANDLE hDriver;
    HINSTANCE hModule;
    char szAliasName[128];
} DRIVERINFO;

typedef LONG(FAR PASCAL *APPLET)(HWND, UINT, LONG, LONG);
typedef HANDLE(FAR PASCAL *NEXTPROC)(HANDLE, DWORD);
typedef BOOL(FAR PASCAL *INFOPROC)(HANDLE, DRIVERINFO FAR *);
typedef HINSTANCE(FAR PASCAL *MODULEPROC)(HANDLE);

#define SETUPS 0x64
#define DESCRIPTION 0x6e

static HWND owner;
static APPLET applet;
static LPCSTR phase = "";
static int step;

/* The applet's dialog: its caption, the setups listed, the one chosen, its
 * description, button 1's text, and whether the list is enabled. */
static void look(HWND dialog, LPCSTR when)
{
    HWND combo = GetDlgItem(dialog, SETUPS);
    char caption[80];
    char description[80];
    char button[32];
    char item[64];
    static char list[600];
    int count;
    int chosen;
    int index;

    GetWindowText(dialog, caption, sizeof(caption));
    GetDlgItemText(dialog, DESCRIPTION, description, sizeof(description));
    GetDlgItemText(dialog, IDOK, button, sizeof(button));
    count = (int)SendMessage(combo, CB_GETCOUNT, 0, 0L);
    chosen = (int)SendMessage(combo, CB_GETCURSEL, 0, 0L);
    list[0] = '\0';

    for (index = 0; index < count; index++) {
        item[0] = '\0';
        SendMessage(combo, CB_GETLBTEXT, index, (LPARAM)(LPSTR)item);

        if (lstrlen(list) + lstrlen(item) < (int)sizeof(list) - 2) {
            if (index) {
                lstrcat(list, "|");
            }

            lstrcat(list, item);
        }
    }

    item[0] = '\0';

    if (chosen >= 0) {
        SendMessage(combo, CB_GETLBTEXT, chosen, (LPARAM)(LPSTR)item);
    }

    wsprintf(probeArgs, "%s,%s", phase, when);
    wsprintf(probeResult, "caption=%s,count=%d,setups=%s,chosen=%s,description=%s,button=%s,enabled=%d",
             (LPSTR)caption, count, (LPSTR)list, (LPSTR)item, (LPSTR)description, (LPSTR)button,
             IsWindowEnabled(combo) ? 1 : 0);
    probe("dialog", probeArgs, probeResult);
}

/* `MIDI_MAPPER` opened and closed: what the open answered and, opened, the
 * channels its capabilities give. */
static void openMapper(LPCSTR when)
{
    HMIDIOUT device;
    MIDIOUTCAPS caps;
    UINT result;

    result = midiOutOpen(&device, (UINT)MIDI_MAPPER, 0L, 0L, 0L);

    if (result) {
        wsprintf(probeResult, "%u", result);
    } else {
        _fmemset(&caps, 0, sizeof(caps));
        midiOutGetDevCaps((UINT)MIDI_MAPPER, &caps, sizeof(caps));
        wsprintf(probeResult, "0,mask=%x", caps.wChannelMask);
        midiOutClose(device);
    }

    probe("open", when, probeResult);
}

/* What the box or dialog up is, looked at a step at a time while
 * `CPL_DBLCLK` has not returned. */
void CALLBACK __export Looker(HWND hwnd, UINT message, UINT id, DWORD time)
{
    HWND active = GetActiveWindow();
    HWND focus;
    HWND child;
    char caption[80];
    char text[300];

    if (!active || active == owner) {
        return;
    }

    if (!GetDlgItem(active, SETUPS)) {
        /* A message box: its caption and its text, Enter pressed. */
        GetWindowText(active, caption, sizeof(caption));
        text[0] = '\0';

        for (child = GetWindow(active, GW_CHILD); child; child = GetWindow(child, GW_HWNDNEXT)) {
            char kind[16];

            GetClassName(child, kind, sizeof(kind));

            if (!lstrcmpi(kind, "Static") && GetWindowTextLength(child) > 1) {
                GetWindowText(child, text, sizeof(text));
            }
        }

        wsprintf(probeResult, "caption=%s,text=%s", (LPSTR)caption, (LPSTR)text);
        probe("box", phase, probeResult);
        focus = GetFocus();
        PostMessage(focus ? focus : active, WM_KEYDOWN, VK_RETURN, 0x001c0001L);
        PostMessage(focus ? focus : active, WM_KEYUP, VK_RETURN, 0xc01c0001L);
        return;
    }

    step++;

    if (step == 1) {
        look(active, "shown");
        openMapper("dialog-up");

        if (IsWindowEnabled(GetDlgItem(active, SETUPS))) {
            HWND combo = GetDlgItem(active, SETUPS);

            SendMessage(combo, CB_SELECTSTRING, (WPARAM)-1, (LPARAM)(LPSTR) "Ad Lib general");
            SendMessage(active, WM_COMMAND, SETUPS, MAKELONG(combo, CBN_SELCHANGE));
            /* As USER tells a combo box of a module made for Windows 3.1
             * as its list is put away on a choice. */
            SendMessage(active, WM_COMMAND, SETUPS, MAKELONG(combo, 9));
        }

        return;
    }

    if (step == 2) {
        look(active, "chosen");
        PostMessage(active, WM_COMMAND, IDOK, MAKELONG(GetDlgItem(active, IDOK), BN_CLICKED));
    }
}

static LONG call(LPCSTR name, UINT message, LONG first, LONG second)
{
    LONG answer = applet(owner, message, first, second);

    wsprintf(probeResult, "%ld", answer);
    probe(name, "", probeResult);
    return answer;
}

/* The word at 6 of MIDIMAP.CFG in the system directory. */
static void current(LPCSTR when)
{
    char path[160];
    WORD words[7];
    HFILE file;

    GetSystemDirectory(path, sizeof(path));
    lstrcat(path, "\\MIDIMAP.CFG");
    file = _lopen(path, OF_READ);

    if (file == HFILE_ERROR) {
        probe("current", when, "unopened");
        return;
    }

    words[3] = 0xffff;
    _lread(file, words, sizeof(words));
    _lclose(file);
    wsprintf(probeResult, "%u", words[3]);
    probe("current", when, probeResult);
}

static void doubleClick(LPCSTR name)
{
    LONG answer;
    UINT timer;

    phase = name;
    step = 0;
    timer = SetTimer(NULL, 0, 500, (TIMERPROC)Looker);
    answer = applet(owner, CPL_DBLCLK, 0L, 0L);
    KillTimer(NULL, timer);
    wsprintf(probeResult, "%ld", answer);
    probe("dblclk", name, probeResult);
}

LONG FAR PASCAL _export OwnerProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    return DefWindowProc(hwnd, message, wParam, lParam);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    MSG msg;
    HMODULE user;
    NEXTPROC next;
    INFOPROC info;
    MODULEPROC module;
    HANDLE driver;
    HINSTANCE library = 0;
    char alias[128];
    int applets = 0;
    int same = 0;
    CPLINFO old;
    NEWCPLINFO details;
    HMIDIOUT device;
    UINT result;

    probeOpen(OUTPUT);

    kind.style = 0;
    kind.lpfnWndProc = OwnerProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "ProbeOwner";
    RegisterClass(&kind);

    owner = CreateWindow("ProbeOwner", "Owner", WS_OVERLAPPEDWINDOW, 10, 10, 200, 120, NULL, NULL,
                         instance, NULL);
    ShowWindow(owner, SW_SHOWNORMAL);
    UpdateWindow(owner);

    while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
        DispatchMessage(&msg);
    }

    user = GetModuleHandle("USER");
    next = (NEXTPROC)GetProcAddress(user, MAKEINTRESOURCE(257));
    info = (INFOPROC)GetProcAddress(user, MAKEINTRESOURCE(256));
    module = (MODULEPROC)GetProcAddress(user, MAKEINTRESOURCE(254));
    alias[0] = '\0';

    /* As Control Panel walks them (seg1 `6f8`, `4ff`). */
    for (driver = next(0, 1L); driver; driver = next(driver, 1L)) {
        char file[128];
        HINSTANCE loaded;
        FARPROC found;
        DRIVERINFO about;

        file[0] = '\0';
        GetModuleFileName(module(driver), file, sizeof(file));
        loaded = LoadLibrary(file);

        if (loaded < HINSTANCE_ERROR) {
            continue;
        }

        found = GetProcAddress(loaded, "CPlApplet");

        if (found && !applet) {
            applet = (APPLET)found;
            library = loaded;
            same = loaded == module(driver);
            about.length = sizeof(about);
            about.szAliasName[0] = '\0';
            info(driver, &about);
            lstrcpy(alias, about.szAliasName);
        } else {
            FreeLibrary(loaded);
        }

        if (found) {
            applets++;
        }
    }

    wsprintf(probeResult, "applets=%d,alias=%s,same=%d", applets, (LPSTR)alias, same);
    probe("walk", "", probeResult);

    if (!applet) {
        probeFinish();
        return 0;
    }

    call("init", CPL_INIT, 0L, 0L);
    call("count", CPL_GETCOUNT, 0L, 0L);

    _fmemset(&old, 0, sizeof(old));
    wsprintf(probeResult, "%ld", applet(owner, CPL_INQUIRE, 0L, (LONG)(CPLINFO FAR *)&old));
    wsprintf(probeResult + lstrlen(probeResult), ",icon=%d,name=%d,info=%d,data=%ld", old.idIcon,
             old.idName, old.idInfo, old.lData);
    probe("inquire", "", probeResult);

    _fmemset(&details, 0, sizeof(details));
    wsprintf(probeResult, "%ld", applet(owner, CPL_NEWINQUIRE, 0L, (LONG)(NEWCPLINFO FAR *)&details));
    wsprintf(probeResult + lstrlen(probeResult),
             ",size=%lx,flags=%lx,help=%lx,data=%ld,icon=%d,name=%s,info=%s,file=%s", details.dwSize,
             details.dwFlags, details.dwHelpContext, details.lData, details.hIcon ? 1 : 0,
             (LPSTR)details.szName, (LPSTR)details.szInfo, (LPSTR)details.szHelpFile);
    probe("newinquire", "", probeResult);

    openMapper("initialised");
    current("before");

    /* The dialog with the mapper closed: "Ad Lib general" chosen. */
    doubleClick("closed");
    current("chosen");
    openMapper("after");

    /* And with the mapper open: the box saying so, then the dialog. */
    result = midiOutOpen(&device, (UINT)MIDI_MAPPER, 0L, 0L, 0L);
    wsprintf(probeResult, "%u", result);
    probe("open", "held", probeResult);
    doubleClick("open");

    if (!result) {
        midiOutClose(device);
    }

    current("after-open");

    call("select", CPL_SELECT, 0L, 0L);
    call("stop", CPL_STOP, 0L, 0L);
    call("exit", CPL_EXIT, 0L, 0L);
    FreeLibrary(library);

    DestroyWindow(owner);
    owner = NULL;
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
