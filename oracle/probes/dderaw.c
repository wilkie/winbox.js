/*
 * The DDE protocol underneath DDEML, spoken by hand between two programs:
 * this one the client, DDERAWC.EXE (`dderaw.child.c`) the server, "Raw
 * Server". What USER does with the `WM_DDE_*` messages, the atoms and the
 * blocks of `GMEM_DDESHARE` memory that go with them, across two tasks.
 *
 * Read out of `USER.EXE`: `SendMessage`, `PostMessage` and the others check
 * a message's parameters before anything else (seg1 `af70`, called from
 * `a7a1`, `a7d2`), and for the DDE messages (`b31a`-`b388`) that is: the
 * `wParam` of `WM_DDE_INITIATE`, `ADVISE`, `UNADVISE`, `ACK`, `DATA` and
 * `REQUEST` must be a window (`ae6d`); the low word of `lParam` of
 * `WM_DDE_ADVISE` must be a global handle (`aeb6`), and of `WM_DDE_DATA`
 * and `WM_DDE_POKE` a global handle or nought (`aeb2`). `WM_DDE_TERMINATE`
 * and `WM_DDE_EXECUTE` are not checked, nor `POKE`'s `wParam`. A refused
 * call answers nought. `HWND_BROADCAST` (-1) is passed by unchecked.
 *
 * Each record's result is what the call answered, then `P:` lines for each
 * DDE message this program's window, "Raw Client", was handed (sent `s` or
 * posted `p`), and `S:` lines the server wrote meanwhile, with the
 * programs let run until all was taken. A peer is written `P` (this
 * program's window), `w` or `W` (some other window), `?` (not a window);
 * an atom by its name, `-` for none; a block by `GlobalFlags`, its status
 * word, format and text.
 *
 * * `validate`: calls USER is to refuse, and two it lets by.
 * * `initiate`: `SendMessage` to `HWND_BROADCAST` of `WM_DDE_INITIATE` for
 *   "RawSrv" and "RawTopic", then for any application and topic; the atoms
 *   are deleted as the protocol asks, and `atoms` says which names are
 *   left.
 * * `request`, `poke`, `execute`, `advise`, `unadvise`, `terminate`: one
 *   exchange each, the client freeing and deleting what is its to.
 * * `queue`: `WM_USER + 7` posted to the server ten times before it runs:
 *   what each `PostMessage` answers, and how many it took.
 *
 * Who owns a block of `GMEM_DDESHARE` memory once its program has gone is
 * `ddeleft`'s.
 */

#define PROBE_FLUSH
#include "probe.h"
#include <dde.h>

#define OUTPUT "C:\\ORACLE\\DDERAW.OUT"
#define LOG "C:\\ORACLE\\DDERAW.TXT"

static HWND mine;
static HWND server;
static char text[6000];
static char got[2000];
static int seen;

/* The lines the server wrote since last asked, `|` between. */
static LPSTR since(LPSTR out, int room)
{
    HFILE file = _lopen(LOG, OF_READ);
    int length = 0;
    int i;
    int lines = 0;
    int at = 0;

    if (file != HFILE_ERROR) {
        length = _lread(file, text, sizeof(text) - 1);
        _lclose(file);
    }

    text[length < 0 ? 0 : length] = '\0';

    for (i = 0; text[i]; i++) {
        if (text[i] == '\r') {
            continue;
        }

        if (text[i] == '\n') {
            lines++;

            if (lines > seen && at && out[at - 1] != '|' && at < room - 2) {
                out[at++] = '|';
            }

            continue;
        }

        if (lines >= seen && at < room - 2) {
            out[at++] = text[i];
        }
    }

    if (at && out[at - 1] == '|') {
        at--;
    }

    out[at] = '\0';
    seen = lines;

    if (!at) {
        lstrcpy(out, "none");
    }

    return out;
}

static void heard(LPCSTR line)
{
    if (lstrlen(got) + lstrlen(line) + 2 < sizeof(got)) {
        if (got[0]) {
            lstrcat(got, "|");
        }

        lstrcat(got, line);
    }
}

