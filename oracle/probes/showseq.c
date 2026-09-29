/*
 * Every message a window gets as it is made, shown and painted, in order:
 * what a program that does its work in WM_CREATE, WM_SHOWWINDOW, WM_SIZE or
 * WM_ACTIVATE sees, and when.
 *
 * Windows of one class, each named as it is made -- the name is given to a
 * handle the first time the class's procedure sees one it does not know --
 * made in turn, each step pumping the queue empty after it:
 *
 * * `A`: overlapped, hidden, at 20,20 300 by 200; then shown with
 *   SW_SHOWNORMAL and updated.
 * * `B`: overlapped and visible, at CW_USEDEFAULT.
 * * `C`: a child of A, visible, at 10,10 100 by 50.
 * * `P`: a popup with a caption, visible, at 60,60 200 by 100.
 * * `M`: overlapped, visible and maximized.
 * * A hidden with SW_HIDE and shown again with SW_SHOW.
 * * All destroyed, C with A.
 *
 * * `msg`: the step and the number of the message in it; the window, the
 *   message in hexadecimal, and its parameters. A window's handle is its
 *   name, another's its class after a `?`; a pointer's structure is written out: CREATESTRUCT as its place,
 *   size and style, WINDOWPOS as its place, size and flags, MINMAXINFO as
 *   its five points, NCCALCSIZE's first rectangle; WM_NCPAINT's region as `rgn`
 *   unless it is the whole frame, 1. The mouse's own messages,
 *   which depend on where the pointer is, are left out.
 * * `state`: after each step, the active window, the focus, and which
 *   windows are visible.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\SHOWSEQ.OUT"

static HWND handles[8];
static char names[8][2];
static int count;
static char creating;
static LPCSTR step = "";
static int number;

static void name(LPSTR out, HWND hwnd)
{
    int index;

    if (hwnd == NULL) {
        lstrcpy(out, "0");
        return;
    }

    for (index = 0; index < count; index++) {
        if (handles[index] == hwnd) {
            lstrcpy(out, names[index]);
            return;
        }
    }

    /* Another's window: its class, or its handle when it is none. */
    if (IsWindow(hwnd)) {
        out[0] = '?';
        GetClassName(hwnd, out + 1, 14);
    } else {
        wsprintf(out, "?%x", (UINT)hwnd);
    }
}

