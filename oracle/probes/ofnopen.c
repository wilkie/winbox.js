/*
 * COMMDLG's Open dialog, with a hook, in a folder of the probe's own:
 * C:\ORACLE\OFN, holding A.TXT, B.TXT, README, C.DOC, D.TX and the folders
 * SUB (holding E.TXT) and ANOTHER.
 *
 * * `before`: the messages the hook was sent before WM_INITDIALOG, and
 *   WM_INITDIALOG's wParam and whether its lParam is the structure.
 * * `control`: each of the dialog's controls in order, as WM_INITDIALOG
 *   finds them: identifier, class, style, place in the dialog's client
 *   area, text, and whether it is shown and enabled.
 * * `state`: after each step, the focus, the edit's text, the folder's
 *   name the dialog shows, the files' and folders' lists (items, item
 *   height, selection, top), the types' and drives' combo boxes (items,
 *   item data, selection, item height), and the structure's flags.
 * * `box`: a message box the dialog put up: its caption and text; it is
 *   answered with the button the step names.
 * * `hook`: every message the hook was sent while a step ran that is one of
 *   COMMDLG's registered ones, or a WM_COMMAND: number, wParam, lParam.
 * * `result`: what GetOpenFileName answered, the error, and the
 *   structure: file, title, offsets, filter index, flags, custom filter.
 *
 * Steps, each a timer's tick of the hook's apart: a name typed into the
 * edit and OK sent; a list's selection set and its notification sent; a
 * combo box's selection set and its notification sent.
 */

#include "probe.h"
#include <commdlg.h>
#include <dlgs.h>
#include <direct.h>

#pragma library("commdlg")

#define OUTPUT "C:\\ORACLE\\OFNOPEN.OUT"
#define STEP_TIMER 77

/* commdlg.h's, by name: Open Watcom's header has none of them. */
#define LBSELCHSTRING "commdlg_LBSelChangedNotify"
#define SHAREVISTRING "commdlg_ShareViolation"
#define FILEOKSTRING "commdlg_FileNameOK"
#define COLOROKSTRING "commdlg_ColorOK"
#define SETRGBSTRING "commdlg_SetRGBColor"
#define HELPMSGSTRING "commdlg_help"

static OPENFILENAME ofn;
static char file[260];
static char title[64];
static char custom[64];
static char log[1500];
static LPSTR logAt;
static int step;
static BOOL initialised;
static UINT okMessage;
static UINT selMessage;
static UINT shareMessage;
static UINT helpMessage;
static char text[1500];

/* What each step does: `type:NAME` types into the edit and sends OK;
 * `file:N`, `dir:N` select a list's row and notify, `dblfile:N`,
 * `dbldir:N` double click it; `type:N`, `drive:N` choose a combo box's
 * item; `yes`, `no`, `ok` answer a box. */
static const char *STEPS[] = {
    "start",        "type:*.doc",    "type:sub",       "type:..",       "type:nosuch.txt",
    "ok",           "type:c:\\oracle\\ofn\\sub\\e.txt;x", "ok", "types:1", "file:1",
    "dbldir:2",     "dbldir:1",      "drive:0",        "ok",            "type:c:\\oracle\\ofn\\a.txt",
    "end",
};

/* A message noted with what in it does not depend on the machine: a
 * command's control and notification, whether its window is the control's;
 * a registered message's wParam and lParam, the structure named; the
 * control a WM_MEASUREITEM or WM_DRAWITEM is for; else the number alone. */
static HWND noted;

static void note(UINT message, WPARAM wParam, LPARAM lParam)
{
    char part[48];

    if (logAt - log >= (int)sizeof(log) - 48) {
        return;
    }

    if (message == WM_COMMAND) {
        wsprintf(part, "111:%x:%x%s", wParam, HIWORD(lParam),
                 (LPSTR)(noted && (HWND)LOWORD(lParam) == GetDlgItem(noted, wParam) ? "" : "?"));
    } else if (message >= 1 && message <= 4) {
        if (lParam == (LPARAM)(OPENFILENAME FAR *)&ofn) {
            wsprintf(part, "%x:%x:ofn", message, wParam);
        } else {
            wsprintf(part, "%x:%x:%lx", message, wParam, lParam);
        }
    } else if (message == WM_MEASUREITEM || message == WM_DRAWITEM) {
        wsprintf(part, "%x:%x", message, ((UINT FAR *)lParam)[1]);
    } else {
        wsprintf(part, "%x", message);
    }

    if (logAt != log) {
        *logAt++ = ' ';
    }

    lstrcpy(logAt, part);
    logAt += lstrlen(part);
}

