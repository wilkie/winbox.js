/*
 * DdeUninitialize's wait for its conversations' WM_DDE_TERMINATE, and the
 * TermDialog it shows when a partner does not answer in time.
 *
 * Read out of `DDEML.DLL` seg1: the first `DdeInitialize` since DDEML was
 * loaded reads `[DDEML]` `ShutdownTimeout` (3000 ms unless set) and
 * `ShutdownRetryTimeout` (30000 ms) from WIN.INI (`00b4`-`0146`).
 * `DdeUninitialize` ends each conversation and waits, taking and
 * dispatching every message of its task, with timer 2 on its `DMGClass`
 * window (`040c`-`0513`); when the time is up it shows `TermDialog`
 * (`049c`-`04cb`), whose procedure, `TERMDLGPROC` (`036a`), ends the dialog
 * with the number of a WM_COMMAND of 3, 4 or 5: Close stops the waiting,
 * Retry waits `ShutdownRetryTimeout` more, Continue waits on with no timer
 * (`04d0`-`04f8`).
 *
 * The partner is DDETERMC.EXE (`ddeterm.child.c`), a server of plain DDE
 * that does not answer WM_DDE_TERMINATE until told. This program sets the
 * two times in WIN.INI to 1000 and 2000 ms before its first
 * `DdeInitialize`, and watches for the dialog with a timer of its own
 * window's, every 100 ms, which DDEML's loop and the dialog's dispatch:
 * the dialog is found among the task's windows by its class, `#32770`, and
 * described -- its title, owner, whether it is active, its rectangle, and
 * each control's class, number, text and style -- and then answered by a
 * WM_COMMAND posted to it. The times are written as `ok` when they are at
 * least the time set and less than a second and a half over it.
 *
 * The scenarios: IDCANCEL (ignored), then Retry, then Continue, after which
 * the server is told to answer; and Close, with the server deaf.
 */

#define PROBE_FLUSH
#include "probe.h"
#include <dde.h>
#include <ddeml.h>

#pragma library("ddeml")

#define OUTPUT "C:\\ORACLE\\DDETERM.OUT"
#define LOG "C:\\ORACLE\\DDET.TXT"

static HWND mine;
static FARPROC findThunk;
static FARPROC controlThunk;
static HWND server;
static HWND found;
static int phase;
static DWORD mark;
static DWORD started;
static BOOL gone;
static int seen;
static char text[2000];
static char out[1800];

static void settle(int times)
{
    MSG message;
    int i;

    for (i = 0; i < times; i++) {
        while (PeekMessage(&message, NULL, 0, 0, PM_REMOVE | PM_NOYIELD)) {
            TranslateMessage(&message);
            DispatchMessage(&message);
        }

        Yield();
    }
}

/* The server's lines written since last asked, `|` between, after `head`. */
static void since(LPCSTR function, LPCSTR what, LPCSTR head)
{
    HFILE file;
    int length = 0;
    int i;
    int lines = 0;
    int at;

    file = _lopen(LOG, OF_READ);

    if (file != HFILE_ERROR) {
        length = _lread(file, text, sizeof(text) - 1);
        _lclose(file);
    }

    text[length < 0 ? 0 : length] = '\0';
    lstrcpy(out, head);
    at = lstrlen(out);
    out[at++] = '|';

    for (i = 0; text[i]; i++) {
        if (text[i] == '\r') {
            continue;
        }

        if (text[i] == '\n') {
            lines++;

            if (lines > seen && out[at - 1] != '|') {
                out[at++] = '|';
            }

            continue;
        }

        if (lines >= seen && at < (int)sizeof(out) - 2) {
            out[at++] = text[i];
        }
    }

    if (out[at - 1] == '|') {
        at--;
    }

    out[at] = '\0';
    seen = lines;
    probe(function, what, out);
}

static LPCSTR timing(DWORD from, DWORD least)
{
    DWORD taken = GetTickCount() - from;

    return taken < least ? "early" : taken < least + 1500 ? "ok" : "late";
}

BOOL CALLBACK __export FindDialog(HWND window, LPARAM lParam)
{
    char kind[24];

    (void)lParam;
    GetClassName(window, kind, sizeof(kind));

    if (!lstrcmp(kind, "#32770") && IsWindowVisible(window)) {
        found = window;
        return FALSE;
    }

    return TRUE;
}

