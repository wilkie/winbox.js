/*
 * Which window `USER.EXE` makes active, and where the windows go, as a
 * window is destroyed, hidden or disabled, as a modal dialog starts and
 * ends, as a message box is up, and with a system-modal window: the
 * activation's search (seg1 `38e4`: a pop-up's owner, then the window
 * active before, then the next), `DestroyWindow` (seg8 `0b86`-`0bce`),
 * `EnableWindow` (seg1 `6f28`), `EndDialog` (seg25 `2564`), `MessageBox`
 * (seg42 `0000`, `011f`-`0145`) and `SetSysModalWindow` (seg1 `19de`).
 *
 * The windows, of class `Z`, pop-ups with a border unless the case says.
 * Each case makes those it needs afresh and logs after each call:
 *
 * * `order`: every window at the top, the front first: the probe's by
 *   their letter, any other topmost or shown one by its class; `*` after
 *   one with WS_EX_TOPMOST, `-` after one hidden, `!` after one disabled;
 *   then the active window, the focus and the system-modal window.
 * * `sent`: what the probe's windows were sent since the last `order`:
 *   `X:46@a/f`, `X:47@a/f` (WM_WINDOWPOSCHANGING, CHANGED; `a` the window
 *   to go after, `T` 0, `M` 1, `X` -1, `N` -2; `f` the flags); `X:6/w`
 *   WM_ACTIVATE, `X:86/w` WM_NCACTIVATE, `X:7` WM_SETFOCUS, `X:8`
 *   WM_KILLFOCUS, `X:a/w` WM_ENABLE, `X:1f` WM_CANCELMODE.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\ZACTIVE.OUT"

#define WS_EX_TOPMOST_ 0x00000008L
#define POPUP (WS_POPUP | WS_BORDER | WS_VISIBLE)

enum { A, B, C, P, O, D, COUNT };

static const char *names[] = { "A", "B", "C", "P", "O", "D" };
static HWND windows[COUNT];
static int making = -1;
static char seen[1600];
static HINSTANCE instance;
static char label[40];
static char className[32];
static FARPROC dialogProc;
static FARPROC looker;

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

    if (hwnd == (HWND)-1) {
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
                       (LPSTR)(IsWindowEnabled(hwnd) ? "" : "!"));
    }

    wsprintf(to, ";active=%s", (LPSTR)nameOf(GetActiveWindow()));
    wsprintf(to + lstrlen(to), ";focus=%s", (LPSTR)nameOf(GetFocus()));
    wsprintf(to + lstrlen(to), ";sysmodal=%s", (LPSTR)nameOf(GetSysModalWindow()));
    wsprintf(name, "%s, %s", (LPSTR)label, when);
    probe("order", name, text);
    probe("sent", name, seen[0] ? seen : "none");
    seen[0] = '\0';
}

static void noteMessage(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    char one[60];

    switch (message) {
    case WM_WINDOWPOSCHANGING:
    case WM_WINDOWPOSCHANGED:
        notePosition(window, message, (WINDOWPOS FAR *)lParam);
        break;
    case WM_ACTIVATE:
    case WM_NCACTIVATE:
    case WM_ENABLE:
        wsprintf(one, "%s:%x/%x,", (LPSTR)nameOf(window), message, wParam);
        note(one);
        break;
    case WM_SETFOCUS:
    case WM_KILLFOCUS:
    case WM_CANCELMODE:
        wsprintf(one, "%s:%x,", (LPSTR)nameOf(window), message);
        note(one);
        break;
    }
}

LRESULT CALLBACK __export Proc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_NCCREATE && making >= 0) {
        windows[making] = window;
    }

    noteMessage(window, message, wParam, lParam);
    return DefWindowProc(window, message, wParam, lParam);
}

BOOL CALLBACK __export DialogProc(HWND dialog, UINT message, WPARAM wParam, LPARAM lParam)
{
    switch (message) {
    case WM_INITDIALOG:
        windows[D] = dialog;
        order("init");
        SetTimer(dialog, 1, 100, NULL);
        return TRUE;
    case WM_TIMER:
        KillTimer(dialog, 1);
        order("up");
        EndDialog(dialog, 1);
        order("ended");
        return TRUE;
    }

    noteMessage(dialog, message, wParam, lParam);
    return FALSE;
}

/* From inside the box's loop: the order, then Enter pressed on its focus. */
void CALLBACK __export Looker(HWND hwnd, UINT message, UINT id, DWORD time)
{
    HWND box = GetActiveWindow();
    HWND focus;

    KillTimer(NULL, id);
    order("up");
    focus = GetFocus();
    PostMessage(focus ? focus : box, WM_KEYDOWN, VK_RETURN, 0x001c0001L);
    PostMessage(focus ? focus : box, WM_KEYUP, VK_RETURN, 0xc01c0001L);

    (void)hwnd;
    (void)message;
    (void)id;
    (void)time;
}

static void take(void)
{
    MSG msg;

    while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }
}