static LPSTR atomName(ATOM atom, LPSTR out)
{
    if (!atom) {
        lstrcpy(out, "-");
    } else if (!GlobalGetAtomName(atom, out, 40)) {
        lstrcpy(out, "?");
    }

    return out;
}

static LPSTR block(HGLOBAL handle, LPSTR out)
{
    LPWORD words;

    if (!handle) {
        lstrcpy(out, "null");
        return out;
    }

    words = (LPWORD)GlobalLock(handle);

    if (!words) {
        lstrcpy(out, "unlocked");
        return out;
    }

    wsprintf(out, "flags=%x,status=%x,cf=%u,%s", GlobalFlags(handle), words[0], words[1],
             (LPSTR)(words + 2));
    GlobalUnlock(handle);
    return out;
}

static HGLOBAL make(WORD status, LPCSTR value)
{
    HGLOBAL handle = GlobalAlloc(GMEM_MOVEABLE | GMEM_DDESHARE, 4 + lstrlen(value) + 1);
    LPWORD words = (LPWORD)GlobalLock(handle);

    words[0] = status;
    words[1] = CF_TEXT;
    lstrcpy((LPSTR)(words + 2), value);
    GlobalUnlock(handle);
    return handle;
}

static char who(HWND window)
{
    if (window && window == server) {
        return 'S';
    }

    if (window == mine) {
        return 'P';
    }

    return IsWindow(window) ? 'w' : '?';
}

static HGLOBAL executed;

LRESULT CALLBACK _export Proc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    char line[200];
    char one[48];
    char two[48];
    char data[120];
    char how = InSendMessage() ? 's' : 'p';

    switch (message) {
    case WM_DDE_INITIATE:
        wsprintf(line, "P:%c:init:%c:%s:%s", how, who((HWND)wParam),
                 atomName(LOWORD(lParam), one), atomName(HIWORD(lParam), two));
        heard(line);
        return 0;

    case WM_DDE_ACK:
        if (executed && HIWORD(lParam) == (WORD)executed) {
            wsprintf(line, "P:%c:ack:%c:status=%x:same", how, who((HWND)wParam), LOWORD(lParam));
            heard(line);
            return 0;
        }

        wsprintf(line, "P:%c:ack:%c:%s:%s", how, who((HWND)wParam),
                 atomName(LOWORD(lParam), one), atomName(HIWORD(lParam), two));

        if (how == 'p') {
            /* A posted ACK: the status, then the item's atom. */
            wsprintf(line, "P:%c:ack:%c:status=%x:%s", how, who((HWND)wParam), LOWORD(lParam),
                     atomName(HIWORD(lParam), two));

            if (HIWORD(lParam)) {
                GlobalDeleteAtom(HIWORD(lParam));
            }
        } else {
            if (!server && IsWindow((HWND)wParam)) {
                server = (HWND)wParam;
            }

            /* The answer to an INITIATE: its atoms are the receiver's to
             * delete. */
            GlobalDeleteAtom(LOWORD(lParam));
            GlobalDeleteAtom(HIWORD(lParam));
        }

        heard(line);
        return 0;

    case WM_DDE_DATA:
        wsprintf(line, "P:%c:data:%c:%s:%s", how, who((HWND)wParam),
                 block((HGLOBAL)LOWORD(lParam), data), atomName(HIWORD(lParam), one));
        heard(line);

        if (LOWORD(lParam)) {
            LPWORD words = (LPWORD)GlobalLock((HGLOBAL)LOWORD(lParam));
            WORD status = words ? words[0] : 0;

            if (words) {
                GlobalUnlock((HGLOBAL)LOWORD(lParam));
            }

            if (status & 0x8000) {
                /* fAckReq: acknowledged, the atom used again. */
                PostMessage((HWND)wParam, WM_DDE_ACK, (WPARAM)window,
                            MAKELONG(0x8000, HIWORD(lParam)));
            } else if (HIWORD(lParam)) {
                GlobalDeleteAtom(HIWORD(lParam));
            }

            if (status & 0x2000) {
                GlobalFree((HGLOBAL)LOWORD(lParam));
            }
        }

        return 0;

    case WM_DDE_TERMINATE:
        wsprintf(line, "P:%c:terminate:%c:%lx", how, who((HWND)wParam), lParam);
        heard(line);
        return 0;
    }

    return DefWindowProc(window, message, wParam, lParam);
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

