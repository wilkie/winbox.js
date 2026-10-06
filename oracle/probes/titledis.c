/*
 * The mouse on a disabled window's icon and on its icon's title, put into the
 * system queue through USER's MOUSE_EVENT as the mouse driver puts them, so
 * that USER's own loops take them.
 *
 * `P`, overlapped, is minimized and `Q`, another, is active. Each case moves
 * the pointer to a point and presses and releases there:
 *
 * * `title`: P's icon's title, P enabled.
 * * `distitle`: the same, P disabled with `EnableWindow`, as a message box
 *   or dialog box it owns disables it.
 * * `disicon`: P's icon itself, P disabled.
 *
 * For each, `hit`: the class of the window `WindowFromPoint` names at the
 * point, and whether it is enabled. Then `log`: what P's window procedure was
 * sent, in order -- the message and its wParam, in hexadecimal, of those
 * listed in `LOGGED`, with `WM_SYSCOMMAND`'s lParam and a menu named rather
 * than numbered; the first `WM_ENTERIDLE` of a menu is logged and answered by
 * sending P `WM_CANCELMODE`, which ends the menu. Then `cursor`: the
 * `WM_SETCURSOR`s P was sent, apart, each with whose window its wParam names
 * and its lParam. Then `state`: whether P is iconic and whether it is the
 * active window.
 *
 * The cases are a second apart, a timer's, so no two presses make a double
 * click.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\TITLEDIS.OUT"

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

static const UINT LOGGED[] = {
    WM_NCLBUTTONDOWN, WM_NCLBUTTONUP, WM_NCLBUTTONDBLCLK, WM_LBUTTONDOWN, WM_LBUTTONUP,
    WM_SYSCOMMAND,    WM_INITMENU,    WM_INITMENUPOPUP,   WM_ENTERIDLE,   WM_ACTIVATE,
    WM_NCACTIVATE,    WM_QUERYOPEN,   WM_MOUSEACTIVATE,   WM_CANCELMODE,
};

static FARPROC mouseEvent;
static HWND parent;
static char log[512];
static LPSTR logAt;
static char cursors[256];
static LPSTR cursorAt;
static BOOL idled;

/* A message as the log has it: `WM_SYSCOMMAND`'s lParam as well, and a menu
 * named, `sys` for P's system menu and `menu` for another, as its handle is
 * only a number. */
static void note(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    char extra[40];

    if (logAt - log >= (int)sizeof(log) - 40) {
        return;
    }

    if (message == WM_SYSCOMMAND) {
        wsprintf(extra, "%x:%lx", wParam, lParam);
    } else if (message == WM_INITMENU || message == WM_INITMENUPOPUP) {
        wsprintf(extra, "%s:%lx", (LPSTR)((HMENU)wParam == GetSystemMenu(hwnd, FALSE) ? "sys" : "menu"),
                 message == WM_INITMENU ? 0L : lParam);
    } else if (message == WM_MOUSEACTIVATE) {
        wsprintf(extra, "%s:%lx", (LPSTR)((HWND)wParam == hwnd ? "self" : "other"), lParam);
    } else {
        wsprintf(extra, "%x", wParam);
    }

    logAt += wsprintf(logAt, "%s%x:%s", (LPSTR)(logAt == log ? "" : " "), message, (LPSTR)extra);
}

