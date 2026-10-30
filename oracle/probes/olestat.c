/*
 * OLECLI's client documents and its static objects: pictures, bitmaps and
 * DIBs taken from the clipboard, kept in a document, written to a stream and
 * read back, drawn, queried, cloned, copied to the clipboard and let go; and
 * what each call answers for arguments that are not right.
 *
 * * `version`: OleQueryClientVersion.
 * * `doc`: OleRegisterClientDoc with good and bad arguments, and the other
 *   client document calls on a document with and without objects.
 * * `mf`, `bm`, `dib`: a static object made from each format on the
 *   clipboard, each query of it, its stream (every Put's size, then the
 *   bytes), loaded again from that stream, cloned, compared, drawn into a
 *   metafile and into a bitmap (the bitmap's pixels summed), copied to the
 *   clipboard (the formats there after), and the methods a static object
 *   refuses.
 * * `load`: OleLoadFromStream of streams made by hand: another version,
 *   other types, a class that is not, streams cut short.
 * * `bad`: the calls given a NULL object, document or pointer.
 *
 * Nothing that differs between machines is written: a handle or a pointer
 * is written as whether it is nought.
 */

#include "probe.h"
#include <ole.h>

#pragma library("olecli")

#define OUTPUT "C:\\ORACLE\\OLESTAT.OUT"

static HINSTANCE module;
static HWND window;

/* The stream: bytes put, and where the next get reads; `limit` cuts it short. */
static unsigned char far *buffer;
static DWORD length;
static DWORD readAt;
static DWORD limit;
static int logPuts;

typedef struct {
    LPOLESTREAMVTBL lpstbl;
} STREAM;

static OLESTREAMVTBL streamTable;
static STREAM stream;

static OLECLIENTVTBL clientTable;
static OLECLIENT client;

DWORD CALLBACK __export StreamGet(LPOLESTREAM self, void FAR *into, DWORD count)
{
    DWORD i;
    unsigned char far *bytes = (unsigned char far *)into;

    (void)self;

    if (readAt + count > limit) {
        count = readAt < limit ? limit - readAt : 0;
    }

    for (i = 0; i < count; i++) bytes[i] = buffer[(unsigned)(readAt + i)];

    readAt += count;

    return count;
}

DWORD CALLBACK __export StreamPut(LPOLESTREAM self, OLE_CONST void FAR *from, DWORD count)
{
    DWORD i;
    const unsigned char far *bytes = (const unsigned char far *)from;

    (void)self;

    if (logPuts) {
        wsprintf(probeArgs, "%lu", count);
        probe("Put", probeArgs, "");
    }

    if (length + count > 0x7000L) {
        return 0;
    }

    for (i = 0; i < count; i++) buffer[(unsigned)(length + i)] = bytes[i];

    length += count;

    return count;
}

int CALLBACK __export ClientCallBack(LPOLECLIENT self, OLE_NOTIFICATION what, LPOLEOBJECT object)
{
    (void)self;

    wsprintf(probeArgs, "%d,%s", (int)what, object ? "object" : "0");
    probe("CallBack", probeArgs, "");

    return 1;
}

LONG FAR PASCAL __export Proc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    return DefWindowProc(hwnd, message, wParam, lParam);
}

static void status(LPCSTR function, LPCSTR args, OLESTATUS answer)
{
    wsprintf(probeResult, "%u", (unsigned)answer);
    probe(function, args, probeResult);
}

/* The stream's bytes, sixteen to a record. */
static DWORD streamLong(DWORD at)
{
    return (DWORD)buffer[(unsigned)at] | (DWORD)buffer[(unsigned)at + 1] << 8 |
           (DWORD)buffer[(unsigned)at + 2] << 16 | (DWORD)buffer[(unsigned)at + 3] << 24;
}

