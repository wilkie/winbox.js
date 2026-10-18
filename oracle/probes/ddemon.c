/*
 * What DDEML's monitors are told, between two programs: this one a client
 * and two monitors, DDEMONC.EXE (`ddemon.child.c`) a server, "MONSRV",
 * topic "MTOPIC". The first monitor takes every kind of notice -- MF_CALLBACKS,
 * MF_CONV, MF_ERRORS, MF_HSZ_INFO, MF_LINKS, MF_POSTMSGS, MF_SENDMSGS --
 * the second MF_LINKS and MF_ERRORS alone.
 *
 * Read out of `DDEML.DLL` seg1: the first monitor puts in two hooks with
 * `SetWindowsHook` (`02ec`-`0310`): `DDESENDHOOKPROC`, WH_CALLWNDPROC, each
 * DDE message sent (`2fb0`), and `DDEPOSTHOOKPROC`, WH_GETMESSAGE, each DDE
 * message as a task takes it from its queue (`309e`). Each notice is a
 * block sent to the monitors whose flags take it (`3524`), handed to the
 * callback as XTYP_MONITOR (`3636`).
 *
 * Each record is a step and its answer, then a line for each thing a
 * monitor was handed meanwhile, both programs let run until all was taken:
 *
 * * `send` and `post`: the message, the window it went to and the one in
 *   its wParam (by class, and `P` for this program's task or `S` the
 *   server's), its lParam's words as names where they are atoms, `blk`
 *   where a block, and the task the notice names.
 * * `cb`: a callback, its type, format, strings, whether it answered, and
 *   whose. `conv`: a conversation made or ended, its names. `err`: an
 *   error and whose. `hsz`: a string handle's action and its text.
 *   `link`: a link made or ended, its names, format, the server's side or
 *   the client's, warm.
 * * `M:` with a type: a callback a monitor is made like any instance.
 *
 * The second monitor's lines start `N:`.
 */

#define PROBE_FLUSH
#include "probe.h"
#include <dde.h>
#include <ddeml.h>

#pragma library("ddeml")

#define OUTPUT "C:\\ORACLE\\DDEMON.OUT"

/* `DdeAccessData` answers a far pointer; the header says a near one. */
typedef LPBYTE(WINAPI *ACCESSDATA)(HDDEDATA, LPDWORD);

static DWORD client;
static DWORD monitor;
static DWORD second;
static HWND mine;
static HWND server;
static HTASK serverTask;
static HCONV conv;
static char lines[3600];
static char result[3700];
static BOOL inNotice;

static void add(LPCSTR line)
{
    if (lstrlen(lines) + lstrlen(line) + 2 < sizeof(lines)) {
        if (lines[0]) {
            lstrcat(lines, "|");
        }

        lstrcat(lines, line);
    } else if (lstrlen(lines) + 6 < sizeof(lines)) {
        lstrcat(lines, "|more");
    }
}

static char taskOf(HTASK task)
{
    if (task == GetCurrentTask()) {
        return 'P';
    }

    return task && task == serverTask ? 'S' : '?';
}

static LPSTR windowText(HWND window, LPSTR out)
{
    char kind[24];

    kind[0] = '\0';

    if (window == (HWND)-1) {
        lstrcpy(out, "all");
        return out;
    }

    if (window && IsWindow(window)) {
        GetClassName(window, kind, sizeof(kind));
    }

    if (window == mine) {
        lstrcpy(kind, "mine");
    }

    wsprintf(out, "%s/%c", (LPSTR)(kind[0] ? kind : window ? "gone" : "0"),
             taskOf(window && IsWindow(window) ? GetWindowTask(window) : 0));
    return out;
}

static LPSTR atomText(WORD atom, LPSTR out)
{
    if (!atom) {
        lstrcpy(out, "0");
    } else if (atom < 0xc000 || !GlobalGetAtomName(atom, out, 24)) {
        lstrcpy(out, "?");
    }

    return out;
}

