/*
 * OLECLI's network helpers, exports 950-954, on a machine with no network:
 * a link's drive told by `SetNetName`, checked by `CheckNetDrive`, the next
 * drive connected to its share looked for by `SetNextNetDrive`, and
 * `GetTaskVisibleWindow`, the procedure `EnumTaskWindows` is given to find
 * a task's visible window. Their arguments are not documented: they are
 * read out of `OLECLI.DLL` (seg8; `kb/topics/ole.md`) and given here as
 * that reading has them -- an object's pointer, a word, a far pointer to a
 * drive's number and a buffer for a share's name, a window and a far
 * pointer to a window's handle.
 *
 * * `name`: links loaded from streams -- to a file on C:, on a drive that is
 *   not there, with no drive, and one whose stream names a share -- and an
 *   embedded object; each told its network name and saved again, the
 *   stream's document and network name written.
 * * `check`: each checked, not to ask; the share's link checked to ask,
 *   which shows `ConnectDlgProc`'s dialog where no drive is connected to
 *   the share: the dialog is read from a timer -- its caption, each
 *   control's class, number, text and place, the drives its list offers
 *   -- and cancelled.
 * * `next`: the next drive connected to the share.
 * * `window`: `GetTaskVisibleWindow` called with a visible window and a
 *   hidden one, and by `EnumTaskWindows` for this task.
 */

#include "probe.h"
#include <ole.h>

#pragma library("olecli")

#define OUTPUT "C:\\ORACLE\\OLENET.OUT"

typedef OLESTATUS(FAR PASCAL *SETNETNAME)(LPOLEOBJECT);
typedef OLESTATUS(FAR PASCAL *CHECKNETDRIVE)(LPOLEOBJECT, BOOL);
typedef OLESTATUS(FAR PASCAL *SETNEXTNETDRIVE)(LPOLEOBJECT, int FAR *, LPSTR);
typedef BOOL(FAR PASCAL *TASKWINDOW)(HWND, LONG);

static HWND window;
static HWND hidden;
static HINSTANCE self;
static HINSTANCE ole;
static SETNETNAME setNetName;
static CHECKNETDRIVE checkNetDrive;
static SETNEXTNETDRIVE setNextNetDrive;
static TASKWINDOW taskWindow;
static int dialogs;

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
    (void)me;

    if (what == OLE_QUERY_PAINT) {
        return 1;
    }

    wsprintf(probeArgs, "%d,%s", (int)what, object ? "object" : "0");
    probe("CallBack", probeArgs, "");
    return 1;
}

/* Each window of the dialog: its class, number, text and place in the dialog's client area. */
BOOL CALLBACK __export Child(HWND child, LPARAM dialog)
{
    char name[40];
    char text[80];
    RECT rect;

    GetClassName(child, name, sizeof name);
    GetWindowText(child, text, sizeof text);
    GetWindowRect(child, &rect);
    ScreenToClient((HWND)dialog, (POINT FAR *)&rect.left);
    ScreenToClient((HWND)dialog, (POINT FAR *)&rect.right);
    wsprintf(probeArgs, "%d", GetDlgCtrlID(child));
    wsprintf(probeResult, "%s,%s,%d,%d,%d,%d,%08lx", (LPSTR)name, (LPSTR)text, rect.left,
             rect.top, rect.right, rect.bottom, GetWindowLong(child, GWL_STYLE));
    probe("control", probeArgs, probeResult);

    if (!lstrcmpi(name, "ComboBox")) {
        int count = (int)SendMessage(child, CB_GETCOUNT, 0, 0L);
        int i;
        LPSTR out = probeResult;

        for (i = 0; i < count && i < 30; i++) {
            SendMessage(child, CB_GETLBTEXT, i, (LPARAM)(LPSTR)text);
            out += wsprintf(out, "%s,", (LPSTR)text);
        }

        wsprintf(out, " sel=%d", (int)SendMessage(child, CB_GETCURSEL, 0, 0L));
        probe("list", probeArgs, probeResult);
        SendMessage(child, CB_GETDROPPEDCONTROLRECT, 0, (LPARAM)(RECT FAR *)&rect);
        ScreenToClient((HWND)dialog, (POINT FAR *)&rect.left);
        ScreenToClient((HWND)dialog, (POINT FAR *)&rect.right);
        wsprintf(probeResult, "%d,%d,%d,%d", rect.left, rect.top, rect.right, rect.bottom);
        probe("dropped", probeArgs, probeResult);
    }

    return TRUE;
}

