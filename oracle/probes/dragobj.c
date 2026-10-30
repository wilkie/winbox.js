/*
 * USER's ordinal 464, DragObject, called by ordinal: File Manager's drag of
 * an object (`USER.EXE` seg14 `0fbe`, its loop `00f2`, its hit test
 * `0000`). The cursor is put over a child, the mouse messages it makes taken
 * away, and a move and a release of the left button posted before each
 * drag, so the loop ends.
 *
 * * `msg`: every drag message a window gets -- `WM_QUERYDROPOBJECT`,
 *   `WM_DRAGLOOP`, `WM_DRAGSELECT`, `WM_DRAGMOVE`, `WM_DROPOBJECT` -- with
 *   its `wParam`, its `DRAGINFO`'s fields (source, scope, format, data,
 *   point) and where the `DRAGINFO` is, from the first one's.
 * * `answer`: what DragObject answered; the capture after.
 *
 * The children: `accept` answers `WM_QUERYDROPOBJECT` with 1 and
 * `WM_DROPOBJECT` with 5678h; `refuse` answers nought; `cursor` answers a
 * cursor's handle. The parent answers nought.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\DRAGOBJ.OUT"

#define WM_DROPOBJECT 0x022A
#define WM_QUERYDROPOBJECT 0x022B
#define WM_BEGINDRAG 0x022C
#define WM_DRAGLOOP 0x022D
#define WM_DRAGSELECT 0x022E
#define WM_DRAGMOVE 0x022F

typedef struct {
    HWND hwndSource;
    HWND hwndSink;
    WORD wFlags;
    DWORD dwData;
    POINT pt;
    DWORD dwControlData;
} DRAGINFO;

typedef DWORD(FAR PASCAL *DRAGOBJECT)(HWND, HWND, WORD, DWORD, HCURSOR);

static HWND main;
static HWND accept;
static HWND refuse;
static HWND cursor;
static HCURSOR cross;
static WORD first;

static LPCSTR named(HWND window)
{
    return !window             ? "none"
           : window == main    ? "main"
           : window == accept  ? "accept"
           : window == refuse  ? "refuse"
           : window == cursor  ? "cursor"
                               : "other";
}

static LPCSTR messageName(UINT message)
{
    switch (message) {
    case WM_DROPOBJECT: return "drop";
    case WM_QUERYDROPOBJECT: return "query";
    case WM_DRAGLOOP: return "loop";
    case WM_DRAGSELECT: return "select";
    case WM_DRAGMOVE: return "move";
    }

    return NULL;
}

static void note(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    DRAGINFO FAR *info = (DRAGINFO FAR *)lParam;

    if (!first) {
        first = LOWORD(lParam);
    }

    wsprintf(probeArgs, "%s %s", named(window), messageName(message));
    wsprintf(probeResult, "w=%s src=%s scope=%s fmt=%04x data=%08lx pt=%d,%d at=+%d",
             (LPSTR)(message == WM_DROPOBJECT ? named((HWND)wParam) : wParam ? "1" : "0"),
             named(info->hwndSource), named(info->hwndSink), info->wFlags, info->dwData,
             info->pt.x, info->pt.y, (int)(LOWORD(lParam) - first));
    probe("msg", probeArgs, probeResult);
}

LRESULT CALLBACK __export WindowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (messageName(message)) {
        note(window, message, wParam, lParam);

        if (message == WM_QUERYDROPOBJECT) {
            return window == accept ? 1L : window == cursor ? (LRESULT)(WORD)cross : 0L;
        }

        if (message == WM_DROPOBJECT) {
            return window == main ? 0L : 0x5678L;
        }

        return 0L;
    }

    return DefWindowProc(window, message, wParam, lParam);
}

static void drag(DRAGOBJECT dragObject, HWND over, HCURSOR shape, LPCSTR what)
{
    RECT box;
    POINT at;
    MSG msg;
    DWORD answer;

    GetWindowRect(over, &box);
    at.x = (box.left + box.right) / 2;
    at.y = (box.top + box.bottom) / 2;
    SetCursorPos(at.x, at.y);

    while (PeekMessage(&msg, NULL, WM_MOUSEFIRST, WM_MOUSELAST, PM_REMOVE)) {
    }

    probeNote(what);
    first = 0;
    PostMessage(main, WM_MOUSEMOVE, 0, 0L);
    PostMessage(main, WM_LBUTTONUP, 0, 0L);
    answer = dragObject(main, main, 0x1234, 0xabcd5678L, shape);
    wsprintf(probeResult, "%08lx", answer);
    probe("answer", what, probeResult);
    probe("answer", "capture after", named(GetCapture()));
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS wc;
    DRAGOBJECT dragObject;
    HCURSOR arrow;
    MSG msg;

    probeOpen(OUTPUT);

    dragObject = (DRAGOBJECT)GetProcAddress(GetModuleHandle("USER"), MAKEINTRESOURCE(464));
    arrow = LoadCursor(NULL, IDC_ARROW);
    cross = LoadCursor(NULL, IDC_CROSS);

    wc.style = 0;
    wc.lpfnWndProc = WindowProc;
    wc.cbClsExtra = 0;
    wc.cbWndExtra = 0;
    wc.hInstance = instance;
    wc.hIcon = NULL;
    wc.hCursor = arrow;
    wc.hbrBackground = GetStockObject(WHITE_BRUSH);
    wc.lpszMenuName = NULL;
    wc.lpszClassName = "DragProbe";
    RegisterClass(&wc);

    main = CreateWindow("DragProbe", "Drag", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 20, 20, 400, 300,
                        NULL, NULL, instance, NULL);
    accept = CreateWindow("DragProbe", "", WS_CHILD | WS_VISIBLE | WS_BORDER, 10, 10, 80, 60,
                          main, (HMENU)1, instance, NULL);
    refuse = CreateWindow("DragProbe", "", WS_CHILD | WS_VISIBLE | WS_BORDER, 110, 10, 80, 60,
                          main, (HMENU)2, instance, NULL);
    cursor = CreateWindow("DragProbe", "", WS_CHILD | WS_VISIBLE | WS_BORDER, 210, 10, 80, 60,
                          main, (HMENU)3, instance, NULL);
    UpdateWindow(main);

    while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
        DispatchMessage(&msg);
    }

    drag(dragObject, accept, arrow, "over accept");
    drag(dragObject, refuse, NULL, "over refuse, no cursor");
    drag(dragObject, cursor, arrow, "over cursor");

    DestroyWindow(main);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