static LPSTR hszText(HSZ hsz, LPSTR out)
{
    if (!hsz) {
        lstrcpy(out, "-");
    } else if (!GlobalGetAtomName(LOWORD(hsz), out, 24)) {
        lstrcpy(out, "?");
    }

    if (hsz && HIWORD(hsz)) {
        lstrcat(out, ":(own)");
    }

    return out;
}

static LPCSTR typeText(UINT type)
{
    switch (type) {
    case XTYP_ADVDATA: return "ADVDATA";
    case XTYP_ADVREQ: return "ADVREQ";
    case XTYP_ADVSTART: return "ADVSTART";
    case XTYP_ADVSTOP: return "ADVSTOP";
    case XTYP_EXECUTE: return "EXECUTE";
    case XTYP_CONNECT: return "CONNECT";
    case XTYP_CONNECT_CONFIRM: return "CONFIRM";
    case XTYP_XACT_COMPLETE: return "COMPLETE";
    case XTYP_POKE: return "POKE";
    case XTYP_REGISTER: return "REGISTER";
    case XTYP_REQUEST: return "REQUEST";
    case XTYP_DISCONNECT: return "DISCONNECT";
    case XTYP_UNREGISTER: return "UNREGISTER";
    case XTYP_WILDCONNECT: return "WILDCONNECT";
    case XTYP_ERROR: return "ERROR";
    case XTYP_MONITOR: return "MONITOR";
    }

    return "other";
}

/* A DDE message's lParam, by what its words are. */
static LPSTR paramText(UINT message, LPARAM lParam, LPSTR out)
{
    char one[24];
    char two[24];

    switch (message) {
    case WM_DDE_INITIATE:
        wsprintf(out, "%s,%s", atomText(LOWORD(lParam), one), atomText(HIWORD(lParam), two));
        break;

    case WM_DDE_ACK:
        if (HIWORD(lParam) >= 0xc000 || !HIWORD(lParam)) {
            wsprintf(out, "%s,%s", atomText(LOWORD(lParam), one),
                     atomText(HIWORD(lParam), two));

            if (LOWORD(lParam) < 0xc000) {
                wsprintf(out, "%x,%s", LOWORD(lParam), atomText(HIWORD(lParam), two));
            }
        } else {
            wsprintf(out, "%x,blk", LOWORD(lParam));
        }

        break;

    case WM_DDE_DATA:
    case WM_DDE_POKE:
    case WM_DDE_ADVISE:
        wsprintf(out, "%s,%s", (LPSTR)(LOWORD(lParam) ? "blk" : "0"),
                 atomText(HIWORD(lParam), two));
        break;

    case WM_DDE_REQUEST:
    case WM_DDE_UNADVISE:
        wsprintf(out, "%u,%s", LOWORD(lParam), atomText(HIWORD(lParam), two));
        break;

    case WM_DDE_EXECUTE:
        wsprintf(out, "%x,%s", LOWORD(lParam), (LPSTR)(HIWORD(lParam) ? "blk" : "0"));
        break;

    default:
        wsprintf(out, "%lx", lParam);
        break;
    }

    return out;
}

