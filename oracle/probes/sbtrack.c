/*
 * A press on a scroll bar, followed: what a scroll bar control and a
 * window's own scroll bar send while a press on them is held, and how they
 * look pressed.
 *
 * A press is made the only way a probe can make one. It sets the cursor
 * where the press is, posts the release, and then sends the press. USER's
 * loop, which follows the press, takes the release from the queue. The
 * release's point is the cursor's when it was posted. A drag posts moves
 * first, each with the cursor set where it goes.
 *
 * The parent's window procedure runs inside that loop, so on the first
 * WM_VSCROLL of each press it captures the bar as it looks pressed.
 *
 * In an ordinary window, in the System font:
 *
 * * a vertical scroll bar control, 16 by 100, ranged 0 to 10 at 3, pressed on
 *   each arrow, above and below the thumb, and dragged by the thumb, then
 *   with its top arrow turned off, pressed there;
 * * the window's own vertical scroll bar, ranged 0 to 10 at 3, pressed on its
 *   bottom arrow, below its thumb, and dragged by its thumb.
 *
 * Records:
 *
 * * `notes`: every WM_VSCROLL and WM_SYSCOMMAND the window got during a step,
 *   `v:code:pos:high word` and `s:command`.
 * * `rows`: the bar's pixels, a row a record, pressed and after.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\SBTRACK.OUT"

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

static char notes[400];
static RECT area;
static char step[32];
static BOOL captured = FALSE;

/* The screen's pixels in `area`, a row a record. */
static void capture(LPCSTR name)
{
    HDC screen = GetDC(NULL);
    int x;
    int y;

    for (y = area.top; y < area.bottom; y++) {
        LPSTR out = probeResult;

        for (x = area.left; x < area.right; x++) {
            *out++ = digit(GetPixel(screen, x, y));
        }

        *out = '\0';
        wsprintf(probeArgs, "%s,y=%d", name, y - area.top);
        probe("rows", probeArgs, probeResult);
    }

    ReleaseDC(NULL, screen);
}

static void note(LPCSTR text)
{
    if (lstrlen(notes) + lstrlen(text) < 380) {
        if (notes[0]) {
            lstrcat(notes, ",");
        }

        lstrcat(notes, text);
    }
}

