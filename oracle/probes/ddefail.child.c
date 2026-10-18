/*
 * The server `ddefail.c` starts: a DDEML server, service "FAILSRV", topic
 * "FTOPIC", in an overlapped window "Fail Server". Its callback writes a
 * line to C:\ORACLE\DDEF.TXT for each transaction it is handed -- `S:`,
 * the type, the format, the two strings, the data (as text, or `-`) and
 * the two double words -- and answers:
 *
 * * XTYP_CONNECT: TRUE for the topic "FTOPIC".
 * * XTYP_REQUEST: "block", CBR_BLOCK, unless it is releasing; any other
 *   item, the text "<item>-data".
 * * XTYP_POKE, XTYP_EXECUTE: DDE_FACK. XTYP_ADVSTART: TRUE.
 *
 * Its orders, each sent to its window and its answer the call's:
 *
 * * `WM_USER + 1`: `DdeInitialize` again with its own id, the `CBF_`
 *   flags in lParam (with CBF_SKIP_REGISTRATIONS and
 *   CBF_SKIP_UNREGISTRATIONS always).
 * * `WM_USER + 2`: `DdeEnableCallback(id, 0, wParam)`; with lParam 1, on
 *   the last conversation it was handed instead; with lParam's high word
 *   1, releasing blocked requests meanwhile.
 * * `WM_USER + 3`: `DdeConnect` to itself, "FAILSRV", "FTOPIC", the
 *   conversation then ended; its answer 1 when made.
 * * `WM_USER + 9`: closes it.
 */

#include <windows.h>
#include <ddeml.h>

#pragma library("ddeml")

#define LOG "C:\\ORACLE\\DDEF.TXT"

static DWORD instance;
static PFNCALLBACK callback;
static HSZ service;
static HSZ topic;
static HCONV last;
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

static LPCSTR kind(UINT type)
{
    switch (type) {
    case XTYP_ADVDATA: return "advdata";
    case XTYP_ADVREQ: return "advreq";
    case XTYP_ADVSTART: return "advstart";
    case XTYP_ADVSTOP: return "advstop";
    case XTYP_EXECUTE: return "execute";
    case XTYP_CONNECT: return "connect";
    case XTYP_CONNECT_CONFIRM: return "confirm";
    case XTYP_XACT_COMPLETE: return "complete";
    case XTYP_POKE: return "poke";
    case XTYP_REGISTER: return "register";
    case XTYP_REQUEST: return "request";
    case XTYP_DISCONNECT: return "disconnect";
    case XTYP_UNREGISTER: return "unregister";
    case XTYP_WILDCONNECT: return "wildconnect";
    case XTYP_ERROR: return "error";
    }

    return "other";
}

static void text(HSZ hsz, LPSTR out)
{
    out[0] = '\0';

    if (hsz) {
        DdeQueryString(instance, hsz, out, 32, CP_WINANSI);
    } else {
        lstrcpy(out, "0");
    }
}

HDDEDATA CALLBACK __export Callback(UINT type, UINT format, HCONV conv, HSZ one, HSZ two,
                                    HDDEDATA data, DWORD first, DWORD second)
{
    char line[200];
    char a[40];
    char b[40];
    char value[80];
    DWORD size;
    int i;

    text(one, a);
    text(two, b);
    lstrcpy(value, "-");

    if (data && type != XTYP_ADVSTART) {
        size = DdeGetData(data, (LPBYTE)value, sizeof(value) - 1, 0);
        value[(int)size] = '\0';

        for (i = 0; value[i]; i++) {
            if (value[i] == ':' || value[i] == '|' || value[i] < ' ') {
                value[i] = '.';
            }
        }
    }

    wsprintf(line, "S:%s:%u:%s:%s:%s:%lx:%lx", kind(type), format, (LPSTR)a, (LPSTR)b,
             (LPSTR)value,
             type == XTYP_CONNECT || type == XTYP_WILDCONNECT || type == XTYP_CONNECT_CONFIRM
                 ? (DWORD)(first != 0)
                 : first,
             second <= 1 || second == 0xffff ? second : 0xeeeeL);
    note(line);

    if (conv) {
        last = conv;
    }

    switch (type) {
    case XTYP_CONNECT:
        return (HDDEDATA)(lstrcmpi(a, "FTOPIC") == 0);

    case XTYP_REQUEST:
        if (lstrcmpi(b, "block") == 0 && !releasing) {
            return CBR_BLOCK;
        }

        wsprintf(value, "%s-data", (LPSTR)b);
        return DdeCreateDataHandle(instance, (LPBYTE)value, lstrlen(value) + 1, 0, two, CF_TEXT,
                                   0);

    case XTYP_POKE:
    case XTYP_EXECUTE:
        return (HDDEDATA)DDE_FACK;

    case XTYP_ADVSTART:
        return (HDDEDATA)TRUE;
    }

    return 0;
}

LRESULT CALLBACK __export Proc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    DWORD id;
    HCONV self;
    LRESULT answer;

    switch (message) {
    case WM_USER + 1:
        id = instance;
        return DdeInitialize(&id, callback,
                             lParam | CBF_SKIP_REGISTRATIONS | CBF_SKIP_UNREGISTRATIONS, 0L);

    case WM_USER + 2:
        releasing = HIWORD(lParam) != 0;
        answer = DdeEnableCallback(instance, LOWORD(lParam) ? last : 0, wParam);
        releasing = FALSE;
        return answer;

    case WM_USER + 3:
        self = DdeConnect(instance, service, topic, NULL);

        if (self) {
            DdeDisconnect(self);
        }

        return self != 0;

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
    kind.lpszClassName = "DdeFailS";
    RegisterClass(&kind);

    callback = (PFNCALLBACK)MakeProcInstance((FARPROC)Callback, module);
    DdeInitialize(&instance, callback, CBF_SKIP_REGISTRATIONS | CBF_SKIP_UNREGISTRATIONS, 0L);
    service = DdeCreateStringHandle(instance, "FAILSRV", CP_WINANSI);
    topic = DdeCreateStringHandle(instance, "FTOPIC", CP_WINANSI);
    DdeNameService(instance, service, 0, DNS_REGISTER);

    /* Made last: the client waits for the window, and finds the name
     * registered. */
    window = CreateWindow("DdeFailS", "Fail Server", WS_OVERLAPPEDWINDOW, 340, 40, 200, 150,
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
