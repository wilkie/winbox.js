/*
 * The mark `SetWindowPos` leaves on a window to be made topmost, or topmost
 * no more, as it is placed (`USER.EXE` seg7 `13be`: its byte at 26h, bit
 * 20h), where `SWP_NOOWNERZORDER` leaves the window out of the list: kept
 * until the window is next placed (`0b67`-`0b71`), passed over by an entry
 * that only stays where it is (`0a4f`-`0a60`), and worked out afresh by the
 * next call that marks it (`13c6`). O owns the pop-up P, which owns Q; A
 * stands apart. Logged as `zminim` logs.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\ZMARK.OUT"

#define HWND_TOPMOST_ ((HWND)-1)
#define WS_EX_TOPMOST_ 0x00000008L
#define QUIET (SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE)
#define POPUP (WS_POPUP | WS_BORDER)

enum { T, A, B, C, H, O, P, Q, K, M, COUNT };

static const char *names[] = { "T", "A", "B", "C", "H", "O", "P", "Q", "K", "M" };
static HWND windows[COUNT];
static int making = -1;
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

    if (hwnd == (HWND)-2) {
        return "N";
    }

    return nameOf(hwnd);
}

static void note(LPCSTR text)
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
    note(one);
}

static BOOL topmostOf(HWND hwnd)
{
    return (GetWindowLong(hwnd, GWL_EXSTYLE) & WS_EX_TOPMOST_) != 0;
}

static void order(LPCSTR when)
{
    char text[400];
    char name[60];
    LPSTR to = text;
    HWND hwnd;

    *to = '\0';

    for (hwnd = GetWindow(GetDesktopWindow(), GW_CHILD); hwnd;
         hwnd = GetWindow(hwnd, GW_HWNDNEXT)) {
        if (indexOf(hwnd) < 0 && !topmostOf(hwnd) && !IsWindowVisible(hwnd)) {
            continue;
        }

        to += wsprintf(to, "%s%s%s%s%s", (LPSTR)(to == text ? "" : ","), (LPSTR)nameOf(hwnd),
                       (LPSTR)(topmostOf(hwnd) ? "*" : ""),
                       (LPSTR)(IsWindowVisible(hwnd) ? "" : "-"),
                       (LPSTR)(IsIconic(hwnd) ? "_" : ""));
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
    char one[60];

    switch (message) {
    case WM_NCCREATE:
        if (making >= 0) {
            windows[making] = window;
        }

        /* Fall through. */
    case WM_CREATE:
        wsprintf(one, "%s:%x/", (LPSTR)nameOf(window), message);
        lstrcat(one, nameOf(GetWindow(window, GW_HWNDNEXT)));
        lstrcat(one, ",");

        /* Not yet among its brothers in WM_NCCREATE, GW_HWNDPREV would walk
         * them for ever looking for it. */
        lstrcat(one, message == WM_CREATE ? nameOf(GetWindow(window, GW_HWNDPREV)) : "-");
        lstrcat(one, topmostOf(window) ? ",1," : ",0,");
        note(one);
        break;
    case WM_WINDOWPOSCHANGING:
    case WM_WINDOWPOSCHANGED:
        notePosition(window, message, (WINDOWPOS FAR *)lParam);
        break;
    case WM_ACTIVATE:
    case WM_NCACTIVATE:
    case WM_SHOWWINDOW:
        wsprintf(one, "%s:%x/%x,", (LPSTR)nameOf(window), message, wParam);
        note(one);
        break;
    case WM_SETFOCUS:
    case WM_KILLFOCUS:
        wsprintf(one, "%s:%x,", (LPSTR)nameOf(window), message);
        note(one);
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

static HWND makeEx(int which, DWORD exStyle, DWORD style, int x, int y, HWND owner, LPCSTR when)
{
    making = which;
    CreateWindowEx(exStyle, "Z", names[which], style, x, y, 160, 120, owner, NULL, instance,
                   NULL);
    making = -1;
    take();

    if (when) {
        order(when);
    }

    return windows[which];
}

static HWND make(int which, DWORD style, HWND owner, LPCSTR when)
{
    return makeEx(which, 0, style, 20 + which * 24, 20 + which * 20, owner, when);
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

static void show(int which, int command, LPCSTR when)
{
    ShowWindow(windows[which], command);
    take();
    order(when);
}

static void pos(int which, HWND after, int x, UINT flags, LPCSTR when)
{
    SetWindowPos(windows[which], after, x, 0, 0, 0, flags);
    take();
    order(when);
}

static void family(LPCSTR name)
{
    begin(name);
    make(A, WS_OVERLAPPEDWINDOW | WS_VISIBLE, NULL, NULL);
    make(O, WS_OVERLAPPEDWINDOW | WS_VISIBLE, NULL, NULL);
    makeEx(P, 0, POPUP | WS_VISIBLE, 200, 100, windows[O], NULL);
    makeEx(Q, 0, POPUP | WS_VISIBLE, 240, 140, windows[P], "start");
}

#define STILL (SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE)
#define ALONE (SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER)
#define MOVE (SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE)

int PASCAL WinMain(HINSTANCE hinst, HINSTANCE previous, LPSTR command, int cmdShow)
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

    /* P made topmost alone: Q, owned by it, marked and left. */
    family("moved");
    pos(P, HWND_TOPMOST_, 0, ALONE, "p topmost alone");
    pos(Q, NULL, 0, STILL | SWP_NOZORDER, "q nothing");
    pos(Q, NULL, 0, MOVE | SWP_NOMOVE, "q nomove");
    pos(Q, NULL, 250, MOVE, "q moved");
    pos(Q, NULL, 260, MOVE, "q moved again");

    /* Q, marked, put at the top. */
    family("top");
    pos(P, HWND_TOPMOST_, 0, ALONE, "p topmost alone");
    pos(Q, HWND_TOP, 0, STILL, "q top");

    /* Q, marked, put at the top alone. */
    family("top alone");
    pos(P, HWND_TOPMOST_, 0, ALONE, "p topmost alone");
    pos(Q, HWND_TOP, 0, ALONE, "q top alone");

    /* Q, marked, shown again. */
    family("shown");
    pos(P, HWND_TOPMOST_, 0, ALONE, "p topmost alone");
    ShowWindow(windows[Q], SW_HIDE);
    take();
    order("q hidden");
    ShowWindow(windows[Q], SW_SHOWNA);
    take();
    order("q shown");

    /* The mark worked out again: P made topmost no more, alone. */
    family("again");
    pos(P, HWND_TOPMOST_, 0, ALONE, "p topmost alone");
    pos(P, (HWND)-2, 0, ALONE, "p notopmost alone");
    pos(Q, NULL, 250, MOVE, "q moved");

    /* All topmost, then Q made topmost no more alone: O and P marked. */
    family("not");
    pos(O, HWND_TOPMOST_, 0, STILL, "o topmost");
    pos(Q, (HWND)-2, 0, ALONE, "q notopmost alone");
    pos(O, NULL, 30, MOVE, "o moved");
    pos(P, windows[A], 0, STILL, "p after a");

    /* Q marked, then the family brought: P put at the top. */
    family("brought");
    pos(P, HWND_TOPMOST_, 0, ALONE, "p topmost alone");
    pos(A, HWND_TOP, 0, STILL, "a top");
    pos(O, HWND_TOP, 0, STILL, "o top");

    destroyAll();
    probeFinish();

    (void)previous;
    (void)command;
    (void)cmdShow;
    return 0;
}
