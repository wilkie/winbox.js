/*
 * What OLECLI keeps where a program can see it: the block a client
 * document's handle points at, the block an object's pointer points at,
 * and each object's method table, measured from the program's side.
 *
 * * `vtbl`: for each of the 41 methods of `OLEOBJECTVTBL` (ole.h), the
 *   OLECLI export it points at, by the ordinal `GetProcAddress` gives that
 *   address for; `?` for none. An object of each kind: a picture, a
 *   bitmap, a DIB, a stream of an unknown class, and of a class whose
 *   format is named.
 * * `doc`, `obj`: a block's words, each written as what it is where that
 *   is known -- nought, the block's own selector, an atom of a name the
 *   probe gave, the document's or another object's selector or offset, a
 *   handle the object answers -- else in hexadecimal; the document's after
 *   each object is added and let go.
 *
 * Nothing that differs between machines is written as a number: an atom, a
 * selector or a handle is written by what it is.
 */

#include "probe.h"
#include <ole.h>

#pragma library("olecli")

#define OUTPUT "C:\\ORACLE\\OLEMEM.OUT"

static HWND window;
static HINSTANCE ole;
static HINSTANCE self;
static FARPROC procs[1100];

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

/* What a word may be, by name. */
#define KNOWN 48
static WORD knownValue[KNOWN];
static char knownName[KNOWN][16];
static int knownCount;

static void know(WORD value, LPCSTR name)
{
    int i;

    if (!value) {
        return;
    }

    for (i = 0; i < knownCount; i++) {
        if (!lstrcmp(knownName[i], name)) {
            knownValue[i] = value;
            return;
        }
    }

    if (knownCount < KNOWN) {
        knownValue[knownCount] = value;
        lstrcpy(knownName[knownCount], name);
        knownCount++;
    }
}

static void knowAtom(LPCSTR text, LPCSTR name)
{
    know(GlobalFindAtom(text), name);
}

DWORD CALLBACK __export StreamGet(LPOLESTREAM self, void FAR *into, DWORD count)
{
    DWORD i;
    unsigned char far *bytes = (unsigned char far *)into;

    (void)self;

    if (readAt + count > length) {
        count = readAt < length ? length - readAt : 0;
    }

    for (i = 0; i < count; i++) bytes[i] = buffer[(unsigned)(readAt + i)];

    readAt += count;

    return count;
}

DWORD CALLBACK __export StreamPut(LPOLESTREAM self, OLE_CONST void FAR *from, DWORD count)
{
    (void)self;
    (void)from;

    return count;
}

static int logCalls;
static int answerCalls = 1;
static int callCount;

int CALLBACK __export ClientCallBack(LPOLECLIENT self, OLE_NOTIFICATION what, LPOLEOBJECT object)
{
    (void)self;

    callCount++;

    if (logCalls) {
        wsprintf(probeArgs, "%d,%s", (int)what, object ? "object" : "0");
        wsprintf(probeResult, "%d", answerCalls);
        probe("CallBack", probeArgs, probeResult);
    }

    return answerCalls;
}

LONG FAR PASCAL __export Proc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    return DefWindowProc(hwnd, message, wParam, lParam);
}

/* The OLECLI export at an address, by its ordinal; 0 for none. */
static int ordinalAt(FARPROC address)
{
    int i;

    for (i = 1; i < 1100; i++) {
        if (procs[i] && procs[i] == address) {
            return i;
        }
    }

    return 0;
}

static void vtbl(LPCSTR what, LPOLEOBJECT object)
{
    FARPROC FAR *table = (FARPROC FAR *)object->lpvtbl;
    LPSTR out = probeResult;
    int i;
    int ordinal;

    for (i = 0; i < 41; i++) {
        ordinal = ordinalAt(table[i]);

        if (ordinal) {
            out += wsprintf(out, "%d,", ordinal);
        } else {
            out += wsprintf(out, "?,");
        }
    }

    probe("vtbl", what, probeResult);

    /* Whether the table is in OLECLI's data: its selector beside a known one. */
    wsprintf(probeResult, "%s", SELECTOROF(object->lpvtbl) == SELECTOROF(object) ? "own" : "other");
    probe("vtbl place", what, probeResult);
}

/* A block's words, by what each is. */
static void words(LPCSTR function, LPCSTR what, void far *block, unsigned count)
{
    WORD far *at = (WORD far *)block;
    LPSTR out = probeResult;
    unsigned i;
    int k;
    WORD value;

    for (i = 0; i < count; i++) {
        value = at[i];

        if (!value) {
            out += wsprintf(out, "0 ");
            continue;
        }

        if (value == SELECTOROF(block)) {
            out += wsprintf(out, "self ");
            continue;
        }

        /* The name known last for a value: an atom or a handle given again. */
        for (k = knownCount - 1; k >= 0; k--) {
            if (knownValue[k] == value) {
                break;
            }
        }

        if (k >= 0) {
            out += wsprintf(out, "%s ", (LPSTR)knownName[k]);
        } else {
            out += wsprintf(out, "%x ", value);
        }
    }

    probe(function, what, probeResult);
}

