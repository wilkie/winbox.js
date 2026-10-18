/*
 * DDEML's synchronous transactions nested, and a time-out longer than
 * FFFFh milliseconds.
 *
 * Read out of `DDEML.DLL` seg1, the modal loop of a synchronous
 * transaction (`59cc`): no instance of the calling task may already be
 * waiting -- it walks the instances whose task is the caller's (`20a0`)
 * and answers DMLERR_REENTRANCY, set in the calling instance, where one
 * has a window at its offset 28h (`59d7`-`59f2`). The time-out is set with
 * `SetTimer`, at most FFFFh milliseconds at a time, and what is left
 * waited after each tick (`5a07`-`5a71`, `5ab2`-`5abc`).
 *
 * This program holds two client instances, A and B, A with two
 * conversations, each with DDENESTC.EXE (`ddenest.child.c`), a server
 * whose callback blocks the item "block". While A waits on a request of
 * "block", a message posted to this program's window before it is
 * dispatched by the loop, and makes from it: B's synchronous request, B's
 * asynchronous one, and A's on its second conversation. Then the server's
 * own client instance makes a synchronous request of its server while A
 * waits. Last, A waits on "block" with a time-out of 10000h + 500
 * milliseconds; its time, by `GetTickCount`, is written `ok` where it is
 * no less than that, but for two of the clock's ticks of 55 ms, and less
 * than a second and a half more: waited in one piece of FFFFh, or cut to
 * its low word, it would be `early`.
 *
 * Each record is a step, its answer -- `0`, `1` or `h` for a data handle,
 * and `DdeGetLastError`'s -- then `C:` lines this program wrote, then the
 * server's lines since the one before.
 */

#define PROBE_FLUSH
#include "probe.h"
#include <ddeml.h>

#pragma library("ddeml")

#define OUTPUT "C:\\ORACLE\\DDENEST.OUT"
#define LOG "C:\\ORACLE\\DDER.TXT"

static DWORD a;
static DWORD b;
static HCONV first;
static HCONV second;
static HCONV other;
static HWND mine;
static HWND server;
static int seen;
static char text[2000];
static char out[1800];
static char lines[600];

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

static void since(LPCSTR function, LPCSTR what, LPCSTR head)
{
    HFILE file;
    int length = 0;
    int i;
    int count = 0;
    int at;

    settle(30);
    file = _lopen(LOG, OF_READ);

    if (file != HFILE_ERROR) {
        length = _lread(file, text, sizeof(text) - 1);
        _lclose(file);
    }

    text[length < 0 ? 0 : length] = '\0';
    lstrcpy(out, head);

    if (lines[0]) {
        lstrcat(out, "|");
        lstrcat(out, lines);
        lines[0] = '\0';
    }

    at = lstrlen(out);
    out[at++] = '|';

    for (i = 0; text[i]; i++) {
        if (text[i] == '\r') {
            continue;
        }

        if (text[i] == '\n') {
            count++;

            if (count > seen && out[at - 1] != '|') {
                out[at++] = '|';
            }

            continue;
        }

        if (count >= seen && at < (int)sizeof(out) - 2) {
            out[at++] = text[i];
        }
    }

    if (out[at - 1] == '|') {
        at--;
    }

    out[at] = '\0';
    seen = count;
    probe(function, what, out);
}

static void add(LPCSTR line)
{
    if (lstrlen(lines) + lstrlen(line) + 2 < sizeof(lines)) {
        if (lines[0]) {
            lstrcat(lines, "|");
        }

        lstrcat(lines, line);
    }
}

HDDEDATA CALLBACK __export Callback(UINT type, UINT format, HCONV which, HSZ one, HSZ two,
                                    HDDEDATA data, DWORD first, DWORD second)
{
    char line[60];

    (void)format;
    (void)one;
    (void)two;
    (void)data;
    (void)first;
    (void)second;

    if (type == XTYP_XACT_COMPLETE) {
        wsprintf(line, "C:complete:%s", (LPSTR)(which == other ? "B" : "A"));
        add(line);
    }

    return 0;
}

/* A request, its answer and error as `answer,error`. */
static LPSTR request(DWORD instance, HCONV conv, LPCSTR item, DWORD timeout, LPSTR into)
{
    HSZ hsz = DdeCreateStringHandle(instance, item, CP_WINANSI);
    DWORD result;
    HDDEDATA answer;

    answer = DdeClientTransaction(NULL, 0, conv, hsz, CF_TEXT, XTYP_REQUEST, timeout, &result);
    wsprintf(into, "%s,%x", (LPSTR)(answer == 0 ? "0" : (DWORD)answer == 1 ? "1" : "h"),
             DdeGetLastError(instance));

    if ((DWORD)answer > 1) {
        DdeFreeDataHandle(answer);
    }

    DdeFreeStringHandle(instance, hsz);
    return into;
}

