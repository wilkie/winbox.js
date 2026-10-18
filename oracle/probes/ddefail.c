/*
 * A DDEML server's CBF_FAIL_ and CBF_SKIP_ flags, and DdeEnableCallback's
 * EC_ENABLEONE, between two programs: this one a client, DDEFAILC.EXE
 * (`ddefail.child.c`) the server "FAILSRV", topic "FTOPIC", which changes
 * its flags at this program's order by calling `DdeInitialize` again with
 * its own id.
 *
 * Read out of `DDEML.DLL` seg1: a callback of a type whose `CBF_FAIL_`
 * flag the instance has answers nought without calling the application
 * (`5838`-`585d`); and a client whose conversation is with a server of the
 * same DDEML checks the server's flags itself and answers
 * DMLERR_NOTPROCESSED without sending (`129a`-`12c2`). So each transaction
 * is made twice: through DDEML, and by plain WM_DDE_* messages from this
 * program's own window, which DDEML's server window takes as any client's.
 *
 * Both programs write what they are handed to C:\ORACLE\DDEF.TXT, the
 * server `S:`, this program `C:`; each record ends with every line written
 * since the one before, `|` between. A transaction's record is its answer
 * (`0`, `1`, or `h` for a data handle), `DdeGetLastError`'s and
 * `pdwResult` (AAAAAAAAh before); an asynchronous one's identifier is
 * written `id`.
 */

#define PROBE_FLUSH
#include "probe.h"
#include <dde.h>
#include <ddeml.h>

#pragma library("ddeml")

#define OUTPUT "C:\\ORACLE\\DDEFAIL.OUT"
#define LOG "C:\\ORACLE\\DDEF.TXT"

static DWORD instance;
static HWND mine;
static HWND server;
static HCONV conv;
static int seen;
static char text[4000];
static char out[1800];
static DWORD ids[8];
static int idCount;

/* The plain conversation's partner, and the block of its last execute. */
static HWND partner;
static HGLOBAL commands;