static int windowedPicture;

static void putMetafile(int mm, int x, int y)
{
    HGLOBAL block = GlobalAlloc(GMEM_MOVEABLE | GMEM_DDESHARE, sizeof(METAFILEPICT));
    LPMETAFILEPICT picture = (LPMETAFILEPICT)GlobalLock(block);
    HDC meta = CreateMetaFile(NULL);

    if (windowedPicture) {
        SetWindowOrg(meta, 3, 4);
        SetWindowExt(meta, 100, 50);
    }

    Rectangle(meta, 0, 0, 100, 50);
    picture->mm = mm;
    picture->xExt = x;
    picture->yExt = y;
    picture->hMF = CloseMetaFile(meta);
    GlobalUnlock(block);
    OpenClipboard(window);
    EmptyClipboard();
    SetClipboardData(CF_METAFILEPICT, block);
}

static HBITMAP makeBitmap(void)
{
    HDC screen = GetDC(NULL);
    HBITMAP bitmap = CreateCompatibleBitmap(screen, 16, 8);

    ReleaseDC(NULL, screen);

    return bitmap;
}

static void putBitmap(void)
{
    OpenClipboard(window);
    EmptyClipboard();
    SetClipboardData(CF_BITMAP, makeBitmap());
}

static void putDib(void)
{
    HGLOBAL block = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT,
                                sizeof(BITMAPINFOHEADER) + 2 * 4 + 4 * 8);
    LPBITMAPINFOHEADER info = (LPBITMAPINFOHEADER)GlobalLock(block);

    info->biSize = sizeof(BITMAPINFOHEADER);
    info->biWidth = 16;
    info->biHeight = 8;
    info->biPlanes = 1;
    info->biBitCount = 1;
    info->biCompression = BI_RGB;
    GlobalUnlock(block);
    OpenClipboard(window);
    EmptyClipboard();
    SetClipboardData(CF_DIB, block);
}

/* An object made from what is on the clipboard, measured, kept. */
static LPOLEOBJECT fromClip(LPCSTR what, LHCLIENTDOC doc, LPCSTR name, LPCSTR selName,
                            LPCSTR offName)
{
    char label[16];

    LPOLEOBJECT object = NULL;
    OLESTATUS answer;
    HANDLE data = 0;

    answer = OleCreateFromClip("Static", &client, doc, name, &object, olerender_draw, 0);
    CloseClipboard();
    wsprintf(probeResult, "%u %s", (unsigned)answer, object ? "object" : "0");
    probe("OleCreateFromClip", what, probeResult);

    if (!object) {
        return NULL;
    }

    wsprintf(probeResult, "%x %lu", OFFSETOF(object),
             GlobalSize(GlobalHandle(SELECTOROF(object))));
    probe("place", what, probeResult);
    know(SELECTOROF(object), selName);
    know(OFFSETOF(object), offName);
    wsprintf(label, "%shandle", what);
    know(LOWORD(GlobalHandle(SELECTOROF(object))), label);
    wsprintf(label, "%sname", what);
    knowAtom(name, label);
    wsprintf(label, "%svtbl", what);
    know(OFFSETOF(object->lpvtbl), label);
    know(SELECTOROF(object->lpvtbl), "vtblsel");
    wsprintf(label, "%sdata", what);

    if (OleGetData(object, CF_METAFILEPICT, &data) == OLE_OK) {
        know((WORD)data, label);
        wsprintf(label, "%shmf", what);
        know((WORD)((LPMETAFILEPICT)GlobalLock(data))->hMF, label);
        GlobalUnlock(data);
    } else if (OleGetData(object, CF_BITMAP, &data) == OLE_OK) {
        know((WORD)data, label);
    } else if (OleGetData(object, CF_DIB, &data) == OLE_OK) {
        know((WORD)data, label);
    }

    vtbl(what, object);

    return object;
}

/*
 * An object's block's words: the 3Ah bytes every kind has, a picture's
 * 3Eh; then, apart, the words after them in a picture's block, which its
 * drawing writes.
 */
static void dumpObject(LPCSTR what, LPOLEOBJECT object)
{
    DWORD size = GlobalSize(GlobalHandle(SELECTOROF(object)));
    unsigned count = (unsigned)((size - OFFSETOF(object)) / 2);
    unsigned kept = ((WORD far *)object)[12] == MM_ANISOTROPIC ? 31 : 29;

    if (count > kept) {
        words("obj", what, object, kept);
        words("drawstate", what, (WORD far *)object + kept, count - kept > 5 ? 5 : count - kept);
    } else {
        words("obj", what, object, count);
    }
}

