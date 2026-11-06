/*
 * Where `SetWindowPos` puts a window at the top, and whether it is topmost,
 * case by case as `USER.EXE` seg7 works it out: `1400` (the window to go
 * after, and whether the window is made topmost or not), `13be` (the
 * windows owned under it made so with it), `14ae`/`1606` (its owner's
 * family brought with it) and `1184` (where a window of the family that is
 * not topmost goes after a topmost one).
 *
 * The windows, all pop-ups with a border of class `Z`, made visible in the
 * order named, each in front of the last: A, B and C owned by none; P owned
 * by A, Q owned by P, R owned by A. Each case makes the windows it needs
 * afresh, does one or more calls and logs after each:
 *
 * * `order`: every window at the top, the front first, named: the probe's
 *   by their letter, any other topmost one by its class; `*` after one with
 *   WS_EX_TOPMOST, `-` after one hidden; then the active window and the
 *   focus.
 * * `sent`: what the probe's windows were sent since the last `order`:
 *   `X:46@a/f` and `X:47@a/f` for WM_WINDOWPOSCHANGING and CHANGED, `a` the
 *   window to go after as the structure names it (`T` 0, `M` 1, `X` -1, `N`
 *   -2), `f` the flags; `X:6/w` WM_ACTIVATE, `X:86/w` WM_NCACTIVATE, `X:7`
 *   WM_SETFOCUS, `X:8` WM_KILLFOCUS.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\ZORDER.OUT"

#define HWND_TOPMOST_ ((HWND)-1)
#define HWND_NOTOPMOST_ ((HWND)-2)
#define WS_EX_TOPMOST_ 0x00000008L
#define QUIET (SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE)
#define ASIS (SWP_NOMOVE | SWP_NOSIZE)

enum { A, B, C, P, Q, R, COUNT };

static const char *names[] = { "A", "B", "C", "P", "Q", "R" };
static HWND windows[COUNT];
static char seen[1600];
static HINSTANCE instance;
static char label[40];
static char className[32];

static void record(LPCSTR function, LPCSTR args, LPCSTR result)
{
    probe(function, args, result);
    _lclose(probeHandle);
    probeHandle = _lopen(OUTPUT, OF_WRITE);
    _llseek(probeHandle, 0, 2);
}

#define probe record

static int indexOf(HWND hwnd)
{
    int i;

    for (i = 0; i < COUNT; i++) {
        if (hwnd && windows[i] == hwnd) {
            return i;
        }
    }

    return -1;
}

static LPCSTR nameOf(HWND hwnd)
{
    int i = indexOf(hwnd);

    if (!hwnd) {
        return "0";
    }

    if (i >= 0) {
        return names[i];
    }

    GetClassName(hwnd, className, sizeof className);
    return className;
}

static LPCSTR afterOf(HWND hwnd)
{
    if (hwnd == HWND_TOP) {
        return "T";
    }

    if (hwnd == HWND_BOTTOM) {
        return "M";
    }

    if (hwnd == HWND_TOPMOST_) {
        return "X";
    }

    if (hwnd == HWND_NOTOPMOST_) {
        return "N";
    }

    return nameOf(hwnd);
}

static void note(HWND window, LPCSTR text)
{
    if (lstrlen(seen) + lstrlen(text) < sizeof seen - 2) {
        lstrcat(seen, text);
    }
}

/* Apart, so that the far pointer is loaded only where it is one. */
static void notePosition(HWND window, UINT message, WINDOWPOS FAR *pos)
{
    char one[48];

    wsprintf(one, "%s:%x@", (LPSTR)nameOf(window), message);
    lstrcat(one, afterOf(pos->hwndInsertAfter));
    wsprintf(one + lstrlen(one), "/%x,", pos->flags);
    note(window, one);
}

