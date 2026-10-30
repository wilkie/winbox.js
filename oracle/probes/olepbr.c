/*
 * The conversation of `oledde` with a real server: Paintbrush, whose
 * `PBRUSH.EXE` speaks OLE 1.0 through Windows' own OLESVR. What its client
 * sees -- each call's answer, each notification, the object's queries and
 * its stream -- while a picture of the class `PBrush` is made, shown,
 * updated, named, closed, loaded back, opened hidden and let go.
 */

#include "probe.h"
#include <ole.h>
#include <shellapi.h>

#pragma library("olecli")
#pragma library("shell")

#define OUTPUT "C:\\ORACLE\\OLEPBR.OUT"
#define CLASS "PBrush"

static HWND window;
static HINSTANCE self;
static int ticks;

/* Paintbrush's Native is a whole bitmap file: a buffer past 64K. */
static unsigned char huge *buffer;
static DWORD length;
static DWORD readAt;

typedef struct {
    LPOLESTREAMVTBL lpstbl;
} STREAM;

static OLESTREAMVTBL streamTable;
static STREAM stream;
static OLECLIENTVTBL clientTable;
static OLECLIENT client;

static LPOLEOBJECT objects[8];
static int heard[16];
static int gone[8];
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

    for (i = 0; i < 8; i++) {
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

    for (i = 0; i < count; i++) bytes[(unsigned)i] = buffer[readAt + i];

    readAt += count;

    return count;
}

DWORD CALLBACK __export StreamPut(LPOLESTREAM me, OLE_CONST void FAR *from, DWORD count)
{
    DWORD i;
    const unsigned char far *bytes = (const unsigned char far *)from;

    (void)me;

    if (length + count > 0x40000L) {
        return 0;
    }

    for (i = 0; i < count; i++) buffer[length + i] = bytes[(unsigned)i];

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
    return FindWindow("pbParent", NULL) == NULL;
}

static int serverThere(int unused)
{
    return !serverGone(unused);
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
    HWND server = FindWindow("pbParent", NULL);
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
static DWORD at;

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

    lstrcpyn(out, (LPCSTR)(buffer + at), count ? (int)count : 1);
    at += count;
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
            out += wsprintf(out, " %02x", buffer[at + i]);
        }

        say("stream native", what, result);
        at += size;
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
        unsigned char huge *meta;
        DWORD words;

        getString(text);
        out += wsprintf(out, "%s ", (LPSTR)text);
        out += wsprintf(out, "%ld ", (LONG)getLong());
        out += wsprintf(out, "%ld ", (LONG)getLong());
        size = getLong();
        out += wsprintf(out, "%lu ", size);
        out += wsprintf(out, "%d %d %d", *(short huge *)(buffer + at), *(short huge *)(buffer + at + 2),
                        *(short huge *)(buffer + at + 4));
        say("stream picture", what, result);
        meta = buffer + at + 8;
        words = (DWORD)meta[6] | (DWORD)meta[7] << 8 | (DWORD)meta[8] << 16;

        for (i = 0; i < words * 2 && i < 32; i += 32) {
            DWORD j;

            out = result;

            for (j = i; j < i + 32 && j < words * 2; j++) {
                out += wsprintf(out, "%02x", meta[j]);
            }

            wsprintf(text, "%s@%lx", what, i);
            say("metafile", text, result);
        }

        at += size;
    } else {
        say("stream picture", what, result);
    }

    wsprintf(result, "%lu", at);
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

    native = GlobalAlloc(GMEM_MOVEABLE | GMEM_DDESHARE, 16);
    n = (LPBYTE)GlobalLock(native);

    for (k = 0; k < 16; k++) {
        n[k] = (BYTE)(0x70 + k);
    }

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

static void run(void)
{
    LHCLIENTDOC doc = 0;
    OLESTATUS answer;
    RECT bounds;
    char result[40];

    answer = OleRegisterClientDoc("OlePbrClient", "C:\\ORACLE\\OLEPBR.DOC", 0L, &doc);
    wsprintf(result, "%u", (unsigned)answer);
    say("OleRegisterClientDoc", "doc", result);

    if (!doc) {
        return;
    }

    note("create");
    make("OleCreate", 0,
         OleCreate("StdFileEditing", &client, CLASS, doc, "Pic1", &objects[0], olerender_draw, 0));

    if (!objects[0]) {
        return;
    }

    queries(0);

    note("update");
    answered("OleSetHostNames", 0, OleSetHostNames(objects[0], "Probe Client", "Probe Picture"));
    answered("OleUpdate", 0, OleUpdate(objects[0]));
    queries(0);
    drawn(0);

    note("stream");
    length = 0;
    answered("OleSaveToStream", 0, OleSaveToStream(objects[0], (LPOLESTREAM)&stream));
    dumpStream("embedded");

    note("close");
    answered("OleClose", 0, OleClose(objects[0]));
    say("server", "0", pumpUntil(serverGone, 0) ? "gone" : "timeout");
    queries(0);
    drawn(0);

    note("load");
    readAt = 0;
    make("OleLoadFromStream", 1,
         OleLoadFromStream((LPOLESTREAM)&stream, "StdFileEditing", &client, doc, "Pic2",
                           &objects[1]));

    if (objects[1]) {
        queries(1);
        SetRect(&bounds, 10, 10, 50, 30);
        answered("OleActivate", 1,
                 OleActivate(objects[1], OLEVERB_PRIMARY, FALSE, FALSE, window, &bounds));
        queries(1);
        answered("OleUpdate", 1, OleUpdate(objects[1]));
        answered("OleClose", 1, OleClose(objects[1]));
        say("server", "1", pumpUntil(serverGone, 0) ? "gone" : "timeout");
        answered("OleRelease", 1, OleRelease(objects[1]));
    }

    answered("OleDelete", 0, OleDelete(objects[0]));

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
    kindOf.lpszClassName = "OlePbr";
    RegisterClass(&kindOf);
    window = CreateWindow("OlePbr", "OlePbr", WS_OVERLAPPEDWINDOW, 0, 0, 200, 100, NULL, NULL,
                          instance, NULL);
    ShowWindow(window, SW_SHOWNORMAL);

    cfNative = RegisterClipboardFormat("Native");
    buffer = (unsigned char huge *)GlobalLock(GlobalAlloc(GMEM_MOVEABLE, 0x40000L));
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
