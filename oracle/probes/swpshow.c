/*
 * A hidden window shown by SetWindowPos with SWP_SHOWWINDOW: whether it is
 * made active, and where it goes in the order of windows, with and without
 * SWP_NOACTIVATE. Then SimTower's own way with its palettes: hidden as its
 * main window is minimized, shown again with SWP_SHOWWINDOW and
 * SWP_NOACTIVATE as it is restored, from its WM_SIZE. Logged as `showsq2`
 * logs, each step pumping the queue empty after it:
 *
 * * `A`: overlapped, visible, at 20,20 300 by 200, made first and active.
 * * `P`, `Q`, `R`, `S`, `T`: pop-ups with captions, owned by nothing,
 *   hidden, each shown by one SetWindowPos with SWP_NOMOVE | SWP_NOSIZE and:
 *   P `HWND_TOPMOST` with SWP_SHOWWINDOW | SWP_NOACTIVATE (53h, SimTower's);
 *   Q after P, the same; R `HWND_BOTTOM`, the same; S `HWND_TOP` with
 *   SWP_NOZORDER besides (57h); T `HWND_TOP` with SWP_SHOWWINDOW alone
 *   (43h).
 * * `B`: overlapped, visible, made active. Its procedure hides P, Q, R, S
 *   and T on WM_SIZE with SIZE_MINIMIZED, and on SIZE_RESTORED shows P with
 *   `HWND_TOPMOST` and Q and R after P, each with 53h, as SimTower shows its
 *   palettes. B is minimized by WM_SYSCOMMAND with SC_MINIMIZE, as its
 *   minimize box sends it, and restored as Alt and Tab's loop switches to
 *   an icon: SetWindowPos to `HWND_TOP`, then SC_RESTORE posted.
 *
 * * `msg`, `state`: as `showsq2` has them.
 * * `zorder`: after each step, every window at the top of ours, from the
 *   front, by GetWindow; a hidden one in lower case.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\SWPSHOW.OUT"

static HWND handles[16];
static char names[16][2];
static int count;
static char creating;
static LPCSTR step = "";
static int number;
static HWND p, q, r, s, t;

static void name(LPSTR out, HWND hwnd)
{
    int index;

    if (hwnd == NULL) {
        lstrcpy(out, "0");
        return;
    }

    if (hwnd == (HWND)-1) {
        lstrcpy(out, "-1");
        return;
    }

    for (index = 0; index < count; index++) {
        if (handles[index] == hwnd) {
            lstrcpy(out, names[index]);
            return;
        }
    }

    if (IsWindow(hwnd)) {
        out[0] = '?';
        GetClassName(hwnd, out + 1, 14);
    } else {
        wsprintf(out, "?%x", (UINT)hwnd);
    }
}

static void know(HWND hwnd)
{
    char out[16];

    name(out, hwnd);

    if (out[0] == '?' && creating && count < 16) {
        handles[count] = hwnd;
        names[count][0] = creating;
        names[count][1] = '\0';
        count++;
    }
}

static void logMessage(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    char who[16];
    char w[16];
    char l[64];

    switch (message) {
    case WM_MOUSEMOVE:
    case WM_NCMOUSEMOVE:
    case WM_NCHITTEST:
    case WM_SETCURSOR:
    case WM_MOUSEACTIVATE:
    case WM_NCCREATE:
    case WM_CREATE:
    case WM_NCCALCSIZE:
    case WM_GETMINMAXINFO:
    case WM_GETTEXT:
    case WM_SETTEXT:
        return;
    }

    know(hwnd);
    wsprintf(w, "%x", wParam);
    wsprintf(l, "%lx", lParam);

    switch (message) {
    case WM_WINDOWPOSCHANGING:
    case WM_WINDOWPOSCHANGED: {
        WINDOWPOS FAR *wp = (WINDOWPOS FAR *)lParam;
        char after[16];

        name(after, wp->hwndInsertAfter);
        wsprintf(l, "%s:%d:%d:%d:%d:%x", (LPSTR)after, wp->x, wp->y, wp->cx, wp->cy, wp->flags);
        break;
    }
    case WM_ACTIVATEAPP:
        lstrcpy(l, lParam ? "task" : "0");
        break;
    case WM_NCACTIVATE:
    case WM_ACTIVATE:
        name(l, (HWND)LOWORD(lParam));
        wsprintf(l + lstrlen(l), ":%x", HIWORD(lParam));
        break;
    case WM_SETFOCUS:
    case WM_KILLFOCUS:
        name(w, (HWND)wParam);
        break;
    case WM_NCPAINT:
        lstrcpy(w, wParam == 1 ? "1" : "rgn");
        break;
    case WM_ERASEBKGND:
    case WM_ICONERASEBKGND:
    case WM_CTLCOLOR:
        lstrcpy(w, "hdc");
        break;
    case WM_QUERYDRAGICON:
        break;
    }

    name(who, hwnd);
    wsprintf(probeArgs, "%s,%d", step, number++);
    wsprintf(probeResult, "%s,%04x,%s,%s", (LPSTR)who, message, (LPSTR)w, (LPSTR)l);
    probe("msg", probeArgs, probeResult);
}

/* SimTower's palettes, shown again as they are there. */
static void showPalettes(void)
{
    SetWindowPos(p, HWND_TOPMOST, 0, 0, 0, 0,
                 SWP_SHOWWINDOW | SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE);
    SetWindowPos(q, p, 0, 0, 0, 0, SWP_SHOWWINDOW | SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE);
    SetWindowPos(r, p, 0, 0, 0, 0, SWP_SHOWWINDOW | SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE);
}

