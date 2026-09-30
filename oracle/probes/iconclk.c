/*
 * The mouse on an icon: a press and release, a drag, and a double click, put
 * into the system queue through USER's MOUSE_EVENT as the mouse driver puts
 * them, so that USER's own loops take them.
 *
 * `P`, overlapped, is minimized and `Q`, another, is active. Each case moves
 * the pointer to P's icon, absolutely, and presses:
 *
 * * `click`: pressed and released where it is, with Q active.
 * * `again`: the same, a second later, with P active after the first.
 * * `drag`: pressed, moved 100 right and 100 up, and released.
 * * `double`: pressed and released twice at once.
 *
 * Then, P restored by that and Q made active again, the same on P's caption:
 *
 * * `caption`: pressed, moved 20 right and 20 down, and released.
 * * `still`: pressed and released where it is, P now active.
 *
 * And P minimized and made active again, restored without the mouse:
 *
 * * `showrestore`: by ShowWindow with SW_RESTORE.
 * * `sysrestore`: by WM_SYSCOMMAND with SC_RESTORE, sent.
 *
 * The cases are a second apart, a timer's, so no two presses make a double
 * click that are not meant to.
 *
 * For each, `log`: what P's window procedure was sent, in order -- the
 * message and its wParam, in hexadecimal, of those listed in `LOGGED`, with
 * `WM_SYSCOMMAND`'s lParam and a menu named rather than numbered; the
 * first `WM_ENTERIDLE` of a menu is logged and answered by sending P
 * `WM_CANCELMODE`, which ends the menu. Then `state`: whether P is iconic,
 * whether it is the active window, and where its window is relative to where
 * the icon was.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\ICONCLK.OUT"

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
    WM_NCACTIVATE,    WM_QUERYOPEN,   WM_MOVE,            WM_SIZE,        WM_CANCELMODE,
};

static FARPROC mouseEvent;
static HWND parent;
static char log[512];
static LPSTR logAt;
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
    } else {
        wsprintf(extra, "%x", wParam);
    }

    logAt += wsprintf(logAt, "%s%x:%s", (LPSTR)(logAt == log ? "" : " "), message, (LPSTR)extra);
}

LONG FAR PASCAL _export ParentProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    int index;

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
 * time is less. A timer of P's ends it, taken and not dispatched; the tick
 * count does not move while a program only peeks. */
static void settle(void)
{
    MSG message;

    SetTimer(parent, 99, 1000, NULL);

    while (GetMessage(&message, NULL, 0, 0)) {
        if (message.message == WM_TIMER && message.hwnd == parent && message.wParam == 99) {
            break;
        }

        TranslateMessage(&message);
        DispatchMessage(&message);
    }

    KillTimer(parent, 99);
}

static void begin(void)
{
    logAt = log;
    *logAt = '\0';
    idled = FALSE;
}

