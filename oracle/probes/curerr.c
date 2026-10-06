/*
 * `WM_SETCURSOR` as USER sends it with the mouse on a disabled window and
 * through `DefWindowProc`, put into the system queue through USER's
 * `MOUSE_EVENT` as the mouse driver puts it.
 *
 * `O` is an overlapped window with a menu bar, whose class has double clicks
 * and the I-beam; `C` a child of it, whose class has the cross; `D` a pop-up
 * `O` owns; `Q` another overlapped window, owned by nothing; `H` one made
 * hidden, which goes in front of all as it is made. Each logs, in
 * one log, what it is sent of `WM_SETCURSOR` -- as `X:sc(W,hit,mouse)`, the
 * window it names, the hit-test code signed, the mouse message in
 * hexadecimal -- and of `WM_ACTIVATE`, the mouse messages, `WM_INITMENU`,
 * `WM_INITMENUPOPUP` and `WM_ENTERIDLE`, the message in hexadecimal. The
 * first `WM_ENTERIDLE` of a menu is answered by sending its window
 * `WM_CANCELMODE`, which ends the menu.
 *
 * After each case: `log`, then `state`: the active window, the cursor by
 * name, and the order of `O`, `D` and `H` among the top-level windows, the
 * front first, with `-` after one hidden.
 *
 * * `front`: `O` disabled, `D` active and in front; a move, a press and a
 *   release of the left button on `O`'s client area.
 * * `hidden`: the same, with `Q` hidden and `H` made: the first window after
 *   `O`, going round, that is enabled and shown is then `D`, and `D` is not
 *   in front of all.
 * * `right`: the same with `H` made again, the right button.
 * * `unowned`: `Q` shown and active in front, `D` behind it.
 * * `child`: `O` enabled and active, `C` disabled; pressed over `C`.
 * * `peekerr`: `O` disabled; the mouse moved, pressed and released on it,
 *   and then `PeekMessage` with `PM_NOREMOVE`: what it answers, its message,
 *   and the log; then the rest as before.
 * * `peekok`: the same with `O` enabled.
 * * `double`: `O` clicked twice, fast.
 * * `posted`: `WM_LBUTTONDOWN` posted to `O`.
 * * `capture`: `O` has the mouse with `SetCapture`, and it moves.
 * * `track`: `TrackPopupMenu` on `O`.
 * * `menubar`: `O`'s menu bar pressed.
 * * `defproc`: `WM_SETCURSOR` sent straight to `DefWindowProc` through `C`'s
 *   procedure and `O`'s, as `X(W,hit,mouse)`: the log, the answer and the
 *   cursor after.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\CURERR.OUT"

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

#define ITEM 101
#define TIMER 99

static FARPROC mouseEvent;
static HWND o;
static HWND c;
static HWND d;
static HWND q;
static HWND h;
static HINSTANCE module;
static HMENU bar;
static HMENU file;
static HCURSOR arrow;
static HCURSOR ibeam;
static HCURSOR cross;
static HCURSOR wait;
static HCURSOR sizewe;
static char log[1024];
static LPSTR logAt;
static BOOL idled;

static LPCSTR nameOf(HWND hwnd)
{
    if (hwnd == o) return "O";
    if (hwnd == c) return "C";
    if (hwnd == d) return "D";
    if (hwnd == q) return "Q";
    if (hwnd == h) return "H";
    if (hwnd == NULL) return "0";
    return "other";
}

static LPCSTR cursorName(HCURSOR cursor)
{
    if (cursor == arrow) return "arrow";
    if (cursor == ibeam) return "ibeam";
    if (cursor == cross) return "cross";
    if (cursor == wait) return "wait";
    if (cursor == sizewe) return "sizewe";
    if (cursor == NULL) return "none";
    return "other";
}

static void note(LPCSTR text)
{
    if (logAt - log < (int)sizeof(log) - 40) {
        logAt += wsprintf(logAt, "%s%s", (LPSTR)(logAt == log ? "" : " "), text);
    }
}

static void begin(void)
{
    logAt = log;
    *logAt = '\0';
    idled = FALSE;
}

static BOOL logged(UINT message)
{
    return message == WM_ACTIVATE || message == WM_INITMENU || message == WM_INITMENUPOPUP ||
           message == WM_ENTERIDLE || (message >= WM_MOUSEMOVE && message <= WM_MBUTTONDBLCLK) ||
           (message >= WM_NCMOUSEMOVE && message <= WM_NCMBUTTONDBLCLK);
}

LONG FAR PASCAL _export ProbeProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    char text[48];

    if (message == WM_SETCURSOR) {
        wsprintf(text, "%s:sc(%s,%d,%x)", nameOf(hwnd), nameOf((HWND)wParam),
                 (int)(short)LOWORD(lParam), HIWORD(lParam));
        note(text);
    } else if (logged(message) && !(message == WM_ENTERIDLE && idled)) {
        wsprintf(text, "%s:%x", nameOf(hwnd), message);
        note(text);
    }

    if (message == WM_ENTERIDLE && !idled) {
        idled = TRUE;
        SendMessage(hwnd, WM_CANCELMODE, 0, 0);
        return 0;
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

/* Messages dispatched for a while: six tenths of a second, more than a double
 * click's half. A timer of the pump's ends it, taken and not dispatched. */
