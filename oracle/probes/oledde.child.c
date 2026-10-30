/*
 * The server `oledde.c` registers as the class `OleDdeProbe`: a program
 * that speaks OLE 1.0's DDE protocol by hand, with no OLESVR, and writes
 * down every message a client's OLECLI sends it -- its conversation, item,
 * format and data, in the order they come -- into the probe's own file,
 * each record appended with the file opened and closed around it.
 *
 * It answers as the OLE 1.0 protocol has a server answer: `WM_DDE_INITIATE`
 * on its class and `System`, or a document it has; every `Std` execute,
 * poke and advise acknowledged; `Native`, `METAFILEPICT`, `OwnerLink` and
 * `ObjectLink` given when requested, anything else refused. The probe asks
 * it, by messages to its frame window, to tell its clients a change
 * (`WM_USER + 1`), a save (`WM_USER + 2`) or that it closes the document
 * (`WM_USER + 3`); it exits once no conversation is left.
 */

#include "probe.h"
#include <dde.h>

/* `olepbd` builds this program as the class `PBrush`, its `Native` a bitmap file. */
#ifndef OUTPUT
#define OUTPUT "C:\\ORACLE\\OLEDDE.OUT"
#define CLASS "OleDdeProbe"
#endif

#ifdef NATIVE_BMP
#include "olebmp.h"
#endif

#define MAXCONV 8
#define MAXADVISE 16

typedef struct {
    HWND mine;
    HWND client;
    char topic[80];
    int count;
    char items[MAXADVISE][40];
    UINT formats[MAXADVISE];
    WORD flags[MAXADVISE];
    int closing;
} CONV;

static CONV convs[MAXCONV];
static HINSTANCE self;
static HWND frame;
static char documents[4][80];
static int generation;
static UINT cfNative;
static UINT cfOwnerLink;
static UINT cfObjectLink;

/* One record, appended: the client's records go into the same file. */
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

static int live(void)
{
    int i;
    int n = 0;

    for (i = 0; i < MAXCONV; i++) {
        if (convs[i].mine) {
            n++;
        }
    }

    return n;
}

static int known(LPCSTR topic)
{
    int i;

    for (i = 0; i < 4; i++) {
        if (documents[i][0] && !lstrcmpi(documents[i], topic)) {
            return 1;
        }
    }

    return 0;
}

static void remember(LPCSTR topic)
{
    int i;

    if (known(topic)) {
        return;
    }

    for (i = 0; i < 4; i++) {
        if (!documents[i][0]) {
            lstrcpy(documents[i], topic);
            return;
        }
    }
}

static void forget(LPCSTR topic)
{
    int i;

    for (i = 0; i < 4; i++) {
        if (!lstrcmpi(documents[i], topic)) {
            documents[i][0] = 0;
        }
    }
}

/* Up to `limit` bytes as hex. */
static LPSTR hex(LPSTR out, const BYTE far *bytes, unsigned count, unsigned limit)
{
    unsigned i;

    for (i = 0; i < count && i < limit; i++) {
        out += wsprintf(out, "%02x", bytes[i]);
    }

    return out;
}

/* A poked item's data, as each item of the protocol lays it out. */
static void describe(LPSTR out, LPCSTR item, UINT format, const BYTE far *value)
{
    const WORD far *w = (const WORD far *)value;

    if (!lstrcmpi(item, "StdHostNames")) {
        /* Two offsets into the names that follow them. */
        wsprintf(out, "%u,%u %s|%s", w[0], w[1], (LPCSTR)(value + 4 + w[0]),
                 (LPCSTR)(value + 4 + w[1]));
    } else if (!lstrcmpi(item, "StdDocDimensions")) {
        hex(out, value, 8, 8);
    } else if (!lstrcmpi(item, "StdTargetDevice")) {
        out += wsprintf(out, "%u,%u,%u,%u,%u,%u,%u ", w[0], w[1], w[2], w[3], w[4], w[5], w[6]);
        wsprintf(out, "%s|%s|%s", (LPCSTR)(value + 14 + w[0]), (LPCSTR)(value + 14 + w[1]),
                 (LPCSTR)(value + 14 + w[2]));
    } else if (!lstrcmpi(item, "StdColorScheme")) {
        out += wsprintf(out, "%x %u ", w[0], w[1]);
        hex(out, value + 4, w[1] * 4, 64);
    } else if (format == cfNative) {
        hex(out, value, 16, 16);
    } else {
        hex(out, value, 8, 8);
    }
}

