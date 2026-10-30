/*
 * OLECLI's embedded and linked objects as streams hold them, with no
 * server started: a stream of each made by hand as the OLE 1.0 object
 * format lays one out (MS-OLEDS's `EmbeddedObject` and `LinkedObject`),
 * read with `StdFileEditing`, asked everything a client asks of an object
 * it has not opened, drawn from its picture, written back, cloned, copied
 * to the clipboard and let go.
 *
 * * `embedded`, `linked`: the class `PBrush`, a picture for each; an
 *   embedded one with native data, a linked one with a file and an item.
 * * `bare`: an embedded object with no picture.
 * * `vtbl`, `obj`: the object's method table, by the OLECLI export each
 *   slot is, and its block's words, as `olemem` writes them.
 * * `bad`: the same streams under `Static`, cut short, another version.
 *
 * Nothing that differs between machines is written: a handle is written
 * as whether it is nought, a format by its name.
 */

#include "probe.h"
#include <ole.h>

#pragma library("olecli")

#define OUTPUT "C:\\ORACLE\\OLEEMB.OUT"

static HWND window;
static HINSTANCE self;
static HINSTANCE ole;
static FARPROC procs[1100];

static unsigned char far *buffer;
static DWORD length;
static DWORD readAt;
static DWORD limit;

typedef struct {
    LPOLESTREAMVTBL lpstbl;
} STREAM;

static OLESTREAMVTBL streamTable;
static STREAM stream;
static OLECLIENTVTBL clientTable;
static OLECLIENT client;

DWORD CALLBACK __export StreamGet(LPOLESTREAM me, void FAR *into, DWORD count)
{
    DWORD i;
    unsigned char far *bytes = (unsigned char far *)into;

    (void)me;

    if (readAt + count > limit) {
        count = readAt < limit ? limit - readAt : 0;
    }

    for (i = 0; i < count; i++) bytes[i] = buffer[(unsigned)(readAt + i)];

    readAt += count;

    return count;
}

DWORD CALLBACK __export StreamPut(LPOLESTREAM me, OLE_CONST void FAR *from, DWORD count)
{
    DWORD i;
    const unsigned char far *bytes = (const unsigned char far *)from;

    (void)me;

    wsprintf(probeArgs, "%lu", count);
    probe("Put", probeArgs, "");

    if (length + count > 0x3000L) {
        return 0;
    }

    for (i = 0; i < count; i++) buffer[(unsigned)(length + i)] = bytes[i];

    length += count;

    return count;
}

int CALLBACK __export ClientCallBack(LPOLECLIENT me, OLE_NOTIFICATION what, LPOLEOBJECT object)
{
    (void)me;

    wsprintf(probeArgs, "%d,%s", (int)what, object ? "object" : "0");
    probe("CallBack", probeArgs, "");

    return 1;
}

LONG FAR PASCAL __export Proc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    return DefWindowProc(hwnd, message, wParam, lParam);
}

/* A format by its number, or a registered one by its name. */
static LPSTR formatText(LPSTR out, UINT format)
{
    char name[40];

    if (format >= 0xc000) {
        GetClipboardFormatName(format, name, sizeof name);
        return out + wsprintf(out, "%s", (LPSTR)name);
    }

    return out + wsprintf(out, "%u", format);
}

/* The stream being built. */
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

static void makeEmbedded(int picture)
{
    unsigned i;

    at = 0;
    putLong(0x0501L);
    putLong(2L);
    putString("PBrush");
    putString("");
    putString("");
    putLong(16L);

    for (i = 0; i < 16; i++) buffer[at++] = (unsigned char)(0x40 + i);

    if (picture) {
        putPicture();
    } else {
        putLong(0x0501L);
        putLong(0L);
    }

    length = at;
}

static void makeLinked(void)
{
    at = 0;
    putLong(0x0501L);
    putLong(1L);
    putString("PBrush");
    putString("C:\\ORACLE\\LINKED.BMP");
    putString("1 1 10 10");
    putString("");
    putLong(0L);
    putLong(0L);
    putPicture();
    length = at;
}

