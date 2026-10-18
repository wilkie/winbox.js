/*
 * The server `ddenest.c` starts: a DDEML server, service "REENSRV", topic
 * "RTOPIC", in an overlapped window "Reen Server". Its callback answers
 * XTYP_CONNECT for "RTOPIC", and XTYP_REQUEST with the text
 * "<item>-data", but "block" with CBR_BLOCK. It writes to
 * C:\ORACLE\DDER.TXT a line `S:request:<item>` for each request it is
 * handed.
 *
 * `WM_USER + 3`, posted: a client instance of its own connects to its
 * service and makes a synchronous request of "alpha", a second's
 * time-out, while the probe waits in one of its own; the answer is
 * written `S:own:<answer>,<error>`. `WM_USER + 4`: its callbacks
 * enabled again, the blocked requests then answered as any other. `WM_USER
 * + 9` closes it.
 */

#include <windows.h>
#include <ddeml.h>

#pragma library("ddeml")

#define LOG "C:\\ORACLE\\DDER.TXT"

static DWORD instance;
static DWORD own;
static HSZ service;
static HSZ topic;
static BOOL releasing;

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

HDDEDATA CALLBACK __export Callback(UINT type, UINT format, HCONV conv, HSZ one, HSZ two,
                                    HDDEDATA data, DWORD first, DWORD second)
{
    char name[40];
    char line[60];

    (void)format;
    (void)conv;
    (void)data;
    (void)first;
    (void)second;

    switch (type) {
    case XTYP_CONNECT:
        DdeQueryString(instance, one, name, 32, CP_WINANSI);
        return (HDDEDATA)(lstrcmpi(name, "RTOPIC") == 0);

    case XTYP_REQUEST:
        DdeQueryString(instance, two, name, 32, CP_WINANSI);
        wsprintf(line, "S:request:%s", (LPSTR)name);
        note(line);

        if (lstrcmpi(name, "block") == 0 && !releasing) {
            return CBR_BLOCK;
        }

        lstrcat(name, "-data");
        return DdeCreateDataHandle(instance, (LPBYTE)name, lstrlen(name) + 1, 0, two, CF_TEXT, 0);
    }

    return 0;
}

HDDEDATA CALLBACK __export OwnCallback(UINT type, UINT format, HCONV conv, HSZ one, HSZ two,
                                       HDDEDATA data, DWORD first, DWORD second)
{
    (void)type;
    (void)format;
    (void)conv;
    (void)one;
    (void)two;
    (void)data;
    (void)first;
    (void)second;
    return 0;
}

LRESULT CALLBACK __export Proc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    HSZ s;
    HSZ t;
    HSZ item;
    HCONV conv;
    HDDEDATA answer;
    DWORD result;
    char line[60];

    switch (message) {
    case WM_USER + 3:
        s = DdeCreateStringHandle(own, "REENSRV", CP_WINANSI);
        t = DdeCreateStringHandle(own, "RTOPIC", CP_WINANSI);
        item = DdeCreateStringHandle(own, "alpha", CP_WINANSI);
        conv = DdeConnect(own, s, t, NULL);
        answer = DdeClientTransaction(NULL, 0, conv, item, CF_TEXT, XTYP_REQUEST, 1000, &result);
        wsprintf(line, "S:own:%s,%x", (LPSTR)(conv ? answer ? "h" : "0" : "noconv"),
                 DdeGetLastError(own));
        note(line);

        if (answer) {
            DdeFreeDataHandle(answer);
        }

        if (conv) {
            DdeDisconnect(conv);
        }

        DdeFreeStringHandle(own, item);
        DdeFreeStringHandle(own, s);
        DdeFreeStringHandle(own, t);
        return 0;

    case WM_USER + 4:
        releasing = TRUE;
        DdeEnableCallback(instance, 0, EC_ENABLEALL);
        releasing = FALSE;
        return 0;

    case WM_USER + 9:
        DestroyWindow(hwnd);
        return 0;

    case WM_DESTROY:
        DdeUninitialize(own);
        DdeNameService(instance, service, 0, DNS_UNREGISTER);
        DdeFreeStringHandle(instance, service);
        DdeFreeStringHandle(instance, topic);
        DdeUninitialize(instance);
        PostQuitMessage(0);
        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

int PASCAL WinMain(HINSTANCE module, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    MSG msg;
    HWND window;

    kind.style = 0;
    kind.lpfnWndProc = Proc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = module;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "DdeReenS";
    RegisterClass(&kind);

    DdeInitialize(&instance, (PFNCALLBACK)MakeProcInstance((FARPROC)Callback, module),
                  CBF_SKIP_REGISTRATIONS | CBF_SKIP_UNREGISTRATIONS, 0L);
    DdeInitialize(&own, (PFNCALLBACK)MakeProcInstance((FARPROC)OwnCallback, module),
                  APPCMD_CLIENTONLY | CBF_SKIP_ALLNOTIFICATIONS, 0L);
    service = DdeCreateStringHandle(instance, "REENSRV", CP_WINANSI);
    topic = DdeCreateStringHandle(instance, "RTOPIC", CP_WINANSI);
    DdeNameService(instance, service, 0, DNS_REGISTER);
    window = CreateWindow("DdeReenS", "Reen Server", WS_OVERLAPPEDWINDOW, 340, 40, 200, 150,
                          NULL, NULL, module, NULL);
    ShowWindow(window, SW_SHOWNOACTIVATE);

    while (GetMessage(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