static HWND dialog(void)
{
    found = NULL;
    EnumTaskWindows(GetCurrentTask(), (WNDENUMPROC)findThunk, 0L);
    return found;
}

BOOL CALLBACK __export Control(HWND window, LPARAM lParam)
{
    char kind[24];
    char words[120];
    LPSTR into = (LPSTR)lParam;

    GetClassName(window, kind, sizeof(kind));
    GetWindowText(window, words, sizeof(words));
    wsprintf(into + lstrlen(into), "|%s:%d:%s:%lx", (LPSTR)kind, GetDlgCtrlID(window),
             (LPSTR)words, GetWindowLong(window, GWL_STYLE) & 0xffffL);
    return TRUE;
}

/* The dialog, described. */
static void describe(HWND box, LPCSTR when, LPCSTR time)
{
    char title[80];
    char kind[24];
    HWND owner = (HWND)GetWindowWord(box, GWW_HWNDPARENT);
    RECT rect;
    static char line[1200];

    GetWindowText(box, title, sizeof(title));
    lstrcpy(kind, "none");

    if (owner) {
        GetClassName(owner, kind, sizeof(kind));
    }

    GetWindowRect(box, &rect);
    wsprintf(line, "%s,%s,owner=%s,active=%d,style=%lx,%d,%d,%d,%d", (LPSTR)time, (LPSTR)title,
             (LPSTR)kind, GetActiveWindow() == box, GetWindowLong(box, GWL_STYLE), rect.left,
             rect.top, rect.right, rect.bottom);
    EnumChildWindows(box, (WNDENUMPROC)controlThunk, (LPARAM)(LPSTR)line);
    probe("TermDialog", when, line);
}

LONG FAR PASCAL __export Proc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    HWND box;

    if (message != WM_TIMER) {
        return DefWindowProc(hwnd, message, wParam, lParam);
    }

    box = dialog();

    /* Should a step never come, the dialog is closed and the server
     * answers, so the run ends. */
    if (phase && GetTickCount() - started > 20000L) {
        if (box) {
            PostMessage(box, WM_COMMAND, 3, 0L);
        }

        PostMessage(server, WM_USER + 1, 0, 0L);
        probe("stuck", "", "closed");
        phase = 0;
        return 0;
    }

    switch (phase) {
    case 1:
        if (box) {
            describe(box, "first", timing(mark, 1000));
            PostMessage(box, WM_COMMAND, IDCANCEL, 0L);
            phase = 2;
        }

        break;

    case 2:
        probe("TermDialog", "after IDCANCEL", box ? "there" : "gone");

        if (box) {
            PostMessage(box, WM_COMMAND, 4, 0L);
        }

        mark = GetTickCount();
        gone = FALSE;
        phase = 3;
        break;

    case 3:
        if (!box) {
            gone = TRUE;
        } else if (gone) {
            describe(box, "after Retry", timing(mark, 2000));
            PostMessage(box, WM_COMMAND, 5, 0L);
            mark = GetTickCount();
            gone = FALSE;
            phase = 4;
        }

        break;

    case 4:
        if (!box) {
            gone = TRUE;
        } else if (gone) {
            probe("TermDialog", "after Continue", "again");
            PostMessage(box, WM_COMMAND, 3, 0L);
            phase = 0;
        }

        if (phase && GetTickCount() - mark > 4000L) {
            probe("TermDialog", "after Continue", "none in 4 s");
            PostMessage(server, WM_USER + 1, 0, 0L);
            phase = 5;
        }

        break;

    case 11:
        if (box) {
            describe(box, "second instance", timing(mark, 1000));
            PostMessage(box, WM_COMMAND, 3, 0L);
            phase = 12;
        }

        break;
    }

    return 0;
}

HDDEDATA CALLBACK __export Callback(UINT type, UINT format, HCONV which, HSZ one, HSZ two,
                                    HDDEDATA data, DWORD first, DWORD second)
{
    (void)type;
    (void)format;
    (void)which;
    (void)one;
    (void)two;
    (void)data;
    (void)first;
    (void)second;
    return 0;
}