static void append(LPSTR at, LPCSTR more)
{
    if (lstrlen(at) + lstrlen(more) < (int)sizeof(text) - 2) {
        lstrcat(at, more);
    }
}

static void listItems(HWND list, BOOL combo, LPSTR out)
{
    int count = (int)SendMessage(list, combo ? CB_GETCOUNT : LB_GETCOUNT, 0, 0L);
    int i;
    char item[96];

    for (i = 0; i < count; i++) {
        item[0] = '\0';
        SendMessage(list, combo ? CB_GETLBTEXT : LB_GETTEXT, i, (LPARAM)(LPSTR)item);
        append(out, i ? "/" : "");
        append(out, item);

        if (combo) {
            wsprintf(item, "=%lx", SendMessage(list, CB_GETITEMDATA, i, 0L));
            append(out, item);
        }
    }
}

static void state(HWND dialog, LPCSTR when)
{
    char part[260];
    HWND focus = GetFocus();
    HWND files = GetDlgItem(dialog, lst1);
    HWND dirs = GetDlgItem(dialog, lst2);
    HWND types = GetDlgItem(dialog, cmb1);
    HWND drives = GetDlgItem(dialog, cmb2);

    GetDlgItemText(dialog, edt1, part, sizeof(part));
    wsprintf(text, "focus=%x,edit=%s,", focus ? GetDlgCtrlID(focus) : 0, (LPSTR)part);
    GetDlgItemText(dialog, stc1, part, sizeof(part));
    append(text, "dir=");
    append(text, part);
    wsprintf(part, ",files(%d,%d,%d)=", (int)SendMessage(files, LB_GETITEMHEIGHT, 0, 0L),
             (int)SendMessage(files, LB_GETCURSEL, 0, 0L),
             (int)SendMessage(files, LB_GETTOPINDEX, 0, 0L));
    append(text, part);
    listItems(files, FALSE, text);
    wsprintf(part, ",dirs(%d,%d,%d)=", (int)SendMessage(dirs, LB_GETITEMHEIGHT, 0, 0L),
             (int)SendMessage(dirs, LB_GETCURSEL, 0, 0L),
             (int)SendMessage(dirs, LB_GETTOPINDEX, 0, 0L));
    append(text, part);
    listItems(dirs, FALSE, text);
    wsprintf(part, ",types(%d,%d)=", (int)SendMessage(types, CB_GETITEMHEIGHT, 0, 0L),
             (int)SendMessage(types, CB_GETCURSEL, 0, 0L));
    append(text, part);
    listItems(types, TRUE, text);
    wsprintf(part, ",drives(%d,%d,%d)=", (int)SendMessage(drives, CB_GETITEMHEIGHT, 0, 0L),
             (int)SendMessage(drives, CB_GETITEMHEIGHT, (WPARAM)-1, 0L),
             (int)SendMessage(drives, CB_GETCURSEL, 0, 0L));
    append(text, part);
    listItems(drives, TRUE, text);
    wsprintf(part, ",flags=%lx", ofn.Flags);
    append(text, part);
    probe("state", when, text);
}

static void controls(HWND dialog)
{
    HWND child;
    RECT r;
    char name[64];
    char caption[96];

    GetWindowText(dialog, caption, sizeof(caption));
    GetClientRect(dialog, &r);
    wsprintf(text, "%s|%d,%d", (LPSTR)caption, r.right, r.bottom);
    probe("dialog", "", text);

    for (child = GetWindow(dialog, GW_CHILD); child; child = GetWindow(child, GW_HWNDNEXT)) {
        GetClassName(child, name, sizeof(name));
        GetWindowText(child, caption, sizeof(caption));
        GetWindowRect(child, &r);
        ScreenToClient(dialog, (POINT FAR *)&r.left);
        ScreenToClient(dialog, (POINT FAR *)&r.right);
        wsprintf(text, "%s|%lx|%d,%d,%d,%d|%s|%d%d", (LPSTR)name,
                 GetWindowLong(child, GWL_STYLE), r.left, r.top, r.right, r.bottom,
                 (LPSTR)caption, IsWindowVisible(child) ? 1 : 0, IsWindowEnabled(child) ? 1 : 0);
        wsprintf(name, "%x", GetDlgCtrlID(child));
        probe("control", name, text);
    }
}

