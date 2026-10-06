/*
 * What USER's system queue asks a window as it gives out the mouse:
 * `WM_NCHITTEST`, `WM_PARENTNOTIFY`, `WM_MOUSEACTIVATE` and its answers, and
 * what a click does after them; and where a hidden window stays in the order
 * of windows. The mouse goes in through USER's `MOUSE_EVENT`, as the mouse
 * driver puts it in.
 *
 * `P` is an overlapped window at (10, 10), 360 by 300. In its client area
 * are `A`, a child at (10, 10), 160 by 150, with `B` in it, a child at
 * (10, 10), 80 by 60; and `U`, a child at (190, 10), 100 by 80, with `T`
 * over it, a child at (220, 40), 100 by 100, put in front of its brothers.
 * `Q` is an overlapped window at (300, 200), 250 by 200, with `K` in it, a
 * child at (10, 10), 200 by 120. `R1`, `R2` and `R3` are overlapped windows
 * made for the order of windows.
 *
 * Every window has one procedure, which answers `WM_NCHITTEST` with the
 * code set for it, or else with `DefWindowProc`'s, and `WM_MOUSEACTIVATE`
 * with the answer set for it, or else with `DefWindowProc`'s. While a case
 * runs it logs, in one log:
 *
 * * `X:84=h`: `WM_NCHITTEST` to X, and the hit-test code it answered.
 * * `X:21(W,hit,m)` as `WM_MOUSEACTIVATE` comes to X, naming W, with the
 *   hit-test code and the mouse message in hexadecimal; `X=a` as X answers.
 * * `X:210(m,x,y)`: `WM_PARENTNOTIFY` with the mouse message and the point.
 * * `X:sc(W,hit,m)`: `WM_SETCURSOR`.
 * * `X:6(s)`: `WM_ACTIVATE` with its state; `X:7`, `WM_SETFOCUS`.
 * * `X:m(x,y)`: a mouse message in the client area, and `X:m(hit)` one off
 *   it, in hexadecimal; `X:112(c)`: `WM_SYSCOMMAND` with its command.
 *
 * After each case, `log`, then `state`: the active window and the focus.
 *
 * Cases, each a move to a point, a press and a release there, unless said:
 *
 * * `drag`: P answers `HTCAPTION` everywhere; pressed in its client area,
 *   moved 40 across and 30 down, and let go: `rect`, where P is after.
 * * `transparent`: T answers `HTTRANSPARENT`; pressed where it is over U.
 * * `transparent2`: the same where it is over nothing but P.
 * * `transtop`: Q answers `HTTRANSPARENT`, pressed in its client area beside
 *   K, where it is over P.
 * * `notify`: P active; B pressed with the left button, then with the
 *   right; `notify2` with `WS_EX_NOPARENTNOTIFY` set on A and B.
 * * `ma0` to `ma4`, and `madef`: P active, K pressed, with Q answering
 *   `WM_MOUSEACTIVATE` with 0 to 4, or with `DefWindowProc`; K's answer is
 *   `DefWindowProc`'s.
 * * `border`: P active, Q answering `HTBORDER` over K.
 * * `caption`: P active, Q answering `HTCAPTION` over K.
 * * `peek`: P active, A pressed, then `PeekMessage` with `PM_NOREMOVE`, and
 *   then with `PM_REMOVE` for the keys only: `peek` and `peekkey` say what
 *   each answered, and the log so far.
 * * `z...`: the order of the windows named among the desktop's children,
 *   the front first, `-` after a hidden one, and the active window, after
 *   each step: R2 hidden, shown with `SW_SHOWNA`, hidden and shown with
 *   `SW_SHOW`; R2, active, hidden, and shown with `SW_SHOWNOACTIVATE`; R1
 *   hidden with `SetWindowPos`; A hidden and shown again, among P's
 *   children.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\MOUSEMSG.OUT"

/* Each record is closed into the file, so a hang leaves those before it. */
static void record(LPCSTR function, LPCSTR args, LPCSTR result)
{
    probe(function, args, result);
    _lclose(probeHandle);
    probeHandle = _lopen(OUTPUT, OF_WRITE);
    _llseek(probeHandle, 0, 2);
}

