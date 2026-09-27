/*
 * GetMessage and PeekMessage with a window and a range of messages: which
 * posted messages each takes, in what order, and whether a window's filter
 * takes its children's too. Messages are posted to a window A, its child C,
 * and another window B; each step takes what it can and records it. A
 * GetMessage is only asked when a message it can take is waiting.
 *
 * * `take`: what a call took, as `message@window` (the message as
 *   `u+n` for `WM_USER + n`, the window as `A`, `B`, `C` or `0`), or `none`.
 * * `left`: what is left in the queue after the steps, taken with no filter.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\GETMSG.OUT"

static HWND a;
static HWND b;
static HWND c;

static LPCSTR nameOf(HWND window)
{
    return window == a ? "A" : window == b ? "B" : window == c ? "C" : window ? "?" : "0";
}

static void record(LPCSTR step, BOOL got, MSG *msg)
{
    if (!got) {
        probe("take", step, "none");
        return;
    }

    if (msg->message >= WM_USER) {
        wsprintf(probeResult, "u+%u@%s", msg->message - WM_USER, nameOf(msg->hwnd));
    } else {
        wsprintf(probeResult, "%x@%s", msg->message, nameOf(msg->hwnd));
    }

    probe("take", step, probeResult);
}

static void post(void)
{
    PostMessage(b, WM_USER + 1, 0, 0L);
    PostMessage(c, WM_USER + 2, 0, 0L);
    PostMessage(a, WM_USER + 3, 0, 0L);
    PostMessage(b, WM_USER + 10, 0, 0L);
    PostMessage(a, WM_USER + 11, 0, 0L);
}

static void drain(LPCSTR step)
{
    MSG msg;
    char list[400];
    char one[24];

    list[0] = '\0';

    while (PeekMessage(&msg, NULL, WM_USER, WM_USER + 100, PM_REMOVE)) {
        wsprintf(one, "%su+%u@%s", (LPSTR)(list[0] ? "," : ""), msg.message - WM_USER,
                 nameOf(msg.hwnd));
        lstrcat(list, one);
    }

    probe("left", step, list[0] ? list : "none");
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    MSG msg;

    probeOpen(OUTPUT);

    kind.style = 0;
    kind.lpfnWndProc = DefWindowProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = NULL;
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "GetMsg";
    RegisterClass(&kind);

    /* Hidden, so that no paint comes between the posted messages. */
    a = CreateWindow("GetMsg", "A", WS_OVERLAPPEDWINDOW, 0, 0, 100, 60, NULL, NULL, instance, NULL);
    b = CreateWindow("GetMsg", "B", WS_OVERLAPPEDWINDOW, 0, 0, 100, 60, NULL, NULL, instance, NULL);
    c = CreateWindow("GetMsg", "C", WS_CHILD, 0, 0, 10, 10, a, NULL, instance, NULL);

    /* Whatever creating them left, gone. */
    while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
    }

    /* A window's own: GetMessage, then PeekMessage. */
    post();
    record("get-a", GetMessage(&msg, a, 0, 0), &msg);
    record("get-a-again", GetMessage(&msg, a, 0, 0), &msg);
    record("peek-a", PeekMessage(&msg, a, 0, 0, PM_REMOVE), &msg);
    record("peek-c", PeekMessage(&msg, c, 0, 0, PM_REMOVE), &msg);
    drain("window");

    /* A range. */
    post();
    record("get-range", GetMessage(&msg, NULL, WM_USER + 5, WM_USER + 20), &msg);
    record("peek-range", PeekMessage(&msg, NULL, WM_USER + 5, WM_USER + 20, PM_REMOVE), &msg);
    record("peek-range-none", PeekMessage(&msg, NULL, WM_USER + 50, WM_USER + 60, PM_REMOVE), &msg);
    record("peek-window-range", PeekMessage(&msg, a, WM_USER + 1, WM_USER + 5, PM_REMOVE), &msg);
    drain("range");

    /* A range from high to low: the first message waiting is inside it. */
    post();
    record("peek-backwards", PeekMessage(&msg, NULL, WM_USER + 3, WM_USER + 1, PM_REMOVE), &msg);
    record("peek-backwards-again", PeekMessage(&msg, NULL, WM_USER + 3, WM_USER + 1, PM_REMOVE), &msg);
    drain("backwards");

    /* The quit, with filters it does not match, left in place each time. */
    PostQuitMessage(3);
    record("quit-range", PeekMessage(&msg, NULL, WM_USER, WM_USER + 5, PM_NOREMOVE), &msg);
    record("quit-window", PeekMessage(&msg, a, 0, 0, PM_NOREMOVE), &msg);
    record("quit-any", PeekMessage(&msg, NULL, 0, 0, PM_REMOVE), &msg);
    record("quit-after", PeekMessage(&msg, NULL, 0, 0, PM_REMOVE), &msg);

    DestroyWindow(c);
    DestroyWindow(b);
    DestroyWindow(a);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