/* One record: the call's answer, what this program was handed, and what
 * the server wrote, once both have run. */
static void record(LPCSTR function, LPCSTR args, LPCSTR answer)
{
    char theirs[1600];

    settle(30);
    /* Joined with lstrcat: wsprintf writes no more than 1024 characters. */
    lstrcpy(probeResult, answer);
    lstrcat(probeResult, "; ");
    lstrcat(probeResult, got[0] ? got : "P:none");
    lstrcat(probeResult, "; ");
    lstrcat(probeResult, since(theirs, sizeof(theirs)));
    got[0] = '\0';
    probe(function, args, probeResult);
}

static void atoms(void)
{
    wsprintf(probeResult, "RawSrv=%u,RawTopic=%u,RawItem=%u", GlobalFindAtom("RawSrv") ? 1 : 0,
             GlobalFindAtom("RawTopic") ? 1 : 0, GlobalFindAtom("RawItem") ? 1 : 0);
    probe("atoms", "", probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    OFSTRUCT reopen;
    char answer[40];
    ATOM app;
    ATOM topic;
    ATOM item;
    HGLOBAL handle;
    LONG result;
    int i;

    probeOpen(OUTPUT);
    OpenFile(LOG, &reopen, OF_DELETE);

    kind.style = 0;
    kind.lpfnWndProc = Proc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "DdeRawC";
    RegisterClass(&kind);

    mine = CreateWindow("DdeRawC", "Raw Client", WS_OVERLAPPEDWINDOW, 20, 20, 200, 120, NULL,
                        NULL, instance, NULL);
    ShowWindow(mine, SW_SHOWNORMAL);
    UpdateWindow(mine);

    WinExec("DDERAWC.EXE", SW_SHOWNOACTIVATE);

    for (i = 0; i < 200 && !FindWindow(NULL, "Raw Server"); i++) {
        settle(1);
    }

    settle(20);
    seen = 0;

    {
        HWND target = FindWindow(NULL, "Raw Server");

        app = GlobalAddAtom("RawSrv");
        topic = GlobalAddAtom("RawTopic");
        item = GlobalAddAtom("RawItem");

        /* What USER refuses before the message goes anywhere. */
        wsprintf(answer, "%ld", SendMessage(target, WM_DDE_INITIATE, 0, MAKELONG(app, topic)));
        record("validate", "SendMessage(INITIATE,wParam=0)", answer);
        wsprintf(answer, "%ld",
                 SendMessage(target, WM_DDE_INITIATE, 0x1234, MAKELONG(app, topic)));
        record("validate", "SendMessage(INITIATE,wParam=1234)", answer);
        wsprintf(answer, "%d", PostMessage(target, WM_DDE_ADVISE, (WPARAM)mine, MAKELONG(0, item)));
        record("validate", "PostMessage(ADVISE,options=0)", answer);
        wsprintf(answer, "%d",
                 PostMessage(target, WM_DDE_ADVISE, (WPARAM)mine, MAKELONG(0x1234, item)));
        record("validate", "PostMessage(ADVISE,options=1234)", answer);
        wsprintf(answer, "%d", PostMessage(target, WM_DDE_ACK, 0x1234, MAKELONG(0x8000, 0)));
        record("validate", "PostMessage(ACK,wParam=1234)", answer);
        wsprintf(answer, "%d", PostMessage(target, WM_DDE_REQUEST, 0, MAKELONG(CF_TEXT, 0)));
        record("validate", "PostMessage(REQUEST,wParam=0)", answer);
        wsprintf(answer, "%d", PostMessage(target, WM_DDE_DATA, (WPARAM)mine, MAKELONG(0, 0)));
        record("validate", "PostMessage(DATA,data=0)", answer);
        wsprintf(answer, "%d", PostMessage(target, WM_DDE_POKE, 0x1234, MAKELONG(0, 0)));
        record("validate", "PostMessage(POKE,wParam=1234,data=0)", answer);
        wsprintf(answer, "%d", PostMessage(target, WM_DDE_EXECUTE, 0x1234, MAKELONG(0, 0)));
        record("validate", "PostMessage(EXECUTE,wParam=1234,commands=0)", answer);
        wsprintf(answer, "%d", PostMessage(target, WM_DDE_TERMINATE, 0x1234, 0L));
        record("validate", "PostMessage(TERMINATE,wParam=1234)", answer);

        /* The conversation. */
        server = NULL;
        result = SendMessage((HWND)-1, WM_DDE_INITIATE, (WPARAM)mine, MAKELONG(app, topic));
        wsprintf(answer, "%ld,server=%c", result, server == target ? 'S' : '?');
        GlobalDeleteAtom(app);
        GlobalDeleteAtom(topic);
        record("initiate", "RawSrv,RawTopic", answer);
        atoms();

        server = NULL;
        result = SendMessage((HWND)-1, WM_DDE_INITIATE, (WPARAM)mine, 0L);
        wsprintf(answer, "%ld,server=%c", result, server == target ? 'S' : '?');
        record("initiate", "-,-", answer);
        atoms();

        wsprintf(answer, "%d",
                 PostMessage(server, WM_DDE_REQUEST, (WPARAM)mine,
                             MAKELONG(CF_TEXT, GlobalAddAtom("RawItem"))));
        record("request", "CF_TEXT,RawItem", answer);

        handle = make(0x2000, "Poked");
        wsprintf(answer, "%d",
                 PostMessage(server, WM_DDE_POKE, (WPARAM)mine,
                             MAKELONG(handle, GlobalAddAtom("RawItem"))));
        record("poke", "fRelease,CF_TEXT,Poked", answer);
        wsprintf(probeResult, "flags=%x,size=%lu", GlobalFlags(handle), GlobalSize(handle));
        probe("poke-freed", "", probeResult);

        executed = GlobalAlloc(GMEM_MOVEABLE | GMEM_DDESHARE, 16);
        lstrcpy((LPSTR)GlobalLock(executed), "[Run(1)]");
        GlobalUnlock(executed);
        wsprintf(answer, "%d", PostMessage(server, WM_DDE_EXECUTE, (WPARAM)mine,
                                           MAKELONG(0, executed)));
        record("execute", "[Run(1)]", answer);
        GlobalFree(executed);
        executed = NULL;

        handle = GlobalAlloc(GMEM_MOVEABLE | GMEM_DDESHARE, 4);
        ((LPWORD)GlobalLock(handle))[0] = 0x8000;
        ((LPWORD)GlobalLock(handle))[1] = CF_TEXT;
        GlobalUnlock(handle);
        GlobalUnlock(handle);
        wsprintf(answer, "%d",
                 PostMessage(server, WM_DDE_ADVISE, (WPARAM)mine,
                             MAKELONG(handle, GlobalAddAtom("RawItem"))));
        record("advise", "fAckReq,CF_TEXT,RawItem", answer);

        wsprintf(answer, "%d",
                 PostMessage(server, WM_DDE_UNADVISE, (WPARAM)mine,
                             MAKELONG(CF_TEXT, GlobalAddAtom("RawItem"))));
        record("unadvise", "CF_TEXT,RawItem", answer);

        wsprintf(answer, "%d", PostMessage(server, WM_DDE_TERMINATE, (WPARAM)mine, 0L));
        record("terminate", "", answer);

        GlobalDeleteAtom(item);
        atoms();

        /* The server's queue, before it has run. */
        answer[0] = '\0';

        for (i = 0; i < 10; i++) {
            char one[4];

            wsprintf(one, "%d", PostMessage(target, WM_USER + 7, 0, 0L));
            lstrcat(answer, one);
        }

        record("queue", "WM_USER+7 x10", answer);

        SendMessage(target, WM_USER + 9, 0, 0L);

        for (i = 0; i < 200 && FindWindow(NULL, "Raw Server"); i++) {
            settle(1);
        }
    }

    probeFinish();
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
