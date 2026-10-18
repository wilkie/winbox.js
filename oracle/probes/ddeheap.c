/*
 * XTYP_ERROR: a DDEML instance's own heap full.
 *
 * Read out of `DDEML.DLL` seg1: each instance has a local heap of its own,
 * a moveable global block of 1000h bytes with `LocalInit` (`6118`, from
 * `01ae`), and keeps 100h bytes of it against its filling (`024d`-`0253`,
 * at the instance's 36h). An allocation in it (`6250`) that `LocalAlloc`
 * refuses frees those 100h bytes, sets DMLERR_LOW_MEMORY, calls the
 * instance back XTYP_ERROR with 4007h in `dwData1`, posts its window
 * `WM_USER + D0h`, and tries again (`61a8`-`6244`); with nothing kept, it
 * fails.
 *
 * This program is a client of plain DDE. Its partner is DDEHEAPC.EXE
 * (`ddeheap.child.c`), a DDEML server whose callbacks are disabled, so
 * that each WM_DDE_REQUEST it is posted is kept in its instance's queue.
 * The requests are posted one at a time, each once the one before has
 * gone, until the server says it was called back XTYP_ERROR, and then
 * twenty more. The server counts the requests its own loop takes, so its
 * lines say which request each thing happened in.
 */

#define PROBE_FLUSH
#include "probe.h"
#include <dde.h>

#define OUTPUT "C:\\ORACLE\\DDEHEAP.OUT"
#define LOG "C:\\ORACLE\\DDEH.TXT"

static HWND mine;
static HWND partner;
static BOOL errored;
static int acks;
static int nacks;
static int terminates;
static int seen;
static char text[2000];
static char out[1800];

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

static void since(LPCSTR function, LPCSTR what, LPCSTR head)
{
    HFILE file;
    int length = 0;
    int i;
    int count = 0;
    int at;

    settle(30);
    file = _lopen(LOG, OF_READ);

    if (file != HFILE_ERROR) {
        length = _lread(file, text, sizeof(text) - 1);
        _lclose(file);
    }

    text[length < 0 ? 0 : length] = '\0';
    lstrcpy(out, head);
    at = lstrlen(out);
    out[at++] = '|';

    for (i = 0; text[i]; i++) {
        if (text[i] == '\r') {
            continue;
        }

        if (text[i] == '\n') {
            count++;

            if (count > seen && out[at - 1] != '|') {
                out[at++] = '|';
            }

            continue;
        }

        if (count >= seen && at < (int)sizeof(out) - 2) {
            out[at++] = text[i];
        }
    }

    if (out[at - 1] == '|') {
        at--;
    }

    out[at] = '\0';
    seen = count;
    probe(function, what, out);
}

LONG FAR PASCAL __export Proc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    switch (message) {
    case WM_DDE_ACK:
        if (!partner) {
            partner = (HWND)wParam;
            GlobalDeleteAtom(LOWORD(lParam));
            GlobalDeleteAtom(HIWORD(lParam));
        } else {
            if (LOWORD(lParam) & 0x8000) {
                acks++;
            } else {
                nacks++;
            }

            GlobalDeleteAtom(HIWORD(lParam));
        }

        return 0;

    case WM_DDE_DATA:
        GlobalDeleteAtom(HIWORD(lParam));

        if (LOWORD(lParam)) {
            GlobalFree((HGLOBAL)LOWORD(lParam));
        }

        acks++;
        return 0;

    case WM_DDE_TERMINATE:
        terminates++;

        if ((HWND)wParam == partner) {
            PostMessage(partner, WM_DDE_TERMINATE, (WPARAM)hwnd, 0L);
            partner = NULL;
        }

        return 0;

    case WM_USER + 5:
        errored = TRUE;
        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

/* One request, posted once the server's queue has room. */
static BOOL post(void)
{
    ATOM item = GlobalAddAtom("item");
    int tries;

    for (tries = 0; tries < 200; tries++) {
        if (PostMessage(partner, WM_DDE_REQUEST, (WPARAM)mine, MAKELPARAM(CF_TEXT, item))) {
            /* Let the server take it before the next. */
            settle(2);
            return TRUE;
        }

        settle(1);
    }

    GlobalDeleteAtom(item);
    return FALSE;
}

int PASCAL WinMain(HINSTANCE module, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HFILE file;
    HWND server;
    ATOM app;
    ATOM subject;
    char head[100];
    int i;
    int after;

    probeOpen(OUTPUT);
    file = _lcreat(LOG, 0);
    _lclose(file);

    kind.style = 0;
    kind.lpfnWndProc = Proc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = module;
    kind.hIcon = NULL;
    kind.hCursor = LoadCursor(NULL, IDC_ARROW);
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "DdeHeapC";
    RegisterClass(&kind);

    mine = CreateWindow("DdeHeapC", "Probe C", WS_OVERLAPPEDWINDOW, 40, 40, 200, 150, NULL, NULL,
                        module, NULL);

    WinExec("DDEHEAPC.EXE", SW_SHOWNOACTIVATE);

    for (i = 0; i < 300 && !FindWindow(NULL, "Heap Server"); i++) {
        settle(1);
    }

    server = FindWindow(NULL, "Heap Server");
    since("WinExec", "DDEHEAPC.EXE", server ? "started" : "none");

    if (!server) {
        probeFinish();
        return 0;
    }

    app = GlobalAddAtom("HEAPSRV");
    subject = GlobalAddAtom("HTOPIC");
    SendMessage((HWND)-1, WM_DDE_INITIATE, (WPARAM)mine, MAKELPARAM(app, subject));
    GlobalDeleteAtom(app);
    GlobalDeleteAtom(subject);
    since("raw", "initiate", partner ? "partner" : "none");

    if (!partner) {
        probeFinish();
        return 0;
    }

    for (i = 0; i < 4000 && !errored && partner; i++) {
        if (!post()) {
            break;
        }
    }

    wsprintf(head, "%d,%s,acks=%d,nacks=%d,terms=%d", i, (LPSTR)(errored ? "error" : "none"),
             acks, nacks, terminates);
    since("requests", "until XTYP_ERROR", head);

    for (after = 0; after < 20 && partner; after++) {
        if (!post()) {
            break;
        }
    }

    wsprintf(head, "%d,acks=%d,nacks=%d,terms=%d", after, acks, nacks, terminates);
    since("requests", "20 more", head);
    PostMessage(server, WM_USER + 1, 0, 0L);
    since("server", "last", "posted");

    if (partner) {
        PostMessage(partner, WM_DDE_TERMINATE, (WPARAM)mine, 0L);
        partner = NULL;
    }

    PostMessage(server, WM_USER + 9, 0, 0L);

    for (i = 0; i < 300 && IsWindow(server); i++) {
        settle(1);
    }

    wsprintf(head, "%s,acks=%d,nacks=%d,terms=%d", (LPSTR)(IsWindow(server) ? "running" : "closed"),
             acks, nacks, terminates);
    since("server closed", "", head);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