static LPOLEOBJECT loadMade(LPCSTR what, LHCLIENTDOC doc, const unsigned char *bytes,
                            unsigned count)
{
    LPOLEOBJECT object = NULL;
    OLESTATUS answer;
    unsigned i;

    for (i = 0; i < count; i++) buffer[i] = bytes[i];

    length = count;
    readAt = 0;
    answer = OleLoadFromStream((LPOLESTREAM)&stream, "Static", &client, doc, "Made", &object);
    wsprintf(probeResult, "%u %s %lu", (unsigned)answer, object ? "object" : "0", readAt);
    probe("OleLoadFromStream", what, probeResult);

    if (object) {
        OLECLIPFORMAT format = OleEnumFormats(object, 0);
        HANDLE data = 0;

        knowAtom("GENERI", "GENERI");
        knowAtom("BOGUS", "BOGUS");
        know(SELECTOROF(object), "made");
        know(OFFSETOF(object), "madeoff");
        know(LOWORD(GlobalHandle(SELECTOROF(object))), "madehandle");
        knowAtom("Made", "madename");
        know(OFFSETOF(object->lpvtbl), "madevtbl");
        know(format, "madeformat");

        if (OleGetData(object, format, &data) == OLE_OK) {
            know((WORD)data, "madedata");
        }
        vtbl(what, object);
        dumpObject(what, object);
    }

    return object;
}

static const unsigned char STATIC_BOGUS[] = {0x01, 0x05, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00,
                                             0x06, 0x00, 0x00, 0x00, 'B',  'O',  'G',  'U',
                                             'S',  0x00, 0x10, 0x00, 0x00, 0x00, 0x08, 0x00,
                                             0x00, 0x00, 0x00, 0x00, 0x00, 0x00};
static const unsigned char GENERIC_NAMED[] = {
    0x01, 0x05, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00, 0x07, 0x00, 0x00, 0x00, 'G',  'E',
    'N',  'E',  'R',  'I',  0x00, 0x00, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 'P',
    'r',  'o',  'b',  'e',  0x00, 0x03, 0x00, 0x00, 0x00, 'a',  'b',  'c'};

/* A picture of each mapping mode and some extents: what making an object of it answers, and its bounds. */
static void modes(LHCLIENTDOC doc)
{
    static const int sizes[][2] = {{300, 200}, {0, 0}, {-300, -200}, {300, -200},
                                    {-300, 200}, {300, 0}, {0, 200}, {-1, -1}};
    int mm;
    int i;
    LPOLEOBJECT object;
    OLESTATUS answer;
    RECT bounds;

    for (mm = 1; mm <= 8; mm++) {
        for (i = 0; i < (mm == 8 ? 8 : 4); i++) {
            object = NULL;
            putMetafile(mm, sizes[i][0], sizes[i][1]);
            answer = OleCreateFromClip("Static", &client, doc, "Mode", &object, olerender_draw, 0);
            CloseClipboard();
            wsprintf(probeArgs, "%d,%d,%d", mm, sizes[i][0], sizes[i][1]);
            wsprintf(probeResult, "%u", (unsigned)answer);

            if (object) {
                SetRect(&bounds, -1, -1, -1, -1);
                answer = OleQueryBounds(object, &bounds);
                wsprintf(probeResult + lstrlen(probeResult), " %u %d,%d,%d,%d %x", (unsigned)answer,
                         bounds.left, bounds.top, bounds.right, bounds.bottom,
                         ((WORD far *)object)[12]);
                OleRelease(object);
            }

            probe("mode", probeArgs, probeResult);
        }
    }
}

