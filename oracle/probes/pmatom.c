/*
 * The atoms of a connection to Program Manager, counted.
 *
 * Program Manager answers WM_DDE_INITIATE with WM_DDE_ACK sent, carrying
 * two atoms it adds (`PROGMAN.EXE` seg7 `0b2a`-`0b3f`) and does not delete
 * (`0b64`-`0b73`); by the protocol they are the receiver's to delete. DDEML,
 * for a server not its own whose application atom is the atom "Progman"
 * it added at its first `DdeInitialize` (`DDEML.DLL` seg1 `0134`-`013d`),
 * adds a count to each once more (`7140`-`7150`), and on a second
 * acknowledgement of that name deletes none (`71f3`-`71fc`). This counts,
 * by name, what is left.
 *
 * An atom's count is found by deleting it until `GlobalFindAtom` no longer
 * finds it, and then adding it back as many times; `moved` says the atom
 * came back with another number (it never did). `first=` says which of the
 * atoms a client sent has the number of DDEML's "Progman".
 *
 * An instance of DDEML is held from the start, as an installer holds one,
 * so that number stays DDEML's. The scenarios, against a control server
 * (`pmatom.child.c`, which answers as Program Manager does but is not it),
 * the same server answering "Progman", Program Manager (started with
 * `WinExec`, the probe being the shell, as `progdde` does), and both:
 *
 * * `raw`: a plain client adds the names, sends WM_DDE_INITIATE to every
 *   window, and for each WM_DDE_ACK records the server, the names and
 *   whether each atom is the one it sent, posts WM_DDE_TERMINATE and
 *   deletes the atoms the acknowledgement brought; then deletes its own.
 *   With `in` the names are counted inside the acknowledgement as well.
 * * `ddeml`: `DdeInitialize`, string handles, `DdeConnect`,
 *   `DdeDisconnect`, the handles freed, `DdeUninitialize`; then the names
 *   counted. With `in` they are counted after each step too.
 *
 * Then the held instance ends, "Progman" is deleted until it is gone, and
 * DDEML connects to Program Manager again.
 */

#define PROBE_FLUSH
#include "probe.h"
#include <dde.h>
#include <ddeml.h>

#pragma library("ddeml")

#define OUTPUT "C:\\ORACLE\\PMATOM.OUT"

static HWND mine;
static HWND server;
static HWND progman;
static ATOM sentApp;
static ATOM sentTopic;
static BOOL countInAck;
static char acks[400];

/* Program Manager's window, and a block of commands posted to it. */
static HGLOBAL commands;

/* The atom "Progman" that DDEML's first DdeInitialize added: DDEML keeps
 * its number, and compares acknowledgements' with it. */
static ATOM first;