/* The dialog the check shows: read and cancelled. */
static void readDialog(void)
{
    HWND dialog = GetActiveWindow();
    char text[80];
    char name[40];
    RECT rect;

    if (!dialog || dialog == window) {
        probe("dialog", "", "none");
        return;
    }

    dialogs++;
    GetClassName(dialog, name, sizeof name);
    GetWindowText(dialog, text, sizeof text);
    GetClientRect(dialog, &rect);
    wsprintf(probeResult, "%s,%s,%d,%d,%s,%08lx,%d", (LPSTR)name, (LPSTR)text, rect.right,
             rect.bottom, GetParent(dialog) == window ? "owned" : "other",
             GetWindowLong(dialog, GWL_STYLE), GetFocus() ? GetDlgCtrlID(GetFocus()) : -1);
    probe("dialog", "", probeResult);
    GetWindowRect(dialog, &rect);
    wsprintf(probeResult, "%d,%d,%d,%d %08lx", rect.left, rect.top, rect.right, rect.bottom,
             GetDialogBaseUnits());
    probe("placed", "", probeResult);
    EnumChildWindows(dialog, (WNDENUMPROC)MakeProcInstance((FARPROC)Child, self), (LPARAM)dialog);
    PostMessage(dialog, WM_COMMAND, IDCANCEL, 0L);
}

LONG FAR PASCAL __export Proc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_TIMER && wParam == 2) {
        KillTimer(hwnd, 2);
        readDialog();
        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
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

    if (!*text) {
        putLong(0L);
        return;
    }

    putLong(count);

    for (i = 0; i < count; i++) buffer[at++] = text[i];
}

static void makeLinked(LPCSTR topic, LPCSTR network)
{
    at = 0;
    putLong(0x0501L);
    putLong(1L);
    putString("OleNet");
    putString(topic);
    putString("Item");
    putString(network);
    putLong(0L);
    putLong(0L);
    putLong(0x0501L);
    putLong(0L);
    length = at;
}

static void makeEmbedded(void)
{
    int i;

    at = 0;
    putLong(0x0501L);
    putLong(2L);
    putString("OleNet");
    putString("");
    putString("");
    putLong(16L);

    for (i = 0; i < 16; i++) buffer[at++] = (unsigned char)(0x40 + i);

    putLong(0x0501L);
    putLong(0L);
    length = at;
}

/* A string of the saved stream, at `*from`, moved past. */
static LPSTR savedString(LPSTR out, DWORD *from)
{
    DWORD n = (DWORD)buffer[(unsigned)*from] | (DWORD)buffer[(unsigned)*from + 1] << 8;
    DWORD i;

    *from += 4;
    *out++ = '"';

    for (i = 0; i < n && buffer[(unsigned)(*from + i)]; i++) {
        *out++ = buffer[(unsigned)(*from + i)];
    }

    *out++ = '"';
    *out = 0;
    *from += n;
    return out;
}

/* The object saved: its type, class, document, item and, a link's, network name. */
static void saved(LPCSTR what, LPOLEOBJECT object)
{
    OLESTATUS answer;
    DWORD from = 4;
    LPSTR out = probeResult;
    int type;

    length = 0;
    answer = OleSaveToStream(object, (LPOLESTREAM)&stream);
    type = buffer[4];
    from = 8;
    out += wsprintf(out, "%u %d ", (unsigned)answer, type);
    out = savedString(out, &from);
    *out++ = ' ';
    out = savedString(out, &from);
    *out++ = ' ';
    out = savedString(out, &from);

    if (type == 1) {
        *out++ = ' ';
        out = savedString(out, &from);
    }

    probe("saved", what, probeResult);
}

