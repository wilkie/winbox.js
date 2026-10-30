/*
 * The server of `olesvr`: a program of the class `OleSvrProbe` that serves
 * its documents and objects through OLESVR, its `OLESERVER`,
 * `OLESERVERDOC` and `OLEOBJECT` method tables writing into the probe's
 * file every call they get -- its arguments and what it answered -- in
 * the order they come, each record appended with the file opened and
 * closed around it. The probe asks it, by messages to its frame window,
 * to call OLESVR's functions (`WM_USER + n`, below), and it tells the
 * probe each is done (`WM_USER + 100` to the probe's window).
 */

#define SERVERONLY
#include "probe.h"
#include <ole.h>

#pragma library("olesvr")

#define OUTPUT "C:\\ORACLE\\OLESRV.OUT"
#define CLASS "OleSvrProbe"

#define MAXDOCS 8
#define MAXOBJS 8

typedef struct {
    OLESERVERDOC base;
    LHSERVERDOC lh;
    char name[80];
    int used;
} DOC;

typedef struct {
    OLEOBJECT base;
    LPOLECLIENT client;
    char item[40];
    int doc;
    int used;
} OBJ;

static OLESERVERVTBL serverTable;
static OLESERVERDOCVTBL docTable;
static OLEOBJECTVTBL objectTable;
static OLESERVER server;
/* A second server, of the class `OleSvrProbe2`, registered `OLE_SERVER_SINGLE`. */
static OLESERVER server2;
static LHSERVER lhs2;
static LHSERVER lhs;
static DOC docs[MAXDOCS];
static OBJ objs[MAXOBJS];
static HINSTANCE self;
static HWND frame;
static int generation;
static int ending;
/* The document the server registered itself (`WM_USER + 12`). */
static int registered = -1;
static UINT cfNative;
static UINT cfOwnerLink;
static UINT cfObjectLink;

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

static LPSTR hex(LPSTR out, const BYTE far *bytes, unsigned count)
{
    unsigned i;

    for (i = 0; i < count; i++) {
        out += wsprintf(out, "%02x", bytes[i]);
    }

    *out = 0;
    return out;
}

static int docOf(LPOLESERVERDOC doc)
{
    int i;

    for (i = 0; i < MAXDOCS; i++) {
        if ((LPOLESERVERDOC)&docs[i].base == doc) {
            return i;
        }
    }

    return -1;
}

static int objOf(LPOLEOBJECT object)
{
    int i;

    for (i = 0; i < MAXOBJS; i++) {
        if ((LPOLEOBJECT)&objs[i].base == object) {
            return i;
        }
    }

    return -1;
}

/* A string argument as text, `(null)` for none. */
static LPCSTR str(LPCSTR s)
{
    return s ? s : "(null)";
}

/* A new document of ours, given OLESVR's handle for it. */
static int newDoc(LHSERVERDOC lh, LPCSTR name)
{
    int i;

    for (i = 0; i < MAXDOCS; i++) {
        if (!docs[i].used) {
            docs[i].used = 1;
            docs[i].base.lpvtbl = &docTable;
            docs[i].lh = lh;
            lstrcpyn(docs[i].name, name ? name : "", sizeof docs[i].name);
            return i;
        }
    }

    return -1;
}

/* The command text of an execute's block. */
static void commandText(LPSTR out, HGLOBAL commands)
{
    LPSTR text = (LPSTR)GlobalLock(commands);

    if (text) {
        lstrcpyn(out, text, 100);
        GlobalUnlock(commands);
    } else {
        lstrcpy(out, "(none)");
    }
}

/* ---- OLESERVER ---- */

/* A method's name, `srv2.` for the second server's. */
static LPCSTR who(LPOLESERVER me, LPCSTR method)
{
    static char name[40];

    if (me == &server2) {
        wsprintf(name, "srv2%s", (LPSTR)(method + 3));
        return name;
    }

    return method;
}

static OLESTATUS made(LPCSTR method, LHSERVERDOC lh, LPCSTR args, LPOLESERVERDOC FAR *out)
{
    int i = newDoc(lh, args);
    char result[40];

    if (i < 0) {
        say(method, args, "full");
        return OLE_ERROR_MEMORY;
    }

    *out = (LPOLESERVERDOC)&docs[i].base;
    wsprintf(result, "0 doc%d %s", i, (LPSTR)(lh ? "lh" : "0"));
    say(method, args, result);
    return OLE_OK;
}