static void dumpStream(LPCSTR what)
{
    DWORD i;
    DWORD j;
    LPSTR out;

    wsprintf(probeResult, "%lu", length);
    probe("length", what, probeResult);

    for (i = 0; i < length; i += 32) {
        out = probeResult;

        for (j = i; j < i + 32 && j < length; j++) {
            out += wsprintf(out, "%02x", buffer[(unsigned)j]);
        }

        wsprintf(probeArgs, "%s@%lx", what, i);
        probe("bytes", probeArgs, probeResult);
    }
}

static void vtbl(LPCSTR what, LPOLEOBJECT object)
{
    FARPROC FAR *table = (FARPROC FAR *)object->lpvtbl;
    LPSTR out = probeResult;
    int i;
    int k;

    for (i = 0; i < 39; i++) {
        for (k = 1; k < 1100; k++) {
            if (procs[k] && procs[k] == table[i]) {
                break;
            }
        }

        if (k < 1100) {
            out += wsprintf(out, "%d,", k);
        } else {
            out += wsprintf(out, "?,");
        }
    }

    probe("vtbl", what, probeResult);
}

/* Each question a client asks of an object it has not opened. */
static void queries(LPCSTR what, LPOLEOBJECT object)
{
    LONG type = -1;
    RECT bounds;
    OLECLIPFORMAT format;
    DWORD size = 0;
    char name[64];
    UINT count;
    HANDLE data;
    LPSTR out;
    OLESTATUS answer;
    OLEOPT_UPDATE update = (OLEOPT_UPDATE)7;

    answer = OleQueryType(object, &type);
    wsprintf(probeResult, "%u %ld", (unsigned)answer, type);
    probe("OleQueryType", what, probeResult);

    SetRect(&bounds, -1, -1, -1, -1);
    answer = OleQueryBounds(object, &bounds);
    wsprintf(probeResult, "%u %d,%d,%d,%d", (unsigned)answer, bounds.left, bounds.top, bounds.right,
             bounds.bottom);
    probe("OleQueryBounds", what, probeResult);

    out = probeResult;
    format = 0;

    do {
        format = OleEnumFormats(object, format);
        out = formatText(out, format);
        *out++ = ',';
        *out = 0;
    } while (format && out - probeResult < 200);

    probe("OleEnumFormats", what, probeResult);

    answer = OleQuerySize(object, &size);
    wsprintf(probeResult, "%u %lu", (unsigned)answer, size);
    probe("OleQuerySize", what, probeResult);

    count = sizeof name;
    lstrcpy(name, "?");
    answer = OleQueryName(object, name, &count);
    wsprintf(probeResult, "%u %u %s", (unsigned)answer, count, (LPSTR)name);
    probe("OleQueryName", what, probeResult);

    format = 0;

    while ((format = OleEnumFormats(object, format)) != 0) {
        data = 0;
        answer = OleGetData(object, format, &data);
        out = probeArgs + wsprintf(probeArgs, "%s,", what);
        formatText(out, format);
        out = probeResult + wsprintf(probeResult, "%u %s", (unsigned)answer, data ? "handle" : "0");

        if (answer == OLE_OK && data && format != CF_METAFILEPICT && format != CF_BITMAP) {
            LPBYTE bytes = (LPBYTE)GlobalLock(data);
            DWORD length = GlobalSize(data);
            DWORD i;

            for (i = 0; i < length && i < 40; i++) {
                out += wsprintf(out, " %02x", bytes[(unsigned)i]);
            }

            GlobalUnlock(data);
        } else if (answer == OLE_OK && data && format == CF_METAFILEPICT) {
            LPMETAFILEPICT picture = (LPMETAFILEPICT)GlobalLock(data);

            wsprintf(out, " %d %d %d", picture->mm, picture->xExt, picture->yExt);
            GlobalUnlock(data);
        }

        probe("OleGetData", probeArgs, probeResult);
    }

    wsprintf(probeResult, "%u", (unsigned)OleQueryOpen(object));
    probe("OleQueryOpen", what, probeResult);
    wsprintf(probeResult, "%u", (unsigned)OleQueryOutOfDate(object));
    probe("OleQueryOutOfDate", what, probeResult);
    wsprintf(probeResult, "%u", (unsigned)OleQueryReleaseStatus(object));
    probe("OleQueryReleaseStatus", what, probeResult);
    wsprintf(probeResult, "%u", (unsigned)OleQueryReleaseError(object));
    probe("OleQueryReleaseError", what, probeResult);
    wsprintf(probeResult, "%u", (unsigned)OleQueryReleaseMethod(object));
    probe("OleQueryReleaseMethod", what, probeResult);
    answer = OleGetLinkUpdateOptions(object, &update);
    wsprintf(probeResult, "%u %d", (unsigned)answer, (int)update);
    probe("OleGetLinkUpdateOptions", what, probeResult);
    wsprintf(probeResult, "%s", OleQueryProtocol(object, "StdFileEditing") ? "table" : "0");
    probe("OleQueryProtocol", "StdFileEditing", probeResult);
    wsprintf(probeResult, "%s", OleQueryProtocol(object, "StdExecute") ? "table" : "0");
    probe("OleQueryProtocol", "StdExecute", probeResult);
}

