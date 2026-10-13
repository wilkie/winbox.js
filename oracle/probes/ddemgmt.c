/*
 * DDEML's management of instances, string handles, names and
 * conversations, between two programs: this one a client-only instance and a
 * monitor, DDEMGMTC.EXE (`ddemgmt.child.c`) a server, "Mgmt Server". DDEML
 * is Microsoft's `DDEML.DLL`, loaded from the installation, in Windows and
 * in winbox.js alike: what it does rests on USER and KERNEL underneath --
 * atoms, windows and their words, messages sent and posted across tasks,
 * hooks and timers.
 *
 * Each record is a call and its answer, then `C:` lines for each callback
 * this program's client instance was made, and `S:` lines the server wrote
 * meanwhile, both programs let run until all was taken. A `-monitor`
 * record after it holds what the monitor instance was told: `M:hsz` for
 * MF_HSZ_INFO (its action, the string, whose task), `M:err` MF_ERRORS,
 * `M:conv` MF_CONV, `M:cb` MF_CALLBACKS, `M:send` and `M:post` the DDE
 * messages, and `M:` with a transaction's type for the callbacks a monitor
 * is made like any instance. Read out of DDEML.DLL, see the knowledge
 * base's topic, dynamic-data-exchange.
 *
 * A conversation is written by its window's class (`cli`, `srv`, `gone`
 * once destroyed) and the order in which this program first saw it; a list
 * as `list` and its order; a string handle by its text, an instance's own
 * name as `Name:(frame)`; an instance by the serial in its high word.
 */

#define PROBE_FLUSH
#include "probe.h"
#include <ddeml.h>

#pragma library("ddeml")

/* The header declares `DdeAccessData` as answering a near pointer; DDEML
 * answers a far one, in DX:AX. Called through this, all of it is kept. */
typedef LPBYTE(WINAPI *ACCESSDATA)(HDDEDATA, LPDWORD);

/* Every record below calls one function at a time: Watcom evaluates a
 * call's arguments from the last, so a call and DdeGetLastError in one
 * wsprintf would be made in the wrong order. */

#define OUTPUT "C:\\ORACLE\\DDEMGMT.OUT"
#define LOG "C:\\ORACLE\\DDEMGMT.TXT"

static HINSTANCE module;
static DWORD client;
static DWORD monitor;
static HWND server;
static HTASK serverTask;
static char text[8000];
static char clientLines[900];
static char monitorLines[1900];
static int seen;
static DWORD convs[32];
static int convCount;
static BOOL reconnect;
static HCONV reconnected;

static LPSTR since(LPSTR out, int room)
{
    HFILE file = _lopen(LOG, OF_READ);
    int length = 0;
    int i;
    int lines = 0;
    int at = 0;

    if (file != HFILE_ERROR) {
        length = _lread(file, text, sizeof(text) - 1);
        _lclose(file);
    }

    text[length < 0 ? 0 : length] = '\0';

    for (i = 0; text[i]; i++) {
        if (text[i] == '\r') {
            continue;
        }

        if (text[i] == '\n') {
            lines++;

            if (lines > seen && at && out[at - 1] != '|' && at < room - 2) {
                out[at++] = '|';
            }

            continue;
        }

        if (lines >= seen && at < room - 2) {
            out[at++] = text[i];
        }
    }

    if (at && out[at - 1] == '|') {
        at--;
    }

    out[at] = '\0';
    seen = lines;

    if (!at) {
        lstrcpy(out, "S:none");
    }

    return out;
}

static void add(LPSTR buffer, int room, LPCSTR line)
{
    if (lstrlen(buffer) + lstrlen(line) + 2 < room) {
        if (buffer[0]) {
            lstrcat(buffer, "|");
        }

        lstrcat(buffer, line);
    } else if (lstrlen(buffer) + 6 < room) {
        lstrcat(buffer, "|more");
    }
}

static LPSTR hszText(HSZ hsz, LPSTR out)
{
    char kind[16];

    if (!hsz) {
        lstrcpy(out, "-");
        return out;
    }

    if (!GlobalGetAtomName(LOWORD(hsz), out, 40)) {
        lstrcpy(out, "?");
    }

    if (HIWORD(hsz)) {
        kind[0] = '\0';

        if (IsWindow((HWND)HIWORD(hsz))) {
            GetClassName((HWND)HIWORD(hsz), kind, sizeof(kind));
        }

        lstrcat(out, lstrcmp(kind, "DMGFrame") ? ":(other)" : ":(frame)");
    }

    return out;
}

/* A conversation or a list, by its window's class and when it was first
 * seen here. */
