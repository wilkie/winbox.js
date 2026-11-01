/*
 * OLESVR's item windows: where `OLESVR.DLL` keeps an object's clients.
 * The probe registers its second program, `OLEITEMC.EXE`, as the server of
 * the class `OleItmProbe` and speaks OLE 1.0's DDE protocol to it by hand,
 * as `olesrv` does; between the messages it looks at the windows OLESVR
 * made beneath the server's -- each one's class, parent, text, style, id,
 * window words and properties -- and calls OLESVR's internal exports.
 *
 * A property is written by its name -- `@` and a window's handle in four
 * hex digits, the window named as the probe knows it (`conv<n>`, its
 * conversations' windows) -- and its datum: a window named so, or `h`
 * for another handle. An item window's words are a far pointer: the
 * server's child says which object's `OLECLIENT` it is (`client<n>`); the
 * block's size, flags and words follow, each word named by what it is.
 * Data and acknowledgements are written with the window that sent them.
 *
 * * `system`: two conversations on `OLEsystem` (the second unanswered),
 *   the server window's words and properties.
 * * `doc`: a document made, two conversations on it, the windows.
 * * `advise`: advises of Item1 (a picture, then native data, then
 *   native data at a save; from a second conversation native data, a
 *   picture and `ObjectLink`), a request of Item2, a deferred advise of
 *   Item3, an advise of the document itself; the windows after.
 * * `change`: the server's objects tell a change, a save, and
 *   OleSavedServerDoc: the data each conversation is sent.
 * * `unadvise`: the second conversation's advises of Item1 taken back,
 *   format by format and all at once.
 * * `direct`: FINDITEMWND, DELETECLIENTINFO, TERMINATECLIENTS,
 *   TERMINATEDOCCLIENTS, ENUMFORTERMINATE, SENDRENAMEMSG and SENDDATAMSG
 *   called as `EnumChildWindows` and `EnumProps` call them.
 * * `close`: OleRevokeObject, StdCloseDocument, TERMINATECLIENTS of the
 *   system conversation, OleRevokeServer.
 */

#include "probe.h"
#include <dde.h>
#include <shellapi.h>

#pragma library("shell")

#define OUTPUT "C:\\ORACLE\\OLEITEM.OUT"
#define CLASS "OleItmProbe"
#define SERVER "OLEITEMC.EXE"

#define MAXCONV 24

typedef struct {
    HWND mine;
    HWND server;
    char topic[80];
    int waiting;
    int last;
    int ended;
    int used;
} CONV;

static CONV convs[MAXCONV];
static HWND window;
static HINSTANCE self;
static int ticks;
static int done[64];
static UINT cfNative;
static UINT cfOwnerLink;
static UINT cfObjectLink;
static UINT cfBinary;
static CONV *initiating;

static void say(LPCSTR function, LPCSTR args, LPCSTR result)
{
    char line[1200];
    LPSTR at;
    HFILE file;

    at = probeEscape(line, function);
    *at++ = '\t';
    at = probeEscape(at, args);
    *at++ = '\t';
    at = probeEscape(at, result);
    *at++ = '\r';
    *at++ = '\n';

    file = _lopen(OUTPUT, OF_WRITE);

    if (file == HFILE_ERROR) {
        return;
    }

    _llseek(file, 0L, 2);
    _lwrite(file, line, (int)(at - line));
    _lclose(file);
}

static void note(LPCSTR text)
{
    say("#", "", text);
}

static LPSTR formatText(LPSTR out, UINT format)
{
    char name[40];

    if (format >= 0xc000) {
        name[0] = 0;
        GetClipboardFormatName(format, name, sizeof name);
        return out + wsprintf(out, "%s", (LPSTR)name);
    }

    return out + wsprintf(out, "%u", format);
}

static LPSTR atomText(LPSTR out, ATOM atom)
{
    char name[80];

    if (!atom) {
        return out + wsprintf(out, "(none)");
    }

    name[0] = 0;
    GlobalGetAtomName(atom, name, sizeof name);
    return out + wsprintf(out, "%s", (LPSTR)name);
}

static LPSTR hex(LPSTR out, const BYTE far *bytes, unsigned count)
{
    unsigned i;

    for (i = 0; i < count; i++) {
        out += wsprintf(out, "%02x", bytes[i]);
    }

    *out = 0;
    return out;
}

