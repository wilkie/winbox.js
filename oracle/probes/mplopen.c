/*
 * Media Player's File Open, from outside: `MPLAYER.EXE` started, its File
 * menu's first command posted to it, and the Open dialog it shows read.
 * Media Player hands `COMMDLG.DLL` a hook that enables or disables the
 * file controls for the type of file chosen (`MPLAYER.EXE` seg2 `023c`),
 * and reads its own table of devices to know which; the hook finds that
 * table only where it is called with Media Player's data segment.
 * Recorded on the installation with sound, where Media Player has devices,
 * and on the VGA's, without, where it says it has none and ends.
 *
 * * `exec`: WinExec's answer, `inst` for an instance.
 * * `player`: whether Media Player's window was found, and is still there
 *   two seconds on (`gone` where it has ended).
 * * `box`: any other box shown meanwhile -- MCISEQ's about the MIDI setup,
 *   say -- its title and its first static's text, and OK pressed in it.
 * * `menu`: the File menu's first command's text.
 * * `types`: the types' list (`cmb1`, 470h): each type, and the selection.
 * * `enabled`: for each of the controls the hook enables or disables, and
 *   the types' list, its identifier in hexadecimal and whether it is
 *   enabled; as the dialog opens, and again once the first type is chosen
 *   (`CB_SETCURSEL` and `CBN_SELCHANGE`, as a choice from the list sends).
 * * `dir`: the directory the dialog shows, and the directories' count. (Not
 *   the files': the recorder puts the probe itself among them.)
 * * `closed`: whether the dialog and Media Player have gone, once Cancel
 *   and then `WM_CLOSE` are posted.
 */

#define PROBE_FLUSH
#include "probe.h"
#include <dlgs.h>

#define OUTPUT "C:\\ORACLE\\MPLOPEN.OUT"

static HWND player;
static HWND dialog;

/* A box of another program's not otherwise looked for: recorded, and OK
 * pressed in it. */
BOOL CALLBACK _export Box(HWND window, LPARAM lParam)
{
    char className[32];
    char title[80];
    char text[160];
    HWND child;

    (void)lParam;

    if (!IsWindowVisible(window) || window == player || window == dialog) {
        return TRUE;
    }

    GetClassName(window, className, sizeof(className));

    if (lstrcmp(className, "#32770") != 0) {
        return TRUE;
    }

    GetWindowText(window, title, sizeof(title));

    if (lstrcmp(title, "Open") == 0) {
        return TRUE;
    }

    text[0] = '\0';

    for (child = GetWindow(window, GW_CHILD); child; child = GetWindow(child, GW_HWNDNEXT)) {
        GetClassName(child, className, sizeof(className));

        if (lstrcmpi(className, "Static") == 0 && GetWindowTextLength(child) > 0) {
            GetWindowText(child, text, sizeof(text));
            break;
        }
    }

    wsprintf(probeResult, "%s|%s", (LPSTR)title, (LPSTR)text);
    probe("box", "", probeResult);
    PostMessage(window, WM_COMMAND, IDOK, 0L);
    return TRUE;
}

static FARPROC boxes;

/* Lets the others run for a while, pressing OK in any box they show. */
static void settle(DWORD milliseconds)
{
    DWORD start = GetTickCount();
    DWORD swept = start;
    MSG msg;

    while (GetTickCount() - start < milliseconds) {
        if (GetTickCount() - swept > 250) {
            EnumWindows((WNDENUMPROC)boxes, 0L);
            swept = GetTickCount();
        }

        if (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
            DispatchMessage(&msg);
        } else {
            Yield();
        }
    }
}

/* A top-level window found by its class or its title, waited for. */
static HWND waitFor(LPCSTR className, LPCSTR title)
{
    int tries;
    HWND found = NULL;

    for (tries = 0; tries < 40 && !found; tries++) {
        settle(250);
        found = FindWindow(className, title);
    }

    return found;
}

static const int CONTROLS[] = {stc3, edt1, lst1, lst2, stc1, cmb2, cmb1};

static void enabled(LPCSTR when)
{
    LPSTR at = probeResult;
    int i;

    *at = '\0';

    for (i = 0; i < (int)(sizeof(CONTROLS) / sizeof(CONTROLS[0])); i++) {
        HWND control = GetDlgItem(dialog, CONTROLS[i]);

        at += wsprintf(at, "%s%x=%d", (LPSTR)(i ? "," : ""), CONTROLS[i],
                       control ? (IsWindowEnabled(control) ? 1 : 0) : -1);
    }

    probe("enabled", when, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    UINT answer;
    HMENU file;
    UINT id;
    char text[80];
    LPSTR at;
    int count;
    int i;
    HWND types;

    probeOpen(OUTPUT);
    boxes = MakeProcInstance((FARPROC)Box, instance);

    answer = WinExec("C:\\WINDOWS\\MPLAYER.EXE", SW_SHOWNORMAL);

    if (answer > 32) {
        lstrcpy(probeResult, "inst");
    } else {
        wsprintf(probeResult, "%u", answer);
    }

    probe("exec", "MPLAYER.EXE", probeResult);
    player = waitFor("Media Player", NULL);
    settle(2000);
    probe("player", "", player ? (IsWindow(player) ? "found" : "gone") : "none");

    if (!player || !IsWindow(player)) {
        probeFinish();
        return 0;
    }

    file = GetSubMenu(GetMenu(player), 0);
    id = GetMenuItemID(file, 0);
    GetMenuString(file, 0, text, sizeof(text), MF_BYPOSITION);
    wsprintf(probeResult, "%s", (LPSTR)text);
    probe("menu", "File 0", probeResult);

    PostMessage(player, WM_COMMAND, id, 0L);
    dialog = waitFor(NULL, "Open");
    settle(1000);
    probe("dialog", "", dialog ? "found" : "none");

    if (!dialog) {
        PostMessage(player, WM_CLOSE, 0, 0L);
        settle(2000);
        probeFinish();
        return 0;
    }

    types = GetDlgItem(dialog, cmb1);
    count = (int)SendMessage(types, CB_GETCOUNT, 0, 0L);
    at = probeResult;
    at += wsprintf(at, "sel=%d", (int)SendMessage(types, CB_GETCURSEL, 0, 0L));

    for (i = 0; i < count; i++) {
        text[0] = '\0';
        SendMessage(types, CB_GETLBTEXT, i, (LPARAM)(LPSTR)text);
        at += wsprintf(at, "|%s", (LPSTR)text);
    }

    probe("types", "", probeResult);
    enabled("open");

    GetDlgItemText(dialog, stc1, text, sizeof(text));
    wsprintf(probeResult, "%s,dirs=%d", (LPSTR)text,
             (int)SendDlgItemMessage(dialog, lst2, LB_GETCOUNT, 0, 0L));
    probe("dir", "open", probeResult);

    SendMessage(types, CB_SETCURSEL, 0, 0L);
    SendMessage(dialog, WM_COMMAND, cmb1, MAKELPARAM(types, CBN_SELCHANGE));
    settle(500);
    enabled("first type");

    PostMessage(dialog, WM_COMMAND, IDCANCEL, 0L);
    settle(1000);
    PostMessage(player, WM_CLOSE, 0, 0L);
    settle(2000);
    wsprintf(probeResult, "dialog=%d,player=%d", IsWindow(dialog) ? 1 : 0,
             IsWindow(player) ? 1 : 0);
    probe("closed", "", probeResult);

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
