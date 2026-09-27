/*
 * Showing and hiding scroll bars: `ShowScrollBar`, and what `SetScrollRange`
 * does to a window's scroll bar.
 *
 * A child window with a border and both scroll bars, 80 by 60 -- as
 * Cardfile's card is made, which it then hides them from -- is taken through
 * each step below, and after each:
 *
 * * `answer`: nought: `ShowScrollBar` answers nothing, and `SetScrollRange`
 *   is not asked.
 * * `sent`: the messages the window was sent during the call, in order, as
 *   hexadecimal numbers, of those that say something about its frame:
 *   `WM_MOVE`, `WM_SIZE`, `WM_PAINT`, `WM_ERASEBKGND`, `WM_GETMINMAXINFO`,
 *   `WM_WINDOWPOSCHANGING`, `WM_WINDOWPOSCHANGED`, `WM_NCCALCSIZE`,
 *   `WM_NCPAINT`; then `after`, the same once its messages are pumped.
 * * `shape`: its style's scroll bar bits, its client rectangle, and its
 *   window rectangle relative to its parent's client area.
 * * `rows`: its pixels, a row a record.
 *
 * And a scroll bar control, hidden and shown with `SB_CTL`: `visible`.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\SHOWSB.OUT"

static const char HEX[] = "0123456789abcdef";

static const COLORREF PALETTE[16] = {
    RGB(0, 0, 0),       RGB(128, 0, 0),     RGB(0, 128, 0),   RGB(128, 128, 0),
    RGB(0, 0, 128),     RGB(128, 0, 128),   RGB(0, 128, 128), RGB(192, 192, 192),
    RGB(128, 128, 128), RGB(255, 0, 0),     RGB(0, 255, 0),   RGB(255, 255, 0),
    RGB(0, 0, 255),     RGB(255, 0, 255),   RGB(0, 255, 255), RGB(255, 255, 255),
};

static char digit(COLORREF colour)
{
    int index;

    for (index = 0; index < 16; index++) {
        if (PALETTE[index] == (colour & 0xffffffL)) {
            return HEX[index];
        }
    }

    return '?';
}

static HWND card;
static char log[256];
static int logging;

static void note(UINT message)
{
    char one[8];

    if (!logging || lstrlen(log) > 240) {
        return;
    }

    switch (message) {
    case WM_MOVE:
    case WM_SIZE:
    case WM_PAINT:
    case WM_ERASEBKGND:
    case WM_GETMINMAXINFO:
    case WM_WINDOWPOSCHANGING:
    case WM_WINDOWPOSCHANGED:
    case WM_NCCALCSIZE:
    case WM_NCPAINT:
        wsprintf(one, "%s%x", (LPSTR)(log[0] ? " " : ""), message);
        lstrcat(log, one);
        break;
    }
}

LONG FAR PASCAL _export HostProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_DESTROY && GetParent(hwnd) == NULL) {
        PostQuitMessage(0);
        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

LONG FAR PASCAL _export CardProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (hwnd == card) {
        note(message);
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

static void pump(void)
{
    MSG message;

    while (PeekMessage(&message, NULL, 0, 0, PM_REMOVE)) {
        TranslateMessage(&message);
        DispatchMessage(&message);
    }
}

static void capture(LPCSTR name)
{
    RECT window;
    HDC screen = GetDC(NULL);
    int x;
    int y;

    GetWindowRect(card, &window);

    for (y = window.top; y < window.bottom; y++) {
        LPSTR out = probeResult;

        for (x = window.left; x < window.right; x++) {
            *out++ = digit(GetPixel(screen, x, y));
        }

        *out = '\0';
        wsprintf(probeArgs, "%s,y=%d", name, y - window.top);
        probe("rows", probeArgs, probeResult);
    }

    ReleaseDC(NULL, screen);
}

static void shape(LPCSTR name)
{
    RECT client;
    RECT window;
    POINT corner;
    LONG style = GetWindowLong(card, GWL_STYLE);

    GetClientRect(card, &client);
    GetWindowRect(card, &window);
    corner.x = window.left;
    corner.y = window.top;
    ScreenToClient(GetParent(card), &corner);
    wsprintf(probeResult, "v=%d,h=%d,client=%d:%d,window=%d:%d:%d:%d",
             (style & WS_VSCROLL) ? 1 : 0, (style & WS_HSCROLL) ? 1 : 0, client.right,
             client.bottom, corner.x, corner.y, window.right - window.left,
             window.bottom - window.top);
    probe("shape", name, probeResult);
}

static void begin(void)
{
    log[0] = '\0';
    logging = 1;
}

static void end(LPCSTR name, LONG answer)
{
    wsprintf(probeResult, "%ld", answer);
    probe("answer", name, probeResult);
    probe("sent", name, log);
    log[0] = '\0';
    pump();
    probe("after", name, log);
    logging = 0;
    shape(name);
    capture(name);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS windowClass;
    HWND host;
    HWND bar;

    probeOpen(OUTPUT);
    ShowCursor(FALSE);
    SetCursorPos(GetSystemMetrics(SM_CXSCREEN) - 1, GetSystemMetrics(SM_CYSCREEN) - 1);

    windowClass.style = 0;
    windowClass.lpfnWndProc = HostProc;
    windowClass.cbClsExtra = 0;
    windowClass.cbWndExtra = 0;
    windowClass.hInstance = instance;
    windowClass.hIcon = NULL;
    windowClass.hCursor = NULL;
    windowClass.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    windowClass.lpszMenuName = NULL;
    windowClass.lpszClassName = "ShowHost";
    RegisterClass(&windowClass);

    windowClass.lpfnWndProc = CardProc;
    windowClass.lpszClassName = "ShowCard";
    RegisterClass(&windowClass);

    host = CreateWindow("ShowHost", "Show", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 20, 20, 300, 200,
                        NULL, NULL, instance, NULL);
    card = CreateWindow("ShowCard", "", WS_CHILD | WS_VISIBLE | WS_BORDER | WS_VSCROLL | WS_HSCROLL,
                        10, 10, 80, 60, host, (HMENU)100, instance, NULL);
    bar = CreateWindow("SCROLLBAR", "", WS_CHILD | WS_VISIBLE | SBS_VERT, 120, 10, 16, 60, host,
                       (HMENU)101, instance, NULL);

    UpdateWindow(host);
    pump();
    shape("made");
    capture("made");

    begin();
    ShowScrollBar(card, SB_BOTH, FALSE);
    end("hide-both", 0);
    begin();
    ShowScrollBar(card, SB_BOTH, FALSE);
    end("hide-both-again", 0);
    begin();
    ShowScrollBar(card, SB_VERT, TRUE);
    end("show-vert", 0);
    begin();
    ShowScrollBar(card, SB_HORZ, TRUE);
    end("show-horz", 0);
    begin();
    ShowScrollBar(card, SB_VERT, FALSE);
    end("hide-vert", 0);

    /* A range of nothing, and of something, on the vertical bar hidden. */
    begin();
    SetScrollRange(card, SB_VERT, 0, 10, TRUE);
    end("range-some", 0);
    begin();
    SetScrollRange(card, SB_VERT, 0, 0, TRUE);
    end("range-none", 0);
    begin();
    SetScrollRange(card, SB_VERT, 0, 5, FALSE);
    end("range-some-quiet", 0);

    /* A scroll bar control. */
    ShowScrollBar(bar, SB_CTL, FALSE);
    pump();
    wsprintf(probeResult, "%d", IsWindowVisible(bar));
    probe("visible", "ctl-hide", probeResult);
    ShowScrollBar(bar, SB_CTL, TRUE);
    pump();
    wsprintf(probeResult, "%d", IsWindowVisible(bar));
    probe("visible", "ctl-show", probeResult);

    DestroyWindow(host);
    pump();
    probeFinish();

    return 0;
}