/* Each method called through the object's table, as a program may, beside its API function. */
static void direct(LPCSTR what, LPOLEOBJECT object)
{
    LPOLEOBJECTVTBL t = object->lpvtbl;
    RECT bounds;
    OLEOPT_UPDATE update = (OLEOPT_UPDATE)7;
    LPOLEOBJECT other = NULL;
    LONG value = 0;
    char args[40];

#define DIRECT(name, call, api)                                                  \
    wsprintf(args, "%s,%s", what, (LPSTR)name);                                  \
    wsprintf(probeResult, "%u %u", (unsigned)(call), (unsigned)(api));          \
    probe("direct", args, probeResult)

    SetRect(&bounds, 0, 0, 10, 10);
    DIRECT("Show", t->Show(object, TRUE), 0);
    DIRECT("DoVerb", t->DoVerb(object, 0, TRUE, TRUE), 0);
    DIRECT("SetData", t->SetData(object, CF_TEXT, NULL), OleSetData(object, CF_TEXT, NULL));
    DIRECT("SetTargetDevice", t->SetTargetDevice(object, NULL), OleSetTargetDevice(object, NULL));
    DIRECT("SetBounds", t->SetBounds(object, &bounds), OleSetBounds(object, &bounds));
    DIRECT("SetBoundsNull", t->SetBounds(object, NULL), OleSetBounds(object, NULL));
    DIRECT("SetColorScheme", t->SetColorScheme(object, NULL), OleSetColorScheme(object, NULL));
    DIRECT("SetHostNames", t->SetHostNames(object, "P", "D"), OleSetHostNames(object, "P", "D"));
    DIRECT("CopyFromLink", t->CopyFromLink(object, &client, 0L, "x", &other),
           OleCopyFromLink(object, "StdFileEditing", &client, 0L, "x", &other));
    DIRECT("Activate", t->Activate(object, 0, TRUE, TRUE, window, NULL),
           OleActivate(object, 0, TRUE, TRUE, window, NULL));
    DIRECT("Execute", t->Execute(object, NULL, 0), OleExecute(object, NULL, 0));
    DIRECT("Close", t->Close(object), OleClose(object));
    DIRECT("Update", t->Update(object), OleUpdate(object));
    DIRECT("Reconnect", t->Reconnect(object), OleReconnect(object));
    DIRECT("ObjectConvert", t->ObjectConvert(object, "Static", &client, 0L, "x", &other),
           OleObjectConvert(object, "Static", &client, 0L, "x", &other));
    DIRECT("GetLinkUpdateOptions", t->GetLinkUpdateOptions(object, &update),
           OleGetLinkUpdateOptions(object, &update));
    DIRECT("SetLinkUpdateOptions", t->SetLinkUpdateOptions(object, oleupdate_oncall),
           OleSetLinkUpdateOptions(object, oleupdate_oncall));
    DIRECT("QueryOpen", t->QueryOpen(object), OleQueryOpen(object));
    DIRECT("QueryOutOfDate", t->QueryOutOfDate(object), OleQueryOutOfDate(object));
    DIRECT("QueryReleaseStatus", t->QueryReleaseStatus(object), OleQueryReleaseStatus(object));
    DIRECT("QueryReleaseError", t->QueryReleaseError(object), OleQueryReleaseError(object));
    DIRECT("QueryReleaseMethod", t->QueryReleaseMethod(object), OleQueryReleaseMethod(object));
    DIRECT("RequestData", t->RequestData(object, CF_METAFILEPICT),
           OleRequestData(object, CF_METAFILEPICT));
    DIRECT("RequestData0", t->RequestData(object, 0), OleRequestData(object, 0));
    DIRECT("ObjectLong", t->ObjectLong(object, 0, &value), 0);
    DIRECT("QueryProtocol", t->QueryProtocol(object, "StdFileEditing") ? 1 : 0,
           OleQueryProtocol(object, "StdFileEditing") ? 1 : 0);
    DIRECT("QueryProtocolStatic", t->QueryProtocol(object, "Static") ? 1 : 0,
           OleQueryProtocol(object, "Static") ? 1 : 0);
    wsprintf(probeResult, "%d", (int)update);
    probe("direct", "update after", probeResult);
}

static int recordCount;

int CALLBACK __export RecordProc(HDC dc, HANDLETABLE FAR *table, METARECORD FAR *record, int objects,
                                 LPARAM data)
{
    LPSTR out = probeResult;
    unsigned i;
    unsigned words = (unsigned)record->rdSize - 3;

    (void)dc;
    (void)table;
    (void)objects;
    (void)data;

    out += wsprintf(out, "%x:", record->rdFunction);

    for (i = 0; i < words && i < 12; i++) {
        out += wsprintf(out, " %d", (int)record->rdParm[i]);
    }

    wsprintf(probeArgs, "%s#%d", (LPSTR)data, recordCount++);
    probe("record", probeArgs, probeResult);

    return 1;
}

/* An object drawn into a metafile, bounds and window bounds apart: each record the metafile then holds. */
static void drawRecords(LPCSTR what, LPOLEOBJECT object, int windowed)
{
    HDC meta = CreateMetaFile(NULL);
    RECT bounds;
    RECT wbounds;
    OLESTATUS answer;
    HMETAFILE done;
    FARPROC proc;
    HDC screen;

    SetRect(&bounds, 10, 20, 110, 70);
    SetRect(&wbounds, 5, 7, 405, 307);
    answer = OleDraw(object, meta, &bounds, windowed ? &wbounds : NULL, NULL);
    done = CloseMetaFile(meta);
    wsprintf(probeResult, "%u", (unsigned)answer);
    probe("drawn", what, probeResult);
    proc = MakeProcInstance((FARPROC)RecordProc, self);
    recordCount = 0;
    screen = GetDC(NULL);
    EnumMetaFile(screen, done, (MFENUMPROC)proc, (LPARAM)what);
    ReleaseDC(NULL, screen);
    FreeProcInstance(proc);
    DeleteMetaFile(done);
}