LONG FAR PASCAL __export Proc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    char line[60];
    char answer[24];

    if (message == WM_USER + 1) {
        wsprintf(line, "C:B-sync:%s", request(b, other, "alpha", 1000, answer));
        add(line);
        wsprintf(line, "C:A-err:%x", DdeGetLastError(a));
        add(line);
        wsprintf(line, "C:B-async:%s", request(b, other, "beta", TIMEOUT_ASYNC, answer));
        add(line);
        wsprintf(line, "C:A-second:%s", request(a, second, "gamma", 1000, answer));
        add(line);
        return 0;
    }

    if (message == WM_TIMER) {
        HWND box = GetSysModalWindow();

        if (box) {
            GetWindowText(box, line, sizeof(line));
            add("C:dialog");
            PostMessage(box, WM_COMMAND, 3, 0L);
        }

        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

static HCONV connect(DWORD instance)
{
    HSZ s = DdeCreateStringHandle(instance, "REENSRV", CP_WINANSI);
    HSZ t = DdeCreateStringHandle(instance, "RTOPIC", CP_WINANSI);
    HCONV conv = DdeConnect(instance, s, t, NULL);

    DdeFreeStringHandle(instance, s);
    DdeFreeStringHandle(instance, t);
    return conv;
}

int PASCAL WinMain(HINSTANCE module, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HFILE file;
    PFNCALLBACK callback;
    DWORD started;
    DWORD taken;
    char head[80];
    char answer[24];
    int i;

    probeOpen(OUTPUT);
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
    kind.lpszClassName = "DdeReenC";
    RegisterClass(&kind);

    mine = CreateWindow("DdeReenC", "Probe C", WS_OVERLAPPEDWINDOW, 40, 40, 200, 150, NULL, NULL,
                        module, NULL);

    callback = (PFNCALLBACK)MakeProcInstance((FARPROC)Callback, module);
    wsprintf(head, "%u,%u",
             DdeInitialize(&a, callback, APPCMD_CLIENTONLY | CBF_SKIP_ALLNOTIFICATIONS, 0L),
             DdeInitialize(&b, callback, APPCMD_CLIENTONLY | CBF_SKIP_ALLNOTIFICATIONS, 0L));
    probe("DdeInitialize", "A,B", head);

    WinExec("DDENESTC.EXE", SW_SHOWNOACTIVATE);

    for (i = 0; i < 300 && !FindWindow(NULL, "Reen Server"); i++) {
        settle(1);
    }

    server = FindWindow(NULL, "Reen Server");
    since("WinExec", "DDENESTC.EXE", server ? "started" : "none");

    if (!server) {
        probeFinish();
        return 0;
    }

    first = connect(a);
    second = connect(a);
    other = connect(b);
    wsprintf(head, "%d,%d,%d", first != 0, second != 0, other != 0);
    since("DdeConnect", "A,A,B", head);

    /* Nested in this task's wait. */
    PostMessage(mine, WM_USER + 1, 0, 0L);
    wsprintf(head, "%s", request(a, first, "block", 1500, answer));
    since("xact", "A,block,nested", head);
    PostMessage(server, WM_USER + 4, 0, 0L);
    since("server enable", "", "posted");

    /* Another task's wait beside this one's. */
    PostMessage(server, WM_USER + 3, 0, 0L);
    wsprintf(head, "%s", request(a, first, "block", 3000, answer));
    since("xact", "A,block,server's own", head);
    PostMessage(server, WM_USER + 4, 0, 0L);
    since("server enable", "", "posted");

    /* Longer than FFFFh milliseconds. */
    started = GetTickCount();
    request(a, first, "block", 0x10000L + 500, answer);
    taken = GetTickCount() - started;
    wsprintf(head, "%s,%s", (LPSTR)answer,
             (LPSTR)(taken < 0x10000L + 500 - 110 ? "early"
                     : taken < 0x10000L + 2000      ? "ok"
                                                    : "late"));
    since("xact", "A,block,10000h+500", head);
    PostMessage(server, WM_USER + 4, 0, 0L);
    since("server enable", "", "posted");

    /* Should a partner not answer its WM_DDE_TERMINATE, DdeUninitialize's
     * dialog is closed. */
    SetTimer(mine, 2, 500, NULL);
    wsprintf(head, "%d,%d,%d", DdeDisconnect(first), DdeDisconnect(second),
             DdeDisconnect(other));
    since("DdeDisconnect", "A,A,B", head);
    wsprintf(head, "%d", DdeUninitialize(a));
    since("DdeUninitialize", "A", head);
    wsprintf(head, "%d", DdeUninitialize(b));
    since("DdeUninitialize", "B", head);

    PostMessage(server, WM_USER + 9, 0, 0L);

    for (i = 0; i < 300 && IsWindow(server); i++) {
        settle(1);
    }

    since("server closed", "", IsWindow(server) ? "running" : "closed");
    KillTimer(mine, 2);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