/* A window by its class, and its parent's. */
static LPSTR windowText(LPSTR out, HWND hwnd)
{
    char name[40];
    HWND parent = GetParent(hwnd);

    name[0] = 0;
    GetClassName(hwnd, name, sizeof name);
    out += wsprintf(out, "%s", (LPSTR)name);

    if (parent) {
        name[0] = 0;
        GetClassName(parent, name, sizeof name);
        out += wsprintf(out, "<%s", (LPSTR)name);
    }

    return out;
}

static CONV *find(HWND mine)
{
    int i;

    for (i = 0; i < MAXCONV; i++) {
        if (convs[i].mine == mine) {
            return &convs[i];
        }
    }

    return NULL;
}

static void conversationGone(CONV *c)
{
    DestroyWindow(c->mine);
    c->mine = 0;
}

/* A data message's bytes, as each format lays them out. */
static void describe(LPSTR out, UINT format, HGLOBAL value)
{
    LPBYTE bytes = (LPBYTE)GlobalLock(value);
    DWORD size = GlobalSize(value);

    if (!bytes) {
        lstrcpy(out, "(none)");
        return;
    }

    out += wsprintf(out, "%04x ", *(WORD far *)bytes);

    if (format == CF_METAFILEPICT) {
        HGLOBAL picture = *(HGLOBAL far *)(bytes + 4);
        LPMETAFILEPICT p = picture ? (LPMETAFILEPICT)GlobalLock(picture) : NULL;

        if (p) {
            wsprintf(out, "%d %d %d", p->mm, p->xExt, p->yExt);
            GlobalUnlock(picture);
        } else {
            wsprintf(out, "nopicture");
        }
    } else if (format == CF_TEXT) {
        /* Text to its nought, its tabs written as tabs are escaped. */
        out += wsprintf(out, "%s", (LPSTR)bytes + 4);
    } else if (format == cfOwnerLink || format == cfObjectLink) {
        LPSTR text = (LPSTR)bytes + 4;
        int k;

        for (k = 0; k < 3 && *text; k++) {
            out += wsprintf(out, "%s|", text);
            text += lstrlen(text) + 1;
        }
    } else if (format == cfBinary) {
        out += wsprintf(out, "%s", (LPSTR)bytes + 4);
    } else if (format == cfNative) {
        hex(out, bytes + 4, size >= 20 ? 16 : (unsigned)size - 4);
    } else {
        hex(out, bytes + 4, size >= 12 ? 8 : (unsigned)size - 4);
    }

    GlobalUnlock(value);
}

/* The data to a picture's block, freed. */
static void freeData(UINT format, HGLOBAL value)
{
    LPBYTE bytes = (LPBYTE)GlobalLock(value);

    if (bytes && format == CF_METAFILEPICT) {
        HGLOBAL picture = *(HGLOBAL far *)(bytes + 4);
        LPMETAFILEPICT p = picture ? (LPMETAFILEPICT)GlobalLock(picture) : NULL;

        if (p) {
            DeleteMetaFile(p->hMF);
            GlobalUnlock(picture);
            GlobalFree(picture);
        }
    }

    if (bytes) {
        GlobalUnlock(value);
    }

    GlobalFree(value);
}