/* The pixels of a 64 by 32 bitmap an object is drawn into, summed. */
static void drawn(LPCSTR what, LPOLEOBJECT object)
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
    answer = OleDraw(object, memory, &bounds, NULL, NULL);

    for (y = 0; y < 32; y++) {
        for (x = 0; x < 64; x++) {
            sum = sum * 31 + (GetPixel(memory, x, y) & 0xffffffL);
        }
    }

    wsprintf(probeResult, "%u %08lx", (unsigned)answer, sum);
    probe("OleDraw", what, probeResult);
    SelectObject(memory, old);
    DeleteObject(bitmap);
    DeleteDC(memory);
    ReleaseDC(NULL, screen);
}

/* The formats on the clipboard, in its order. */
static void formats(LPCSTR what)
{
    UINT format = 0;
    LPSTR out = probeResult;

    *out = 0;

    if (!OpenClipboard(window)) {
        probe("formats", what, "not open");
        return;
    }

    while ((format = EnumClipboardFormats(format)) != 0) {
        out = formatText(out, format);
        *out++ = ',';
        *out = 0;
    }

    CloseClipboard();
    probe("formats", what, probeResult);
}

static void words(LPCSTR what, LPOLEOBJECT object)
{
    DWORD size = GlobalSize(GlobalHandle(SELECTOROF(object)));
    WORD far *w = (WORD far *)object;
    LPSTR out = probeResult;
    unsigned i;

    wsprintf(probeResult, "%lu", size);
    probe("block", what, probeResult);

    /* The words that are no handle, selector or atom: nought, small numbers, and the signature. */
    for (i = 0; i < 48 && i * 2 < size; i++) {
        if (w[i] == 0) {
            out += wsprintf(out, "0 ");
        } else if (w[i] < 0x100 || w[i] == 0x454c) {
            out += wsprintf(out, "%x ", w[i]);
        } else {
            out += wsprintf(out, "* ");
        }
    }

    probe("obj", what, probeResult);
}

static LPOLEOBJECT load(LPCSTR what, LPCSTR protocol, LHCLIENTDOC doc, DWORD cut)
{
    LPOLEOBJECT object = NULL;
    OLESTATUS answer;

    readAt = 0;
    limit = cut;
    answer = OleLoadFromStream((LPOLESTREAM)&stream, protocol, &client, doc, "Obj", &object);
    wsprintf(probeResult, "%u %s %lu", (unsigned)answer, object ? "object" : "0", readAt);
    probe("OleLoadFromStream", what, probeResult);

    return object;
}