LONG FAR PASCAL _export ParentProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    int index;

    if (message == WM_SETCURSOR && cursorAt - cursors < (int)sizeof(cursors) - 24) {
        cursorAt += wsprintf(cursorAt, "%s%s:%lx", (LPSTR)(cursorAt == cursors ? "" : " "),
                             (LPSTR)((HWND)wParam == hwnd ? "self" : "other"), lParam);
    }

    for (index = 0; index < (int)(sizeof(LOGGED) / sizeof(LOGGED[0])); index++) {
        if (LOGGED[index] == message) {
            if (message != WM_ENTERIDLE || !idled) {
                note(hwnd, message, wParam, lParam);
            }

            break;
        }
    }

    if (message == WM_ENTERIDLE && !idled) {
        idled = TRUE;
        SendMessage(hwnd, WM_CANCELMODE, 0, 0);
        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

LONG FAR PASCAL _export OtherProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
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

/* Messages dispatched for a while: a second, at least, as a double click's
 * time is less. A timer of Q's ends it, taken and not dispatched, as P may
 * be disabled. */
static HWND other;

static void settle(void)
{
    MSG message;

    SetTimer(other, 99, 1000, NULL);

    while (GetMessage(&message, NULL, 0, 0)) {
        if (message.message == WM_TIMER && message.hwnd == other && message.wParam == 99) {
            break;
        }

        TranslateMessage(&message);
        DispatchMessage(&message);
    }

    KillTimer(other, 99);
}

static void begin(void)
{
    logAt = log;
    *logAt = '\0';
    cursorAt = cursors;
    *cursorAt = '\0';
    idled = FALSE;
}

/* What is at a point: its class and whether it is enabled. */
static void hit(LPCSTR name, POINT at)
{
    HWND under = WindowFromPoint(at);
    char kind[40];

    kind[0] = '\0';

    if (under) {
        GetClassName(under, kind, sizeof(kind));
    }

    wsprintf(probeResult, "%s,parent=%d,enabled=%d", (LPSTR)kind, under == parent ? 1 : 0,
             under && IsWindowEnabled(under) ? 1 : 0);
    probe("hit", name, probeResult);
}

static void press(LPCSTR name, POINT at)
{
    hit(name, at);
    begin();
    mouse(SF_ABSOLUTE | MOVE, across(at.x), down(at.y));
    mouse(SF_ABSOLUTE | MOVE | LEFTDOWN, across(at.x), down(at.y));
    mouse(SF_ABSOLUTE | MOVE | LEFTUP, across(at.x), down(at.y));
    settle();
    probe("log", name, log);
    probe("cursor", name, cursors);

    wsprintf(probeResult, "iconic=%d,active=%d", IsIconic(parent) ? 1 : 0,
             GetActiveWindow() == parent ? 1 : 0);
    probe("state", name, probeResult);

    /* Away again, and Q active, for the next. */
    mouse(SF_ABSOLUTE | MOVE, across(GetSystemMetrics(SM_CXSCREEN) - 1),
          down(GetSystemMetrics(SM_CYSCREEN) - 1));

    if (!IsIconic(parent)) {
        ShowWindow(parent, SW_MINIMIZE);
    }

    SetActiveWindow(other);
    settle();
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    RECT icon;
    POINT middle;
    POINT title;

    probeOpen(OUTPUT);
    begin();
    ShowCursor(FALSE);
    SetCursorPos(GetSystemMetrics(SM_CXSCREEN) - 1, GetSystemMetrics(SM_CYSCREEN) - 1);

    kind.style = 0;
    kind.lpfnWndProc = ParentProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = LoadIcon(NULL, IDI_APPLICATION);
    kind.hCursor = LoadCursor(NULL, IDC_ARROW);
    kind.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "TitleDisP";
    RegisterClass(&kind);

    kind.lpfnWndProc = OtherProc;
    kind.lpszClassName = "TitleDisQ";
    RegisterClass(&kind);

    parent = CreateWindow("TitleDisP", "P", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 60, 60, 300, 200,
                          NULL, NULL, instance, NULL);
    ShowWindow(parent, SW_MINIMIZE);
    other = CreateWindow("TitleDisQ", "Q", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 300, 40, 300, 200,
                         NULL, NULL, instance, NULL);
    SetActiveWindow(other);
    settle();

    mouseEvent = GetProcAddress(GetModuleHandle("USER"), "MOUSE_EVENT");
    probe("entry", "MOUSE_EVENT", mouseEvent ? "found" : "missing");

    if (!mouseEvent) {
        probeFinish();
        return 0;
    }

    GetWindowRect(parent, &icon);
    middle.x = (icon.left + icon.right) / 2;
    middle.y = (icon.top + icon.bottom) / 2;
    title.x = middle.x;
    title.y = icon.bottom + 6;

    press("title", title);

    EnableWindow(parent, FALSE);
    settle();
    press("distitle", title);
    press("disicon", middle);

    EnableWindow(parent, TRUE);
    DestroyWindow(other);
    DestroyWindow(parent);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