OLESTATUS CALLBACK __export SrvOpen(LPOLESERVER me, LHSERVERDOC lh, OLE_LPCSTR name,
                                    LPOLESERVERDOC FAR *out)
{
    return made(who(me, "srv.Open"), lh, str(name), out);
}

OLESTATUS CALLBACK __export SrvCreate(LPOLESERVER me, LHSERVERDOC lh, OLE_LPCSTR cls,
                                      OLE_LPCSTR name, LPOLESERVERDOC FAR *out)
{
    char args[200];

    wsprintf(args, "%s,%s", str(cls), str(name));
    return made(who(me, "srv.Create"), lh, args, out);
}

OLESTATUS CALLBACK __export SrvCreateFromTemplate(LPOLESERVER me, LHSERVERDOC lh,
                                                  OLE_LPCSTR cls, OLE_LPCSTR name,
                                                  OLE_LPCSTR templ, LPOLESERVERDOC FAR *out)
{
    char args[300];

    wsprintf(args, "%s,%s,%s", str(cls), str(name), str(templ));
    return made(who(me, "srv.CreateFromTemplate"), lh, args, out);
}

OLESTATUS CALLBACK __export SrvEdit(LPOLESERVER me, LHSERVERDOC lh, OLE_LPCSTR cls,
                                    OLE_LPCSTR name, LPOLESERVERDOC FAR *out)
{
    char args[200];

    wsprintf(args, "%s,%s", str(cls), str(name));
    return made(who(me, "srv.Edit"), lh, args, out);
}

OLESTATUS CALLBACK __export SrvExit(LPOLESERVER me)
{
    say(who(me, "srv.Exit"), "", "0");
    return OLE_OK;
}

OLESTATUS CALLBACK __export SrvRelease(LPOLESERVER me)
{
    say(who(me, "srv.Release"), "", "0");

    /* The program ends once its server is revoked at the probe's asking. */
    if (ending) {
        PostMessage(frame, WM_USER + 50, 0, 0L);
    }

    return OLE_OK;
}

OLESTATUS CALLBACK __export SrvExecute(LPOLESERVER me, HGLOBAL commands)
{
    char text[120];
    OLESTATUS answer;
    char result[8];

    commandText(text, commands);
    answer = lstrcmpi(text, "[ProbeFail(1)]") ? OLE_OK : OLE_ERROR_COMMAND;
    wsprintf(result, "%u", (unsigned)answer);
    say(who(me, "srv.Execute"), text, result);
    return answer;
}

/* ---- OLESERVERDOC ---- */

OLESTATUS CALLBACK __export DocSave(LPOLESERVERDOC me)
{
    char args[8];

    wsprintf(args, "doc%d", docOf(me));
    say("doc.Save", args, "0");
    return OLE_OK;
}

OLESTATUS CALLBACK __export DocClose(LPOLESERVERDOC me)
{
    char args[8];
    char result[16];
    int i = docOf(me);

    wsprintf(args, "doc%d", i);
    say("doc.Close", args, "");

    if (i >= 0) {
        wsprintf(result, "%u", (unsigned)OleRevokeServerDoc(docs[i].lh));
        say("OleRevokeServerDoc", args, result);
    }

    return OLE_OK;
}

OLESTATUS CALLBACK __export DocSetHostNames(LPOLESERVERDOC me, OLE_LPCSTR client, OLE_LPCSTR doc)
{
    char args[200];

    wsprintf(args, "doc%d,%s,%s", docOf(me), str(client), str(doc));
    say("doc.SetHostNames", args, "0");
    return OLE_OK;
}

OLESTATUS CALLBACK __export DocSetDocDimensions(LPOLESERVERDOC me, OLE_CONST RECT FAR *rect)
{
    char args[80];

    if (rect) {
        wsprintf(args, "doc%d,%d,%d,%d,%d", docOf(me), rect->left, rect->top, rect->right,
                 rect->bottom);
    } else {
        wsprintf(args, "doc%d,(null)", docOf(me));
    }

    say("doc.SetDocDimensions", args, "0");
    return OLE_OK;
}

