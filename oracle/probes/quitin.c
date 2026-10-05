/*
 * Where `WM_QUIT` comes among the mouse's messages: the moves USER makes of
 * its own accord when a window goes from under the cursor, and the moves
 * the mouse driver puts into the system queue through USER's MOUSE_EVENT.
 *
 * `quitord` has the quit after every message posted and before a paint and
 * a timer; this has it against input. A program whose main window's object
 * is freed as the window is destroyed (Borland's ObjectWindows does so)
 * reads the freed object if its message loop is handed anything but the
 * quit after `WM_DESTROY`.
 *
 * `B`, a pop-up at (0, 0), 400 by 300, stays throughout; `A`, a pop-up at
 * (100, 100), 200 by 150, is made over it for the cases that destroy it.
 * Each case starts with the queue emptied and ends with it emptied again:
 *
 * * `gone`: the cursor at (500, 400), over the desktop and A's place moved
 *   there; A destroyed, so nothing of the probe's is under the cursor; then
 *   `PostQuitMessage`.
 * * `goneunder`: the cursor at (200, 150), in A and over B; A destroyed,
 *   leaving B under it; then the quit.
 * * `goneget`: as `gone`, the first message taken with `GetMessage`.
 * * `driver`: a move to (150, 120), in B, put in by MOUSE_EVENT; then the
 *   quit.
 * * `driverafter`: the quit, then a move to (160, 130) by MOUSE_EVENT.
 * * `posted`: a message posted to B, a move by MOUSE_EVENT to (170, 140),
 *   then the quit.
 *
 * For each, `order`: every message taken, in turn, as its number in hex
 * and the window it was for -- `A`, `B`, `desktop`, `none` or the handle --
 * with a mouse message's point, until the queue is empty.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\QUITIN.OUT"

#define SF_ABSOLUTE 0x8000
#define MOVE 0x0001

static FARPROC mouseEvent;
static HWND windowA;
static HWND windowB;
static HINSTANCE module;

static WORD mouseFlags;
static WORD mouseX;
static WORD mouseY;

LONG FAR PASCAL _export ProbeProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    return DefWindowProc(hwnd, message, wParam, lParam);
}

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

static LPCSTR whose(HWND hwnd)
{
    static char handle[8];

    if (hwnd == NULL) {
        return "none";
    }

    if (hwnd == windowA) {
        return "A";
    }

    if (hwnd == windowB) {
        return "B";
    }

    if (hwnd == GetDesktopWindow()) {
        return "desktop";
    }

    wsprintf(handle, "%04x", hwnd);
    return handle;
}

static void add(MSG FAR *message)
{
    char one[48];

    if (message->message >= WM_MOUSEFIRST && message->message <= WM_MOUSELAST) {
        wsprintf(one, "%x:%s(%d,%d),", message->message, whose(message->hwnd),
                 LOWORD(message->lParam), HIWORD(message->lParam));
    } else {
        wsprintf(one, "%x:%s,", message->message, whose(message->hwnd));
    }

    lstrcat(probeResult, one);
}

/* Everything waiting taken and dispatched, a paint validated. */
static void drain(void)
{
    MSG message;
    int count = 0;

    while (count < 40 && PeekMessage(&message, NULL, 0, 0, PM_REMOVE)) {
        if (message.message != WM_QUIT) {
            DispatchMessage(&message);
        }

        count++;
    }
}

/* Every message taken in turn, the first with GetMessage where asked. */
static void order(LPCSTR name, BOOL get)
{
    MSG message;
    int count = 0;

    probeResult[0] = '\0';

    if (get) {
        GetMessage(&message, NULL, 0, 0);
        add(&message);
        count++;

        if (message.message != WM_QUIT) {
            DispatchMessage(&message);
        }
    }

    while (count < 12 && PeekMessage(&message, NULL, 0, 0, PM_REMOVE)) {
        add(&message);
        count++;

        if (message.message == WM_PAINT) {
            ValidateRect(message.hwnd, NULL);
        } else if (message.message != WM_QUIT) {
            DispatchMessage(&message);
        }
    }

    probe("order", name, probeResult[0] ? probeResult : "none");
}

static void makeA(void)
{
    windowA = CreateWindow("ProbeQuitIn", "A", WS_POPUP | WS_BORDER, 100, 100, 200, 150, NULL,
                           NULL, module, NULL);
    ShowWindow(windowA, SW_SHOWNORMAL);
    UpdateWindow(windowA);
}

static void gone(LPCSTR name, int x, int y, BOOL get)
{
    makeA();
    SetCursorPos(x, y);
    drain();

    DestroyWindow(windowA);
    PostQuitMessage(3);
    order(name, get);
    windowA = NULL;
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;

    probeOpen(OUTPUT);
    module = instance;

    kind.style = 0;
    kind.lpfnWndProc = ProbeProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = LoadCursor(NULL, IDC_ARROW);
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "ProbeQuitIn";
    RegisterClass(&kind);

    windowB = CreateWindow("ProbeQuitIn", "B", WS_POPUP | WS_BORDER, 0, 0, 400, 300, NULL, NULL,
                           instance, NULL);
    ShowWindow(windowB, SW_SHOWNORMAL);
    UpdateWindow(windowB);
    drain();

    gone("gone", 500, 400, FALSE);
    drain();
    gone("goneunder", 200, 150, FALSE);
    drain();
    gone("goneget", 500, 400, TRUE);
    drain();

    mouseEvent = GetProcAddress(GetModuleHandle("USER"), "MOUSE_EVENT");
    probe("entry", "MOUSE_EVENT", mouseEvent ? "found" : "missing");

    if (mouseEvent) {
        SetCursorPos(50, 50);
        drain();
        mouse(SF_ABSOLUTE | MOVE, across(150), down(120));
        PostQuitMessage(4);
        order("driver", FALSE);
        drain();

        PostQuitMessage(5);
        mouse(SF_ABSOLUTE | MOVE, across(160), down(130));
        order("driverafter", FALSE);
        drain();

        PostMessage(windowB, WM_USER, 0, 0L);
        mouse(SF_ABSOLUTE | MOVE, across(170), down(140));
        PostQuitMessage(6);
        order("posted", FALSE);
        drain();
    }

    DestroyWindow(windowB);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
