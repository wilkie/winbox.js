/*
 * The server of `oleitem`: a program of the class `OleItmProbe` that serves
 * documents and objects through OLESVR and writes into the probe's file
 * the calls that tell which object is which: each `GetObject` with the
 * object it gave, each `GetData` and `Release`, and the answer of each
 * `CallBack` it makes at the probe's asking. The probe asks by messages to
 * its frame window:
 *
 * * `WM_USER + n`, n below 50: one of OLESVR's functions or a client's
 *   `CallBack` (`asked`, below), the probe told when done by `WM_USER +
 *   100` to its window;
 * * `WM_USER + 60`, lParam a far pointer: the number of the object whose
 *   `OLECLIENT` it is, plus one, or nought;
 * * `WM_USER + 61`, lParam a far pointer: the same, of the object it is.
 */

#define SERVERONLY
#include "probe.h"
#include <ole.h>

#pragma library("olesvr")

#define OUTPUT "C:\\ORACLE\\OLEITEM.OUT"
#define CLASS "OleItmProbe"

#define MAXDOCS 4
#define MAXOBJS 8

typedef struct {
    OLESERVERDOC base;
    LHSERVERDOC lh;
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
static LHSERVER lhs;
static DOC docs[MAXDOCS];
static OBJ objs[MAXOBJS];
static HWND frame;
static int generation;
static int ending;
static UINT cfNative;
static UINT cfOwnerLink;
static UINT cfObjectLink;

static void say(LPCSTR function, LPCSTR args, LPCSTR result)
{
    char line[600];
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

static OLESTATUS made(LHSERVERDOC lh, LPOLESERVERDOC FAR *out)
{
    int i;

    for (i = 0; i < MAXDOCS; i++) {
        if (!docs[i].used) {
            docs[i].used = 1;
            docs[i].base.lpvtbl = &docTable;
            docs[i].lh = lh;
            *out = (LPOLESERVERDOC)&docs[i].base;
            return OLE_OK;
        }
    }

    return OLE_ERROR_MEMORY;
}

/* ---- OLESERVER ---- */

OLESTATUS CALLBACK __export SrvOpen(LPOLESERVER me, LHSERVERDOC lh, OLE_LPCSTR name,
                                    LPOLESERVERDOC FAR *out)
{
    (void)me;
    (void)name;
    return made(lh, out);
}

OLESTATUS CALLBACK __export SrvCreate(LPOLESERVER me, LHSERVERDOC lh, OLE_LPCSTR cls,
                                      OLE_LPCSTR name, LPOLESERVERDOC FAR *out)
{
    (void)me;
    (void)cls;
    (void)name;
    return made(lh, out);
}

OLESTATUS CALLBACK __export SrvCreateFromTemplate(LPOLESERVER me, LHSERVERDOC lh,
                                                  OLE_LPCSTR cls, OLE_LPCSTR name,
                                                  OLE_LPCSTR templ, LPOLESERVERDOC FAR *out)
{
    (void)me;
    (void)cls;
    (void)name;
    (void)templ;
    return made(lh, out);
}

OLESTATUS CALLBACK __export SrvEdit(LPOLESERVER me, LHSERVERDOC lh, OLE_LPCSTR cls,
                                    OLE_LPCSTR name, LPOLESERVERDOC FAR *out)
{
    (void)me;
    (void)cls;
    (void)name;
    return made(lh, out);
}

OLESTATUS CALLBACK __export SrvExit(LPOLESERVER me)
{
    (void)me;
    return OLE_OK;
}

OLESTATUS CALLBACK __export SrvRelease(LPOLESERVER me)
{
    (void)me;
    say("srv.Release", "", "0");

    if (ending) {
        PostMessage(frame, WM_USER + 50, 0, 0L);
    }

    return OLE_OK;
}

OLESTATUS CALLBACK __export SrvExecute(LPOLESERVER me, HGLOBAL commands)
{
    (void)me;
    (void)commands;
    return OLE_OK;
}

/* ---- OLESERVERDOC ---- */

OLESTATUS CALLBACK __export DocSave(LPOLESERVERDOC me)
{
    (void)me;
    return OLE_OK;
}

OLESTATUS CALLBACK __export DocClose(LPOLESERVERDOC me)
{
    int i = docOf(me);

    if (i >= 0) {
        OleRevokeServerDoc(docs[i].lh);
    }

    return OLE_OK;
}

OLESTATUS CALLBACK __export DocSetHostNames(LPOLESERVERDOC me, OLE_LPCSTR client, OLE_LPCSTR doc)
{
    (void)me;
    (void)client;
    (void)doc;
    return OLE_OK;
}

OLESTATUS CALLBACK __export DocSetDocDimensions(LPOLESERVERDOC me, OLE_CONST RECT FAR *rect)
{
    (void)me;
    (void)rect;
    return OLE_OK;
}

OLESTATUS CALLBACK __export DocGetObject(LPOLESERVERDOC me, OLE_LPCSTR item,
                                         LPOLEOBJECT FAR *out, LPOLECLIENT client)
{
    char args[80];
    char result[40];
    int d = docOf(me);
    int i;
    int free = -1;

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

    wsprintf(args, "doc%d,%s", d, (LPSTR)(item ? item : "(null)"));

    if (i < 0) {
        say("doc.GetObject", args, "full");
        return OLE_ERROR_MEMORY;
    }

    objs[i].used = 1;
    objs[i].doc = d;
    objs[i].client = client;
    objs[i].base.lpvtbl = &objectTable;
    lstrcpyn(objs[i].item, item ? item : "", sizeof objs[i].item);
    *out = (LPOLEOBJECT)&objs[i].base;
    wsprintf(result, "obj%d", i);
    say("doc.GetObject", args, result);
    return OLE_OK;
}

OLESTATUS CALLBACK __export DocRelease(LPOLESERVERDOC me)
{
    int i = docOf(me);
    char args[8];

    wsprintf(args, "doc%d", i);
    say("doc.Release", args, "0");

    if (i >= 0) {
        docs[i].used = 0;
    }

    return OLE_OK;
}

OLESTATUS CALLBACK __export DocSetColorScheme(LPOLESERVERDOC me, OLE_CONST LOGPALETTE FAR *p)
{
    (void)me;
    (void)p;
    return OLE_OK;
}

OLESTATUS CALLBACK __export DocExecute(LPOLESERVERDOC me, HGLOBAL commands)
{
    (void)me;
    (void)commands;
    return OLE_OK;
}

/* ---- OLEOBJECT ---- */

void FAR *CALLBACK __export ObjQueryProtocol(LPOLEOBJECT me, OLE_LPCSTR protocol)
{
    return protocol && !lstrcmp(protocol, "StdFileEditing") ? (void FAR *)me : NULL;
}

OLESTATUS CALLBACK __export ObjRelease(LPOLEOBJECT me)
{
    char args[16];
    int i = objOf(me);

    wsprintf(args, "obj%d", i);
    say("obj.Release", args, "0");

    if (i >= 0) {
        objs[i].used = 0;
        objs[i].client = NULL;
    }

    return OLE_OK;
}

OLESTATUS CALLBACK __export ObjShow(LPOLEOBJECT me, BOOL focus)
{
    (void)me;
    (void)focus;
    return OLE_OK;
}

OLESTATUS CALLBACK __export ObjDoVerb(LPOLEOBJECT me, UINT verb, BOOL show, BOOL focus)
{
    (void)me;
    (void)verb;
    (void)show;
    (void)focus;
    return OLE_OK;
}

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

    at = args + wsprintf(args, "obj%d,", i);
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
        char text[100];
        LPSTR t = text;

        t += wsprintf(t, "%s", (LPSTR)CLASS) + 1;
        t += wsprintf(t, "Doc1") + 1;
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
    (void)me;
    (void)format;
    (void)data;
    return OLE_OK;
}

OLESTATUS CALLBACK __export ObjSetTargetDevice(LPOLEOBJECT me, HGLOBAL device)
{
    (void)me;
    (void)device;
    return OLE_OK;
}

OLESTATUS CALLBACK __export ObjSetBounds(LPOLEOBJECT me, OLE_CONST RECT FAR *rect)
{
    (void)me;
    (void)rect;
    return OLE_OK;
}

OLECLIPFORMAT CALLBACK __export ObjEnumFormats(LPOLEOBJECT me, OLECLIPFORMAT format)
{
    (void)me;

    if (format == 0) {
        return cfNative;
    }

    if (format == cfNative) {
        return cfOwnerLink;
    }

    if (format == cfOwnerLink) {
        return cfObjectLink;
    }

    if (format == cfObjectLink) {
        return CF_METAFILEPICT;
    }

    return 0;
}

OLESTATUS CALLBACK __export ObjSetColorScheme(LPOLEOBJECT me, OLE_CONST LOGPALETTE FAR *p)
{
    (void)me;
    (void)p;
    return OLE_OK;
}

/* ---- what the probe asks ---- */

static void tellClient(int i, OLE_NOTIFICATION what)
{
    char args[16];
    char result[16];
    int answer;

    wsprintf(args, "obj%d,%d", i, (int)what);

    if (i < 0 || i >= MAXOBJS || !objs[i].used || !objs[i].client) {
        say("CallBack", args, "no client");
        return;
    }

    answer = (*objs[i].client->lpvtbl->CallBack)(objs[i].client, what,
                                                 (LPOLEOBJECT)&objs[i].base);
    wsprintf(result, "%d", answer);
    say("CallBack", args, result);
}

static void asked(UINT n, WPARAM w)
{
    char args[16];
    char result[16];

    switch (n) {
    case 1:
        generation++;
        tellClient((int)w, OLE_CHANGED);
        break;
    case 2:
        wsprintf(args, "doc%d", (int)w);
        wsprintf(result, "%u", (unsigned)OleSavedServerDoc(docs[w].lh));
        say("OleSavedServerDoc", args, result);
        break;
    case 3:
        tellClient((int)w, OLE_SAVED);
        break;
    case 4:
        wsprintf(args, "obj%d", (int)w);
        wsprintf(result, "%u", (unsigned)OleRevokeObject(objs[w].client));
        say("OleRevokeObject", args, result);
        break;
    case 5:
        wsprintf(args, "doc%d", (int)w);
        wsprintf(result, "%u", (unsigned)OleRevokeServerDoc(docs[w].lh));
        say("OleRevokeServerDoc", args, result);
        break;
    case 6:
        ending = 1;
        wsprintf(result, "%u", (unsigned)OleRevokeServer(lhs));
        say("OleRevokeServer", "server", result);
        break;
    }
}

static LRESULT which(LPARAM pointer, BOOL object)
{
    int i;

    for (i = 0; i < MAXOBJS; i++) {
        if (!objs[i].used) {
            continue;
        }

        if (object ? (LPARAM)(LPOLEOBJECT)&objs[i].base == pointer
                   : (LPARAM)objs[i].client == pointer) {
            return i + 1;
        }
    }

    return 0;
}

LONG FAR PASCAL __export MainProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message > WM_USER && message < WM_USER + 50) {
        HWND probe = FindWindow("OleItmCli", NULL);

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

    if (message == WM_USER + 60 || message == WM_USER + 61) {
        return which(lParam, message == WM_USER + 61);
    }

    if (message == WM_DESTROY) {
        PostQuitMessage(0);
        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
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

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    MSG msg;
    char result[20];
    OLESTATUS answer;
    HWND probe;

    (void)previous;
    (void)command;
    (void)show;

    cfNative = RegisterClipboardFormat("Native");
    cfOwnerLink = RegisterClipboardFormat("OwnerLink");
    cfObjectLink = RegisterClipboardFormat("ObjectLink");
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
    kind.lpszClassName = "OleItmSrv";
    RegisterClass(&kind);
    frame = CreateWindow("OleItmSrv", "OleItm Server", WS_OVERLAPPEDWINDOW, 300, 200, 160, 100, NULL,
                         NULL, instance, NULL);

    answer = OleRegisterServer(CLASS, &server, &lhs, instance, OLE_SERVER_MULTI);
    wsprintf(result, "%u %s", (unsigned)answer, (LPSTR)(lhs ? "lh" : "0"));
    say("OleRegisterServer", CLASS, result);

    probe = FindWindow("OleItmCli", NULL);

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
