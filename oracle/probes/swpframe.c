/*
 * A window's frame changed where it is, as Clock changes its own when its
 * title is taken away: the style changed with `SetWindowLong`, and
 * `SetWindowPos` asked to draw the frame again with `SWP_DRAWFRAME`
 * (`SWP_FRAMECHANGED`), neither moving nor sizing it.
 *
 * `W` is an overlapped window at (40, 40), 160 by 100, of a class with a
 * white background and a window procedure that paints nothing, with a menu
 * bar of one item. Each step writes what `W` was sent, in order, as the
 * message's number in hex, with: `WM_WINDOWPOSCHANGING` and
 * `WM_WINDOWPOSCHANGED` the flags; `WM_NCCALCSIZE` its `wParam`, the first
 * rectangle as it came and as `DefWindowProc` left it, and with a `wParam`
 * the other two, and the answer; `WM_MOVE` and `WM_SIZE` the `lParam`;
 * `WM_NCPAINT` 1, or its region's box; `WM_ERASEBKGND` the device
 * context's clip box; `WM_PAINT` the rectangle to paint and whether to
 * erase. Then `W`'s rectangles on the screen, and every pixel of it, a row
 * a record, one hex digit a pixel as `chrome` writes them.
 *
 * * `notitle`: as Clock does (`CLOCK.EXE` seg1 `1a8e`): the style's
 *   `WS_DLGFRAME`, `WS_SYSMENU`, `WS_MINIMIZEBOX` and `WS_MAXIMIZEBOX`
 *   taken out, the menu taken away with `SetWindowWord(GWW_ID, 0)`, then
 *   `SetWindowPos(W, 0, 0, 0, 0, 0, 27h)` and `ShowWindow(W, SW_SHOW)`.
 * * `title`: the same put back, and the menu with them.
 * * `again`: `SWP_FRAMECHANGED` with nothing changed.
 * * `stale`: the caption taken out with `SetWindowLong` alone, then
 *   `SetWindowPos` with neither `SWP_FRAMECHANGED` nor a size.
 * * `sized`: then sized to 170 by 110, without `SWP_FRAMECHANGED`. Its
 *   pixels are not written: the frame drawn for a style with a border and
 *   no caption, and a menu bar, leaves much of what was there.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\SWPFRAME.OUT"

static HINSTANCE module;
static HWND w;
static BOOL logging;
static char events[3000];

static const char HEX[] = "0123456789abcdef";

static const COLORREF PALETTE[16] = {
    RGB(0, 0, 0),       RGB(128, 0, 0),     RGB(0, 128, 0),   RGB(128, 128, 0),
    RGB(0, 0, 128),     RGB(128, 0, 128),   RGB(0, 128, 128), RGB(192, 192, 192),
    RGB(128, 128, 128), RGB(255, 0, 0),     RGB(0, 255, 0),   RGB(255, 255, 0),
    RGB(0, 0, 255),     RGB(255, 0, 255),   RGB(0, 255, 255), RGB(255, 255, 255),
};

static void add(LPCSTR text)
{
    if (logging && lstrlen(events) + lstrlen(text) + 2 < sizeof(events)) {
        lstrcat(events, text);
        lstrcat(events, ",");
    }
}

static void rect(LPSTR out, const RECT FAR *r)
{
    wsprintf(out, "%d:%d:%d:%d", r->left, r->top, r->right, r->bottom);
}

LONG FAR PASCAL _export Proc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    char one[160];
    char a[32];
    char b[32];
    char c[32];
    char d[32];
    LONG answer;

    if (message == WM_NCCALCSIZE) {
        NCCALCSIZE_PARAMS FAR *params = (NCCALCSIZE_PARAMS FAR *)lParam;

        rect(a, &params->rgrc[0]);

        if (wParam) {
            rect(b, &params->rgrc[1]);
            rect(c, &params->rgrc[2]);
        }

        answer = DefWindowProc(hwnd, message, wParam, lParam);
        rect(d, &params->rgrc[0]);

        if (wParam) {
            wsprintf(one, "83:1:%s>%s/%s/%s=%lx", (LPSTR)a, (LPSTR)d, (LPSTR)b, (LPSTR)c, answer);
        } else {
            wsprintf(one, "83:0:%s>%s=%lx", (LPSTR)a, (LPSTR)d, answer);
        }

        add(one);
        return answer;
    }

    if (message == WM_WINDOWPOSCHANGING || message == WM_WINDOWPOSCHANGED) {
        wsprintf(one, "%x:%x", message, ((WINDOWPOS FAR *)lParam)->flags);
        add(one);
    } else if (message == WM_MOVE || message == WM_SIZE) {
        wsprintf(one, "%x:%lx", message, lParam);
        add(one);
    } else if (message == WM_NCPAINT) {
        if (wParam == 1) {
            wsprintf(one, "85:1");
        } else {
            RECT box;

            GetRgnBox((HRGN)wParam, &box);
            rect(a, &box);
            wsprintf(one, "85:%s", (LPSTR)a);
        }

        add(one);
    } else if (message == WM_ERASEBKGND) {
        RECT box;

        GetClipBox((HDC)wParam, &box);
        rect(a, &box);
        wsprintf(one, "14:%s", (LPSTR)a);
        add(one);
    } else if (message == WM_PAINT) {
        PAINTSTRUCT paint;

        BeginPaint(hwnd, &paint);
        rect(a, &paint.rcPaint);
        wsprintf(one, "f:%s:%d", (LPSTR)a, paint.fErase);
        add(one);
        EndPaint(hwnd, &paint);
        return 0;
    } else {
        wsprintf(one, "%x", message);
        add(one);
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

static void begin(void)
{
    events[0] = '\0';
    logging = TRUE;
}

/* What `W` was sent, its rectangles, and with `pixels` every pixel of it. */
static void finish(LPCSTR name, BOOL pixels)
{
    RECT window;
    RECT client;
    POINT corner;
    HDC screen;
    int x;
    int y;

    pump();
    logging = FALSE;
    probe("sent", name, events);

    GetWindowRect(w, &window);
    GetClientRect(w, &client);
    corner.x = 0;
    corner.y = 0;
    ClientToScreen(w, &corner);
    wsprintf(probeResult, "window=%d:%d:%d:%d,client=%d:%d:%d:%d,style=%lx", window.left,
             window.top, window.right, window.bottom, corner.x, corner.y,
             corner.x + client.right, corner.y + client.bottom, GetWindowLong(w, GWL_STYLE));
    probe("rects", name, probeResult);

    if (!pixels) {
        return;
    }

    screen = GetDC(NULL);

    for (y = window.top; y < window.bottom; y++) {
        LPSTR at = probeResult;

        for (x = window.left; x < window.right; x++) {
            *at++ = digit(GetPixel(screen, x, y));
        }

        *at = '\0';
        wsprintf(probeArgs, "%s,y=%d", (LPSTR)name, y - window.top);
        probe("pixels", probeArgs, probeResult);
    }

    ReleaseDC(NULL, screen);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HMENU menu;
    LONG style;

    probeOpen(OUTPUT);
    module = instance;

    kind.style = 0;
    kind.lpfnWndProc = Proc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = LoadCursor(NULL, IDC_ARROW);
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "SwpFrame";
    RegisterClass(&kind);

    /* The pointer out of the way. */
    ShowCursor(FALSE);
    SetCursorPos(639, 479);

    menu = CreateMenu();
    AppendMenu(menu, MF_STRING, 100, "&File");

    w = CreateWindow("SwpFrame", "W", WS_OVERLAPPEDWINDOW, 40, 40, 160, 100, NULL, menu, module,
                     NULL);
    ShowWindow(w, SW_SHOWNORMAL);
    UpdateWindow(w);
    pump();
    finish("start", TRUE);

    /* As Clock takes its title away. */
    begin();
    style = GetWindowLong(w, GWL_STYLE);
    style &= ~(WS_DLGFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX);
    SetWindowWord(w, GWW_ID, 0);
    SetWindowLong(w, GWL_STYLE, style);
    add("|");
    SetWindowPos(w, NULL, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOZORDER | SWP_DRAWFRAME);
    add("|");
    ShowWindow(w, SW_SHOW);
    add("|");
    finish("notitle", TRUE);

    /* And puts it back. */
    begin();
    style = GetWindowLong(w, GWL_STYLE);
    style |= WS_DLGFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX;
    SetWindowWord(w, GWW_ID, (WORD)menu);
    SetWindowLong(w, GWL_STYLE, style);
    add("|");
    SetWindowPos(w, NULL, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOZORDER | SWP_DRAWFRAME);
    add("|");
    ShowWindow(w, SW_SHOW);
    add("|");
    finish("title", TRUE);

    /* Nothing changed. */
    begin();
    SetWindowPos(w, NULL, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOZORDER | SWP_FRAMECHANGED);
    finish("again", FALSE);

    /* The style changed, and the frame not said to have. */
    begin();
    style = GetWindowLong(w, GWL_STYLE);
    SetWindowLong(w, GWL_STYLE, style & ~WS_DLGFRAME);
    add("|");
    SetWindowPos(w, NULL, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOZORDER);
    finish("stale", FALSE);

    begin();
    SetWindowPos(w, NULL, 0, 0, 170, 110, SWP_NOMOVE | SWP_NOZORDER);
    finish("sized", FALSE);

    DestroyWindow(w);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