/* The data of an item in a format, as a DDEDATA block; 0 if not had. */
static HGLOBAL dataFor(LPCSTR topic, LPCSTR item, UINT format, WORD flags)
{
    HGLOBAL block;
    LPBYTE bytes;
    int i;

    if (format == cfNative) {
#ifdef NATIVE_BMP
        block = GlobalAlloc(GMEM_MOVEABLE | GMEM_DDESHARE, 4 + OLEBMP_SIZE);
        bytes = (LPBYTE)GlobalLock(block);
        *(WORD far *)bytes = flags;
        *(WORD far *)(bytes + 2) = format;
        oleBmp(bytes + 4, generation);
        (void)i;
#else
        block = GlobalAlloc(GMEM_MOVEABLE | GMEM_DDESHARE, 4 + 16);
        bytes = (LPBYTE)GlobalLock(block);
        *(WORD far *)bytes = flags;
        *(WORD far *)(bytes + 2) = format;

        for (i = 0; i < 16; i++) {
            bytes[4 + i] = (BYTE)(0x50 + i);
        }

        bytes[4] = (BYTE)generation;
#endif
        GlobalUnlock(block);
        return block;
    }

    if (format == cfOwnerLink || format == cfObjectLink) {
        char text[200];
        LPSTR at = text;
        unsigned n;

        at += wsprintf(at, "%s", (LPSTR)CLASS) + 1;
        at += wsprintf(at, "%s", topic) + 1;
        at += wsprintf(at, "%s", item) + 1;
        *at++ = 0;
        n = (unsigned)(at - text);
        block = GlobalAlloc(GMEM_MOVEABLE | GMEM_DDESHARE, 4 + n);
        bytes = (LPBYTE)GlobalLock(block);
        *(WORD far *)bytes = flags;
        *(WORD far *)(bytes + 2) = format;

        for (i = 0; i < (int)n; i++) {
            bytes[4 + i] = text[i];
        }

        GlobalUnlock(block);
        return block;
    }

    if (format == CF_METAFILEPICT) {
        HDC meta = CreateMetaFile(NULL);
        HGLOBAL picture;
        LPMETAFILEPICT p;

        SetWindowOrg(meta, 0, 0);
        SetWindowExt(meta, 100, 50);
        Rectangle(meta, 0, 0, 100, 50);
        Ellipse(meta, 10 + generation, 10, 60, 40);
        picture = GlobalAlloc(GMEM_MOVEABLE | GMEM_DDESHARE, sizeof(METAFILEPICT));
        p = (LPMETAFILEPICT)GlobalLock(picture);
        p->mm = MM_ANISOTROPIC;
        p->xExt = 2000;
        p->yExt = 1000;
        p->hMF = CloseMetaFile(meta);
        GlobalUnlock(picture);
        block = GlobalAlloc(GMEM_MOVEABLE | GMEM_DDESHARE, 4 + 2);
        bytes = (LPBYTE)GlobalLock(block);
        *(WORD far *)bytes = flags;
        *(WORD far *)(bytes + 2) = format;
        *(WORD far *)(bytes + 4) = (WORD)picture;
        GlobalUnlock(block);
        return block;
    }

    return 0;
}

/* The item of an advise without its `/Change`, `/Save` or `/Close`. */
static LPCSTR when(LPCSTR item)
{
    LPCSTR at = item;

    while (*at && *at != '/') {
        at++;
    }

    return *at ? at + 1 : "";
}

