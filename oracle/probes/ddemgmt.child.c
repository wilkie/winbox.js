/*
 * The server `ddemgmt.c` starts, "Mgmt Server": a DDEML instance of its own
 * (`DdeInitialize` with no flags) and a window the probe sends its orders
 * to, one `WM_USER` message each, the answer written and returned. It
 * writes a line to C:\ORACLE\DDEMGMT.TXT for every callback DDEML makes it,
 * `S:` and the transaction's type, its format, conversation, string
 * handles, data, the two data words, and what it answered:
 *
 * * `XTYP_CONNECT` is answered TRUE for "MgmtSrv" and "Second", FALSE for
 *   any other service; its CONVCONTEXT is written out.
 * * `XTYP_WILDCONNECT` is answered with the pairs MgmtSrv/Topic and
 *   MgmtSrv/Other, as a data handle.
 * * The others are answered nought.
 *
 * A conversation is written by the class of its window (`cli`, `srv`) and
 * the order in which this program first saw it; a string handle by its
 * text, an instance's own name as `Name:(frame)` where its high word is a
 * DDEML frame window.
 */

#include <windows.h>
#include <ddeml.h>

#pragma library("ddeml")

#define LOG "C:\\ORACLE\\DDEMGMT.TXT"

static DWORD instance;
static HCONV seen[24];
static int seenCount;
static HCONV lastServer;
static HINSTANCE module;
static HSZ names[5];

static void note(LPCSTR text)
{
    HFILE file = _lopen(LOG, OF_READWRITE);

    if (file == HFILE_ERROR) {
        file = _lcreat(LOG, 0);
    }

    _llseek(file, 0L, 2);
    _lwrite(file, text, lstrlen(text));
    _lwrite(file, "\r\n", 2);
    _lclose(file);
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

static LPSTR convText(HCONV conv, LPSTR out)
{
    char kind[24];
    int i;

    if (!conv) {
        lstrcpy(out, "0");
        return out;
    }

    for (i = 0; i < seenCount && seen[i] != conv; i++) {
    }

    if (i == seenCount && seenCount < 24) {
        seen[seenCount++] = conv;
    }

    kind[0] = '\0';

    if (IsWindow((HWND)LOWORD(conv))) {
        GetClassName((HWND)LOWORD(conv), kind, sizeof(kind));
    }

    wsprintf(out, "%s%d",
             (LPSTR)(!lstrcmp(kind, "DMGClientClass")   ? "cli"
                     : !lstrcmp(kind, "DMGServerClass") ? "srv"
                                                        : "gone"),
             i + 1);
    return out;
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
    }

    return "other";
}

static void convInfo(LPCSTR who, HCONV conv)
{
    CONVINFO info;
    char line[300];
    char a[48], b[48], c[48], d[48], e[24];
    UINT got;

    info.cb = sizeof(info);
    got = DdeQueryConvInfo(conv, QID_SYNC, &info);

    if (!got) {
        wsprintf(line, "S:info:%s:0:err=%x", who, DdeGetLastError(instance));
        note(line);
        return;
    }

    wsprintf(line,
             "S:info:%s:%u:user=%lx,partner=%s,svcPartner=%s,svcReq=%s,topic=%s,item=%s,fmt=%u,"
             "type=%x,status=%x,convst=%u,err=%x,list=%s,cc=%u/%u/%u/%d/%lu/%lu",
             who, got, info.hUser, convText(info.hConvPartner, e),
             hszText(info.hszSvcPartner, a), hszText(info.hszServiceReq, b),
             hszText(info.hszTopic, c), hszText(info.hszItem, d), info.wFmt, info.wType,
             info.wStatus, info.wConvst, info.wLastError, (LPSTR)(info.hConvList ? "yes" : "0"),
             info.ConvCtxt.cb, info.ConvCtxt.wFlags, info.ConvCtxt.wCountryID,
             info.ConvCtxt.iCodePage, info.ConvCtxt.dwLangID, info.ConvCtxt.dwSecurity);
    note(line);
}

