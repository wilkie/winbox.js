/*
 * The server `ddemon.c` starts: a DDEML server, service "MONSRV", topic
 * "MTOPIC", in an overlapped window "Mon Server". It writes nothing; the
 * probe's monitors see it. It answers:
 *
 * * XTYP_CONNECT: TRUE for the topic "MTOPIC".
 * * XTYP_REQUEST: "nak", nought; any other item, the text "<item>-data".
 * * XTYP_POKE: DDE_FACK. XTYP_ADVSTART: TRUE. XTYP_ADVREQ: "<item>-adv".
 * * XTYP_EXECUTE: DDE_FACK; "[advise]" also, after the callback,
 *   `DdePostAdvise` of the item "alpha".
 *
 * `WM_USER + 9` closes it.
 */

#include <windows.h>
#include <ddeml.h>

#pragma library("ddeml")

static DWORD instance;
static HSZ service;
static HSZ topic;
static HWND window;

static HDDEDATA reply(LPCSTR suffix, HSZ item)
{
    char value[60];

    DdeQueryString(instance, item, value, 32, CP_WINANSI);
    lstrcat(value, suffix);
    return DdeCreateDataHandle(instance, (LPBYTE)value, lstrlen(value) + 1, 0, item, CF_TEXT, 0);
}

HDDEDATA CALLBACK __export Callback(UINT type, UINT format, HCONV conv, HSZ one, HSZ two,
                                    HDDEDATA data, DWORD first, DWORD second)
{
    char name[40];

    (void)format;
    (void)conv;
    (void)first;
    (void)second;

    switch (type) {
    case XTYP_CONNECT:
        DdeQueryString(instance, one, name, 32, CP_WINANSI);
        return (HDDEDATA)(lstrcmpi(name, "MTOPIC") == 0);

    case XTYP_REQUEST:
        DdeQueryString(instance, two, name, 32, CP_WINANSI);

        if (lstrcmpi(name, "nak") == 0) {
            return 0;
        }

        return reply("-data", two);

    case XTYP_POKE:
        return (HDDEDATA)DDE_FACK;

    case XTYP_EXECUTE:
        DdeGetData(data, (LPBYTE)name, sizeof(name) - 1, 0);

        if (lstrcmpi(name, "[advise]") == 0) {
            PostMessage(window, WM_USER + 1, 0, 0L);
        }

        return (HDDEDATA)DDE_FACK;

    case XTYP_ADVSTART:
        return (HDDEDATA)TRUE;

    case XTYP_ADVREQ:
        return reply("-adv", two);
    }

    return 0;
}

LRESULT CALLBACK __export Proc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    HSZ item;

    switch (message) {
    case WM_USER + 1:
        item = DdeCreateStringHandle(instance, "alpha", CP_WINANSI);
        DdePostAdvise(instance, topic, item);
        DdeFreeStringHandle(instance, item);
        return 0;

    case WM_USER + 9:
        DestroyWindow(hwnd);
        return 0;

    case WM_DESTROY:
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

    kind.style = 0;
    kind.lpfnWndProc = Proc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = module;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "DdeMonS";
    RegisterClass(&kind);

    DdeInitialize(&instance, (PFNCALLBACK)MakeProcInstance((FARPROC)Callback, module),
                  CBF_SKIP_REGISTRATIONS | CBF_SKIP_UNREGISTRATIONS, 0L);
    service = DdeCreateStringHandle(instance, "MONSRV", CP_WINANSI);
    topic = DdeCreateStringHandle(instance, "MTOPIC", CP_WINANSI);
    DdeNameService(instance, service, 0, DNS_REGISTER);
    window = CreateWindow("DdeMonS", "Mon Server", WS_OVERLAPPEDWINDOW, 340, 40, 200, 150, NULL,
                          NULL, module, NULL);
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