OLESTATUS CALLBACK __export DocGetObject(LPOLESERVERDOC me, OLE_LPCSTR item,
                                         LPOLEOBJECT FAR *out, LPOLECLIENT client)
{
    char args[100];
    char result[40];
    int d = docOf(me);
    int i;
    int free = -1;

    wsprintf(args, "doc%d,%s,%s", d, str(item), (LPSTR)(client ? "client" : "0"));

    if (item && !lstrcmpi(item, "Missing")) {
        say("doc.GetObject", args, "29");
        return OLE_ERROR_NAME;
    }

    for (i = 0; i < MAXOBJS; i++) {
        if (objs[i].used && objs[i].doc == d && !lstrcmpi(objs[i].item, item ? item : "")) {
            break;
        }

        if (!objs[i].used && free < 0) {
            free = i;
        }
    }

    if (i == MAXOBJS) {
        i = free;
    }

    if (i < 0) {
        say("doc.GetObject", args, "full");
        return OLE_ERROR_MEMORY;
    }

    wsprintf(result, "0 obj%d%s%s", i, (LPSTR)(objs[i].used ? " again" : ""),
             (LPSTR)(objs[i].used && objs[i].client == client ? " same" : ""));
    objs[i].used = 1;
    objs[i].doc = d;
    objs[i].client = client;
    objs[i].base.lpvtbl = &objectTable;
    lstrcpyn(objs[i].item, item ? item : "", sizeof objs[i].item);
    *out = (LPOLEOBJECT)&objs[i].base;
    say("doc.GetObject", args, result);
    return OLE_OK;
}

OLESTATUS CALLBACK __export DocRelease(LPOLESERVERDOC me)
{
    char args[8];
    int i = docOf(me);

    wsprintf(args, "doc%d", i);
    say("doc.Release", args, "0");

    if (i >= 0) {
        docs[i].used = 0;
    }

    return OLE_OK;
}

static void palette(LPSTR out, OLE_CONST LOGPALETTE FAR *p)
{
    if (!p) {
        lstrcpy(out, "(null)");
        return;
    }

    out += wsprintf(out, "%x %u ", p->palVersion, p->palNumEntries);
    hex(out, (const BYTE far *)p->palPalEntry, p->palNumEntries > 4 ? 16 : p->palNumEntries * 4);
}

OLESTATUS CALLBACK __export DocSetColorScheme(LPOLESERVERDOC me, OLE_CONST LOGPALETTE FAR *p)
{
    char args[100];
    LPSTR out = args + wsprintf(args, "doc%d,", docOf(me));

    palette(out, p);
    say("doc.SetColorScheme", args, "0");
    return OLE_OK;
}

OLESTATUS CALLBACK __export DocExecute(LPOLESERVERDOC me, HGLOBAL commands)
{
    char text[120];
    char args[140];

    commandText(text, commands);
    wsprintf(args, "doc%d,%s", docOf(me), (LPSTR)text);
    say("doc.Execute", args, "0");
    return OLE_OK;
}

/* ---- OLEOBJECT ---- */

static void objName(LPSTR out, LPOLEOBJECT me)
{
    int i = objOf(me);

    if (i < 0) {
        wsprintf(out, "obj?");
    } else {
        wsprintf(out, "obj%d", i);
    }
}

void FAR *CALLBACK __export ObjQueryProtocol(LPOLEOBJECT me, OLE_LPCSTR protocol)
{
    char args[80];
    int ok = protocol && !lstrcmp(protocol, "StdFileEditing");

    objName(args, me);
    wsprintf(args + lstrlen(args), ",%s", str(protocol));
    say("obj.QueryProtocol", args, ok ? "self" : "0");
    return ok ? (void FAR *)me : NULL;
}

OLESTATUS CALLBACK __export ObjRelease(LPOLEOBJECT me)
{
    char args[16];
    int i = objOf(me);

    objName(args, me);
    say("obj.Release", args, "0");

    if (i >= 0) {
        objs[i].used = 0;
        objs[i].client = NULL;
    }

    return OLE_OK;
}

OLESTATUS CALLBACK __export ObjShow(LPOLEOBJECT me, BOOL focus)
{
    char args[24];

    objName(args, me);
    wsprintf(args + lstrlen(args), ",%d", focus);
    say("obj.Show", args, "0");
    return OLE_OK;
}

OLESTATUS CALLBACK __export ObjDoVerb(LPOLEOBJECT me, UINT verb, BOOL show, BOOL focus)
{
    char args[40];

    objName(args, me);
    wsprintf(args + lstrlen(args), ",%u,%d,%d", verb, show, focus);
    say("obj.DoVerb", args, "0");
    return OLE_OK;
}

