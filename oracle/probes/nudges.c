/*
 * The mouse moves USER makes of its own accord, made more than once before
 * the queue is looked at: whether they are queued one by one, as a message
 * posted is, or kept as one, as the mouse's own moves are; and where they
 * come among messages posted around them.
 *
 * `B`, a pop-up at (0, 0), 300 by 200, stays throughout. `C` and `D`,
 * pop-ups 100 by 80 at (400, 50) and (400, 200), are shown and hidden clear
 * of the cursor. Each case starts with the queue emptied:
 *
 * * `desktop2`: the cursor at (500, 400), over the desktop; C shown, then
 *   D shown.
 * * `desktop3`: the same, then C hidden as well.
 * * `between`: the cursor over the desktop; a message posted to B, C shown,
 *   another posted, D shown.
 * * `inB2`: the cursor at (150, 100), in B; C shown, then D shown.
 * * `inBbetween`: the cursor in B; a message posted, C shown, another
 *   posted, D shown.
 *
 * For each, `queue`: every message taken, in turn, as its number in hex
 * and the window it was for -- `B`, `C`, `D`, `desktop` or the handle --
 * with a mouse message's point and a posted message's wParam, until the
 * queue is empty; paints are validated and left out.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\NUDGES.OUT"

static HWND windowB;
static HWND windowC;
static HWND windowD;

LONG FAR PASCAL _export ProbeProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    return DefWindowProc(hwnd, message, wParam, lParam);
}

static LPCSTR whose(HWND hwnd)
{
    static char handle[8];

    if (hwnd == windowB) {
        return "B";
    }

    if (hwnd == windowC) {
        return "C";
    }

    if (hwnd == windowD) {
        return "D";
    }

    if (hwnd == GetDesktopWindow()) {
        return "desktop";
    }

    wsprintf(handle, "%04x", hwnd);
    return handle;
}

/* Everything waiting taken and dispatched. */
static void drain(void)
{
    MSG message;
    int count = 0;

    while (count < 40 && PeekMessage(&message, NULL, 0, 0, PM_REMOVE)) {
        DispatchMessage(&message);
        count++;
    }
}

static void queue(LPCSTR name)
{
    MSG message;
    char one[48];
    int count = 0;

    probeResult[0] = '\0';

    while (count < 16 && PeekMessage(&message, NULL, 0, 0, PM_REMOVE)) {
        count++;

        if (message.message == WM_PAINT) {
            ValidateRect(message.hwnd, NULL);
            continue;
        }

        if (message.message >= WM_MOUSEFIRST && message.message <= WM_MOUSELAST) {
            wsprintf(one, "%x:%s(%d,%d),", message.message, whose(message.hwnd),
                     LOWORD(message.lParam), HIWORD(message.lParam));
        } else if (message.message >= WM_USER) {
            wsprintf(one, "%x:%s:%d,", message.message, whose(message.hwnd), message.wParam);
        } else {
            wsprintf(one, "%x:%s,", message.message, whose(message.hwnd));
        }

        lstrcat(probeResult, one);
        DispatchMessage(&message);
    }

    probe("queue", name, probeResult[0] ? probeResult : "none");
}

static void hideBoth(void)
{
    ShowWindow(windowC, SW_HIDE);
    ShowWindow(windowD, SW_HIDE);
    drain();
}

static void start(int x, int y)
{
    hideBoth();
    SetCursorPos(x, y);
    drain();
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;

    probeOpen(OUTPUT);

    kind.style = 0;
    kind.lpfnWndProc = ProbeProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = LoadCursor(NULL, IDC_ARROW);
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "ProbeNudges";
    RegisterClass(&kind);

    windowB = CreateWindow("ProbeNudges", "B", WS_POPUP | WS_BORDER, 0, 0, 300, 200, NULL, NULL,
                           instance, NULL);
    windowC = CreateWindow("ProbeNudges", "C", WS_POPUP | WS_BORDER, 400, 50, 100, 80, NULL,
                           NULL, instance, NULL);
    windowD = CreateWindow("ProbeNudges", "D", WS_POPUP | WS_BORDER, 400, 200, 100, 80, NULL,
                           NULL, instance, NULL);
    ShowWindow(windowB, SW_SHOWNORMAL);
    UpdateWindow(windowB);
    drain();

    start(500, 400);
    ShowWindow(windowC, SW_SHOWNOACTIVATE);
    ShowWindow(windowD, SW_SHOWNOACTIVATE);
    queue("desktop2");

    start(500, 400);
    ShowWindow(windowC, SW_SHOWNOACTIVATE);
    ShowWindow(windowD, SW_SHOWNOACTIVATE);
    ShowWindow(windowC, SW_HIDE);
    queue("desktop3");

    start(500, 400);
    PostMessage(windowB, WM_USER, 1, 0L);
    ShowWindow(windowC, SW_SHOWNOACTIVATE);
    PostMessage(windowB, WM_USER, 2, 0L);
    ShowWindow(windowD, SW_SHOWNOACTIVATE);
    queue("between");

    start(150, 100);
    ShowWindow(windowC, SW_SHOWNOACTIVATE);
    ShowWindow(windowD, SW_SHOWNOACTIVATE);
    queue("inB2");

    start(150, 100);
    PostMessage(windowB, WM_USER, 1, 0L);
    ShowWindow(windowC, SW_SHOWNOACTIVATE);
    PostMessage(windowB, WM_USER, 2, 0L);
    ShowWindow(windowD, SW_SHOWNOACTIVATE);
    queue("inBbetween");

    DestroyWindow(windowD);
    DestroyWindow(windowC);
    DestroyWindow(windowB);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