static LPOLEOBJECT load(LPCSTR what, LHCLIENTDOC doc)
{
    LPOLEOBJECT object = NULL;
    OLESTATUS answer;

    readAt = 0;
    answer = OleLoadFromStream((LPOLESTREAM)&stream, "StdFileEditing", &client, doc, "Net", &object);
    wsprintf(probeResult, "%u %s %lu", (unsigned)answer, object ? "object" : "0", readAt);
    probe("OleLoadFromStream", what, probeResult);
    return object;
}

static void named(LPCSTR what, LPOLEOBJECT object)
{
    wsprintf(probeResult, "%u", (unsigned)setNetName(object));
    probe("SetNetName", what, probeResult);
    saved(what, object);
}

static void checked(LPCSTR what, LPOLEOBJECT object, BOOL ask)
{
    MSG msg;
    OLESTATUS answer;

    if (ask) {
        SetTimer(window, 2, 1000, NULL);
    }

    answer = checkNetDrive(object, ask);
    wsprintf(probeArgs, "%s,%d", what, ask);
    wsprintf(probeResult, "%u", (unsigned)answer);
    probe("CheckNetDrive", probeArgs, probeResult);

    if (ask) {
        KillTimer(window, 2);

        while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
            TranslateMessage(&msg);
            DispatchMessage(&msg);
        }
    }

    saved(probeArgs, object);
}

static void next(LPCSTR what, LPOLEOBJECT object, LPCSTR share)
{
    char name[260];
    int drive = 0;
    OLESTATUS answer;

    lstrcpy(name, share);
    answer = setNextNetDrive(object, &drive, name);
    wsprintf(probeResult, "%u %d %s", (unsigned)answer, drive, (LPSTR)name);
    probe("SetNextNetDrive", what, probeResult);
}