#define probe record

#define SF_ABSOLUTE 0x8000
#define MOVE 0x0001
#define LEFTDOWN 0x0002
#define LEFTUP 0x0004
#define RIGHTDOWN 0x0008
#define RIGHTUP 0x0010

#define TIMER 99
#define WINDOWS 10
#define DEFAULT 0x7fff

#ifndef WS_EX_NOPARENTNOTIFY
#define WS_EX_NOPARENTNOTIFY 0x00000004L
#endif

static FARPROC mouseEvent;
static HWND pump;
static HWND windows[WINDOWS];
static LPCSTR names[WINDOWS] = {"P", "A", "B", "U", "T", "Q", "K", "R1", "R2", "R3"};
static int hits[WINDOWS];
static int activates[WINDOWS];
static char log[2048];
static LPSTR logAt;
static BOOL logging;

#define P windows[0]
#define A windows[1]
#define B windows[2]
#define U windows[3]
#define T windows[4]
#define Q windows[5]
#define K windows[6]
#define R1 windows[7]
#define R2 windows[8]
#define R3 windows[9]

static LPCSTR nameOf(HWND hwnd)
{
    int index;

    if (hwnd == NULL) {
        return "0";
    }

    for (index = 0; index < WINDOWS; index++) {
        if (windows[index] == hwnd) {
            return names[index];
        }
    }

    return "?";
}

static int indexOf(HWND hwnd)
{
    int index;

    for (index = 0; index < WINDOWS; index++) {
        if (windows[index] == hwnd) {
            return index;
        }
    }

    return -1;
}

static void note(LPCSTR text)
{
    if (logging && logAt - log < (int)sizeof(log) - 40) {
        logAt += wsprintf(logAt, "%s%s", (LPSTR)(logAt == log ? "" : " "), text);
    }
}

static void begin(void)
{
    logAt = log;
    *logAt = '\0';
    logging = TRUE;
}

static void reset(void)
{
    int index;

    for (index = 0; index < WINDOWS; index++) {
        hits[index] = DEFAULT;
        activates[index] = DEFAULT;
    }
}