int PASCAL WinMain(HINSTANCE module, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HFILE file;
    DWORD instance;
    HCONV conv;
    PFNCALLBACK callback;
    HSZ service;
    HSZ topic;
    char head[80];
    int i;

    probeOpen(OUTPUT);
    findThunk = MakeProcInstance((FARPROC)FindDialog, module);
    controlThunk = MakeProcInstance((FARPROC)Control, module);
    file = _lcreat(LOG, 0);
    _lclose(file);

    kind.style = 0;
    kind.lpfnWndProc = Proc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = module;
    kind.hIcon = NULL;
    kind.hCursor = LoadCursor(NULL, IDC_ARROW);
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "DdeTermC";
    RegisterClass(&kind);

    mine = CreateWindow("DdeTermC", "Probe C", WS_OVERLAPPEDWINDOW, 40, 40, 200, 150, NULL, NULL,
                        module, NULL);
    ShowWindow(mine, SW_SHOWNORMAL);

    wsprintf(head, "%d,%d", WriteProfileString("DDEML", "ShutdownTimeout", "1000"),
             WriteProfileString("DDEML", "ShutdownRetryTimeout", "2000"));
    probe("WriteProfileString", "DDEML,1000,2000", head);

    WinExec("DDETERMC.EXE", SW_SHOWNOACTIVATE);

    for (i = 0; i < 300 && !FindWindow(NULL, "Term Server"); i++) {
        settle(1);
    }

    server = FindWindow(NULL, "Term Server");
    since("WinExec", "DDETERMC.EXE", server ? "started" : "none");

    if (!server) {
        probeFinish();
        return 0;
    }

    callback = (PFNCALLBACK)MakeProcInstance((FARPROC)Callback, module);

    /* IDCANCEL, Retry, Continue, and the server answering. */
    instance = 0;
    wsprintf(head, "%u",
             DdeInitialize(&instance, callback, APPCMD_CLIENTONLY | CBF_SKIP_ALLNOTIFICATIONS,
                           0L));
    since("DdeInitialize", "first", head);
    service = DdeCreateStringHandle(instance, "TERMSRV", CP_WINANSI);
    topic = DdeCreateStringHandle(instance, "TTOPIC", CP_WINANSI);
    conv = DdeConnect(instance, service, topic, NULL);
    DdeFreeStringHandle(instance, service);
    DdeFreeStringHandle(instance, topic);
    settle(20);
    wsprintf(head, "%s,%x", (LPSTR)(conv ? "conv" : "0"), DdeGetLastError(instance));
    since("DdeConnect", "first", head);

    SetTimer(mine, 1, 100, NULL);
    started = mark = GetTickCount();
    phase = 1;
    i = DdeUninitialize(instance);
    phase = 0;
    wsprintf(head, "%d,%s", i, (LPSTR)(dialog() ? "dialog" : "none"));
    since("DdeUninitialize", "first", head);
    settle(20);
    since("after", "first", IsWindow((HWND)LOWORD(conv)) ? "conv" : "conv gone");

    /* Close, the server deaf. */
    PostMessage(server, WM_USER + 2, 0, 0L);
    settle(20);
    instance = 0;
    wsprintf(head, "%u",
             DdeInitialize(&instance, callback, APPCMD_CLIENTONLY | CBF_SKIP_ALLNOTIFICATIONS,
                           0L));
    since("DdeInitialize", "second", head);
    service = DdeCreateStringHandle(instance, "TERMSRV", CP_WINANSI);
    topic = DdeCreateStringHandle(instance, "TTOPIC", CP_WINANSI);
    conv = DdeConnect(instance, service, topic, NULL);
    DdeFreeStringHandle(instance, service);
    DdeFreeStringHandle(instance, topic);
    settle(20);
    wsprintf(head, "%s,%x", (LPSTR)(conv ? "conv" : "0"), DdeGetLastError(instance));
    since("DdeConnect", "second", head);

    started = mark = GetTickCount();
    phase = 11;
    i = DdeUninitialize(instance);
    phase = 0;
    wsprintf(head, "%d,%s,%s", i, (LPSTR)(dialog() ? "dialog" : "none"),
             (LPSTR)(IsWindow((HWND)LOWORD(conv)) ? "conv" : "conv gone"));
    since("DdeUninitialize", "second", head);

    /* The server answers late, to a window that is gone. */
    PostMessage(server, WM_USER + 1, 0, 0L);
    settle(30);
    since("server answers", "second", "posted");

    KillTimer(mine, 1);
    PostMessage(server, WM_USER + 9, 0, 0L);

    for (i = 0; i < 300 && IsWindow(server); i++) {
        settle(1);
    }

    since("server closed", "", IsWindow(server) ? "running" : "closed");
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