static HWND make(int which, DWORD style, HWND owner, LPCSTR when)
{
    making = which;
    CreateWindow("Z", names[which], style, 20 + which * 24, 20 + which * 20, 160, 120, owner,
                 NULL, instance, NULL);
    making = -1;
    take();

    if (when) {
        order(when);
    }

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

static void destroy(int which, LPCSTR when)
{
    DestroyWindow(windows[which]);
    windows[which] = NULL;
    take();
    order(when);
}

static void activate(int which, LPCSTR when)
{
    SetActiveWindow(windows[which]);
    take();
    order(when);
}

static void box(UINT style, HWND owner, LPCSTR when)
{
    char answer[8];

    SetTimer(NULL, 0, 200, (TIMERPROC)looker);
    wsprintf(answer, "%d", MessageBox(owner, "Z", "Z", style));
    take();
    order(when);
    probe("answer", label, answer);
}

static HGLOBAL template;

static void word(BYTE FAR *at, int *i, WORD value)
{
    at[(*i)++] = LOBYTE(value);
    at[(*i)++] = HIBYTE(value);
}

/* A dialog of no controls, 120 by 50 dialog units. */
static void build(DWORD style)
{
    BYTE FAR *at;
    int i = 0;

    template = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, 64);
    at = (BYTE FAR *)GlobalLock(template);
    word(at, &i, LOWORD(style));
    word(at, &i, HIWORD(style));
    at[i++] = 0;
    word(at, &i, 60);
    word(at, &i, 40);
    word(at, &i, 120);
    word(at, &i, 50);
    GlobalUnlock(template);
}

int PASCAL WinMain(HINSTANCE hinst, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;

    instance = hinst;
    probeOpen(OUTPUT);
    dialogProc = MakeProcInstance((FARPROC)DialogProc, hinst);
    looker = MakeProcInstance((FARPROC)Looker, hinst);

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

    /* Destroyed while active: a pop-up hands the activation to its owner,
     * an owned window that is not a pop-up to the window active before it
     * (seg8 `0b95`-`0bb2`, seg1 `3934`-`395c`). */
    begin("destroy");
    make(A, POPUP, NULL, NULL);
    make(B, POPUP, NULL, NULL);
    make(P, POPUP, windows[A], "start");
    destroy(P, "p destroyed");
    make(O, WS_OVERLAPPED | WS_CAPTION | WS_VISIBLE, windows[A], "o");
    activate(B, "b active");
    activate(O, "o active");
    destroy(O, "o destroyed");
    make(C, POPUP, NULL, NULL);
    activate(A, "a active");
    activate(C, "c active");
    destroy(C, "c destroyed");

    /* A pop-up destroyed while its owner is disabled. */
    begin("disabled");
    make(A, POPUP, NULL, NULL);
    make(B, POPUP, NULL, NULL);
    make(P, POPUP, windows[A], "start");
    EnableWindow(windows[A], FALSE);
    take();
    order("a disabled");
    destroy(P, "p destroyed");
    EnableWindow(windows[A], TRUE);
    take();
    order("a enabled");

    /* The active window disabled stays active; the focus goes to none
     * (seg1 `6f63`-`6f79`). */
    begin("enable");
    make(A, POPUP, NULL, NULL);
    make(B, POPUP, NULL, "start");
    EnableWindow(windows[B], FALSE);
    take();
    order("b disabled");
    activate(A, "a active");
    EnableWindow(windows[B], TRUE);
    take();
    order("b enabled");

    /* The active window hidden (seg14 `0dbc`-`0dc5`). */
    begin("hide");
    make(A, POPUP, NULL, NULL);
    make(B, POPUP, NULL, NULL);
    make(P, POPUP, windows[A], NULL);
    make(C, POPUP, NULL, "start");
    ShowWindow(windows[C], SW_HIDE);
    take();
    order("c hidden");
    activate(P, "p active");
    ShowWindow(windows[P], SW_HIDE);
    take();
    order("p hidden");

    /* A modal dialog owned by A, B over it, A active. */
    begin("dialog");
    make(A, POPUP, NULL, NULL);
    make(B, POPUP, NULL, NULL);
    activate(A, "start");
    build(WS_POPUP | WS_BORDER | WS_VISIBLE | DS_MODALFRAME);
    DialogBoxIndirect(instance, template, windows[A], (DLGPROC)dialogProc);
    GlobalFree(template);
    windows[D] = NULL;
    take();
    order("after");

    /* A message box with no owner, task modal: the program's windows
     * disabled while it is up (seg42 `0000`). */
    begin("taskmodal");
    make(A, POPUP, NULL, NULL);
    make(B, POPUP, NULL, "start");
    box(MB_OK | MB_TASKMODAL, NULL, "after");

    /* A message box owned by A, system modal, with an icon: a dialog. */
    begin("sysmodal");
    make(A, POPUP, NULL, NULL);
    make(B, POPUP, NULL, "start");
    box(MB_OK | MB_SYSTEMMODAL | MB_ICONEXCLAMATION, windows[A], "after");

    /* SetSysModalWindow moves nothing (seg1 `19de`). */
    begin("setsys");
    make(A, POPUP, NULL, NULL);
    make(B, POPUP, NULL, "start");
    SetSysModalWindow(windows[A]);
    take();
    order("a sysmodal");
    activate(A, "a active");
    destroy(A, "a destroyed");

    destroyAll();
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
