/*
 * Program Manager's DDE server by plain messages, as a program without
 * DDEML talks to it: how many answer a WM_DDE_INITIATE sent to every
 * window; a posted WM_DDE_EXECUTE's acknowledgement -- its status, whether
 * it carries the same block, and the block's size and flags after; two
 * executes posted before either is answered; a WM_DDE_REQUEST's WM_DDE_DATA
 * -- its header word and format, the block's flags and size, and whether
 * the item's atom is the one sent; what WM_DDE_POKE, WM_DDE_ADVISE,
 * WM_DDE_UNADVISE and a stray WM_DDE_DATA get, and whether what they carry
 * is freed; the AppProperties items asked with nothing being started; the
 * answer to WM_DDE_TERMINATE, and an execute after it; and [Reload], of
 * one group whose file was changed or deleted underneath, and of all.
 */

#define PROBE_FLUSH
#include "probe.h"
#include <dde.h>
#include <ddeml.h>
#include "pmprobe.h"

#pragma library("ddeml")

#define OUTPUT "C:\\ORACLE\\PMRAW.OUT"

static HINSTANCE self;
static HWND mine;
static HWND partner;
static char got[600];
static int answers;
static ATOM sentItem;
static HGLOBAL sentBlock;

LONG FAR PASCAL __export Proc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    char name[40];

    switch (message) {
    case WM_DDE_ACK:
        answers++;

        if (!partner && !sentBlock && !sentItem) {
            /* An answer to an initiate: the application and the topic. */
            name[0] = '\0';
            GlobalGetAtomName(LOWORD(lParam), name, sizeof(name));
            wsprintf(got + lstrlen(got), "ack:%s|", (LPSTR)name);
            name[0] = '\0';
            GlobalGetAtomName(HIWORD(lParam), name, sizeof(name));
            wsprintf(got + lstrlen(got), "%s:%s;", (LPSTR)name,
                     (LPSTR)((HWND)wParam == FindWindow("Progman", NULL) ? "progman" : "other"));
            GlobalDeleteAtom(LOWORD(lParam));
            GlobalDeleteAtom(HIWORD(lParam));

            if ((HWND)wParam != FindWindow("Progman", NULL)) {
                PostMessage((HWND)wParam, WM_DDE_TERMINATE, (WPARAM)hwnd, 0L);
            }

            return 0;
        }

        if (sentBlock) {
            wsprintf(got + lstrlen(got), "ack:%x:%s:%s;", LOWORD(lParam),
                     (LPSTR)(HIWORD(lParam) == (WORD)sentBlock ? "same" : "other"),
                     (LPSTR)((HWND)wParam == partner ? "partner" : "other"));
        } else {
            name[0] = '\0';
            GlobalGetAtomName(HIWORD(lParam), name, sizeof(name));
            wsprintf(got + lstrlen(got), "ack:%x:%s:%s;", LOWORD(lParam),
                     (LPSTR)(HIWORD(lParam) == sentItem ? "same" : "other"), (LPSTR)name);

            if (HIWORD(lParam) != sentItem) {
                GlobalDeleteAtom(HIWORD(lParam));
            }
        }

        return 0;

    case WM_DDE_DATA: {
        HGLOBAL data = (HGLOBAL)LOWORD(lParam);
        LPBYTE at;
        int i;

        answers++;
        name[0] = '\0';
        GlobalGetAtomName(HIWORD(lParam), name, sizeof(name));
        wsprintf(got + lstrlen(got), "data:%s:%s:flags=%x:size=%lu:", (LPSTR)name,
                 (LPSTR)(HIWORD(lParam) == sentItem ? "same" : "other"), GlobalFlags(data),
                 GlobalSize(data));
        at = (LPBYTE)GlobalLock(data);

        if (at) {
            wsprintf(got + lstrlen(got), "%04x,%04x,", *(WORD FAR *)at,
                     *(WORD FAR *)(at + 2));

            for (i = 4; i < 60 && at[i]; i++) {
                char one[2];

                one[0] = at[i] < ' ' ? '.' : at[i];
                one[1] = '\0';
                lstrcat(got, one);
            }

            GlobalUnlock(data);
        }

        lstrcat(got, ";");
        GlobalFree(data);

        if (HIWORD(lParam) != sentItem) {
            GlobalDeleteAtom(HIWORD(lParam));
        }

        return 0;
    }

    case WM_DDE_TERMINATE:
        answers++;
        wsprintf(got + lstrlen(got), "terminate:%s;",
                 (LPSTR)((HWND)wParam == partner ? "partner" : "other"));
        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

static void wait(int count)
{
    int i;

    for (i = 0; i < 200 && answers < count; i++) {
        settle(1);
    }

    settle(5);
}

static void initiate(LPCSTR app, LPCSTR topic)
{
    ATOM a = app ? GlobalAddAtom(app) : 0;
    ATOM t = topic ? GlobalAddAtom(topic) : 0;

    got[0] = '\0';
    answers = 0;
    SendMessage((HWND)-1, WM_DDE_INITIATE, (WPARAM)mine, MAKELPARAM(a, t));

    if (a) {
        GlobalDeleteAtom(a);
    }

    if (t) {
        GlobalDeleteAtom(t);
    }

    settle(10);
    wsprintf(probeArgs, "%s,%s", (LPSTR)(app ? app : "0"), (LPSTR)(topic ? topic : "0"));
    wsprintf(probeResult, "%d:%s", answers, (LPSTR)got);
    probe("initiate", probeArgs, probeResult);
}

static HGLOBAL block(LPCSTR text)
{
    HGLOBAL h = GlobalAlloc(GMEM_DDESHARE | GMEM_MOVEABLE, lstrlen(text) + 1);

    lstrcpy((LPSTR)GlobalLock(h), text);
    GlobalUnlock(h);
    return h;
}

/* A posted execute, its acknowledgement, and its block afterwards. */
static void execute1(LPCSTR command)
{
    got[0] = '\0';
    answers = 0;
    sentBlock = block(command);
    PostMessage(partner, WM_DDE_EXECUTE, (WPARAM)mine, MAKELPARAM(0, sentBlock));
    wait(1);
    wsprintf(probeResult, "%s|size=%lu:flags=%x", (LPSTR)got, GlobalSize(sentBlock),
             GlobalFlags(sentBlock));
    probe("posted", command, probeResult);
    GlobalFree(sentBlock);
    sentBlock = NULL;
}

/* A request, or another message carrying an item, and what came of it. */
static void itemMessage(LPCSTR label, UINT message, LPCSTR item, WORD low, HGLOBAL data)
{
    got[0] = '\0';
    answers = 0;
    sentItem = GlobalAddAtom(item);
    PostMessage(partner, message, (WPARAM)mine, MAKELPARAM(data ? (WORD)data : low, sentItem));
    wait(1);
    lstrcpy(probeResult, answers ? got : "nothing");

    if (data) {
        wsprintf(probeResult + lstrlen(probeResult), "|data:size=%lu:flags=%x", GlobalSize(data),
                 GlobalFlags(data));
        GlobalFree(data);
    }

    /* Whether the item's atom is still there: added once by the probe. */
    wsprintf(probeResult + lstrlen(probeResult), "|atom:%s",
             (LPSTR)(GlobalFindAtom(item) ? "found" : "gone"));
    probe(label, item, probeResult);

    while (GlobalFindAtom(item)) {
        GlobalDeleteAtom(GlobalFindAtom(item));
    }

    sentItem = 0;
}

static HGLOBAL poke(void)
{
    HGLOBAL h = GlobalAlloc(GMEM_DDESHARE | GMEM_MOVEABLE, sizeof(DDEPOKE) + 4);
    DDEPOKE FAR *p = (DDEPOKE FAR *)GlobalLock(h);

    p->fRelease = 1;
    p->cfFormat = CF_TEXT;
    lstrcpy((LPSTR)p->Value, "x");
    GlobalUnlock(h);
    return h;
}

static HGLOBAL advise(void)
{
    HGLOBAL h = GlobalAlloc(GMEM_DDESHARE | GMEM_MOVEABLE, sizeof(DDEADVISE));
    DDEADVISE FAR *p = (DDEADVISE FAR *)GlobalLock(h);

    p->fDeferUpd = 0;
    p->fAckReq = 0;
    p->cfFormat = CF_TEXT;
    GlobalUnlock(h);
    return h;
}

static HGLOBAL stray(void)
{
    HGLOBAL h = GlobalAlloc(GMEM_DDESHARE | GMEM_MOVEABLE, sizeof(DDEDATA) + 4);
    DDEDATA FAR *p = (DDEDATA FAR *)GlobalLock(h);

    p->fResponse = 0;
    p->fRelease = 1;
    p->fAckReq = 1;
    p->cfFormat = CF_TEXT;
    lstrcpy((LPSTR)p->Value, "x");
    GlobalUnlock(h);
    return h;
}

int PASCAL WinMain(HINSTANCE module, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HGLOBAL first;
    HGLOBAL second;
    int i;

    (void)previous;
    (void)command;
    (void)show;
    self = module;
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
    kind.lpszClassName = "PmRawC";
    RegisterClass(&kind);
    mine = CreateWindow("PmRawC", "Probe", WS_OVERLAPPED, 0, 0, 10, 10, NULL, NULL, module,
                        NULL);

    wsprintf(probeResult, "%d", WinExec("PROGMAN.EXE", SW_SHOWNORMAL) > 32);
    probe("WinExec", "PROGMAN.EXE", probeResult);

    for (i = 0; i < 400 && !FindWindow("Progman", NULL); i++) {
        settle(1);
    }

    settle(20);

    /* Who answers: each answer but Program Manager's ended at once. */
    initiate("PROGMAN", "PROGMAN");
    initiate("Shell", "AppProperties");
    partner = FindWindow("Progman", NULL);

    execute1("[CreateGroup(Raw Group)]");
    execute1("[AddItem(C:\\WINDOWS\\NOTEPAD.EXE)]");
    execute1("[Bogus]");
    execute1("");

    /* Two posted before either is answered. */
    got[0] = '\0';
    answers = 0;
    first = block("[AddItem(C:\\WINDOWS\\CALC.EXE)]");
    second = block("[AddItem(C:\\WINDOWS\\NOPE)]");
    sentBlock = first;
    PostMessage(partner, WM_DDE_EXECUTE, (WPARAM)mine, MAKELPARAM(0, first));
    PostMessage(partner, WM_DDE_EXECUTE, (WPARAM)mine, MAKELPARAM(0, second));
    wait(2);
    probe("posted", "two", got);
    GlobalFree(first);
    GlobalFree(second);
    sentBlock = NULL;

    itemMessage("request", WM_DDE_REQUEST, "Groups", CF_TEXT, NULL);
    itemMessage("request", WM_DDE_REQUEST, "Raw Group", CF_TEXT, NULL);
    itemMessage("request", WM_DDE_REQUEST, "Raw Group", CF_OEMTEXT, NULL);
    itemMessage("request", WM_DDE_REQUEST, "Nothing", CF_TEXT, NULL);
    itemMessage("request", WM_DDE_REQUEST, "GetIcon", CF_TEXT, NULL);
    itemMessage("request", WM_DDE_REQUEST, "GetDescription", (WORD)module, NULL);
    itemMessage("request", WM_DDE_REQUEST, "GetWorkingDir", (WORD)module, NULL);
    itemMessage("request", WM_DDE_REQUEST, "GetIcon", (WORD)module, NULL);
    itemMessage("poke", WM_DDE_POKE, "Groups", 0, poke());
    itemMessage("advise", WM_DDE_ADVISE, "Groups", 0, advise());
    itemMessage("unadvise", WM_DDE_UNADVISE, "Groups", CF_TEXT, NULL);
    itemMessage("data", WM_DDE_DATA, "Groups", 0, stray());

    /* Ended, and an execute after. */
    got[0] = '\0';
    answers = 0;
    PostMessage(partner, WM_DDE_TERMINATE, (WPARAM)mine, 0L);
    wait(1);
    probe("terminate", "", answers ? got : "nothing");
    execute1("[AddItem(C:\\WINDOWS\\CLOCK.EXE)]");

    /* Reload: a group whose file was changed underneath, one whose file was
     * deleted, one that is not there, and every group. */
    ddeOpen(module);
    connect(FALSE);
    execute("[CreateGroup(Reload Me)][AddItem(C:\\WINDOWS\\NOTEPAD.EXE)]");
    execute("[CreateGroup(Reload Two)][AddItem(C:\\WINDOWS\\CALC.EXE)]");
    request("Reload Me");
    text("created", "C:\\WINDOWS\\PROGMAN.INI");
    copyFile("C:\\WINDOWS\\ACCESSOR.GRP", "C:\\WINDOWS\\RELOADME.GRP");
    execute("[Reload(Reload Me)]");
    request("Groups");
    request("Reload Me");
    request("Accessories");
    windows("reloaded");
    removeFile("C:\\WINDOWS\\RELOADTW.GRP");
    execute("[Reload(Reload Two)]");
    request("Groups");
    request("Reload Two");
    text("reload-deleted", "C:\\WINDOWS\\PROGMAN.INI");
    execute("[Reload(Nope)]");
    execute("[Reload(a,b)]");
    execute("[Reload()]");
    execute("[Reload]");
    request("Groups");
    text("reload-all", "C:\\WINDOWS\\PROGMAN.INI");
    windows("reload-all");
    disconnect();

    DdeFreeStringHandle(instance, service);
    DdeUninitialize(instance);
    probeFinish();
    return 0;
}
