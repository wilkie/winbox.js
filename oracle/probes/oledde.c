/*
 * The conversation OLECLI holds with a server of embedded and linked
 * objects. The probe registers its second program, `OLEDDEC.EXE`, as the
 * server of the class `OleDdeProbe` in the registration database; that
 * program speaks OLE 1.0's DDE protocol by hand and writes into this
 * probe's file every message it is sent (`srv.` records), so the file
 * holds both sides in the order they happened: each call the client
 * makes, what it answers, each notification its client is told, and each
 * DDE message the server received.
 *
 * * `create`: `OleCreate`, waited for to its release; the object's
 *   queries; a change the server tells; host names, bounds, a colour
 *   scheme, a target device and data set; `OleUpdate`, `OleExecute`,
 *   `OleActivate`, the object saved to a stream, `OleClose`, activated
 *   again, closed by the server, deleted.
 * * `load`: that stream loaded, activated and released while open.
 * * `link`: a link to a file's item, updated, closed, reconnected,
 *   released.
 * * `invisible`, `fromfile`, `lock`: the other ways to start a server.
 *
 * Each record of a client is written with the file opened and closed
 * around it, as the server's are, so neither writes over the other.
 */

#include "probe.h"
#include <ole.h>
#include <shellapi.h>

#pragma library("olecli")
#pragma library("shell")

/* `olepbd` builds this probe as the class `PBrush`, its server `OLEPBDC.EXE`. */
#ifndef OUTPUT
#define OUTPUT "C:\\ORACLE\\OLEDDE.OUT"
#define CLASS "OleDdeProbe"
#define SERVER "OLEDDEC.EXE"
#endif

#ifdef NATIVE_BMP
#include "olebmp.h"
#endif

static HWND window;
static HINSTANCE self;
static int ticks;

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

static LPOLEOBJECT objects[12];
static int heard[16];
static int gone[12];
static UINT cfNative;

static void say(LPCSTR function, LPCSTR args, LPCSTR result)
{
    char line[2400];
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

/* An object by the number it was made with; `?` for none of ours. */
static int which(LPOLEOBJECT object)
{
    int i;

    for (i = 0; i < 12; i++) {
        if (object && objects[i] == object) {
            return i;
        }
    }

    return -1;
}

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
    DWORD i;
    const unsigned char far *bytes = (const unsigned char far *)from;

    (void)me;

    if (length + count > 0x3000L) {
        return 0;
    }

    for (i = 0; i < count; i++) buffer[(unsigned)(length + i)] = bytes[i];

    length += count;

    return count;
}