/* Gives the window being made its name the first time it is seen. */
static void know(HWND hwnd)
{
    char out[16];

    name(out, hwnd);

    if (out[0] == '?' && creating && count < 8) {
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
        return;
    }

    know(hwnd);
    wsprintf(w, "%x", wParam);
    wsprintf(l, "%lx", lParam);

    switch (message) {
    case WM_NCCREATE:
    case WM_CREATE: {
        CREATESTRUCT FAR *cs = (CREATESTRUCT FAR *)lParam;

        wsprintf(l, "%d:%d:%d:%d:%lx", cs->x, cs->y, cs->cx, cs->cy, cs->style);
        break;
    }
    case WM_WINDOWPOSCHANGING:
    case WM_WINDOWPOSCHANGED: {
        WINDOWPOS FAR *wp = (WINDOWPOS FAR *)lParam;
        char after[16];

        name(after, wp->hwndInsertAfter);
        wsprintf(l, "%s:%d:%d:%d:%d:%x", (LPSTR)after, wp->x, wp->y, wp->cx, wp->cy, wp->flags);
        break;
    }
    case WM_GETMINMAXINFO: {
        POINT FAR *p = (POINT FAR *)lParam;

        wsprintf(l, "%d:%d/%d:%d/%d:%d/%d:%d/%d:%d", p[0].x, p[0].y, p[1].x, p[1].y, p[2].x,
                 p[2].y, p[3].x, p[3].y, p[4].x, p[4].y);
        break;
    }
    case WM_NCCALCSIZE: {
        RECT FAR *r = (RECT FAR *)lParam;

        wsprintf(l, "%d:%d:%d:%d", r->left, r->top, r->right, r->bottom);
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
        /* The whole frame, or a region's handle, which is no two runs' same. */
        lstrcpy(w, wParam == 1 ? "1" : "rgn");
        break;
    case WM_ERASEBKGND:
    case WM_CTLCOLOR:
    case WM_ICONERASEBKGND:
        lstrcpy(w, "hdc");
        break;
    case WM_PARENTNOTIFY:
        name(l, (HWND)LOWORD(lParam));
        wsprintf(l + lstrlen(l), ":%x", HIWORD(lParam));
        break;
    case WM_SETTEXT:
    case WM_GETTEXT:
        lstrcpy(l, "ptr");
        break;
    }

    name(who, hwnd);
    wsprintf(probeArgs, "%s,%d", step, number++);
    wsprintf(probeResult, "%s,%04x,%s,%s", (LPSTR)who, message, (LPSTR)w, (LPSTR)l);
    probe("msg", probeArgs, probeResult);
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

static void pump(void)
{
    MSG message;

    while (PeekMessage(&message, NULL, 0, 0, PM_REMOVE)) {
        TranslateMessage(&message);
        DispatchMessage(&message);
    }
}

static void begin(LPCSTR name, char made)
{
    step = name;
    number = 0;
    creating = made;
}

static void state(void)
{
    char focus[16];
    char active[16];
    char shown[16];
    int index;
    int at = 0;

    pump();
    creating = 0;
    name(focus, GetFocus());
    name(active, GetActiveWindow());

    for (index = 0; index < count; index++) {
        if (IsWindow(handles[index]) && IsWindowVisible(handles[index])) {
            shown[at++] = names[index][0];
        }
    }

    shown[at] = '\0';
    wsprintf(probeResult, "focus=%s,active=%s,visible=%s", (LPSTR)focus, (LPSTR)active,
             (LPSTR)shown);
    probe("state", step, probeResult);
}

static HWND handleOf(char which)
{
    int index;

    for (index = 0; index < count; index++) {
        if (names[index][0] == which) {
            return handles[index];
        }
    }

    return NULL;
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HWND a;

    probeOpen(OUTPUT);
    ShowCursor(FALSE);
    SetCursorPos(GetSystemMetrics(SM_CXSCREEN) - 1, GetSystemMetrics(SM_CYSCREEN) - 1);

    kind.style = 0;
    kind.lpfnWndProc = ProbeProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "ProbeCreateSeq";
    RegisterClass(&kind);

    begin("createA", 'A');
    a = CreateWindow("ProbeCreateSeq", "A", WS_OVERLAPPEDWINDOW, 20, 20, 300, 200, NULL, NULL,
                     instance, NULL);
    state();

    begin("showA", 0);
    ShowWindow(a, SW_SHOWNORMAL);
    state();

    begin("updateA", 0);
    UpdateWindow(a);
    state();

    begin("createB", 'B');
    CreateWindow("ProbeCreateSeq", "B", WS_OVERLAPPEDWINDOW | WS_VISIBLE, CW_USEDEFAULT, 0,
                 CW_USEDEFAULT, 0, NULL, NULL, instance, NULL);
    state();

    begin("createC", 'C');
    CreateWindow("ProbeCreateSeq", "C", WS_CHILD | WS_VISIBLE | WS_BORDER, 10, 10, 100, 50, a,
                 (HMENU)7, instance, NULL);
    state();

    begin("createP", 'P');
    CreateWindow("ProbeCreateSeq", "P", WS_POPUP | WS_CAPTION | WS_VISIBLE, 60, 60, 200, 100, a,
                 NULL, instance, NULL);
    state();

    begin("createM", 'M');
    CreateWindow("ProbeCreateSeq", "M", WS_OVERLAPPEDWINDOW | WS_VISIBLE | WS_MAXIMIZE, 30, 30,
                 200, 100, NULL, NULL, instance, NULL);
    state();

    begin("hideA", 0);
    ShowWindow(a, SW_HIDE);
    state();

    begin("reshowA", 0);
    ShowWindow(a, SW_SHOW);
    state();

    begin("destroyM", 0);
    DestroyWindow(handleOf('M'));
    state();

    begin("destroyP", 0);
    DestroyWindow(handleOf('P'));
    state();

    begin("destroyB", 0);
    DestroyWindow(handleOf('B'));
    state();

    begin("destroyA", 0);
    DestroyWindow(a);
    state();

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