static void notice(char who, HDDEDATA data, DWORD kind)
{
    char line[200];
    char one[40];
    char two[40];
    char three[40];
    char four[40];
    DWORD size;
    LPBYTE bytes = ((ACCESSDATA)DdeAccessData)(data, &size);

    if (!bytes) {
        wsprintf(line, "%c:noaccess", who);
        add(line);
        return;
    }

    switch (kind) {
    case MF_HSZ_INFO: {
        MONHSZSTRUCT FAR *hsz = (MONHSZSTRUCT FAR *)bytes;

        wsprintf(line, "%c:hsz:%u:%s:%c", who, hsz->fsAction, (LPSTR)hsz->str,
                 taskOf(hsz->hTask));
        break;
    }

    case MF_ERRORS: {
        MONERRSTRUCT FAR *error = (MONERRSTRUCT FAR *)bytes;

        wsprintf(line, "%c:err:%x:%c", who, error->wLastError, taskOf(error->hTask));
        break;
    }

    case MF_CONV: {
        MONCONVSTRUCT FAR *made = (MONCONVSTRUCT FAR *)bytes;

        wsprintf(line, "%c:conv:%u:%s:%s:%c", who, made->fConnect, hszText(made->hszSvc, one),
                 hszText(made->hszTopic, two), taskOf(made->hTask));
        break;
    }

    case MF_CALLBACKS: {
        MONCBSTRUCT FAR *call = (MONCBSTRUCT FAR *)bytes;

        wsprintf(line, "%c:cb:%s:%u:%s:%s:%s:%c", who, typeText(call->wType), call->wFmt,
                 hszText(call->hsz1, one), hszText(call->hsz2, two),
                 (LPSTR)(call->dwRet ? "yes" : "0"), taskOf(call->hTask));
        break;
    }

    case MF_LINKS: {
        MONLINKSTRUCT FAR *link = (MONLINKSTRUCT FAR *)bytes;

        wsprintf(line, "%c:link:%u:%s:%s:%s:%u:srv=%u:warm=%u:%c:cb=%u", who, link->fEstablished,
                 hszText(link->hszSvc, one), hszText(link->hszTopic, two),
                 hszText(link->hszItem, three), link->wFmt, link->fServer, link->fNoData,
                 taskOf(link->hTask), link->cb);
        break;
    }

    case MF_SENDMSGS:
    case MF_POSTMSGS: {
        MONMSGSTRUCT FAR *msg = (MONMSGSTRUCT FAR *)bytes;

        wsprintf(line, "%c:%s:%x:%s:%s:%s:%c:cb=%u", who,
                 (LPSTR)(kind == MF_SENDMSGS ? "send" : "post"), msg->wMsg,
                 windowText(msg->hwndTo, one), windowText((HWND)msg->wParam, two),
                 paramText(msg->wMsg, msg->lParam, three), taskOf(msg->hTask), msg->cb);
        (void)four;
        break;
    }

    default:
        wsprintf(line, "%c:kind=%lx:size=%lu", who, kind, size);
        break;
    }

    DdeUnaccessData(data);
    add(line);
}

static HDDEDATA monitored(char who, UINT type, HSZ hsz1, HSZ hsz2, HDDEDATA data, DWORD data2)
{
    char line[120];
    char one[40];
    char two[40];

    if (type == XTYP_MONITOR) {
        notice(who, data, data2);
    } else {
        wsprintf(line, "%c:%s:%s:%s", who, typeText(type), hszText(hsz1, one),
                 hszText(hsz2, two));
        add(line);
    }

    return 0;
}

HDDEDATA CALLBACK __export MonitorCallback(UINT type, UINT format, HCONV conv, HSZ hsz1,
                                           HSZ hsz2, HDDEDATA data, DWORD data1, DWORD data2)
{
    (void)format;
    (void)conv;
    (void)data1;
    return monitored('M', type, hsz1, hsz2, data, data2);
}

HDDEDATA CALLBACK __export SecondCallback(UINT type, UINT format, HCONV conv, HSZ hsz1,
                                          HSZ hsz2, HDDEDATA data, DWORD data1, DWORD data2)
{
    (void)format;
    (void)conv;
    (void)data1;
    return monitored('N', type, hsz1, hsz2, data, data2);
}