/* Tells each client what is advised for `what`: Change, Save or Close. */
static void tell(LPCSTR what)
{
    int i;
    int j;

    for (i = 0; i < MAXCONV; i++) {
        CONV *c = &convs[i];

        if (!c->mine || !lstrcmpi(c->topic, "System")) {
            continue;
        }

        for (j = 0; j < c->count; j++) {
            LPCSTR on = when(c->items[j]);
            WORD flags;
            HGLOBAL block = 0;
            char args[120];
            LPSTR out;

            if (lstrcmpi(on, what) && !(on[0] == 0 && !lstrcmpi(what, "Change"))) {
                continue;
            }

            /* fRelease, fAckReq as the advise asked; no data where it deferred. */
            flags = 0x2000 | ((c->flags[j] & 0x8000) ? 0x8000 : 0);

            if (!(c->flags[j] & 0x4000)) {
                block = dataFor(c->topic, c->items[j], c->formats[j], flags);
            }

            out = args + wsprintf(args, "%s,%s,", (LPSTR)c->topic, (LPSTR)c->items[j]);
            out = formatText(out, c->formats[j]);
            wsprintf(out, ",%x,%s", flags, block ? "data" : "none");
            say("srv.send DATA", args, "");
            PostMessage(c->client, WM_DDE_DATA, (WPARAM)c->mine,
                        MAKELONG(block, GlobalAddAtom(c->items[j])));
        }
    }
}

/* Ends every conversation on a document: the server closing it. */
static void closeAll(void)
{
    int i;

    for (i = 0; i < MAXCONV; i++) {
        CONV *c = &convs[i];

        if (c->mine && lstrcmpi(c->topic, "System")) {
            say("srv.send TERMINATE", c->topic, "");
            c->closing = 1;
            PostMessage(c->client, WM_DDE_TERMINATE, (WPARAM)c->mine, 0L);
        }
    }
}

/* What an execute string asks, by its command's name. */
static void execute(CONV *c, LPCSTR command)
{
    char name[40];
    char first[80];
    LPCSTR at = command;
    int i = 0;

    while (*at == '[') {
        at++;
    }

    while (*at && *at != '(' && *at != ']' && i < 39) {
        name[i++] = *at++;
    }

    name[i] = 0;
    first[0] = 0;

    if (*at == '(') {
        at++;

        while (*at == ' ') at++;

        if (*at == '"') {
            at++;
        }

        i = 0;

        while (*at && *at != '"' && *at != ',' && *at != ')' && i < 79) {
            first[i++] = *at++;
        }

        first[i] = 0;
    }

    if (!lstrcmpi(name, "StdNewDocument") || !lstrcmpi(name, "StdEditDocument")) {
        /* `("class","document")` and `("document")`: the document is the last. */
        LPCSTR last = first;
        char second[80];

        if (*at == '"') at++;
        while (*at == ',' || *at == ' ') at++;

        if (*at == '"') {
            at++;
            i = 0;

            while (*at && *at != '"' && i < 79) {
                second[i++] = *at++;
            }

            second[i] = 0;
            last = second;
        }

        remember(last);
    } else if (!lstrcmpi(name, "StdOpenDocument")) {
        remember(first);
    } else if (!lstrcmpi(name, "StdCloseDocument")) {
        forget(c->topic);
    } else if (!lstrcmpi(name, "StdShowItem") || !lstrcmpi(name, "StdDoVerbItem")) {
        ShowWindow(frame, SW_SHOWNOACTIVATE);
    }
}