/* A block of `GMEM_DDESHARE` with the bytes given. */
static HGLOBAL block(const char far *bytes, unsigned count)
{
    HGLOBAL h = GlobalAlloc(GMEM_MOVEABLE | GMEM_DDESHARE, count);
    LPBYTE into = (LPBYTE)GlobalLock(h);
    unsigned i;

    for (i = 0; i < count; i++) into[i] = bytes[i];

    GlobalUnlock(h);
    return h;
}

OLESTATUS CALLBACK __export ObjGetData(LPOLEOBJECT me, OLECLIPFORMAT format, HANDLE FAR *out)
{
    char args[60];
    LPSTR at;
    int i = objOf(me);

    objName(args, me);
    at = args + lstrlen(args);
    *at++ = ',';
    formatText(at, format);

    if (format == cfNative) {
        char native[16];
        int k;

        for (k = 0; k < 16; k++) native[k] = (char)(0x50 + k);

        native[0] = (char)generation;
        *out = block(native, 16);
        say("obj.GetData", args, "0");
        return OLE_OK;
    }

    if (format == cfOwnerLink || format == cfObjectLink) {
        char text[200];
        LPSTR t = text;
        int d = i >= 0 ? objs[i].doc : -1;

        t += wsprintf(t, "%s", (LPSTR)CLASS) + 1;
        t += wsprintf(t, "%s", (LPSTR)(d >= 0 ? docs[d].name : "?")) + 1;
        t += wsprintf(t, "%s", (LPSTR)(i >= 0 ? objs[i].item : "?")) + 1;
        *t++ = 0;
        *out = block(text, (unsigned)(t - text));
        say("obj.GetData", args, "0");
        return OLE_OK;
    }

    if (format == CF_METAFILEPICT) {
        HDC meta = CreateMetaFile(NULL);
        HGLOBAL picture;
        LPMETAFILEPICT p;

        SetWindowOrg(meta, 0, 0);
        SetWindowExt(meta, 100, 50);
        Rectangle(meta, 0, 0, 100, 50);
        picture = GlobalAlloc(GMEM_MOVEABLE | GMEM_DDESHARE, sizeof(METAFILEPICT));
        p = (LPMETAFILEPICT)GlobalLock(picture);
        p->mm = MM_ANISOTROPIC;
        p->xExt = 2000;
        p->yExt = 1000;
        p->hMF = CloseMetaFile(meta);
        GlobalUnlock(picture);
        *out = picture;
        say("obj.GetData", args, "0");
        return OLE_OK;
    }

    say("obj.GetData", args, "12");
    return OLE_ERROR_FORMAT;
}

OLESTATUS CALLBACK __export ObjSetData(LPOLEOBJECT me, OLECLIPFORMAT format, HANDLE data)
{
    char args[60];
    char result[60];
    LPSTR at;
    LPBYTE bytes;

    objName(args, me);
    at = args + lstrlen(args);
    *at++ = ',';
    formatText(at, format);
    bytes = data ? (LPBYTE)GlobalLock(data) : NULL;

    if (bytes && format == CF_TEXT) {
        lstrcpyn(result, (LPSTR)bytes, 40);
        GlobalUnlock(data);
    } else if (bytes) {
        hex(result, bytes, 16);
        GlobalUnlock(data);
    } else {
        lstrcpy(result, "(none)");
    }

    say("obj.SetData", args, result);
    return OLE_OK;
}

OLESTATUS CALLBACK __export ObjSetTargetDevice(LPOLEOBJECT me, HGLOBAL device)
{
    char args[16];
    char result[120];
    LPBYTE bytes;

    objName(args, me);
    bytes = device ? (LPBYTE)GlobalLock(device) : NULL;

    if (bytes) {
        const WORD far *w = (const WORD far *)bytes;

        wsprintf(result, "%u,%u,%u,%u,%u,%u,%u %s", w[0], w[1], w[2], w[3], w[4], w[5], w[6],
                 (LPSTR)(bytes + 14 + w[0]));
        GlobalUnlock(device);
    } else {
        lstrcpy(result, "(none)");
    }

    say("obj.SetTargetDevice", args, result);
    return OLE_OK;
}

OLESTATUS CALLBACK __export ObjSetBounds(LPOLEOBJECT me, OLE_CONST RECT FAR *rect)
{
    char args[60];

    objName(args, me);

    if (rect) {
        wsprintf(args + lstrlen(args), ",%d,%d,%d,%d", rect->left, rect->top, rect->right,
                 rect->bottom);
    }

    say("obj.SetBounds", args, "0");
    return OLE_OK;
}