static void run(void)
{
    LHCLIENTDOC doc = 0;
    LPOLEOBJECT objects[5];
    static LPCSTR names[5] = {"local", "missing", "bare", "share", "embedded"};
    HWND found;
    int i;

    wsprintf(probeResult, "%u", (unsigned)OleRegisterClientDoc("OLENET", "C:\\ORACLE\\NET.DOC", 0L,
                                                               &doc));
    probe("OleRegisterClientDoc", "doc", probeResult);

    if (!doc) {
        return;
    }

    wsprintf(probeResult, "%d,%d,%d,%d", GetDriveType(0), GetDriveType(2), GetDriveType(3),
             GetDriveType(16));
    probe("GetDriveType", "A,C,D,Q", probeResult);

    probeNote("name");
    makeLinked("C:\\ORACLE\\NET.BMP", "");
    objects[0] = load(names[0], doc);
    makeLinked("Q:\\NET.BMP", "");
    objects[1] = load(names[1], doc);
    makeLinked("NET.BMP", "");
    objects[2] = load(names[2], doc);
    makeLinked("C:\\ORACLE\\NET.BMP", "\\\\SERVER\\SHARE");
    objects[3] = load(names[3], doc);
    makeEmbedded();
    objects[4] = load(names[4], doc);

    for (i = 0; i < 5; i++) {
        if (objects[i]) {
            saved(names[i], objects[i]);
        }
    }

    probeNote("check");

    for (i = 0; i < 5; i++) {
        if (objects[i]) {
            checked(names[i], objects[i], FALSE);
        }
    }

    if (objects[3]) {
        checked(names[3], objects[3], TRUE);
        wsprintf(probeResult, "%d", dialogs);
        probe("dialogs", "", probeResult);
    }

    probeNote("next");

    for (i = 0; i < 5; i++) {
        if (objects[i]) {
            next(names[i], objects[i], "");
        }
    }

    if (objects[0]) {
        next("given", objects[0], "\\\\SERVER\\SHARE");
    }

    probeNote("named");

    for (i = 0; i < 5; i++) {
        if (objects[i]) {
            named(names[i], objects[i]);
            checked(names[i], objects[i], FALSE);
        }
    }

    for (i = 0; i < 5; i++) {
        if (objects[i]) {
            wsprintf(probeResult, "%u", (unsigned)OleRelease(objects[i]));
            probe("OleRelease", names[i], probeResult);
        }
    }

    probeNote("window");
    found = (HWND)0x1234;
    i = taskWindow(window, (LONG)(HWND FAR *)&found);
    wsprintf(probeResult, "%d %s", i,
             found == window ? "window" : found == (HWND)0x1234 ? "untouched" : "other");
    probe("GetTaskVisibleWindow", "visible", probeResult);
    found = (HWND)0x1234;
    i = taskWindow(hidden, (LONG)(HWND FAR *)&found);
    wsprintf(probeResult, "%d %s", i,
             found == hidden ? "hidden" : found == (HWND)0x1234 ? "untouched" : "other");
    probe("GetTaskVisibleWindow", "hidden", probeResult);
    found = 0;
    EnumTaskWindows(GetCurrentTask(), (WNDENUMPROC)taskWindow, (LPARAM)(HWND FAR *)&found);
    wsprintf(probeResult, "%s", found == window ? "window" : found == hidden ? "hidden" : found ? "other" : "0");
    probe("EnumTaskWindows", "GetTaskVisibleWindow", probeResult);
    ShowWindow(window, SW_HIDE);
    found = 0;
    EnumTaskWindows(GetCurrentTask(), (WNDENUMPROC)taskWindow, (LPARAM)(HWND FAR *)&found);
    wsprintf(probeResult, "%s", found == window ? "window" : found == hidden ? "hidden" : found ? "other" : "0");
    probe("EnumTaskWindows", "none visible", probeResult);

    wsprintf(probeResult, "%u", (unsigned)OleRevokeClientDoc(doc));
    probe("OleRevokeClientDoc", "doc", probeResult);
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
    kindOf.lpszClassName = "OleNet";
    RegisterClass(&kindOf);
    window = CreateWindow("OleNet", "OleNet", WS_OVERLAPPEDWINDOW, 0, 0, 200, 100, NULL, NULL,
                          instance, NULL);
    hidden = CreateWindow("OleNet", "Hidden", WS_OVERLAPPEDWINDOW, 0, 0, 100, 50, NULL, NULL,
                          instance, NULL);
    ShowWindow(window, SW_SHOWNORMAL);
    UpdateWindow(window);

    ole = GetModuleHandle("OLECLI");
    setNetName = (SETNETNAME)GetProcAddress(ole, "SetNetName");
    checkNetDrive = (CHECKNETDRIVE)GetProcAddress(ole, "CheckNetDrive");
    setNextNetDrive = (SETNEXTNETDRIVE)GetProcAddress(ole, "SetNextNetDrive");
    taskWindow = (TASKWINDOW)GetProcAddress(ole, "GetTaskVisibleWindow");

    buffer = (unsigned char far *)GlobalLock(GlobalAlloc(GMEM_MOVEABLE, 0x3400L));
    streamTable.Get = (DWORD(CALLBACK *)(LPOLESTREAM, void FAR *, DWORD))MakeProcInstance(
        (FARPROC)StreamGet, instance);
    streamTable.Put = (DWORD(CALLBACK *)(LPOLESTREAM, OLE_CONST void FAR *, DWORD))MakeProcInstance(
        (FARPROC)StreamPut, instance);
    stream.lpstbl = &streamTable;
    clientTable.CallBack = (int(CALLBACK *)(LPOLECLIENT, OLE_NOTIFICATION, LPOLEOBJECT))
        MakeProcInstance((FARPROC)ClientCallBack, instance);
    client.lpvtbl = &clientTable;

    if (setNetName && checkNetDrive && setNextNetDrive && taskWindow) {
        run();
    } else {
        probe("GetProcAddress", "net", "missing");
    }

    DestroyWindow(hidden);
    DestroyWindow(window);
    probeFinish();

    return 0;
}