static void kind(LPCSTR what, LHCLIENTDOC doc)
{
    LPOLEOBJECT object;
    LPOLEOBJECT copy = NULL;
    OLESTATUS answer;
    char args[40];

    dumpStream(what);
    object = load(what, "StdFileEditing", doc, 0x7fffffffL);

    if (!object) {
        return;
    }

    vtbl(what, object);
    words(what, object);
    queries(what, object);
    drawn(what, object);

    length = 0;
    answer = OleSaveToStream(object, (LPOLESTREAM)&stream);
    wsprintf(probeResult, "%u", (unsigned)answer);
    probe("OleSaveToStream", what, probeResult);
    wsprintf(args, "%s saved", what);
    dumpStream(args);

    answer = OleClone(object, &client, doc, "Copy", &copy);
    wsprintf(probeResult, "%u %s", (unsigned)answer, copy ? "object" : "0");
    probe("OleClone", what, probeResult);

    if (copy) {
        wsprintf(probeResult, "%u", (unsigned)OleEqual(object, copy));
        probe("OleEqual", what, probeResult);
        queries("copy", copy);
        wsprintf(probeResult, "%u", (unsigned)OleRelease(copy));
        probe("OleRelease", "copy", probeResult);
    }

    OpenClipboard(window);
    EmptyClipboard();
    wsprintf(probeResult, "%u", (unsigned)OleCopyToClipboard(object));
    probe("OleCopyToClipboard", what, probeResult);
    CloseClipboard();
    formats(what);

    OpenClipboard(window);
    wsprintf(probeResult, "%u", (unsigned)OleQueryCreateFromClip("StdFileEditing", olerender_draw, 0));
    probe("OleQueryCreateFromClip", what, probeResult);
    wsprintf(probeResult, "%u", (unsigned)OleQueryLinkFromClip("StdFileEditing", olerender_draw, 0));
    probe("OleQueryLinkFromClip", what, probeResult);
    wsprintf(probeResult, "%u", (unsigned)OleQueryCreateFromClip("Static", olerender_draw, 0));
    probe("OleQueryCreateFromClip", "static", probeResult);
    CloseClipboard();

    wsprintf(probeResult, "%u", (unsigned)OleRename(object, "Renamed"));
    probe("OleRename", what, probeResult);
    wsprintf(probeResult, "%u", (unsigned)OleSetHostNames(object, "Probe", "Doc"));
    probe("OleSetHostNames", what, probeResult);
    wsprintf(probeResult, "%u", (unsigned)OleSetLinkUpdateOptions(object, oleupdate_oncall));
    probe("OleSetLinkUpdateOptions", what, probeResult);
    wsprintf(probeResult, "%u", (unsigned)OleClose(object));
    probe("OleClose", what, probeResult);
    wsprintf(probeResult, "%u", (unsigned)OleRelease(object));
    probe("OleRelease", what, probeResult);
}

static void run(void)
{
    LHCLIENTDOC doc = 0;
    LPOLEOBJECT object;
    OLESTATUS answer;

    answer = OleRegisterClientDoc("OLEEMB", "C:\\ORACLE\\EMB.DOC", 0L, &doc);
    wsprintf(probeResult, "%u", (unsigned)answer);
    probe("OleRegisterClientDoc", "doc", probeResult);

    if (!doc) {
        return;
    }

    probeNote("embedded");
    makeEmbedded(1);
    kind("embedded", doc);

    probeNote("bare");
    makeEmbedded(0);
    kind("bare", doc);

    probeNote("linked");
    makeLinked();
    kind("linked", doc);

    probeNote("bad");
    makeEmbedded(1);
    object = load("as static", "Static", doc, 0x7fffffffL);

    if (object) {
        OleRelease(object);
    }

    {
        static const DWORD cuts[] = {8, 20, 30, 34, 40, 60, 70};
        int i;
        char what[16];

        for (i = 0; i < 7; i++) {
            wsprintf(what, "cut %lu", cuts[i]);
            object = load(what, "StdFileEditing", doc, cuts[i]);

            if (object) {
                OleRelease(object);
            }
        }
    }

    buffer[2] = 1;
    object = load("other os", "StdFileEditing", doc, 0x7fffffffL);

    if (object) {
        OleRelease(object);
    }

    OleRevokeClientDoc(doc);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kindOf;
    int i;

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
    kindOf.lpszClassName = "OleEmb";
    RegisterClass(&kindOf);
    window = CreateWindow("OleEmb", "OleEmb", WS_OVERLAPPEDWINDOW, 0, 0, 200, 100, NULL, NULL,
                          instance, NULL);

    ole = GetModuleHandle("OLECLI");

    for (i = 1; i < 1100; i++) {
        procs[i] = GetProcAddress(ole, MAKEINTRESOURCE(i));
    }

    buffer = (unsigned char far *)GlobalLock(GlobalAlloc(GMEM_MOVEABLE, 0x3400L));
    limit = 0x7fffffffL;
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