HDDEDATA CALLBACK __export Callback(UINT type, UINT format, HCONV conv, HSZ hsz1, HSZ hsz2,
                                    HDDEDATA data, DWORD data1, DWORD data2)
{
    char line[300];
    char one[48];
    char two[48];
    char three[24];
    char extra[80];
    HDDEDATA answer = 0;

    extra[0] = '\0';

    if (type == XTYP_CONNECT) {
        CONVCONTEXT FAR *context = (CONVCONTEXT FAR *)data1;

        if (context) {
            wsprintf(extra, "cc=%u/%u/%u/%d/%lu/%lu", context->cb, context->wFlags,
                     context->wCountryID, context->iCodePage, context->dwLangID,
                     context->dwSecurity);
        } else {
            lstrcpy(extra, "cc=null");
        }

        hszText(hsz2, one);
        answer = (HDDEDATA)(DWORD)(!lstrcmp(one, "MgmtSrv") || !lstrcmp(one, "Second"));
    } else if (type == XTYP_WILDCONNECT) {
        HSZPAIR pairs[3];

        wsprintf(extra, "cc=%s", (LPSTR)(data1 ? "yes" : "null"));
        pairs[0].hszSvc = names[0];
        pairs[0].hszTopic = names[1];
        pairs[1].hszSvc = names[0];
        pairs[1].hszTopic = names[2];
        pairs[2].hszSvc = 0;
        pairs[2].hszTopic = 0;
        answer = DdeCreateDataHandle(instance, (LPBYTE)pairs, sizeof(pairs), 0, 0, 0, 0);
    } else if (type == XTYP_CONNECT_CONFIRM) {
        lastServer = conv;
    }

    wsprintf(line, "S:%s:fmt=%u:%s:%s:%s:data=%s:%lx:%lx%s%s=%s", typeText(type), format,
             convText(conv, three), hszText(hsz1, one), hszText(hsz2, two),
             (LPSTR)(data ? "yes" : "0"),
             type == XTYP_CONNECT || type == XTYP_WILDCONNECT ? 0L : data1,
             data2, (LPSTR)(extra[0] ? ":" : ""), (LPSTR)extra,
             (LPSTR)(answer ? (type == XTYP_WILDCONNECT ? "pairs" : "1") : "0"));
    note(line);

    if (type == XTYP_CONNECT_CONFIRM) {
        convInfo("confirm", conv);
    }

    return answer;
}

LRESULT CALLBACK __export Proc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    char line[160];
    char one[48];
    LONG result;
    HCONV conv;

    switch (message) {
    case WM_USER + 1:
        /* Register a name: 0 MgmtSrv, 3 Second, 4 Never. */
        result = (LONG)DdeNameService(instance, names[wParam], 0, DNS_REGISTER);
        wsprintf(line, "S:register(%s)=%ld,err=%x", hszText(names[wParam], one), result,
                 DdeGetLastError(instance));
        note(line);
        return result;

    case WM_USER + 2:
        /* Unregister a name, or every name for 0FFFFh. */
        result = (LONG)DdeNameService(instance, wParam == 0xffff ? 0 : names[wParam], 0,
                                      DNS_UNREGISTER);
        wsprintf(line, "S:unregister(%s)=%ld,err=%x",
                 wParam == 0xffff ? (LPSTR) "all" : hszText(names[wParam], one), result,
                 DdeGetLastError(instance));
        note(line);
        return result;

    case WM_USER + 3:
        result = (LONG)DdeNameService(instance, 0, 0, wParam);
        wsprintf(line, "S:filter(%u)=%ld,err=%x", wParam, result, DdeGetLastError(instance));
        note(line);
        return result;

    case WM_USER + 5:
        result = DdeDisconnect(lastServer);
        wsprintf(line, "S:disconnect(%s)=%ld,err=%x", convText(lastServer, one), result,
                 DdeGetLastError(instance));
        note(line);
        return result;

    case WM_USER + 6:
        conv = DdeConnect(instance, names[0], names[1], NULL);
        wsprintf(line, "S:self=%s,err=%x", convText(conv, one), DdeGetLastError(instance));
        note(line);

        if (conv) {
            convInfo("self", conv);
            convInfo("selfserver", lastServer);
            result = DdeDisconnect(conv);
            wsprintf(line, "S:selfdisconnect=%ld", result);
            note(line);
        }

        return 0;

    case WM_USER + 7:
        result = DdeEnableCallback(instance, 0, wParam);
        wsprintf(line, "S:enable(%u)=%ld,err=%x", wParam, result, DdeGetLastError(instance));
        note(line);
        return result;

    case WM_USER + 8:
        result = DdeUninitialize(instance);
        wsprintf(line, "S:uninitialize=%ld", result);
        note(line);
        return result;

    case WM_USER + 10:
        convInfo("server", lastServer);
        return 0;

    case WM_USER + 11:
        DestroyWindow(window);
        return 0;

    case WM_DESTROY:
        PostQuitMessage(0);
        return 0;
    }

    return DefWindowProc(window, message, wParam, lParam);
}

int PASCAL WinMain(HINSTANCE hInstance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HWND window;
    MSG msg;
    UINT answer;
    char line[80];

    module = hInstance;
    answer = DdeInitialize(&instance,
                           (PFNCALLBACK)MakeProcInstance((FARPROC)Callback, hInstance), 0L, 0L);
    wsprintf(line, "S:initialize=%x,serial=%u", answer, HIWORD(instance));
    note(line);

    names[0] = DdeCreateStringHandle(instance, "MgmtSrv", CP_WINANSI);
    names[1] = DdeCreateStringHandle(instance, "Topic", CP_WINANSI);
    names[2] = DdeCreateStringHandle(instance, "Other", CP_WINANSI);
    names[3] = DdeCreateStringHandle(instance, "Second", CP_WINANSI);
    names[4] = DdeCreateStringHandle(instance, "Never", CP_WINANSI);

    kind.style = 0;
    kind.lpfnWndProc = Proc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = hInstance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "DdeMgmtS";
    RegisterClass(&kind);

    window = CreateWindow("DdeMgmtS", "Mgmt Server", WS_OVERLAPPEDWINDOW, 400, 300, 160, 100,
                          NULL, NULL, hInstance, NULL);
    ShowWindow(window, SW_SHOWNOACTIVATE);
    UpdateWindow(window);

    while (GetMessage(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