static HWND pump;

static void settle(void)
{
    MSG message;

    SetTimer(pump, TIMER, 600, NULL);

    while (GetMessage(&message, NULL, 0, 0)) {
        if (message.message == WM_TIMER && message.hwnd == pump && message.wParam == TIMER) {
            break;
        }

        TranslateMessage(&message);
        DispatchMessage(&message);
    }

    KillTimer(pump, TIMER);
}

/* The active window, the cursor, and the order of O, D and Q. */
static void state(LPCSTR name)
{
    char order[40];
    LPSTR orderAt = order;
    HWND at;

    *orderAt = '\0';

    for (at = GetWindow(GetDesktopWindow(), GW_CHILD); at; at = GetWindow(at, GW_HWNDNEXT)) {
        if (at == o || at == d || at == h) {
            orderAt += wsprintf(orderAt, "%s%s", nameOf(at), (LPSTR)(IsWindowVisible(at) ? "" : "-"));
        }
    }

    wsprintf(probeResult, "active=%s,cursor=%s,order=%s", nameOf(GetActiveWindow()),
             cursorName(GetCursor()), (LPSTR)order);
    probe("state", name, probeResult);
}

static void finish(LPCSTR name)
{
    settle();
    probe("log", name, logAt == log ? "none" : log);
    state(name);
}

/* A move, a press and a release at a point of the screen. */
static void click(POINT at, WORD press, WORD release)
{
    mouse(SF_ABSOLUTE | MOVE, across(at.x), down(at.y));
    mouse(SF_ABSOLUTE | MOVE | press, across(at.x), down(at.y));
    mouse(SF_ABSOLUTE | MOVE | release, across(at.x), down(at.y));
}

/* The mouse away, on the screen's corner, and its messages gone. */
static void away(void)
{
    mouse(SF_ABSOLUTE | MOVE, across(GetSystemMetrics(SM_CXSCREEN) - 1),
          down(GetSystemMetrics(SM_CYSCREEN) - 1));
    settle();
}

static void press(LPCSTR name, POINT at, WORD press, WORD release)
{
    begin();
    click(at, press, release);
    finish(name);
    away();
}

/* Q hidden, and H made again, hidden, in front of all. */
static void hiddenInFront(void)
{
    ShowWindow(q, SW_HIDE);

    if (h) {
        DestroyWindow(h);
    }

    h = CreateWindow("CurErrQ", "H", WS_OVERLAPPEDWINDOW, 380, 280, 100, 80, NULL, NULL, module,
                     NULL);
    settle();
}

