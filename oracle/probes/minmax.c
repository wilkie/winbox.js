/*
 * Where a window's size is held to what `WM_GETMINMAXINFO` answers: as it is
 * made, moved with `SetWindowPos`, maximized, minimized and sized from the
 * keyboard, with the answer left as USER offers it and changed, and by a
 * window procedure that passes `WM_WINDOWPOSCHANGING` to `DefWindowProc` and
 * one that answers it itself.
 *
 * `W` is made at (10, 10) for each case, of a class whose procedure logs, in
 * order, each of:
 *
 * * `WM_GETMINMAXINFO`: `24:` and the five points as USER offers them --
 *   `ptReserved`, `ptMaxSize`, `ptMaxPosition`, `ptMinTrackSize`,
 *   `ptMaxTrackSize` -- each `x,y`, `/` between them; then the case's own
 *   changes are made to it.
 * * `WM_WINDOWPOSCHANGING`: `46:` the place and size asked, `x,y,cx,cy`, and
 *   after `>` the size as `DefWindowProc` left it -- or `own` where the case
 *   answers it without `DefWindowProc`.
 * * `WM_WINDOWPOSCHANGED`: `47:` the place and size, `x,y,cx,cy`.
 * * `WM_NCCREATE` `81`, `WM_NCCALCSIZE` `83`, `WM_CREATE` `1`.
 *
 * then `log` writes them and `rect` the window's rectangle, `left:top:right:
 * bottom`, after the case. The cases:
 *
 * * `create`: `WS_OVERLAPPEDWINDOW`, made 40 by 10.
 * * `create-min`: the same, the least tracking size answered 200 by 150.
 * * `create-max`: made 500 by 400, the most tracking size answered 300 by 200.
 * * `create-pthick`: `WS_POPUP | WS_THICKFRAME`, made 4 by 4.
 * * `create-pthick-min`: the same made 40 by 10, the least 60 by 50.
 * * `create-pborder`: `WS_POPUP | WS_BORDER`, made 40 by 10, the least 60 by 50.
 * * `create-own`: `WS_OVERLAPPEDWINDOW`, made 40 by 10, the procedure
 *   answering `WM_WINDOWPOSCHANGING` itself.
 * * `swp`: `WS_OVERLAPPEDWINDOW` made 300 by 200, then `SetWindowPos` to
 *   30 by 5.
 * * `swp-own`: the same, answering `WM_WINDOWPOSCHANGING` itself.
 * * `swp-neg`, `swp-negdef`: to -5 by -7, answering it itself and not.
 * * `min-one`: `SetWindowPos` to 30 by 5, the least answered 1 by 1, for
 *   `WS_OVERLAPPEDWINDOW`; `-cap` a caption alone; `-sys` and the system
 *   menu; `-sysmin` and a minimize box; `-pthick` `WS_POPUP |
 *   WS_THICKFRAME`; `-pthickcap` that with a caption and system menu.
 * * `min-big`: to 30 by 5, the least 200 by 150.
 * * `max-small`: to 400 by 300, the most 300 by 200.
 * * `max-undermin`: to 400 by 300, the most 50 by 20, less than the least.
 * * `zoom`: shown maximized, `ptMaxSize` answered 300 by 200 and
 *   `ptMaxPosition` (10, 20).
 * * `zoom-big`: `ptMaxSize` 800 by 600; `zoom-own` the same answering
 *   `WM_WINDOWPOSCHANGING` itself; `zoom-track`, the most tracking size 300
 *   by 200 and `ptMaxSize` as offered.
 * * `icon`: with `A`, another window, shown and active at (400, 300),
 *   `WS_OVERLAPPEDWINDOW`, `ptReserved` answered 50 by 50,
 *   minimized with `SW_SHOWMINNOACTIVE` from hidden and then `SetWindowPos`
 *   to 10 by 10; `rect` after each, and `state` once minimized: whether it
 *   is the active window, and shown.
 * * `icon-nobox`: the same without a minimize box.
 * * `icon-big`: minimized and `SetWindowPos` to 1000 by 1000.
 * * `track-min`: shown at (100, 100), 300 by 200, the least answered 200 by
 *   150, answering `WM_WINDOWPOSCHANGING` itself, sized from the keyboard:
 *   `SC_SIZE`, Left to take the left edge, Right twenty times, Enter.
 * * `track-max`: the most answered 350 by 250, Right to take the right
 *   edge and Right twenty times.
 *
 * The queue is made to hold 64 messages, for the keys posted: one holds
 * eight, and the ninth key is not posted.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\MINMAX.OUT"

/* Each record is closed into the file, so a hang leaves those before it. */
static void record(LPCSTR function, LPCSTR args, LPCSTR result)
{
    probe(function, args, result);
    _lclose(probeHandle);
    probeHandle = _lopen(OUTPUT, OF_WRITE);
    _llseek(probeHandle, 0, 2);
}

