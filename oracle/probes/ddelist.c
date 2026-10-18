/*
 * DDEML's client with a server that is not DDEML's and acknowledges
 * WM_DDE_INITIATE twice, by DdeConnect and in a conversation list, and the
 * atoms of it counted.
 *
 * Read out of `DDEML.DLL` seg1, the client window's acknowledgement
 * (`709c`): a second acknowledgement to a conversation, state 4, is
 * answered by sending WM_DDE_TERMINATE to its sender and deleting its two
 * atoms where the sender is the partner, or where the conversation is not
 * in a list -- its parent is the instance's own window (`7184`-`71a3`,
 * `730c`-`7327`). In a list, from a window of DDEML's, another conversation
 * is made for it (`7202`); from a window not DDEML's, it sends that window
 * WM_DDE_TERMINATE, initiates again to the window the conversation was
 * made through (`71bb`-`71f0`, through `6a68` with that window), and
 * deletes the atoms unless the application atom is DDEML's "Progman"
 * (`71f3`-`71ff`).
 *
 * The server is DDELISTC.EXE (`ddelist.child.c`): two windows, A
 * answering, B acknowledging after A when told to. Each record is a step,
 * its answer and the server's lines since the one before. A conversation's
 * partner is written by the window in its `hConvPartner`'s low word, `A`
 * or `B`, and the high word, nought for a window not DDEML's. Atoms are
 * counted by name, deleting each until `GlobalFindAtom` no longer finds it
 * and adding it back; an instance of DDEML is held from the start, so
 * "Progman" stays the atom DDEML compares with.
 */

#define PROBE_FLUSH
#include "probe.h"
#include <dde.h>
#include <ddeml.h>

#pragma library("ddeml")

#define OUTPUT "C:\\ORACLE\\DDELIST.OUT"
#define LOG "C:\\ORACLE\\DDEL.TXT"

static DWORD instance;
static HWND serverA;
static HWND serverB;
static int seen;
static char text[3000];
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
    int lines = 0;
    int at;

    settle(30);
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

HDDEDATA CALLBACK __export Callback(UINT type, UINT format, HCONV which, HSZ one, HSZ two,
                                    HDDEDATA data, DWORD first, DWORD second)
{
    (void)format;
    (void)which;
    (void)one;
    (void)two;
    (void)data;
    (void)first;
    (void)second;

    if (type == XTYP_DISCONNECT && lstrlen(lines) < 500) {
        lstrcat(lines, lines[0] ? ",C:disconnect" : "C:disconnect");
    }

    return 0;
}

/* A name's count, by deleting it until it is gone and adding it back. */
static int countOf(LPCSTR name)
{
    ATOM atom;
    int n = 0;
    int i;

    while ((atom = GlobalFindAtom(name)) != 0 && n < 40) {
        GlobalDeleteAtom(atom);
        n++;
    }

    for (i = 0; i < n; i++) {
        GlobalAddAtom(name);
    }

    return n;
}

static void count(LPSTR into, BOOL progman)
{
    if (progman) {
        wsprintf(into + lstrlen(into), ",Progman=%d", countOf("Progman"));
    } else {
        wsprintf(into + lstrlen(into), ",LISTSRV=%d,LTOPIC=%d", countOf("LISTSRV"),
                 countOf("LTOPIC"));
    }
}

static LPCSTR windowName(HWND window)
{
    return window == serverA ? "A" : window == serverB ? "B" : window ? "?" : "0";
}

/* A conversation: its partner, its state, and whether its window is. */
static void describe(LPSTR into, HCONV conv)
{
    CONVINFO info;

    info.cb = sizeof(info);

    if (!DdeQueryConvInfo(conv, QID_SYNC, &info)) {
        wsprintf(into + lstrlen(into), "[none,err=%x]", DdeGetLastError(instance));
        return;
    }

    wsprintf(into + lstrlen(into), "[%s:%x,st=%x,cs=%u,list=%d]",
             windowName((HWND)LOWORD(info.hConvPartner)), HIWORD(info.hConvPartner),
             info.wStatus, info.wConvst, info.hConvList != 0);
}

static void order(BOOL twice, BOOL progman)
{
    SendMessage(serverA, WM_USER + 1, twice, progman);
}