LRESULT CALLBACK __export ConvProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    CONV *c = find(window);
    char args[300];
    char result[400];
    LPSTR out;

    if (!c || message < WM_DDE_FIRST || message > WM_DDE_LAST) {
        return DefWindowProc(window, message, wParam, lParam);
    }

    args[0] = 0;
    result[0] = 0;

    switch (message) {
    case WM_DDE_EXECUTE: {
        HGLOBAL commands = (HGLOBAL)HIWORD(lParam);
        LPSTR text = (LPSTR)GlobalLock(commands);
        char copy[200];

        lstrcpyn(copy, text ? text : "", sizeof copy);
        GlobalUnlock(commands);
        wsprintf(args, "%s,%s", (LPSTR)c->topic, (LPSTR)copy);
        say("srv.EXECUTE", args, "ack");
        execute(c, copy);
        PostMessage(c->client, WM_DDE_ACK, (WPARAM)window, MAKELONG(0x8000, commands));
        return 0;
    }

    case WM_DDE_POKE: {
        HGLOBAL data = (HGLOBAL)LOWORD(lParam);
        ATOM item = HIWORD(lParam);
        char name[80];
        LPBYTE bytes = (LPBYTE)GlobalLock(data);
        WORD flags = bytes ? *(WORD far *)bytes : 0;
        UINT format = bytes ? *(WORD far *)(bytes + 2) : 0;

        name[0] = 0;
        GlobalGetAtomName(item, name, sizeof name);
        out = args + wsprintf(args, "%s,%s,", (LPSTR)c->topic, (LPSTR)name);
        out = formatText(out, format);
        wsprintf(out, ",%x", flags);

        if (bytes) {
            describe(result, name, format, bytes + 4);
        }

        say("srv.POKE", args, result);
        GlobalUnlock(data);

        if (flags & 0x2000) {
            GlobalFree(data);
        }

        PostMessage(c->client, WM_DDE_ACK, (WPARAM)window, MAKELONG(0x8000, item));
        return 0;
    }

    case WM_DDE_ADVISE: {
        HGLOBAL options = (HGLOBAL)LOWORD(lParam);
        ATOM item = HIWORD(lParam);
        LPBYTE bytes = (LPBYTE)GlobalLock(options);
        WORD flags = *(WORD far *)bytes;
        UINT format = *(WORD far *)(bytes + 2);

        GlobalUnlock(options);
        out = args + wsprintf(args, "%s,", (LPSTR)c->topic);
        out = atomText(out, item);
        *out++ = ',';
        out = formatText(out, format);
        wsprintf(out, ",%x", flags);
        say("srv.ADVISE", args, "ack");

        if (c->count < MAXADVISE) {
            GlobalGetAtomName(item, c->items[c->count], 40);
            c->formats[c->count] = format;
            c->flags[c->count] = flags;
            c->count++;
        }

        GlobalFree(options);
        PostMessage(c->client, WM_DDE_ACK, (WPARAM)window, MAKELONG(0x8000, item));
        return 0;
    }

    case WM_DDE_UNADVISE: {
        ATOM item = HIWORD(lParam);
        UINT format = LOWORD(lParam);
        char name[40];
        int i;

        out = args + wsprintf(args, "%s,", (LPSTR)c->topic);
        out = atomText(out, item);
        *out++ = ',';
        formatText(out, format);
        say("srv.UNADVISE", args, "ack");
        name[0] = 0;

        if (item) {
            GlobalGetAtomName(item, name, sizeof name);
        }

        for (i = 0; i < c->count; i++) {
            if (!item || !lstrcmpi(c->items[i], name)) {
                c->items[i][0] = 0;
                c->formats[i] = 0;
            }
        }

        PostMessage(c->client, WM_DDE_ACK, (WPARAM)window, MAKELONG(0x8000, item));
        return 0;
    }

    case WM_DDE_REQUEST: {
        ATOM item = HIWORD(lParam);
        UINT format = LOWORD(lParam);
        char name[80];
        HGLOBAL block;

        name[0] = 0;
        GlobalGetAtomName(item, name, sizeof name);
        out = args + wsprintf(args, "%s,%s,", (LPSTR)c->topic, (LPSTR)name);
        formatText(out, format);
        block = dataFor(c->topic, name, format, 0x3000);
        say("srv.REQUEST", args, block ? "data" : "nack");

        if (block) {
            PostMessage(c->client, WM_DDE_DATA, (WPARAM)window, MAKELONG(block, item));
        } else {
            PostMessage(c->client, WM_DDE_ACK, (WPARAM)window, MAKELONG(0, item));
        }

        return 0;
    }

    case WM_DDE_ACK:
        out = args + wsprintf(args, "%s,", (LPSTR)c->topic);
        atomText(out, HIWORD(lParam));
        wsprintf(result, "%x", LOWORD(lParam));
        say("srv.ACK", args, result);

        if (HIWORD(lParam)) {
            GlobalDeleteAtom(HIWORD(lParam));
        }

        return 0;

    case WM_DDE_DATA:
        out = args + wsprintf(args, "%s,", (LPSTR)c->topic);
        atomText(out, HIWORD(lParam));
        say("srv.DATA", args, "");
        return 0;

    case WM_DDE_TERMINATE:
        say("srv.TERMINATE", c->topic, "");

        if (!c->closing) {
            PostMessage(c->client, WM_DDE_TERMINATE, (WPARAM)window, 0L);
        }

        c->mine = 0;
        DestroyWindow(window);

        if (!live()) {
            say("srv.exit", "", "");
            DestroyWindow(frame);
        }

        return 0;
    }

    return 0;
}

