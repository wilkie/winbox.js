/*
 * OLECLI's object handlers, and its own for Paintbrush. The probe registers
 * its library, `OLEHNDD.DLL` (`olehnd.dll.c`), under the class `OleHnd`'s
 * `protocol\StdFileEditing\handler` key, as the OLE 1.0 programmer's
 * reference describes a handler's registration, and writes down what each
 * `Ole` function hands it, what the `Def` exports the library calls answer,
 * and what the client is answered.
 *
 * * `handler`: an object of `OleHnd` loaded from a stream, embedded and
 *   linked; made from the clipboard; made, from a template, from a file,
 *   linked to a file, invisible: each `Dll` call the handler is given, its
 *   default's answer, the object's method table by the OLECLI export each
 *   slot is, and how many hold the library loaded.
 * * `refuse`: the handler answers `OLE_ERROR_GENERIC` without its default.
 * * `override`: the handler puts its own `QueryBounds` in its object's
 *   table: whether another object, of a class with no handler, has the same
 *   table and finds that method there.
 * * `def`: the `Def` exports, and `LeCreateInvisible`, called by the probe
 *   itself, for a class with no handler.
 * * `pb`: objects of the class `PBrush`, with and without a picture, by
 *   their tables, asked what a client asks; the `Pb` exports called
 *   directly.
 *
 * The classes' server is a file that is not there, so nothing that needs a
 * server can start one. Nothing that differs between machines is written:
 * a handle as whether it is nought, a format by its name, a block's bytes
 * only as far as what was put in it.
 */

#include "probe.h"
#include <ole.h>
#include <shellapi.h>

#pragma library("olecli")
#pragma library("shell")

#define OUTPUT "C:\\ORACLE\\OLEHND.OUT"
#define HANDLER "C:\\WINDOWS\\OLEHNDD.DLL"
#define NO_SERVER "C:\\ORACLE\\NOSUCH.EXE"
#define FILE_NAME "C:\\ORACLE\\OLEHND.HND"

#include "olebmp.h"

typedef OLESTATUS(FAR PASCAL *LOADPROC)(LPOLESTREAM, LPSTR, LPOLECLIENT, LHCLIENTDOC, LPSTR,
                                        LPOLEOBJECT FAR *, LONG, ATOM, UINT);
typedef OLESTATUS(FAR PASCAL *CLIPPROC)(LPSTR, LPOLECLIENT, LHCLIENTDOC, LPSTR, LPOLEOBJECT FAR *,
                                        UINT, UINT, LONG);
typedef OLESTATUS(FAR PASCAL *LINKCLIPPROC)(LPSTR, LPOLECLIENT, LHCLIENTDOC, LPSTR,
                                            LPOLEOBJECT FAR *, UINT, UINT);
typedef OLESTATUS(FAR PASCAL *CREATEPROC)(LPSTR, LPOLECLIENT, LPSTR, LHCLIENTDOC, LPSTR,
                                          LPOLEOBJECT FAR *, UINT, UINT);
typedef OLESTATUS(FAR PASCAL *FILEPROC)(LPSTR, LPOLECLIENT, LPSTR, LPSTR, LHCLIENTDOC, LPSTR,
                                        LPOLEOBJECT FAR *, UINT, UINT);
typedef OLESTATUS(FAR PASCAL *LINKFILEPROC)(LPSTR, LPOLECLIENT, LPSTR, LPSTR, LPSTR, LHCLIENTDOC,
                                            LPSTR, LPOLEOBJECT FAR *, UINT, UINT);
typedef OLESTATUS(FAR PASCAL *INVISIBLEPROC)(LPSTR, LPOLECLIENT, LPSTR, LHCLIENTDOC, LPSTR,
                                             LPOLEOBJECT FAR *, UINT, UINT, BOOL);
typedef OLESTATUS(FAR PASCAL *LEINVISIBLEPROC)(LPOLECLIENT, LPSTR, LHCLIENTDOC, LPSTR,
                                               LPOLEOBJECT FAR *, UINT, UINT, BOOL);
typedef OLESTATUS(FAR PASCAL *BOUNDSPROC)(LPOLEOBJECT, RECT FAR *);
typedef OLECLIPFORMAT(FAR PASCAL *ENUMPROC)(LPOLEOBJECT, OLECLIPFORMAT);
typedef OLESTATUS(FAR PASCAL *GETDATAPROC)(LPOLEOBJECT, OLECLIPFORMAT, HANDLE FAR *);
typedef OLESTATUS(FAR PASCAL *DRAWPROC)(LPOLEOBJECT, HDC, RECT FAR *, RECT FAR *, HDC);
typedef OLESTATUS(FAR PASCAL *COPYPROC)(LPOLEOBJECT);
typedef void(FAR PASCAL *SETPROC)(int, LPOLECLIENT, LHCLIENTDOC, LPOLEOBJECT FAR *);
typedef int(FAR PASCAL *TAKEPROC)(LPSTR, int);
typedef int(FAR PASCAL *TABLEPROC)(LPOLEOBJECT);

static HWND window;
static HINSTANCE self;
static HINSTANCE ole;
static HINSTANCE handler;
static FARPROC procs[1100];
static FARPROC hndBounds;
static SETPROC hndSet;
static TAKEPROC hndTake;
static TABLEPROC hndTable;
static int ticks;
static int released;
static UINT cfNative;
static UINT cfOwnerLink;
static UINT cfObjectLink;
static LHCLIENTDOC doc;
static LPOLEOBJECT object;
static LPOLEOBJECT other;

static unsigned char far *buffer;
static DWORD length;
static DWORD readAt;

typedef struct {
    LPOLESTREAMVTBL lpstbl;
} STREAM;

static OLESTREAMVTBL streamTable;
static STREAM stream;
static OLECLIENTVTBL clientTable;
static OLECLIENT client;
static char bmp[OLEBMP_SIZE];

DWORD CALLBACK __export StreamGet(LPOLESTREAM me, void FAR *into, DWORD count)
{
    DWORD i;
    unsigned char far *bytes = (unsigned char far *)into;

    (void)me;

    if (readAt + count > length) {
        count = readAt < length ? length - readAt : 0;
    }

    for (i = 0; i < count; i++) bytes[i] = buffer[(unsigned)(readAt + i)];

    readAt += count;

    return count;
}