int CALLBACK __export ClientCallBack(LPOLECLIENT me, OLE_NOTIFICATION what, LPOLEOBJECT object)
{
    char args[40];
    char result[40];

    (void)me;

    if (what == OLE_QUERY_PAINT) {
        return 1;
    }

    wsprintf(args, "%d,%d", (int)what, which(object));
    result[0] = 0;

    if (what == OLE_RELEASE && object) {
        wsprintf(result, "%u %u", (unsigned)OleQueryReleaseError(object),
                 (unsigned)OleQueryReleaseMethod(object));
    }

    say("CallBack", args, result);

    if ((int)what < 16) {
        heard[what]++;
    }

    if (what == OLE_RELEASE && which(object) >= 0) {
        gone[which(object)]++;
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

/* Messages handled until `done` or 30 ticks of a half-second timer. */
static int pumpUntil(int (*done)(int), int arg)
{
    MSG msg;

    ticks = 0;
    SetTimer(window, 1, 500, NULL);

    while (!done(arg) && ticks < 30) {
        if (GetMessage(&msg, NULL, 0, 0)) {
            TranslateMessage(&msg);
            DispatchMessage(&msg);
        }
    }

    KillTimer(window, 1);

    return done(arg);
}

static int released(int i)
{
    return OleQueryReleaseStatus(objects[i]) != OLE_BUSY;
}

static int releasedTold(int i)
{
    return gone[i] > 0;
}

static int serverGone(int unused)
{
    (void)unused;
    return FindWindow("OleDdeSrv", NULL) == NULL;
}

static int told(int what)
{
    return heard[what] > 0;
}

/* A call's answer, and the wait for its release where it is to be waited for. */
static void answered(LPCSTR function, int i, OLESTATUS answer)
{
    char args[8];
    char result[40];

    int ending = !lstrcmp(function, "OleRelease") || !lstrcmp(function, "OleDelete");

    wsprintf(args, "%d", i);
    wsprintf(result, "%u", (unsigned)answer);
    gone[i] = 0;
    say(function, args, result);

    if (ending) {
        if (answer == OLE_WAIT_FOR_RELEASE) {
            say("wait", args, pumpUntil(releasedTold, i) ? "told" : "timeout");
        }

        if (answer == OLE_OK || answer == OLE_WAIT_FOR_RELEASE) {
            objects[i] = NULL;
        }

        return;
    }

    if (answer == OLE_WAIT_FOR_RELEASE && objects[i]) {
        int ok = pumpUntil(released, i);

        wsprintf(result, "%s %u", ok ? "released" : "timeout",
                 (unsigned)OleQueryReleaseStatus(objects[i]));
        say("wait", args, result);
    }
}

/* The server's main window, for the probe to ask it to change or close. */
static void ask(LPCSTR what, UINT message, int notification)
{
    HWND server = FindWindow("OleDdeSrv", NULL);
    int ok;

    say("ask", what, server ? "server" : "none");

    if (!server) {
        return;
    }

    heard[notification] = 0;
    PostMessage(server, message, 0, 0L);
    ok = pumpUntil(told, notification);
    say("asked", what, ok ? "told" : "timeout");
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

static void queries(int i)
{
    LPOLEOBJECT object = objects[i];
    LONG type = -1;
    RECT bounds;
    OLECLIPFORMAT format;
    char args[40];
    char result[200];
    char name[64];
    UINT count;
    HANDLE data;
    LPSTR out;
    OLESTATUS answer;
    DWORD size = 0;
    OLEOPT_UPDATE update = (OLEOPT_UPDATE)7;

    wsprintf(args, "%d", i);
    wsprintf(result, "%u", (unsigned)OleQueryOpen(object));
    say("OleQueryOpen", args, result);
    wsprintf(result, "%u", (unsigned)OleQueryReleaseStatus(object));
    say("OleQueryReleaseStatus", args, result);
    answer = OleQueryType(object, &type);
    wsprintf(result, "%u %ld", (unsigned)answer, type);
    say("OleQueryType", args, result);
    SetRect(&bounds, -1, -1, -1, -1);
    answer = OleQueryBounds(object, &bounds);
    wsprintf(result, "%u %d,%d,%d,%d", (unsigned)answer, bounds.left, bounds.top, bounds.right,
             bounds.bottom);
    say("OleQueryBounds", args, result);
    answer = OleQuerySize(object, &size);
    wsprintf(result, "%u %lu", (unsigned)answer, size);
    say("OleQuerySize", args, result);
    count = sizeof name;
    lstrcpy(name, "?");
    answer = OleQueryName(object, name, &count);
    wsprintf(result, "%u %s", (unsigned)answer, (LPSTR)name);
    say("OleQueryName", args, result);
    wsprintf(result, "%u", (unsigned)OleQueryOutOfDate(object));
    say("OleQueryOutOfDate", args, result);
    answer = OleGetLinkUpdateOptions(object, &update);
    wsprintf(result, "%u %d", (unsigned)answer, (int)update);
    say("OleGetLinkUpdateOptions", args, result);

    out = result;
    *out = 0;
    format = 0;

    do {
        format = OleEnumFormats(object, format);
        out = formatText(out, format);
        *out++ = ',';
        *out = 0;
    } while (format && out - result < 150);

    say("OleEnumFormats", args, result);
    format = 0;

    while ((format = OleEnumFormats(object, format)) != 0) {
        data = 0;
        answer = OleGetData(object, format, &data);
        out = args + wsprintf(args, "%d,", i);
        formatText(out, format);
        out = result + wsprintf(result, "%u %s", (unsigned)answer, data ? "handle" : "0");

        if (answer == OLE_OK && data && format == CF_METAFILEPICT) {
            LPMETAFILEPICT picture = (LPMETAFILEPICT)GlobalLock(data);

            wsprintf(out, " %d %d %d", picture->mm, picture->xExt, picture->yExt);
            GlobalUnlock(data);
        } else if (answer == OLE_OK && data && format == cfNative) {
            LPBYTE bytes = (LPBYTE)GlobalLock(data);
            int k;

            /* The sixteen bytes every Native here has. */
            for (k = 0; k < 16; k++) {
                out += wsprintf(out, " %02x", bytes[k]);
            }

            GlobalUnlock(data);
        } else if (answer == OLE_OK && data && format != CF_BITMAP) {
            /* OwnerLink, ObjectLink: class, document, item. */
            LPSTR text = (LPSTR)GlobalLock(data);
            LPSTR second = text + lstrlen(text) + 1;
            LPSTR third = second + lstrlen(second) + 1;

            wsprintf(out, " %s|%s|%s", text, second, third);
            GlobalUnlock(data);
        }

        say("OleGetData", args, result);
        wsprintf(args, "%d", i);
    }
}

/* The pixels of a 64 by 32 bitmap the object is drawn into, summed. */
static void drawn(int i)
{
    HDC screen = GetDC(NULL);
    HDC memory = CreateCompatibleDC(screen);
    HBITMAP bitmap = CreateCompatibleBitmap(screen, 64, 32);
    HBITMAP old = SelectObject(memory, bitmap);
    RECT bounds;
    OLESTATUS answer;
    DWORD sum = 0;
    char args[8];
    int x;
    int y;

    PatBlt(memory, 0, 0, 64, 32, WHITENESS);
    SetRect(&bounds, 4, 2, 60, 30);
    answer = OleDraw(objects[i], memory, &bounds, NULL, NULL);

    for (y = 0; y < 32; y++) {
        for (x = 0; x < 64; x++) {
            sum = sum * 31 + (GetPixel(memory, x, y) & 0xffffffL);
        }
    }

    wsprintf(args, "%d", i);
    wsprintf(probeResult, "%u %08lx", (unsigned)answer, sum);
    say("OleDraw", args, probeResult);
    SelectObject(memory, old);
    DeleteObject(bitmap);
    DeleteDC(memory);
    ReleaseDC(NULL, screen);
}

/* The stream being read back, a field at a time. */
static unsigned at;

static DWORD getLong(void)
{
    DWORD value = (DWORD)buffer[at] | (DWORD)buffer[at + 1] << 8 | (DWORD)buffer[at + 2] << 16 |
                  (DWORD)buffer[at + 3] << 24;

    at += 4;
    return value;
}

static void getString(LPSTR out)
{
    DWORD count = getLong();

    lstrcpyn(out, (LPCSTR)buffer + at, count ? (int)count : 1);
    at += (unsigned)count;
}

/*
 * A stream written by OLECLI, a field at a time, as MS-OLEDS lays it out.
 * The bytes a block holds past what was put in it -- a Native block's or a
 * metafile's rounded up to its size -- are what the machine's memory held,
 * and are counted rather than written; so is a metafile's handle.
 */
static void dumpStream(LPCSTR what)
{
    char text[100];
    char result[240];
    LPSTR out;
    DWORD version;
    DWORD type;
    DWORD size;
    DWORD i;

    at = 0;
    wsprintf(result, "%lu", length);
    say("length", what, result);
    /* Each field read in its turn: the arguments of a call are not. */
    version = getLong();
    type = getLong();
    out = result + wsprintf(result, "%lx %lu ", version, type);
    getString(text);
    out += wsprintf(out, "%s", (LPSTR)text);
    say("stream", what, result);

    if (type == 1 || type == 2) {
        getString(text);
        out = result + wsprintf(result, "%s|", (LPSTR)text);
        getString(text);
        out += wsprintf(out, "%s", (LPSTR)text);
        say("stream topic", what, result);
    }

    if (type == 2) {
        size = getLong();
        out = result + wsprintf(result, "%lu", size);

        for (i = 0; i < size && i < 16; i++) {
            out += wsprintf(out, " %02x", buffer[at + (unsigned)i]);
        }

        say("stream native", what, result);
        at += (unsigned)size;
    } else if (type == 1) {
        getString(text);
        out = result + wsprintf(result, "%s|", (LPSTR)text);
        out += wsprintf(out, "%lu ", getLong());
        wsprintf(out, "%lu", getLong());
        say("stream link", what, result);
    }

    version = getLong();
    type = getLong();
    out = result + wsprintf(result, "%lx %lu ", version, type);

    if (type == 5) {
        LPBYTE meta;
        DWORD words;

        getString(text);
        out += wsprintf(out, "%s ", (LPSTR)text);
        out += wsprintf(out, "%ld ", (LONG)getLong());
        out += wsprintf(out, "%ld ", (LONG)getLong());
        size = getLong();
        out += wsprintf(out, "%lu ", size);
        out += wsprintf(out, "%d %d %d", *(short far *)(buffer + at), *(short far *)(buffer + at + 2),
                        *(short far *)(buffer + at + 4));
        say("stream picture", what, result);
        meta = buffer + at + 8;
        words = (DWORD)meta[6] | (DWORD)meta[7] << 8 | (DWORD)meta[8] << 16;

        for (i = 0; i < words * 2; i += 32) {
            DWORD j;

            out = result;

            for (j = i; j < i + 32 && j < words * 2; j++) {
                out += wsprintf(out, "%02x", meta[(unsigned)j]);
            }

            wsprintf(text, "%s@%lx", what, i);
            say("metafile", text, result);
        }

        at += (unsigned)size;
    } else {
        say("stream picture", what, result);
    }

    wsprintf(result, "%u", at);
    say("stream end", what, result);
}

static void reg(LPCSTR key, LPCSTR value)
{
    char result[16];

    wsprintf(result, "%ld", RegSetValue(HKEY_CLASSES_ROOT, key, REG_SZ, value, lstrlen(value)));
    say("RegSetValue", key, result);
}

/* A file the link is to; its contents are not read by OLECLI. */
static void linkFile(void)
{
    HFILE file = _lcreat("C:\\ORACLE\\OLEDDE.LNK", 0);

    _lwrite(file, "link", 4);
    _lclose(file);
}

static void setters(int i)
{
    RECT bounds;
    HGLOBAL scheme;
    LPLOGPALETTE palette;
    HGLOBAL device;
    LPBYTE bytes;
    OLETARGETDEVICE far *target;
    HGLOBAL native;
    LPBYTE n;
    int k;

    answered("OleSetHostNames", i, OleSetHostNames(objects[i], "Probe Client", "Probe Object"));
    SetRect(&bounds, 0, 0, 1500, -750);
    answered("OleSetBounds", i, OleSetBounds(objects[i], &bounds));

    scheme = GlobalAlloc(GMEM_MOVEABLE, sizeof(LOGPALETTE) + 3 * sizeof(PALETTEENTRY));
    palette = (LPLOGPALETTE)GlobalLock(scheme);
    palette->palVersion = 0x300;
    palette->palNumEntries = 4;

    for (k = 0; k < 4; k++) {
        palette->palPalEntry[k].peRed = (BYTE)(k * 0x40);
        palette->palPalEntry[k].peGreen = (BYTE)(0x10 + k);
        palette->palPalEntry[k].peBlue = (BYTE)(0xff - k);
        palette->palPalEntry[k].peFlags = 0;
    }

    answered("OleSetColorScheme", i, OleSetColorScheme(objects[i], palette));
    GlobalUnlock(scheme);
    GlobalFree(scheme);

    device = GlobalAlloc(GMEM_MOVEABLE, 64);
    bytes = (LPBYTE)GlobalLock(device);
    target = (OLETARGETDEVICE far *)bytes;
    target->otdDeviceNameOffset = 0;
    target->otdDriverNameOffset = 14;
    target->otdPortNameOffset = 22;
    target->otdExtDevmodeOffset = 28;
    target->otdExtDevmodeSize = 0;
    target->otdEnvironmentOffset = 28;
    target->otdEnvironmentSize = 0;
    lstrcpy((LPSTR)bytes + 14, "Probe Printer");
    lstrcpy((LPSTR)bytes + 14 + 14, "PSCRIPT");
    lstrcpy((LPSTR)bytes + 14 + 22, "LPT1:");
    GlobalUnlock(device);
    answered("OleSetTargetDevice", i, OleSetTargetDevice(objects[i], device));
    GlobalFree(device);

#ifdef NATIVE_BMP
    native = GlobalAlloc(GMEM_MOVEABLE | GMEM_DDESHARE, OLEBMP_SIZE);
    n = (LPBYTE)GlobalLock(native);
    oleBmp(n, 7);
#else
    native = GlobalAlloc(GMEM_MOVEABLE | GMEM_DDESHARE, 16);
    n = (LPBYTE)GlobalLock(native);

    for (k = 0; k < 16; k++) {
        n[k] = (BYTE)(0x70 + k);
    }
#endif

    GlobalUnlock(native);
    answered("OleSetData", i, OleSetData(objects[i], cfNative, native));
}

static void make(LPCSTR what, int i, OLESTATUS answer)
{
    char result[40];
    char args[40];

    wsprintf(args, "%d", i);
    wsprintf(result, "%u %s", (unsigned)answer, objects[i] ? "object" : "0");
    say(what, args, result);

    if (answer == OLE_WAIT_FOR_RELEASE && objects[i]) {
        int ok = pumpUntil(released, i);

        wsprintf(result, "%s %u", ok ? "released" : "timeout",
                 (unsigned)OleQueryReleaseStatus(objects[i]));
        say("wait", args, result);
    }
}

/* A block of `GMEM_DDESHARE` holding the bytes given. */
static HGLOBAL shared(const char far *bytes, unsigned count)
{
    HGLOBAL block = GlobalAlloc(GMEM_MOVEABLE | GMEM_DDESHARE, count);
    LPBYTE into = (LPBYTE)GlobalLock(block);
    unsigned i;

    for (i = 0; i < count; i++) into[i] = bytes[i];

    GlobalUnlock(block);
    return block;
}

/* A picture for the clipboard: a rectangle and an ellipse, 2000 by 1000. */
static HGLOBAL picture(void)
{
    HDC meta = CreateMetaFile(NULL);
    HGLOBAL block;
    LPMETAFILEPICT p;

    SetWindowOrg(meta, 0, 0);
    SetWindowExt(meta, 100, 50);
    Rectangle(meta, 0, 0, 100, 50);
    Ellipse(meta, 20, 10, 80, 40);
    block = GlobalAlloc(GMEM_MOVEABLE | GMEM_DDESHARE, sizeof(METAFILEPICT));
    p = (LPMETAFILEPICT)GlobalLock(block);
    p->mm = MM_ANISOTROPIC;
    p->xExt = 2000;
    p->yExt = 1000;
    p->hMF = CloseMetaFile(meta);
    GlobalUnlock(block);
    return block;
}

/* The clipboard's formats, in its order. */
static void formats(LPCSTR what)
{
    UINT format = 0;
    char result[200];
    LPSTR out = result;

    *out = 0;
    OpenClipboard(window);

    while ((format = EnumClipboardFormats(format)) != 0) {
        out = formatText(out, format);
        *out++ = ',';
        *out = 0;
    }

    CloseClipboard();
    say("formats", what, result);
}

/*
 * Objects made from the clipboard: an embedded one from `OwnerLink`,
 * `Native` and a picture, and a link from `ObjectLink`; cloned, compared,
 * copied back to the clipboard, let go.
 */
static void clip(LHCLIENTDOC doc)
{
    static const char owner[] = "OleDdeProbe\0C:\\ORACLE\\OLEDDE.LNK\0Item3\0";
    char native[16];
    char result[40];
    int k;

    for (k = 0; k < 16; k++) {
        native[k] = (char)(0x60 + k);
    }

#ifdef NATIVE_BMP
    {
        static char bmp[OLEBMP_SIZE];

        oleBmp((BYTE far *)bmp, 3);
        OpenClipboard(window);
        EmptyClipboard();
        SetClipboardData(cfNative, shared(bmp, OLEBMP_SIZE));
    }
#else
    OpenClipboard(window);
    EmptyClipboard();
    SetClipboardData(cfNative, shared(native, 16));
#endif
    SetClipboardData(RegisterClipboardFormat("OwnerLink"), shared(owner, sizeof owner));
    SetClipboardData(CF_METAFILEPICT, picture());
    SetClipboardData(RegisterClipboardFormat("ObjectLink"), shared(owner, sizeof owner));
    CloseClipboard();
    formats("put");

    OpenClipboard(window);
    wsprintf(result, "%u", (unsigned)OleQueryCreateFromClip("StdFileEditing", olerender_draw, 0));
    say("OleQueryCreateFromClip", "std", result);
    wsprintf(result, "%u", (unsigned)OleQueryLinkFromClip("StdFileEditing", olerender_draw, 0));
    say("OleQueryLinkFromClip", "std", result);
    make("OleCreateFromClip", 6,
         OleCreateFromClip("StdFileEditing", &client, doc, "Clip1", &objects[6], olerender_draw, 0));
    make("OleCreateLinkFromClip", 7,
         OleCreateLinkFromClip("StdFileEditing", &client, doc, "Clip2", &objects[7], olerender_draw,
                               0));
    CloseClipboard();

    if (objects[6]) {
        queries(6);
        drawn(6);
        make("OleClone", 8, OleClone(objects[6], &client, doc, "Clip3", &objects[8]));
    }

    if (objects[8]) {
        queries(8);
        wsprintf(result, "%u", (unsigned)OleEqual(objects[6], objects[8]));
        say("OleEqual", "6,8", result);
        answered("OleRelease", 8, OleRelease(objects[8]));
    }

    if (objects[7]) {
        queries(7);
        drawn(7);
    }

    if (objects[6] && objects[7]) {
        wsprintf(result, "%u", (unsigned)OleEqual(objects[6], objects[7]));
        say("OleEqual", "6,7", result);
    }

    if (objects[6]) {
        OpenClipboard(window);
        EmptyClipboard();
        wsprintf(result, "%u", (unsigned)OleCopyToClipboard(objects[6]));
        say("OleCopyToClipboard", "6", result);
        CloseClipboard();
        formats("copied");
        answered("OleRelease", 6, OleRelease(objects[6]));
    }

    if (objects[7]) {
        OpenClipboard(window);
        EmptyClipboard();
        wsprintf(result, "%u", (unsigned)OleCopyToClipboard(objects[7]));
        say("OleCopyToClipboard", "7", result);
        CloseClipboard();
        formats("copied link");
        answered("OleRelease", 7, OleRelease(objects[7]));
    }
}

static void run(void)
{
    LHCLIENTDOC doc = 0;
    OLESTATUS answer;
    RECT bounds;
    HGLOBAL commands;
    LHSERVER server = 0;
    char result[40];

    reg(CLASS, "OLE DDE Probe");
    reg(CLASS "\\protocol\\StdFileEditing\\server", SERVER);
    reg(CLASS "\\protocol\\StdFileEditing\\verb\\0", "Edit");
    reg(CLASS "\\protocol\\StdFileEditing\\verb\\1", "Play");
    reg(CLASS "\\protocol\\StdExecute\\server", SERVER);
    linkFile();

    answer = OleRegisterClientDoc("OleDdeClient", "C:\\ORACLE\\OLEDDE.DOC", 0L, &doc);
    wsprintf(result, "%u", (unsigned)answer);
    say("OleRegisterClientDoc", "doc", result);

    if (!doc) {
        return;
    }

    note("create");
    make("OleCreate", 0,
         OleCreate("StdFileEditing", &client, CLASS, doc, "Obj1", &objects[0], olerender_draw, 0));

    if (!objects[0]) {
        return;
    }

    queries(0);
    drawn(0);

    note("save");
    ask("save", WM_USER + 2, OLE_SAVED);
    queries(0);
    drawn(0);

    note("set");
    setters(0);
    queries(0);

    note("update");
    answered("OleUpdate", 0, OleUpdate(objects[0]));
    queries(0);
    answered("OleRequestData", 0, OleRequestData(objects[0], cfNative));
    answered("OleRequestData", 0, OleRequestData(objects[0], CF_TEXT));
    answered("OleQueryReleaseError", 0, OleQueryReleaseError(objects[0]));

    note("execute");
    commands = GlobalAlloc(GMEM_MOVEABLE | GMEM_DDESHARE, 32);
    lstrcpy((LPSTR)GlobalLock(commands), "[ProbeCommand(1)]");
    GlobalUnlock(commands);
    answered("OleExecute", 0, OleExecute(objects[0], commands, 0));
    GlobalFree(commands);

    note("activate");
    SetRect(&bounds, 10, 10, 50, 30);
    answered("OleActivate", 0, OleActivate(objects[0], OLEVERB_PRIMARY, TRUE, TRUE, window, &bounds));
    answered("OleActivate", 0, OleActivate(objects[0], 1, FALSE, FALSE, window, &bounds));

    note("stream");
    length = 0;
    answered("OleSaveToStream", 0, OleSaveToStream(objects[0], (LPOLESTREAM)&stream));
    dumpStream("embedded");

    note("close");
    answered("OleClose", 0, OleClose(objects[0]));
    queries(0);
    drawn(0);

    note("reopen");
    answered("OleActivate", 0, OleActivate(objects[0], OLEVERB_PRIMARY, TRUE, FALSE, window, &bounds));
    queries(0);

    note("server close");
    ask("close", WM_USER + 3, OLE_CLOSED);
    say("wait", "0", pumpUntil(released, 0) ? "released" : "timeout");
    queries(0);
    drawn(0);

    note("delete");
    answered("OleDelete", 0, OleDelete(objects[0]));

    note("load");
    readAt = 0;
    make("OleLoadFromStream", 1,
         OleLoadFromStream((LPOLESTREAM)&stream, "StdFileEditing", &client, doc, "Obj2",
                           &objects[1]));

    if (objects[1]) {
        queries(1);
        answered("OleActivate", 1, OleActivate(objects[1], OLEVERB_PRIMARY, FALSE, FALSE, window, &bounds));
        queries(1);
        answered("OleRelease", 1, OleRelease(objects[1]));
    }

    note("link");
    make("OleCreateLinkFromFile", 2,
         OleCreateLinkFromFile("StdFileEditing", &client, CLASS, "C:\\ORACLE\\OLEDDE.LNK", "Item1",
                               doc, "Link1", &objects[2], olerender_draw, 0));

    if (objects[2]) {
        queries(2);
        answered("OleActivate", 2, OleActivate(objects[2], OLEVERB_PRIMARY, TRUE, FALSE, window, &bounds));
        ask("change", WM_USER + 1, OLE_CHANGED);
        say("wait", "2", pumpUntil(released, 2) ? "released" : "timeout");
        queries(2);
        answered("OleUpdate", 2, OleUpdate(objects[2]));

        note("reconnect");
        make("OleCreateLinkFromFile", 5,
             OleCreateLinkFromFile("StdFileEditing", &client, CLASS, "C:\\ORACLE\\OLEDDE.LNK",
                                   "Item2", doc, "Link2", &objects[5], olerender_draw, 0));

        if (objects[5]) {
            queries(5);
            answered("OleClose", 5, OleClose(objects[5]));
            answered("OleReconnect", 5, OleReconnect(objects[5]));
            queries(5);
        }

        heard[OLE_CLOSED] = 0;
        ask("close", WM_USER + 3, OLE_CLOSED);
        say("wait", "2", pumpUntil(released, 2) ? "released" : "timeout");
        say("server", "2", pumpUntil(serverGone, 0) ? "gone" : "timeout");
        wsprintf(result, "%d", heard[OLE_CLOSED]);
        say("closed", "", result);
        queries(2);

        if (objects[5]) {
            answered("OleRelease", 5, OleRelease(objects[5]));
        }

        answered("OleReconnect", 2, OleReconnect(objects[2]));
        answered("OleSetLinkUpdateOptions", 2, OleSetLinkUpdateOptions(objects[2], oleupdate_oncall));
        queries(2);
        length = 0;
        answered("OleSaveToStream", 2, OleSaveToStream(objects[2], (LPOLESTREAM)&stream));
        dumpStream("linked");
        answered("OleRelease", 2, OleRelease(objects[2]));
    }

    note("invisible");
    make("OleCreateInvisible", 3,
         OleCreateInvisible("StdFileEditing", &client, CLASS, doc, "Obj3", &objects[3],
                            olerender_draw, 0, FALSE));

    if (objects[3]) {
        queries(3);
        answered("OleRelease", 3, OleRelease(objects[3]));
    }

    note("fromfile");
    make("OleCreateFromFile", 4,
         OleCreateFromFile("StdFileEditing", &client, CLASS, "C:\\ORACLE\\OLEDDE.LNK", doc, "Obj4",
                           &objects[4], olerender_draw, 0));

    if (objects[4]) {
        queries(4);

        note("lock");
        answer = OleLockServer(objects[4], &server);
        wsprintf(result, "%u %s", (unsigned)answer, server ? "server" : "0");
        say("OleLockServer", "4", result);
        answered("OleRelease", 4, OleRelease(objects[4]));

        if (server) {
            wsprintf(result, "%u", (unsigned)OleUnlockServer(server));
            say("OleUnlockServer", "4", result);
            say("server", "4", pumpUntil(serverGone, 0) ? "gone" : "timeout");
        }
    }

    note("clip");
    clip(doc);

    note("revoke");
    wsprintf(result, "%u", (unsigned)OleRevokeClientDoc(doc));
    say("OleRevokeClientDoc", "doc", result);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kindOf;
    HFILE file;

    (void)previous;
    (void)command;
    (void)show;

    self = instance;
    file = _lcreat(OUTPUT, 0);
    _lclose(file);

    kindOf.style = 0;
    kindOf.lpfnWndProc = Proc;
    kindOf.cbClsExtra = 0;
    kindOf.cbWndExtra = 0;
    kindOf.hInstance = instance;
    kindOf.hIcon = NULL;
    kindOf.hCursor = LoadCursor(NULL, IDC_ARROW);
    kindOf.hbrBackground = GetStockObject(WHITE_BRUSH);
    kindOf.lpszMenuName = NULL;
    kindOf.lpszClassName = "OleDde";
    RegisterClass(&kindOf);
    window = CreateWindow("OleDde", "OleDde", WS_OVERLAPPEDWINDOW, 0, 0, 200, 100, NULL, NULL,
                          instance, NULL);
    ShowWindow(window, SW_SHOWNORMAL);

    cfNative = RegisterClipboardFormat("Native");
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

    note("end");
    DestroyWindow(window);
    probeFinish();

    return 0;
}