/*
 * The stream's bytes, sixteen to a record, each in hexadecimal but those
 * that differ between machines, written `xx`: a picture's metafile's
 * handle in its METAFILEPICT, and the bytes of a block past what it holds
 * -- a metafile past its header's size, a DIB past its header, colours
 * and bits -- which are what the machine's memory held before.
 */
static void dumpStream(LPCSTR what)
{
    DWORD at;
    LPSTR out;
    unsigned i;
    DWORD data = 0;
    DWORD hmf = 0;
    DWORD end = length;
    DWORD klass = streamLong(8);

    wsprintf(probeResult, "%lu", length);
    probe("length", what, probeResult);

    if (length > 12 + klass + 12) {
        data = 12 + klass + 12;

        if (!lstrcmp((LPSTR)buffer + 12, "METAFILEPICT")) {
            hmf = data + 6;
            end = data + 8 + 2 * streamLong(data + 8 + 6);
        } else if (!lstrcmp((LPSTR)buffer + 12, "DIB")) {
            DWORD stride = ((streamLong(data + 4) * (buffer[(unsigned)data + 14] |
                                                     buffer[(unsigned)data + 15] << 8) + 31) / 32) * 4;
            unsigned bits = buffer[(unsigned)data + 14];
            DWORD colours = streamLong(data + 32) ? streamLong(data + 32) : (bits <= 8 ? 1L << bits : 0);

            end = data + streamLong(data) + colours * 4 + stride * streamLong(data + 8);
        }
    }

    for (at = 0; at < length; at += 32) {
        out = probeResult;

        for (i = 0; i < 32 && at + i < length; i++) {
            if ((hmf && (at + i == hmf || at + i == hmf + 1)) || at + i >= end) {
                out += wsprintf(out, "xx");
            } else {
                out += wsprintf(out, "%02x", buffer[(unsigned)(at + i)]);
            }
        }

        wsprintf(probeArgs, "%s@%lx", what, at);
        probe("bytes", probeArgs, probeResult);
    }
}

static void rewind(void)
{
    readAt = 0;
    limit = 0x7fffffffL;
}

static void clear(void)
{
    length = 0;
    rewind();
}

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

static HMETAFILE makeMetafile(void)
{
    HDC meta = CreateMetaFile(NULL);

    SetWindowOrg(meta, 0, 0);
    SetWindowExt(meta, 100, 50);
    Rectangle(meta, 0, 0, 100, 50);
    MoveTo(meta, 0, 0);
    LineTo(meta, 100, 50);
    Ellipse(meta, 10, 10, 60, 40);

    return CloseMetaFile(meta);
}

static HBITMAP makeBitmap(void)
{
    HDC screen = GetDC(NULL);
    HDC memory = CreateCompatibleDC(screen);
    HBITMAP bitmap = CreateCompatibleBitmap(screen, 48, 24);
    HBITMAP old = SelectObject(memory, bitmap);

    PatBlt(memory, 0, 0, 48, 24, WHITENESS);
    Rectangle(memory, 2, 2, 30, 20);
    MoveTo(memory, 0, 0);
    LineTo(memory, 47, 23);
    SelectObject(memory, old);
    DeleteDC(memory);
    ReleaseDC(NULL, screen);

    return bitmap;
}

/* A DIB of the bitmap, 4 bits to a pixel. */
static HGLOBAL makeDib(void)
{
    HBITMAP bitmap = makeBitmap();
    HDC screen = GetDC(NULL);
    HGLOBAL block = GlobalAlloc(GMEM_MOVEABLE, sizeof(BITMAPINFOHEADER) + 16 * 4 + 24 * 24);
    LPBITMAPINFOHEADER info = (LPBITMAPINFOHEADER)GlobalLock(block);

    info->biSize = sizeof(BITMAPINFOHEADER);
    info->biWidth = 48;
    info->biHeight = 24;
    info->biPlanes = 1;
    info->biBitCount = 4;
    info->biCompression = BI_RGB;
    info->biSizeImage = 0;
    info->biXPelsPerMeter = 0;
    info->biYPelsPerMeter = 0;
    info->biClrUsed = 0;
    info->biClrImportant = 0;
    GetDIBits(screen, bitmap, 0, 24, (LPSTR)info + sizeof(BITMAPINFOHEADER) + 16 * 4,
              (LPBITMAPINFO)info, DIB_RGB_COLORS);
    GlobalUnlock(block);
    ReleaseDC(NULL, screen);
    DeleteObject(bitmap);

    return block;
}