#define probe record

static HINSTANCE module;
static HWND anchor;
static char events[1500];

/* What the case does with `WM_GETMINMAXINFO` and `WM_WINDOWPOSCHANGING`. */
static BOOL own;
static POINT reserved;
static POINT maxSize;
static POINT maxPosition;
static POINT minTrack;
static POINT maxTrack;
static BOOL setReserved;
static BOOL setMaxSize;
static BOOL setMaxPosition;
static BOOL setMinTrack;
static BOOL setMaxTrack;

static void add(LPCSTR text)
{
    if (lstrlen(events) + lstrlen(text) + 2 < sizeof(events)) {
        if (events[0]) {
            lstrcat(events, " ");
        }

        lstrcat(events, text);
    }
}

LONG FAR PASCAL _export Proc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    char one[160];

    if (message == WM_GETMINMAXINFO) {
        MINMAXINFO FAR *info = (MINMAXINFO FAR *)lParam;

        wsprintf(one, "24:%d,%d/%d,%d/%d,%d/%d,%d/%d,%d", info->ptReserved.x, info->ptReserved.y,
                 info->ptMaxSize.x, info->ptMaxSize.y, info->ptMaxPosition.x,
                 info->ptMaxPosition.y, info->ptMinTrackSize.x, info->ptMinTrackSize.y,
                 info->ptMaxTrackSize.x, info->ptMaxTrackSize.y);
        add(one);

        if (setReserved) {
            info->ptReserved = reserved;
        }

        if (setMaxSize) {
            info->ptMaxSize = maxSize;
        }

        if (setMaxPosition) {
            info->ptMaxPosition = maxPosition;
        }

        if (setMinTrack) {
            info->ptMinTrackSize = minTrack;
        }

        if (setMaxTrack) {
            info->ptMaxTrackSize = maxTrack;
        }

        return 0;
    }

    if (message == WM_WINDOWPOSCHANGING) {
        WINDOWPOS FAR *pos = (WINDOWPOS FAR *)lParam;
        char asked[40];

        wsprintf(asked, "%d,%d,%d,%d", pos->x, pos->y, pos->cx, pos->cy);

        if (own) {
            wsprintf(one, "46:%s>own", (LPSTR)asked);
            add(one);
            return 0;
        }

        DefWindowProc(hwnd, message, wParam, lParam);
        wsprintf(one, "46:%s>%d,%d", (LPSTR)asked, pos->cx, pos->cy);
        add(one);
        return 0;
    }

    if (message == WM_WINDOWPOSCHANGED) {
        WINDOWPOS FAR *pos = (WINDOWPOS FAR *)lParam;

        wsprintf(one, "47:%d,%d,%d,%d", pos->x, pos->y, pos->cx, pos->cy);
        add(one);
    } else if (message == WM_NCCREATE || message == WM_NCCALCSIZE || message == WM_CREATE) {
        wsprintf(one, "%x", message);
        add(one);
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

static void pump(void)
{
    MSG message;
    int count = 0;

    while (count < 200 && PeekMessage(&message, NULL, 0, 0, PM_REMOVE)) {
        TranslateMessage(&message);
        DispatchMessage(&message);
        count++;
    }
}

static void reset(void)
{
    events[0] = '\0';
    own = FALSE;
    setReserved = FALSE;
    setMaxSize = FALSE;
    setMaxPosition = FALSE;
    setMinTrack = FALSE;
    setMaxTrack = FALSE;
}

static void writeRect(LPCSTR name, HWND w)
{
    RECT r;

    GetWindowRect(w, &r);
    wsprintf(probeResult, "%d:%d:%d:%d", r.left, r.top, r.right, r.bottom);
    probe("rect", name, probeResult);
}

/* The log so far and the window's rectangle, and the window gone. */
static void finish(LPCSTR name, HWND w)
{
    pump();
    probe("log", name, events);
    writeRect(name, w);
    DestroyWindow(w);
    pump();
}

static HWND make(DWORD style, int cx, int cy)
{
    return CreateWindow("MinMax", "W", style, 10, 10, cx, cy, NULL, NULL, module, NULL);
}

static void least(int x, int y)
{
    setMinTrack = TRUE;
    minTrack.x = x;
    minTrack.y = y;
}

static void most(int x, int y)
{
    setMaxTrack = TRUE;
    maxTrack.x = x;
    maxTrack.y = y;
}

static void created(LPCSTR name, DWORD style, int cx, int cy)
{
    finish(name, make(style, cx, cy));
}

/* Made 300 by 200 as offered, then set to `cx` by `cy` with the case's answer. */
static void moved(LPCSTR name, DWORD style, int cx, int cy)
{
    HWND w;
    BOOL wasOwn = own;
    BOOL wasMin = setMinTrack;
    BOOL wasMax = setMaxTrack;

    own = FALSE;
    setMinTrack = FALSE;
    setMaxTrack = FALSE;
    w = make(style, 300, 200);
    events[0] = '\0';
    own = wasOwn;
    setMinTrack = wasMin;
    setMaxTrack = wasMax;
    SetWindowPos(w, NULL, 0, 0, cx, cy, SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE);
    finish(name, w);
}

static void zoomed(LPCSTR name)
{
    HWND w = make(WS_OVERLAPPEDWINDOW, 300, 200);

    events[0] = '\0';
    ShowWindow(w, SW_SHOWMAXIMIZED);
    finish(name, w);
}

static void iconic(LPCSTR name, DWORD style, int cx, int cy)
{
    HWND w = make(style, 300, 200);
    char label[40];

    events[0] = '\0';
    ShowWindow(w, SW_SHOWMINNOACTIVE);
    pump();
    wsprintf(label, "%s-min", name);
    writeRect(label, w);
    wsprintf(probeResult, "active=%d,visible=%d", GetActiveWindow() == w, IsWindowVisible(w));
    probe("state", label, probeResult);
    SetWindowPos(w, NULL, 0, 0, cx, cy, SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE);
    finish(name, w);
}

static void tracked(LPCSTR name, UINT first, UINT key)
{
    HWND w = CreateWindow("MinMax", "W", WS_OVERLAPPEDWINDOW, 100, 100, 300, 200, NULL, NULL,
                          module, NULL);
    int step;

    ShowWindow(w, SW_SHOWNORMAL);
    UpdateWindow(w);
    pump();
    events[0] = '\0';

    PostMessage(w, WM_KEYDOWN, first, 0L);

    for (step = 0; step < 20; step++) {
        PostMessage(w, WM_KEYDOWN, key, 0L);
    }

    PostMessage(w, WM_KEYDOWN, VK_RETURN, 0L);
    SendMessage(w, WM_SYSCOMMAND, SC_SIZE, 0L);
    finish(name, w);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;

    probeOpen(OUTPUT);
    module = instance;

    /* Room for the keys the sizing cases post: a queue holds eight. */
    SetMessageQueue(64);

    kind.style = 0;
    kind.lpfnWndProc = Proc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = LoadIcon(NULL, IDI_APPLICATION);
    kind.hCursor = LoadCursor(NULL, IDC_ARROW);
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "MinMax";
    RegisterClass(&kind);
    kind.lpfnWndProc = DefWindowProc;
    kind.lpszClassName = "Anchor";
    RegisterClass(&kind);

    /* The pointer out of the way. */
    ShowCursor(FALSE);
    SetCursorPos(639, 479);

    reset();
    created("create", WS_OVERLAPPEDWINDOW, 40, 10);
    reset();
    least(200, 150);
    created("create-min", WS_OVERLAPPEDWINDOW, 40, 10);
    reset();
    most(300, 200);
    created("create-max", WS_OVERLAPPEDWINDOW, 500, 400);
    reset();
    created("create-pthick", WS_POPUP | WS_THICKFRAME, 4, 4);
    reset();
    least(60, 50);
    created("create-pthick-min", WS_POPUP | WS_THICKFRAME, 40, 10);
    reset();
    least(60, 50);
    created("create-pborder", WS_POPUP | WS_BORDER, 40, 10);
    reset();
    own = TRUE;
    created("create-own", WS_OVERLAPPEDWINDOW, 40, 10);

    reset();
    moved("swp", WS_OVERLAPPEDWINDOW, 30, 5);
    reset();
    own = TRUE;
    moved("swp-own", WS_OVERLAPPEDWINDOW, 30, 5);
    reset();
    own = TRUE;
    moved("swp-neg", WS_OVERLAPPEDWINDOW, -5, -7);
    reset();
    moved("swp-negdef", WS_OVERLAPPEDWINDOW, -5, -7);

    reset();
    least(1, 1);
    moved("min-one", WS_OVERLAPPEDWINDOW, 30, 5);
    reset();
    least(1, 1);
    moved("min-one-cap", WS_OVERLAPPED | WS_CAPTION, 30, 5);
    reset();
    least(1, 1);
    moved("min-one-sys", WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU, 30, 5);
    reset();
    least(1, 1);
    moved("min-one-sysmin", WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX, 30, 5);
    reset();
    least(1, 1);
    moved("min-one-pthick", WS_POPUP | WS_THICKFRAME, 30, 5);
    reset();
    least(1, 1);
    moved("min-one-pthickcap", WS_POPUP | WS_THICKFRAME | WS_CAPTION | WS_SYSMENU, 30, 5);
    reset();
    least(200, 150);
    moved("min-big", WS_OVERLAPPEDWINDOW, 30, 5);
    reset();
    most(300, 200);
    moved("max-small", WS_OVERLAPPEDWINDOW, 400, 300);
    reset();
    most(50, 20);
    moved("max-undermin", WS_OVERLAPPEDWINDOW, 400, 300);

    reset();
    setMaxSize = TRUE;
    maxSize.x = 300;
    maxSize.y = 200;
    setMaxPosition = TRUE;
    maxPosition.x = 10;
    maxPosition.y = 20;
    zoomed("zoom");
    reset();
    setMaxSize = TRUE;
    maxSize.x = 800;
    maxSize.y = 600;
    zoomed("zoom-big");
    reset();
    setMaxSize = TRUE;
    maxSize.x = 800;
    maxSize.y = 600;
    own = TRUE;
    zoomed("zoom-own");
    reset();
    most(300, 200);
    zoomed("zoom-track");

    /* `A`, shown and active, so that the icons are not: with no window
     * active, the icon minimized with `SW_SHOWMINNOACTIVE` is made active. */
    anchor = CreateWindow("Anchor", "A", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 400, 300, 120, 80, NULL,
                          NULL, module, NULL);
    UpdateWindow(anchor);
    pump();

    reset();
    setReserved = TRUE;
    reserved.x = 50;
    reserved.y = 50;
    iconic("icon", WS_OVERLAPPEDWINDOW, 10, 10);
    reset();
    setReserved = TRUE;
    reserved.x = 50;
    reserved.y = 50;
    iconic("icon-nobox", WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_THICKFRAME, 10, 10);
    reset();
    iconic("icon-big", WS_OVERLAPPEDWINDOW, 1000, 1000);
    DestroyWindow(anchor);
    pump();

    reset();
    least(200, 150);
    own = TRUE;
    tracked("track-min", VK_LEFT, VK_RIGHT);
    reset();
    most(350, 250);
    own = TRUE;
    tracked("track-max", VK_RIGHT, VK_RIGHT);

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