LONG FAR PASCAL _export ProbeProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    char text[64];
    LONG answer;
    int at = indexOf(hwnd);
    LPCSTR name = nameOf(hwnd);

    switch (message) {
    case WM_NCHITTEST:
        answer = at >= 0 && hits[at] != DEFAULT ? (LONG)hits[at]
                                                 : DefWindowProc(hwnd, message, wParam, lParam);
        wsprintf(text, "%s:84=%d", name, (int)(short)LOWORD(answer));
        note(text);
        return answer;

    case WM_MOUSEACTIVATE:
        wsprintf(text, "%s:21(%s,%d,%x)", name, nameOf((HWND)wParam), (int)(short)LOWORD(lParam),
                 HIWORD(lParam));
        note(text);
        answer = at >= 0 && activates[at] != DEFAULT ? (LONG)activates[at]
                                                      : DefWindowProc(hwnd, message, wParam, lParam);
        wsprintf(text, "%s=%ld", name, answer);
        note(text);
        return answer;

    case WM_PARENTNOTIFY:
        wsprintf(text, "%s:210(%x,%d,%d)", name, wParam, (int)(short)LOWORD(lParam),
                 (int)(short)HIWORD(lParam));
        note(text);
        break;

    case WM_SETCURSOR:
        wsprintf(text, "%s:sc(%s,%d,%x)", name, nameOf((HWND)wParam), (int)(short)LOWORD(lParam),
                 HIWORD(lParam));
        note(text);
        break;

    case WM_ACTIVATE:
        wsprintf(text, "%s:6(%d)", name, wParam);
        note(text);
        break;

    case WM_SETFOCUS:
        wsprintf(text, "%s:7", name);
        note(text);
        break;

    case WM_SYSCOMMAND:
        wsprintf(text, "%s:112(%x)", name, wParam);
        note(text);
        break;

    default:
        if (message >= WM_MOUSEMOVE && message <= WM_MBUTTONDBLCLK) {
            wsprintf(text, "%s:%x(%d,%d)", name, message, (int)(short)LOWORD(lParam),
                     (int)(short)HIWORD(lParam));
            note(text);
        } else if (message >= WM_NCMOUSEMOVE && message <= WM_NCMBUTTONDBLCLK) {
            wsprintf(text, "%s:%x(%d)", name, message, (int)(short)wParam);
            note(text);
        }
        break;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

static WORD mouseFlags;
static WORD mouseX;
static WORD mouseY;

static void mouse(WORD flags, WORD x, WORD y)
{
    mouseFlags = flags;
    mouseX = x;
    mouseY = y;

    _asm {
        push si
        push di
        mov ax, mouseFlags
        mov bx, mouseX
        mov cx, mouseY
        mov dx, 2
        xor si, si
        xor di, di
        call dword ptr mouseEvent
        pop di
        pop si
    }
}

/* A point of the screen as MOUSE_EVENT's absolute coordinates, 0 to 65535. */
static WORD across(int x)
{
    return (WORD)(((DWORD)x * 65536L + GetSystemMetrics(SM_CXSCREEN) - 1) /
                  GetSystemMetrics(SM_CXSCREEN));
}

static WORD down(int y)
{
    return (WORD)(((DWORD)y * 65536L + GetSystemMetrics(SM_CYSCREEN) - 1) /
                  GetSystemMetrics(SM_CYSCREEN));
}

/* Messages dispatched for a while: a quarter of a second, three of them
 * between two presses at one place, more than a double click's half second.
 * A timer of the pump's ends it, taken and not dispatched. */
static void settle(void)
{
    MSG message;

    SetTimer(pump, TIMER, 250, NULL);

    while (GetMessage(&message, NULL, 0, 0)) {
        if (message.message == WM_TIMER && message.hwnd == pump && message.wParam == TIMER) {
            break;
        }

        TranslateMessage(&message);
        DispatchMessage(&message);
    }

    KillTimer(pump, TIMER);
}

/* The mouse away, on the screen's corner, and its messages gone. */
static void away(void)
{
    logging = FALSE;
    mouse(SF_ABSOLUTE | MOVE, across(GetSystemMetrics(SM_CXSCREEN) - 1),
          down(GetSystemMetrics(SM_CYSCREEN) - 1));
    settle();
}

static void state(LPCSTR name)
{
    wsprintf(probeResult, "active=%s,focus=%s", nameOf(GetActiveWindow()), nameOf(GetFocus()));
    probe("state", name, probeResult);
}

static void finish(LPCSTR name)
{
    settle();
    logging = FALSE;
    probe("log", name, logAt == log ? "none" : log);
    state(name);
    away();
    reset();
}

/* A point of a window's client area, on the screen. */
static POINT on(HWND hwnd, int x, int y)
{
    POINT point;

    point.x = x;
    point.y = y;
    ClientToScreen(hwnd, &point);
    return point;
}

/* A move to a point, a press and a release there. */
static void click(POINT at, WORD press, WORD release)
{
    mouse(SF_ABSOLUTE | MOVE, across(at.x), down(at.y));
    mouse(SF_ABSOLUTE | MOVE | press, across(at.x), down(at.y));
    mouse(SF_ABSOLUTE | MOVE | release, across(at.x), down(at.y));
}

static void press(LPCSTR name, POINT at)
{
    begin();
    click(at, LEFTDOWN, LEFTUP);
    finish(name);
}

/* P active, and in front of Q where it was. */
static void pActive(void)
{
    logging = FALSE;
    SetActiveWindow(P);
    SetFocus(P);
    settle();
}

/* The order of the windows named among a parent's children, the front first. */
static void order(LPCSTR name, HWND parent)
{
    char text[80];
    LPSTR at = text;
    HWND hwnd;

    *at = '\0';

    for (hwnd = GetWindow(parent, GW_CHILD); hwnd; hwnd = GetWindow(hwnd, GW_HWNDNEXT)) {
        if (indexOf(hwnd) >= 0) {
            at += wsprintf(at, "%s%s%s", (LPSTR)(at == text ? "" : ","), nameOf(hwnd),
                           (LPSTR)(IsWindowVisible(hwnd) ? "" : "-"));
        }
    }

    wsprintf(probeResult, "%s;active=%s", (LPSTR)text, nameOf(GetActiveWindow()));
    probe("order", name, probeResult);
}

static HWND make(LPCSTR title, DWORD style, int x, int y, int width, int height, HWND parent,
                 HINSTANCE instance)
{
    return CreateWindow("MouseMsg", title, style, x, y, width, height, parent, NULL, instance,
                        NULL);
}

static void activating(LPCSTR name, int answer)
{
    pActive();
    activates[5] = answer;
    press(name, on(K, 150, 90));
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS k;
    RECT rect;
    MSG message;
    BOOL found;
    POINT at;

    probeOpen(OUTPUT);
    reset();

    k.style = 0;
    k.lpfnWndProc = ProbeProc;
    k.cbClsExtra = 0;
    k.cbWndExtra = 0;
    k.hInstance = instance;
    k.hIcon = NULL;
    k.hCursor = LoadCursor(NULL, IDC_ARROW);
    k.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    k.lpszMenuName = NULL;
    k.lpszClassName = "MouseMsg";
    RegisterClass(&k);

    pump = CreateWindow("MouseMsg", "", WS_POPUP, 0, 0, 1, 1, NULL, NULL, instance, NULL);

    P = make("P", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 10, 10, 360, 300, NULL, instance);
    A = make("", WS_CHILD | WS_VISIBLE, 10, 10, 160, 150, P, instance);
    B = make("", WS_CHILD | WS_VISIBLE, 10, 10, 80, 60, A, instance);
    U = make("", WS_CHILD | WS_VISIBLE, 190, 10, 100, 80, P, instance);
    T = make("", WS_CHILD | WS_VISIBLE, 220, 40, 100, 100, P, instance);
    SetWindowPos(T, HWND_TOP, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    Q = make("Q", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 300, 200, 250, 200, NULL, instance);
    K = make("", WS_CHILD | WS_VISIBLE, 10, 10, 200, 120, Q, instance);

    mouseEvent = GetProcAddress(GetModuleHandle("USER"), "MOUSE_EVENT");
    probe("entry", "MOUSE_EVENT", mouseEvent ? "found" : "missing");

    if (!mouseEvent) {
        probeFinish();
        return 0;
    }

    away();
    order("start", GetDesktopWindow());
    order("children", P);

    /* HTCAPTION from the client area: P dragged by it. */
    pActive();
    hits[0] = HTCAPTION;
    at = on(P, 300, 200);
    begin();
    mouse(SF_ABSOLUTE | MOVE, across(at.x), down(at.y));
    mouse(SF_ABSOLUTE | MOVE | LEFTDOWN, across(at.x), down(at.y));
    mouse(SF_ABSOLUTE | MOVE, across(at.x + 20), down(at.y + 15));
    mouse(SF_ABSOLUTE | MOVE, across(at.x + 40), down(at.y + 30));
    mouse(SF_ABSOLUTE | MOVE | LEFTUP, across(at.x + 40), down(at.y + 30));
    finish("drag");
    GetWindowRect(P, &rect);
    wsprintf(probeResult, "%d,%d,%d,%d", rect.left, rect.top, rect.right, rect.bottom);
    probe("rect", "drag", probeResult);
    MoveWindow(P, 10, 10, 360, 300, TRUE);
    settle();

    /* HTTRANSPARENT: T over U, and over P alone. */
    pActive();
    hits[4] = HTTRANSPARENT;
    press("transparent", on(T, 20, 20));

    pActive();
    hits[4] = HTTRANSPARENT;
    press("transparent2", on(T, 90, 90));

    /* A window at the top answering HTTRANSPARENT, over P. */
    pActive();
    SetWindowPos(Q, HWND_TOP, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    settle();
    order("transtop", GetDesktopWindow());
    hits[5] = HTTRANSPARENT;
    press("transtop", on(Q, 5, 40));

    /* WM_PARENTNOTIFY through two windows, and with WS_EX_NOPARENTNOTIFY. */
    pActive();
    begin();
    click(on(B, 20, 20), LEFTDOWN, LEFTUP);
    click(on(B, 30, 25), RIGHTDOWN, RIGHTUP);
    finish("notify");

    SetWindowLong(A, GWL_EXSTYLE, GetWindowLong(A, GWL_EXSTYLE) | WS_EX_NOPARENTNOTIFY);
    SetWindowLong(B, GWL_EXSTYLE, GetWindowLong(B, GWL_EXSTYLE) | WS_EX_NOPARENTNOTIFY);
    pActive();
    press("notify2", on(B, 20, 20));
    SetWindowLong(A, GWL_EXSTYLE, GetWindowLong(A, GWL_EXSTYLE) & ~WS_EX_NOPARENTNOTIFY);
    SetWindowLong(B, GWL_EXSTYLE, GetWindowLong(B, GWL_EXSTYLE) & ~WS_EX_NOPARENTNOTIFY);

    /* WM_MOUSEACTIVATE's answers, Q's, asked through K's DefWindowProc. */
    activating("ma0", 0);
    activating("ma1", MA_ACTIVATE);
    activating("ma2", MA_ACTIVATEANDEAT);
    activating("ma3", MA_NOACTIVATE);
    activating("ma4", MA_NOACTIVATEANDEAT);
    activating("madef", DEFAULT);

    /* Pressed off the client area, as Q says: a border, the caption. */
    pActive();
    hits[5] = HTBORDER;
    hits[6] = HTTRANSPARENT;
    press("border", on(K, 150, 90));

    pActive();
    hits[5] = HTCAPTION;
    hits[6] = HTTRANSPARENT;
    press("caption", on(K, 150, 90));

    /* Each look asks again; a look for the keys too. */
    pActive();
    begin();
    click(on(A, 120, 120), LEFTDOWN, LEFTUP);
    found = PeekMessage(&message, NULL, 0, 0, PM_NOREMOVE);
    wsprintf(probeResult, "found=%d,%s:%x;%s", found, nameOf(found ? message.hwnd : NULL),
             found ? message.message : 0, (LPSTR)(logAt == log ? "none" : log));
    probe("peek", "peek", probeResult);
    begin();
    found = PeekMessage(&message, NULL, WM_KEYFIRST, WM_KEYLAST, PM_REMOVE);
    wsprintf(probeResult, "found=%d;%s", found, (LPSTR)(logAt == log ? "none" : log));
    probe("peek", "peekkey", probeResult);
    begin();
    finish("peek");

    /* Where a hidden window stays. */
    logging = FALSE;
    R1 = make("R1", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 20, 330, 150, 100, NULL, instance);
    R2 = make("R2", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 60, 350, 150, 100, NULL, instance);
    R3 = make("R3", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 100, 370, 150, 100, NULL, instance);
    settle();
    order("zmade", GetDesktopWindow());

    ShowWindow(R2, SW_HIDE);
    settle();
    order("zhidden", GetDesktopWindow());

    ShowWindow(R2, SW_SHOWNA);
    settle();
    order("zshowna", GetDesktopWindow());

    ShowWindow(R2, SW_HIDE);
    ShowWindow(R2, SW_SHOW);
    settle();
    order("zshow", GetDesktopWindow());

    ShowWindow(R2, SW_HIDE);
    settle();
    order("zhideactive", GetDesktopWindow());

    ShowWindow(R2, SW_SHOWNOACTIVATE);
    settle();
    order("zshownoact", GetDesktopWindow());

    SetWindowPos(R1, 0, 0, 0, 0, 0,
                 SWP_HIDEWINDOW | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
    settle();
    order("zswp", GetDesktopWindow());

    ShowWindow(A, SW_HIDE);
    settle();
    order("zchild", P);

    ShowWindow(A, SW_SHOW);
    settle();
    order("zchildshow", P);

    DestroyWindow(R3);
    DestroyWindow(R2);
    DestroyWindow(R1);
    DestroyWindow(Q);
    DestroyWindow(P);
    DestroyWindow(pump);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