/* Which of two atoms has `first`'s number. */
static LPCSTR firstIn(ATOM app, ATOM topic)
{
    if (first && app == first) {
        return topic == first ? "first=both" : "first=app";
    }

    return first && topic == first ? "first=topic" : "first=none";
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

/* A name's count, by deleting it until it is gone and adding it back. */
static int countOf(LPCSTR name, BOOL *moved)
{
    ATOM before = GlobalFindAtom(name);
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

    *moved = n > 0 && GlobalFindAtom(name) != before;
    return n;
}

/* "name=n" for each name, into `out`. */
static void countInto(LPSTR out, LPCSTR first, LPCSTR second)
{
    BOOL moved;
    int n;

    n = countOf(first, &moved);
    wsprintf(out + lstrlen(out), "%s=%d%s", first, n, (LPSTR)(moved ? ",moved" : ""));

    if (second && lstrcmpi(first, second)) {
        n = countOf(second, &moved);
        wsprintf(out + lstrlen(out), ";%s=%d%s", second, n, (LPSTR)(moved ? ",moved" : ""));
    }
}

static void count(LPCSTR when, LPCSTR first, LPCSTR second)
{
    probeResult[0] = '\0';
    countInto(probeResult, first, second);
    probe("count", when, probeResult);
}

static char who(HWND window)
{
    if (window == progman) {
        return 'P';
    }

    if (window == server) {
        return 'C';
    }

    return '?';
}

LONG FAR PASCAL __export Proc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    char app[40];
    char topic[40];
    ATOM a = LOWORD(lParam);
    ATOM t = HIWORD(lParam);

    if (message == WM_DDE_ACK && commands) {
        return 0;
    }

    if (message == WM_DDE_ACK) {
        app[0] = topic[0] = '\0';
        GlobalGetAtomName(a, app, sizeof(app));
        GlobalGetAtomName(t, topic, sizeof(topic));
        wsprintf(acks + lstrlen(acks), "%c:%s:%s:%s:%s", who((HWND)wParam), (LPSTR)app,
                 (LPSTR)topic, (LPSTR)(a == sentApp ? "same" : "other"),
                 (LPSTR)(t == sentTopic ? "same" : "other"));

        if (countInAck) {
            lstrcat(acks, ":");
            countInto(acks + lstrlen(acks), app, topic);
            /* Counted, the atoms may have other values now. */
            a = GlobalFindAtom(app);
            t = GlobalFindAtom(topic);
        }

        lstrcat(acks, ";");
        PostMessage((HWND)wParam, WM_DDE_TERMINATE, (WPARAM)hwnd, 0L);
        GlobalDeleteAtom(a);
        GlobalDeleteAtom(t);
        return 0;
    }

    if (message == WM_DDE_TERMINATE) {
        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

/* A plain WM_DDE_INITIATE, sent to every top-level window. */
static void raw(LPCSTR label, LPCSTR app, LPCSTR topic, BOOL inside)
{
    sentApp = GlobalAddAtom(app);
    sentTopic = GlobalAddAtom(topic);
    acks[0] = '\0';
    countInAck = inside;
    SendMessage((HWND)-1, WM_DDE_INITIATE, (WPARAM)mine, MAKELPARAM(sentApp, sentTopic));
    countInAck = FALSE;

    if (inside) {
        /* The client's own, by name, in case counting moved them. */
        GlobalDeleteAtom(GlobalFindAtom(app));
        GlobalDeleteAtom(GlobalFindAtom(topic));
    } else {
        GlobalDeleteAtom(sentApp);
        GlobalDeleteAtom(sentTopic);
    }

    settle(20);
    wsprintf(probeArgs, "raw:%s:%s,%s", label, app, topic);
    lstrcat(acks, firstIn(sentApp, sentTopic));
    probe("raw", probeArgs, acks);
    count(probeArgs, app, topic);
}

/* A count at one of `ddeml`'s steps, where `inside`. */
static void stage(BOOL inside, LPCSTR label, LPCSTR when, LPCSTR app, LPCSTR topic)
{
    static char args[80];

    if (inside) {
        wsprintf(args, "ddeml:%s:%s,%s:%s", label, app, topic, when);
        count(args, app, topic);
    }
}

/* DDEML's connection, made and ended; the names counted after the
 * instance is gone, and, with `inside`, after each step too. */
static void ddeml(LPCSTR label, LPCSTR app, LPCSTR topic, BOOL inside)
{
    static char args[80];
    DWORD instance = 0;
    HSZ hszApp;
    HSZ hszTopic;
    HCONV conv;
    UINT got;

    got = DdeInitialize(
        &instance,
        (PFNCALLBACK)MakeProcInstance((FARPROC)Callback, GetWindowWord(mine, GWW_HINSTANCE)),
        APPCMD_CLIENTONLY, 0L);
    stage(inside, label, "initialized", app, topic);
    hszApp = DdeCreateStringHandle(instance, (LPSTR)app, CP_WINANSI);
    hszTopic = lstrcmpi(app, topic) ? DdeCreateStringHandle(instance, (LPSTR)topic, CP_WINANSI)
                                    : hszApp;
    stage(inside, label, "handles", app, topic);
    conv = DdeConnect(instance, hszApp, hszTopic, NULL);
    wsprintf(args, "ddeml:%s:%s,%s", label, app, topic);

    if (conv) {
        wsprintf(probeResult, "%u,conv", got);
    } else {
        wsprintf(probeResult, "%u,0,%x", got, DdeGetLastError(instance));
    }

    lstrcat(probeResult, ",");
    lstrcat(probeResult, firstIn(LOWORD(hszApp), LOWORD(hszTopic)));
    probe("DdeConnect", args, probeResult);
    settle(20);
    stage(inside, label, "connected", app, topic);

    if (conv) {
        DdeDisconnect(conv);
    }

    settle(20);
    stage(inside, label, "disconnected", app, topic);
    DdeFreeStringHandle(instance, hszApp);

    if (hszTopic != hszApp) {
        DdeFreeStringHandle(instance, hszTopic);
    }

    stage(inside, label, "freed", app, topic);
    DdeUninitialize(instance);
    settle(20);
    count(args, app, topic);
}

/* A name deleted until it is gone: how many deletes that took. */
static void clear(LPCSTR name)
{
    ATOM atom;
    int n = 0;

    while ((atom = GlobalFindAtom(name)) != 0 && n < 40) {
        GlobalDeleteAtom(atom);
        n++;
    }

    wsprintf(probeResult, "%d", n);
    probe("clear", name, probeResult);
}

static void ensure(LPCSTR when)
{
    count(when, "Progman", "Control");
    count(when, "Topic", "Shell");
    count(when, "AppProperties", NULL);
}

int PASCAL WinMain(HINSTANCE module, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    DWORD held = 0;
    int i;

    probeOpen(OUTPUT);

    kind.style = 0;
    kind.lpfnWndProc = Proc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = module;
    kind.hIcon = NULL;
    kind.hCursor = LoadCursor(NULL, IDC_ARROW);
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "ProgAtomC";
    RegisterClass(&kind);
    mine = CreateWindow("ProgAtomC", "Probe", WS_OVERLAPPED, 0, 0, 10, 10, NULL, NULL, module,
                        NULL);

    ensure("start");

    /* An instance held throughout, as an installer holds one: DDEML's
     * first DdeInitialize adds "Progman", and while an instance is left
     * its number stays DDEML's. */
    probe("DdeInitialize", "held",
          DdeInitialize(&held, (PFNCALLBACK)MakeProcInstance((FARPROC)Callback, module),
                        APPCMD_CLIENTONLY, 0L) == 0 ? "0" : "failed");
    first = GlobalFindAtom("Progman");
    probe("GlobalFindAtom", "Progman", first ? "found" : "0");
    count("held", "Progman", NULL);

    /* The control server. */
    WinExec("PMATOMC.EXE", SW_SHOWNOACTIVATE);

    for (i = 0; i < 200 && !(server = FindWindow(NULL, "Atom Server")); i++) {
        settle(1);
    }

    settle(20);
    probe("FindWindow", "Atom Server", server ? "found" : "none");

    raw("control", "Control", "Topic", FALSE);
    raw("controlin", "Control", "Topic", TRUE);
    ddeml("control", "Control", "Topic", FALSE);
    ddeml("controlin", "Control", "Topic", TRUE);

    /* The control server under Program Manager's name. */
    SendMessage(server, WM_USER + 1, 1, 0L);
    raw("named", "Progman", "Progman", FALSE);
    raw("namedin", "Progman", "Progman", TRUE);
    ddeml("namedin", "Progman", "Progman", TRUE);
    ddeml("named", "Progman", "Progman", FALSE);
    ensure("named");
    SendMessage(server, WM_USER + 1, 0, 0L);

    /* Program Manager. */
    probe("WinExec", "PROGMAN.EXE", WinExec("PROGMAN.EXE", SW_SHOWNORMAL) > 32 ? "1" : "0");

    for (i = 0; i < 400 && !(progman = FindWindow("Progman", NULL)); i++) {
        settle(1);
    }

    settle(20);
    probe("FindWindow", "Progman", progman ? "found" : "none");
    ensure("progman");

    raw("progman", "Progman", "Progman", FALSE);
    raw("progmanin", "Progman", "Progman", TRUE);
    raw("shell", "Shell", "AppProperties", FALSE);
    raw("shellin", "Shell", "AppProperties", TRUE);
    ddeml("progmanin", "Progman", "Progman", TRUE);
    ddeml("progman", "Progman", "Progman", FALSE);
    ddeml("shellin", "Shell", "AppProperties", TRUE);
    ensure("progman");

    /* Both answering "Progman": a second acknowledgement. */
    SendMessage(server, WM_USER + 1, 1, 0L);
    raw("both", "Progman", "Progman", FALSE);
    ddeml("bothin", "Progman", "Progman", TRUE);
    SendMessage(server, WM_USER + 1, 0, 0L);
    ensure("both");

    /* The held instance ended: DDEML deletes "Progman" once. */
    DdeUninitialize(held);
    settle(20);
    ensure("released");

    /* What is left of "Progman" deleted, so that its number is no longer
     * DDEML's; and connected again. */
    clear("Progman");
    ddeml("stalein", "Progman", "Progman", TRUE);
    ddeml("stale", "Progman", "Progman", FALSE);
    ensure("end");

    /* Program Manager ended, as `progdde` ends it. */
    commands = GlobalAlloc(GMEM_DDESHARE | GMEM_MOVEABLE, 20);
    lstrcpy((LPSTR)GlobalLock(commands), "[ExitProgman(0)]");
    GlobalUnlock(commands);
    PostMessage(progman, WM_DDE_EXECUTE, (WPARAM)mine, MAKELPARAM(0, commands));

    for (i = 0; i < 400 && FindWindow("Progman", NULL); i++) {
        settle(1);
    }

    settle(20);
    probe("FindWindow", "Progman", FindWindow("Progman", NULL) ? "running" : "gone");
    GlobalFree(commands);
    commands = NULL;
    progman = NULL;
    ensure("exited");

    SendMessage(server, WM_USER + 9, 0, 0L);
    settle(20);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
