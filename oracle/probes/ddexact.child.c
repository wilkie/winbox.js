/*
 * The server `ddexact.c` starts: a DDEML server, service "DXSERV", topic
 * "DXTOPIC", whose callback writes a line to C:\ORACLE\DDEX.TXT for each
 * transaction it is handed -- `S:`, the type, the format, the two strings,
 * the data (as text, or `-` for none) and the two double words -- and
 * answers by the item's name:
 *
 * * XTYP_REQUEST: "alpha" in CF_TEXT, the text last poked to "alpha"
 *   ("alpha-data" at first); "nak", or any other format, nought;
 *   "block", CBR_BLOCK; "advthen", `DdePostAdvise` of "hotb" made inside
 *   the callback, then "advthen-data".
 * * XTYP_POKE: "busy", DDE_FBUSY; "nak", DDE_FNOTPROCESSED; "app",
 *   DDE_FACK with the application's bits 2Ah; "block", CBR_BLOCK, but
 *   DDE_FACK while it is enabling its callbacks again; any
 *   other, DDE_FACK, and the text kept as "alpha"'s.
 * * XTYP_EXECUTE: "[busy]", DDE_FBUSY; "[nak]", DDE_FNOTPROCESSED;
 *   "[advise:<item>]", DDE_FACK, and after the callback has returned,
 *   `DdePostAdvise` of that item (its answer written `S:postadvise`);
 *   "[twice:<item>]", the same, twice in a row; "[enable]", DDE_FACK, and
 *   after, `DdeEnableCallback(EC_ENABLEALL)`; any other, DDE_FACK.
 * * XTYP_ADVSTART: "nolink", FALSE; any other, TRUE.
 * * XTYP_ADVREQ: the text "<item>#<n>", n counting the requests.
 *
 * A pointer it is handed in the first double word (XTYP_CONNECT's
 * context) is written as 1, and none as 0; a second double word other
 * than 0, 1 and FFFFh as EEEEh.
 *
 * It ends when its window is closed.
 */

#include <windows.h>
#include <ddeml.h>

#pragma library("ddeml")

#define LOG "C:\\ORACLE\\DDEX.TXT"

static DWORD instance;
static HSZ service;
static HSZ topic;
static HWND window;
static char alpha[64] = "alpha-data";
static char advised[32];
static int requests;
static BOOL enabling;

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

static HDDEDATA reply(LPCSTR value, HSZ item)
{
    return DdeCreateDataHandle(instance, (LPBYTE)value, lstrlen(value) + 1, 0, item, CF_TEXT,
                               0);
}