static const unsigned char GENERIC_NONAME[] = {
    0x01, 0x05, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00, 0x07, 0x00, 0x00, 0x00, 'G',  'E',
    'N',  'E',  'R',  'I',  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x06,
    0x00, 0x00, 0x00, 'P',  'r',  'o',  'b',  'e',  0x00, 0x03, 0x00, 0x00, 0x00, 'a',
    'b',  'c'};

/* A format's name, each byte in hexadecimal. */
static void formatName(LPCSTR what, UINT format)
{
    char name[32];
    int count = GetClipboardFormatName(format, name, sizeof name);
    LPSTR out = probeResult;
    int i;

    out += wsprintf(out, "%d:", count);

    for (i = 0; i < count; i++) {
        out += wsprintf(out, " %02x", (unsigned char)name[i]);
    }

    probe("format name", what, probeResult);
}

/* Bounds of a bitmap given a dimension, and of a DIB given its pels per metre. */
static void sizes(LHCLIENTDOC doc)
{
    LPOLEOBJECT object;
    RECT bounds;
    HBITMAP bitmap;
    HGLOBAL block;
    LPBITMAPINFOHEADER info;
    OLESTATUS answer;
    DWORD size;
    LONG ppm[3] = {2000, 0, -5};
    int i;

    bitmap = makeBitmap();
    SetBitmapDimension(bitmap, 100, 50);
    OpenClipboard(window);
    EmptyClipboard();
    SetClipboardData(CF_BITMAP, bitmap);
    object = NULL;
    answer = OleCreateFromClip("Static", &client, doc, "Dim", &object, olerender_draw, 0);
    CloseClipboard();
    SetRect(&bounds, -1, -1, -1, -1);

    if (object) {
        OleQueryBounds(object, &bounds);
        OleRelease(object);
    }

    wsprintf(probeResult, "%u %d,%d,%d,%d", (unsigned)answer, bounds.left, bounds.top, bounds.right,
             bounds.bottom);
    probe("bounds", "bitmap 100,50", probeResult);

    for (i = 0; i < 3; i++) {
        block = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, sizeof(BITMAPINFOHEADER) + 2 * 4 + 4 * 8);
        info = (LPBITMAPINFOHEADER)GlobalLock(block);
        info->biSize = sizeof(BITMAPINFOHEADER);
        info->biWidth = 16;
        info->biHeight = 8;
        info->biPlanes = 1;
        info->biBitCount = 1;
        info->biXPelsPerMeter = ppm[i];
        info->biYPelsPerMeter = ppm[i] * 2;
        GlobalUnlock(block);
        OpenClipboard(window);
        EmptyClipboard();
        SetClipboardData(CF_DIB, block);
        object = NULL;
        answer = OleCreateFromClip("Static", &client, doc, "Dib", &object, olerender_draw, 0);
        CloseClipboard();
        SetRect(&bounds, -1, -1, -1, -1);
        size = 0;

        if (object) {
            HANDLE data = 0;

            OleQueryBounds(object, &bounds);
            OleGetData(object, CF_DIB, &data);

            if (data) {
                info = (LPBITMAPINFOHEADER)GlobalLock(data);
                size = (DWORD)info->biXPelsPerMeter;
                GlobalUnlock(data);
            }

            OleRelease(object);
        }

        wsprintf(probeArgs, "dib %ld", ppm[i]);
        wsprintf(probeResult, "%u %d,%d,%d,%d %ld", (unsigned)answer, bounds.left, bounds.top,
                 bounds.right, bounds.bottom, (LONG)size);
        probe("bounds", probeArgs, probeResult);
    }
}

static DWORD saved;

/* The formats on the clipboard, in its order. */
static void formats(LPCSTR what)
{
    UINT format = 0;
    LPSTR out = probeResult;
    char name[64];

    *out = 0;

    if (!OpenClipboard(window)) {
        probe("formats", what, "not open");
        return;
    }

    while ((format = EnumClipboardFormats(format)) != 0) {
        if (format >= 0xc000) {
            GetClipboardFormatName(format, name, sizeof name);
            out += wsprintf(out, "%s,", (LPSTR)name);
        } else {
            out += wsprintf(out, "%u,", format);
        }
    }

    CloseClipboard();
    probe("formats", what, probeResult);
}

DWORD CALLBACK __export CountPut(LPOLESTREAM self, OLE_CONST void FAR *from, DWORD count)
{
    (void)self;
    (void)from;
    saved += count;

    return count;
}