/* A box of COMMDLG's up over the dialog, if there is one. */
static HWND box(HWND dialog)
{
    HWND active = GetActiveWindow();

    return active && active != dialog ? active : NULL;
}

static void readBox(HWND found, LPCSTR when)
{
    HWND child;
    char part[260];

    GetWindowText(found, part, sizeof(part));
    lstrcpy(text, part);

    for (child = GetWindow(found, GW_CHILD); child; child = GetWindow(child, GW_HWNDNEXT)) {
        GetWindowText(child, part, sizeof(part));
        append(text, "|");
        append(text, part);
    }

    probe("box", when, text);
}

static void select(HWND dialog, int id, BOOL combo, int index, WORD code)
{
    HWND control = GetDlgItem(dialog, id);

    SendMessage(control, combo ? CB_SETCURSEL : LB_SETCURSEL, index, 0L);
    SendMessage(dialog, WM_COMMAND, id, MAKELPARAM(control, code));
}

static void next(HWND dialog)
{
    const char *what = STEPS[step];
    HWND found = box(dialog);

    probe("hook", what, log);
    logAt = log;
    *logAt = '\0';

    /* The first tick waits for the screen to be taken; the rest are quick. */
    if (step == 0) {
        SetTimer(dialog, STEP_TIMER, 700, NULL);
    }

    /* A box up: read, and answered with the next step's button. */
    if (found) {
        readBox(found, what);

        if (step + 1 < (int)(sizeof(STEPS) / sizeof(STEPS[0]))) {
            const char *answer = STEPS[step + 1];
            int id = !lstrcmp(answer, "yes") ? IDYES : !lstrcmp(answer, "no") ? IDNO : IDOK;
            HWND button = GetDlgItem(found, id);

            if (!button) {
                button = GetDlgItem(found, IDCANCEL);
            }

            /* The button pressed as a person presses it: down and up. */
            PostMessage(button, WM_LBUTTONDOWN, MK_LBUTTON, MAKELPARAM(4, 4));
            PostMessage(button, WM_LBUTTONUP, 0, MAKELPARAM(4, 4));
            step++;
        }

        return;
    }

    state(dialog, what);
    step++;

    if (step >= (int)(sizeof(STEPS) / sizeof(STEPS[0]))) {
        KillTimer(dialog, STEP_TIMER);
        PostMessage(dialog, WM_COMMAND, IDCANCEL, 0L);
        return;
    }

    what = STEPS[step];

    if (!_fstrncmp(what, "type:", 5)) {
        SetDlgItemText(dialog, edt1, what + 5);
        PostMessage(dialog, WM_COMMAND, IDOK, MAKELPARAM(GetDlgItem(dialog, IDOK), 0));
    } else if (!_fstrncmp(what, "file:", 5)) {
        select(dialog, lst1, FALSE, what[5] - '0', LBN_SELCHANGE);
    } else if (!_fstrncmp(what, "dbldir:", 7)) {
        select(dialog, lst2, FALSE, what[7] - '0', LBN_DBLCLK);
    } else if (!_fstrncmp(what, "types:", 6)) {
        select(dialog, cmb1, TRUE, what[6] - '0', CBN_SELCHANGE);
    } else if (!_fstrncmp(what, "drive:", 6)) {
        select(dialog, cmb2, TRUE, what[6] - '0', CBN_SELCHANGE);
    }
}

UINT FAR PASCAL _export Hook(HWND dialog, UINT message, WPARAM wParam, LPARAM lParam)
{
    UINT named = message == okMessage      ? 1
                 : message == selMessage   ? 2
                 : message == shareMessage ? 3
                 : message == helpMessage  ? 4
                                           : message;

    noted = dialog;

    if (!initialised && message != WM_INITDIALOG) {
        note(named, wParam, lParam);
        return FALSE;
    }

    switch (message) {
    case WM_INITDIALOG:
        probe("before", "", log);
        logAt = log;
        *logAt = '\0';
        wsprintf(text, "focus=%x,lParam=%s", wParam ? GetDlgCtrlID((HWND)wParam) : 0,
                 (LPSTR)(lParam == (LPARAM)(OPENFILENAME FAR *)&ofn ? "ofn" : "other"));
        probe("initdialog", "", text);
        initialised = TRUE;
        controls(dialog);
        state(dialog, "initdialog");
        SetTimer(dialog, STEP_TIMER, 15000, NULL);
        return TRUE;
    case WM_COMMAND:
        note(message, wParam, lParam);
        return FALSE;
    case WM_TIMER:
        if (wParam == STEP_TIMER) {
            next(dialog);
            return TRUE;
        }

        return FALSE;
    }

    if (named != message) {
        note(named, wParam, lParam);
    }

    return FALSE;
}

