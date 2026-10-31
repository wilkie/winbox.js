/*
 * OLESVR, the server side of OLE 1.0: what it does with the DDE messages a
 * client sends and with what its server calls. The probe registers its
 * second program, `OLESRVC.EXE`, as the server of the class `OleSvrProbe`;
 * that program registers itself with OLESVR and writes into this probe's
 * file every method of its `OLESERVER`, `OLESERVERDOC` and `OLEOBJECT`
 * tables OLESVR calls, with its arguments and answer (`srv.`, `doc.`,
 * `obj.` records), and each of OLESVR's functions it is asked to call. This
 * probe is the client, speaking OLE 1.0's DDE protocol by hand: it writes
 * each message it sends and each it is sent -- the window that answered,
 * the item, format, flags, status and data -- so the file holds both
 * sides of the wire and the server's calls in the order they happened.
 *
 * * `register`: the server's start, its refusals, OleRegisterServer.
 * * `system`: the `System` topic's executes, good and bad, and requests.
 * * `doc`: a made document's conversation -- advises, pokes, requests,
 *   executes.
 * * `notify`: the server's object tells its client a change and a save;
 *   OleSavedServerDoc, OleRenameServerDoc, OleRevertServerDoc,
 *   OleRevokeObject.
 * * `block`: OleBlockServer, a message while blocked, OleUnblockServer.
 * * `link`: a document the server opened, by its file's name.
 * * `close`: StdCloseDocument, a client's terminate, StdExit,
 *   OleRevokeServerDoc and OleRevokeServer.
 *
 * Named `olesrv`, not `olesvr`: a program whose module is named `OLESVR`
 * is the module its server's imports of `OLESVR` are found in, and every
 * call the server makes to OLESVR is a call to an undefined dynalink.
 */

#include "probe.h"
#include <dde.h>
#include <shellapi.h>

#pragma library("shell")