/* Two objects of a kind whose data differ: what OleEqual answers each way, and against itself. */
static void equals(LHCLIENTDOC doc)
{
    LPOLEOBJECT a = NULL;
    LPOLEOBJECT b = NULL;
    HBITMAP bitmap;
    HDC screen;
    HDC memory;
    HBITMAP old;

    bitmap = makeBitmap();
    screen = GetDC(NULL);
    memory = CreateCompatibleDC(screen);
    old = SelectObject(memory, bitmap);
    PatBlt(memory, 0, 0, 16, 8, WHITENESS);
    SelectObject(memory, old);
    OpenClipboard(window);
    EmptyClipboard();
    SetClipboardData(CF_BITMAP, bitmap);
    OleCreateFromClip("Static", &client, doc, "A", &a, olerender_draw, 0);
    CloseClipboard();
    bitmap = makeBitmap();
    old = SelectObject(memory, bitmap);
    PatBlt(memory, 0, 0, 16, 8, BLACKNESS);
    SelectObject(memory, old);
    DeleteDC(memory);
    ReleaseDC(NULL, screen);
    OpenClipboard(window);
    EmptyClipboard();
    SetClipboardData(CF_BITMAP, bitmap);
    OleCreateFromClip("Static", &client, doc, "B", &b, olerender_draw, 0);
    CloseClipboard();

    if (a && b) {
        wsprintf(probeResult, "%u %u %u", (unsigned)OleEqual(a, b), (unsigned)OleEqual(b, a),
                 (unsigned)OleEqual(a, a));
        probe("equal", "bitmaps differing", probeResult);
    }

    if (a) {
        OleRelease(a);
    }

    if (b) {
        OleRelease(b);
    }

    a = NULL;
    b = NULL;
    putMetafile(MM_ANISOTROPIC, 2000, 1000);
    OleCreateFromClip("Static", &client, doc, "A", &a, olerender_draw, 0);
    CloseClipboard();
    windowedPicture = 1;
    putMetafile(MM_ANISOTROPIC, 2000, 1000);
    windowedPicture = 0;
    OleCreateFromClip("Static", &client, doc, "B", &b, olerender_draw, 0);
    CloseClipboard();

    if (a && b) {
        wsprintf(probeResult, "%u %u %u", (unsigned)OleEqual(a, b), (unsigned)OleEqual(b, a),
                 (unsigned)OleEqual(a, a));
        probe("equal", "pictures differing", probeResult);
    }

    if (a) {
        OleRelease(a);
    }

    if (b) {
        OleRelease(b);
    }
}

/* What another class's object does: drawn, copied to the clipboard, cloned, compared, saved, its data changed. */
static void other(LPCSTR what, LPOLEOBJECT object, LHCLIENTDOC doc)
{
    HDC screen = GetDC(NULL);
    HDC memory = CreateCompatibleDC(screen);
    HBITMAP bitmap = CreateCompatibleBitmap(screen, 16, 16);
    HBITMAP old = SelectObject(memory, bitmap);
    RECT bounds;
    LPOLEOBJECT copy = NULL;
    OLESTATUS answer;
    OLESTREAMVTBL counting;
    STREAM sink;
    DWORD size = 0;
    char args[40];

    SetRect(&bounds, 0, 0, 8, 8);
    wsprintf(args, "%s,Draw", what);
    wsprintf(probeResult, "%u", (unsigned)OleDraw(object, memory, &bounds, NULL, NULL));
    probe("other", args, probeResult);
    SelectObject(memory, old);
    DeleteObject(bitmap);
    DeleteDC(memory);
    ReleaseDC(NULL, screen);

    OpenClipboard(window);
    EmptyClipboard();
    wsprintf(args, "%s,CopyToClipboard", what);
    wsprintf(probeResult, "%u", (unsigned)OleCopyToClipboard(object));
    probe("other", args, probeResult);
    CloseClipboard();
    formats(args);

    answer = OleClone(object, &client, doc, "Copy", &copy);
    wsprintf(args, "%s,Clone", what);
    wsprintf(probeResult, "%u %s", (unsigned)answer, copy ? "object" : "0");
    probe("other", args, probeResult);

    if (copy) {
        wsprintf(args, "%s,Equal", what);
        wsprintf(probeResult, "%u %u %u", (unsigned)OleEqual(object, copy),
                 (unsigned)OleEqual(object, object), (unsigned)OleEnumFormats(copy, 0) ==
                 OleEnumFormats(object, 0));
        probe("other", args, probeResult);
        OleRelease(copy);
    }

    counting.Get = streamTable.Get;
    counting.Put = (DWORD(CALLBACK *)(LPOLESTREAM, OLE_CONST void FAR *, DWORD))MakeProcInstance(
        (FARPROC)CountPut, self);
    sink.lpstbl = &counting;
    saved = 0;
    answer = OleSaveToStream(object, (LPOLESTREAM)&sink);
    OleQuerySize(object, &size);
    wsprintf(args, "%s,SaveToStream", what);
    wsprintf(probeResult, "%u %lu %lu", (unsigned)answer, saved, size);
    probe("other", args, probeResult);

    wsprintf(args, "%s,ChangeData", what);
    wsprintf(probeResult, "%u", (unsigned)object->lpvtbl->ChangeData(object, NULL, &client, FALSE));
    probe("other", args, probeResult);
}

