/*
 * A program's own `SendMessage` and `PostMessage` with `HWND_BROADCAST`:
 * which windows are handed the message, in what order, sent or posted,
 * with what `lParam`, and what each call answers. Read out of `USER.EXE`:
 * both exports pass -1 by without checking it as a window (seg1 `a786`,
 * `a7b7`) to the broadcast (`22e3`).
 *
 * The windows, all of one class whose procedure writes a line to
 * C:\ORACLE\BCAST.TXT for each message of the probe's it is handed -- the
 * window's letter, `s` where it was sent and `p` where it was posted
 * (handed in `DispatchMessage`), `R` for the probe's registered message,
 * `ini` for `WM_WININICHANGE`, `dev` for `WM_DEVMODECHANGE`, `u5` for
 * `WM_USER + 5` (which it answers 55), `wParam`, and `lParam` in hex, or
 * for `ini` and `dev` its offset, the text there and whether it is the
 * probe's own pointer (`own`) or another (`copy`):
 *
 * * `X`, "Probe X", the window of BCASTC.EXE (`bcast.child.c`), another
 *   program's, started first.
 * * `A`, an overlapped window at (20, 20), shown; `B` the same, hidden;
 *   `C` the same, shown and disabled.
 * * `D`, a pop-up owned by `A`, shown; `F` the same, hidden.
 * * `E`, a child of `A`, shown.
 * * `M`, an overlapped window, minimized without being activated.
 *
 * `order` gives the windows at the top as `EnumWindows` takes them, by
 * their letters, `?` and its class's name for one not the probe's. Each case is then a call
 * and its answer, and every line written while it was made and while what
 * it posted was taken -- this program's messages taken and dispatched,
 * and `X:done` waited for, which `WM_USER + 1` posted to `X` after the
 * call writes.
 */

#define PROBE_FLUSH
#include "probe.h"
#include <string.h>

#define OUTPUT "C:\\ORACLE\\BCAST.OUT"
#define LOG "C:\\ORACLE\\BCAST.TXT"

static HINSTANCE module;
static HWND a, b, c, d, e, f, m, x;
static UINT registered;
static BOOL dispatching;
static LPSTR own;
static char text[8000];
static char skipped[800];
static int seen;
static int dones;

static void note(LPCSTR line)
{
    HFILE file = _lopen(LOG, OF_READWRITE);

    if (file == HFILE_ERROR) {
        file = _lcreat(LOG, 0);
    }

    _llseek(file, 0L, 2);
    _lwrite(file, line, lstrlen(line));
    _lwrite(file, "\r\n", 2);
    _lclose(file);
}

/* The lines written since last asked, `|` between. */
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

static char letter(HWND window)
{
    if (window == a) return 'A';
    if (window == b) return 'B';
    if (window == c) return 'C';
    if (window == d) return 'D';
    if (window == e) return 'E';
    if (window == f) return 'F';
    if (window == m) return 'M';
    if (window == x) return 'X';
    return '?';
}

LRESULT CALLBACK _export Proc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    char line[120];
    char how = dispatching ? 'p' : 's';
    char name = letter(window);

    if (message == registered) {
        wsprintf(line, "%c:%c:R:%u:%lx", name, how, wParam, lParam);
        note(line);
        return 0;
    }

    if (message == WM_WININICHANGE || message == WM_DEVMODECHANGE) {
        if (lParam) {
            wsprintf(line, "%c:%c:%s:%u:o%u:%s:%s", name, how,
                     (LPSTR)(message == WM_WININICHANGE ? "ini" : "dev"), wParam,
                     LOWORD(lParam), (LPSTR)lParam,
                     (LPSTR)((LPSTR)lParam == own ? "own" : "copy"));
        } else {
            wsprintf(line, "%c:%c:%s:%u:null", name, how,
                     (LPSTR)(message == WM_WININICHANGE ? "ini" : "dev"), wParam);
        }

        note(line);
        return 0;
    }

    if (message == WM_USER + 5) {
        wsprintf(line, "%c:%c:u5:%u:%lx", name, how, wParam, lParam);
        note(line);
        return 55;
    }

    return DefWindowProc(window, message, wParam, lParam);
}

/* What comes taken and dispatched, the other program let run between
 * looks, so many times. */
static void settle(int times)
{
    MSG message;
    int i;

    for (i = 0; i < times; i++) {
        while (PeekMessage(&message, NULL, 0, 0, PM_REMOVE | PM_NOYIELD)) {
            TranslateMessage(&message);
            dispatching = TRUE;
            DispatchMessage(&message);
            dispatching = FALSE;
        }

        Yield();
    }
}

/* How many times `X:done` is written. */
static int countDone(void)
{
    HFILE file = _lopen(LOG, OF_READ);
    int length = 0;
    int count = 0;
    int i;

    if (file != HFILE_ERROR) {
        length = _lread(file, text, sizeof(text) - 1);
        _lclose(file);
    }

    for (i = 0; i + 6 <= length; i++) {
        if (_fmemcmp(text + i, "X:done", 6) == 0) {
            count++;
        }
    }

    return count;
}

/* Until `X` has written `X:done` once more, or a while. */
static void waitDone(void)
{
    int i;

    PostMessage(x, WM_USER + 1, 0, 0L);
    dones++;

    for (i = 0; i < 400; i++) {
        settle(1);

        if (countDone() >= dones) {
            break;
        }
    }

    settle(5);
}