#define OUTPUT "C:\\ORACLE\\OLESRV.OUT"
#define CLASS "OleSvrProbe"
#define SERVER "OLESRVC.EXE"

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

        wsprintf(result, "%04x", status);
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

        if (value) {
            describe(result, format, value);
        } else {
            lstrcpy(result, "(no data)");
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
    return FindWindow("OleSvrSrv", NULL) == NULL;
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

    c->mine = CreateWindow("OleSvrConv", "", WS_CHILD, 0, 0, 0, 0, window, NULL, self, NULL);
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
    HWND server = FindWindow("OleSvrSrv", NULL);
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

static void run(void)
{
    static BYTE hostNames[40];
    static BYTE dimensions[8] = {0xdc, 0x05, 0xee, 0x02, 0xdc, 0x05, 0xee, 0x02};
    /* 1500, 750, 1000, 500: which words the server is given. */
    static BYTE otherDimensions[8] = {0xdc, 0x05, 0xee, 0x02, 0xe8, 0x03, 0xf4, 0x01};
    static BYTE scheme[4 + 16];
    static BYTE device[64];
    static BYTE native[16];
    int s;
    int d;
    int l;
    int s2;
    int t;
    int k;
    UINT started;

    note("register");
    reg(CLASS, "OLE Server Probe");
    reg(CLASS "\\protocol\\StdFileEditing\\server", SERVER);
    reg(CLASS "\\protocol\\StdFileEditing\\verb\\0", "Edit");
    reg(CLASS "\\protocol\\StdExecute\\server", SERVER);
    reg(CLASS "2", "OLE Server Probe 2");
    reg(CLASS "2\\protocol\\StdFileEditing\\server", SERVER);
    file("C:\\ORACLE\\OLESVR.FIL");
    file("C:\\ORACLE\\OLESVR.TPL");

    done[0] = 0;
    started = WinExec(SERVER " -Embedding", SW_SHOWNORMAL);
    say("WinExec", SERVER, started > 32 ? "ok" : "failed");
    say("ready", "", pumpUntil(finished, 0, 30) ? "yes" : "timeout");

    note("system");
    s = initiate(CLASS, "OLEsystem");
    initiate(CLASS, "System");
    initiate("Other", "System");
    initiate(CLASS, "NoSuchDoc");

    if (s < 0) {
        return;
    }

    request(s, "Topics", CF_TEXT);
    request(s, "Formats", CF_TEXT);
    request(s, "SysItems", CF_TEXT);
    request(s, "Status", CF_TEXT);
    execute(s, "[StdNewDocument(\"" CLASS "\",\"Doc1\")]", 30);
    execute(s, "[StdEditDocument(\"Doc6\")]", 30);
    d = initiate(CLASS, "Doc1");
    s2 = initiate(CLASS, "OLEsystem");
    execute(s2, "[StdEditDocument(\"Doc2\")]", 30);
    terminate(s2);
    execute(s, "[StdEditDocument(\"Doc2\")]", 30);
    initiate(CLASS, "Doc2");
    execute(s, "[StdOpenDocument(\"C:\\ORACLE\\OLESVR.FIL\")]", 30);
    initiate(CLASS, "C:\\ORACLE\\OLESVR.FIL");
    execute(s, "[StdNewFromTemplate(\"" CLASS "\",\"Doc4\",\"C:\\ORACLE\\OLESVR.TPL\")]", 30);
    t = initiate(CLASS, "Doc4");

    /* The second server, single: one instance for every document. */
    s2 = initiate(CLASS "2", "OLEsystem");
    execute(s2, "[StdNewDocument(\"" CLASS "2\",\"DocA\")]", 30);
    execute(s2, "[StdEditDocument(\"DocB\")]", 30);
    execute(s2, "[StdOpenDocument(\"C:\\ORACLE\\OLESVR.FIL\")]", 30);
    execute(s2, "[StdNewFromTemplate(\"" CLASS "2\",\"DocC\",\"C:\\ORACLE\\OLESVR.TPL\")]", 30);
    t = initiate(CLASS "2", "DocA");
    initiate(CLASS "2", "OLEsystem");
    request(s2, "Topics", CF_TEXT);
    terminate(t);
    terminate(s2);
    request(s, "Topics", CF_TEXT);
    execute(s, "[ProbeCommand(1)]", 30);
    execute(s, "[ProbeFail(1)]", 30);
    execute(s, "[ProbeCommand(1)][ProbeCommand(2)]", 30);
    execute(s, "[StdNewDocument(\"Doc5\")]", 30);
    execute(s, "[StdNewDocument(\"" CLASS "\",\"Doc1\")]", 30);
    execute(s, "[StdShowItem(\"x\")]", 30);
    execute(s, "garbage", 30);

    note("doc");
    advise(d, "/Save", cfNative, 0x8000, 30);
    advise(d, "/Save", CF_METAFILEPICT, 0x8000, 30);
    advise(d, "/Close", cfNative, 0x8000, 30);
    advise(d, "/Close", CF_METAFILEPICT, 0x8000, 30);
    execute(d, "[StdShowItem(\"\")]", 30);
    execute(d, "[StdShowItem(\"\",FALSE)]", 30);
    execute(d, "[StdShowItem(\"\",TRUE)]", 30);

    *(WORD *)hostNames = 0;
    *(WORD *)(hostNames + 2) = 13;
    lstrcpy((LPSTR)hostNames + 4, "Probe Client");
    lstrcpy((LPSTR)hostNames + 4 + 13, "Probe Object");
    poke(d, "StdHostNames", cfBinary, hostNames, 4 + 13 + 13);
    poke(d, "StdDocDimensions", cfBinary, dimensions, 8);
    poke(d, "StdDocDimensions", cfBinary, otherDimensions, 8);
    *(WORD *)scheme = 0x300;
    *(WORD *)(scheme + 2) = 4;

    for (k = 0; k < 4; k++) {
        scheme[4 + k * 4] = (BYTE)(k * 0x40);
        scheme[5 + k * 4] = (BYTE)(0x10 + k);
        scheme[6 + k * 4] = (BYTE)(0xff - k);
        scheme[7 + k * 4] = 0;
    }

    poke(d, "StdColorScheme", cfBinary, scheme, sizeof scheme);
    ((WORD *)device)[0] = 0;
    ((WORD *)device)[1] = 14;
    ((WORD *)device)[2] = 22;
    ((WORD *)device)[3] = 28;
    ((WORD *)device)[4] = 0;
    ((WORD *)device)[5] = 28;
    ((WORD *)device)[6] = 0;
    lstrcpy((LPSTR)device + 14, "Probe Printer");
    lstrcpy((LPSTR)device + 14 + 14, "PSCRIPT");
    lstrcpy((LPSTR)device + 14 + 22, "LPT1:");
    poke(d, "StdTargetDevice", cfBinary, device, 14 + 28);

    for (k = 0; k < 16; k++) native[k] = (BYTE)(0x70 + k);

    poke(d, "", cfNative, native, 16);
    poke(d, "", CF_TEXT, (const BYTE far *)"text", 5);
    request(d, "", cfNative);
    request(d, "", CF_METAFILEPICT);
    request(d, "", CF_TEXT);
    request(d, "", cfObjectLink);
    request(d, "", cfOwnerLink);
    request(d, "Missing", cfNative);
    advise(d, "Item1", cfNative, 0x8000, 30);
    advise(d, "Item1", CF_METAFILEPICT, 0x4000, 4);
    advise(d, "Item1/Save", cfNative, 0, 4);
    advise(d, "Missing", cfNative, 0, 4);
    execute(d, "[StdDoVerbItem(\"\",1,TRUE,FALSE)]", 30);
    execute(d, "[StdDoVerbItem(\"Item1\",0,FALSE,TRUE)]", 30);
    execute(d, "[StdDoVerbItem(\"\",0,TRUE,TRUE)]", 30);
    execute(d, "[StdDoVerbItem(\"\",0,FALSE,FALSE)]", 30);
    execute(d, "[DocCommand(2)]", 30);
    execute(d, "[StdNewDocument(\"" CLASS "\",\"DocX\")]", 30);

    note("notify");
    ask("change", 1, 0);
    ask("change", 1, 1);
    ask("saved", 8, 0);
    ask("saved", 8, 1);
    ask("OleSavedServerDoc", 2, 0);
    ask("OleRevertServerDoc", 7, 0);
    unadvise(d, "Item1", cfNative);
    unadvise(d, "Item1", 0);
    ask("change", 1, 1);
    ask("OleRevokeObject", 4, 1);
    ask("change", 1, 1);

    note("block");
    ask("OleBlockServer", 5, 0);
    execute(s, "[ProbeCommand(3)]", 4);
    request(d, "", cfNative);
    ask("OleUnblockServer", 6, 0);
    pumpUntil(never, 0, 4);

    note("link");
    ask("OleRegisterServerDoc", 12, 0);
    l = initiate(CLASS, "C:\\ORACLE\\OLESVR3.FIL");
    request(l, "", cfNative);
    advise(l, "Item2", cfNative, 0x8000, 30);
    advise(l, "StdDocumentName", cfNative, 0x8000, 30);
    request(l, "Item2", cfObjectLink);
    ask("OleRenameServerDoc", 3, 0);
    ask("closed", 9, 1);
    ask("renamed", 13, 1);
    pumpUntil(never, 0, 4);

    note("close");
    /* Doc1's conversation was ended by OleRevokeObject; the server's own document is closed. */
    execute(d, "[StdCloseDocument]", 30);
    execute(l, "[StdCloseDocument]", 30);
    pumpUntil(never, 0, 4);
    terminate(l);
    request(s, "Topics", CF_TEXT);
    execute(s, "[StdExit]", 30);
    ask("OleRevokeServerDoc", 10, 1);
    ask("OleRevokeServer", 14, 0);
    ask("OleRevokeServer", 11, 0);
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
    kindOf.lpszClassName = "OleSvrCli";
    RegisterClass(&kindOf);
    kindOf.lpfnWndProc = ConvProc;
    kindOf.lpszClassName = "OleSvrConv";
    RegisterClass(&kindOf);
    window = CreateWindow("OleSvrCli", "OleSvr", WS_OVERLAPPEDWINDOW, 0, 0, 200, 100, NULL, NULL,
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