static void order(LPCSTR when)
{
    char text[300];
    char name[60];
    LPSTR to = text;
    HWND hwnd;
    BOOL topmost;

    *to = '\0';

    for (hwnd = GetWindow(GetDesktopWindow(), GW_CHILD); hwnd;
         hwnd = GetWindow(hwnd, GW_HWNDNEXT)) {
        topmost = (GetWindowLong(hwnd, GWL_EXSTYLE) & WS_EX_TOPMOST_) != 0;

        if (indexOf(hwnd) < 0 && !topmost) {
            continue;
        }

        to += wsprintf(to, "%s%s%s%s", (LPSTR)(to == text ? "" : ","), (LPSTR)nameOf(hwnd),
                       (LPSTR)(topmost ? "*" : ""), (LPSTR)(IsWindowVisible(hwnd) ? "" : "-"));
    }

    wsprintf(to, ";active=%s", (LPSTR)nameOf(GetActiveWindow()));
    wsprintf(to + lstrlen(to), ";focus=%s", (LPSTR)nameOf(GetFocus()));
    wsprintf(name, "%s, %s", (LPSTR)label, when);
    probe("order", name, text);
    probe("sent", name, seen[0] ? seen : "none");
    seen[0] = '\0';
}

LRESULT CALLBACK __export Proc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    char one[24];

    switch (message) {
    case WM_WINDOWPOSCHANGING:
    case WM_WINDOWPOSCHANGED:
        notePosition(window, message, (WINDOWPOS FAR *)lParam);
        break;
    case WM_ACTIVATE:
    case WM_NCACTIVATE:
        wsprintf(one, "%s:%x/%x,", (LPSTR)nameOf(window), message, wParam);
        note(window, one);
        break;
    case WM_SETFOCUS:
    case WM_KILLFOCUS:
        wsprintf(one, "%s:%x,", (LPSTR)nameOf(window), message);
        note(window, one);
        break;
    }

    return DefWindowProc(window, message, wParam, lParam);
}

static void take(void)
{
    MSG msg;

    while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }
}

static HWND make(int which, HWND owner)
{
    windows[which] = CreateWindow("Z", names[which], WS_POPUP | WS_BORDER | WS_VISIBLE,
                                  20 + which * 30, 20 + which * 25, 160, 120, owner, NULL,
                                  instance, NULL);
    return windows[which];
}

static void destroyAll(void)
{
    int i;

    for (i = COUNT - 1; i >= 0; i--) {
        if (windows[i] && IsWindow(windows[i])) {
            DestroyWindow(windows[i]);
        }

        windows[i] = NULL;
    }

    take();
    seen[0] = '\0';
}

static void begin(LPCSTR name)
{
    lstrcpy(label, name);
    destroyAll();
}

static void swp(int which, HWND after, UINT flags, LPCSTR when)
{
    SetWindowPos(windows[which], after, 0, 0, 0, 0, flags);
    take();
    order(when);
}

/* The last topmost window at the top, the window HWND_TOP puts others after. */
static HWND lastTopmost(void)
{
    HWND hwnd;
    HWND last = NULL;

    for (hwnd = GetWindow(GetDesktopWindow(), GW_CHILD); hwnd;
         hwnd = GetWindow(hwnd, GW_HWNDNEXT)) {
        if (!(GetWindowLong(hwnd, GWL_EXSTYLE) & WS_EX_TOPMOST_)) {
            break;
        }

        last = hwnd;
    }

    return last;
}

