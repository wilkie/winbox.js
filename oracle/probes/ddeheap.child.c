/*
 * The server `ddeheap.c` starts: a DDEML server, service "HEAPSRV", topic
 * "HTOPIC", in an overlapped window "Heap Server", whose callbacks are
 * disabled at once with `DdeEnableCallback(EC_DISABLE)`: each transaction
 * a client makes is kept in its instance's queue, in the instance's own
 * heap, until that is full.
 *
 * Its own loop counts the WM_DDE_REQUEST messages it takes for DDEML's
 * window, so that what happens is told by the request it happened in. To
 * C:\ORACLE\DDEH.TXT it writes `S:error` for each XTYP_ERROR it is called
 * back -- `dwData1`, `DdeGetLastError`'s, the request it came in -- and
 * posts `WM_USER + 5` to the probe's window, "DdeHeapC"; and the type of
 * any other callback. `WM_USER + 1` writes `S:last` with the requests
 * counted and `DdeGetLastError`'s. `WM_USER + 9` closes it.
 */

#include <windows.h>
#include <dde.h>
#include <ddeml.h>

#pragma library("ddeml")

#define LOG "C:\\ORACLE\\DDEH.TXT"

static DWORD instance;
static HSZ service;
static HSZ topic;
static int requests;

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
    char line[80];

    (void)format;
    (void)conv;
    (void)two;
    (void)data;

    switch (type) {
    case XTYP_CONNECT:
        DdeQueryString(instance, one, name, 32, CP_WINANSI);
        return (HDDEDATA)(lstrcmpi(name, "HTOPIC") == 0);

    case XTYP_CONNECT_CONFIRM:
        return 0;

    case XTYP_ERROR:
        wsprintf(line, "S:error:%lx:%lx:%x:at=%d", first, second, DdeGetLastError(instance),
                 requests);
        note(line);
        PostMessage(FindWindow("DdeHeapC", NULL), WM_USER + 5, 0, 0L);
        return 0;
    }

    wsprintf(line, "S:type:%x:at=%d", type, requests);
    note(line);
    return 0;
}

LRESULT CALLBACK __export Proc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    char line[60];

    switch (message) {
    case WM_USER + 1:
        wsprintf(line, "S:last:%d:%x", requests, DdeGetLastError(instance));
        note(line);
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
    kind.lpszClassName = "DdeHeapS";
    RegisterClass(&kind);

    DdeInitialize(&instance, (PFNCALLBACK)MakeProcInstance((FARPROC)Callback, module),
                  CBF_SKIP_REGISTRATIONS | CBF_SKIP_UNREGISTRATIONS | CBF_SKIP_DISCONNECTS, 0L);
    service = DdeCreateStringHandle(instance, "HEAPSRV", CP_WINANSI);
    topic = DdeCreateStringHandle(instance, "HTOPIC", CP_WINANSI);
    DdeNameService(instance, service, 0, DNS_REGISTER);
    DdeEnableCallback(instance, 0, EC_DISABLE);
    window = CreateWindow("DdeHeapS", "Heap Server", WS_OVERLAPPEDWINDOW, 340, 40, 200, 150,
                          NULL, NULL, module, NULL);
    ShowWindow(window, SW_SHOWNOACTIVATE);

    while (GetMessage(&msg, NULL, 0, 0)) {
        if (msg.message == WM_DDE_REQUEST) {
            requests++;
        }

        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
