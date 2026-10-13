/*
 * DDEML's transactions and data handles, from a client's side and its
 * server's: what `DdeClientTransaction` answers for each kind of
 * transaction, synchronous and asynchronous, what `DdeGetLastError` says
 * after it and what it leaves in `pdwResult`; what the server's callback
 * is handed for each; advise links hot, warm and with acknowledgement
 * asked for, and `DdePostAdvise`; a server that blocks (CBR_BLOCK), a
 * transaction that times out, `DdeAbandonTransaction`; what the modal loop
 * of a synchronous transaction dispatches; the data handles' calls
 * (`DdeCreateDataHandle`, `DdeAddData`, `DdeGetData`, `DdeAccessData`,
 * `DdeFreeDataHandle`); and the shared memory DDEML posts, seen by a
 * conversation of plain WM_DDE_* messages with the same server.
 *
 * The server is DDEXACTC.EXE (`ddexact.child.c`), started at once,
 * service "DXSERV", topic "DXTOPIC". Both write what their callbacks are
 * handed to C:\ORACLE\DDEX.TXT, the server `S:`, this program `C:`; each
 * record ends with every line written since the one before, `|` between.
 * A transaction's record is its answer (`0`, `1`, or `h` for a data
 * handle), `DdeGetLastError`'s, `pdwResult` (set to AAAAAAAAh before), and
 * the data a handle holds. A transaction's identifier and a handle's
 * value are Windows' to choose: they are written as `id` and `h`.
 */

#define PROBE_FLUSH
#include "probe.h"
#include <dde.h>
#include <ddeml.h>

#pragma library("ddeml")

#define OUTPUT "C:\\ORACLE\\DDEXACT.OUT"
#define LOG "C:\\ORACLE\\DDEX.TXT"

static DWORD instance;
static HWND mine;
static HCONV conv;
static HCONV second;
static DWORD lastId;
static int seen;
static char text[4000];
static char out[1800];
static BOOL freeInCallback;

/* `DdeAccessData` answers a far pointer; the compiler's header says a near
 * one, which would keep only the offset. */
typedef LPBYTE(WINAPI *ACCESS)(HDDEDATA, LPDWORD);

/* The plain conversation's partner, and what it last answered. */
static HWND partner;

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

/* The lines written since last asked, `|` between, after `head`. */
static void since(LPCSTR function, LPCSTR what, LPCSTR head)
{
    HFILE file = _lopen(LOG, OF_READ);
    int length = 0;
    int i;
    int lines = 0;
    int at;

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
    case XTYP_ERROR: return "error";
    }

    return "other";
}

static void name(HSZ hsz, LPSTR into)
{
    if (hsz) {
        into[0] = '\0';
        DdeQueryString(instance, hsz, into, 32, CP_WINANSI);
    } else {
        lstrcpy(into, "0");
    }
}

/* What a handle holds, as text, with `/` and the size it says it has. */
static void contents(HDDEDATA data, LPSTR into)
{
    char value[80];
    DWORD size;
    int i;

    if (!data) {
        lstrcpy(into, "-");
        return;
    }

    size = DdeGetData(data, (LPBYTE)value, sizeof(value) - 1, 0);
    value[(int)size] = '\0';

    for (i = 0; value[i]; i++) {
        if (value[i] == ':' || value[i] == '|' || value[i] < ' ') {
            value[i] = '.';
        }
    }

    wsprintf(into, "%s/%lu", (LPSTR)value, DdeGetData(data, NULL, 0, 0));
}

HDDEDATA CALLBACK __export Callback(UINT type, UINT format, HCONV which, HSZ one, HSZ two,
                                    HDDEDATA data, DWORD first, DWORD next)
{
    char line[200];
    char a[40];
    char b[40];
    char value[100];
    char d1[16];

    name(one, a);
    name(two, b);

    contents(data, value);

    if (type == XTYP_XACT_COMPLETE) {
        lstrcpy(d1, first == lastId ? "id" : "other");
    } else {
        wsprintf(d1, "%lx", first);
    }

    wsprintf(line, "C:%s:%u:%s:%s:%s:%s:%lx:%s", kind(type), format, (LPSTR)a, (LPSTR)b,
             (LPSTR)value, (LPSTR)d1, next,
             (LPSTR)(which == conv ? "conv" : which == second ? "second" : "?"));
    note(line);

    if (type == XTYP_ADVDATA && freeInCallback && data) {
        freeInCallback = FALSE;
        wsprintf(line, "C:free:%d", DdeFreeDataHandle(data));
        note(line);
        contents(data, value);
        wsprintf(line, "C:after:%s", (LPSTR)value);
        note(line);
    }

    if (type == XTYP_ADVDATA) {
        return (HDDEDATA)DDE_FACK;
    }

    return 0;
}