/* A picture of many records drawn: when the client is asked whether to go on, and what its no does. */
static void longDraw(LHCLIENTDOC doc)
{
    HGLOBAL block = GlobalAlloc(GMEM_MOVEABLE | GMEM_DDESHARE, sizeof(METAFILEPICT));
    LPMETAFILEPICT picture = (LPMETAFILEPICT)GlobalLock(block);
    HDC meta = CreateMetaFile(NULL);
    LPOLEOBJECT object = NULL;
    HDC screen;
    HDC memory;
    HBITMAP bitmap;
    HBITMAP old;
    RECT bounds;
    int i;
    int answer;

    SetWindowExt(meta, 100, 100);

    for (i = 0; i < 40; i++) {
        LineTo(meta, i * 2, 99 - i);
    }

    picture->mm = MM_ANISOTROPIC;
    picture->xExt = 1000;
    picture->yExt = 1000;
    picture->hMF = CloseMetaFile(meta);
    GlobalUnlock(block);
    OpenClipboard(window);
    EmptyClipboard();
    SetClipboardData(CF_METAFILEPICT, block);
    OleCreateFromClip("Static", &client, doc, "Long", &object, olerender_draw, 0);
    CloseClipboard();

    if (!object) {
        return;
    }

    screen = GetDC(NULL);
    memory = CreateCompatibleDC(screen);
    bitmap = CreateCompatibleBitmap(screen, 32, 32);
    old = SelectObject(memory, bitmap);
    SetRect(&bounds, 0, 0, 32, 32);

    logCalls = 1;
    answerCalls = 1;
    callCount = 0;
    answer = OleDraw(object, memory, &bounds, NULL, NULL);
    wsprintf(probeResult, "%u %d", (unsigned)answer, callCount);
    probe("long draw", "go on", probeResult);
    words("drawstate", "after go on", (WORD far *)object + 31, 5);

    answerCalls = 0;
    callCount = 0;
    answer = OleDraw(object, memory, &bounds, NULL, NULL);
    wsprintf(probeResult, "%u %d", (unsigned)answer, callCount);
    probe("long draw", "stop", probeResult);
    words("drawstate", "after stop", (WORD far *)object + 31, 5);
    logCalls = 0;
    answerCalls = 1;

    SelectObject(memory, old);
    DeleteObject(bitmap);
    DeleteDC(memory);
    ReleaseDC(NULL, screen);
    OleRelease(object);
}