/* What is on the clipboard for a format, put there freshly. */
static void putOnClipboard(UINT format)
{
    OpenClipboard(window);
    EmptyClipboard();

    if (format == CF_METAFILEPICT) {
        HGLOBAL block = GlobalAlloc(GMEM_MOVEABLE | GMEM_DDESHARE, sizeof(METAFILEPICT));
        LPMETAFILEPICT picture = (LPMETAFILEPICT)GlobalLock(block);

        picture->mm = MM_ANISOTROPIC;
        picture->xExt = 2000;
        picture->yExt = 1000;
        picture->hMF = makeMetafile();
        GlobalUnlock(block);
        SetClipboardData(CF_METAFILEPICT, block);
    } else if (format == CF_BITMAP) {
        SetClipboardData(CF_BITMAP, makeBitmap());
    } else if (format == CF_DIB) {
        SetClipboardData(CF_DIB, makeDib());
    }
}

/* The pixels of a 64 by 32 bitmap an object is drawn into, summed. */
static void drawnPixels(LPCSTR what, LPOLEOBJECT object)
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

/* An object drawn into a metafile: the answer, the metafile's size. */
static void drawnMetafile(LPCSTR what, LPOLEOBJECT object)
{
    HDC meta = CreateMetaFile(NULL);
    RECT bounds;
    OLESTATUS answer;
    HMETAFILE done;
    HGLOBAL bits;

    SetRect(&bounds, 0, 0, 200, 100);
    wsprintf(probeResult, "%d", OleIsDcMeta(meta));
    probe("OleIsDcMeta", "metafile", probeResult);
    answer = OleDraw(object, meta, &bounds, &bounds, NULL);
    done = CloseMetaFile(meta);
    bits = GetMetaFileBits(done);
    wsprintf(probeResult, "%u %lu", (unsigned)answer, bits ? GlobalSize(bits) : 0L);
    probe("OleDraw", what, probeResult);
    DeleteMetaFile(SetMetaFileBits(bits));
}