DWORD CALLBACK __export StreamPut(LPOLESTREAM me, OLE_CONST void FAR *from, DWORD count)
{
    (void)me;
    (void)from;

    return count;
}

int CALLBACK __export ClientCallBack(LPOLECLIENT me, OLE_NOTIFICATION what, LPOLEOBJECT from)
{
    (void)me;

    if (what == OLE_QUERY_PAINT) {
        return 1;
    }

    wsprintf(probeArgs, "%d,%s", (int)what, from ? "object" : "0");
    probe("CallBack", probeArgs, "");

    if (what == OLE_RELEASE) {
        released++;
    }

    return 1;
}

LONG FAR PASCAL __export Proc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_TIMER) {
        ticks++;
        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

/* Messages handled until the object is told its release, or 20 ticks of a half-second timer. */
static void settle(LPCSTR what, LPOLEOBJECT FAR *made, OLESTATUS answer)
{
    MSG msg;

    if (answer != OLE_WAIT_FOR_RELEASE) {
        return;
    }

    ticks = 0;
    SetTimer(window, 1, 500, NULL);

    while (!released && ticks < 20) {
        if (GetMessage(&msg, NULL, 0, 0)) {
            TranslateMessage(&msg);
            DispatchMessage(&msg);
        }
    }

    KillTimer(window, 1);
    wsprintf(probeResult, "%s %u %u", released ? "released" : "timeout",
             *made ? (unsigned)OleQueryReleaseStatus(*made) : 0,
             *made ? (unsigned)OleQueryReleaseError(*made) : 0);
    probe("settle", what, probeResult);
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

/* What the handler wrote down since last asked. */
static void take(LPCSTR what)
{
    char log[1500];

    log[0] = 0;

    if (hndTake) {
        hndTake(log, sizeof log);
    }

    probe("handler", what, log);
}

/* How many hold the handler's library. */
static void usage(LPCSTR what)
{
    wsprintf(probeResult, "%d", GetModuleUsage(handler));
    probe("usage", what, probeResult);
}

static void reg(LPCSTR key, LPCSTR value)
{
    wsprintf(probeResult, "%ld", RegSetValue(HKEY_CLASSES_ROOT, key, REG_SZ, value, lstrlen(value)));
    probe("RegSetValue", key, probeResult);
}

/* Streams. */

static unsigned at;

static void putLong(DWORD value)
{
    buffer[at++] = (unsigned char)value;
    buffer[at++] = (unsigned char)(value >> 8);
    buffer[at++] = (unsigned char)(value >> 16);
    buffer[at++] = (unsigned char)(value >> 24);
}

static void putString(LPCSTR text)
{
    unsigned count = lstrlen(text) + 1;
    unsigned i;

    putLong(count);

    for (i = 0; i < count; i++) buffer[at++] = text[i];
}

static void putBytes(const char far *bytes, unsigned count)
{
    unsigned i;

    putLong(count);

    for (i = 0; i < count; i++) buffer[at++] = bytes[i];
}

/* A picture as a stream's presentation holds one: 0501h, 5, `METAFILEPICT`, its extents, its METAFILEPICT and metafile. */
static void putPicture(void)
{
    HDC meta = CreateMetaFile(NULL);
    HMETAFILE done;
    HGLOBAL bits;
    LPBYTE bytes;
    DWORD size;
    DWORD i;

    SetWindowOrg(meta, 0, 0);
    SetWindowExt(meta, 100, 50);
    Rectangle(meta, 0, 0, 100, 50);
    Ellipse(meta, 10, 10, 60, 40);
    done = CloseMetaFile(meta);
    bits = GetMetaFileBits(done);
    bytes = (LPBYTE)GlobalLock(bits);
    size = 2 * ((DWORD)bytes[6] | (DWORD)bytes[7] << 8 | (DWORD)bytes[8] << 16);

    putLong(0x0501L);
    putLong(5L);
    putString("METAFILEPICT");
    putLong(2000L);
    putLong((DWORD)-1000L);
    putLong(size + 8);
    buffer[at++] = MM_ANISOTROPIC;
    buffer[at++] = 0;
    buffer[at++] = 0xd0;
    buffer[at++] = 0x07;
    buffer[at++] = 0xe8;
    buffer[at++] = 0x03;
    buffer[at++] = 0;
    buffer[at++] = 0;

    for (i = 0; i < size; i++) buffer[at++] = bytes[(unsigned)i];

    GlobalUnlock(bits);
    DeleteMetaFile(SetMetaFileBits(bits));
}

/* A presentation of another format, as a stream holds one: 0501h, 5, the class, nought and the format's name, its data. */
static void putNativePresentation(LPCSTR klass)
{
    putLong(0x0501L);
    putLong(5L);
    putString(klass);
    putLong(0L);
    putString("Native");
    putBytes(bmp, OLEBMP_SIZE);
}

/* The presentations a stream is made with: none, a picture, the class's `Native`. */
#define NONE 0
#define PICTURE 1
#define NATIVE 2

static void presentation(LPCSTR klass, int kind)
{
    if (kind == PICTURE) {
        putPicture();
    } else if (kind == NATIVE) {
        putNativePresentation(klass);
    } else {
        putLong(0x0501L);
        putLong(0L);
    }
}

/* Where the class's name ends: what OLECLI has read before its handler is called. */
static unsigned afterClass;

static void makeEmbedded(LPCSTR klass, int kind)
{
    char native[32];
    int i;

    for (i = 0; i < 32; i++) native[i] = (char)(0x40 + i);

    at = 0;
    putLong(0x0501L);
    putLong(2L);
    putString(klass);
    afterClass = at;
    putString("");
    putString("");

    if (!lstrcmp(klass, "PBrush")) {
        putBytes(bmp, OLEBMP_SIZE);
    } else {
        putBytes(native, 32);
    }

    presentation(klass, kind);
    length = at;
}

static void makeLinked(LPCSTR klass, int kind)
{
    at = 0;
    putLong(0x0501L);
    putLong(1L);
    putString(klass);
    afterClass = at;
    putString(FILE_NAME);
    putString("1 1 10 10");
    putString("");
    putLong(0L);
    putLong(0L);
    presentation(klass, kind);
    length = at;
}

/* What is asked of an object. */

static void vtbl(LPCSTR what, LPOLEOBJECT made)
{
    FARPROC FAR *table;
    LPSTR out = probeResult;
    int i;
    int k;

    if (!made) {
        probe("vtbl", what, "none");
        return;
    }

    table = (FARPROC FAR *)made->lpvtbl;

    for (i = 0; i < 39; i++) {
        for (k = 1; k < 1100; k++) {
            if (procs[k] && procs[k] == table[i]) {
                break;
            }
        }

        if (k < 1100) {
            out += wsprintf(out, "%d,", k);
        } else if (hndBounds && table[i] == hndBounds) {
            out += wsprintf(out, "H,");
        } else {
            out += wsprintf(out, "?,");
        }
    }

    probe("vtbl", what, probeResult);
}

/* A block's bytes, as many as were put in it at most. */
static LPSTR blockBytes(LPSTR out, HANDLE data, DWORD most)
{
    LPBYTE bytes = (LPBYTE)GlobalLock(data);
    DWORD i;

    for (i = 0; i < most && i < 24; i++) {
        out += wsprintf(out, " %02x", bytes[(unsigned)i]);
    }

    GlobalUnlock(data);
    return out;
}

/* `OwnerLink` or `ObjectLink`: its three strings. */
static LPSTR linkText(LPSTR out, HANDLE data)
{
    LPSTR text = (LPSTR)GlobalLock(data);
    int i;

    for (i = 0; i < 3; i++) {
        out += wsprintf(out, " %s", text);
        text += lstrlen(text) + 1;
    }

    GlobalUnlock(data);
    return out;
}

static LPSTR dataText(LPSTR out, UINT format, HANDLE data)
{
    if (format == CF_METAFILEPICT) {
        LPMETAFILEPICT picture = (LPMETAFILEPICT)GlobalLock(data);

        out += wsprintf(out, " %d %d %d", picture->mm, picture->xExt, picture->yExt);
        GlobalUnlock(data);
        return out;
    }

    if (format == cfOwnerLink || format == cfObjectLink) {
        return linkText(out, data);
    }

    if (format == cfNative) {
        return blockBytes(out, data, 16);
    }

    return out;
}

/* The pixels of a 64 by 32 bitmap an object is drawn into, summed. */
static void drawn(LPCSTR what, LPOLEOBJECT made, DRAWPROC draw)
{
    HDC screen = GetDC(NULL);
    HDC memory = CreateCompatibleDC(screen);
    HBITMAP bitmap = CreateCompatibleBitmap(screen, 64, 32);
    HBITMAP old = SelectObject(memory, bitmap);
    RECT bounds;
    OLESTATUS answer;
    DWORD sum = 0;
    int x;
    int y;

    PatBlt(memory, 0, 0, 64, 32, WHITENESS);
    SetRect(&bounds, 4, 2, 60, 30);
    answer = draw ? draw(made, memory, &bounds, NULL, NULL)
                  : OleDraw(made, memory, &bounds, NULL, NULL);

    for (y = 0; y < 32; y++) {
        for (x = 0; x < 64; x++) {
            sum = sum * 31 + (GetPixel(memory, x, y) & 0xffffffL);
        }
    }

    wsprintf(probeResult, "%u %08lx", (unsigned)answer, sum);
    probe(draw ? "PbDraw" : "OleDraw", what, probeResult);
    SelectObject(memory, old);
    DeleteObject(bitmap);
    DeleteDC(memory);
    ReleaseDC(NULL, screen);
}

static void formats(LPCSTR what)
{
    UINT format = 0;
    LPSTR out = probeResult;

    *out = 0;
    OpenClipboard(window);

    while ((format = EnumClipboardFormats(format)) != 0) {
        out = formatText(out, format);
        *out++ = ',';
        *out = 0;
    }

    CloseClipboard();
    probe("formats", what, probeResult);
}

static void queries(LPCSTR what, LPOLEOBJECT made)
{
    LONG type = -1;
    RECT bounds;
    OLECLIPFORMAT format;
    DWORD size = 0;
    char name[64];
    UINT count;
    LPSTR out;
    OLESTATUS answer;

    answer = OleQueryType(made, &type);
    wsprintf(probeResult, "%u %ld", (unsigned)answer, type);
    probe("OleQueryType", what, probeResult);

    SetRect(&bounds, -1, -1, -1, -1);
    answer = OleQueryBounds(made, &bounds);
    wsprintf(probeResult, "%u %d,%d,%d,%d", (unsigned)answer, bounds.left, bounds.top, bounds.right,
             bounds.bottom);
    probe("OleQueryBounds", what, probeResult);

    out = probeResult;
    format = 0;

    do {
        format = OleEnumFormats(made, format);
        out = formatText(out, format);
        *out++ = ',';
        *out = 0;
    } while (format && out - probeResult < 200);

    probe("OleEnumFormats", what, probeResult);

    answer = OleQuerySize(made, &size);
    wsprintf(probeResult, "%u %lu", (unsigned)answer, size);
    probe("OleQuerySize", what, probeResult);

    count = sizeof name;
    lstrcpy(name, "?");
    answer = OleQueryName(made, name, &count);
    wsprintf(probeResult, "%u %s", (unsigned)answer, (LPSTR)name);
    probe("OleQueryName", what, probeResult);
}

static void getData(LPCSTR what, LPOLEOBJECT made, GETDATAPROC get)
{
    OLECLIPFORMAT format = 0;
    HANDLE data;
    OLESTATUS answer;
    LPSTR out;

    while ((format = OleEnumFormats(made, format)) != 0) {
        data = 0;
        answer = get ? get(made, format, &data) : OleGetData(made, format, &data);
        out = probeArgs + wsprintf(probeArgs, "%s,", what);
        formatText(out, format);
        out = probeResult + wsprintf(probeResult, "%u %s", (unsigned)answer, data ? "handle" : "0");

        if (answer <= OLE_WARN_DELETE_DATA && data) {
            dataText(out, format, data);
        }

        probe(get ? "PbGetData" : "OleGetData", probeArgs, probeResult);
    }
}

static void made(LPCSTR function, LPCSTR what, OLESTATUS answer, LPOLEOBJECT FAR *out)
{
    wsprintf(probeResult, "%u %s", (unsigned)answer, *out ? "object" : "0");
    probe(function, what, probeResult);
    settle(what, out, answer);
}

static void loaded(LPCSTR what, OLESTATUS answer)
{
    wsprintf(probeResult, "%u %s %lu", (unsigned)answer, object ? "object" : "0", readAt);
    probe("OleLoadFromStream", what, probeResult);
}

static void releaseObject(LPCSTR what, LPOLEOBJECT FAR *which)
{
    OLESTATUS answer;

    if (!*which) {
        return;
    }

    released = 0;
    answer = OleRelease(*which);
    wsprintf(probeResult, "%u", (unsigned)answer);
    probe("OleRelease", what, probeResult);
    *which = NULL;
}

/* The clipboard as a server leaves it: `Native`, `OwnerLink` and a picture, then `ObjectLink`. */
static void clipboard(LPCSTR klass, int picture)
{
    char owner[80];
    int n;
    HGLOBAL block;
    LPSTR into;
    char native[32];
    int i;

    for (i = 0; i < 32; i++) native[i] = (char)(0x60 + i);

    n = wsprintf(owner, "%s", klass) + 1;
    n += wsprintf(owner + n, "%s", (LPSTR)FILE_NAME) + 1;
    n += wsprintf(owner + n, "Item") + 1;
    owner[n++] = 0;

    OpenClipboard(window);
    EmptyClipboard();

    if (!lstrcmp(klass, "PBrush")) {
        block = GlobalAlloc(GMEM_MOVEABLE | GMEM_DDESHARE, OLEBMP_SIZE);
        into = (LPSTR)GlobalLock(block);

        for (i = 0; i < OLEBMP_SIZE; i++) into[i] = bmp[i];
    } else {
        block = GlobalAlloc(GMEM_MOVEABLE | GMEM_DDESHARE, 32);
        into = (LPSTR)GlobalLock(block);

        for (i = 0; i < 32; i++) into[i] = native[i];
    }

    GlobalUnlock(block);
    SetClipboardData(cfNative, block);

    for (i = 0; i < 2; i++) {
        block = GlobalAlloc(GMEM_MOVEABLE | GMEM_DDESHARE, n);
        into = (LPSTR)GlobalLock(block);
        hmemcpy(into, owner, n);
        GlobalUnlock(block);
        SetClipboardData(i ? cfObjectLink : cfOwnerLink, block);

        if (!i && picture) {
            HDC meta = CreateMetaFile(NULL);
            LPMETAFILEPICT p;

            SetWindowOrg(meta, 0, 0);
            SetWindowExt(meta, 100, 50);
            Rectangle(meta, 0, 0, 100, 50);
            block = GlobalAlloc(GMEM_MOVEABLE | GMEM_DDESHARE, sizeof(METAFILEPICT));
            p = (LPMETAFILEPICT)GlobalLock(block);
            p->mm = MM_ANISOTROPIC;
            p->xExt = 2000;
            p->yExt = 1000;
            p->hMF = CloseMetaFile(meta);
            GlobalUnlock(block);
            SetClipboardData(CF_METAFILEPICT, block);
        }
    }

    CloseClipboard();
    formats(klass);
}

/* What each section's object is asked once made. */
static void look(LPCSTR what, LPOLEOBJECT made)
{
    if (!made) {
        return;
    }

    vtbl(what, made);
    queries(what, made);
}

/* The sections. */

static void viaHandler(void)
{
    LPOLEOBJECT copy = NULL;
    OLESTATUS answer;

    probeNote("handler");
    hndSet(0, &client, doc, &object);
    usage("start");

    makeEmbedded("OleHnd", PICTURE);
    readAt = 0;
    answer = OleLoadFromStream((LPOLESTREAM)&stream, "StdFileEditing", &client, doc, "Obj1",
                               &object);
    loaded("embedded", answer);
    take("embedded");
    usage("embedded");
    look("embedded", object);

    if (object) {
        hndSet(0, &client, doc, &copy);
        answer = OleClone(object, &client, doc, "Copy1", &copy);
        made("OleClone", "embedded", answer, &copy);
        take("clone");
        usage("clone");
        vtbl("clone", copy);
        releaseObject("clone", &copy);
        usage("clone released");
    }

    releaseObject("embedded", &object);
    usage("embedded released");

    hndSet(0, &client, doc, &object);
    makeLinked("OleHnd", PICTURE);
    readAt = 0;
    answer = OleLoadFromStream((LPOLESTREAM)&stream, "StdFileEditing", &client, doc, "Obj2",
                               &object);
    loaded("linked", answer);
    take("linked");
    look("linked", object);
    releaseObject("linked", &object);

    clipboard("OleHnd", 1);
    OpenClipboard(window);
    answer = OleCreateFromClip("StdFileEditing", &client, doc, "Clip1", &object, olerender_draw, 0);
    made("OleCreateFromClip", "draw", answer, &object);
    take("clip draw");
    look("clip draw", object);
    releaseObject("clip draw", &object);
    answer = OleCreateFromClip("StdFileEditing", &client, doc, "Clip2", &object, olerender_none, 0);
    made("OleCreateFromClip", "none", answer, &object);
    take("clip none");
    look("clip none", object);
    releaseObject("clip none", &object);
    answer = OleCreateFromClip("StdFileEditing", &client, doc, "Clip3", &object, olerender_format,
                               CF_METAFILEPICT);
    made("OleCreateFromClip", "format", answer, &object);
    take("clip format");
    releaseObject("clip format", &object);
    answer =
        OleCreateLinkFromClip("StdFileEditing", &client, doc, "Clip4", &object, olerender_draw, 0);
    made("OleCreateLinkFromClip", "draw", answer, &object);
    take("link clip");
    look("link clip", object);
    releaseObject("link clip", &object);
    CloseClipboard();

    released = 0;
    answer = OleCreate("StdFileEditing", &client, "OleHnd", doc, "Obj3", &object, olerender_draw, 0);
    made("OleCreate", "OleHnd", answer, &object);
    take("create");
    releaseObject("create", &object);

    released = 0;
    answer = OleCreateFromTemplate("StdFileEditing", &client, FILE_NAME, doc, "Obj4", &object,
                                   olerender_draw, 0);
    made("OleCreateFromTemplate", "OleHnd", answer, &object);
    take("template");
    releaseObject("template", &object);

    released = 0;
    answer = OleCreateFromFile("StdFileEditing", &client, "OleHnd", FILE_NAME, doc, "Obj5",
                               &object, olerender_draw, 0);
    made("OleCreateFromFile", "OleHnd", answer, &object);
    take("from file");
    releaseObject("from file", &object);

    released = 0;
    answer = OleCreateLinkFromFile("StdFileEditing", &client, "OleHnd", FILE_NAME, "Item", doc,
                                   "Obj6", &object, olerender_draw, 0);
    made("OleCreateLinkFromFile", "OleHnd", answer, &object);
    take("link file");
    releaseObject("link file", &object);

    released = 0;
    answer = OleCreateInvisible("StdFileEditing", &client, "OleHnd", doc, "Obj7", &object,
                                olerender_draw, 0, FALSE);
    made("OleCreateInvisible", "hidden", answer, &object);
    take("invisible");
    look("invisible", object);
    releaseObject("invisible", &object);

    released = 0;
    answer = OleCreateInvisible("StdFileEditing", &client, "OleHnd", doc, "Obj8", &object,
                                olerender_draw, 0, TRUE);
    made("OleCreateInvisible", "activate", answer, &object);
    take("invisible activate");
    releaseObject("invisible activate", &object);

    usage("handler end");
}

static void refuse(void)
{
    OLESTATUS answer;

    probeNote("refuse");
    hndSet(1, &client, doc, &object);
    makeEmbedded("OleHnd", PICTURE);
    readAt = 0;
    object = (LPOLEOBJECT)1L;
    answer = OleLoadFromStream((LPOLESTREAM)&stream, "StdFileEditing", &client, doc, "Ref1",
                               &object);
    loaded("refused", answer);
    take("refused");

    if (object == (LPOLEOBJECT)1L) {
        probe("out", "refused", "untouched");
        object = NULL;
    }

    releaseObject("refused", &object);

    clipboard("OleHnd", 1);
    OpenClipboard(window);
    answer = OleCreateFromClip("StdFileEditing", &client, doc, "Ref2", &object, olerender_draw, 0);
    made("OleCreateFromClip", "refused", answer, &object);
    take("refused clip");
    releaseObject("refused clip", &object);
    CloseClipboard();

    answer = OleCreateInvisible("StdFileEditing", &client, "OleHnd", doc, "Ref3", &object,
                                olerender_draw, 0, FALSE);
    made("OleCreateInvisible", "refused", answer, &object);
    take("refused invisible");
    releaseObject("refused invisible", &object);
    hndSet(0, &client, doc, &object);
}

static void override(void)
{
    OLESTATUS answer;
    RECT bounds;

    probeNote("override");
    hndSet(2, &client, doc, &object);
    makeEmbedded("OleHnd", PICTURE);
    readAt = 0;
    answer = OleLoadFromStream((LPOLESTREAM)&stream, "StdFileEditing", &client, doc, "Ovr1",
                               &object);
    loaded("override", answer);
    take("override");
    vtbl("override", object);

    if (object) {
        SetRect(&bounds, -1, -1, -1, -1);
        answer = OleQueryBounds(object, &bounds);
        wsprintf(probeResult, "%u %d,%d,%d,%d", (unsigned)answer, bounds.left, bounds.top,
                 bounds.right, bounds.bottom);
        probe("OleQueryBounds", "override", probeResult);
        take("override bounds");
    }

    makeEmbedded("OleHndNone", PICTURE);
    readAt = 0;
    answer = OleLoadFromStream((LPOLESTREAM)&stream, "StdFileEditing", &client, doc, "Ovr2",
                               &other);
    loaded("other", answer);
    take("other");

    if (other) {
        wsprintf(probeResult, "%d", hndTable(other));
        probe("table", "other", probeResult);
        vtbl("other", other);
        SetRect(&bounds, -1, -1, -1, -1);
        answer = OleQueryBounds(other, &bounds);
        wsprintf(probeResult, "%u %d,%d,%d,%d", (unsigned)answer, bounds.left, bounds.top,
                 bounds.right, bounds.bottom);
        probe("OleQueryBounds", "other", probeResult);
        take("other bounds");
    }

    hndSet(3, &client, doc, &object);
    vtbl("restored", object);
    releaseObject("override", &object);
    releaseObject("other", &other);
}

/* A class's atom added twice: one for a default to take, one the probe lets go after. */
static ATOM twice(LPCSTR name)
{
    GlobalAddAtom(name);
    return GlobalAddAtom(name);
}

/* Once the object is let go, the probe's own let go: whether the atom is still there. */
static void owned(LPCSTR what, ATOM atom, LPCSTR name)
{
    GlobalDeleteAtom(atom);
    probe("atom", what, GlobalFindAtom(name) ? "left" : "gone");

    while (GlobalFindAtom(name)) {
        GlobalDeleteAtom(GlobalFindAtom(name));
    }
}

static void defaults(void)
{
    OLESTATUS answer;
    ATOM klass;
    LOADPROC load = (LOADPROC)GetProcAddress(ole, "DefLoadFromStream");
    CLIPPROC fromClip = (CLIPPROC)GetProcAddress(ole, "DefCreateFromClip");
    LINKCLIPPROC linkClip = (LINKCLIPPROC)GetProcAddress(ole, "DefCreateLinkFromClip");
    CREATEPROC create = (CREATEPROC)GetProcAddress(ole, "DefCreate");
    CREATEPROC template = (CREATEPROC)GetProcAddress(ole, "DefCreateFromTemplate");
    FILEPROC fromFile = (FILEPROC)GetProcAddress(ole, "DefCreateFromFile");
    LINKFILEPROC linkFile = (LINKFILEPROC)GetProcAddress(ole, "DefCreateLinkFromFile");
    INVISIBLEPROC invisible = (INVISIBLEPROC)GetProcAddress(ole, "DefCreateInvisible");
    LEINVISIBLEPROC leInvisible = (LEINVISIBLEPROC)GetProcAddress(ole, "LeCreateInvisible");

    probeNote("def");
    wsprintf(probeResult, "%d%d%d%d%d%d%d%d%d", load != NULL, fromClip != NULL, linkClip != NULL,
             create != NULL, template != NULL, fromFile != NULL, linkFile != NULL,
             invisible != NULL, leInvisible != NULL);
    probe("GetProcAddress", "Def", probeResult);

    makeEmbedded("OleHndNone", PICTURE);
    readAt = afterClass;
    klass = twice("OleHndNone");
    answer = load((LPOLESTREAM)&stream, "StdFileEditing", &client, doc, "Def1", &object,
                  OT_EMBEDDED, klass, 0);
    wsprintf(probeResult, "%u %s %lu", (unsigned)answer, object ? "object" : "0", readAt);
    probe("DefLoadFromStream", "embedded", probeResult);
    look("def embedded", object);
    releaseObject("def embedded", &object);
    owned("def embedded", klass, "OleHndNone");

    makeLinked("OleHndNone", PICTURE);
    readAt = afterClass;
    klass = twice("OleHndNone");
    answer = load((LPOLESTREAM)&stream, "StdFileEditing", &client, doc, "Def2", &object, OT_LINK,
                  klass, 0);
    wsprintf(probeResult, "%u %s %lu", (unsigned)answer, object ? "object" : "0", readAt);
    probe("DefLoadFromStream", "linked", probeResult);
    look("def linked", object);
    releaseObject("def linked", &object);
    owned("def linked", klass, "OleHndNone");

    makeEmbedded("OleHndNone", PICTURE);
    readAt = afterClass;
    klass = twice("OleHndNone");
    answer = load((LPOLESTREAM)&stream, "Static", &client, doc, "Def3", &object, OT_EMBEDDED, klass,
                  0);
    wsprintf(probeResult, "%u %s %lu", (unsigned)answer, object ? "object" : "0", readAt);
    probe("DefLoadFromStream", "static", probeResult);
    releaseObject("def static", &object);
    owned("def static", klass, "OleHndNone");

    clipboard("OleHndNone", 1);
    OpenClipboard(window);
    answer = fromClip("StdFileEditing", &client, doc, "Def4", &object, olerender_draw, 0,
                      OT_EMBEDDED);
    made("DefCreateFromClip", "draw", answer, &object);
    look("def clip", object);
    releaseObject("def clip", &object);
    answer = linkClip("StdFileEditing", &client, doc, "Def5", &object, olerender_draw, 0);
    made("DefCreateLinkFromClip", "draw", answer, &object);
    look("def link clip", object);
    releaseObject("def link clip", &object);
    CloseClipboard();

    answer = invisible("StdFileEditing", &client, "OleHndNone", doc, "Def6", &object,
                       olerender_draw, 0, FALSE);
    made("DefCreateInvisible", "hidden", answer, &object);
    look("def invisible", object);
    releaseObject("def invisible", &object);

    answer = invisible("Static", &client, "OleHndNone", doc, "Def7", &object, olerender_draw, 0,
                       FALSE);
    made("DefCreateInvisible", "static", answer, &object);
    releaseObject("def invisible static", &object);

    answer = leInvisible(&client, "OleHndNone", doc, "Le1", &object, olerender_draw, 0, FALSE);
    made("LeCreateInvisible", "hidden", answer, &object);
    look("le invisible", object);
    releaseObject("le invisible", &object);

    answer = leInvisible(&client, "OleHndNone", doc, "Le2", &object, olerender_none, 0, FALSE);
    made("LeCreateInvisible", "none", answer, &object);
    look("le invisible none", object);
    releaseObject("le invisible none", &object);

    released = 0;
    answer = leInvisible(&client, "OleHndNone", doc, "Le3", &object, olerender_draw, 0, TRUE);
    made("LeCreateInvisible", "activate", answer, &object);
    releaseObject("le invisible activate", &object);

    released = 0;
    answer = create("StdFileEditing", &client, "OleHndNone", doc, "Def8", &object, olerender_draw,
                    0);
    made("DefCreate", "OleHndNone", answer, &object);
    releaseObject("def create", &object);

    released = 0;
    answer = template("StdFileEditing", &client, FILE_NAME, doc, "Def9", &object, olerender_draw, 0);
    made("DefCreateFromTemplate", "OleHndNone", answer, &object);
    releaseObject("def template", &object);

    released = 0;
    answer = fromFile("StdFileEditing", &client, "OleHndNone", FILE_NAME, doc, "Def10", &object,
                      olerender_draw, 0);
    made("DefCreateFromFile", "OleHndNone", answer, &object);
    releaseObject("def from file", &object);

    released = 0;
    answer = linkFile("StdFileEditing", &client, "OleHndNone", FILE_NAME, "Item", doc, "Def11",
                      &object, olerender_draw, 0);
    made("DefCreateLinkFromFile", "OleHndNone", answer, &object);
    releaseObject("def link file", &object);
}

/* The `Pb` methods called directly, beside the `Ole` functions. */
static void pbMethods(LPCSTR what, LPOLEOBJECT made)
{
    BOUNDSPROC bounds = (BOUNDSPROC)GetProcAddress(ole, "PbQueryBounds");
    ENUMPROC enumFormats = (ENUMPROC)GetProcAddress(ole, "PbEnumFormats");
    GETDATAPROC getOne = (GETDATAPROC)GetProcAddress(ole, "PbGetData");
    DRAWPROC draw = (DRAWPROC)GetProcAddress(ole, "PbDraw");
    COPYPROC copy = (COPYPROC)GetProcAddress(ole, "PbCopyToClipboard");
    RECT rect;
    OLESTATUS answer;
    OLECLIPFORMAT format = 0;
    LPSTR out = probeResult;

    SetRect(&rect, -1, -1, -1, -1);
    answer = bounds(made, &rect);
    wsprintf(probeResult, "%u %d,%d,%d,%d", (unsigned)answer, rect.left, rect.top, rect.right,
             rect.bottom);
    probe("PbQueryBounds", what, probeResult);

    do {
        format = enumFormats(made, format);
        out = formatText(out, format);
        *out++ = ',';
        *out = 0;
    } while (format && out - probeResult < 200);

    probe("PbEnumFormats", what, probeResult);
    getData(what, made, getOne);
    drawn(what, made, draw);
    drawn(what, made, NULL);

    OpenClipboard(window);
    EmptyClipboard();
    wsprintf(probeResult, "%u", (unsigned)copy(made));
    probe("PbCopyToClipboard", what, probeResult);
    CloseClipboard();
    formats(what);

    OpenClipboard(window);
    EmptyClipboard();
    wsprintf(probeResult, "%u", (unsigned)OleCopyToClipboard(made));
    probe("OleCopyToClipboard", what, probeResult);
    CloseClipboard();
    formats(what);
}

/* Whether two objects hold the same method table. */
static void sameTable(LPCSTR what, LPOLEOBJECT a, LPOLEOBJECT b)
{
    if (a && b) {
        probe("same table", what, a->lpvtbl == b->lpvtbl ? "yes" : "no");
    }
}

static void paintbrush(void)
{
    OLESTATUS answer;
    ATOM klass;
    LOADPROC load = (LOADPROC)GetProcAddress(ole, "PbLoadFromStream");
    CLIPPROC fromClip = (CLIPPROC)GetProcAddress(ole, "PbCreateFromClip");
    LINKCLIPPROC linkClip = (LINKCLIPPROC)GetProcAddress(ole, "PbCreateLinkFromClip");
    CREATEPROC create = (CREATEPROC)GetProcAddress(ole, "PbCreate");
    CREATEPROC template = (CREATEPROC)GetProcAddress(ole, "PbCreateFromTemplate");
    FILEPROC fromFile = (FILEPROC)GetProcAddress(ole, "PbCreateFromFile");
    LINKFILEPROC linkFile = (LINKFILEPROC)GetProcAddress(ole, "PbCreateLinkFromFile");
    INVISIBLEPROC invisible = (INVISIBLEPROC)GetProcAddress(ole, "PbCreateInvisible");

    probeNote("pb");

    makeEmbedded("PBrush", NONE);
    readAt = 0;
    answer = OleLoadFromStream((LPOLESTREAM)&stream, "StdFileEditing", &client, doc, "Pb1",
                               &object);
    loaded("bare", answer);
    look("bare", object);
    getData("bare", object, NULL);

    if (object) {
        pbMethods("bare", object);
    }

    makeEmbedded("PBrush", NONE);
    readAt = 0;
    answer = OleLoadFromStream((LPOLESTREAM)&stream, "StdFileEditing", &client, doc, "Pb2",
                               &other);
    loaded("bare again", answer);
    sameTable("bare", object, other);
    releaseObject("bare again", &other);

    makeEmbedded("PBrush", PICTURE);
    readAt = 0;
    answer = OleLoadFromStream((LPOLESTREAM)&stream, "StdFileEditing", &client, doc, "Pb3",
                               &other);
    loaded("picture", answer);
    look("picture", other);
    sameTable("bare, picture", object, other);
    drawn("picture", other, NULL);
    releaseObject("picture", &other);
    releaseObject("bare", &object);

    makeLinked("PBrush", NATIVE);
    readAt = 0;
    answer = OleLoadFromStream((LPOLESTREAM)&stream, "StdFileEditing", &client, doc, "Pb4",
                               &object);
    loaded("link native", answer);
    look("link native", object);
    getData("link native", object, NULL);
    drawn("link native", object, NULL);
    releaseObject("link native", &object);

    makeLinked("PBrush", PICTURE);
    readAt = 0;
    answer = OleLoadFromStream((LPOLESTREAM)&stream, "StdFileEditing", &client, doc, "Pb5",
                               &object);
    loaded("link picture", answer);
    look("link picture", object);
    releaseObject("link picture", &object);

    makeLinked("PBrush", NONE);
    readAt = 0;
    answer = OleLoadFromStream((LPOLESTREAM)&stream, "StdFileEditing", &client, doc, "Pb6",
                               &object);
    loaded("link none", answer);
    look("link none", object);
    releaseObject("link none", &object);

    clipboard("PBrush", 1);
    OpenClipboard(window);
    answer = OleCreateFromClip("StdFileEditing", &client, doc, "Pb7", &object, olerender_draw, 0);
    made("OleCreateFromClip", "PBrush", answer, &object);
    look("clip", object);
    releaseObject("clip", &object);
    answer =
        OleCreateLinkFromClip("StdFileEditing", &client, doc, "Pb8", &object, olerender_draw, 0);
    made("OleCreateLinkFromClip", "PBrush", answer, &object);
    look("link clip", object);
    releaseObject("link clip", &object);
    answer = fromClip("StdFileEditing", &client, doc, "Pb9", &object, olerender_draw, 0,
                      OT_EMBEDDED);
    made("PbCreateFromClip", "draw", answer, &object);
    look("pb clip", object);
    releaseObject("pb clip", &object);
    answer = linkClip("StdFileEditing", &client, doc, "Pb10", &object, olerender_draw, 0);
    made("PbCreateLinkFromClip", "draw", answer, &object);
    look("pb link clip", object);
    releaseObject("pb link clip", &object);
    CloseClipboard();

    makeEmbedded("PBrush", PICTURE);
    readAt = afterClass;
    klass = twice("PBrush");
    answer = load((LPOLESTREAM)&stream, "StdFileEditing", &client, doc, "Pb11", &object,
                  OT_EMBEDDED, klass, 0);
    wsprintf(probeResult, "%u %s %lu", (unsigned)answer, object ? "object" : "0", readAt);
    probe("PbLoadFromStream", "picture", probeResult);
    look("pb load picture", object);
    releaseObject("pb load picture", &object);
    owned("pb load picture", klass, "PBrush");

    makeEmbedded("PBrush", NONE);
    readAt = afterClass;
    klass = twice("PBrush");
    answer = load((LPOLESTREAM)&stream, "StdFileEditing", &client, doc, "Pb12", &object,
                  OT_EMBEDDED, klass, 0);
    wsprintf(probeResult, "%u %s %lu", (unsigned)answer, object ? "object" : "0", readAt);
    probe("PbLoadFromStream", "bare", probeResult);
    look("pb load bare", object);
    releaseObject("pb load bare", &object);
    owned("pb load bare", klass, "PBrush");

    answer = invisible("StdFileEditing", &client, "PBrush", doc, "Pb13", &object, olerender_draw,
                       0, FALSE);
    made("PbCreateInvisible", "hidden", answer, &object);
    look("pb invisible", object);
    releaseObject("pb invisible", &object);

    answer = OleCreateInvisible("StdFileEditing", &client, "PBrush", doc, "Pb14", &object,
                                olerender_draw, 0, FALSE);
    made("OleCreateInvisible", "PBrush", answer, &object);
    look("invisible", object);
    releaseObject("invisible", &object);

    released = 0;
    answer = create("StdFileEditing", &client, "PBrush", doc, "Pb15", &object, olerender_draw, 0);
    made("PbCreate", "PBrush", answer, &object);
    releaseObject("pb create", &object);

    released = 0;
    answer = template("StdFileEditing", &client, FILE_NAME, doc, "Pb16", &object, olerender_draw, 0);
    made("PbCreateFromTemplate", "PBrush", answer, &object);
    releaseObject("pb template", &object);

    released = 0;
    answer = fromFile("StdFileEditing", &client, "PBrush", FILE_NAME, doc, "Pb17", &object,
                      olerender_draw, 0);
    made("PbCreateFromFile", "PBrush", answer, &object);
    releaseObject("pb from file", &object);

    released = 0;
    answer = linkFile("StdFileEditing", &client, "PBrush", FILE_NAME, "Item", doc, "Pb18", &object,
                      olerender_draw, 0);
    made("PbCreateLinkFromFile", "PBrush", answer, &object);
    releaseObject("pb link file", &object);

}

static void run(void)
{
    OLESTATUS answer;
    HFILE file;
    int i;

    reg("OleHnd", "OLE handler probe");
    reg("OleHnd\\protocol\\StdFileEditing\\server", NO_SERVER);
    reg("OleHnd\\protocol\\StdFileEditing\\handler", HANDLER);
    reg(".hnd", "OleHnd");
    reg("OleHndNone", "OLE handler probe, none");
    reg("OleHndNone\\protocol\\StdFileEditing\\server", NO_SERVER);
    reg("PBrush\\protocol\\StdFileEditing\\server", NO_SERVER);

    file = _lcreat(FILE_NAME, 0);
    _lwrite(file, "handler", 7);
    _lclose(file);

    handler = LoadLibrary(HANDLER);
    wsprintf(probeResult, "%s", (UINT)handler >= 32 ? "loaded" : "failed");
    probe("LoadLibrary", HANDLER, probeResult);

    if ((UINT)handler < 32) {
        return;
    }

    hndSet = (SETPROC)GetProcAddress(handler, "HndSet");
    hndTake = (TAKEPROC)GetProcAddress(handler, "HndTake");
    hndTable = (TABLEPROC)GetProcAddress(handler, "HndTable");
    hndBounds = GetProcAddress(handler, "HndQueryBounds");

    answer = OleRegisterClientDoc("OLEHND", "C:\\ORACLE\\HND.DOC", 0L, &doc);
    wsprintf(probeResult, "%u", (unsigned)answer);
    probe("OleRegisterClientDoc", "doc", probeResult);

    if (!doc) {
        return;
    }

    for (i = 1; i < 1100; i++) {
        procs[i] = GetProcAddress(ole, MAKEINTRESOURCE(i));
    }

    oleBmp((BYTE far *)bmp, 5);

    viaHandler();
    refuse();
    override();
    defaults();
    paintbrush();

    probeNote("end");
    wsprintf(probeResult, "%u", (unsigned)OleRevokeClientDoc(doc));
    probe("OleRevokeClientDoc", "doc", probeResult);
    usage("end");
    FreeLibrary(handler);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kindOf;

    (void)previous;
    (void)command;
    (void)show;

    self = instance;
    probeOpen(OUTPUT);

    kindOf.style = 0;
    kindOf.lpfnWndProc = Proc;
    kindOf.cbClsExtra = 0;
    kindOf.cbWndExtra = 0;
    kindOf.hInstance = instance;
    kindOf.hIcon = NULL;
    kindOf.hCursor = LoadCursor(NULL, IDC_ARROW);
    kindOf.hbrBackground = GetStockObject(WHITE_BRUSH);
    kindOf.lpszMenuName = NULL;
    kindOf.lpszClassName = "OleHnd";
    RegisterClass(&kindOf);
    window = CreateWindow("OleHnd", "OleHnd", WS_OVERLAPPEDWINDOW, 0, 0, 200, 100, NULL, NULL,
                          instance, NULL);

    ole = GetModuleHandle("OLECLI");
    cfNative = RegisterClipboardFormat("Native");
    cfOwnerLink = RegisterClipboardFormat("OwnerLink");
    cfObjectLink = RegisterClipboardFormat("ObjectLink");

    buffer = (unsigned char far *)GlobalLock(GlobalAlloc(GMEM_MOVEABLE, 0x3400L));
    streamTable.Get = (DWORD(CALLBACK *)(LPOLESTREAM, void FAR *, DWORD))MakeProcInstance(
        (FARPROC)StreamGet, instance);
    streamTable.Put = (DWORD(CALLBACK *)(LPOLESTREAM, OLE_CONST void FAR *, DWORD))MakeProcInstance(
        (FARPROC)StreamPut, instance);
    stream.lpstbl = &streamTable;
    clientTable.CallBack = (int(CALLBACK *)(LPOLECLIENT, OLE_NOTIFICATION, LPOLEOBJECT))
        MakeProcInstance((FARPROC)ClientCallBack, instance);
    client.lpvtbl = &clientTable;

    run();

    DestroyWindow(window);
    probeFinish();

    return 0;
}
