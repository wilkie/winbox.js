/*
 * When two presses make a double click: how far apart in time, how far
 * apart on the screen, on which window and with which button -- the test
 * USER makes as a look takes a press from the system queue.
 *
 * `A` is an overlapped window of a class with `CS_DBLCLKS` at (40, 40),
 * 200 by 150; `B` one of a class without it at (300, 40), the same size.
 * Each window procedure writes every button message it is sent, client and
 * non-client, as the window, the message's number in hex and its `lParam`,
 * and answers the non-client ones itself, so no press on a caption starts
 * a loop of USER's.
 *
 * The presses are played back by a `WH_JOURNALPLAYBACK` hook, each with
 * the time the script gives it, so the times are exact: a press and its
 * release a millisecond apart, `P` the middle of `A`'s client area, `Q`
 * `B`'s, `C` the middle of `B`'s caption. Each case starts 5000 ms after
 * the one before, so none is a double click with another's.
 *
 * `run1`, with the double click's settings as Windows starts, 500 ms and
 * 4 by 4: `same` twice at `P` 100 ms apart; `x+1`, `x+2`, `x-2`, `x-3` the
 * second press so many pixels to the right or left; `y+1` to `y-3` below
 * or above; `t500` and `t501` 500 and 501 ms apart; `triple`, four presses
 * 50 ms apart; `button` the left button, the right, and the right again;
 * `other` `A`, `B` and `A` again, 50 ms apart; `noclass` twice at `Q`;
 * `caption` twice at `C`; `middle` the middle button twice at `P`.
 *
 * `run2`, with a width of 10 and a height of 6 (`SPI_SETDOUBLECLKWIDTH`,
 * `SPI_SETDOUBLECLKHEIGHT`): `x+4` to `x-6`, `y+2` to `y-4`. `run3`, with
 * a width of 1, then 0, then 5, then a height of 1: `same` for each, and
 * `x+2` and `x-2` for 5. `run4`, with `SetDoubleClickTime(200)`: `t200`
 * and `t201`.
 *
 * Before them, `event`: two presses put in through USER's `MOUSE_EVENT` as
 * the mouse driver puts them, at once, at `P`; and then at `P` and two
 * pixels to its right.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\DBLRECT.OUT"

static HINSTANCE module;
static HWND a;
static HWND b;
static FARPROC mouseEvent;
static HOOKPROC procPlay;
static HOOKPROC next;
static BOOL playing;
static char events[2000];

static WORD mouseFlags;
static WORD mouseX;
static WORD mouseY;

typedef struct {
    UINT message;
    UINT paramL;
    UINT paramH;
    DWORD time;
} STEP;

static STEP script[64];
static int steps;
static int at;
static DWORD base = 100000L;

static void add(LPCSTR text)
{
    if (lstrlen(events) + lstrlen(text) + 2 < sizeof(events)) {
        lstrcat(events, text);
        lstrcat(events, ",");
    }
}

DWORD FAR PASCAL _export Play(int code, WPARAM wParam, LPARAM lParam)
{
    if (code == HC_GETNEXT) {
        EVENTMSG FAR *event = (EVENTMSG FAR *)lParam;

        if (at < steps) {
            event->message = script[at].message;
            event->paramL = script[at].paramL;
            event->paramH = script[at].paramH;
            event->time = script[at].time;
        }

        return 0;
    }

    if (code == HC_SKIP) {
        at++;

        if (at >= steps) {
            UnhookWindowsHook(WH_JOURNALPLAYBACK, procPlay);
            playing = FALSE;
        }

        return 0;
    }

    return DefHookProc(code, wParam, lParam, &next);
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

LONG FAR PASCAL _export Proc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    char one[40];
    BOOL client = message >= WM_LBUTTONDOWN && message <= WM_MBUTTONDBLCLK;
    BOOL frame = message >= WM_NCLBUTTONDOWN && message <= WM_NCMBUTTONDBLCLK;

    if (client || frame) {
        wsprintf(one, "%s%x:%lx", (LPSTR)(hwnd == a ? "A" : "B"), message, lParam);
        add(one);
    }

    if (frame) {
        return 0;
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

static void step(UINT message, int x, int y, DWORD time)
{
    script[steps].message = message;
    script[steps].paramL = (UINT)x;
    script[steps].paramH = (UINT)y;
    script[steps].time = time;
    steps++;
}

/* A button pressed at a point at a time after the case's start, and let go
 * a millisecond later. */