OLECLIPFORMAT CALLBACK __export ObjEnumFormats(LPOLEOBJECT me, OLECLIPFORMAT format)
{
    char args[60];
    char result[40];
    LPSTR at;
    OLECLIPFORMAT next = 0;

    objName(args, me);
    at = args + lstrlen(args);
    *at++ = ',';
    formatText(at, format);

    if (format == 0) {
        next = cfNative;
    } else if (format == cfNative) {
        next = cfOwnerLink;
    } else if (format == cfOwnerLink) {
        next = cfObjectLink;
    } else if (format == cfObjectLink) {
        next = CF_METAFILEPICT;
    }

    formatText(result, next);
    say("obj.EnumFormats", args, result);
    return next;
}

OLESTATUS CALLBACK __export ObjSetColorScheme(LPOLEOBJECT me, OLE_CONST LOGPALETTE FAR *p)
{
    char args[100];

    objName(args, me);
    *(args + lstrlen(args)) = ',';
    palette(args + lstrlen(args) + 1, p);
    say("obj.SetColorScheme", args, "0");
    return OLE_OK;
}

/* ---- what the probe asks ---- */

static void tellClient(int i, OLE_NOTIFICATION what, LPCSTR name)
{
    char args[16];
    char result[16];
    int answer;

    wsprintf(args, "obj%d,%d", i, (int)what);

    if (i < 0 || i >= MAXOBJS || !objs[i].used || !objs[i].client) {
        say(name, args, "no client");
        return;
    }

    answer = (*objs[i].client->lpvtbl->CallBack)(objs[i].client, what,
                                                 (LPOLEOBJECT)&objs[i].base);
    wsprintf(result, "%d", answer);
    say(name, args, result);
}

static void asked(UINT n, WPARAM w)
{
    char args[40];
    char result[40];
    OLESTATUS answer;
    BOOL more;
    int k;

    wsprintf(args, "doc%d", (int)w);

    switch (n) {
    case 1:
        generation++;
        tellClient((int)w, OLE_CHANGED, "CallBack");
        break;
    case 2:
    case 3:
    case 10:
        /* 2 on the document numbered, 3 and 10 on the one the server registered. */
        if (n != 2 && registered >= 0) {
            w = (WPARAM)registered;
            wsprintf(args, "doc%d", (int)w);
        }

        if (n == 3) {
            answer = OleRenameServerDoc(docs[w].lh, "C:\\ORACLE\\OLESVR2.FIL");
            wsprintf(result, "%u", (unsigned)answer);
            say("OleRenameServerDoc", args, result);
            lstrcpy(docs[w].name, "C:\\ORACLE\\OLESVR2.FIL");
            break;
        }

        if (n == 10) {
            answer = OleRevokeServerDoc(docs[w].lh);
            wsprintf(result, "%u", (unsigned)answer);
            say("OleRevokeServerDoc", args, result);
            break;
        }

        answer = OleSavedServerDoc(docs[w].lh);
        wsprintf(result, "%u", (unsigned)answer);
        say("OleSavedServerDoc", args, result);
        break;
    case 4:
        wsprintf(args, "obj%d", (int)w);
        answer = OleRevokeObject(objs[w].client);
        wsprintf(result, "%u", (unsigned)answer);
        say("OleRevokeObject", args, result);
        break;
    case 5:
        wsprintf(result, "%u", (unsigned)OleBlockServer(lhs));
        say("OleBlockServer", "server", result);
        break;
    case 6:
        for (k = 0; k < 8; k++) {
            more = 7;
            answer = OleUnblockServer(lhs, &more);
            wsprintf(result, "%u %d", (unsigned)answer, more);
            say("OleUnblockServer", "server", result);

            if (answer != OLE_OK || !more) {
                break;
            }
        }
        break;
    case 7:
        answer = OleRevertServerDoc(docs[w].lh);
        wsprintf(result, "%u", (unsigned)answer);
        say("OleRevertServerDoc", args, result);
        break;
    case 8:
        tellClient((int)w, OLE_SAVED, "CallBack");
        break;
    case 9:
        tellClient((int)w, OLE_CLOSED, "CallBack");
        break;
    case 11:
        ending = 1;
        answer = OleRevokeServer(lhs);
        wsprintf(result, "%u", (unsigned)answer);
        say("OleRevokeServer", "server", result);
        break;
    case 12:
        /* A document of the server's own, registered as a program opens a file. */
        k = newDoc(0, "C:\\ORACLE\\OLESVR3.FIL");
        registered = k;
        answer = OleRegisterServerDoc(lhs, "C:\\ORACLE\\OLESVR3.FIL",
                                      (LPOLESERVERDOC)&docs[k].base, &docs[k].lh);
        wsprintf(result, "%u doc%d %s", (unsigned)answer, k, (LPSTR)(docs[k].lh ? "lh" : "0"));
        say("OleRegisterServerDoc", "C:\\ORACLE\\OLESVR3.FIL", result);
        break;
    case 14:
        answer = OleRevokeServer(lhs2);
        wsprintf(result, "%u", (unsigned)answer);
        say("OleRevokeServer", "server2", result);
        break;
    case 13:
        tellClient((int)w, OLE_RENAMED, "CallBack");
        break;
    }
}