int PASCAL WinMain(HINSTANCE hinst, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;

    instance = hinst;
    probeOpen(OUTPUT);

    kind.style = 0;
    kind.lpfnWndProc = Proc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "Z";
    RegisterClass(&kind);

    /* A window given: after the last topmost window, topmost or not as it
     * was (seg7 `1486`-`148d`); after another topmost one, topmost; after
     * one that is not, not (`148f`-`14a8`). */
    begin("after");
    make(A, NULL);
    make(B, NULL);
    make(C, NULL);
    take();
    order("start");
    swp(B, HWND_TOPMOST_, QUIET, "b topmost");
    swp(A, lastTopmost(), QUIET, "a after last");
    swp(C, lastTopmost(), QUIET, "c after last");
    swp(C, windows[B], QUIET, "c after b");
    swp(B, lastTopmost(), QUIET, "b after last");
    swp(B, windows[A], QUIET, "b after a");
    swp(A, HWND_TOP, QUIET, "a top");

    /* HWND_NOTOPMOST: a topmost window after the last topmost, or the one in
     * front of it where it is the last (`143c`-`1457`); one that is not,
     * where it is (`145c`). */
    begin("notopmost");
    make(A, NULL);
    make(B, NULL);
    make(C, NULL);
    take();
    swp(A, HWND_TOPMOST_, QUIET, "a topmost");
    swp(B, HWND_TOPMOST_, QUIET, "b topmost");
    swp(B, HWND_NOTOPMOST_, QUIET, "b not");
    swp(A, HWND_NOTOPMOST_, QUIET, "a not");
    swp(C, HWND_NOTOPMOST_, QUIET, "c not");
    swp(C, HWND_BOTTOM, QUIET, "c bottom");
    swp(C, HWND_NOTOPMOST_, QUIET, "c not again");

    /* An owner made topmost: the windows it owns are made so with it
     * (`13be`), and come first, the most owned first (`1606`). */
    begin("owner");
    make(A, NULL);
    make(P, windows[A]);
    make(Q, windows[P]);
    make(B, NULL);
    take();
    order("start");
    swp(A, HWND_TOPMOST_, QUIET, "a topmost");
    swp(B, HWND_TOPMOST_, QUIET, "b topmost");
    swp(A, HWND_TOP, QUIET, "a top");

    /* An owned window made topmost no more: the window it is owned under
     * at the end of its owners, and every window owned under that, are
     * made so (`137f`-`1391`). */
    swp(Q, HWND_NOTOPMOST_, QUIET, "q not");

    /* An owned window made topmost: it, and what it owns, alone (`13be`);
     * its owner, brought up after it, goes after the last topmost window
     * (`1184`, `11ad`-`11d8`). */
    begin("owned");
    make(A, NULL);
    make(P, windows[A]);
    make(Q, windows[P]);
    make(B, NULL);
    take();
    swp(P, HWND_TOPMOST_, QUIET, "p topmost");
    swp(B, HWND_TOP, QUIET, "b top");
    swp(P, HWND_TOP, QUIET, "p top");
    swp(A, HWND_TOP, QUIET, "a top");

    /* At the bottom: topmost no more, with its owner's family (`142f`,
     * `151b`-`1548`). */
    begin("bottom");
    make(A, NULL);
    make(P, windows[A]);
    make(B, NULL);
    make(C, NULL);
    take();
    swp(A, HWND_TOPMOST_, QUIET, "a topmost");
    swp(P, HWND_BOTTOM, QUIET, "p bottom");
    swp(C, HWND_BOTTOM, QUIET, "c bottom");
    swp(B, HWND_BOTTOM, QUIET, "b bottom");

    /* After a window of its own family (`1580`-`15c4`). */
    begin("family");
    make(A, NULL);
    make(P, windows[A]);
    make(R, windows[A]);
    make(B, NULL);
    take();
    order("start");
    swp(R, windows[A], QUIET, "r after a");
    swp(R, windows[P], QUIET, "r after p");
    swp(A, windows[P], QUIET, "a after p");
    swp(A, windows[B], QUIET, "a after b");
    swp(P, windows[B], QUIET, "p after b");

    /* Made active: to the top, whatever it was asked, unless it is the
     * active window or was asked for HWND_TOPMOST or HWND_NOTOPMOST
     * (`1401`-`141b`). */
    begin("active");
    make(A, NULL);
    make(B, NULL);
    make(C, NULL);
    take();
    order("start");
    swp(C, windows[A], ASIS, "c active after a");
    swp(A, HWND_BOTTOM, ASIS, "a bottom");
    swp(A, windows[B], ASIS, "a after b");
    swp(B, HWND_NOTOPMOST_, ASIS, "b not");
    swp(C, HWND_TOPMOST_, ASIS, "c topmost");
    swp(A, HWND_TOP, ASIS, "a top");
    swp(C, HWND_BOTTOM, ASIS, "c bottom");

    destroyAll();
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