HDDEDATA CALLBACK __export Callback(UINT type, UINT format, HCONV conv, HSZ one, HSZ two,
                                    HDDEDATA data, DWORD first, DWORD second)
{
    char line[200];
    char a[40];
    char b[40];
    char value[80];
    char item[40];
    DWORD size;
    int i;

    text(one, a);
    text(two, b);
    lstrcpy(item, b);
    lstrcpy(value, "-");

    if (data && type != XTYP_ADVSTART) {
        size = DdeGetData(data, (LPBYTE)value, sizeof(value) - 1, 0);
        value[(int)size] = '\0';

        for (i = 0; value[i]; i++) {
            if (value[i] == ':' || value[i] < ' ') {
                value[i] = '.';
            }
        }

        wsprintf(value + lstrlen(value), "/%lu", DdeGetData(data, NULL, 0, 0));
    }

    wsprintf(line, "S:%s:%u:%s:%s:%s:%lx:%lx", kind(type), format, (LPSTR)a, (LPSTR)b,
             (LPSTR)value,
             type == XTYP_CONNECT || type == XTYP_WILDCONNECT || type == XTYP_CONNECT_CONFIRM
                 ? (DWORD)(first != 0)
                 : first,
             second <= 1 || second == 0xffff ? second : 0xeeeeL);
    note(line);

    (void)conv;

    switch (type) {
    case XTYP_CONNECT:
        return (HDDEDATA)(lstrcmpi(a, "DXTOPIC") == 0);

    case XTYP_REQUEST:
        if (lstrcmpi(item, "block") == 0) {
            return enabling ? reply("released", two) : CBR_BLOCK;
        }

        if (format != CF_TEXT) {
            return 0;
        }

        if (lstrcmpi(item, "alpha") == 0) {
            return reply(alpha, two);
        }

        if (lstrcmpi(item, "advthen") == 0) {
            HSZ hot = DdeCreateStringHandle(instance, "hotb", CP_WINANSI);

            wsprintf(line, "S:inside:%d", DdePostAdvise(instance, topic, hot));
            note(line);
            DdeFreeStringHandle(instance, hot);
            return reply("advthen-data", two);
        }

        return 0;

    case XTYP_POKE:
        if (lstrcmpi(item, "busy") == 0) {
            return (HDDEDATA)DDE_FBUSY;
        }

        if (lstrcmpi(item, "nak") == 0) {
            return (HDDEDATA)DDE_FNOTPROCESSED;
        }

        if (lstrcmpi(item, "app") == 0) {
            return (HDDEDATA)(DDE_FACK | 0x2a);
        }

        if (lstrcmpi(item, "block") == 0) {
            return enabling ? (HDDEDATA)DDE_FACK : CBR_BLOCK;
        }

        DdeGetData(data, (LPBYTE)alpha, sizeof(alpha) - 1, 0);
        return (HDDEDATA)DDE_FACK;

    case XTYP_EXECUTE:
        DdeGetData(data, (LPBYTE)value, sizeof(value) - 1, 0);

        if (lstrcmpi(value, "[busy]") == 0) {
            return (HDDEDATA)DDE_FBUSY;
        }

        if (lstrcmpi(value, "[nak]") == 0) {
            return (HDDEDATA)DDE_FNOTPROCESSED;
        }

        if (value[0] == '[' && value[1] == 'a' && value[7] == ':') {
            lstrcpy(advised, value + 8);
            advised[lstrlen(advised) - 1] = '\0';
            PostMessage(window, WM_USER + 1, 1, 0L);
        }

        if (value[0] == '[' && value[1] == 't' && value[6] == ':') {
            lstrcpy(advised, value + 7);
            advised[lstrlen(advised) - 1] = '\0';
            PostMessage(window, WM_USER + 1, 2, 0L);
        }

        if (lstrcmpi(value, "[enable]") == 0) {
            PostMessage(window, WM_USER + 2, 0, 0L);
        }

        return (HDDEDATA)DDE_FACK;

    case XTYP_ADVSTART:
        return (HDDEDATA)(lstrcmpi(item, "nolink") != 0);

    case XTYP_ADVREQ:
        requests++;
        wsprintf(value, "%s#%d", (LPSTR)item, requests);
        return reply(value, two);
    }

    return 0;
}

LRESULT CALLBACK __export Proc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    char line[60];
    HSZ item;
    WPARAM i;

    if (message == WM_USER + 1) {
        item = DdeCreateStringHandle(instance, advised, CP_WINANSI);

        for (i = 0; i < wParam; i++) {
            wsprintf(line, "S:postadvise:%s:%d", (LPSTR)advised,
                     DdePostAdvise(instance, topic, item));
            note(line);
        }

        DdeFreeStringHandle(instance, item);
        return 0;
    }

    if (message == WM_USER + 2) {
        enabling = TRUE;
        wsprintf(line, "S:enable:%d", DdeEnableCallback(instance, 0, EC_ENABLEALL));
        enabling = FALSE;
        note(line);
        return 0;
    }

    if (message == WM_DESTROY) {
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
    char line[40];

    kind.style = 0;
    kind.lpfnWndProc = Proc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = module;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "DdeXactS";
    RegisterClass(&kind);

    window = CreateWindow("DdeXactS", "Probe S", WS_OVERLAPPEDWINDOW, 340, 40, 200, 150, NULL,
                          NULL, module, NULL);

    wsprintf(line, "S:init:%u",
             DdeInitialize(&instance, (PFNCALLBACK)MakeProcInstance((FARPROC)Callback, module),
                           CBF_SKIP_REGISTRATIONS | CBF_SKIP_UNREGISTRATIONS, 0L));
    note(line);
    service = DdeCreateStringHandle(instance, "DXSERV", CP_WINANSI);
    topic = DdeCreateStringHandle(instance, "DXTOPIC", CP_WINANSI);
    wsprintf(line, "S:names:%d", DdeNameService(instance, service, 0, DNS_REGISTER) != 0);
    note(line);

    while (GetMessage(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