static void connect(LPCSTR label, BOOL twice, BOOL progman)
{
    LPCSTR app = progman ? "Progman" : "LISTSRV";
    LPCSTR subject = progman ? "Progman" : "LTOPIC";
    HSZ service = DdeCreateStringHandle(instance, (LPSTR)app, CP_WINANSI);
    HSZ topic = DdeCreateStringHandle(instance, (LPSTR)subject, CP_WINANSI);
    HCONV conv;
    char head[300];

    order(twice, progman);
    lstrcpy(head, "before");
    count(head, progman);
    since("count", label, head);

    lines[0] = '\0';
    conv = DdeConnect(instance, service, topic, NULL);
    wsprintf(head, "%s,%x", (LPSTR)(conv ? "conv" : "0"), DdeGetLastError(instance));

    if (conv) {
        describe(head, conv);
    }

    count(head, progman);
    since("DdeConnect", label, head);
    settle(20);
    lstrcpy(head, lines[0] ? lines : "C:none");

    if (conv) {
        describe(head, conv);
    }

    count(head, progman);
    since("after", label, head);

    if (conv) {
        wsprintf(head, "%d", DdeDisconnect(conv));
        settle(20);
        count(head, progman);
        since("DdeDisconnect", label, head);
    }

    DdeFreeStringHandle(instance, service);
    DdeFreeStringHandle(instance, topic);
}

static void list(LPCSTR label, BOOL twice, BOOL progman)
{
    LPCSTR app = progman ? "Progman" : "LISTSRV";
    LPCSTR subject = progman ? "Progman" : "LTOPIC";
    HSZ service = DdeCreateStringHandle(instance, (LPSTR)app, CP_WINANSI);
    HSZ topic = DdeCreateStringHandle(instance, (LPSTR)subject, CP_WINANSI);
    HCONVLIST convs;
    HCONV each;
    char head[400];
    int i;

    order(twice, progman);
    lstrcpy(head, "before");
    count(head, progman);
    since("count", label, head);

    lines[0] = '\0';
    convs = DdeConnectList(instance, service, topic, 0, NULL);
    wsprintf(head, "%s,%x", (LPSTR)(convs ? "list" : "0"), DdeGetLastError(instance));
    count(head, progman);
    since("DdeConnectList", label, head);
    settle(20);
    lstrcpy(head, lines[0] ? lines : "C:none");

    for (each = DdeQueryNextServer(convs, 0), i = 0; each && i < 8;
         each = DdeQueryNextServer(convs, each), i++) {
        describe(head, each);
    }

    count(head, progman);
    since("DdeQueryNextServer", label, head);

    if (convs) {
        wsprintf(head, "%d", DdeDisconnectList(convs));
        settle(20);
        count(head, progman);
        since("DdeDisconnectList", label, head);
    }

    DdeFreeStringHandle(instance, service);
    DdeFreeStringHandle(instance, topic);
}

int PASCAL WinMain(HINSTANCE module, HINSTANCE previous, LPSTR command, int show)
{
    HFILE file;
    char head[60];
    int i;

    probeOpen(OUTPUT);
    file = _lcreat(LOG, 0);
    _lclose(file);

    wsprintf(head, "%u",
             DdeInitialize(&instance, (PFNCALLBACK)MakeProcInstance((FARPROC)Callback, module),
                           APPCMD_CLIENTONLY, 0L));
    lstrcat(head, ",");
    count(head, TRUE);
    probe("DdeInitialize", "client", head);

    WinExec("DDELISTC.EXE", SW_SHOWNOACTIVATE);

    for (i = 0; i < 300 && !FindWindow(NULL, "List Server"); i++) {
        settle(1);
    }

    serverA = FindWindow(NULL, "List Server");
    serverB = FindWindow(NULL, "List Second");
    since("WinExec", "DDELISTC.EXE", serverA && serverB ? "started" : "none");

    if (!serverA) {
        probeFinish();
        return 0;
    }

    connect("once", FALSE, FALSE);
    connect("twice", TRUE, FALSE);
    list("once", FALSE, FALSE);
    list("twice", TRUE, FALSE);
    connect("Progman,once", FALSE, TRUE);
    connect("Progman,twice", TRUE, TRUE);
    list("Progman,once", FALSE, TRUE);
    list("Progman,twice", TRUE, TRUE);

    PostMessage(serverA, WM_USER + 9, 0, 0L);

    for (i = 0; i < 300 && IsWindow(serverA); i++) {
        settle(1);
    }

    since("server closed", "", IsWindow(serverA) ? "running" : "closed");
    wsprintf(head, "%d", DdeUninitialize(instance));
    count(head, TRUE);
    probe("DdeUninitialize", "client", head);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