/* Each query of an object. */
static void queries(LPCSTR what, LPOLEOBJECT object)
{
    LONG type = -1;
    RECT bounds;
    OLECLIPFORMAT format;
    DWORD size = 0;
    char name[64];
    UINT count;
    HANDLE data = 0;
    LPSTR out;
    OLESTATUS answer;

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

        /* A registered format by its name: its number is the machine's. */
        if (format >= 0xc000) {
            char registered[32];
            int count = GetClipboardFormatName(format, registered, sizeof registered);
            int c;

            out += wsprintf(out, "registered:");

            for (c = 0; c < count; c++) {
                out += wsprintf(out, "%02x", (unsigned char)registered[c]);
            }

            out += wsprintf(out, ",");
        } else {
            out += wsprintf(out, "%u,", format);
        }
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

    count = 3;
    lstrcpy(name, "????????");
    answer = OleQueryName(object, name, &count);
    wsprintf(probeResult, "%u %u %s", (unsigned)answer, count, (LPSTR)name);
    probe("OleQueryName", "short", probeResult);

    count = 0;
    answer = OleQueryName(object, name, &count);
    wsprintf(probeResult, "%u %u", (unsigned)answer, count);
    probe("OleQueryName", "none", probeResult);

    for (format = 1; format <= 8; format++) {
        data = 0;
        answer = OleGetData(object, format, &data);
        wsprintf(probeArgs, "%s,%u", what, format);
        wsprintf(probeResult, "%u %s", (unsigned)answer, data ? "handle" : "0");

        if (answer == OLE_OK && format == CF_METAFILEPICT && data) {
            LPMETAFILEPICT picture = (LPMETAFILEPICT)GlobalLock(data);

            wsprintf(probeResult + lstrlen(probeResult), " %d %d %d %s", picture->mm, picture->xExt,
                     picture->yExt, picture->hMF ? "hmf" : "0");
            GlobalUnlock(data);
        } else if (answer == OLE_OK && format == CF_BITMAP && data) {
            BITMAP info;

            GetObject(data, sizeof info, &info);
            wsprintf(probeResult + lstrlen(probeResult), " %d %d %d %d", info.bmWidth,
                     info.bmHeight, info.bmPlanes, info.bmBitsPixel);
        } else if (answer == OLE_OK && format == CF_DIB && data) {
            wsprintf(probeResult + lstrlen(probeResult), " %lu", GlobalSize(data));
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
    wsprintf(probeResult, "%s", OleQueryProtocol(object, "StdFileEditing") ? "table" : "0");
    probe("OleQueryProtocol", "StdFileEditing", probeResult);
    wsprintf(probeResult, "%s", OleQueryProtocol(object, "Static") ? "table" : "0");
    probe("OleQueryProtocol", "Static", probeResult);
    wsprintf(probeResult, "%s", OleQueryProtocol(object, "StdExecute") ? "table" : "0");
    probe("OleQueryProtocol", "StdExecute", probeResult);
}

/* The methods a static object refuses, and those it does. */
static void refusals(LPCSTR what, LPOLEOBJECT object)
{
    RECT bounds;
    OLEOPT_UPDATE update = (OLEOPT_UPDATE)7;
    OLESTATUS answer;
    LPOLEOBJECT other = NULL;
    LONG value = 0;

    SetRect(&bounds, 0, 0, 10, 10);
    status("OleSetHostNames", what, OleSetHostNames(object, "Probe", "Doc"));
    status("OleSetBounds", what, OleSetBounds(object, &bounds));
    status("OleSetTargetDevice", what, OleSetTargetDevice(object, NULL));
    status("OleSetColorScheme", what, OleSetColorScheme(object, NULL));
    status("OleActivate", what, OleActivate(object, 0, TRUE, TRUE, window, NULL));
    status("OleUpdate", what, OleUpdate(object));
    status("OleReconnect", what, OleReconnect(object));
    status("OleClose", what, OleClose(object));
    answer = OleGetLinkUpdateOptions(object, &update);
    wsprintf(probeResult, "%u %d", (unsigned)answer, (int)update);
    probe("OleGetLinkUpdateOptions", what, probeResult);
    status("OleSetLinkUpdateOptions", what, OleSetLinkUpdateOptions(object, oleupdate_oncall));
    status("OleSetData", what, OleSetData(object, CF_TEXT, NULL));
    status("OleRequestData", what, OleRequestData(object, CF_METAFILEPICT));
    status("OleRequestData", "nought", OleRequestData(object, 0));
    status("OleExecute", what, OleExecute(object, NULL, 0));
    answer = OleCopyFromLink(object, "StdFileEditing", &client, 0L, "x", &other);
    wsprintf(probeResult, "%u %s", (unsigned)answer, other ? "object" : "0");
    probe("OleCopyFromLink", what, probeResult);
    answer = OleObjectConvert(object, "Static", &client, 0L, "x", &other);
    wsprintf(probeResult, "%u %s", (unsigned)answer, other ? "object" : "0");
    probe("OleObjectConvert", what, probeResult);
    answer = OleLockServer(object, (LHSERVER FAR *)&value);
    wsprintf(probeResult, "%u %s", (unsigned)answer, value ? "server" : "0");
    probe("OleLockServer", what, probeResult);
}

/* One kind of static object, from making it to letting it go. */
static void staticObject(LPCSTR what, UINT format, LHCLIENTDOC doc)
{
    LPOLEOBJECT object = NULL;
    LPOLEOBJECT loaded = NULL;
    LPOLEOBJECT cloned = NULL;
    OLESTATUS answer;
    char args[40];

    probeNote(what);
    putOnClipboard(format);

    status("OleQueryCreateFromClip", "Static,draw", OleQueryCreateFromClip("Static", olerender_draw, 0));
    status("OleQueryCreateFromClip", "Static,none", OleQueryCreateFromClip("Static", olerender_none, 0));
    status("OleQueryCreateFromClip", "Static,format",
           OleQueryCreateFromClip("Static", olerender_format, format));
    status("OleQueryCreateFromClip", "StdFileEditing,draw",
           OleQueryCreateFromClip("StdFileEditing", olerender_draw, 0));
    status("OleQueryLinkFromClip", "StdFileEditing,draw",
           OleQueryLinkFromClip("StdFileEditing", olerender_draw, 0));
    status("OleQueryCreateFromClip", "Bogus,draw", OleQueryCreateFromClip("Bogus", olerender_draw, 0));

    answer = OleCreateFromClip("Static", &client, doc, "One", &object, olerender_draw, 0);
    wsprintf(probeResult, "%u %s", (unsigned)answer, object ? "object" : "0");
    probe("OleCreateFromClip", what, probeResult);
    CloseClipboard();

    if (!object) {
        return;
    }

    queries(what, object);

    status("OleRename", "Renamed", OleRename(object, "Renamed"));
    status("OleRename", "empty", OleRename(object, ""));
    queries("renamed", object);

    clear();
    logPuts = 1;
    status("OleSaveToStream", what, OleSaveToStream(object, (LPOLESTREAM)&stream));
    logPuts = 0;
    dumpStream(what);

    rewind();
    answer = OleLoadFromStream((LPOLESTREAM)&stream, "Static", &client, doc, "Two", &loaded);
    wsprintf(probeResult, "%u %s %lu", (unsigned)answer, loaded ? "object" : "0", readAt);
    probe("OleLoadFromStream", what, probeResult);

    rewind();
    answer = OleLoadFromStream((LPOLESTREAM)&stream, "StdFileEditing", &client, doc, "Three",
                               &cloned);
    wsprintf(probeResult, "%u %s %lu", (unsigned)answer, cloned ? "object" : "0", readAt);
    probe("OleLoadFromStream", "as StdFileEditing", probeResult);

    if (cloned) {
        status("OleRelease", "as StdFileEditing", OleRelease(cloned));
        cloned = NULL;
    }

    if (loaded) {
        queries("loaded", loaded);
        status("OleEqual", "loaded", OleEqual(object, loaded));
    }

    answer = OleClone(object, &client, doc, "Clone", &cloned);
    wsprintf(probeResult, "%u %s", (unsigned)answer, cloned ? "object" : "0");
    probe("OleClone", what, probeResult);

    if (cloned) {
        queries("cloned", cloned);
        status("OleEqual", "cloned", OleEqual(object, cloned));
        status("OleEqual", "self", OleEqual(object, object));
    }

    drawnMetafile(what, object);
    drawnPixels(what, object);

    {
        HDC screen = GetDC(NULL);

        wsprintf(probeResult, "%d", OleIsDcMeta(screen));
        probe("OleIsDcMeta", "screen", probeResult);
        ReleaseDC(NULL, screen);
    }

    OpenClipboard(window);
    EmptyClipboard();
    status("OleCopyToClipboard", what, OleCopyToClipboard(object));
    CloseClipboard();
    formats(what);

    refusals(what, object);

    {
        LPOLEOBJECT each = NULL;
        int count = 0;

        while (OleEnumObjects(doc, &each) == OLE_OK && each && count < 20) count++;

        wsprintf(probeResult, "%d", count);
        probe("OleEnumObjects", what, probeResult);
    }

    status("OleRevokeClientDoc", "with objects", OleRevokeClientDoc(doc));

    if (cloned) {
        status("OleDelete", "cloned", OleDelete(cloned));
    }

    if (loaded) {
        status("OleRelease", "loaded", OleRelease(loaded));
    }

    status("OleRelease", what, OleRelease(object));
    wsprintf(args, "%s released", what);
    wsprintf(probeResult, "%u", (unsigned)OleQueryReleaseStatus(object));
    probe("OleQueryReleaseStatus", args, probeResult);
}

/* A stream written by hand, read back. */
static void loadMade(LPCSTR what, LHCLIENTDOC doc, const unsigned char *bytes, unsigned count,
                     DWORD cut)
{
    LPOLEOBJECT object = NULL;
    OLESTATUS answer;
    unsigned i;

    clear();

    for (i = 0; i < count; i++) buffer[i] = bytes[i];

    length = count;
    rewind();
    limit = cut;

    answer = OleLoadFromStream((LPOLESTREAM)&stream, "Static", &client, doc, "Made", &object);
    wsprintf(probeResult, "%u %s %lu", (unsigned)answer, object ? "object" : "0", readAt);
    probe("OleLoadFromStream", what, probeResult);

    if (object) {
        queries(what, object);
        OleRelease(object);
    }
}

static const unsigned char HEADER_OTHER_OS[] = {0x01, 0x05, 0x01, 0x00, 0x03, 0x00, 0x00, 0x00};
static const unsigned char TYPE_NOUGHT[] = {0x01, 0x05, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00};
static const unsigned char TYPE_LINK[] = {0x01, 0x05, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00};
static const unsigned char TYPE_SIX[] = {0x01, 0x05, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00};
static const unsigned char STATIC_BOGUS[] = {0x01, 0x05, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00,
                                             0x06, 0x00, 0x00, 0x00, 'B',  'O',  'G',  'U',
                                             'S',  0x00, 0x10, 0x00, 0x00, 0x00, 0x08, 0x00,
                                             0x00, 0x00, 0x00, 0x00, 0x00, 0x00};
static const unsigned char STATIC_NONAME[] = {0x01, 0x05, 0x00, 0x00, 0x03, 0x00,
                                              0x00, 0x00, 0x00, 0x00, 0x00, 0x00};
static const unsigned char GENERIC_TEXT[] = {
    0x01, 0x05, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00, 0x07, 0x00, 0x00, 0x00, 'G',  'E',
    'N',  'E',  'R',  'I',  0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x05,
    0x00, 0x00, 0x00, 'h',  'e',  'l',  'l',  'o'};
static const unsigned char GENERIC_NAMED[] = {
    0x01, 0x05, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00, 0x07, 0x00, 0x00, 0x00, 'G',  'E',
    'N',  'E',  'R',  'I',  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x06,
    0x00, 0x00, 0x00, 'P',  'r',  'o',  'b',  'e',  0x00, 0x03, 0x00, 0x00, 0x00, 'a',
    'b',  'c'};

static void loads(LHCLIENTDOC doc)
{
    probeNote("load");
    loadMade("other os", doc, HEADER_OTHER_OS, sizeof HEADER_OTHER_OS, 0x7fffffffL);
    loadMade("type 0", doc, TYPE_NOUGHT, sizeof TYPE_NOUGHT, 0x7fffffffL);
    loadMade("type link as static", doc, TYPE_LINK, sizeof TYPE_LINK, 0x7fffffffL);
    loadMade("type 6", doc, TYPE_SIX, sizeof TYPE_SIX, 0x7fffffffL);
    loadMade("bogus class", doc, STATIC_BOGUS, sizeof STATIC_BOGUS, 0x7fffffffL);
    loadMade("no class", doc, STATIC_NONAME, sizeof STATIC_NONAME, 0x7fffffffL);
    loadMade("generic text", doc, GENERIC_TEXT, sizeof GENERIC_TEXT, 0x7fffffffL);
    loadMade("generic named", doc, GENERIC_NAMED, sizeof GENERIC_NAMED, 0x7fffffffL);
    loadMade("cut 0", doc, GENERIC_TEXT, sizeof GENERIC_TEXT, 0);
    loadMade("cut 6", doc, GENERIC_TEXT, sizeof GENERIC_TEXT, 6);
    loadMade("cut 14", doc, GENERIC_TEXT, sizeof GENERIC_TEXT, 14);
    loadMade("cut 30", doc, GENERIC_TEXT, sizeof GENERIC_TEXT, 30);
}

static void bad(LHCLIENTDOC doc)
{
    LHCLIENTDOC other = 0;
    LPOLEOBJECT object = NULL;
    LONG type = 0;
    RECT bounds;
    char name[16];
    UINT count = sizeof name;

    probeNote("bad");
    status("OleQueryType", "NULL", OleQueryType(NULL, &type));
    status("OleQueryBounds", "NULL", OleQueryBounds(NULL, &bounds));
    status("OleQueryName", "NULL", OleQueryName(NULL, name, &count));
    status("OleDelete", "NULL", OleDelete(NULL));
    status("OleRelease", "NULL", OleRelease(NULL));
    status("OleDraw", "NULL", OleDraw(NULL, NULL, &bounds, NULL, NULL));
    status("OleSaveToStream", "NULL", OleSaveToStream(NULL, (LPOLESTREAM)&stream));
    status("OleEqual", "NULL", OleEqual(NULL, NULL));
    status("OleCopyToClipboard", "NULL", OleCopyToClipboard(NULL));
    status("OleQueryReleaseStatus", "NULL", OleQueryReleaseStatus(NULL));
    status("OleQueryReleaseStatus", "text", OleQueryReleaseStatus((LPOLEOBJECT)(LPSTR) "not an object"));
    status("OleEnumFormats", "NULL", OleEnumFormats(NULL, 0));
    status("OleRegisterClientDoc", "empty", OleRegisterClientDoc("OLESTAT", "", 0L, &other));
    status("OleRegisterClientDoc", "NULL name", OleRegisterClientDoc("OLESTAT", NULL, 0L, &other));
    status("OleRegisterClientDoc", "NULL class", OleRegisterClientDoc(NULL, "Doc", 0L, &other));
    status("OleRegisterClientDoc", "NULL out", OleRegisterClientDoc("OLESTAT", "Doc", 0L, NULL));
    status("OleRevokeClientDoc", "0", OleRevokeClientDoc(0L));
    status("OleRevokeClientDoc", "text", OleRevokeClientDoc((LHCLIENTDOC)(LPSTR) "CD not a doc"));
    status("OleRenameClientDoc", "0", OleRenameClientDoc(0L, "X"));
    status("OleSavedClientDoc", "0", OleSavedClientDoc(0L));
    status("OleRevertClientDoc", "0", OleRevertClientDoc(0L));
    status("OleEnumObjects", "0", OleEnumObjects(0L, &object));
    status("OleCreateFromClip", "bad doc",
           OleCreateFromClip("Static", &client, 0L, "x", &object, olerender_draw, 0));
    status("OleCreateFromClip", "empty name",
           OleCreateFromClip("Static", &client, doc, "", &object, olerender_draw, 0));
    status("OleCreateFromClip", "NULL out",
           OleCreateFromClip("Static", &client, doc, "x", NULL, olerender_draw, 0));
    status("OleCreateFromClip", "bogus protocol",
           OleCreateFromClip("Bogus", &client, doc, "x", &object, olerender_draw, 0));
    status("OleCreate", "bogus class",
           OleCreate("StdFileEditing", &client, "NoSuchClass", doc, "x", &object, olerender_draw, 0));
    status("OleCreate", "Static", OleCreate("Static", &client, "Pbrush", doc, "x", &object,
                                            olerender_draw, 0));
    status("OleLoadFromStream", "bad doc",
           OleLoadFromStream((LPOLESTREAM)&stream, "Static", &client, 0L, "x", &object));
    status("OleLoadFromStream", "bad protocol",
           OleLoadFromStream((LPOLESTREAM)&stream, "Bogus", &client, doc, "x", &object));
}

static void docs(void)
{
    LHCLIENTDOC doc = 0;
    LHCLIENTDOC second = 0;
    OLESTATUS answer;
    LPOLEOBJECT each = NULL;

    probeNote("doc");
    answer = OleRegisterClientDoc("OLESTAT", "C:\\ORACLE\\DOC1.STA", 0L, &doc);
    wsprintf(probeResult, "%u %s", (unsigned)answer, doc ? "doc" : "0");
    probe("OleRegisterClientDoc", "doc1", probeResult);

    answer = OleRegisterClientDoc("OLESTAT", "C:\\ORACLE\\DOC1.STA", 0L, &second);
    wsprintf(probeResult, "%u %s %s", (unsigned)answer, second ? "doc" : "0",
             second == doc ? "same" : "other");
    probe("OleRegisterClientDoc", "doc1 again", probeResult);

    status("OleEnumObjects", "empty", OleEnumObjects(doc, &each));
    wsprintf(probeResult, "%s", each ? "object" : "0");
    probe("OleEnumObjects", "empty out", probeResult);
    status("OleRenameClientDoc", "doc1", OleRenameClientDoc(doc, "C:\\ORACLE\\DOC2.STA"));
    status("OleRenameClientDoc", "same", OleRenameClientDoc(doc, "C:\\ORACLE\\DOC2.STA"));
    status("OleSavedClientDoc", "doc1", OleSavedClientDoc(doc));
    status("OleRevertClientDoc", "doc1", OleRevertClientDoc(doc));

    staticObject("mf", CF_METAFILEPICT, doc);
    staticObject("bm", CF_BITMAP, doc);
    staticObject("dib", CF_DIB, doc);
    loads(doc);
    bad(doc);

    status("OleRevokeClientDoc", "second", OleRevokeClientDoc(second));
    status("OleRevokeClientDoc", "doc1", OleRevokeClientDoc(doc));
    status("OleRevokeClientDoc", "again", OleRevokeClientDoc(doc));
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    DWORD version;

    (void)previous;
    (void)command;
    (void)show;

    module = instance;
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
    kind.lpszClassName = "OleStat";
    RegisterClass(&kind);
    window = CreateWindow("OleStat", "OleStat", WS_OVERLAPPEDWINDOW, 0, 0, 200, 100, NULL, NULL,
                          instance, NULL);

    buffer = (unsigned char far *)GlobalLock(GlobalAlloc(GMEM_MOVEABLE, 0x7400L));

    streamTable.Get = (DWORD(CALLBACK *)(LPOLESTREAM, void FAR *, DWORD))MakeProcInstance(
        (FARPROC)StreamGet, instance);
    streamTable.Put = (DWORD(CALLBACK *)(LPOLESTREAM, OLE_CONST void FAR *, DWORD))MakeProcInstance(
        (FARPROC)StreamPut, instance);
    stream.lpstbl = &streamTable;
    clientTable.CallBack = (int(CALLBACK *)(LPOLECLIENT, OLE_NOTIFICATION, LPOLEOBJECT))
        MakeProcInstance((FARPROC)ClientCallBack, instance);
    client.lpvtbl = &clientTable;

    version = OleQueryClientVersion();
    wsprintf(probeResult, "%08lx", version);
    probe("OleQueryClientVersion", "", probeResult);

    docs();

    DestroyWindow(window);
    probeFinish();

    return 0;
}