LONG FAR PASCAL __export MainProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message > WM_USER && message < WM_USER + 50) {
        HWND probe = FindWindow("OleSvrCli", NULL);

        asked(message - WM_USER, wParam);

        if (probe) {
            PostMessage(probe, WM_USER + 100, message - WM_USER, 0L);
        }

        return 0;
    }

    if (message == WM_USER + 50) {
        DestroyWindow(hwnd);
        return 0;
    }

    if (message == WM_DESTROY) {
        PostQuitMessage(0);
        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

/* The windows of this task, top level: their classes, in Windows' order. */
BOOL CALLBACK __export EachWindow(HWND hwnd, LPARAM lParam)
{
    char name[40];
    char result[60];

    (void)lParam;
    GetClassName(hwnd, name, sizeof name);
    wsprintf(result, "%s %d", (LPSTR)name, IsWindowVisible(hwnd) ? 1 : 0);
    say("window", "", result);
    return TRUE;
}

#define PROC(f) MakeProcInstance((FARPROC)(f), instance)

static void tables(HINSTANCE instance)
{
    *(FARPROC *)&serverTable.Open = PROC(SrvOpen);
    *(FARPROC *)&serverTable.Create = PROC(SrvCreate);
    *(FARPROC *)&serverTable.CreateFromTemplate = PROC(SrvCreateFromTemplate);
    *(FARPROC *)&serverTable.Edit = PROC(SrvEdit);
    *(FARPROC *)&serverTable.Exit = PROC(SrvExit);
    *(FARPROC *)&serverTable.Release = PROC(SrvRelease);
    *(FARPROC *)&serverTable.Execute = PROC(SrvExecute);
    server.lpvtbl = &serverTable;
    server2.lpvtbl = &serverTable;

    *(FARPROC *)&docTable.Save = PROC(DocSave);
    *(FARPROC *)&docTable.Close = PROC(DocClose);
    *(FARPROC *)&docTable.SetHostNames = PROC(DocSetHostNames);
    *(FARPROC *)&docTable.SetDocDimensions = PROC(DocSetDocDimensions);
    *(FARPROC *)&docTable.GetObject = PROC(DocGetObject);
    *(FARPROC *)&docTable.Release = PROC(DocRelease);
    *(FARPROC *)&docTable.SetColorScheme = PROC(DocSetColorScheme);
    *(FARPROC *)&docTable.Execute = PROC(DocExecute);

    *(FARPROC *)&objectTable.QueryProtocol = PROC(ObjQueryProtocol);
    *(FARPROC *)&objectTable.Release = PROC(ObjRelease);
    *(FARPROC *)&objectTable.Show = PROC(ObjShow);
    *(FARPROC *)&objectTable.DoVerb = PROC(ObjDoVerb);
    *(FARPROC *)&objectTable.GetData = PROC(ObjGetData);
    *(FARPROC *)&objectTable.SetData = PROC(ObjSetData);
    *(FARPROC *)&objectTable.SetTargetDevice = PROC(ObjSetTargetDevice);
    *(FARPROC *)&objectTable.SetBounds = PROC(ObjSetBounds);
    *(FARPROC *)&objectTable.EnumFormats = PROC(ObjEnumFormats);
    *(FARPROC *)&objectTable.SetColorScheme = PROC(ObjSetColorScheme);
}

/* The functions' answers to what is not a server's or a document's handle. */
static void refusals(void)
{
    char result[40];
    LHSERVER other = 0;
    LHSERVERDOC doc = 0;
    BOOL more = 7;
    OLESTATUS answer;

    wsprintf(result, "%u", (unsigned)OleRevokeServer(0L));
    say("OleRevokeServer", "0", result);
    wsprintf(result, "%u", (unsigned)OleBlockServer(0L));
    say("OleBlockServer", "0", result);
    answer = OleUnblockServer(0L, &more);
    wsprintf(result, "%u %d", (unsigned)answer, more);
    say("OleUnblockServer", "0", result);
    wsprintf(result, "%u", (unsigned)OleRevokeServerDoc(0L));
    say("OleRevokeServerDoc", "0", result);
    wsprintf(result, "%u", (unsigned)OleRenameServerDoc(0L, "X"));
    say("OleRenameServerDoc", "0", result);
    wsprintf(result, "%u", (unsigned)OleRevertServerDoc(0L));
    say("OleRevertServerDoc", "0", result);
    wsprintf(result, "%u", (unsigned)OleSavedServerDoc(0L));
    say("OleSavedServerDoc", "0", result);
    wsprintf(result, "%u", (unsigned)OleRevokeObject(NULL));
    say("OleRevokeObject", "0", result);
    answer = OleRegisterServerDoc(0L, "C:\\ORACLE\\X.FIL", (LPOLESERVERDOC)&docs[MAXDOCS - 1].base,
                                  &doc);
    wsprintf(result, "%u %s", (unsigned)answer, (LPSTR)(doc ? "lh" : "0"));
    say("OleRegisterServerDoc", "0", result);

    /* A class not in the registration database. */
    answer = OleRegisterServer("NoSuchClass", &server, &other, self, OLE_SERVER_MULTI);
    wsprintf(result, "%u %s", (unsigned)answer, (LPSTR)(other ? "lh" : "0"));
    say("OleRegisterServer", "NoSuchClass", result);

    if (answer == OLE_OK) {
        wsprintf(result, "%u", (unsigned)OleRevokeServer(other));
        say("OleRevokeServer", "NoSuchClass", result);
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    MSG msg;
    char result[60];
    OLESTATUS answer;
    LHSERVER again = 0;
    HWND probe;

    (void)previous;

    self = instance;
    cfNative = RegisterClipboardFormat("Native");
    cfOwnerLink = RegisterClipboardFormat("OwnerLink");
    cfObjectLink = RegisterClipboardFormat("ObjectLink");
    wsprintf(probeArgs, "%d", show);
    say("srv.start", command, probeArgs);
    tables(instance);

    kind.style = 0;
    kind.lpfnWndProc = MainProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "OleSvrSrv";
    RegisterClass(&kind);
    frame = CreateWindow("OleSvrSrv", "OleSvr Server", WS_OVERLAPPEDWINDOW, 300, 200, 160, 100, NULL,
                         NULL, instance, NULL);

    wsprintf(result, "%lx", OleQueryServerVersion());
    say("OleQueryServerVersion", "", result);
    refusals();

    answer = OleRegisterServer(CLASS, &server, &lhs, instance, OLE_SERVER_MULTI);
    wsprintf(result, "%u %s", (unsigned)answer, (LPSTR)(lhs ? "lh" : "0"));
    say("OleRegisterServer", CLASS, result);
    answer = OleRegisterServer(CLASS, &server, &again, instance, OLE_SERVER_MULTI);
    wsprintf(result, "%u %s", (unsigned)answer, (LPSTR)(again ? "lh" : "0"));
    say("OleRegisterServer", "again", result);

    if (answer == OLE_OK) {
        wsprintf(result, "%u", (unsigned)OleRevokeServer(again));
        say("OleRevokeServer", "again", result);
    }

    answer = OleRegisterServer(CLASS "2", &server2, &lhs2, instance, OLE_SERVER_SINGLE);
    wsprintf(result, "%u %s", (unsigned)answer, (LPSTR)(lhs2 ? "lh" : "0"));
    say("OleRegisterServer", CLASS "2", result);
    EnumTaskWindows(GetCurrentTask(), (WNDENUMPROC)PROC(EachWindow), 0L);

    probe = FindWindow("OleSvrCli", NULL);

    if (probe) {
        PostMessage(probe, WM_USER + 100, 0, 0L);
    }

    while (GetMessage(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }

    say("srv.end", "", "");
    return 0;
}
