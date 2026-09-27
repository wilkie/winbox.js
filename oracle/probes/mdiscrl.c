/*
 * An MDI client's scroll bars: `CalcChildScroll` and `ScrollChildren`.
 *
 * A frame 400 by 300 with an MDI client that asks for both scroll bars, and
 * one document window in it, moved to places inside and past each edge of
 * the client, then scrolled by the client's own `WM_HSCROLL` and `WM_VSCROLL`
 * and by `ScrollChildren` called directly, then minimized and maximized. After each step:
 *
 * * `state`: the client's scroll bar bits, its client size, each bar's
 *   range and position, and the document window's place in the client,
 *   first as the step left it (`name,auto`) and then after
 *   `CalcChildScroll(client, SB_BOTH)` (`name,calc`).
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\MDISCRL.OUT"

/* Not in the import library: fetched from USER by ordinal. */
typedef void(FAR PASCAL *CALCPROC)(HWND, WORD);
typedef void(FAR PASCAL *SCROLLPROC)(HWND, UINT, WPARAM, LPARAM);

static CALCPROC calcChildScroll;
static SCROLLPROC scrollChildren;

static HWND frame;
static HWND client;
static HWND child;

LONG FAR PASCAL _export FrameProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_DESTROY) {
        PostQuitMessage(0);
        return 0;
    }

    return DefFrameProc(hwnd, client, message, wParam, lParam);
}

LONG FAR PASCAL _export ChildProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    return DefMDIChildProc(hwnd, message, wParam, lParam);
}

static void pump(void)
{
    MSG message;

    while (PeekMessage(&message, NULL, 0, 0, PM_REMOVE)) {
        TranslateMessage(&message);
        DispatchMessage(&message);
    }
}

static void state(LPCSTR name, LPCSTR when)
{
    RECT inside;
    RECT place;
    POINT corner;
    int hmin;
    int hmax;
    int vmin;
    int vmax;
    LONG style = GetWindowLong(client, GWL_STYLE);

    GetClientRect(client, &inside);
    GetScrollRange(client, SB_HORZ, &hmin, &hmax);
    GetScrollRange(client, SB_VERT, &vmin, &vmax);
    GetWindowRect(child, &place);
    corner.x = place.left;
    corner.y = place.top;
    ScreenToClient(client, &corner);
    wsprintf(probeResult, "h=%d,v=%d,client=%d:%d,hr=%d:%d@%d,vr=%d:%d@%d,child=%d:%d:%d:%d",
             (style & WS_HSCROLL) ? 1 : 0, (style & WS_VSCROLL) ? 1 : 0, inside.right,
             inside.bottom, hmin, hmax, GetScrollPos(client, SB_HORZ), vmin, vmax,
             GetScrollPos(client, SB_VERT), corner.x, corner.y, place.right - place.left,
             place.bottom - place.top);
    wsprintf(probeArgs, "%s,%s", name, when);
    probe("state", probeArgs, probeResult);
}

static void step(LPCSTR name)
{
    pump();
    state(name, "auto");
    calcChildScroll(client, SB_BOTH);
    pump();
    state(name, "calc");
}

static void place(LPCSTR name, int x, int y)
{
    MoveWindow(child, x, y, 120, 90, TRUE);
    step(name);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS windowClass;
    CLIENTCREATESTRUCT ccs;
    MDICREATESTRUCT mcs;
    RECT inside;

    probeOpen(OUTPUT);
    calcChildScroll = (CALCPROC)GetProcAddress(GetModuleHandle("USER"), MAKEINTRESOURCE(462));
    scrollChildren = (SCROLLPROC)GetProcAddress(GetModuleHandle("USER"), MAKEINTRESOURCE(463));
    ShowCursor(FALSE);
    SetCursorPos(GetSystemMetrics(SM_CXSCREEN) - 1, GetSystemMetrics(SM_CYSCREEN) - 1);

    windowClass.style = 0;
    windowClass.lpfnWndProc = FrameProc;
    windowClass.cbClsExtra = 0;
    windowClass.cbWndExtra = 0;
    windowClass.hInstance = instance;
    windowClass.hIcon = NULL;
    windowClass.hCursor = NULL;
    windowClass.hbrBackground = (HBRUSH)(COLOR_APPWORKSPACE + 1);
    windowClass.lpszMenuName = NULL;
    windowClass.lpszClassName = "ScrlFrame";
    RegisterClass(&windowClass);

    windowClass.lpfnWndProc = ChildProc;
    windowClass.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    windowClass.lpszClassName = "ScrlChild";
    RegisterClass(&windowClass);

    frame = CreateWindow("ScrlFrame", "Frame", WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN | WS_VISIBLE,
                         20, 20, 400, 300, NULL, NULL, instance, NULL);
    ccs.hWindowMenu = NULL;
    ccs.idFirstChild = 100;
    GetClientRect(frame, &inside);
    client = CreateWindow("MDICLIENT", NULL,
                          WS_CHILD | WS_CLIPCHILDREN | WS_VISIBLE | WS_HSCROLL | WS_VSCROLL, 0, 0,
                          inside.right, inside.bottom, frame, (HMENU)1, instance,
                          (LPSTR)&ccs);

    mcs.szClass = "ScrlChild";
    mcs.szTitle = "Doc";
    mcs.hOwner = instance;
    mcs.x = 10;
    mcs.y = 10;
    mcs.cx = 120;
    mcs.cy = 90;
    mcs.style = 0;
    mcs.lParam = 0;
    child = (HWND)LOWORD(SendMessage(client, WM_MDICREATE, 0, (LPARAM)(LPSTR)&mcs));
    UpdateWindow(frame);

    step("made");
    place("inside", 20, 20);
    place("right", 330, 20);
    place("left", -40, 20);
    place("below", 20, 220);
    place("above", 20, -50);
    place("corner", 330, 220);

    /* Scrolled. */
    /* Scrolled as its scroll bars scroll it: the client's own messages. */
    SendMessage(client, WM_HSCROLL, SB_LINEDOWN, 0L);
    step("line-right");
    SendMessage(client, WM_HSCROLL, SB_PAGEDOWN, 0L);
    step("page-right");
    SendMessage(client, WM_VSCROLL, SB_THUMBPOSITION, MAKELONG(60, 0));
    step("thumb-down");
    SendMessage(client, WM_VSCROLL, SB_BOTTOM, 0L);
    step("bottom");
    SendMessage(client, WM_VSCROLL, SB_TOP, 0L);
    step("top");
    SendMessage(client, WM_HSCROLL, SB_LINEUP, 0L);
    step("line-left");
    SendMessage(client, WM_HSCROLL, SB_ENDSCROLL, 0L);
    step("end-scroll");

    /* And ScrollChildren called directly. */
    scrollChildren(client, WM_HSCROLL, SB_LINEDOWN, 0L);
    step("direct-right");

    /* Minimized, and maximized. */
    place("again", 330, 220);
    ShowWindow(child, SW_MINIMIZE);
    step("minimized");
    ShowWindow(child, SW_RESTORE);
    step("restored");
    SendMessage(client, WM_MDIMAXIMIZE, (WPARAM)child, 0L);
    step("maximized");
    SendMessage(client, WM_MDIRESTORE, (WPARAM)child, 0L);
    step("restored-again");

    DestroyWindow(frame);
    pump();
    probeFinish();

    return 0;
}
