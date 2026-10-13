/*
 * Program Manager's DDE interface, as installers use it: a DDEML client
 * that connects to the service and topic "PROGMAN" and sends Program
 * Manager its execute strings -- [CreateGroup], [AddItem], [ReplaceItem],
 * [DeleteItem], [ShowGroup], [DeleteGroup], [ExitProgman] -- and requests
 * the item "Groups" and a group's name, as text.
 *
 * The probe runs as Windows' shell, so Program Manager is not running; it
 * starts PROGMAN.EXE with `WinExec`, as a program would, and waits for its
 * window (class "Progman") and for a conversation with it. Program Manager
 * then is not the shell, which is what lets [ExitProgman] end it.
 *
 * Each execute's record is the transaction's answer, `DdeGetLastError`'s,
 * and the status in `pdwResult`'s low word. A request's record is the text
 * Program Manager answered, or nought. After each execute that writes, a
 * `files` record shows PROGMAN.INI's [Groups] keys and their values, its
 * [Settings] Order=, and the size of each group file the probe's groups
 * should have. Plain WM_DDE_INITIATE messages, with the application or the
 * topic left out, record which conversations Program Manager offers.
 */

#define PROBE_FLUSH
#include "probe.h"
#include <dde.h>
#include <ddeml.h>

#pragma library("ddeml")

#define OUTPUT "C:\\ORACLE\\PROGDDE.OUT"

static DWORD instance;
static HCONV conv;
static HWND mine;
static char acks[200];

/* Program Manager's window, the block of a plain execute posted to it, and
 * the messages that came of it. */
static HWND partner;
static HGLOBAL commands;
static char plain[200];

HDDEDATA CALLBACK __export Callback(UINT type, UINT format, HCONV which, HSZ one, HSZ two,
                                    HDDEDATA data, DWORD first, DWORD second)
{
    (void)type;
    (void)format;
    (void)which;
    (void)one;
    (void)two;
    (void)data;
    (void)first;
    (void)second;
    return 0;
}

static void settle(int times)
{
    MSG message;
    int i;

    for (i = 0; i < times; i++) {
        while (PeekMessage(&message, NULL, 0, 0, PM_REMOVE | PM_NOYIELD)) {
            TranslateMessage(&message);
            DispatchMessage(&message);
        }

        Yield();
    }
}

static void execute(LPCSTR command)
{
    DWORD result = 0xAAAAAAAAL;
    HDDEDATA answer;
    UINT error;

    answer = DdeClientTransaction((LPBYTE)command, lstrlen(command) + 1, conv, 0, 0,
                                  XTYP_EXECUTE, 10000, &result);
    error = DdeGetLastError(instance);
    wsprintf(probeResult, "%d,%x,%x", answer != 0, error, LOWORD(result));
    probe("execute", command, probeResult);
}

static void request(LPCSTR item, UINT format)
{
    HSZ hsz = DdeCreateStringHandle(instance, item, CP_WINANSI);
    DWORD result = 0xAAAAAAAAL;
    HDDEDATA answer;
    UINT error;
    DWORD size;

    answer = DdeClientTransaction(NULL, 0, conv, hsz, format, XTYP_REQUEST, 10000, &result);
    error = DdeGetLastError(instance);
    wsprintf(probeArgs, "%s,%u", item, format);

    if (answer) {
        size = DdeGetData(answer, NULL, 0, 0);
        lstrcpy(probeResult, "text:");
        DdeGetData(answer, (LPBYTE)probeResult + 5, sizeof(probeResult) - 6, 0);
        probeResult[sizeof(probeResult) - 1] = '\0';
        wsprintf(probeResult + lstrlen(probeResult), "/%lu", size);
        DdeFreeDataHandle(answer);
    } else {
        wsprintf(probeResult, "0,%x,%x", error, LOWORD(result));
    }

    probe("request", probeArgs, probeResult);
    DdeFreeStringHandle(instance, hsz);
}

/* A file's size, or -1 where there is none. */
static long sizeOf(LPCSTR path)
{
    OFSTRUCT of;
    HFILE file = OpenFile(path, &of, OF_READ);
    long size;

    if (file == HFILE_ERROR) {
        return -1L;
    }

    size = _llseek(file, 0L, 2);
    _lclose(file);
    return size;
}

