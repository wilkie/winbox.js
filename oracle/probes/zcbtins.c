/*
 * A window made with a `WH_CBT` hook that names, in `HCBT_CREATEWND`'s
 * `CBT_CREATEWND`, the window to put it after: `CreateWindow` links it
 * there once `WM_NCCREATE` is answered (`USER.EXE` seg8 `0480`,
 * `0757`-`07bb`). Each case makes two topmost pop-ups, T then H, and two
 * overlapped windows, A then B, all shown; then C, hidden, with the hook
 * answering `HWND_TOP`, `HWND_BOTTOM`, `HWND_TOPMOST`, `HWND_NOTOPMOST`, A,
 * T, or the last topmost window -- C made with and without
 * `WS_EX_TOPMOST`. The hook notes the window to go after it was handed.
 * Logged as `zminim` logs.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\ZCBTINS.OUT"

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
static HHOOK cbtHook;
static int wanted = 0;
static HWND wantedAfter;

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

LRESULT FAR PASCAL _export CbtHook(int code, WPARAM wParam, LPARAM lParam)
{
    if (code == HCBT_CREATEWND && making == C) {
        CBT_CREATEWND FAR *create = (CBT_CREATEWND FAR *)lParam;
        char one[40];

        wsprintf(one, "hook@%s,", (LPSTR)afterOf(create->hwndInsertAfter));
        note(one);

        if (wanted) {
            create->hwndInsertAfter = wantedAfter;
        }
    }

    return CallNextHookEx(cbtHook, code, wParam, lParam);
}

/* The last of the topmost windows at the front. */
static HWND lastTopmost(void)
{
    HWND hwnd;
    HWND last = NULL;

    for (hwnd = GetWindow(GetDesktopWindow(), GW_CHILD); hwnd && topmostOf(hwnd);
         hwnd = GetWindow(hwnd, GW_HWNDNEXT)) {
        last = hwnd;
    }

    return last;
}

/* One case: T and H topmost, A and B, then C hidden after `after`. */
static void one(LPCSTR name, int asks, HWND after, int which, DWORD exStyle)
{
    begin(name);
    makeEx(T, WS_EX_TOPMOST_, POPUP | WS_VISIBLE, 300, 10, NULL, NULL);
    makeEx(H, WS_EX_TOPMOST_, POPUP | WS_VISIBLE, 330, 40, NULL, NULL);
    make(A, WS_OVERLAPPEDWINDOW | WS_VISIBLE, NULL, NULL);
    make(B, WS_OVERLAPPEDWINDOW | WS_VISIBLE, NULL, "start");

    if (which == A) {
        after = windows[A];
    } else if (which == T) {
        after = windows[T];
    } else if (which == K) {
        after = lastTopmost();
    }

    wanted = asks;
    wantedAfter = after;
    makeEx(C, exStyle, WS_OVERLAPPEDWINDOW, 60, 60, NULL, "made");
    wanted = 0;
}

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

    cbtHook = SetWindowsHookEx(WH_CBT, (HOOKPROC)MakeProcInstance((FARPROC)CbtHook, instance),
                               instance, GetCurrentTask());

    one("none", 0, NULL, -1, 0);
    one("top", 1, HWND_TOP, -1, 0);
    one("bottom", 1, HWND_BOTTOM, -1, 0);
    one("topmost", 1, HWND_TOPMOST_, -1, 0);
    one("notopmost", 1, (HWND)-2, -1, 0);
    one("after a", 1, NULL, A, 0);
    one("after t", 1, NULL, T, 0);
    one("after last", 1, NULL, K, 0);
    one("ex none", 0, NULL, -1, WS_EX_TOPMOST_);
    one("ex top", 1, HWND_TOP, -1, WS_EX_TOPMOST_);
    one("ex bottom", 1, HWND_BOTTOM, -1, WS_EX_TOPMOST_);
    one("ex notopmost", 1, (HWND)-2, -1, WS_EX_TOPMOST_);
    one("ex after a", 1, NULL, A, WS_EX_TOPMOST_);
    one("ex after t", 1, NULL, T, WS_EX_TOPMOST_);
    one("ex after last", 1, NULL, K, WS_EX_TOPMOST_);

    UnhookWindowsHookEx(cbtHook);
    destroyAll();
    probeFinish();

    (void)previous;
    (void)command;
    (void)cmdShow;
    return 0;
}