LRESULT CALLBACK __export MainProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    char app[80];
    char topic[80];
    char args[200];
    int i;

    switch (message) {
    case WM_DDE_INITIATE:
        app[0] = 0;
        topic[0] = 0;

        if (LOWORD(lParam)) {
            GlobalGetAtomName(LOWORD(lParam), app, sizeof app);
        }

        if (HIWORD(lParam)) {
            GlobalGetAtomName(HIWORD(lParam), topic, sizeof topic);
        }

        wsprintf(args, "%s,%s", (LPSTR)app, (LPSTR)topic);

        if ((app[0] && lstrcmpi(app, CLASS)) ||
            !(topic[0] && (!lstrcmpi(topic, "System") || known(topic)))) {
            say("srv.INITIATE", args, "not");
            return 0;
        }

        for (i = 0; i < MAXCONV && convs[i].mine; i++) {
        }

        if (i == MAXCONV) {
            say("srv.INITIATE", args, "full");
            return 0;
        }

        convs[i].mine = CreateWindow("OleDdeConv", topic, WS_CHILD, 0, 0, 0, 0, window, NULL, self,
                                     NULL);
        convs[i].client = (HWND)wParam;
        lstrcpy(convs[i].topic, topic);
        convs[i].count = 0;
        convs[i].closing = 0;
        say("srv.INITIATE", args, "ack");
        SendMessage((HWND)wParam, WM_DDE_ACK, (WPARAM)convs[i].mine,
                    MAKELONG(GlobalAddAtom(CLASS), GlobalAddAtom(topic)));
        return 0;

    case WM_USER + 1:
        generation++;
        say("srv.change", "", "");
        tell("Change");
        return 0;

    case WM_USER + 2:
        say("srv.save", "", "");
        tell("Save");
        return 0;

    case WM_USER + 3:
        say("srv.close", "", "");
        tell("Close");
        closeAll();
        return 0;

    case WM_DESTROY:
        PostQuitMessage(0);
        return 0;
    }

    return DefWindowProc(window, message, wParam, lParam);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    MSG msg;
    LPCSTR at = command;

    (void)previous;

    self = instance;
    cfNative = RegisterClipboardFormat("Native");
    cfOwnerLink = RegisterClipboardFormat("OwnerLink");
    cfObjectLink = RegisterClipboardFormat("ObjectLink");
    wsprintf(probeArgs, "%d", show);
    say("srv.start", command, probeArgs);

    /* `-Embedding` and perhaps a file: the file is a document it has. */
    while (*at && *at != ' ') at++;
    while (*at == ' ') at++;

    if (*at) {
        remember(at);
    }

    kind.style = 0;
    kind.lpfnWndProc = MainProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "OleDdeSrv";
    RegisterClass(&kind);
    kind.lpfnWndProc = ConvProc;
    kind.lpszClassName = "OleDdeConv";
    RegisterClass(&kind);

    frame = CreateWindow("OleDdeSrv", "OleDde Server", WS_OVERLAPPEDWINDOW, 300, 200, 160, 100, NULL,
                        NULL, instance, NULL);

    while (GetMessage(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }

    say("srv.end", "", "");
    return 0;
}