static void kind(HINSTANCE instance, LPCSTR name, HCURSOR cursor, UINT style)
{
    WNDCLASS k;

    k.style = style;
    k.lpfnWndProc = ProbeProc;
    k.cbClsExtra = 0;
    k.cbWndExtra = 0;
    k.hInstance = instance;
    k.hIcon = NULL;
    k.hCursor = cursor;
    k.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    k.lpszMenuName = NULL;
    k.lpszClassName = name;
    RegisterClass(&k);
}

/* DefWindowProc's answer to a WM_SETCURSOR sent straight to a window. */
static void straightTo(HWND to, HWND named, int hit, UINT mouseMessage)
{
    char text[48];
    LONG answer;

    begin();
    SetCursor(wait);
    answer = SendMessage(to, WM_SETCURSOR, (WPARAM)named, MAKELONG(hit, mouseMessage));
    wsprintf(text, "%s(%s,%d,%x)", nameOf(to), nameOf(named), hit, mouseMessage);
    wsprintf(probeResult, "%s;answer=%ld,cursor=%s", (LPSTR)(logAt == log ? "none" : log), answer,
             cursorName(GetCursor()));
    probe("defproc", text, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    POINT onO;
    POINT onC;
    POINT onBar;
    RECT rect;
    MSG message;
    BOOL found;

    module = instance;
    probeOpen(OUTPUT);
    begin();

    arrow = LoadCursor(NULL, IDC_ARROW);
    ibeam = LoadCursor(NULL, IDC_IBEAM);
    cross = LoadCursor(NULL, IDC_CROSS);
    wait = LoadCursor(NULL, IDC_WAIT);
    sizewe = LoadCursor(NULL, IDC_SIZEWE);

    kind(instance, "CurErrO", ibeam, CS_DBLCLKS);
    kind(instance, "CurErrC", cross, 0);
    kind(instance, "CurErrD", NULL, 0);
    kind(instance, "CurErrQ", NULL, 0);
    kind(instance, "CurErrP", NULL, 0);

    pump = CreateWindow("CurErrP", "", WS_POPUP, 0, 0, 1, 1, NULL, NULL, instance, NULL);

    bar = CreateMenu();
    file = CreatePopupMenu();
    AppendMenu(file, MF_STRING, ITEM, "&Item");
    AppendMenu(bar, MF_POPUP, (UINT)file, "&File");

    o = CreateWindow("CurErrO", "O", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 20, 20, 300, 240, NULL, bar,
                     instance, NULL);
    c = CreateWindow("CurErrC", "", WS_CHILD | WS_VISIBLE, 10, 10, 80, 60, o, NULL, instance, NULL);
    q = CreateWindow("CurErrQ", "Q", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 360, 260, 240, 160, NULL, NULL,
                     instance, NULL);
    d = CreateWindow("CurErrD", "D", WS_POPUP | WS_CAPTION | WS_SYSMENU | WS_VISIBLE, 360, 40, 200,
                     120, o, NULL, instance, NULL);
    SetActiveWindow(d);

    mouseEvent = GetProcAddress(GetModuleHandle("USER"), "MOUSE_EVENT");
    probe("entry", "MOUSE_EVENT", mouseEvent ? "found" : "missing");

    if (!mouseEvent) {
        probeFinish();
        return 0;
    }

    away();

    onO.x = 200;
    onO.y = 120;
    ClientToScreen(o, &onO);
    onC.x = 40;
    onC.y = 30;
    ClientToScreen(o, &onC);
    GetWindowRect(o, &rect);
    onBar.x = rect.left + GetSystemMetrics(SM_CXFRAME) + 12;
    onBar.y = rect.top + GetSystemMetrics(SM_CYFRAME) + GetSystemMetrics(SM_CYCAPTION) +
              GetSystemMetrics(SM_CYMENU) / 2;

    EnableWindow(o, FALSE);
    settle();
    begin();
    state("start");

    press("front", onO, LEFTDOWN, LEFTUP);

    hiddenInFront();
    begin();
    state("hiddenbefore");
    press("hidden", onO, LEFTDOWN, LEFTUP);

    hiddenInFront();
    begin();
    state("rightbefore");
    press("right", onO, RIGHTDOWN, RIGHTUP);

    ShowWindow(q, SW_SHOW);
    SetActiveWindow(q);
    settle();
    begin();
    state("unownedbefore");
    press("unowned", onO, LEFTDOWN, LEFTUP);

    /* O enabled, its pop-up gone, C disabled. */
    ShowWindow(d, SW_HIDE);
    EnableWindow(o, TRUE);
    EnableWindow(c, FALSE);
    SetActiveWindow(o);
    settle();
    begin();
    press("child", onC, LEFTDOWN, LEFTUP);
    EnableWindow(c, TRUE);

    /* PeekMessage leaving the message, O disabled, then enabled. */
    EnableWindow(o, FALSE);
    settle();
    begin();
    click(onO, LEFTDOWN, LEFTUP);
    found = PeekMessage(&message, NULL, 0, 0, PM_NOREMOVE);
    wsprintf(probeResult, "found=%d,%s:%x;%s", found, nameOf(found ? message.hwnd : NULL),
             found ? message.message : 0, (LPSTR)(logAt == log ? "none" : log));
    probe("peek", "peekerr", probeResult);
    begin();
    finish("peekerr");
    away();

    EnableWindow(o, TRUE);
    SetActiveWindow(o);
    settle();
    begin();
    click(onO, LEFTDOWN, LEFTUP);
    found = PeekMessage(&message, NULL, 0, 0, PM_NOREMOVE);
    wsprintf(probeResult, "found=%d,%s:%x;%s", found, nameOf(found ? message.hwnd : NULL),
             found ? message.message : 0, (LPSTR)(logAt == log ? "none" : log));
    probe("peek", "peekok", probeResult);
    begin();
    finish("peekok");
    away();

    /* Twice, fast: a double click. */
    begin();
    click(onO, LEFTDOWN, LEFTUP);
    mouse(SF_ABSOLUTE | MOVE | LEFTDOWN, across(onO.x), down(onO.y));
    mouse(SF_ABSOLUTE | MOVE | LEFTUP, across(onO.x), down(onO.y));
    finish("double");
    away();

    begin();
    PostMessage(o, WM_LBUTTONDOWN, MK_LBUTTON, MAKELONG(10, 10));
    finish("posted");

    /* The mouse O's, moving over it. */
    mouse(SF_ABSOLUTE | MOVE, across(onO.x), down(onO.y));
    settle();
    SetCapture(o);
    begin();
    mouse(SF_ABSOLUTE | MOVE, across(onO.x + 3), down(onO.y + 2));
    finish("capture");
    ReleaseCapture();
    away();

    begin();
    TrackPopupMenu(file, 0, onO.x, onO.y, 0, o, NULL);
    finish("track");
    away();

    begin();
    click(onBar, LEFTDOWN, LEFTUP);
    finish("menubar");
    away();

    /* Straight to DefWindowProc. */
    straightTo(c, c, HTLEFT, WM_MOUSEMOVE);
    straightTo(c, c, HTCLIENT, WM_MOUSEMOVE);
    straightTo(c, c, HTCLIENT, 0);
    straightTo(o, o, HTCLIENT, 0);
    straightTo(o, c, HTCLIENT, WM_MOUSEMOVE);
    straightTo(o, o, HTCAPTION, WM_MOUSEMOVE);
    straightTo(o, o, HTERROR, WM_MOUSEMOVE);
    straightTo(o, o, HTLEFT, 0);
    straightTo(o, o, HTNOWHERE, WM_LBUTTONDOWN);

    DestroyWindow(d);
    DestroyWindow(h);
    DestroyWindow(q);
    DestroyWindow(o);
    DestroyWindow(pump);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