static LPSTR convText(DWORD conv, LPSTR out)
{
    char kind[24];
    int i;

    if (!conv) {
        lstrcpy(out, "0");
        return out;
    }

    for (i = 0; i < convCount && convs[i] != conv; i++) {
    }

    if (i == convCount && convCount < 32) {
        convs[convCount++] = conv;
    }

    kind[0] = '\0';

    if (IsWindow((HWND)LOWORD(conv))) {
        GetClassName((HWND)LOWORD(conv), kind, sizeof(kind));
    }

    wsprintf(out, "%s%d",
             (LPSTR)(!lstrcmp(kind, "DMGClientClass")    ? "cli"
                     : !lstrcmp(kind, "DMGServerClass")  ? "srv"
                     : !lstrcmp(kind, "DMGHoldingClass") ? "list"
                                                         : "gone"),
             i + 1);
    return out;
}

static char taskOf(HTASK task)
{
    if (task == GetCurrentTask()) {
        return 'P';
    }

    return task && task == serverTask ? 'S' : '?';
}

static LPCSTR typeText(UINT type)
{
    switch (type) {
    case XTYP_CONNECT: return "CONNECT";
    case XTYP_CONNECT_CONFIRM: return "CONNECT_CONFIRM";
    case XTYP_WILDCONNECT: return "WILDCONNECT";
    case XTYP_DISCONNECT: return "DISCONNECT";
    case XTYP_REGISTER: return "REGISTER";
    case XTYP_UNREGISTER: return "UNREGISTER";
    case XTYP_ERROR: return "ERROR";
    case XTYP_XACT_COMPLETE: return "XACT_COMPLETE";
    case XTYP_MONITOR: return "MONITOR";
    case XTYP_REQUEST: return "REQUEST";
    case XTYP_ADVSTART: return "ADVSTART";
    case XTYP_EXECUTE: return "EXECUTE";
    }

    return "other";
}

static LPSTR windowText(HWND window, LPSTR out)
{
    char kind[24];

    kind[0] = '\0';

    if (IsWindow(window)) {
        GetClassName(window, kind, sizeof(kind));
    }

    wsprintf(out, "%s/%c", (LPSTR)(kind[0] ? kind : "none"),
             taskOf(IsWindow(window) ? GetWindowTask(window) : 0));
    return out;
}

HDDEDATA CALLBACK __export Callback(UINT type, UINT format, HCONV conv, HSZ hsz1, HSZ hsz2,
                                    HDDEDATA data, DWORD data1, DWORD data2)
{
    char line[200];
    char one[48];
    char two[48];
    char three[24];

    wsprintf(line, "C:%s:fmt=%u:%s:%s:%s:data=%s:%lx:%lx", typeText(type), format,
             convText((DWORD)conv, three), hszText(hsz1, one), hszText(hsz2, two),
             (LPSTR)(data ? "yes" : "0"), data1, data2);
    add(clientLines, sizeof(clientLines), line);

    if (type == XTYP_DISCONNECT && reconnect) {
        reconnect = FALSE;
        reconnected = DdeReconnect(conv);
        wsprintf(line, "C:reconnect=%s,err=%x", convText((DWORD)reconnected, three),
                 DdeGetLastError(client));
        add(clientLines, sizeof(clientLines), line);
    }

    if (type == XTYP_REGISTER && !lstrcmp(one, "Second")) {
        /* Inside a callback, enabling is refused. */
        BOOL done = DdeEnableCallback(client, 0, EC_ENABLEALL);

        wsprintf(line, "C:enable-inside=%d,err=%x", done, DdeGetLastError(client));
        add(clientLines, sizeof(clientLines), line);
    }

    return 0;
}