static void note(LPCSTR line)
{
    HFILE file = _lopen(LOG, OF_READWRITE);

    if (file == HFILE_ERROR) {
        file = _lcreat(LOG, 0);
    }

    _llseek(file, 0L, 2);
    _lwrite(file, line, lstrlen(line));
    _lwrite(file, "\r\n", 2);
    _lclose(file);
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

/* The lines written since last asked, `|` between, after `head`. */
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

static LPCSTR kind(UINT type)
{
    switch (type) {
    case XTYP_ADVDATA: return "advdata";
    case XTYP_XACT_COMPLETE: return "complete";
    case XTYP_DISCONNECT: return "disconnect";
    case XTYP_REGISTER: return "register";
    case XTYP_UNREGISTER: return "unregister";
    case XTYP_ERROR: return "error";
    }

    return "other";
}

static LPCSTR idText(DWORD id)
{
    static char name[8];
    int i;

    for (i = 0; i < idCount; i++) {
        if (ids[i] == id) {
            wsprintf(name, "id%d", i + 1);
            return name;
        }
    }

    return "other";
}

HDDEDATA CALLBACK __export Callback(UINT type, UINT format, HCONV which, HSZ one, HSZ two,
                                    HDDEDATA data, DWORD first, DWORD next)
{
    char line[200];
    char a[40];
    char b[40];
    char value[60];
    DWORD size;

    a[0] = b[0] = '\0';

    if (one) {
        DdeQueryString(instance, one, a, 32, CP_WINANSI);
    }

    if (two) {
        DdeQueryString(instance, two, b, 32, CP_WINANSI);
    }

    lstrcpy(value, "-");

    if ((DWORD)data > 1) {
        size = DdeGetData(data, (LPBYTE)value, sizeof(value) - 1, 0);
        value[(int)size] = '\0';
    } else if (data) {
        lstrcpy(value, "1");
    }

    wsprintf(line, "C:%s:%u:%s:%s:%s:%s:%lx:%s", kind(type), format, (LPSTR)a, (LPSTR)b,
             (LPSTR)value, (LPSTR)(type == XTYP_XACT_COMPLETE ? idText(first) : "-"), next,
             (LPSTR)(which == conv ? "conv" : "?"));
    note(line);
    return 0;
}

/* One transaction through DDEML. */
static void xact(LPCSTR label, LPCSTR data, LPCSTR item, UINT format, UINT type, DWORD timeout)
{
    HSZ hsz = item ? DdeCreateStringHandle(instance, item, CP_WINANSI) : 0;
    DWORD result = 0xAAAAAAAAL;
    HDDEDATA answer;
    UINT error;
    char head[100];

    answer = DdeClientTransaction((LPBYTE)data, data ? lstrlen(data) + 1 : 0, conv, hsz, format,
                                  type, timeout, &result);
    error = DdeGetLastError(instance);

    if (timeout == TIMEOUT_ASYNC) {
        if (answer && idCount < 8) {
            ids[idCount++] = result;
        }

        wsprintf(head, "%s,%x,%s", (LPSTR)(answer == 0 ? "0" : "1"), error,
                 (LPSTR)(answer ? idText(result) : "0"));
    } else {
        wsprintf(head, "%s,%x,%lx",
                 (LPSTR)(answer == 0 ? "0" : (DWORD)answer == 1 ? "1" : "h"), error, result);
    }

    if ((DWORD)answer > 1) {
        DdeFreeDataHandle(answer);
    }

    since("xact", label, head);

    if (hsz) {
        DdeFreeStringHandle(instance, hsz);
    }
}

/* The four kinds a server may fail, through DDEML. */
static void four(LPCSTR flags)
{
    char label[60];

    wsprintf(label, "%s,request", flags);
    xact(label, NULL, "alpha", CF_TEXT, XTYP_REQUEST, 2000);
    wsprintf(label, "%s,poke", flags);
    xact(label, "poked", "alpha", CF_TEXT, XTYP_POKE, 2000);
    wsprintf(label, "%s,execute", flags);
    xact(label, "[run]", NULL, 0, XTYP_EXECUTE, 2000);
    wsprintf(label, "%s,advstart", flags);
    xact(label, NULL, "alpha", CF_TEXT, XTYP_ADVSTART, 2000);
    wsprintf(label, "%s,advstop", flags);
    xact(label, NULL, "alpha", CF_TEXT, XTYP_ADVSTOP, 2000);
}

LONG FAR PASCAL __export Proc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    char line[200];
    char item[40];
    LPWORD header;

    if (message == WM_DDE_ACK) {
        if (!partner) {
            partner = (HWND)wParam;
            GlobalGetAtomName(HIWORD(lParam), item, sizeof(item));
            wsprintf(line, "C:raw-ack-init:%s", (LPSTR)item);
            GlobalDeleteAtom(LOWORD(lParam));
            GlobalDeleteAtom(HIWORD(lParam));
        } else {
            item[0] = '\0';

            if (HIWORD(lParam) && (HGLOBAL)HIWORD(lParam) == commands) {
                lstrcpy(item, "commands");
            } else if (HIWORD(lParam) && GlobalGetAtomName(HIWORD(lParam), item, sizeof(item))) {
                GlobalDeleteAtom(HIWORD(lParam));
            } else if (HIWORD(lParam)) {
                lstrcpy(item, "other");
            }

            wsprintf(line, "C:raw-ack:%x:%s", LOWORD(lParam), (LPSTR)(item[0] ? item : "0"));
        }

        note(line);
        return 0;
    }

    if (message == WM_DDE_DATA) {
        item[0] = '\0';
        GlobalGetAtomName(HIWORD(lParam), item, sizeof(item));
        GlobalDeleteAtom(HIWORD(lParam));

        if (LOWORD(lParam)) {
            header = (LPWORD)GlobalLock((HGLOBAL)LOWORD(lParam));
            wsprintf(line, "C:raw-data:%s:%x:%s", (LPSTR)item, header[0], (LPSTR)(header + 2));
            GlobalUnlock((HGLOBAL)LOWORD(lParam));

            if (header[0] & 0x2000) {
                GlobalFree((HGLOBAL)LOWORD(lParam));
            }
        } else {
            wsprintf(line, "C:raw-data:%s:none", (LPSTR)item);
        }

        note(line);
        return 0;
    }

    if (message == WM_DDE_TERMINATE) {
        note("C:raw-terminate");
        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

/* The plain conversation, made. */
static void initiate(LPCSTR label)
{
    ATOM app = GlobalAddAtom("FAILSRV");
    ATOM subject = GlobalAddAtom("FTOPIC");

    partner = NULL;
    SendMessage((HWND)-1, WM_DDE_INITIATE, (WPARAM)mine, MAKELPARAM(app, subject));
    GlobalDeleteAtom(app);
    GlobalDeleteAtom(subject);
    since("raw-initiate", label, partner ? "partner" : "none");
}

static void terminate(LPCSTR label)
{
    if (partner) {
        PostMessage(partner, WM_DDE_TERMINATE, (WPARAM)mine, 0L);
        partner = NULL;
        since("raw-terminate", label, "posted");
    }
}

/* The four kinds, plainly; each block is freed here once acknowledged. */
static void plain(LPCSTR flags)
{
    HGLOBAL block;
    LPWORD header;
    char label[60];

    if (!partner) {
        return;
    }

    PostMessage(partner, WM_DDE_REQUEST, (WPARAM)mine,
                MAKELPARAM(CF_TEXT, GlobalAddAtom("alpha")));
    wsprintf(label, "%s,request", flags);
    since("raw", label, "posted");

    block = GlobalAlloc(GMEM_DDESHARE | GMEM_MOVEABLE, 4 + 6);
    header = (LPWORD)GlobalLock(block);
    header[0] = 0;
    header[1] = CF_TEXT;
    lstrcpy((LPSTR)(header + 2), "raw-p");
    GlobalUnlock(block);
    PostMessage(partner, WM_DDE_POKE, (WPARAM)mine, MAKELPARAM(block, GlobalAddAtom("alpha")));
    wsprintf(label, "%s,poke", flags);
    since("raw", label, "posted");
    GlobalFree(block);

    commands = GlobalAlloc(GMEM_DDESHARE | GMEM_MOVEABLE, 8);
    lstrcpy((LPSTR)GlobalLock(commands), "[raw]");
    GlobalUnlock(commands);
    PostMessage(partner, WM_DDE_EXECUTE, (WPARAM)mine, MAKELPARAM(0, commands));
    wsprintf(label, "%s,execute", flags);
    since("raw", label, "posted");
    GlobalFree(commands);
    commands = 0;

    block = GlobalAlloc(GMEM_DDESHARE | GMEM_MOVEABLE, 4);
    header = (LPWORD)GlobalLock(block);
    header[0] = 0;
    header[1] = CF_TEXT;
    GlobalUnlock(block);
    PostMessage(partner, WM_DDE_ADVISE, (WPARAM)mine, MAKELPARAM(block, GlobalAddAtom("alpha")));
    wsprintf(label, "%s,advise", flags);
    since("raw", label, "posted");

    PostMessage(partner, WM_DDE_UNADVISE, (WPARAM)mine,
                MAKELPARAM(CF_TEXT, GlobalAddAtom("alpha")));
    wsprintf(label, "%s,unadvise", flags);
    since("raw", label, "posted");
}

/* The server's flags set, and what each kind then answers. */
static void flagged(LPCSTR name, DWORD flags)
{
    char head[40];

    wsprintf(head, "%ld", SendMessage(server, WM_USER + 1, 0, flags));
    since("server flags", name, head);
    four(name);
    plain(name);
}

static void enable(LPCSTR what, UINT command, LPARAM how)
{
    char head[40];

    wsprintf(head, "%ld", SendMessage(server, WM_USER + 2, command, how));
    since("server enable", what, head);
}

int PASCAL WinMain(HINSTANCE module, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HFILE file;
    HSZ service;
    HSZ topic;
    HCONV other;
    int i;
    char head[60];

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
    kind.lpszClassName = "DdeFailC";
    RegisterClass(&kind);

    mine = CreateWindow("DdeFailC", "Probe C", WS_OVERLAPPEDWINDOW, 40, 40, 200, 150, NULL, NULL,
                        module, NULL);

    wsprintf(probeResult, "%u",
             DdeInitialize(&instance, (PFNCALLBACK)MakeProcInstance((FARPROC)Callback, module),
                           CBF_SKIP_REGISTRATIONS | CBF_SKIP_UNREGISTRATIONS, 0L));
    probe("DdeInitialize", "client", probeResult);

    WinExec("DDEFAILC.EXE", SW_SHOWNOACTIVATE);

    for (i = 0; i < 300 && !FindWindow(NULL, "Fail Server"); i++) {
        settle(1);
    }

    server = FindWindow(NULL, "Fail Server");
    since("WinExec", "DDEFAILC.EXE", server ? "started" : "none");

    if (!server) {
        probeFinish();
        return 0;
    }

    service = DdeCreateStringHandle(instance, "FAILSRV", CP_WINANSI);
    topic = DdeCreateStringHandle(instance, "FTOPIC", CP_WINANSI);
    conv = DdeConnect(instance, service, topic, NULL);
    wsprintf(head, "%s,%x", (LPSTR)(conv ? "conv" : "0"), DdeGetLastError(instance));
    since("DdeConnect", "FAILSRV,FTOPIC", head);
    initiate("none");

    /* Nothing failed, then each kind. */
    four("none");
    plain("none");
    flagged("CBF_FAIL_REQUESTS", CBF_FAIL_REQUESTS);
    flagged("CBF_FAIL_POKES", CBF_FAIL_POKES);
    flagged("CBF_FAIL_EXECUTES", CBF_FAIL_EXECUTES);
    flagged("CBF_FAIL_ADVISES", CBF_FAIL_ADVISES);
    flagged("CBF_FAIL_ALLSVRXACTIONS", CBF_FAIL_ALLSVRXACTIONS);

    /* A new conversation and its end, the notifications failed or skipped. */
    terminate("all failed");
    other = DdeConnect(instance, service, topic, NULL);
    wsprintf(head, "%s,%x", (LPSTR)(other ? "conv" : "0"), DdeGetLastError(instance));
    since("DdeConnect", "CBF_FAIL_ALLSVRXACTIONS", head);
    initiate("CBF_FAIL_ALLSVRXACTIONS");
    terminate("CBF_FAIL_ALLSVRXACTIONS");

    if (other) {
        wsprintf(head, "%d", DdeDisconnect(other));
        since("DdeDisconnect", "CBF_FAIL_ALLSVRXACTIONS", head);
    }

    wsprintf(head, "%ld", SendMessage(server, WM_USER + 1, 0, CBF_SKIP_ALLNOTIFICATIONS));
    since("server flags", "CBF_SKIP_ALLNOTIFICATIONS", head);
    other = DdeConnect(instance, service, topic, NULL);
    wsprintf(head, "%s,%x", (LPSTR)(other ? "conv" : "0"), DdeGetLastError(instance));
    since("DdeConnect", "CBF_SKIP_ALLNOTIFICATIONS", head);

    if (other) {
        wsprintf(head, "%d", DdeDisconnect(other));
        since("DdeDisconnect", "CBF_SKIP_ALLNOTIFICATIONS", head);
    }

    wsprintf(head, "%ld", SendMessage(server, WM_USER + 1, 0, CBF_FAIL_CONNECTIONS));
    since("server flags", "CBF_FAIL_CONNECTIONS", head);
    other = DdeConnect(instance, service, topic, NULL);
    wsprintf(head, "%s,%x", (LPSTR)(other ? "conv" : "0"), DdeGetLastError(instance));
    since("DdeConnect", "CBF_FAIL_CONNECTIONS", head);
    initiate("CBF_FAIL_CONNECTIONS");
    terminate("CBF_FAIL_CONNECTIONS");
    xact("CBF_FAIL_CONNECTIONS,request", NULL, "alpha", CF_TEXT, XTYP_REQUEST, 2000);
    wsprintf(head, "%ld", SendMessage(server, WM_USER + 3, 0, 0L));
    since("server self", "CBF_FAIL_CONNECTIONS", head);

    wsprintf(head, "%ld", SendMessage(server, WM_USER + 1, 0, CBF_FAIL_SELFCONNECTIONS));
    since("server flags", "CBF_FAIL_SELFCONNECTIONS", head);
    wsprintf(head, "%ld", SendMessage(server, WM_USER + 3, 0, 0L));
    since("server self", "CBF_FAIL_SELFCONNECTIONS", head);
    other = DdeConnect(instance, service, topic, NULL);
    wsprintf(head, "%s,%x", (LPSTR)(other ? "conv" : "0"), DdeGetLastError(instance));
    since("DdeConnect", "CBF_FAIL_SELFCONNECTIONS", head);

    if (other) {
        wsprintf(head, "%d", DdeDisconnect(other));
        since("DdeDisconnect", "CBF_FAIL_SELFCONNECTIONS", head);
    }

    wsprintf(head, "%ld", SendMessage(server, WM_USER + 1, 0, 0L));
    since("server flags", "0", head);
    wsprintf(head, "%ld", SendMessage(server, WM_USER + 3, 0, 0L));
    since("server self", "0", head);

    /* Callbacks disabled, then let through one at a time. */
    enable("EC_DISABLE", EC_DISABLE, 0L);
    xact("disabled,alpha", NULL, "alpha", CF_TEXT, XTYP_REQUEST, TIMEOUT_ASYNC);
    xact("disabled,beta", NULL, "beta", CF_TEXT, XTYP_REQUEST, TIMEOUT_ASYNC);
    xact("disabled,gamma", NULL, "gamma", CF_TEXT, XTYP_REQUEST, TIMEOUT_ASYNC);
    enable("EC_QUERYWAITING", EC_QUERYWAITING, 0L);
    enable("EC_ENABLEONE", EC_ENABLEONE, 0L);
    enable("EC_QUERYWAITING,after one", EC_QUERYWAITING, 0L);
    enable("EC_ENABLEONE,conv", EC_ENABLEONE, 1L);
    enable("EC_QUERYWAITING,conv", EC_QUERYWAITING, 1L);
    enable("EC_ENABLEALL", EC_ENABLEALL, 0L);
    enable("EC_QUERYWAITING,after all", EC_QUERYWAITING, 0L);

    /* Blocked by the callback, then let through one. */
    xact("blocked,block", NULL, "block", CF_TEXT, XTYP_REQUEST, TIMEOUT_ASYNC);
    xact("blocked,delta", NULL, "delta", CF_TEXT, XTYP_REQUEST, TIMEOUT_ASYNC);
    enable("block,EC_QUERYWAITING", EC_QUERYWAITING, 0L);
    enable("block,EC_ENABLEONE", EC_ENABLEONE, 0x10000L);
    enable("block,EC_QUERYWAITING,after one", EC_QUERYWAITING, 0L);
    enable("block,EC_ENABLEALL", EC_ENABLEALL, 0L);

    /* Disabled on the conversation alone. */
    enable("EC_DISABLE,conv", EC_DISABLE, 1L);
    xact("conv disabled,eps", NULL, "eps", CF_TEXT, XTYP_REQUEST, TIMEOUT_ASYNC);
    xact("conv disabled,zeta", NULL, "zeta", CF_TEXT, XTYP_REQUEST, TIMEOUT_ASYNC);
    enable("conv,EC_ENABLEONE,all", EC_ENABLEONE, 0L);
    enable("conv,EC_QUERYWAITING", EC_QUERYWAITING, 1L);
    enable("conv,EC_ENABLEALL", EC_ENABLEALL, 1L);

    wsprintf(head, "%d", DdeDisconnect(conv));
    since("DdeDisconnect", "conv", head);
    DdeFreeStringHandle(instance, service);
    DdeFreeStringHandle(instance, topic);
    DdeUninitialize(instance);

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