LONG FAR PASCAL _export ProbeProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    logMessage(hwnd, message, wParam, lParam);

    if (message == WM_PAINT) {
        PAINTSTRUCT ps;

        BeginPaint(hwnd, &ps);
        EndPaint(hwnd, &ps);
        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

LONG FAR PASCAL _export OwnerProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    logMessage(hwnd, message, wParam, lParam);

    if (message == WM_PAINT) {
        PAINTSTRUCT ps;

        BeginPaint(hwnd, &ps);
        EndPaint(hwnd, &ps);
        return 0;
    }

    if (message == WM_SIZE && wParam == SIZE_MINIMIZED) {
        ShowWindow(p, SW_HIDE);
        ShowWindow(q, SW_HIDE);
        ShowWindow(r, SW_HIDE);
        ShowWindow(s, SW_HIDE);
        ShowWindow(t, SW_HIDE);
    } else if (message == WM_SIZE && wParam == SIZE_RESTORED && p != NULL &&
               !IsWindowVisible(p)) {
        showPalettes();
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

static void pump(void)
{
    MSG message;

    while (PeekMessage(&message, NULL, 0, 0, PM_REMOVE)) {
        TranslateMessage(&message);
        DispatchMessage(&message);
    }
}

static void begin(LPCSTR at, char made)
{
    step = at;
    number = 0;
    creating = made;
}

static void state(void)
{
    char focus[16];
    char active[16];
    char order[20];
    char one[16];
    int at = 0;
    HWND hwnd;

    pump();
    creating = 0;
    name(focus, GetFocus());
    name(active, GetActiveWindow());

    for (hwnd = GetWindow(GetDesktopWindow(), GW_CHILD); hwnd && at < 18;
         hwnd = GetWindow(hwnd, GW_HWNDNEXT)) {
        name(one, hwnd);

        if (one[0] != '?') {
            order[at++] = IsWindowVisible(hwnd) ? one[0] : (char)(one[0] + ('a' - 'A'));
        }
    }

    order[at] = '\0';
    wsprintf(probeResult, "focus=%s,active=%s,iconic=%d", (LPSTR)focus, (LPSTR)active,
             count > 6 ? IsIconic(handles[6]) : 0);
    probe("state", step, probeResult);
    probe("zorder", step, order);
}

static HWND make(LPCSTR at, char which, LPCSTR kind, DWORD style, int x, int y, int cx, int cy,
                 HINSTANCE instance)
{
    char title[2];
    HWND made;

    title[0] = which;
    title[1] = '\0';
    begin(at, which);
    made = CreateWindow(kind, title, style, x, y, cx, cy, NULL, NULL, instance, NULL);
    state();
    return made;
}

static void place(LPCSTR at, HWND hwnd, HWND after, UINT flags)
{
    begin(at, 0);
    SetWindowPos(hwnd, after, 0, 0, 0, 0, flags);
    state();
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HWND a;
    HWND b;

    probeOpen(OUTPUT);
    ShowCursor(FALSE);
    SetCursorPos(GetSystemMetrics(SM_CXSCREEN) - 1, GetSystemMetrics(SM_CYSCREEN) - 1);

    kind.style = 0;
    kind.lpfnWndProc = ProbeProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = LoadIcon(NULL, IDI_APPLICATION);
    kind.hCursor = NULL;
    kind.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "ProbeSwpShow";
    RegisterClass(&kind);

    kind.lpfnWndProc = OwnerProc;
    kind.lpszClassName = "ProbeSwpOwner";
    RegisterClass(&kind);

    a = make("createA", 'A', "ProbeSwpShow", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 20, 20, 300, 200,
             instance);
    UpdateWindow(a);
    pump();

    p = make("createP", 'P', "ProbeSwpShow", WS_POPUP | WS_CAPTION, 340, 20, 120, 60, instance);
    q = make("createQ", 'Q', "ProbeSwpShow", WS_POPUP | WS_CAPTION, 340, 100, 120, 60, instance);
    r = make("createR", 'R', "ProbeSwpShow", WS_POPUP | WS_CAPTION, 340, 180, 120, 60, instance);
    s = make("createS", 'S', "ProbeSwpShow", WS_POPUP | WS_CAPTION, 480, 20, 120, 60, instance);
    t = make("createT", 'T', "ProbeSwpShow", WS_POPUP | WS_CAPTION, 480, 100, 120, 60, instance);

    place("showP", p, HWND_TOPMOST, SWP_SHOWWINDOW | SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE);
    place("showQ", q, p, SWP_SHOWWINDOW | SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE);
    place("showR", r, HWND_BOTTOM, SWP_SHOWWINDOW | SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE);
    place("showS", s, HWND_TOP,
          SWP_SHOWWINDOW | SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOMOVE | SWP_NOSIZE);
    place("showT", t, HWND_TOP, SWP_SHOWWINDOW | SWP_NOMOVE | SWP_NOSIZE);

    b = make("createB", 'B', "ProbeSwpOwner", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 60, 240, 300,
             200, instance);
    UpdateWindow(b);
    pump();

    begin("minimizeB", 0);
    SendMessage(b, WM_SYSCOMMAND, SC_MINIMIZE, 0);
    state();

    /* As Alt and Tab's loop switches to an icon (USER.EXE seg23 0868-0915):
     * brought to the top, then SC_RESTORE posted. */
    begin("restoreB", 0);
    SetWindowPos(b, HWND_TOP, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE);
    PostMessage(b, WM_SYSCOMMAND, SC_RESTORE, 0);
    state();

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