/* One transaction: its answer, the error, `pdwResult`, the data. */
static void xact(LPCSTR label, HCONV on, LPCSTR data, DWORD size, LPCSTR item, UINT format,
                 UINT type, DWORD timeout)
{
    HSZ hsz = item ? DdeCreateStringHandle(instance, item, CP_WINANSI) : 0;
    DWORD result = 0xAAAAAAAAL;
    HDDEDATA answer;
    UINT error;
    char value[100];
    char head[200];
    char shown[20];
    int i;

    answer = DdeClientTransaction((LPBYTE)data, size, on, hsz, format, type, timeout, &result);
    error = DdeGetLastError(instance);

    if (timeout == TIMEOUT_ASYNC) {
        lastId = result;
        lstrcpy(shown, result ? "id" : "0");
        lstrcpy(value, "-");
    } else {
        wsprintf(shown, "%lx", result);

        if ((DWORD)answer > 1 && type == XTYP_REQUEST) {
            contents(answer, value);
        } else {
            lstrcpy(value, "-");
        }
    }

    wsprintf(head, "%s,%x,%s,%s",
             (LPSTR)(answer == 0 ? "0" : (DWORD)answer == 1 ? "1" : "h"), error,
             (LPSTR)shown, (LPSTR)value);

    if ((DWORD)answer > 1 && type == XTYP_REQUEST) {
        /* A handle a transaction answered is the application's: adding to
         * it is refused, freeing it is not. */
        i = DdeAddData(answer, (LPBYTE)"zz", 2, 0) != 0;
        wsprintf(head + lstrlen(head), ",add=%d:%x", i, DdeGetLastError(instance));
        wsprintf(head + lstrlen(head), ",free=%d", DdeFreeDataHandle(answer));
    }

    settle(30);
    since("xact", label, head);

    if (hsz) {
        DdeFreeStringHandle(instance, hsz);
    }
}

