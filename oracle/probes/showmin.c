/*
 * A window minimized, as `showseq` logs it, each step pumping the queue
 * empty after it:
 *
 * * `A`: overlapped, visible, at 20,20 300 by 200.
 * * `F`: overlapped and hidden, then shown with SW_SHOWMINNOACTIVE.
 * * `N`: overlapped, made visible and minimized.
 *
 * * `msg`, `state`: as `showseq` has them.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\SHOWMIN.OUT"

static HWND handles[16];
static char names[16][2];
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

    if (out[0] == '?' && creating && count < 16) {
        handles[count] = hwnd;
        names[count][0] = creating;
        names[count][1] = '\0';
        count++;
    }
}

static HWND lastGone;

/* A window gone: its handle no longer its name's. */
static void forget(HWND hwnd)
{
    int index;

    for (index = 0; index < count; index++) {
        if (handles[index] == hwnd) {
            handles[index] = (HWND)0xffff;
            lastGone = hwnd;
        }
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

    if (message == WM_NCDESTROY) {
        forget(hwnd);
    }
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
    char shown[20];
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

static HWND make(LPCSTR at, char which, LPCSTR kind, DWORD style, int x, int y, int cx, int cy,
                 HWND parent, int id, HINSTANCE instance)
{
    char title[2];
    HWND made;

    title[0] = which;
    title[1] = '\0';
    begin(at, which);
    made = CreateWindow(kind, title, style, x, y, cx, cy, parent, (HMENU)id, instance, NULL);
    state();
    return made;
}

static void showStep(LPCSTR at, HWND hwnd, int how)
{
    begin(at, 0);
    ShowWindow(hwnd, how);
    state();
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
    kind.lpszClassName = "ProbeShowMin";
    RegisterClass(&kind);

    a = make("createA", 'A', "ProbeShowMin", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 20, 20, 300, 200,
             NULL, 0, instance);
    UpdateWindow(a);
    pump();

    showStep("minnoactF",
             make("createF", 'F', "ProbeShowMin", WS_OVERLAPPEDWINDOW, 340, 260, 200, 100, NULL, 0,
                  instance),
             SW_SHOWMINNOACTIVE);

    make("createN", 'N', "ProbeShowMin", WS_OVERLAPPEDWINDOW | WS_VISIBLE | WS_MINIMIZE, 30, 250,
         200, 100, NULL, 0, instance);

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