HDDEDATA CALLBACK __export Callback(UINT type, UINT format, HCONV which, HSZ hsz1, HSZ hsz2,
                                    HDDEDATA data, DWORD data1, DWORD data2)
{
    char line[120];
    char one[40];
    char two[40];

    (void)format;
    (void)which;
    (void)data;
    (void)data1;
    (void)data2;
    wsprintf(line, "C:%s:%s:%s", typeText(type), hszText(hsz1, one), hszText(hsz2, two));
    add(line);
    return type == XTYP_ADVDATA ? (HDDEDATA)DDE_FACK : 0;
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

static void record(LPCSTR function, LPCSTR args, LPCSTR answer)
{
    settle(30);
    lstrcpy(result, answer);
    lstrcat(result, "|");
    lstrcat(result, lines[0] ? lines : "none");
    lines[0] = '\0';
    probe(function, args, result);
}

static void xact(LPCSTR label, LPCSTR data, LPCSTR item, UINT format, UINT type, DWORD timeout)
{
    HSZ hsz = item ? DdeCreateStringHandle(client, item, CP_WINANSI) : 0;
    DWORD result = 0;
    HDDEDATA answer;
    char head[60];

    /* What making the string handle told: kept apart from the transaction. */
    record("DdeCreateStringHandle", label, item ? "made" : "none");
    answer = DdeClientTransaction((LPBYTE)data, data ? lstrlen(data) + 1 : 0, conv, hsz, format,
                                  type, timeout, &result);
    wsprintf(head, "%s,%x", (LPSTR)(answer == 0 ? "0" : (DWORD)answer == 1 ? "1" : "h"),
             DdeGetLastError(client));

    if ((DWORD)answer > 1) {
        DdeFreeDataHandle(answer);
    }

    record("xact", label, head);

    if (hsz) {
        DdeFreeStringHandle(client, hsz);
        record("DdeFreeStringHandle", label, "freed");
    }
}

LONG FAR PASCAL __export Proc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_DDE_ACK) {
        /* The plain conversation's acknowledgements: their atoms deleted. */
        if (HIWORD(lParam) >= 0xc000) {
            GlobalDeleteAtom(HIWORD(lParam));
        }

        if (LOWORD(lParam) >= 0xc000) {
            GlobalDeleteAtom(LOWORD(lParam));
        }

        if (!server || (HWND)wParam != server) {
            server = (HWND)wParam;
        }

        return 0;
    }

    if (message == WM_DDE_DATA) {
        GlobalDeleteAtom(HIWORD(lParam));

        if (LOWORD(lParam)) {
            GlobalFree((HGLOBAL)LOWORD(lParam));
        }

        return 0;
    }

    if (message == WM_DDE_TERMINATE) {
        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

int PASCAL WinMain(HINSTANCE module, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HWND window;
    HWND partner;
    HSZ service;
    HSZ topic;
    ATOM app;
    ATOM subject;
    char head[60];
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
    kind.lpszClassName = "DdeMonC";
    RegisterClass(&kind);

    mine = CreateWindow("DdeMonC", "Probe C", WS_OVERLAPPEDWINDOW, 40, 40, 200, 150, NULL, NULL,
                        module, NULL);

    wsprintf(head, "%u",
             DdeInitialize(&monitor,
                           (PFNCALLBACK)MakeProcInstance((FARPROC)MonitorCallback, module),
                           APPCLASS_MONITOR | MF_CALLBACKS | MF_CONV | MF_ERRORS | MF_HSZ_INFO
                               | MF_LINKS | MF_POSTMSGS | MF_SENDMSGS,
                           0L));
    record("DdeInitialize", "monitor,all", head);
    wsprintf(head, "%u",
             DdeInitialize(&second,
                           (PFNCALLBACK)MakeProcInstance((FARPROC)SecondCallback, module),
                           APPCLASS_MONITOR | MF_LINKS | MF_ERRORS, 0L));
    record("DdeInitialize", "monitor,links", head);
    wsprintf(head, "%u",
             DdeInitialize(&client, (PFNCALLBACK)MakeProcInstance((FARPROC)Callback, module),
                           CBF_SKIP_REGISTRATIONS | CBF_SKIP_UNREGISTRATIONS, 0L));
    record("DdeInitialize", "client", head);

    WinExec("DDEMONC.EXE", SW_SHOWNOACTIVATE);

    for (i = 0; i < 300 && !FindWindow(NULL, "Mon Server"); i++) {
        settle(1);
    }

    window = FindWindow(NULL, "Mon Server");
    serverTask = window ? GetWindowTask(window) : 0;
    record("WinExec", "DDEMONC.EXE", window ? "started" : "none");

    if (!window) {
        probeFinish();
        return 0;
    }

    service = DdeCreateStringHandle(client, "MONSRV", CP_WINANSI);
    topic = DdeCreateStringHandle(client, "MTOPIC", CP_WINANSI);
    record("DdeCreateStringHandle", "MONSRV,MTOPIC", "made");
    conv = DdeConnect(client, service, topic, NULL);
    wsprintf(head, "%s,%x", (LPSTR)(conv ? "conv" : "0"), DdeGetLastError(client));
    record("DdeConnect", "MONSRV,MTOPIC", head);

    xact("request,alpha", NULL, "alpha", CF_TEXT, XTYP_REQUEST, 5000);
    xact("request,nak", NULL, "nak", CF_TEXT, XTYP_REQUEST, 5000);
    xact("poke,alpha", "poked", "alpha", CF_TEXT, XTYP_POKE, 5000);
    xact("execute", "[run]", NULL, 0, XTYP_EXECUTE, 5000);
    xact("advstart,alpha", NULL, "alpha", CF_TEXT, XTYP_ADVSTART, 5000);
    xact("advstart,beta,warm", NULL, "beta", CF_TEXT, XTYP_ADVSTART | XTYPF_NODATA, 5000);
    xact("execute,advise", "[advise]", NULL, 0, XTYP_EXECUTE, 5000);
    xact("advstop,alpha", NULL, "alpha", CF_TEXT, XTYP_ADVSTOP, 5000);
    xact("request,async", NULL, "gamma", CF_TEXT, XTYP_REQUEST, TIMEOUT_ASYNC);
    xact("request,noitem", NULL, NULL, CF_TEXT, XTYP_REQUEST, 5000);

    /* A plain conversation of this program's own window. */
    app = GlobalAddAtom("MONSRV");
    subject = GlobalAddAtom("MTOPIC");
    server = NULL;
    SendMessage((HWND)-1, WM_DDE_INITIATE, (WPARAM)mine, MAKELPARAM(app, subject));
    GlobalDeleteAtom(app);
    GlobalDeleteAtom(subject);
    partner = server;
    record("raw", "initiate", partner ? "partner" : "none");

    if (partner) {
        PostMessage(partner, WM_DDE_REQUEST, (WPARAM)mine,
                    MAKELPARAM(CF_TEXT, GlobalAddAtom("alpha")));
        record("raw", "request", "posted");
        PostMessage(partner, WM_DDE_TERMINATE, (WPARAM)mine, 0L);
        record("raw", "terminate", "posted");
    }

    wsprintf(head, "%d", DdeDisconnect(conv));
    record("DdeDisconnect", "conv", head);
    DdeFreeStringHandle(client, service);
    DdeFreeStringHandle(client, topic);
    record("DdeFreeStringHandle", "MONSRV,MTOPIC", "freed");

    PostMessage(window, WM_USER + 9, 0, 0L);

    for (i = 0; i < 300 && IsWindow(window); i++) {
        settle(1);
    }

    record("server closed", "", IsWindow(window) ? "running" : "closed");

    wsprintf(head, "%d", DdeUninitialize(client));
    record("DdeUninitialize", "client", head);
    wsprintf(head, "%d", DdeUninitialize(second));
    record("DdeUninitialize", "monitor,links", head);
    wsprintf(head, "%d", DdeUninitialize(monitor));
    lstrcpy(probeResult, head);
    probe("DdeUninitialize", "monitor,all", probeResult);

    probeFinish();
    (void)inNotice;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