/* PROGMAN.INI's groups and order, and the probe's group files. */
static void files(LPCSTR when)
{
    static char keys[400];
    static char value[100];
    static LPCSTR groups[] = {"C:\\WINDOWS\\PROBEGRO.GRP", "C:\\WINDOWS\\LOWER.GRP",
                              "C:\\WINDOWS\\SPACED.GRP", "C:\\WINDOWS\\NAMEDBY.GRP",
                              "C:\\WINDOWS\\PROBEGR0.GRP"};
    LPSTR key;
    int i;

    probeResult[0] = '\0';
    GetPrivateProfileString("Groups", NULL, "", keys, sizeof(keys), "PROGMAN.INI");

    for (key = keys; *key; key += lstrlen(key) + 1) {
        GetPrivateProfileString("Groups", key, "", value, sizeof(value), "PROGMAN.INI");
        wsprintf(probeResult + lstrlen(probeResult), "%s=%s;", key, (LPSTR)value);
    }

    GetPrivateProfileString("Settings", "Order", "(none)", value, sizeof(value), "PROGMAN.INI");
    wsprintf(probeResult + lstrlen(probeResult), "Order=%s", (LPSTR)value);

    for (i = 0; i < sizeof(groups) / sizeof(groups[0]); i++) {
        wsprintf(probeResult + lstrlen(probeResult), ";%s:%ld", groups[i] + 11,
                 sizeOf(groups[i]));
    }

    probe("files", when, probeResult);
}

/* A group file's header, its item table and each item's fixed part, in
 * hexadecimal: what Program Manager put where. */
static void layout(LPCSTR when, LPCSTR path)
{
    static BYTE bytes[200];
    OFSTRUCT of;
    HFILE file = OpenFile(path, &of, OF_READ);
    WORD items;
    WORD item;
    WORD i;
    int j;
    int got;

    probeResult[0] = '\0';

    if (file == HFILE_ERROR) {
        probe("layout", when, "none");
        return;
    }

    got = _lread(file, bytes, 0x22 + 2 * 20);

    for (j = 0; j < got && j < 0x22; j++) {
        wsprintf(probeResult + lstrlen(probeResult), "%02x", bytes[j]);
    }

    items = got >= 0x22 ? *(WORD FAR *)(bytes + 0x20) : 0;

    for (i = 0; i < items && i < 20; i++) {
        item = *(WORD FAR *)(bytes + 0x22 + 2 * i);
        wsprintf(probeResult + lstrlen(probeResult), "|%x:", item);

        if (item) {
            BYTE data[26];
            HFILE again = OpenFile(path, &of, OF_READ);

            _llseek(again, (LONG)item, 0);
            _lread(again, data, sizeof(data));
            _lclose(again);

            for (j = 0; j < (int)sizeof(data); j++) {
                wsprintf(probeResult + lstrlen(probeResult), "%02x", data[j]);
            }
        }
    }

    /* And what follows the group's own bytes: the items' tags. */
    if (got >= 8) {
        BYTE tail[160];
        int length;

        _llseek(file, (LONG) * (WORD FAR *)(bytes + 6), 0);
        length = _lread(file, tail, sizeof(tail));
        lstrcat(probeResult, "|tags:");

        for (j = 0; j < length; j++) {
            wsprintf(probeResult + lstrlen(probeResult), "%02x", tail[j]);
        }
    }

    _lclose(file);
    probe("layout", when, probeResult);
}