HDDEDATA CALLBACK __export MonitorCallback(UINT type, UINT format, HCONV conv, HSZ hsz1,
                                           HSZ hsz2, HDDEDATA data, DWORD data1, DWORD data2)
{
    char line[200];
    char one[48];
    char two[48];
    char three[24];
    char four[24];
    DWORD size;
    LPBYTE bytes;

    if (type != XTYP_MONITOR) {
        wsprintf(line, "M:%s:%s:%s:%s", typeText(type), convText((DWORD)conv, three),
                 hszText(hsz1, one), hszText(hsz2, two));
        add(monitorLines, sizeof(monitorLines), line);
        return 0;
    }

    bytes = ((ACCESSDATA)DdeAccessData)(data, &size);

    if (!bytes) {
        add(monitorLines, sizeof(monitorLines), "M:noaccess");
        return 0;
    }

    switch (data2) {
    case MF_HSZ_INFO: {
        MONHSZSTRUCT FAR *hsz = (MONHSZSTRUCT FAR *)bytes;

        wsprintf(line, "M:hsz:%u:%s:%c", hsz->fsAction, (LPSTR)hsz->str, taskOf(hsz->hTask));
        break;
    }

    case MF_ERRORS: {
        MONERRSTRUCT FAR *error = (MONERRSTRUCT FAR *)bytes;

        wsprintf(line, "M:err:%x:%c:cb=%u", error->wLastError, taskOf(error->hTask), error->cb);
        break;
    }

    case MF_CONV: {
        MONCONVSTRUCT FAR *made = (MONCONVSTRUCT FAR *)bytes;

        wsprintf(line, "M:conv:%u:%s:%s:cli=%s:srv=%s:%c:cb=%u", made->fConnect,
                 hszText(made->hszSvc, one), hszText(made->hszTopic, two),
                 convText((DWORD)made->hConvClient, three),
                 convText((DWORD)made->hConvServer, four), taskOf(made->hTask), made->cb);
        break;
    }

    case MF_CALLBACKS: {
        MONCBSTRUCT FAR *call = (MONCBSTRUCT FAR *)bytes;

        wsprintf(line, "M:cb:%s:fmt=%u:%s:%s:%s:ret=%s:%c:cb=%u", typeText(call->wType),
                 call->wFmt, convText((DWORD)call->hConv, three), hszText(call->hsz1, one),
                 hszText(call->hsz2, two), (LPSTR)(call->dwRet ? "yes" : "0"),
                 taskOf(call->hTask), call->cb);
        break;
    }

    case MF_SENDMSGS:
    case MF_POSTMSGS: {
        MONMSGSTRUCT FAR *msg = (MONMSGSTRUCT FAR *)bytes;

        wsprintf(line, "M:%s:%x:%s:%c:cb=%u", (LPSTR)(data2 == MF_SENDMSGS ? "send" : "post"),
                 msg->wMsg, windowText(msg->hwndTo, three), taskOf(msg->hTask), msg->cb);
        break;
    }

    default:
        wsprintf(line, "M:kind=%lx:size=%lu", data2, size);
        break;
    }

    DdeUnaccessData(data);
    add(monitorLines, sizeof(monitorLines), line);
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

static void record(LPCSTR function, LPCSTR args, LPCSTR answer)
{
    char theirs[900];

    settle(30);
    /* Joined with lstrcat: wsprintf writes no more than 1024 characters. */
    lstrcpy(probeResult, answer);
    lstrcat(probeResult, "; ");
    lstrcat(probeResult, clientLines[0] ? clientLines : "C:none");
    lstrcat(probeResult, "; ");
    lstrcat(probeResult, since(theirs, sizeof(theirs)));
    clientLines[0] = '\0';
    probe(function, args, probeResult);

    if (monitorLines[0]) {
        char name[40];

        wsprintf(name, "%s-monitor", function);
        probe(name, args, monitorLines);
        monitorLines[0] = '\0';
    }
}

/* An order to the server, sent, and its answer. */
static LONG order(UINT what, WPARAM wParam)
{
    return SendMessage(server, WM_USER + what, wParam, 0L);
}

static void info(LPCSTR args, HCONV conv, DWORD id, UINT cb)
{
    CONVINFO data;
    char one[48], two[48], three[48], four[48], five[24], six[24];
    UINT got;
    char answer[600];

    _fmemset(&data, 0x55, sizeof(data));
    data.cb = cb;
    got = DdeQueryConvInfo(conv, id, &data);

    if (!got) {
        wsprintf(answer, "0,err=%x", DdeGetLastError(client));
    } else {
        wsprintf(answer,
                 "%u,cb=%lu,user=%lx,partner=%s,svcPartner=%s,svcReq=%s,topic=%s,item=%s,"
                 "fmt=%u,type=%x,status=%x,convst=%u,err=%x,list=%s,cc=%u/%u/%u/%d/%lu/%lu",
                 got, data.cb, got >= 8 ? data.hUser : 0x55555555L,
                 convText(got >= 12 ? (DWORD)data.hConvPartner : 0, five),
                 hszText(got >= 16 ? data.hszSvcPartner : 0, one),
                 hszText(got >= 20 ? data.hszServiceReq : 0, two),
                 hszText(got >= 24 ? data.hszTopic : 0, three),
                 hszText(got >= 28 ? data.hszItem : 0, four), data.wFmt, data.wType,
                 data.wStatus, data.wConvst, data.wLastError,
                 convText(got >= 46 ? (DWORD)data.hConvList : 0, six), data.ConvCtxt.cb,
                 data.ConvCtxt.wFlags, data.ConvCtxt.wCountryID, data.ConvCtxt.iCodePage,
                 data.ConvCtxt.dwLangID, data.ConvCtxt.dwSecurity);
    }

    record("DdeQueryConvInfo", args, answer);
}

static void connect(LPCSTR args, LPCSTR service, LPCSTR topic, CONVCONTEXT FAR *context,
                    HCONV FAR *out)
{
    HSZ one = service ? DdeCreateStringHandle(client, (LPSTR)service, CP_WINANSI) : 0;
    HSZ two = topic ? DdeCreateStringHandle(client, (LPSTR)topic, CP_WINANSI) : 0;
    HCONV conv = DdeConnect(client, one, two, context);
    char answer[80];
    char name[24];

    wsprintf(answer, "%s,err=%x", convText((DWORD)conv, name), DdeGetLastError(client));

    if (one) {
        DdeFreeStringHandle(client, one);
    }

    if (two) {
        DdeFreeStringHandle(client, two);
    }

    if (out) {
        *out = conv;
    }

    record("DdeConnect", args, answer);
}

/* What a string handle's calls answer. */
static void strings(void)
{
    HSZ service;
    HSZ upper;
    HSZ other;
    HSZ counted;
    char buffer[40];
    char answer[200];
    DWORD got;
    int i;

    service = DdeCreateStringHandle(client, "Service", CP_WINANSI);
    wsprintf(answer, "atom=%u,high=%x,err=%x",
             LOWORD(service) == GlobalFindAtom("Service") ? 1 : 0, HIWORD(service),
             DdeGetLastError(client));
    record("DdeCreateStringHandle", "Service,CP_WINANSI", answer);

    upper = DdeCreateStringHandle(client, "SERVICE", 0);
    wsprintf(answer, "same=%u,err=%x", upper == service ? 1 : 0, DdeGetLastError(client));
    record("DdeCreateStringHandle", "SERVICE,0", answer);

    other = DdeCreateStringHandle(client, "Service", GetKBCodePage());
    wsprintf(answer, "same=%u,err=%x", other == service ? 1 : 0, DdeGetLastError(client));
    record("DdeCreateStringHandle", "Service,GetKBCodePage", answer);

    {
        static const int pages[] = {850, 1200, 437, -1};

        for (i = 0; i < 4; i++) {
            HSZ made = DdeCreateStringHandle(client, "Paged", pages[i]);
            char args[24];

            wsprintf(args, "Paged,%d", pages[i]);
            wsprintf(answer, "%s,err=%x", (LPSTR)(made ? "made" : "0"), DdeGetLastError(client));
            record("DdeCreateStringHandle", args, answer);

            if (made) {
                DdeFreeStringHandle(client, made);
            }
        }
    }

    wsprintf(answer, "%lx,err=%x", (DWORD)DdeCreateStringHandle(client, "", CP_WINANSI),
             DdeGetLastError(client));
    record("DdeCreateStringHandle", "empty", answer);
    wsprintf(answer, "%lx,err=%x", (DWORD)DdeCreateStringHandle(client, NULL, CP_WINANSI),
             DdeGetLastError(client));
    record("DdeCreateStringHandle", "null", answer);

    got = DdeQueryString(client, service, NULL, 0, CP_WINANSI);
    wsprintf(answer, "%lu,err=%x", got, DdeGetLastError(client));
    record("DdeQueryString", "Service,null", answer);

    lstrcpy(buffer, "xxxxxxxxxx");
    got = DdeQueryString(client, service, buffer, 4, CP_WINANSI);
    wsprintf(answer, "%lu,%s", got, (LPSTR)buffer);
    record("DdeQueryString", "Service,4", answer);

    lstrcpy(buffer, "xxxxxxxxxx");
    got = DdeQueryString(client, 0, buffer, 10, CP_WINANSI);
    wsprintf(answer, "%lu,%s", got, (LPSTR)buffer);
    record("DdeQueryString", "0,10", answer);

    got = DdeQueryString(client, service, buffer, 40, 1200);
    wsprintf(answer, "%lu,err=%x", got, DdeGetLastError(client));
    record("DdeQueryString", "Service,40,1200", answer);

    /* The high word of a string handle, as DDEML makes it of an instance's
     * own name. */
    got = DdeQueryString(client, MAKELONG(LOWORD(service), 0x12ab), buffer, 40, CP_WINANSI);
    wsprintf(answer, "%lu,%s", got, (LPSTR)buffer);
    record("DdeQueryString", "Service:12ab,40", answer);
    got = DdeQueryString(client, MAKELONG(LOWORD(service), 0x12ab), buffer, 12, CP_WINANSI);
    wsprintf(answer, "%lu,%s", got, (LPSTR)buffer);
    record("DdeQueryString", "Service:12ab,12", answer);
    got = DdeQueryString(client, MAKELONG(LOWORD(service), 0x12ab), NULL, 0, CP_WINANSI);
    wsprintf(answer, "%lu", got);
    record("DdeQueryString", "Service:12ab,null", answer);

    other = DdeCreateStringHandle(client, "Zebra", CP_WINANSI);
    wsprintf(answer, "%d,%d,%d,%d,%d,order=%d", DdeCmpStringHandles(service, service),
             DdeCmpStringHandles(service, other), DdeCmpStringHandles(other, service),
             DdeCmpStringHandles(service, 0), DdeCmpStringHandles(0, service),
             LOWORD(service) < LOWORD(other) ? -1 : 1);
    record("DdeCmpStringHandles", "Service,Zebra", answer);
    wsprintf(answer, "%d,%d",
             DdeCmpStringHandles(MAKELONG(LOWORD(service), 1), service),
             DdeCmpStringHandles(service, MAKELONG(LOWORD(service), 1)));
    record("DdeCmpStringHandles", "Service:1,Service", answer);

    /* Each handle is a count on its atom. */
    counted = DdeCreateStringHandle(client, "Counted", CP_WINANSI);
    got = (DWORD)DdeKeepStringHandle(client, counted);
    /* It answers the atom GlobalAddAtom answered. */
    wsprintf(answer, "keep=%s",
             (LPSTR)((UINT)got == GlobalFindAtom("Counted") ? "atom" : "other"));
    lstrcat(answer, GlobalFindAtom("Counted") ? ",there" : ",gone");
    wsprintf(answer + lstrlen(answer), ",free=%d", DdeFreeStringHandle(client, counted));
    lstrcat(answer, GlobalFindAtom("Counted") ? ",there" : ",gone");
    wsprintf(answer + lstrlen(answer), ",free=%d", DdeFreeStringHandle(client, counted));
    lstrcat(answer, GlobalFindAtom("Counted") ? ",there" : ",gone");
    record("DdeKeepStringHandle", "Counted", answer);

    got = DdeFreeStringHandle(client, 0);
    wsprintf(answer, "%d,err=%x", (BOOL)got, DdeGetLastError(client));
    record("DdeFreeStringHandle", "0", answer);
    wsprintf(answer, "%d,%d", DdeFreeStringHandle(client ^ 0x10000L, service),
             DdeKeepStringHandle(client ^ 0x10000L, service));
    record("DdeFreeStringHandle", "other serial", answer);

    DdeFreeStringHandle(client, other);
    DdeFreeStringHandle(client, upper);
    DdeFreeStringHandle(client, service);
    wsprintf(answer, "Service=%s", (LPSTR)(GlobalFindAtom("Service") ? "there" : "gone"));
    record("DdeFreeStringHandle", "Service x3", answer);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    OFSTRUCT reopen;
    PFNCALLBACK callback;
    PFNCALLBACK monitored;
    DWORD id;
    DWORD extra[5];
    UINT answer;
    char result[200];
    char name[24];
    HCONV first = 0;
    HCONV second = 0;
    HCONV third = 0;
    HCONVLIST list;
    HCONVLIST again;
    HCONV each;
    CONVCONTEXT context;
    int i;

    module = instance;
    probeOpen(OUTPUT);
    OpenFile(LOG, &reopen, OF_DELETE);

    callback = (PFNCALLBACK)MakeProcInstance((FARPROC)Callback, instance);
    monitored = (PFNCALLBACK)MakeProcInstance((FARPROC)MonitorCallback, instance);

    /* Instances. */
    wsprintf(result, "%x", DdeGetLastError(0));
    probe("DdeGetLastError", "0", result);

    id = 0;
    answer = DdeInitialize(&id, callback, APPCMD_CLIENTONLY, 1L);
    wsprintf(result, "%x,id=%lx", answer, id);
    probe("DdeInitialize", "ulRes=1", result);

    answer = DdeInitialize(&client, callback, APPCMD_CLIENTONLY, 0L);
    wsprintf(result, "%x,serial=%u", answer, HIWORD(client));
    probe("DdeInitialize", "APPCMD_CLIENTONLY", result);

    {
        UINT mine = DdeGetLastError(client);
        UINT other = DdeGetLastError(client ^ 0x10000L);

        wsprintf(result, "%x,%x", mine, other);
        probe("DdeGetLastError", "client,other serial", result);
    }

    answer = DdeInitialize(&monitor, monitored,
                           APPCLASS_MONITOR | MF_HSZ_INFO | MF_ERRORS | MF_CONV | MF_CALLBACKS,
                           0L);
    wsprintf(result, "%x,serial=%u", answer, HIWORD(monitor));
    probe("DdeInitialize", "APPCLASS_MONITOR", result);

    for (i = 0; i < 4; i++) {
        extra[i] = 0;
        answer = DdeInitialize(&extra[i], monitored, APPCLASS_MONITOR, 0L);
        wsprintf(result, "%x,%s", answer, (LPSTR)(extra[i] ? "made" : "0"));
        probe("DdeInitialize", "another monitor", result);
    }

    for (i = 0; i < 4; i++) {
        if (extra[i]) {
            wsprintf(result, "%d", DdeUninitialize(extra[i]));
            probe("DdeUninitialize", "another monitor", result);
        }
    }

    /* Again with the instance's own id: only the CBF_ and MF_ flags. */
    id = client;
    answer = DdeInitialize(&id, callback, 0L, 0L);
    wsprintf(result, "%x,same=%u", answer, id == client ? 1 : 0);
    record("DdeInitialize", "again,0", result);
    {
        HSZ mine = DdeCreateStringHandle(client, "Mine", CP_WINANSI);
        LONG done = (LONG)DdeNameService(client, mine, 0, DNS_REGISTER);

        wsprintf(result, "%ld,err=%x", done, DdeGetLastError(client));
        record("DdeNameService", "client only,Mine,DNS_REGISTER", result);
    }
    id = client ^ 0x10000L;
    answer = DdeInitialize(&id, callback, 0L, 0L);
    wsprintf(result, "%x", answer);
    record("DdeInitialize", "again,other serial", result);
    {
        BOOL none = DdeUninitialize(0);
        BOOL other = DdeUninitialize(client ^ 0x10000L);

        wsprintf(result, "%d,%d", none, other);
        record("DdeUninitialize", "0,other serial", result);
    }

    strings();

    /* The server. */
    WinExec("DDEMGMTC.EXE", SW_SHOWNOACTIVATE);

    for (i = 0; i < 300 && !FindWindow(NULL, "Mgmt Server"); i++) {
        settle(1);
    }

    server = FindWindow(NULL, "Mgmt Server");
    serverTask = server ? GetWindowTask(server) : 0;
    record("WinExec", "DDEMGMTC.EXE", server ? "started" : "none");

    /* Until it registers a name, a server's DDEML answers no one. */
    connect("MgmtSrv,Topic,before register", "MgmtSrv", "Topic", NULL, NULL);

    wsprintf(result, "%ld", order(1, 0));
    record("DdeNameService", "server,MgmtSrv,DNS_REGISTER", result);

    connect("MgmtSrv,Topic", "MgmtSrv", "Topic", NULL, &first);
    {
        char kind[24], above[24], top[24];
        HWND window = (HWND)LOWORD(first);

        GetClassName(window, kind, sizeof(kind));
        GetClassName(GetParent(window), above, sizeof(above));
        lstrcpy(top, "none");

        if (GetParent(GetParent(window))) {
            GetClassName(GetParent(GetParent(window)), top, sizeof(top));
        }

        wsprintf(result, "%s,%s,%s,word4=%u", (LPSTR)kind, (LPSTR)above, (LPSTR)top,
                 GetWindowWord(window, 4) == HIWORD(first) ? 1 : 0);
        record("windows", "first conversation", result);
    }
    info("first,QID_SYNC,58", first, QID_SYNC, sizeof(CONVINFO));
    info("first,QID_SYNC,10", first, QID_SYNC, 10);
    info("first,5,58", first, 5, sizeof(CONVINFO));
    {
        BOOL sync = DdeSetUserHandle(first, QID_SYNC, 0x12345678L);
        UINT syncError = DdeGetLastError(client);
        BOOL five = DdeSetUserHandle(first, 5, 0x1L);
        UINT fiveError = DdeGetLastError(client);

        wsprintf(result, "%d,err=%x,%d,err=%x", sync, syncError, five, fiveError);
        record("DdeSetUserHandle", "first,QID_SYNC;first,5", result);
    }
    info("first,QID_SYNC,58,user", first, QID_SYNC, sizeof(CONVINFO));
    wsprintf(result, "%ld", order(10, 0));
    record("server info", "", result);

    context.cb = sizeof(context);
    context.wFlags = 1;
    context.wCountryID = 44;
    context.iCodePage = 850;
    context.dwLangID = 9;
    context.dwSecurity = 0x77;
    connect("MgmtSrv,Topic,context", "MgmtSrv", "Topic", &context, &second);
    info("context,QID_SYNC,58", second, QID_SYNC, sizeof(CONVINFO));
    context.cb = 12;
    connect("MgmtSrv,Topic,context cb=12", "MgmtSrv", "Topic", &context, NULL);
    wsprintf(result, "%d", DdeDisconnect(second));
    record("DdeDisconnect", "context", result);

    /* Wildcards: the server's pairs. */
    connect("-,-", NULL, NULL, NULL, &second);
    info("wild,QID_SYNC,58", second, QID_SYNC, sizeof(CONVINFO));
    wsprintf(result, "%d", DdeDisconnect(second));
    record("DdeDisconnect", "wild", result);
    connect("MgmtSrv,-", "MgmtSrv", NULL, NULL, &second);
    wsprintf(result, "%d", DdeDisconnect(second));
    record("DdeDisconnect", "wild service", result);

    /* Lists. */
    list = DdeConnectList(client, 0, 0, 0, NULL);
    wsprintf(result, "%s,err=%x", convText((DWORD)list, name), DdeGetLastError(client));
    record("DdeConnectList", "-,-,none", result);

    for (each = DdeQueryNextServer(list, 0), i = 0; each && i < 8;
         each = DdeQueryNextServer(list, each), i++) {
        wsprintf(result, "%s", convText((DWORD)each, name));
        info(result, each, QID_SYNC, sizeof(CONVINFO));
    }

    again = DdeConnectList(client, 0, 0, list, NULL);
    wsprintf(result, "%s,err=%x", convText((DWORD)again, name), DdeGetLastError(client));
    record("DdeConnectList", "-,-,list", result);
    result[0] = '\0';

    for (each = DdeQueryNextServer(again, 0), i = 0; each && i < 8;
         each = DdeQueryNextServer(again, each), i++) {
        lstrcat(result, convText((DWORD)each, name));
        lstrcat(result, " ");
    }

    record("DdeQueryNextServer", "again", result);
    each = DdeQueryNextServer(again, (HCONV)0x00010001L);
    wsprintf(result, "%s,err=%x,old=%s", convText((DWORD)each, name), DdeGetLastError(client),
             (LPSTR)(IsWindow((HWND)LOWORD(list)) ? "window" : "gone"));
    record("DdeQueryNextServer", "again,bogus", result);
    i = DdeDisconnectList(again);
    wsprintf(result, "%d,err=%x", i, DdeGetLastError(client));
    record("DdeDisconnectList", "again", result);
    i = DdeDisconnectList(again);
    wsprintf(result, "%d,err=%x", i, DdeGetLastError(client));
    wsprintf(result + lstrlen(result), ",monitor=%x", DdeGetLastError(monitor));
    record("DdeDisconnectList", "again,twice", result);

    list = DdeConnectList(client, DdeCreateStringHandle(client, "Nobody", CP_WINANSI), 0, 0,
                          NULL);
    wsprintf(result, "%s,err=%x", convText((DWORD)list, name), DdeGetLastError(client));
    record("DdeConnectList", "Nobody,-,none", result);

    /* The server's filter of names. */
    wsprintf(result, "%ld", order(3, DNS_FILTEROFF));
    record("DdeNameService", "server,DNS_FILTEROFF", result);
    connect("Unregd,Topic,filter off", "Unregd", "Topic", NULL, NULL);
    wsprintf(result, "%ld", order(3, DNS_FILTERON));
    record("DdeNameService", "server,DNS_FILTERON", result);
    connect("Unregd,Topic,filter on", "Unregd", "Topic", NULL, NULL);

    /* A server talking to itself. */
    wsprintf(result, "%ld", order(6, 0));
    record("server self", "", result);

    /* Ending a conversation, from each side. */
    i = DdeDisconnect(first);
    wsprintf(result, "%d,err=%x", i, DdeGetLastError(client));
    lstrcat(result, IsWindow((HWND)LOWORD(first)) ? ",window" : ",gone");
    record("DdeDisconnect", "first", result);
    info("first,after", first, QID_SYNC, sizeof(CONVINFO));
    i = DdeDisconnect(first);
    wsprintf(result, "%d,err=%x", i, DdeGetLastError(client));
    wsprintf(result + lstrlen(result), ",monitor=%x", DdeGetLastError(monitor));
    record("DdeDisconnect", "first,twice", result);

    connect("MgmtSrv,Topic,third", "MgmtSrv", "Topic", NULL, &third);
    reconnect = TRUE;
    wsprintf(result, "%ld", order(5, 0));
    record("server disconnect", "third", result);
    reconnect = FALSE;
    info("third,after", third, QID_SYNC, sizeof(CONVINFO));
    info("reconnected", reconnected, QID_SYNC, sizeof(CONVINFO));
    each = DdeReconnect(first);
    wsprintf(result, "%s,err=%x", convText((DWORD)each, name), DdeGetLastError(client));
    record("DdeReconnect", "first,gone", result);

    /* Callbacks enabled and not. */
    i = DdeEnableCallback(client, reconnected, 1);
    wsprintf(result, "%d,err=%x;", i, DdeGetLastError(client));
    i = DdeEnableCallback(client, reconnected, EC_QUERYWAITING);
    wsprintf(result + lstrlen(result), "%d,err=%x;", i, DdeGetLastError(client));
    i = DdeEnableCallback(client, (HCONV)0x00010001L, EC_DISABLE);
    wsprintf(result + lstrlen(result), "%d,err=%x;", i, DdeGetLastError(client));
    i = DdeEnableCallback(client ^ 0x10000L, 0, EC_ENABLEALL);
    wsprintf(result + lstrlen(result), "%d,err=%x", i, DdeGetLastError(client));
    record("DdeEnableCallback", "1;EC_QUERYWAITING;bogus;other serial", result);
    wsprintf(result, "%d", DdeEnableCallback(client, reconnected, EC_DISABLE));
    record("DdeEnableCallback", "reconnected,EC_DISABLE", result);
    info("reconnected,disabled", reconnected, QID_SYNC, sizeof(CONVINFO));
    wsprintf(result, "%d", DdeEnableCallback(client, reconnected, EC_ENABLEONE));
    record("DdeEnableCallback", "reconnected,EC_ENABLEONE", result);
    info("reconnected,one", reconnected, QID_SYNC, sizeof(CONVINFO));
    wsprintf(result, "%d", DdeEnableCallback(client, 0, EC_DISABLE));
    record("DdeEnableCallback", "0,EC_DISABLE", result);
    connect("MgmtSrv,Topic,disabled", "MgmtSrv", "Topic", NULL, &second);
    info("disabled,new", second, QID_SYNC, sizeof(CONVINFO));
    info("reconnected,all disabled", reconnected, QID_SYNC, sizeof(CONVINFO));
    wsprintf(result, "%d", DdeEnableCallback(client, 0, EC_ENABLEALL));
    record("DdeEnableCallback", "0,EC_ENABLEALL", result);
    info("disabled,enabled", second, QID_SYNC, sizeof(CONVINFO));
    wsprintf(result, "%ld", order(7, EC_DISABLE));
    record("server enable", "EC_DISABLE", result);
    wsprintf(result, "%ld", order(10, 0));
    record("server info", "disabled", result);
    wsprintf(result, "%ld", order(7, 2));
    record("server enable", "EC_QUERYWAITING", result);
    wsprintf(result, "%ld", order(7, EC_ENABLEALL));
    record("server enable", "EC_ENABLEALL", result);
    wsprintf(result, "%d", DdeDisconnect(second));
    record("DdeDisconnect", "disabled", result);

    /* More names. */
    wsprintf(result, "%ld", order(1, 3));
    record("DdeNameService", "server,Second,DNS_REGISTER", result);
    wsprintf(result, "%ld", order(2, 3));
    record("DdeNameService", "server,Second,DNS_UNREGISTER", result);
    wsprintf(result, "%ld", order(2, 4));
    record("DdeNameService", "server,Never,DNS_UNREGISTER", result);
    wsprintf(result, "%ld", order(1, 3));
    record("DdeNameService", "server,Second,DNS_REGISTER", result);
    wsprintf(result, "%ld", order(2, 0xffff));
    record("DdeNameService", "server,0,DNS_UNREGISTER", result);
    connect("MgmtSrv,Topic,unregistered", "MgmtSrv", "Topic", NULL, NULL);
    wsprintf(result, "%ld", order(1, 0));
    record("DdeNameService", "server,MgmtSrv,DNS_REGISTER", result);

    /* The server's instance ended while a conversation is open: posted, so
     * that this program takes what it is posted meanwhile. */
    connect("MgmtSrv,Topic,before end", "MgmtSrv", "Topic", NULL, &second);
    PostMessage(server, WM_USER + 8, 0, 0L);

    for (i = 0; i < 200; i++) {
        settle(1);
    }

    record("server uninitialize", "", "posted");
    info("before end,after", second, QID_SYNC, sizeof(CONVINFO));
    info("reconnected,after end", reconnected, QID_SYNC, sizeof(CONVINFO));
    connect("MgmtSrv,Topic,after end", "MgmtSrv", "Topic", NULL, NULL);

    PostMessage(server, WM_USER + 11, 0, 0L);

    for (i = 0; i < 300 && IsWindow(server); i++) {
        settle(1);
    }

    record("server closed", "", IsWindow(server) ? "running" : "closed");

    wsprintf(result, "%d", DdeUninitialize(client));
    record("DdeUninitialize", "client", result);
    wsprintf(result, "%d", DdeUninitialize(client));
    record("DdeUninitialize", "client,twice", result);
    wsprintf(result, "%d", DdeUninitialize(monitor));
    probe("DdeUninitialize", "monitor", result);

    probeFinish();
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