static void record(LPCSTR name, LPCSTR answer)
{
    char out[1200];

    wsprintf(probeResult, "%s lines=%s", answer, (LPSTR)since(out, sizeof(out)));
    probe("case", name, probeResult);
}

BOOL CALLBACK _export Each(HWND window, LPARAM lParam)
{
    LPSTR out = (LPSTR)lParam;
    int at = lstrlen(out);

    if (at < 100) {
        out[at] = letter(window);
        out[at + 1] = '\0';

        if (out[at] == '?') {
            char name[24];

            GetClassName(window, name, sizeof(name));
            lstrcat(out, "(");
            lstrcat(out, name);
            lstrcat(out, ")");
        }
    }

    return TRUE;
}

static HWND make(LPCSTR title, DWORD style, int x0, int y0, HWND parent)
{
    return CreateWindow("BcastW", title, style, x0, y0, 120, 80, parent, NULL, module, NULL);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HFILE file;
    FARPROC each;
    char order[160];
    char answer[40];
    char ini[16];
    char none[4];
    LONG sent;
    BOOL posted;
    int i;

    probeOpen(OUTPUT);
    module = instance;

    file = _lcreat(LOG, 0);
    _lclose(file);

    registered = RegisterWindowMessage("BcastProbe");

    kind.style = 0;
    kind.lpfnWndProc = Proc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = LoadCursor(NULL, IDC_ARROW);
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "BcastW";
    RegisterClass(&kind);

    WinExec("BCASTC.EXE", SW_SHOWNORMAL);

    for (i = 0; i < 200 && !x; i++) {
        settle(1);
        x = FindWindow(NULL, "Probe X");
    }

    probe("started", "X", (LPSTR)(x ? "yes" : "no"));

    if (!x) {
        probeFinish();
        return 0;
    }

    a = make("A", WS_OVERLAPPEDWINDOW, 20, 20, NULL);
    ShowWindow(a, SW_SHOWNORMAL);
    b = make("B", WS_OVERLAPPEDWINDOW, 150, 20, NULL);
    c = make("C", WS_OVERLAPPEDWINDOW, 280, 20, NULL);
    ShowWindow(c, SW_SHOWNORMAL);
    EnableWindow(c, FALSE);
    d = make("D", WS_POPUP | WS_CAPTION | WS_VISIBLE, 20, 150, a);
    f = make("F", WS_POPUP | WS_CAPTION, 150, 150, a);
    e = CreateWindow("BcastW", "E", WS_CHILD | WS_VISIBLE | WS_BORDER, 5, 5, 40, 20, a, NULL,
                     module, NULL);
    m = make("M", WS_OVERLAPPEDWINDOW, 280, 150, NULL);
    ShowWindow(m, SW_SHOWMINNOACTIVE);
    settle(20);

    order[0] = '\0';
    each = MakeProcInstance((FARPROC)Each, module);
    EnumWindows((WNDENUMPROC)each, (LPARAM)(LPSTR)order);
    probe("order", "", order);
    since(skipped, sizeof(skipped));

    sent = SendMessage(HWND_BROADCAST, registered, 7, 0x12345678L);
    wsprintf(answer, "%lx", sent);
    waitDone();
    record("send", answer);

    posted = PostMessage(HWND_BROADCAST, registered, 8, 0x1234L);
    wsprintf(answer, "%x", posted);
    waitDone();
    record("post", answer);

    sent = SendMessage(HWND_BROADCAST, WM_USER + 5, 9, 0x55L);
    wsprintf(answer, "%lx", sent);
    waitDone();
    record("sendanswer", answer);

    lstrcpy(ini, "Probe");
    own = ini;
    sent = SendMessage(HWND_BROADCAST, WM_WININICHANGE, 3, (LPARAM)(LPSTR)ini);
    wsprintf(answer, "%lx", sent);
    waitDone();
    record("sendini", answer);

    posted = PostMessage(HWND_BROADCAST, WM_WININICHANGE, 4, (LPARAM)(LPSTR)ini);
    wsprintf(answer, "%x", posted);
    lstrcpy(ini, "Gone");
    waitDone();
    record("postini", answer);

    none[0] = '\0';
    own = none;
    sent = SendMessage(HWND_BROADCAST, WM_DEVMODECHANGE, 5, (LPARAM)(LPSTR)none);
    wsprintf(answer, "%lx", sent);
    waitDone();
    record("senddevempty", answer);

    sent = SendMessage(HWND_BROADCAST, WM_DEVMODECHANGE, 6, 0L);
    wsprintf(answer, "%lx", sent);
    waitDone();
    record("senddevnull", answer);

    posted = PostMessage(HWND_BROADCAST, WM_USER + 5, 10, 0x66L);
    wsprintf(answer, "%x", posted);
    waitDone();
    record("postanswer", answer);

    /* A window shown again, and one destroyed, between two. */
    ShowWindow(b, SW_SHOWNORMAL);
    DestroyWindow(d);
    settle(5);
    since(skipped, sizeof(skipped));
    order[0] = '\0';
    EnumWindows((WNDENUMPROC)each, (LPARAM)(LPSTR)order);
    probe("order", "after", order);
    sent = SendMessage(HWND_BROADCAST, registered, 11, 0L);
    wsprintf(answer, "%lx", sent);
    waitDone();
    record("sendafter", answer);

    SendMessage(x, WM_CLOSE, 0, 0L);
    settle(20);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