LONG FAR PASCAL __export Proc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    char app[40];
    char topic[40];

    if (message == WM_DDE_ACK && commands) {
        wsprintf(plain + lstrlen(plain), "ack:%x:%s;", LOWORD(lParam),
                 (LPSTR)(HIWORD(lParam) == (WORD)commands ? "same" : "other"));
        return 0;
    }

    if (message == WM_DDE_TERMINATE && commands) {
        lstrcat(plain, "terminate;");
        return 0;
    }

    if (message == WM_DDE_ACK) {
        app[0] = topic[0] = '\0';
        GlobalGetAtomName(LOWORD(lParam), app, sizeof(app));
        GlobalGetAtomName(HIWORD(lParam), topic, sizeof(topic));
        wsprintf(acks + lstrlen(acks), "%s|%s;", (LPSTR)app, (LPSTR)topic);
        GlobalDeleteAtom(LOWORD(lParam));
        GlobalDeleteAtom(HIWORD(lParam));
        PostMessage((HWND)wParam, WM_DDE_TERMINATE, (WPARAM)hwnd, 0L);
        return 0;
    }

    if (message == WM_DDE_TERMINATE) {
        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

/* A plain WM_DDE_INITIATE, sent to every top-level window: the
 * conversations offered, each ended at once. */
static void initiate(LPCSTR app, LPCSTR topic)
{
    ATOM a = app ? GlobalAddAtom(app) : 0;
    ATOM t = topic ? GlobalAddAtom(topic) : 0;

    acks[0] = '\0';
    SendMessage((HWND)-1, WM_DDE_INITIATE, (WPARAM)mine, MAKELPARAM(a, t));

    if (a) {
        GlobalDeleteAtom(a);
    }

    if (t) {
        GlobalDeleteAtom(t);
    }

    settle(20);
    wsprintf(probeArgs, "%s,%s", (LPSTR)(app ? app : "0"), (LPSTR)(topic ? topic : "0"));
    probe("initiate", probeArgs, acks[0] ? acks : "none");
}

static void transaction(LPCSTR label, UINT type, UINT format, LPCSTR item)
{
    HSZ hsz = DdeCreateStringHandle(instance, item, CP_WINANSI);
    DWORD result = 0xAAAAAAAAL;
    HDDEDATA answer;
    UINT error;

    answer = DdeClientTransaction(type == XTYP_POKE ? (LPBYTE) "x" : NULL,
                                  type == XTYP_POKE ? 2 : 0, conv, hsz, format, type, 10000,
                                  &result);
    error = DdeGetLastError(instance);
    wsprintf(probeResult, "%d,%x,%x", answer != 0, error, LOWORD(result));
    probe("transaction", label, probeResult);
    DdeFreeStringHandle(instance, hsz);
}

int PASCAL WinMain(HINSTANCE module, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HSZ service;
    HWND progman = NULL;
    DWORD start;
    int i;

    probeOpen(OUTPUT);

    kind.style = 0;
    kind.lpfnWndProc = Proc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = module;
    kind.hIcon = NULL;
    kind.hCursor = LoadCursor(NULL, IDC_ARROW);
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "ProgDdeC";
    RegisterClass(&kind);
    mine = CreateWindow("ProgDdeC", "Probe", WS_OVERLAPPED, 0, 0, 10, 10, NULL, NULL, module,
                        NULL);

    wsprintf(probeResult, "%u",
             DdeInitialize(&instance, (PFNCALLBACK)MakeProcInstance((FARPROC)Callback, module),
                           APPCMD_CLIENTONLY, 0L));
    probe("DdeInitialize", "clientonly", probeResult);

    files("before");

    wsprintf(probeResult, "%d", WinExec("PROGMAN.EXE", SW_SHOWNORMAL) > 32);
    probe("WinExec", "PROGMAN.EXE", probeResult);

    service = DdeCreateStringHandle(instance, "PROGMAN", CP_WINANSI);

    for (i = 0; i < 400 && !conv; i++) {
        settle(1);

        if (!progman) {
            progman = FindWindow("Progman", NULL);
        }

        if (progman) {
            conv = DdeConnect(instance, service, service, NULL);
        }
    }

    probe("DdeConnect", "PROGMAN,PROGMAN", conv ? "conv" : "0");

    if (!conv) {
        probeFinish();
        return 0;
    }

    initiate("PROGMAN", "PROGMAN");
    initiate("progman", NULL);
    initiate(NULL, NULL);
    initiate("Shell", NULL);
    initiate("Shell", "AppProperties");
    initiate(NULL, "PROGMAN");

    request("Groups", CF_TEXT);
    request("PROGMAN", CF_TEXT);
    request("Groups", CF_OEMTEXT);
    request("Main", CF_TEXT);
    request("Nothing", CF_TEXT);
    transaction("poke", XTYP_POKE, CF_TEXT, "Groups");
    transaction("advstart", XTYP_ADVSTART, CF_TEXT, "Groups");

    execute("[CreateGroup(Probe Group)]");
    files("created");
    request("Groups", CF_TEXT);
    request("Probe Group", CF_TEXT);
    execute("[CreateGroup(\"probe group\")]");
    files("again");

    execute("[AddItem(C:\\WINDOWS\\NOTEPAD.EXE)]");
    execute("[AddItem(C:\\WINDOWS\\CALC.EXE,\"My Calc\",C:\\WINDOWS\\CALC.EXE,0,10,20,"
            "C:\\TEMP,0,1)]");
    execute("[AddItem(\"C:\\WINDOWS\\WRITE.EXE C:\\A,B.WRI\",\"Write, it\",,,,,,1601)]");
    execute("[AddItem(C:\\WINDOWS\\CLOCK.EXE,Clock,,,5)]");
    execute("[AddItem(C:\\WINDOWS\\CARDFILE.EXE,Last,C:\\WINDOWS\\PROGMAN.EXE,668)]");
    execute("[AddItem(,Empty)]");
    execute("[AddItem(C:\\WINDOWS\\PBRUSH.EXE , Spaced name  )]");
    execute("[AddItem(SOL.EXE,One)] [AddItem(WINMINE.EXE,Two)]");
    execute("[AddItem(TERMINAL.EXE,Three)][Bogus][AddItem(CALENDAR.EXE,Four)]");
    execute("[AddItem(RECORDER.EXE,\"Five\"x)]");
    files("items");
    layout("items", "C:\\WINDOWS\\PROBEGRO.GRP");
    request("Probe Group", CF_TEXT);

    execute("[ReplaceItem(Notepad)]");
    request("Probe Group", CF_TEXT);
    execute("[AddItem(C:\\WINDOWS\\NOTEPAD.EXE,New Pad)]");
    execute("[DeleteItem(\"my calc\")]");
    execute("[DeleteItem(Nope)]");
    execute("[ReplaceItem(Nope)]");
    execute("[AddItem(C:\\WINDOWS\\SOL.EXE,After)]");
    request("Probe Group", CF_TEXT);

    execute("[ShowGroup(Probe Group,2)]");
    request("Probe Group", CF_TEXT);
    execute("[ShowGroup(Probe Group,3)]");
    request("Probe Group", CF_TEXT);
    execute("[ShowGroup(Probe Group,1)]");
    request("Probe Group", CF_TEXT);
    execute("[ShowGroup(Probe Group)]");
    execute("[ShowGroup(Nope,1)]");

    execute("");
    execute("   ");
    execute("CreateGroup(Bare)");
    execute("[CreateGroup2(Bad)]");
    execute("[createGROUP(lower)]");
    execute("  [ CreateGroup ( Spaced )  ]  ");
    execute("[CreateGroup(Named By,C:\\WINDOWS\\NAMEDBY.GRP)]");
    execute("[CreateGroup(\"Unclosed)]");
    execute("[CreateGroup(a,b,c)]");
    execute("[CreateGroup]");
    files("syntax");
    layout("syntax", "C:\\WINDOWS\\PROBEGRO.GRP");
    request("Groups", CF_TEXT);

    execute("[DeleteGroup(lower)]");
    execute("[DeleteGroup(Spaced)]");
    execute("[DeleteGroup(Named By)]");
    execute("[DeleteGroup(Nope)]");
    execute("[DeleteGroup(Probe Group)]");
    files("deleted");
    request("Groups", CF_TEXT);
    request("Probe Group", CF_TEXT);

    execute("[CreateGroup(Probe Group)][AddItem(C:\\WINDOWS\\NOTEPAD.EXE)][DeleteGroup(Probe Group)]");
    files("again-deleted");

    execute("[ExitProgman]");
    start = GetTickCount();
    execute("[ExitProgman(0)]");
    probe("waited", "[ExitProgman(0)]",
          GetTickCount() - start >= 9000 ? "timeout" : "less");

    for (i = 0; i < 400 && FindWindow("Progman", NULL); i++) {
        settle(1);
    }

    probe("FindWindow", "Progman", FindWindow("Progman", NULL) ? "running" : "gone");
    files("exited");

    /* Again, by a plain conversation: whether the acknowledgement comes. */
    WinExec("PROGMAN.EXE", SW_SHOWNORMAL);

    for (i = 0; i < 400 && !FindWindow("Progman", NULL); i++) {
        settle(1);
    }

    settle(20);
    initiate("PROGMAN", "PROGMAN");
    partner = FindWindow("Progman", NULL);
    commands = GlobalAlloc(GMEM_DDESHARE | GMEM_MOVEABLE, 20);
    lstrcpy((LPSTR)GlobalLock(commands), "[ExitProgman(0)]");
    GlobalUnlock(commands);
    plain[0] = '\0';
    PostMessage(partner, WM_DDE_EXECUTE, (WPARAM)mine, MAKELPARAM(0, commands));

    for (i = 0; i < 400 && FindWindow("Progman", NULL); i++) {
        settle(1);
    }

    settle(50);
    probe("plain", "[ExitProgman(0)]", plain[0] ? plain : "nothing");
    probe("FindWindow", "Progman", FindWindow("Progman", NULL) ? "running" : "gone");
    GlobalFree(commands);
    commands = NULL;

    DdeDisconnect(conv);
    DdeFreeStringHandle(instance, service);
    DdeUninitialize(instance);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