LONG FAR PASCAL __export ConvProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    CONV *c = find(hwnd);
    char args[160];
    char result[200];
    LPSTR out;

    if (message == WM_DDE_ACK && initiating && initiating->mine == hwnd) {
        /* An answer to the initiate being sent: the first kept. */
        out = windowText(result, (HWND)wParam);
        *out++ = ' ';
        out = atomText(out, LOWORD(lParam));
        *out++ = ',';
        atomText(out, HIWORD(lParam));
        say("ack.initiate", initiating->topic, result);
        GlobalDeleteAtom(LOWORD(lParam));
        GlobalDeleteAtom(HIWORD(lParam));

        if (!initiating->server) {
            initiating->server = (HWND)wParam;
        } else {
            PostMessage((HWND)wParam, WM_DDE_TERMINATE, (WPARAM)hwnd, 0L);
        }

        return 0;
    }

    if (!c) {
        return DefWindowProc(hwnd, message, wParam, lParam);
    }

    switch (message) {
    case WM_DDE_ACK: {
        WORD status = LOWORD(lParam);
        WORD second = HIWORD(lParam);

        out = args + wsprintf(args, "%s,", (LPSTR)c->topic);

        if (c->last == WM_DDE_EXECUTE) {
            LPSTR text = (LPSTR)GlobalLock((HGLOBAL)second);

            wsprintf(out, "%s", (LPSTR)(text ? text : "(none)"));

            if (text) {
                GlobalUnlock((HGLOBAL)second);
            }

            GlobalFree((HGLOBAL)second);
        } else {
            atomText(out, (ATOM)second);

            if (second) {
                GlobalDeleteAtom((ATOM)second);
            }
        }

        out = result + wsprintf(result, "%04x ", status);
        windowText(out, (HWND)wParam);
        say("ack", args, result);
        c->waiting = 0;
        return 0;
    }

    case WM_DDE_DATA: {
        HGLOBAL value = (HGLOBAL)LOWORD(lParam);
        ATOM item = (ATOM)HIWORD(lParam);
        WORD flags = 0;
        UINT format = 0;
        LPBYTE bytes = value ? (LPBYTE)GlobalLock(value) : NULL;

        if (bytes) {
            flags = *(WORD far *)bytes;
            format = *(WORD far *)(bytes + 2);
            GlobalUnlock(value);
        }

        out = args + wsprintf(args, "%s,", (LPSTR)c->topic);
        out = atomText(out, item);
        *out++ = ',';
        formatText(out, format);

        out = windowText(result, (HWND)wParam);
        *out++ = ' ';

        if (value) {
            describe(out, format, value);
        } else {
            lstrcpy(out, "(no data)");
        }

        say("data", args, result);

        if (flags & 0x8000) {
            PostMessage(c->server, WM_DDE_ACK, (WPARAM)hwnd, MAKELONG(0x8000, item));
        } else if (item) {
            GlobalDeleteAtom(item);
        }

        if (value && (flags & 0x2000)) {
            freeData(format, value);
        }

        if (c->waiting == WM_DDE_REQUEST) {
            c->waiting = 0;
        }

        return 0;
    }

    case WM_DDE_TERMINATE:
        say("terminate", c->topic, c->ended ? "answer" : "server");

        if (!c->ended) {
            PostMessage((HWND)wParam, WM_DDE_TERMINATE, (WPARAM)hwnd, 0L);
        }

        c->waiting = 0;
        conversationGone(c);
        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

LONG FAR PASCAL __export Proc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_TIMER) {
        ticks++;
        return 0;
    }

    if (message == WM_USER + 100) {
        done[wParam & 63]++;
        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

/* Messages handled until `ready` or `limit` ticks of a half-second timer. */
static int pumpUntil(int (*ready)(int), int arg, int limit)
{
    MSG msg;

    ticks = 0;
    SetTimer(window, 1, 500, NULL);

    while (!ready(arg) && ticks < limit) {
        if (GetMessage(&msg, NULL, 0, 0)) {
            TranslateMessage(&msg);
            DispatchMessage(&msg);
        }
    }

    KillTimer(window, 1);

    return ready(arg);
}

static int answered(int i)
{
    return !convs[i].waiting;
}

static int finished(int n)
{
    return done[n] > 0;
}

static int never(int unused)
{
    (void)unused;
    return 0;
}

static int serverGone(int unused)
{
    (void)unused;
    return FindWindow("OleItmSrv", NULL) == NULL;
}

/* A conversation begun on an application and topic; its index, or -1. */
static int initiate(LPCSTR app, LPCSTR topic)
{
    int i;
    char args[160];
    CONV *c = NULL;
    ATOM a;
    ATOM t;

    for (i = 0; i < MAXCONV; i++) {
        if (!convs[i].used) {
            c = &convs[i];
            c->used = 1;
            break;
        }
    }

    wsprintf(args, "%s,%s", app, topic);
    say("initiate", args, "");

    if (!c) {
        return -1;
    }

    c->mine = CreateWindow("OleItmConv", "", WS_CHILD, 0, 0, 0, 0, window, NULL, self, NULL);
    c->server = 0;
    c->waiting = 0;
    c->ended = 0;
    lstrcpyn(c->topic, topic, sizeof c->topic);
    a = GlobalAddAtom(app);
    t = GlobalAddAtom(topic);
    initiating = c;
    SendMessage((HWND)-1, WM_DDE_INITIATE, (WPARAM)c->mine, MAKELONG(a, t));
    initiating = NULL;
    GlobalDeleteAtom(a);
    GlobalDeleteAtom(t);

    if (!c->server) {
        say("initiated", args, "none");
        conversationGone(c);
        return -1;
    }

    return i;
}

/* Waits for the answer to a message posted; writes when none came. */
static void await(int i, int limit)
{
    if (!pumpUntil(answered, i, limit)) {
        say("noanswer", convs[i].topic, "");
        convs[i].waiting = 0;
    }
}

static void execute(int i, LPCSTR command, int limit)
{
    CONV *c = &convs[i];
    HGLOBAL block;

    if (i < 0 || !c->mine) {
        return;
    }

    block = GlobalAlloc(GMEM_MOVEABLE | GMEM_DDESHARE, lstrlen(command) + 1);
    lstrcpy((LPSTR)GlobalLock(block), command);
    GlobalUnlock(block);
    say("execute", c->topic, command);
    c->waiting = WM_DDE_EXECUTE;
    c->last = WM_DDE_EXECUTE;

    if (!PostMessage(c->server, WM_DDE_EXECUTE, (WPARAM)c->mine, MAKELONG(0, block))) {
        say("posted", "", "no");
    }

    await(i, limit);
}

static void advise(int i, LPCSTR item, UINT format, WORD flags, int limit)
{
    CONV *c = &convs[i];
    HGLOBAL block;
    LPBYTE bytes;
    char args[120];
    LPSTR out;

    if (i < 0 || !c->mine) {
        return;
    }

    block = GlobalAlloc(GMEM_MOVEABLE | GMEM_DDESHARE, 4);
    bytes = (LPBYTE)GlobalLock(block);
    *(WORD far *)bytes = flags;
    *(WORD far *)(bytes + 2) = format;
    GlobalUnlock(block);
    out = args + wsprintf(args, "%s,%s,", (LPSTR)c->topic, item);
    out = formatText(out, format);
    wsprintf(out, ",%04x", flags);
    say("advise", args, "");
    c->waiting = WM_DDE_ADVISE;
    c->last = WM_DDE_ADVISE;
    PostMessage(c->server, WM_DDE_ADVISE, (WPARAM)c->mine, MAKELONG(block, GlobalAddAtom(item)));
    await(i, limit);
}

static void unadvise(int i, LPCSTR item, UINT format)
{
    CONV *c = &convs[i];
    char args[120];
    LPSTR out;

    if (i < 0 || !c->mine) {
        return;
    }

    out = args + wsprintf(args, "%s,%s,", (LPSTR)c->topic, item);
    formatText(out, format);
    say("unadvise", args, "");
    c->waiting = WM_DDE_UNADVISE;
    c->last = WM_DDE_UNADVISE;
    PostMessage(c->server, WM_DDE_UNADVISE, (WPARAM)c->mine, MAKELONG(format, GlobalAddAtom(item)));
    await(i, 30);
}

static void request(int i, LPCSTR item, UINT format)
{
    CONV *c = &convs[i];
    char args[120];
    LPSTR out;

    if (i < 0 || !c->mine) {
        return;
    }

    out = args + wsprintf(args, "%s,%s,", (LPSTR)c->topic, item);
    formatText(out, format);
    say("request", args, "");
    c->waiting = WM_DDE_REQUEST;
    c->last = WM_DDE_REQUEST;
    PostMessage(c->server, WM_DDE_REQUEST, (WPARAM)c->mine, MAKELONG(format, GlobalAddAtom(item)));
    await(i, 30);
}

static void poke(int i, LPCSTR item, UINT format, const BYTE far *value, unsigned count)
{
    CONV *c = &convs[i];
    HGLOBAL block;
    LPBYTE bytes;
    char args[120];
    LPSTR out;
    unsigned k;

    if (i < 0 || !c->mine) {
        return;
    }

    block = GlobalAlloc(GMEM_MOVEABLE | GMEM_DDESHARE, 4 + count);
    bytes = (LPBYTE)GlobalLock(block);
    *(WORD far *)bytes = 0x2000;
    *(WORD far *)(bytes + 2) = format;

    for (k = 0; k < count; k++) bytes[4 + k] = value[k];

    GlobalUnlock(block);
    out = args + wsprintf(args, "%s,%s,", (LPSTR)c->topic, item);
    formatText(out, format);
    say("poke", args, "");
    c->waiting = WM_DDE_POKE;
    c->last = WM_DDE_POKE;
    PostMessage(c->server, WM_DDE_POKE, (WPARAM)c->mine, MAKELONG(block, GlobalAddAtom(item)));
    await(i, 30);
}

static void terminate(int i)
{
    CONV *c = &convs[i];

    if (i < 0 || !c->mine) {
        return;
    }

    say("terminate", c->topic, "client");
    c->ended = 1;
    c->waiting = WM_DDE_TERMINATE;
    c->last = WM_DDE_TERMINATE;
    PostMessage(c->server, WM_DDE_TERMINATE, (WPARAM)c->mine, 0L);
    await(i, 30);
}

/* Asks the server to call one of OLESVR's functions; waits till it has, then a moment more. */
static void ask(LPCSTR what, UINT n, WPARAM w)
{
    HWND server = FindWindow("OleItmSrv", NULL);
    char args[60];

    wsprintf(args, "%s,%u", what, (unsigned)w);
    say("ask", args, server ? "" : "none");

    if (!server) {
        return;
    }

    done[n] = 0;
    PostMessage(server, WM_USER + n, w, 0L);
    say("asked", what, pumpUntil(finished, n, 30) ? "done" : "timeout");
    pumpUntil(never, 0, 2);
}

static void reg(LPCSTR key, LPCSTR value)
{
    char result[16];

    wsprintf(result, "%ld", RegSetValue(HKEY_CLASSES_ROOT, key, REG_SZ, value, lstrlen(value)));
    say("RegSetValue", key, result);
}

static void file(LPCSTR path)
{
    HFILE f = _lcreat(path, 0);

    _lwrite(f, "file", 4);
    _lclose(f);
}

typedef BOOL(FAR PASCAL *PROPPROC)(HWND, LPCSTR, HANDLE);
typedef BOOL(FAR PASCAL *CHILDPROC)(HWND, LPARAM);

static HWND serverWindow;
static char listing[1500];
static LPSTR listed;
static HWND found[16];
static int foundCount;

/* A window's handle as what it is: a conversation of the probe's, the server's, its frame's, nought, or another. */
static LPSTR whoText(LPSTR out, WORD value)
{
    int i;

    if (!value) {
        return out + wsprintf(out, "0");
    }

    for (i = 0; i < MAXCONV; i++) {
        if (convs[i].used && convs[i].mine && (WORD)convs[i].mine == value) {
            return out + wsprintf(out, "conv%d", i);
        }
    }

    if ((WORD)serverWindow == value) {
        return out + wsprintf(out, "server");
    }

    return out + wsprintf(out, "other");
}

/* Each property: its name -- `@` and a conversation's window as four hex digits named as `whoText` names it -- and its datum. */
BOOL CALLBACK __export EachProp(HWND hwnd, LPCSTR name, HANDLE data)
{
    (void)hwnd;

    if (listed != listing) {
        *listed++ = ' ';
    }

    if (!HIWORD((DWORD)name)) {
        listed += wsprintf(listed, "#%x", LOWORD((DWORD)name));
    } else if (name[0] == '@' && lstrlen(name) == 5) {
        WORD value = 0;
        int k;

        for (k = 1; k < 5; k++) {
            char c = name[k];

            value = (WORD)(value * 16 + (c >= 'A' ? c - 'A' + 10 : c - '0'));
        }

        *listed++ = '@';
        listed = whoText(listed, value);
    } else {
        listed += wsprintf(listed, "%s", name);
    }

    *listed++ = '=';

    if (data && (WORD)data == (WORD)GetProp(hwnd, name) && IsWindow((HWND)data)) {
        listed = whoText(listed, (WORD)data);
    } else {
        listed += wsprintf(listed, "%s", (LPSTR)(data ? "h" : "0"));
    }

    *listed = 0;
    return TRUE;
}

static void props(LPCSTR what, HWND hwnd)
{
    FARPROC proc = MakeProcInstance((FARPROC)EachProp, self);

    listed = listing;
    *listed = 0;
    EnumProps(hwnd, (PROPENUMPROC)proc);
    FreeProcInstance(proc);
    say("props", what, listing[0] ? listing : "(none)");
}

BOOL CALLBACK __export EachChild(HWND hwnd, LPARAM lParam)
{
    (void)lParam;

    if (foundCount < 16) {
        found[foundCount++] = hwnd;
    }

    return TRUE;
}

/* What an item window's window words point at: the server's `OLECLIENT` of which object, its size and flags, and its words named. */
static void clientText(LPSTR out, HWND item, HWND doc)
{
    DWORD client = GetWindowLong(item, 0);
    HWND frame = FindWindow("OleItmSrv", NULL);
    LRESULT n = frame ? SendMessage(frame, WM_USER + 60, 0, client) : 0;
    FARPROC callback = GetProcAddress(GetModuleHandle("OLESVR"), "ITEMCALLBACK");
    HGLOBAL handle;
    DWORD size;
    LPWORD words;
    int k;

    if (!client) {
        wsprintf(out, "long=0");
        return;
    }

    out += wsprintf(out, "long=%s", (LPSTR)(n ? "client" : "other"));

    if (n) {
        out += wsprintf(out, "%d", (int)n - 1);
    }

    handle = (HGLOBAL)LOWORD(GlobalHandle(HIWORD(client)));
    size = GlobalSize(handle);
    out += wsprintf(out, ",at=%x,size=%lx,flags=%x,words=", LOWORD(client), size,
                    GlobalFlags(handle));
    words = (LPWORD)client;

    for (k = 0; k < 8 && (DWORD)(LOWORD(client) + k * 2 + 1) < size; k++) {
        WORD w = words[k];

        if (k) {
            *out++ = ' ';
        }

        if (k == 0 && *(FARPROC FAR *)*(DWORD FAR *)words == callback) {
            out += wsprintf(out, "vtbl");
            k++;
        } else if (k == 2 && frame && SendMessage(frame, WM_USER + 61, 0, *(DWORD FAR *)&words[2])) {
            out += wsprintf(out, "object");
            k++;
        } else if ((HWND)w == item) {
            out += wsprintf(out, "item");
        } else if ((HWND)w == doc) {
            out += wsprintf(out, "doc");
        } else if (w == (WORD)handle) {
            out += wsprintf(out, "handle");
        } else if (w && w >= 0xc000) {
            char name[40];

            name[0] = 0;
            GlobalGetAtomName((ATOM)w, name, sizeof name);
            out += wsprintf(out, "atom:%s", (LPSTR)name);
        } else {
            out += wsprintf(out, "%x", w);
        }
    }

    *out = 0;
}

/* The server's windows beneath its own: each one's class, its parent's, its text, style, words, and properties. */
static void tree(LPCSTR what)
{
    FARPROC proc = MakeProcInstance((FARPROC)EachChild, self);
    char args[80];
    char result[400];
    char name[40];
    int i;

    foundCount = 0;

    if (serverWindow && IsWindow(serverWindow)) {
        EnumChildWindows(serverWindow, (WNDENUMPROC)proc, 0L);
    }

    FreeProcInstance(proc);
    say("tree", what, "");

    for (i = 0; i < foundCount; i++) {
        HWND w = found[i];
        LPSTR out;

        out = windowText(result, w);
        name[0] = 0;
        GetWindowText(w, name, sizeof name);
        out += wsprintf(out, " text=\"%s\" style=%lx id=%x visible=%d ", (LPSTR)name,
                        GetWindowLong(w, GWL_STYLE), GetWindowWord(w, GWW_ID), IsWindowVisible(w));
        GetClassName(w, name, sizeof name);

        if (!lstrcmp(name, "ItemWndClass")) {
            clientText(out, w, GetParent(w));
        } else {
            wsprintf(out, "long=%s", (LPSTR)(GetWindowLong(w, 0) ? "nonzero" : "0"));
        }

        wsprintf(args, "%s,%d", what, i);
        say("window", args, result);
        props(args, w);
    }
}

/* The item window of an item, found by the object its window words' client was given for. */
static HWND itemWindow(HWND doc, LPCSTR item)
{
    FARPROC proc = MakeProcInstance((FARPROC)EachChild, self);
    HWND frame = FindWindow("OleItmSrv", NULL);
    ATOM atom = GlobalFindAtom(item);
    int i;
    HWND answer = 0;

    foundCount = 0;
    EnumChildWindows(doc, (WNDENUMPROC)proc, 0L);
    FreeProcInstance(proc);

    for (i = 0; i < foundCount && frame; i++) {
        DWORD client = GetWindowLong(found[i], 0);

        if (client && SendMessage(frame, WM_USER + 60, 0, client) &&
            ((LPWORD)client)[5] == (WORD)(*item ? atom : 0)) {
            answer = found[i];
        }
    }

    return answer;
}

static FARPROC exported(LPCSTR name)
{
    return GetProcAddress(GetModuleHandle("OLESVR"), name);
}

/* One of OLESVR's procedures for `EnumProps`, called as `EnumProps` would call it. */
static void callProp(LPCSTR name, LPCSTR args, HWND hwnd, LPCSTR prop, HANDLE data)
{
    PROPPROC proc = (PROPPROC)exported(name);
    char result[20];

    if (!proc) {
        say(name, args, "none");
        return;
    }

    wsprintf(result, "%d", (int)proc(hwnd, prop, data));
    say(name, args, result);
}

static void callChild(LPCSTR args, HWND hwnd, LPARAM lParam)
{
    CHILDPROC proc = (CHILDPROC)exported("FINDITEMWND");
    char result[20];

    if (!proc) {
        say("FINDITEMWND", args, "none");
        return;
    }

    wsprintf(result, "%d", (int)proc(hwnd, lParam));
    say("FINDITEMWND", args, result);
}

/* A conversation's property name on an OLESVR window: `@` and its window in four hex digits. */
static LPSTR propName(LPSTR out, int i)
{
    wsprintf(out, "@%04X", (WORD)convs[i].mine);
    return out;
}

static void run(void)
{
    int s;
    int d;
    int d2;
    HWND doc;
    HWND item1;
    HWND item3;
    char name[8];
    char args[60];
    HANDLE before;
    HANDLE after;

    note("start");
    reg(CLASS, "OLE Item Probe");
    reg(CLASS "\\protocol\\StdFileEditing\\server", SERVER);
    reg(CLASS "\\protocol\\StdFileEditing\\verb\\0", "Edit");
    done[0] = 0;
    say("WinExec", SERVER, WinExec(SERVER " -Embedding", SW_SHOWNORMAL) > 32 ? "ok" : "failed");
    say("ready", "", pumpUntil(finished, 0, 30) ? "yes" : "timeout");

    note("system");
    s = initiate(CLASS, "OLEsystem");

    if (s < 0) {
        return;
    }

    serverWindow = convs[s].server;
    initiate(CLASS, "OLEsystem");
    say("long", "server", GetWindowLong(serverWindow, 0) ? "nonzero" : "0");
    props("server", serverWindow);

    note("doc");
    execute(s, "[StdNewDocument(\"" CLASS "\",\"Doc1\")]", 30);
    d = initiate(CLASS, "Doc1");
    d2 = initiate(CLASS, "Doc1");

    if (d < 0 || d2 < 0) {
        return;
    }

    doc = convs[d].server;
    tree("doc");

    note("advise");
    advise(d, "Item1", CF_METAFILEPICT, 0x8000, 30);
    tree("item1");
    advise(d, "Item1", cfNative, 0x8000, 30);
    advise(d, "Item1/Save", cfNative, 0x8000, 30);
    advise(d2, "Item1", cfNative, 0x8000, 30);
    advise(d2, "Item1", CF_METAFILEPICT, 0x8000, 30);
    advise(d2, "Item1", cfObjectLink, 0x8000, 30);
    request(d, "Item2", cfNative);
    advise(d2, "Item3", cfNative, 0x4000, 30);
    advise(d, "", cfNative, 0x8000, 30);
    tree("advised");

    item1 = itemWindow(doc, "Item1");
    item3 = itemWindow(doc, "Item3");
    say("item", "Item1", item1 ? "found" : "none");
    say("item", "Item3", item3 ? "found" : "none");

    note("change");
    ask("change", 1, 0);
    ask("change", 1, 2);
    ask("saved", 3, 0);
    ask("OleSavedServerDoc", 2, 0);

    note("unadvise");
    unadvise(d2, "Item1", cfObjectLink);
    props("Item1", item1);
    ask("change", 1, 0);
    unadvise(d2, "Item1", 0);
    props("Item1", item1);
    ask("change", 1, 0);

    note("direct");
    wsprintf(args, "Item1,atom Item1,1");
    callChild(args, item1, MAKELONG(GlobalFindAtom("Item1"), 1));
    callChild("Item1,atom Item3,1", item1, MAKELONG(GlobalFindAtom("Item3"), 1));
    callChild("window,0,9", window, MAKELONG(0, 9));
    SetProp(window, "ProbeProp", (HANDLE)5);
    callProp("DELETECLIENTINFO", "window,ProbeProp,0", window, "ProbeProp", 0);
    say("GetProp", "window,ProbeProp", GetProp(window, "ProbeProp") ? "there" : "gone");
    callProp("TERMINATECLIENTS", "server,0,0", serverWindow, NULL, 0);
    callProp("TERMINATEDOCCLIENTS", "doc,0,0", doc, NULL, 0);
    callProp("ENUMFORTERMINATE", "doc,0,0", doc, NULL, 0);
    callProp("SENDRENAMEMSG", "Item1,0,0", item1, NULL, 0);
    callProp("SENDDATAMSG", "Item1,0,0", item1, NULL, 0);
    callChild("Item1,conv d,2", item1, MAKELONG((WORD)convs[d].mine, 2));
    props("Item1", item1);
    ask("change", 1, 0);
    callChild("Item1,0,4", item1, MAKELONG(0, 4));
    pumpUntil(never, 0, 2);
    propName(name, d2);
    before = GetProp(item3, name);
    callProp("DELETECLIENTINFO", "Item3,conv d2,data", item3, name, before);
    after = GetProp(item3, name);
    say("GetProp", "Item3,conv d2", (LPSTR)(!after ? "0" : after == before ? "same" : "other"));
    props("Item3", item3);
    pumpUntil(never, 0, 2);
    callProp("TERMINATEDOCCLIENTS", "doc,0,conv d2", doc, NULL, (HANDLE)convs[d2].mine);
    pumpUntil(never, 0, 4);
    tree("terminated");

    note("close");
    ask("OleRevokeObject", 4, 2);
    pumpUntil(never, 0, 2);
    tree("revoked");
    execute(d, "[StdCloseDocument]", 30);
    pumpUntil(never, 0, 4);
    if (convs[d].mine) {
        terminate(d);
    }
    tree("closed");
    callProp("TERMINATECLIENTS", "server,0,conv s", serverWindow, NULL, (HANDLE)convs[s].mine);
    pumpUntil(never, 0, 4);
    props("server", serverWindow);
    ask("OleRevokeServer", 6, 0);
    say("server", "", pumpUntil(serverGone, 0, 30) ? "gone" : "timeout");
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kindOf;
    HFILE f;

    (void)previous;
    (void)command;
    (void)show;

    self = instance;
    f = _lcreat(OUTPUT, 0);
    _lclose(f);

    kindOf.style = 0;
    kindOf.lpfnWndProc = Proc;
    kindOf.cbClsExtra = 0;
    kindOf.cbWndExtra = 0;
    kindOf.hInstance = instance;
    kindOf.hIcon = NULL;
    kindOf.hCursor = LoadCursor(NULL, IDC_ARROW);
    kindOf.hbrBackground = GetStockObject(WHITE_BRUSH);
    kindOf.lpszMenuName = NULL;
    kindOf.lpszClassName = "OleItmCli";
    RegisterClass(&kindOf);
    kindOf.lpfnWndProc = ConvProc;
    kindOf.lpszClassName = "OleItmConv";
    RegisterClass(&kindOf);
    window = CreateWindow("OleItmCli", "OleItm", WS_OVERLAPPEDWINDOW, 0, 0, 200, 100, NULL, NULL,
                          instance, NULL);
    ShowWindow(window, SW_SHOWNORMAL);

    cfNative = RegisterClipboardFormat("Native");
    cfOwnerLink = RegisterClipboardFormat("OwnerLink");
    cfObjectLink = RegisterClipboardFormat("ObjectLink");
    cfBinary = RegisterClipboardFormat("Binary");

    run();

    note("end");
    DestroyWindow(window);
    probeFinish();

    return 0;
}