static void press(int button, int x, int y, DWORD after)
{
    UINT down = button == 0 ? WM_LBUTTONDOWN : button == 1 ? WM_RBUTTONDOWN : WM_MBUTTONDOWN;

    step(down, x, y, base + after);
    step(down + 1, x, y, base + after + 1);
}

/* A case, named here and not in the log: its start, 5000 ms after the
 * last. */
static void begin(LPCSTR name)
{
    base += 5000L;
    (void)name;
}

static void play(LPCSTR name)
{
    MSG message;
    int count = 0;

    events[0] = '\0';
    at = 0;
    playing = TRUE;
    procPlay = (HOOKPROC)MakeProcInstance((FARPROC)Play, module);
    next = (HOOKPROC)SetWindowsHook(WH_JOURNALPLAYBACK, procPlay);

    while (playing && count < 600 && GetMessage(&message, NULL, 0, 0)) {
        TranslateMessage(&message);
        DispatchMessage(&message);
        count++;
    }

    pump();
    probe(name, "", events);
    steps = 0;
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    RECT rect;
    POINT corner;
    int px;
    int py;
    int qx;
    int qy;
    int cx;
    int cy;

    probeOpen(OUTPUT);
    module = instance;

    kind.style = CS_DBLCLKS;
    kind.lpfnWndProc = Proc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = LoadCursor(NULL, IDC_ARROW);
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "DblA";
    RegisterClass(&kind);

    kind.style = 0;
    kind.lpszClassName = "DblB";
    RegisterClass(&kind);

    mouseEvent = GetProcAddress(GetModuleHandle("USER"), "MOUSE_EVENT");

    a = CreateWindow("DblA", "A", WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU, 40, 40, 200, 150, NULL,
                     NULL, module, NULL);
    b = CreateWindow("DblB", "B", WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU, 300, 40, 200, 150, NULL,
                     NULL, module, NULL);
    ShowWindow(a, SW_SHOWNORMAL);
    ShowWindow(b, SW_SHOWNORMAL);
    UpdateWindow(a);
    UpdateWindow(b);
    pump();

    GetClientRect(a, &rect);
    corner.x = rect.right / 2;
    corner.y = rect.bottom / 2;
    ClientToScreen(a, &corner);
    px = corner.x;
    py = corner.y;

    GetClientRect(b, &rect);
    corner.x = rect.right / 2;
    corner.y = rect.bottom / 2;
    ClientToScreen(b, &corner);
    qx = corner.x;
    qy = corner.y;

    GetWindowRect(b, &rect);
    cx = (rect.left + rect.right) / 2;
    cy = rect.top + GetSystemMetrics(SM_CYCAPTION) / 2;

    wsprintf(probeResult, "P=%d,%d Q=%d,%d C=%d,%d", px, py, qx, qy, cx, cy);
    probe("points", "", probeResult);

    /* Through MOUSE_EVENT, as the driver puts them in. */
    if (mouseEvent) {
        events[0] = '\0';
        mouse(0x8001, across(px), down(py));
        mouse(0x0002, 0, 0);
        mouse(0x0004, 0, 0);
        mouse(0x0002, 0, 0);
        mouse(0x0004, 0, 0);
        pump();
        probe("event", "same", events);

        events[0] = '\0';
        mouse(0x8001, across(qx), down(qy));
        mouse(0x0002, 0, 0);
        mouse(0x0004, 0, 0);
        pump();
        events[0] = '\0';
        mouse(0x8001, across(px), down(py));
        mouse(0x0002, 0, 0);
        mouse(0x0004, 0, 0);
        mouse(0x8001, across(px + 2), down(py));
        mouse(0x0002, 0, 0);
        mouse(0x0004, 0, 0);
        pump();
        probe("event", "x+2", events);
    }

    /* As Windows starts: 500 ms, 4 by 4. */
    begin("same");
    press(0, px, py, 0);
    press(0, px, py, 100);
    begin("x+1");
    press(0, px, py, 0);
    press(0, px + 1, py, 100);
    begin("x+2");
    press(0, px, py, 0);
    press(0, px + 2, py, 100);
    begin("x-2");
    press(0, px, py, 0);
    press(0, px - 2, py, 100);
    begin("x-3");
    press(0, px, py, 0);
    press(0, px - 3, py, 100);
    play("run1a");

    begin("y+1");
    press(0, px, py, 0);
    press(0, px, py + 1, 100);
    begin("y+2");
    press(0, px, py, 0);
    press(0, px, py + 2, 100);
    begin("y-2");
    press(0, px, py, 0);
    press(0, px, py - 2, 100);
    begin("y-3");
    press(0, px, py, 0);
    press(0, px, py - 3, 100);
    play("run1b");

    begin("t500");
    press(0, px, py, 0);
    press(0, px, py, 500);
    begin("t501");
    press(0, px, py, 0);
    press(0, px, py, 501);
    begin("triple");
    press(0, px, py, 0);
    press(0, px, py, 50);
    press(0, px, py, 100);
    press(0, px, py, 150);
    play("run1c");

    begin("button");
    press(0, px, py, 0);
    press(1, px, py, 50);
    press(1, px, py, 100);
    begin("other");
    press(0, px, py, 0);
    press(0, qx, qy, 50);
    press(0, px, py, 100);
    begin("noclass");
    press(0, qx, qy, 0);
    press(0, qx, qy, 100);
    play("run1d");

    begin("caption");
    press(0, cx, cy, 0);
    press(0, cx, cy, 100);
    begin("middle");
    press(2, px, py, 0);
    press(2, px, py, 100);
    play("run1e");

    /* Wider and taller: 10 by 6. */
    SystemParametersInfo(SPI_SETDOUBLECLKWIDTH, 10, NULL, 0);
    SystemParametersInfo(SPI_SETDOUBLECLKHEIGHT, 6, NULL, 0);
    begin("x+4");
    press(0, px, py, 0);
    press(0, px + 4, py, 100);
    begin("x+5");
    press(0, px, py, 0);
    press(0, px + 5, py, 100);
    begin("x-5");
    press(0, px, py, 0);
    press(0, px - 5, py, 100);
    begin("x-6");
    press(0, px, py, 0);
    press(0, px - 6, py, 100);
    play("run2a");

    begin("y+2");
    press(0, px, py, 0);
    press(0, px, py + 2, 100);
    begin("y+3");
    press(0, px, py, 0);
    press(0, px, py + 3, 100);
    begin("y-3");
    press(0, px, py, 0);
    press(0, px, py - 3, 100);
    begin("y-4");
    press(0, px, py, 0);
    press(0, px, py - 4, 100);
    play("run2b");

    /* A width of 1, 0 and 5; a height of 1. */
    SystemParametersInfo(SPI_SETDOUBLECLKWIDTH, 1, NULL, 0);
    SystemParametersInfo(SPI_SETDOUBLECLKHEIGHT, 4, NULL, 0);
    begin("w1");
    press(0, px, py, 0);
    press(0, px, py, 100);
    play("run3a");

    SystemParametersInfo(SPI_SETDOUBLECLKWIDTH, 0, NULL, 0);
    begin("w0");
    press(0, px, py, 0);
    press(0, px, py, 100);
    play("run3b");

    SystemParametersInfo(SPI_SETDOUBLECLKWIDTH, 5, NULL, 0);
    begin("w5");
    press(0, px, py, 0);
    press(0, px, py, 100);
    begin("w5x+2");
    press(0, px, py, 0);
    press(0, px + 2, py, 100);
    begin("w5x-2");
    press(0, px, py, 0);
    press(0, px - 2, py, 100);
    play("run3c");

    SystemParametersInfo(SPI_SETDOUBLECLKWIDTH, 4, NULL, 0);
    SystemParametersInfo(SPI_SETDOUBLECLKHEIGHT, 1, NULL, 0);
    begin("h1");
    press(0, px, py, 0);
    press(0, px, py, 100);
    play("run3d");

    /* 200 ms. */
    SystemParametersInfo(SPI_SETDOUBLECLKHEIGHT, 4, NULL, 0);
    SetDoubleClickTime(200);
    begin("t200");
    press(0, px, py, 0);
    press(0, px, py, 200);
    begin("t201");
    press(0, px, py, 0);
    press(0, px, py, 201);
    play("run4");

    wsprintf(probeResult, "%u", GetDoubleClickTime());
    probe("time", "", probeResult);
    SetDoubleClickTime(0);

    DestroyWindow(a);
    DestroyWindow(b);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
