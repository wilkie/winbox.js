/*
 * A double click on a window's caption, put into the system queue through
 * USER's MOUSE_EVENT as the mouse driver puts it, for windows with and
 * without a maximize box.
 *
 * Each case makes `P` afresh at (60, 60), 300 by 200, active, and double
 * clicks the middle of its caption, 100 pixels in:
 *
 * * `nobox`: `WS_CAPTION | WS_SYSMENU | WS_THICKFRAME | WS_MINIMIZEBOX`, no
 *   maximize box.
 * * `box`: `WS_OVERLAPPEDWINDOW`, which has one.
 * * `again`: the same window, maximized by the case before, double clicked
 *   again.
 * * `grayed`: `WS_OVERLAPPEDWINDOW`, its system menu's Maximize grayed with
 *   `EnableMenuItem` first.
 * * `zoomed`: no maximize box, as `nobox`, maximized with `ShowWindow`
 *   first.
 * * `frame`: a pop-up with a dialog box's frame, `WS_POPUP | WS_CAPTION |
 *   WS_SYSMENU` and `WS_EX_DLGMODALFRAME`, as the Save As box is.
 * * `sent`: no maximize box, as `nobox`, sent `WM_SYSCOMMAND` with
 *   `SC_MAXIMIZE` and no mouse at all.
 *
 * For each, `log`: what P's window procedure was sent from the double
 * click's `WM_NCLBUTTONDBLCLK` on (from the start, for `sent`), in order --
 * the message and its wParam, in hexadecimal, of those listed in `LOGGED`,
 * with `WM_SYSCOMMAND`'s lParam. Then `state`: whether P is zoomed, iconic
 * and active, and its window's rectangle.
 *
 * Left out of the log, as not what the probe asks: the first press's
 * `SC_MOVE` and the loop it runs, the buttons' releases, which land on the
 * caption or in the client area as the window has moved by then, and
 * `WM_GETMINMAXINFO`.
 *
 * The cases are a second apart, a timer's, so no two presses make a double
 * click that are not meant to.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\CAPDBL.OUT"

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

static const UINT LOGGED[] = {WM_NCLBUTTONDBLCLK, WM_SYSCOMMAND, WM_SIZE};

static FARPROC mouseEvent;
static HWND parent;
static char log[512];
static LPSTR logAt;
static BOOL watching;

static void note(UINT message, WPARAM wParam, LPARAM lParam)
{
    char extra[40];

    if (logAt - log >= (int)sizeof(log) - 40) {
        return;
    }

    if (message == WM_SYSCOMMAND) {
        wsprintf(extra, "%x:%lx", wParam, lParam);
    } else {
        wsprintf(extra, "%x", wParam);
    }

    logAt += wsprintf(logAt, "%s%x:%s", (LPSTR)(logAt == log ? "" : " "), message, (LPSTR)extra);
}

LONG FAR PASCAL _export ParentProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    int index;

    if (message == WM_NCLBUTTONDBLCLK) {
        watching = TRUE;
    }

    for (index = 0; watching && index < (int)(sizeof(LOGGED) / sizeof(LOGGED[0])); index++) {
        if (LOGGED[index] == message) {
            note(message, wParam, lParam);
            break;
        }
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

/* Messages dispatched for a while: a second, at least, as a double click's
 * time is less. A timer of P's ends it, taken and not dispatched. */
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
    watching = FALSE;
}

static void make(HINSTANCE instance, DWORD style, DWORD extended)
{
    parent = CreateWindowEx(extended, "CapDblP", "P", style, 60, 60, 300, 200, NULL, NULL,
                            instance, NULL);
    ShowWindow(parent, SW_SHOWNORMAL);
    SetActiveWindow(parent);
    settle();
}

/* The caption's middle, 100 pixels in, double clicked as it is now. */
static void twice(void)
{
    RECT r;
    int x;
    int y;

    GetWindowRect(parent, &r);
    x = r.left + 100;
    y = r.top + (GetWindowLong(parent, GWL_STYLE) & WS_THICKFRAME ? GetSystemMetrics(SM_CYFRAME)
                                                                   : GetSystemMetrics(SM_CYDLGFRAME)) +
        GetSystemMetrics(SM_CYCAPTION) / 2;

    if (y < 0) {
        y = GetSystemMetrics(SM_CYCAPTION) / 2;
    }

    mouse(SF_ABSOLUTE | MOVE, across(x), down(y));
    mouse(SF_ABSOLUTE | MOVE | LEFTDOWN, across(x), down(y));
    mouse(SF_ABSOLUTE | MOVE | LEFTUP, across(x), down(y));
    mouse(SF_ABSOLUTE | MOVE | LEFTDOWN, across(x), down(y));
    mouse(SF_ABSOLUTE | MOVE | LEFTUP, across(x), down(y));
}

static void finish(LPCSTR name)
{
    RECT now;

    settle();
    probe("log", name, log);

    GetWindowRect(parent, &now);
    wsprintf(probeResult, "zoomed=%d,iconic=%d,active=%d,rect=%d:%d:%d:%d", IsZoomed(parent) ? 1 : 0,
             IsIconic(parent) ? 1 : 0, GetActiveWindow() == parent ? 1 : 0, now.left, now.top,
             now.right, now.bottom);
    probe("state", name, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    const DWORD NOBOX = WS_CAPTION | WS_SYSMENU | WS_THICKFRAME | WS_MINIMIZEBOX;

    probeOpen(OUTPUT);
    begin();
    ShowCursor(FALSE);

    kind.style = 0;
    kind.lpfnWndProc = ParentProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = LoadIcon(NULL, IDI_APPLICATION);
    kind.hCursor = LoadCursor(NULL, IDC_ARROW);
    kind.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "CapDblP";
    RegisterClass(&kind);

    mouseEvent = GetProcAddress(GetModuleHandle("USER"), "MOUSE_EVENT");
    probe("entry", "MOUSE_EVENT", mouseEvent ? "found" : "missing");

    if (!mouseEvent) {
        probeFinish();
        return 0;
    }

    make(instance, NOBOX, 0);
    begin();
    twice();
    finish("nobox");
    DestroyWindow(parent);

    make(instance, WS_OVERLAPPEDWINDOW, 0);
    begin();
    twice();
    finish("box");

    begin();
    twice();
    finish("again");
    DestroyWindow(parent);

    make(instance, WS_OVERLAPPEDWINDOW, 0);
    EnableMenuItem(GetSystemMenu(parent, FALSE), SC_MAXIMIZE, MF_BYCOMMAND | MF_GRAYED);
    begin();
    twice();
    finish("grayed");
    DestroyWindow(parent);

    make(instance, NOBOX, 0);
    ShowWindow(parent, SW_SHOWMAXIMIZED);
    settle();
    begin();
    twice();
    finish("zoomed");
    DestroyWindow(parent);

    make(instance, WS_POPUP | WS_CAPTION | WS_SYSMENU, WS_EX_DLGMODALFRAME);
    begin();
    twice();
    finish("frame");
    DestroyWindow(parent);

    make(instance, NOBOX, 0);
    begin();
    watching = TRUE;
    SendMessage(parent, WM_SYSCOMMAND, SC_MAXIMIZE, 0);
    finish("sent");
    DestroyWindow(parent);

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