static void run(void)
{
    LHCLIENTDOC doc = 0;
    LHCLIENTDOC second = 0;
    LPOLEOBJECT mf;
    LPOLEOBJECT bm;
    LPOLEOBJECT dib;
    LPOLEOBJECT made;
    LPOLEOBJECT each = NULL;
    void far *docBlock;
    OLESTATUS answer;

    answer = OleRegisterClientDoc("OLEMEM", "C:\\ORACLE\\MEM.DOC", 0L, &doc);
    wsprintf(probeResult, "%u %s", (unsigned)answer, doc ? "doc" : "0");
    probe("OleRegisterClientDoc", "doc", probeResult);

    if (!doc) {
        return;
    }

    docBlock = (void far *)doc;
    wsprintf(probeResult, "%x %lu", OFFSETOF(docBlock),
             GlobalSize(GlobalHandle(SELECTOROF(docBlock))));
    probe("place", "doc", probeResult);
    know(SELECTOROF(docBlock), "doc");
    know(OFFSETOF(docBlock), "docoff");
    know(LOWORD(GlobalHandle(SELECTOROF(docBlock))), "dochandle");
    knowAtom("C:\\ORACLE\\MEM.DOC", "docname");
    knowAtom("OLEMEM", "class");
    words("doc", "registered", docBlock, 12);

    OleRegisterClientDoc("OLEMEM", "C:\\ORACLE\\MEM.DOC", 0L, &second);
    know(SELECTOROF((void far *)second), "second");
    know(LOWORD(GlobalHandle(SELECTOROF((void far *)second))), "secondhandle");
    know(SELECTOROF((void far *)&client), "probeds");
    know(OFFSETOF((void far *)&client), "client");
    words("doc", "second", (void far *)second, 12);
    words("doc", "first after second", docBlock, 12);

    knowAtom("METAFILEPICT", "METAFILEPICT");
    knowAtom("BITMAP", "BITMAP");
    knowAtom("DIB", "DIB");
    knowAtom("Static", "Static");
    knowAtom("GENERI", "GENERI");
    knowAtom("BOGUS", "BOGUS");
    know(SELECTOROF((void far *)&client), "probeds");
    know(OFFSETOF((void far *)&client), "client");


    putMetafile(MM_ANISOTROPIC, 2000, 1000);
    mf = fromClip("mf", doc, "One", "mf", "mfoff");

    if (mf) {
        other("mf", mf, doc);
        direct("mf", mf);
        drawRecords("mf", mf, 1);
        drawRecords("mf alone", mf, 0);
    }

    {
        LPOLEOBJECT windowed;

        windowedPicture = 1;
        putMetafile(MM_ANISOTROPIC, 2000, 1000);
        windowedPicture = 0;
        windowed = NULL;
        OleCreateFromClip("Static", &client, doc, "Windowed", &windowed, olerender_draw, 0);
        CloseClipboard();

        if (windowed) {
            drawRecords("windowed", windowed, 1);
            drawRecords("windowed alone", windowed, 0);
            OleRelease(windowed);
        }
    }
    words("doc", "mf", docBlock, 12);

    if (mf) {
        dumpObject("mf", mf);
    }

    putBitmap();
    bm = fromClip("bm", doc, "Two", "bm", "bmoff");
    words("doc", "bm", docBlock, 12);

    if (bm) {
        dumpObject("bm", bm);
        drawRecords("bm", bm, 1);
    }

    if (mf) {
        dumpObject("mf after bm", mf);
    }

    {
        LPOLEOBJECT iso;

        putMetafile(MM_ISOTROPIC, 300, 200);
        iso = fromClip("iso", doc, "Iso", "iso", "isooff");

        if (iso) {
            dumpObject("iso", iso);
            OleRelease(iso);
        }

        putMetafile(MM_ANISOTROPIC, 0, 0);
        iso = fromClip("nox", doc, "Nox", "nox", "noxoff");

        if (iso) {
            dumpObject("nox", iso);
            OleRelease(iso);
        }

        putMetafile(MM_TEXT, 0, 0);
        iso = fromClip("text", doc, "Text", "text", "textoff");

        if (iso) {
            dumpObject("text", iso);
            OleRelease(iso);
        }
    }

    putDib();
    dib = fromClip("dib", doc, "Three", "dib", "diboff");

    if (dib) {
        dumpObject("dib", dib);
        drawRecords("dib", dib, 1);
        drawRecords("dib alone", dib, 0);
    }

    made = loadMade("bogus", doc, STATIC_BOGUS, sizeof STATIC_BOGUS);

    if (made) {
        OleRelease(made);
    }

    made = loadMade("generic", doc, GENERIC_NAMED, sizeof GENERIC_NAMED);
    knowAtom("Probe", "Probe");

    if (made) {
        other("generic", made, doc);
        direct("generic", made);
        dumpObject("generic again", made);
        OleRelease(made);
    }

    made = loadMade("noname", doc, GENERIC_NONAME, sizeof GENERIC_NONAME);

    if (made) {
        DWORD size = 0;

        formatName("noname", OleEnumFormats(made, 0));
        OleQuerySize(made, &size);
        wsprintf(probeResult, "%lu", size);
        probe("OleQuerySize", "noname", probeResult);
        OleRelease(made);
    }

    sizes(doc);
    equals(doc);
    longDraw(doc);
    words("doc", "objects", docBlock, 12);

    while (OleEnumObjects(doc, &each) == OLE_OK && each) {
        wsprintf(probeResult, "%s", each == mf ? "mf" : each == bm ? "bm" : each == dib ? "dib" : "?");
        probe("OleEnumObjects", "each", probeResult);
    }

    if (mf) {
        OleRename(mf, "Renamed");
        knowAtom("Renamed", "renamed");
        dumpObject("mf renamed", mf);
    }

    OleRenameClientDoc(doc, "C:\\ORACLE\\MEM2.DOC");
    knowAtom("C:\\ORACLE\\MEM2.DOC", "docname2");
    words("doc", "renamed", docBlock, 12);

    if (bm) {
        OleRelease(bm);
        words("doc", "bm released", docBlock, 12);

        if (mf) {
            dumpObject("mf after bm released", mf);
        }
    }

    if (mf) {
        OleRelease(mf);
    }

    if (dib) {
        OleRelease(dib);
    }

    words("doc", "empty", docBlock, 12);
    modes(doc);
    OleSavedClientDoc(doc);
    words("doc", "saved", docBlock, 12);
    OleRevokeClientDoc(second);
    OleRevokeClientDoc(doc);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    int i;

    (void)previous;
    (void)command;
    (void)show;

    self = instance;
    probeOpen(OUTPUT);

    kind.style = 0;
    kind.lpfnWndProc = Proc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = LoadCursor(NULL, IDC_ARROW);
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "OleMem";
    RegisterClass(&kind);
    window = CreateWindow("OleMem", "OleMem", WS_OVERLAPPEDWINDOW, 0, 0, 200, 100, NULL, NULL,
                          instance, NULL);

    ole = GetModuleHandle("OLECLI");

    for (i = 1; i < 1100; i++) {
        procs[i] = GetProcAddress(ole, MAKEINTRESOURCE(i));
    }

    buffer = (unsigned char far *)GlobalLock(GlobalAlloc(GMEM_MOVEABLE, 0x1000L));
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