static void make(LPCSTR name)
{
    HFILE handle = _lcreat(name, 0);

    _lwrite(handle, "x", 1);
    _lclose(handle);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    BOOL answer;

    probeOpen(OUTPUT);
    logAt = log;
    *logAt = '\0';

    mkdir("C:\\ORACLE\\OFN");
    mkdir("C:\\ORACLE\\OFN\\SUB");
    mkdir("C:\\ORACLE\\OFN\\ANOTHER");
    make("C:\\ORACLE\\OFN\\A.TXT");
    make("C:\\ORACLE\\OFN\\B.TXT");
    make("C:\\ORACLE\\OFN\\README");
    make("C:\\ORACLE\\OFN\\C.DOC");
    make("C:\\ORACLE\\OFN\\D.TX");
    make("C:\\ORACLE\\OFN\\SUB\\E.TXT");

    okMessage = RegisterWindowMessage(FILEOKSTRING);
    selMessage = RegisterWindowMessage(LBSELCHSTRING);
    shareMessage = RegisterWindowMessage(SHAREVISTRING);
    helpMessage = RegisterWindowMessage(HELPMSGSTRING);
    /* The numbers are USER's; the order COMMDLG registered them in shows,
     * each above the one before (LibMain, seg7 `010b`). */
    {
        UINT color = RegisterWindowMessage(COLOROKSTRING);
        UINT rgb = RegisterWindowMessage(SETRGBSTRING);

        wsprintf(text, "%d%d%d%d%d,%d", shareMessage > selMessage, okMessage > shareMessage,
                 color > okMessage, rgb > color, helpMessage > rgb, selMessage >= 0xc000);
    }
    probe("registered", "", text);

    lstrcpy(custom, "Mine");
    lstrcpy(custom + 5, "*.tx");
    custom[10] = '\0';
    lstrcpy(file, "");
    _fmemset(&ofn, 0, sizeof(ofn));
    ofn.lStructSize = sizeof(ofn);
    ofn.hInstance = instance;
    ofn.lpstrFilter = "Text (*.txt)\0*.txt\0Documents\0*.doc\0All Files\0*.*\0";
    ofn.lpstrCustomFilter = custom;
    ofn.nMaxCustFilter = sizeof(custom);
    ofn.nFilterIndex = 2;
    ofn.lpstrFile = file;
    ofn.nMaxFile = sizeof(file);
    ofn.lpstrFileTitle = title;
    ofn.nMaxFileTitle = sizeof(title);
    ofn.lpstrInitialDir = "C:\\ORACLE\\OFN";
    ofn.lpstrTitle = "Probe's Open";
    ofn.Flags = OFN_ENABLEHOOK | OFN_FILEMUSTEXIST | OFN_SHOWHELP;
    ofn.lpstrDefExt = "txt";
    ofn.lpfnHook = (UINT(CALLBACK *)(HWND, UINT, WPARAM, LPARAM))MakeProcInstance((FARPROC)Hook,
                                                                                   instance);

    answer = GetOpenFileName(&ofn);
    probe("hook", "end", log);
    wsprintf(text, "%d|%lx|file=%s|title=%s|offset=%d|ext=%d|index=%ld|flags=%lx|custom=%s,%s",
             answer ? 1 : 0, CommDlgExtendedError(), (LPSTR)file, (LPSTR)title, ofn.nFileOffset,
             ofn.nFileExtension, ofn.nFilterIndex, ofn.Flags, (LPSTR)custom,
             (LPSTR)(custom + lstrlen(custom) + 1));
    probe("result", "", text);
    getcwd(text, sizeof(text));
    probe("cwd", "after", text);

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