LONG FAR PASCAL __export Proc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    char line[200];
    char item[40];
    LPWORD header;
    DWORD result;
    HDDEDATA answer;
    HSZ hsz;

    if (message == WM_USER + 1) {
        wsprintf(line, "C:user:%u", wParam);
        note(line);
        return 0;
    }

    if (message == WM_USER + 2) {
        hsz = DdeCreateStringHandle(instance, "alpha", CP_WINANSI);
        answer = DdeClientTransaction(NULL, 0, conv, hsz, CF_TEXT, XTYP_REQUEST, 5000, &result);
        wsprintf(line, "C:nested:%d:%x", answer != 0, DdeGetLastError(instance));
        note(line);
        DdeFreeStringHandle(instance, hsz);
        return 0;
    }

    if (message == WM_TIMER) {
        wsprintf(line, "C:timer:%u", wParam);
        note(line);
        KillTimer(hwnd, wParam);
        return 0;
    }

    /* The plain conversation. */
    if (message == WM_DDE_ACK) {
        if (!partner) {
            partner = (HWND)wParam;
            GlobalGetAtomName(HIWORD(lParam), item, sizeof(item));
            wsprintf(line, "C:raw-ack-init:%s", (LPSTR)item);
            GlobalDeleteAtom(LOWORD(lParam));
            GlobalDeleteAtom(HIWORD(lParam));
        } else {
            wsprintf(line, "C:raw-ack:%x:%s", LOWORD(lParam),
                     (LPSTR)(HIWORD(lParam) ? "hi" : "0"));
        }

        note(line);
        return 0;
    }

    if (message == WM_DDE_DATA) {
        item[0] = '\0';
        GlobalGetAtomName(HIWORD(lParam), item, sizeof(item));

        if (LOWORD(lParam)) {
            header = (LPWORD)GlobalLock((HGLOBAL)LOWORD(lParam));
            wsprintf(line, "C:raw-data:%s:%x:%u:%lu:%x:%s", (LPSTR)item, header[0], header[1],
                     GlobalSize((HGLOBAL)LOWORD(lParam)),
                     GlobalFlags((HGLOBAL)LOWORD(lParam)) & GMEM_DDESHARE,
                     (LPSTR)(header + 2));
            note(line);

            if (header[0] & 0x8000) {
                PostMessage((HWND)wParam, WM_DDE_ACK, (WPARAM)hwnd,
                            MAKELPARAM(0x8000, HIWORD(lParam)));
            } else {
                GlobalDeleteAtom(HIWORD(lParam));
            }

            GlobalUnlock((HGLOBAL)LOWORD(lParam));

            if (header[0] & 0x2000) {
                GlobalFree((HGLOBAL)LOWORD(lParam));
            }
        } else {
            wsprintf(line, "C:raw-data:%s:none", (LPSTR)item);
            note(line);
            GlobalDeleteAtom(HIWORD(lParam));
        }

        return 0;
    }

    if (message == WM_DDE_TERMINATE) {
        note("C:raw-terminate");
        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

/* The data handles' own calls. */
static void handles(void)
{
    HSZ item = DdeCreateStringHandle(instance, "hd", CP_WINANSI);
    HDDEDATA data;
    HDDEDATA other;
    BYTE bytes[40];
    LPBYTE at;
    DWORD size;
    char line[200];
    int i;

    data = DdeCreateDataHandle(instance, (LPBYTE)"abcdefgh", 9, 0, item, CF_TEXT, 0);
    wsprintf(probeArgs, "abcdefgh,9,0,item");
    wsprintf(probeResult, "%s,%x", (LPSTR)(data ? "h" : "0"), DdeGetLastError(instance));
    probe("DdeCreateDataHandle", probeArgs, probeResult);

    wsprintf(probeResult, "%lu", DdeGetData(data, NULL, 0, 0));
    probe("DdeGetData", "null,0,0", probeResult);

    lstrcpy((LPSTR)bytes, "--------");
    size = DdeGetData(data, bytes, 4, 0);
    wsprintf(probeResult, "%lu,%s", size, (LPSTR)bytes);
    probe("DdeGetData", "buf,4,0", probeResult);

    lstrcpy((LPSTR)bytes, "--------");
    size = DdeGetData(data, bytes, 40, 2);
    wsprintf(probeResult, "%lu,%s,%x", size, (LPSTR)bytes, DdeGetLastError(instance));
    probe("DdeGetData", "buf,40,2", probeResult);

    size = DdeGetData(data, bytes, 40, 9);
    wsprintf(probeResult, "%lu,%x", size, DdeGetLastError(instance));
    probe("DdeGetData", "buf,40,9", probeResult);

    size = DdeGetData(data, bytes, 40, 200);
    wsprintf(probeResult, "%lu,%x", size, DdeGetLastError(instance));
    probe("DdeGetData", "buf,40,200", probeResult);

    at = ((ACCESS)DdeAccessData)(data, &size);
    line[0] = '\0';

    for (i = 0; at && i < 6; i++) {
        wsprintf(line + lstrlen(line), "%02x", at[i]);
    }

    wsprintf(probeResult, "%s,%lu,%s", (LPSTR)(at ? "p" : "0"), size, (LPSTR)line);
    probe("DdeAccessData", "abcdefgh", probeResult);

    wsprintf(probeResult, "%d", DdeUnaccessData(data));
    probe("DdeUnaccessData", "abcdefgh", probeResult);

    other = DdeAddData(data, (LPBYTE)"XYZ", 3, 4);
    lstrcpy((LPSTR)bytes, "--------");
    DdeGetData(data, bytes, 40, 0);
    wsprintf(probeResult, "%s,%lu,%s", (LPSTR)(other == data ? "same" : other ? "new" : "0"),
             DdeGetData(data, NULL, 0, 0), (LPSTR)bytes);
    probe("DdeAddData", "XYZ,3,4", probeResult);

    other = DdeAddData(data, (LPBYTE)"QQ", 2, 60);
    size = DdeGetData(data, NULL, 0, 0);
    DdeGetData(data, bytes, 2, 60);
    bytes[2] = '\0';
    wsprintf(probeResult, "%s,%lu,%s,%x", (LPSTR)(other == data ? "same" : other ? "new" : "0"),
             size, (LPSTR)bytes, DdeGetLastError(instance));
    probe("DdeAddData", "QQ,2,60", probeResult);

    i = DdeFreeDataHandle(data);
    wsprintf(probeResult, "%d,%x", i, DdeGetLastError(instance));
    probe("DdeFreeDataHandle", "abcdefgh", probeResult);

    /* No item: the block has no header, and its first four bytes are
     * where the header would be. */
    data = DdeCreateDataHandle(instance, NULL, 8, 0, 0, CF_TEXT, 0);
    size = DdeGetData(data, bytes, 8, 0);
    line[0] = '\0';

    for (i = 0; i < 4; i++) {
        wsprintf(line + lstrlen(line), "%02x", bytes[i]);
    }

    wsprintf(probeResult, "%s,%lu,%lu,%s", (LPSTR)(data ? "h" : "0"), size,
             DdeGetData(data, NULL, 0, 0), (LPSTR)line);
    probe("DdeCreateDataHandle", "null,8,0,0", probeResult);
    DdeFreeDataHandle(data);

    /* An offset: the source lands that far in. */
    data = DdeCreateDataHandle(instance, (LPBYTE)"xyz", 4, 3, item, CF_TEXT, 0);
    size = DdeGetData(data, bytes, 40, 3);
    wsprintf(probeResult, "%s,%lu,%lu,%s", (LPSTR)(data ? "h" : "0"), size,
             DdeGetData(data, NULL, 0, 0), (LPSTR)bytes);
    probe("DdeCreateDataHandle", "xyz,4,3,item", probeResult);
    DdeFreeDataHandle(data);

    /* Flags but HDATA_APPOWNED are refused. */
    data = DdeCreateDataHandle(instance, (LPBYTE)"xyz", 4, 0, item, CF_TEXT, 2);
    wsprintf(probeResult, "%s,%x", (LPSTR)(data ? "h" : "0"), DdeGetLastError(instance));
    probe("DdeCreateDataHandle", "xyz,4,0,item,flags2", probeResult);

    /* Nothing at all. */
    data = DdeCreateDataHandle(instance, NULL, 0, 0, item, CF_TEXT, 0);
    i = DdeGetLastError(instance);
    wsprintf(probeResult, "%s,%lu,%x", (LPSTR)(data ? "h" : "0"), DdeGetData(data, NULL, 0, 0),
             i);
    probe("DdeCreateDataHandle", "null,0,0,item", probeResult);
    DdeFreeDataHandle(data);

    /* Sizes as the global heap gives them. */
    for (i = 1; i <= 40; i += 13) {
        data = DdeCreateDataHandle(instance, NULL, (DWORD)i, 0, item, CF_TEXT, 0);
        DdeAccessData(data, &size);
        DdeUnaccessData(data);
        wsprintf(probeArgs, "null,%d,0,item", i);
        wsprintf(probeResult, "%lu,%lu", DdeGetData(data, NULL, 0, 0), size);
        probe("DdeGetData", probeArgs, probeResult);
        DdeFreeDataHandle(data);
    }

    DdeFreeStringHandle(instance, item);
}

/* The plain conversation, made and taken down. */
static void plain(void)
{
    ATOM app = GlobalAddAtom("DXSERV");
    ATOM subject = GlobalAddAtom("DXTOPIC");
    HGLOBAL block;
    LPWORD header;
    char head[40];

    partner = NULL;
    SendMessage((HWND)-1, WM_DDE_INITIATE, (WPARAM)mine, MAKELPARAM(app, subject));
    GlobalDeleteAtom(app);
    GlobalDeleteAtom(subject);
    settle(30);
    since("raw", "initiate", partner ? "partner" : "none");

    if (!partner) {
        return;
    }

    PostMessage(partner, WM_DDE_REQUEST, (WPARAM)mine,
                MAKELPARAM(CF_TEXT, GlobalAddAtom("alpha")));
    settle(30);
    since("raw", "request", "posted");

    PostMessage(partner, WM_DDE_REQUEST, (WPARAM)mine,
                MAKELPARAM(CF_TEXT, GlobalAddAtom("nak")));
    settle(30);
    since("raw", "request-nak", "posted");

    /* A poke whose block the server is to leave alone. */
    block = GlobalAlloc(GMEM_DDESHARE | GMEM_MOVEABLE, 4 + 6);
    header = (LPWORD)GlobalLock(block);
    header[0] = 0;
    header[1] = CF_TEXT;
    lstrcpy((LPSTR)(header + 2), "raw-p");
    GlobalUnlock(block);
    PostMessage(partner, WM_DDE_POKE, (WPARAM)mine, MAKELPARAM(block, GlobalAddAtom("plain")));
    settle(30);
    wsprintf(head, "kept=%lu", GlobalSize(block));
    since("raw", "poke", head);
    GlobalFree(block);

    block = GlobalAlloc(GMEM_DDESHARE | GMEM_MOVEABLE, 8);
    lstrcpy((LPSTR)GlobalLock(block), "[raw]");
    GlobalUnlock(block);
    PostMessage(partner, WM_DDE_EXECUTE, (WPARAM)mine, MAKELPARAM(0, block));
    settle(30);
    wsprintf(head, "kept=%lu", GlobalSize(block));
    since("raw", "execute", head);
    GlobalFree(block);

    /* A link with acknowledgement asked for. */
    block = GlobalAlloc(GMEM_DDESHARE | GMEM_MOVEABLE, 4);
    header = (LPWORD)GlobalLock(block);
    header[0] = 0x8000;
    header[1] = CF_TEXT;
    GlobalUnlock(block);
    PostMessage(partner, WM_DDE_ADVISE, (WPARAM)mine, MAKELPARAM(block, GlobalAddAtom("rawl")));
    settle(30);
    since("raw", "advise", "posted");

    xact("advise-raw", conv, "[twice:rawl]", 13, NULL, 0, XTYP_EXECUTE, 5000);

    PostMessage(partner, WM_DDE_UNADVISE, (WPARAM)mine, MAKELPARAM(CF_TEXT, GlobalAddAtom("rawl")));
    settle(30);
    since("raw", "unadvise", "posted");

    PostMessage(partner, WM_DDE_TERMINATE, (WPARAM)mine, 0L);
    settle(30);
    since("raw", "terminate", "posted");
    partner = NULL;
}

int PASCAL WinMain(HINSTANCE module, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HFILE file;
    HSZ service;
    HSZ topic;
    HDDEDATA data;
    DWORD result;
    MSG message;
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
    kind.lpszClassName = "DdeXactC";
    RegisterClass(&kind);

    mine = CreateWindow("DdeXactC", "Probe C", WS_OVERLAPPEDWINDOW, 40, 40, 200, 150, NULL, NULL,
                        module, NULL);

    wsprintf(probeResult, "%u",
             DdeInitialize(&instance, (PFNCALLBACK)MakeProcInstance((FARPROC)Callback, module),
                           CBF_SKIP_REGISTRATIONS | CBF_SKIP_UNREGISTRATIONS, 0L));
    probe("DdeInitialize", "client", probeResult);

    handles();

    WinExec("DDEXACTC.EXE", SW_SHOWNORMAL);
    service = DdeCreateStringHandle(instance, "DXSERV", CP_WINANSI);
    topic = DdeCreateStringHandle(instance, "DXTOPIC", CP_WINANSI);

    for (i = 0; i < 200 && !conv; i++) {
        settle(1);
        conv = DdeConnect(instance, service, topic, NULL);
    }

    settle(20);
    since("DdeConnect", "DXSERV,DXTOPIC", conv ? "conv" : "0");

    if (!conv) {
        probeFinish();
        return 0;
    }

    /* Requests. */
    xact("request-alpha", conv, NULL, 0, "alpha", CF_TEXT, XTYP_REQUEST, 5000);
    xact("request-format", conv, NULL, 0, "alpha", CF_BITMAP, XTYP_REQUEST, 5000);
    xact("request-nak", conv, NULL, 0, "nak", CF_TEXT, XTYP_REQUEST, 5000);
    xact("request-noitem", conv, NULL, 0, NULL, CF_TEXT, XTYP_REQUEST, 5000);
    xact("request-noformat", conv, NULL, 0, "alpha", 0, XTYP_REQUEST, 5000);
    xact("request-badtype", conv, NULL, 0, "alpha", CF_TEXT, 0x20c0, 5000);

    /* Pokes. */
    xact("poke-alpha", conv, "poked", 6, "alpha", CF_TEXT, XTYP_POKE, 5000);
    xact("request-poked", conv, NULL, 0, "alpha", CF_TEXT, XTYP_REQUEST, 5000);
    xact("poke-busy", conv, "b", 2, "busy", CF_TEXT, XTYP_POKE, 5000);
    xact("poke-nak", conv, "n", 2, "nak", CF_TEXT, XTYP_POKE, 5000);
    xact("poke-app", conv, "a", 2, "app", CF_TEXT, XTYP_POKE, 5000);
    xact("poke-noformat", conv, "a", 2, "alpha", 0, XTYP_POKE, 5000);

    /* Executes. */
    xact("execute", conv, "[hello]", 8, NULL, 0, XTYP_EXECUTE, 5000);
    xact("execute-busy", conv, "[busy]", 7, NULL, 0, XTYP_EXECUTE, 5000);
    xact("execute-nak", conv, "[nak]", 6, NULL, 0, XTYP_EXECUTE, 5000);
    xact("execute-item", conv, "[item]", 7, "alpha", CF_TEXT, XTYP_EXECUTE, 5000);

    /* Data handles given to a transaction: DDEML's afterwards, unless the
     * application keeps them. */
    data = DdeCreateDataHandle(instance, (LPBYTE)"[handle]", 9, 0, 0, 0, 0);
    result = 0xAAAAAAAAL;
    i = DdeClientTransaction((LPBYTE)data, (DWORD)-1, conv, 0, 0, XTYP_EXECUTE, 5000, &result)
        != 0;
    wsprintf(head, "%d,%x,%lx", i, DdeGetLastError(instance), result);
    settle(30);
    since("xact", "execute-handle", head);

    {
        HSZ item = DdeCreateStringHandle(instance, "alpha", CP_WINANSI);

        data = DdeCreateDataHandle(instance, (LPBYTE)"owned", 6, 0, item, CF_TEXT,
                                   HDATA_APPOWNED);

        for (i = 0; i < 2; i++) {
            BOOL done = DdeClientTransaction((LPBYTE)data, (DWORD)-1, conv, item, CF_TEXT,
                                             XTYP_POKE, 5000, &result) != 0;

            wsprintf(head, "%d,%x", done, DdeGetLastError(instance));
            settle(30);
            since("xact", i ? "poke-owned-again" : "poke-owned", head);
        }

        wsprintf(head, "%d", DdeFreeDataHandle(data));
        since("DdeFreeDataHandle", "owned", head);
        DdeFreeStringHandle(instance, item);
    }

    /* The modal loop: what it dispatches. */
    PostMessage(mine, WM_USER + 1, 1, 0L);
    xact("request-dispatch", conv, NULL, 0, "alpha", CF_TEXT, XTYP_REQUEST, 5000);

    PostMessage(mine, WM_USER + 2, 0, 0L);
    xact("request-nested", conv, NULL, 0, "alpha", CF_TEXT, XTYP_REQUEST, 5000);

    PostQuitMessage(3);
    xact("request-quit", conv, NULL, 0, "alpha", CF_TEXT, XTYP_REQUEST, 5000);
    wsprintf(head, "%s",
             (LPSTR)(PeekMessage(&message, NULL, WM_QUIT, WM_QUIT, PM_REMOVE) ? "quit" : "none"));
    since("after", "request-quit", head);

    /* Links. */
    xact("advstart-hota", conv, NULL, 0, "hota", CF_TEXT, XTYP_ADVSTART, 5000);
    xact("advstart-hota-again", conv, NULL, 0, "hota", CF_TEXT, XTYP_ADVSTART, 5000);
    xact("advstart-warm", conv, NULL, 0, "warm", CF_TEXT, XTYP_ADVSTART | XTYPF_NODATA, 5000);
    xact("advstart-ack", conv, NULL, 0, "acked", CF_TEXT, XTYP_ADVSTART | XTYPF_ACKREQ, 5000);
    xact("advstart-nolink", conv, NULL, 0, "nolink", CF_TEXT, XTYP_ADVSTART, 5000);
    xact("advstart-noitem", conv, NULL, 0, NULL, CF_TEXT, XTYP_ADVSTART | XTYPF_NODATA
         | XTYPF_ACKREQ, 5000);
    xact("advstart-hota-oem", conv, NULL, 0, "hota", CF_OEMTEXT, XTYP_ADVSTART, 5000);
    xact("advise-hota", conv, "[advise:hota]", 14, NULL, 0, XTYP_EXECUTE, 5000);
    xact("advstop-hota-oem", conv, NULL, 0, "hota", CF_OEMTEXT, XTYP_ADVSTOP, 5000);
    freeInCallback = TRUE;
    xact("advise-hota-free", conv, "[advise:hota]", 14, NULL, 0, XTYP_EXECUTE, 5000);
    freeInCallback = FALSE;
    xact("advise-warm", conv, "[advise:warm]", 14, NULL, 0, XTYP_EXECUTE, 5000);
    xact("advise-acked", conv, "[twice:acked]", 14, NULL, 0, XTYP_EXECUTE, 5000);
    xact("advise-none", conv, "[advise:none]", 14, NULL, 0, XTYP_EXECUTE, 5000);
    xact("advstart-hotb", conv, NULL, 0, "hotb", CF_TEXT, XTYP_ADVSTART, 5000);
    xact("request-advthen", conv, NULL, 0, "advthen", CF_TEXT, XTYP_REQUEST, 5000);
    xact("advstop-hota", conv, NULL, 0, "hota", CF_TEXT, XTYP_ADVSTOP, 5000);
    xact("advstop-hota-again", conv, NULL, 0, "hota", CF_TEXT, XTYP_ADVSTOP, 5000);
    xact("advise-hota-stopped", conv, "[advise:hota]", 14, NULL, 0, XTYP_EXECUTE, 5000);

    /* Asynchronous. */
    xact("async-request", conv, NULL, 0, "alpha", CF_TEXT, XTYP_REQUEST, TIMEOUT_ASYNC);
    xact("async-poke", conv, "apoke", 6, "alpha", CF_TEXT, XTYP_POKE, TIMEOUT_ASYNC);
    xact("async-poke-busy", conv, "b", 2, "busy", CF_TEXT, XTYP_POKE, TIMEOUT_ASYNC);
    xact("async-execute", conv, "[async]", 8, NULL, 0, XTYP_EXECUTE, TIMEOUT_ASYNC);

    /* A second conversation, to speak to the server while the first is
     * blocked. */
    second = DdeConnect(instance, service, topic, NULL);
    settle(20);
    since("DdeConnect", "second", second ? "conv" : "0");

    /* Blocked, then timed out; the server let go by the second. */
    SetTimer(mine, 7, 1, NULL);
    xact("request-block", conv, NULL, 0, "block", CF_TEXT, XTYP_REQUEST, 300);
    xact("request-blocked", conv, NULL, 0, "alpha", CF_TEXT, XTYP_REQUEST, 300);
    xact("enable", second, "[enable]", 9, NULL, 0, XTYP_EXECUTE, 5000);
    xact("request-after-enable", conv, NULL, 0, "alpha", CF_TEXT, XTYP_REQUEST, 5000);

    /* Blocked asynchronously, then abandoned. */
    xact("async-block", conv, NULL, 0, "block", CF_TEXT, XTYP_REQUEST, TIMEOUT_ASYNC);
    i = DdeAbandonTransaction(instance, conv, lastId);
    wsprintf(head, "%d,%x", i, DdeGetLastError(instance));
    since("DdeAbandonTransaction", "id", head);
    i = DdeAbandonTransaction(instance, conv, lastId);
    wsprintf(head, "%d,%x", i, DdeGetLastError(instance));
    since("DdeAbandonTransaction", "id-again", head);
    i = DdeAbandonTransaction(instance, conv, QID_SYNC);
    wsprintf(head, "%d,%x", i, DdeGetLastError(instance));
    since("DdeAbandonTransaction", "sync", head);
    xact("enable-again", second, "[enable]", 9, NULL, 0, XTYP_EXECUTE, 5000);

    xact("async-poke-block", conv, "pb", 3, "block", CF_TEXT, XTYP_POKE, TIMEOUT_ASYNC);
    xact("async-request-queued", conv, NULL, 0, "alpha", CF_TEXT, XTYP_REQUEST, TIMEOUT_ASYNC);
    i = DdeAbandonTransaction(instance, conv, 0);
    wsprintf(head, "%d,%x", i, DdeGetLastError(instance));
    since("DdeAbandonTransaction", "all", head);
    xact("enable-third", second, "[enable]", 9, NULL, 0, XTYP_EXECUTE, 5000);

    plain();

    wsprintf(head, "%d", DdeDisconnect(second));
    settle(20);
    since("DdeDisconnect", "second", head);
    wsprintf(head, "%d", DdeDisconnect(conv));
    settle(20);
    since("DdeDisconnect", "conv", head);

    DdeFreeStringHandle(instance, service);
    DdeFreeStringHandle(instance, topic);
    DdeUninitialize(instance);

    PostMessage(FindWindow("DdeXactS", NULL), WM_CLOSE, 0, 0L);
    settle(20);

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