LONG FAR PASCAL _export HostProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    char text[40];

    if (message == WM_VSCROLL) {
        wsprintf(text, "v:%d:%d:%d", (int)wParam, (int)LOWORD(lParam), HIWORD(lParam) ? 1 : 0);
        note(text);

        /* The bar as it looks pressed, at the first message of a press. */
        if (!captured) {
            char name[40];

            captured = TRUE;
            wsprintf(name, "%s-held", (LPSTR)step);
            capture(name);
        }

        return 0;
    }

    if (message == WM_SYSCOMMAND) {
        wsprintf(text, "s:%x", (int)wParam);
        note(text);
    }

    if (message == WM_DESTROY) {
        PostQuitMessage(0);
        return 0;
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

/* Where a point of a window's client area is on the screen. */
static POINT onScreen(HWND hwnd, int x, int y)
{
    POINT point;

    point.x = x;
    point.y = y;
    ClientToScreen(hwnd, &point);

    return point;
}

static void begin(LPCSTR name)
{
    lstrcpy(step, name);
    notes[0] = '\0';
    captured = FALSE;
}

static void finish(LPCSTR name)
{
    char after[40];

    pump();
    probe("notes", name, notes);
    wsprintf(after, "%s-after", (LPSTR)name);
    capture(after);
}

/*
 * A press on the control at a point of its client area, released where
 * `toY` is: moves first, in `moves` steps, when that is elsewhere.
 */
static void pressControl(HWND control, LPCSTR name, int x, int y, int toY, int moves)
{
    POINT at = onScreen(control, x, y);
    int index;

    begin(name);

    for (index = 1; index <= moves; index++) {
        int stepY = y + (toY - y) * index / moves;
        POINT to = onScreen(control, x, stepY);

        SetCursorPos(to.x, to.y);
        PostMessage(control, WM_MOUSEMOVE, MK_LBUTTON, MAKELONG(x, stepY));
    }

    {
        POINT to = onScreen(control, x, toY);

        SetCursorPos(to.x, to.y);
        PostMessage(control, WM_LBUTTONUP, 0, MAKELONG(x, toY));
    }

    SetCursorPos(at.x, at.y);
    SendMessage(control, WM_LBUTTONDOWN, MK_LBUTTON, MAKELONG(x, y));
    finish(name);
}

/*
 * A press on the window's own bar at a point of the screen: posted, the
 * release comes to the window as its own, for the bar's loop has the mouse.
 */
static void pressOwn(HWND host, LPCSTR name, POINT at, int toY, int moves)
{
    int index;

    begin(name);

    for (index = 1; index <= moves; index++) {
        int stepY = at.y + (toY - at.y) * index / moves;
        POINT client;

        client.x = at.x;
        client.y = stepY;
        ScreenToClient(host, &client);
        SetCursorPos(at.x, stepY);
        PostMessage(host, WM_MOUSEMOVE, MK_LBUTTON, MAKELONG(client.x, client.y));
    }

    {
        POINT client;

        client.x = at.x;
        client.y = toY;
        ScreenToClient(host, &client);
        SetCursorPos(at.x, toY);
        PostMessage(host, WM_LBUTTONUP, 0, MAKELONG(client.x, client.y));
    }

    SetCursorPos(at.x, at.y);
    SendMessage(host, WM_NCLBUTTONDOWN, HTVSCROLL, MAKELONG(at.x, at.y));
    finish(name);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS windowClass;
    HWND host;
    HWND control;
    RECT window;
    RECT client;
    POINT corner;
    int barLeft;

    probeOpen(OUTPUT);
    ShowCursor(FALSE);

    windowClass.style = 0;
    windowClass.lpfnWndProc = HostProc;
    windowClass.cbClsExtra = 0;
    windowClass.cbWndExtra = 0;
    windowClass.hInstance = instance;
    windowClass.hIcon = NULL;
    windowClass.hCursor = NULL;
    windowClass.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    windowClass.lpszMenuName = NULL;
    windowClass.lpszClassName = "SbTrack";
    RegisterClass(&windowClass);

    host = CreateWindow("SbTrack", "Track", WS_OVERLAPPEDWINDOW | WS_VSCROLL | WS_VISIBLE, 20, 20,
                        300, 200, NULL, NULL, instance, NULL);
    control = CreateWindow("SCROLLBAR", "", WS_CHILD | WS_VISIBLE | SBS_VERT, 20, 8, 16, 100, host,
                           (HMENU)101, instance, NULL);

    SetScrollRange(control, SB_CTL, 0, 10, FALSE);
    SetScrollPos(control, SB_CTL, 3, TRUE);
    SetScrollRange(host, SB_VERT, 0, 10, FALSE);
    SetScrollPos(host, SB_VERT, 3, TRUE);
    UpdateWindow(host);
    pump();

    /* The control: its rectangle on the screen is what is captured. */
    GetWindowRect(control, &area);

    /* The arrows, the pages either side of the thumb (which is at 3 of 10:
     * from 31 to 48 on the VGA), and a drag of the thumb down 30 pixels. */
    pressControl(control, "c-up", 8, 5, 5, 0);
    pressControl(control, "c-down", 8, 94, 94, 0);
    pressControl(control, "c-pageup", 8, 22, 22, 0);
    pressControl(control, "c-pagedown", 8, 70, 70, 0);
    pressControl(control, "c-drag", 8, 38, 68, 3);
    pressControl(control, "c-away", 8, 38, 68, 0);

    EnableScrollBar(control, SB_CTL, ESB_DISABLE_LTUP);
    pump();
    pressControl(control, "c-off", 8, 5, 5, 0);
    EnableScrollBar(control, SB_CTL, ESB_ENABLE_BOTH);
    pump();

    /* The window's own bar: the strip at the right of its client area. */
    GetWindowRect(host, &window);
    GetClientRect(host, &client);
    corner.x = client.right;
    corner.y = client.bottom;
    ClientToScreen(host, &corner);
    barLeft = corner.x;
    area.left = barLeft;
    area.right = barLeft + GetSystemMetrics(SM_CXVSCROLL);
    area.top = corner.y - client.bottom - 1;
    area.bottom = corner.y + 1;

    {
        POINT at;

        at.x = barLeft + 8;
        at.y = area.bottom - 6;
        pressOwn(host, "w-down", at, at.y, 0);

        at.y = area.bottom - 40;
        pressOwn(host, "w-pagedown", at, at.y, 0);
    }

    DestroyWindow(host);
    probeFinish();

    return 0;
}