static void finish(LPCSTR name, RECT FAR *was)
{
    RECT now;

    settle();
    probe("log", name, log);

    GetWindowRect(parent, &now);
    wsprintf(probeResult, "iconic=%d,active=%d,at=%d:%d,size=%d:%d", IsIconic(parent) ? 1 : 0,
             GetActiveWindow() == parent ? 1 : 0, now.left - was->left, now.top - was->top,
             now.right - now.left, now.bottom - now.top);
    probe("state", name, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HWND other;
    RECT icon;
    POINT middle;

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
    kind.lpszClassName = "IconClickP";
    RegisterClass(&kind);

    kind.lpfnWndProc = OtherProc;
    kind.lpszClassName = "IconClickQ";
    RegisterClass(&kind);

    parent = CreateWindow("IconClickP", "P", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 60, 60, 300, 200,
                          NULL, NULL, instance, NULL);
    ShowWindow(parent, SW_MINIMIZE);
    other = CreateWindow("IconClickQ", "Q", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 300, 40, 300,
                         200, NULL, NULL, instance, NULL);
    SetActiveWindow(other);
    settle();

    mouseEvent = GetProcAddress(GetModuleHandle("USER"), "MOUSE_EVENT");
    probe("entry", "MOUSE_EVENT", mouseEvent ? "found" : "missing");

    GetWindowRect(parent, &icon);
    middle.x = (icon.left + icon.right) / 2;
    middle.y = (icon.top + icon.bottom) / 2;

    if (!mouseEvent) {
        probeFinish();
        return 0;
    }

    begin();
    mouse(SF_ABSOLUTE | MOVE, across(middle.x), down(middle.y));
    mouse(SF_ABSOLUTE | MOVE | LEFTDOWN, across(middle.x), down(middle.y));
    mouse(SF_ABSOLUTE | MOVE | LEFTUP, across(middle.x), down(middle.y));
    finish("click", &icon);

    begin();
    mouse(SF_ABSOLUTE | MOVE | LEFTDOWN, across(middle.x), down(middle.y));
    mouse(SF_ABSOLUTE | MOVE | LEFTUP, across(middle.x), down(middle.y));
    finish("again", &icon);

    begin();
    mouse(SF_ABSOLUTE | MOVE | LEFTDOWN, across(middle.x), down(middle.y));
    mouse(SF_ABSOLUTE | MOVE, across(middle.x + 100), down(middle.y - 100));
    mouse(SF_ABSOLUTE | MOVE | LEFTUP, across(middle.x + 100), down(middle.y - 100));
    finish("drag", &icon);

    GetWindowRect(parent, &icon);
    middle.x = (icon.left + icon.right) / 2;
    middle.y = (icon.top + icon.bottom) / 2;

    begin();
    mouse(SF_ABSOLUTE | MOVE, across(middle.x), down(middle.y));
    mouse(SF_ABSOLUTE | MOVE | LEFTDOWN, across(middle.x), down(middle.y));
    mouse(SF_ABSOLUTE | MOVE | LEFTUP, across(middle.x), down(middle.y));
    mouse(SF_ABSOLUTE | MOVE | LEFTDOWN, across(middle.x), down(middle.y));
    mouse(SF_ABSOLUTE | MOVE | LEFTUP, across(middle.x), down(middle.y));
    finish("double", &icon);

    SetActiveWindow(other);
    settle();
    GetWindowRect(parent, &icon);
    middle.x = icon.left + 100;
    middle.y = icon.top + GetSystemMetrics(SM_CYFRAME) + GetSystemMetrics(SM_CYCAPTION) / 2;

    begin();
    mouse(SF_ABSOLUTE | MOVE, across(middle.x), down(middle.y));
    mouse(SF_ABSOLUTE | MOVE | LEFTDOWN, across(middle.x), down(middle.y));
    mouse(SF_ABSOLUTE | MOVE, across(middle.x + 20), down(middle.y + 20));
    mouse(SF_ABSOLUTE | MOVE | LEFTUP, across(middle.x + 20), down(middle.y + 20));
    finish("caption", &icon);

    GetWindowRect(parent, &icon);
    middle.x = icon.left + 100;
    middle.y = icon.top + GetSystemMetrics(SM_CYFRAME) + GetSystemMetrics(SM_CYCAPTION) / 2;

    begin();
    mouse(SF_ABSOLUTE | MOVE, across(middle.x), down(middle.y));
    mouse(SF_ABSOLUTE | MOVE | LEFTDOWN, across(middle.x), down(middle.y));
    mouse(SF_ABSOLUTE | MOVE | LEFTUP, across(middle.x), down(middle.y));
    finish("still", &icon);

    ShowWindow(parent, SW_MINIMIZE);
    SetActiveWindow(parent);
    settle();
    GetWindowRect(parent, &icon);

    begin();
    ShowWindow(parent, SW_RESTORE);
    finish("showrestore", &icon);

    ShowWindow(parent, SW_MINIMIZE);
    SetActiveWindow(parent);
    settle();
    GetWindowRect(parent, &icon);

    begin();
    SendMessage(parent, WM_SYSCOMMAND, SC_RESTORE, 0);
    finish("sysrestore", &icon);

    DestroyWindow(other);
    DestroyWindow(parent);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
