/*
 * A window's own answer to `WM_NCCALCSIZE`: the client area it makes, and
 * which of the old client area's bits it keeps, and where.
 *
 * `W` is made at (40, 40), 200 by 150, of a class with a white background
 * whose procedure answers `WM_NCCALCSIZE` as the case says:
 *
 * * `def`: `DefWindowProc`.
 * * `inset`: `DefWindowProc`, then the first rectangle made 10 smaller on
 *   the left, 20 at the top, 30 on the right and 5 at the bottom.
 * * `zero`: `DefWindowProc`, then the first rectangle made empty at its top
 *   left corner.
 * * `whole`: the first rectangle left as it came: no frame at all.
 *
 * each for `WS_OVERLAPPEDWINDOW`, and `whole` for `WS_POPUP | WS_CAPTION |
 * WS_SYSMENU` too, `whole-popup`. It is made, shown and painted, with `log`
 * (`-made`) what it was sent, as below; then:
 *
 * * `rects`: its window rectangle on the screen, `GetClientRect`'s right
 *   and bottom, and where `ClientToScreen` puts the client area's corner.
 * * `hit`: what `DefWindowProc` answers `WM_NCHITTEST` across the window's
 *   middle row, and down its middle column, from two pixels before the
 *   window to two after, as runs `code*count` in hexadecimal.
 * * `child`: the window rectangle of a child made at (0, 0), 20 by 10.
 *
 * Then `moved`: moved to (60, 50) with `SWP_NOSIZE`, `rects` again; and
 * `sized`: sized to 240 by 170, `rects` again, with `log`, what it was sent:
 * `WM_NCCALCSIZE`'s `wParam` and its three rectangles as they came,
 * `83:wParam:a/b/c`, and its first as the procedure left it, `>`, then its
 * answer `=`; `WM_ERASEBKGND`, `14:` and its clip box; `WM_PAINT`, `f:` and
 * the rectangle to paint; `WM_SIZE` and `WM_MOVE` their `lParam`.
 *
 * And the bits kept: `W` with `WS_OVERLAPPEDWINDOW` and `DefWindowProc`'s
 * client area, painted in stripes of the sixteen colours, each 8 wide, is
 * sized to 240 by 170 with `SetWindowPos`, its procedure answering
 * `WM_NCCALCSIZE` as `DefWindowProc` does but for its answer, and with
 * the second and third rectangles changed for `valid-rects`; it paints
 * nothing more. `bits`: its log, and the client area's row 20 and its
 * column 30 on the screen afterwards, a hex digit a pixel as `chrome`
 * writes them.
 *
 * * `valid-0`: nought.
 * * `valid-right`: `WVR_ALIGNRIGHT | WVR_ALIGNBOTTOM`, C0h.
 * * `valid-redraw`: `WVR_REDRAW`, 300h.
 * * `valid-rects`: `WVR_VALIDRECTS`, 400h, the second rectangle the new
 *   client area's top left 40 by 30 moved 20 right and 10 down, the third
 *   the old one's top left 40 by 30.
 * * `valid-high`: 800h, beyond what `SetWindowPos` reads as flags.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\NCCALC.OUT"

/* Each record is closed into the file, so a hang leaves those before it. */
static void record(LPCSTR function, LPCSTR args, LPCSTR result)
{
    probe(function, args, result);
    _lclose(probeHandle);
    probeHandle = _lopen(OUTPUT, OF_WRITE);
    _llseek(probeHandle, 0, 2);
}

#define probe record

#define MODE_DEF 0
#define MODE_INSET 1
#define MODE_ZERO 2
#define MODE_WHOLE 3
#define MODE_ANSWER 4

static HINSTANCE module;
static int mode;
static LONG answer;
static BOOL validRects;
static BOOL stripes;
static BOOL logging;
static char events[1500];

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

static void add(LPCSTR text)
{
    if (logging && lstrlen(events) + lstrlen(text) + 2 < sizeof(events)) {
        if (events[0]) {
            lstrcat(events, " ");
        }

        lstrcat(events, text);
    }
}

static void rect(LPSTR out, const RECT FAR *r)
{
    wsprintf(out, "%d:%d:%d:%d", r->left, r->top, r->right, r->bottom);
}

/* The first rectangle as the case makes it, from what `DefWindowProc` made. */
static void shape(RECT FAR *r)
{
    if (mode == MODE_INSET) {
        r->left += 10;
        r->top += 20;
        r->right -= 30;
        r->bottom -= 5;
    } else if (mode == MODE_ZERO) {
        r->right = r->left;
        r->bottom = r->top;
    }
}

LONG FAR PASCAL _export Proc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    char one[200];
    char a[32];
    char b[32];
    char c[32];
    char d[32];

    if (message == WM_NCCALCSIZE) {
        LONG result = 0;
        RECT FAR *first = (RECT FAR *)lParam;

        rect(a, first);

        if (wParam) {
            NCCALCSIZE_PARAMS FAR *params = (NCCALCSIZE_PARAMS FAR *)lParam;

            rect(b, &params->rgrc[1]);
            rect(c, &params->rgrc[2]);
        }

        if (mode != MODE_WHOLE) {
            result = DefWindowProc(hwnd, message, wParam, lParam);
        }

        shape(first);

        if (mode == MODE_ANSWER && wParam) {
            NCCALCSIZE_PARAMS FAR *params = (NCCALCSIZE_PARAMS FAR *)lParam;

            result = answer;

            if (validRects) {
                params->rgrc[1].left = params->rgrc[0].left + 20;
                params->rgrc[1].top = params->rgrc[0].top + 10;
                params->rgrc[1].right = params->rgrc[1].left + 40;
                params->rgrc[1].bottom = params->rgrc[1].top + 30;
                params->rgrc[2].right = params->rgrc[2].left + 40;
                params->rgrc[2].bottom = params->rgrc[2].top + 30;
            }
        }

        rect(d, first);

        if (wParam) {
            wsprintf(one, "83:1:%s/%s/%s>%s=%lx", (LPSTR)a, (LPSTR)b, (LPSTR)c, (LPSTR)d, result);
        } else {
            wsprintf(one, "83:0:%s>%s=%lx", (LPSTR)a, (LPSTR)d, result);
        }

        add(one);
        return result;
    }

    if (message == WM_ERASEBKGND) {
        RECT box;

        GetClipBox((HDC)wParam, &box);
        rect(a, &box);
        wsprintf(one, "14:%s", (LPSTR)a);
        add(one);
    } else if (message == WM_PAINT) {
        PAINTSTRUCT paint;

        BeginPaint(hwnd, &paint);
        rect(a, &paint.rcPaint);
        wsprintf(one, "f:%s", (LPSTR)a);
        add(one);

        if (stripes) {
            RECT client;
            int x;

            GetClientRect(hwnd, &client);

            for (x = 0; x < client.right; x += 8) {
                HBRUSH brush = CreateSolidBrush(PALETTE[(x / 8) % 16]);
                RECT stripe;

                SetRect(&stripe, x, 0, x + 8, client.bottom);
                FillRect(paint.hdc, &stripe, brush);
                DeleteObject(brush);
            }
        }

        EndPaint(hwnd, &paint);
        return 0;
    } else if (message == WM_MOVE || message == WM_SIZE) {
        wsprintf(one, "%x:%lx", message, lParam);
        add(one);
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

LONG FAR PASCAL _export ChildProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
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

static void rects(LPCSTR name, HWND w)
{
    RECT window;
    RECT client;
    POINT corner;

    GetWindowRect(w, &window);
    GetClientRect(w, &client);
    corner.x = 0;
    corner.y = 0;
    ClientToScreen(w, &corner);
    wsprintf(probeResult, "window=%d:%d:%d:%d,client=%d:%d,at=%d:%d", window.left, window.top,
             window.right, window.bottom, client.right, client.bottom, corner.x, corner.y);
    probe("rects", name, probeResult);
}

/* Runs of what `DefWindowProc` answers along a line, `code*count`. */
static void runs(LPSTR out, HWND w, int x, int y, int dx, int dy, int steps)
{
    int step;
    UINT last = 0xffff;
    int count = 0;

    *out = '\0';

    for (step = 0; step <= steps; step++) {
        UINT code = (UINT)DefWindowProc(w, WM_NCHITTEST, 0,
                                        MAKELPARAM(x + step * dx, y + step * dy));

        if (code == last) {
            count++;
            continue;
        }

        if (count) {
            wsprintf(out + lstrlen(out), "%s%x*%d", (LPSTR)(*out ? " " : ""), last, count);
        }

        last = code;
        count = 1;
    }

    wsprintf(out + lstrlen(out), "%s%x*%d", (LPSTR)(*out ? " " : ""), last, count);
}

static void hits(LPCSTR name, HWND w)
{
    RECT r;
    char across[300];
    char down[300];

    GetWindowRect(w, &r);
    runs(across, w, r.left - 2, (r.top + r.bottom) / 2, 1, 0, r.right - r.left + 3);
    runs(down, w, (r.left + r.right) / 2, r.top - 2, 0, 1, r.bottom - r.top + 3);
    wsprintf(probeResult, "across=%s;down=%s", (LPSTR)across, (LPSTR)down);
    probe("hit", name, probeResult);
}

static void begin(void)
{
    events[0] = '\0';
    logging = TRUE;
}

static void shapeCase(LPCSTR name, DWORD style, int how)
{
    HWND w;
    HWND child;
    RECT r;
    char label[40];

    mode = how;
    begin();
    w = CreateWindow("NcCalc", "W", style, 40, 40, 200, 150, NULL, NULL, module, NULL);
    ShowWindow(w, SW_SHOWNORMAL);
    UpdateWindow(w);
    pump();
    logging = FALSE;
    wsprintf(label, "%s-made", name);
    probe("log", label, events);

    rects(name, w);
    hits(name, w);

    child = CreateWindow("NcChild", "", WS_CHILD | WS_VISIBLE, 0, 0, 20, 10, w, NULL, module,
                         NULL);
    GetWindowRect(child, &r);
    rect(probeResult, &r);
    probe("child", name, probeResult);
    DestroyWindow(child);
    pump();

    SetWindowPos(w, NULL, 60, 50, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
    pump();
    wsprintf(label, "%s-moved", name);
    rects(label, w);

    begin();
    SetWindowPos(w, NULL, 0, 0, 240, 170, SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE);
    pump();
    logging = FALSE;
    wsprintf(label, "%s-sized", name);
    probe("log", label, events);
    rects(label, w);

    DestroyWindow(w);
    pump();
}

static void bitsCase(LPCSTR name, LONG how, BOOL rects)
{
    HWND w;
    HDC screen;
    RECT client;
    POINT corner;
    int x;
    int y;
    LPSTR at;

    mode = MODE_DEF;
    stripes = TRUE;
    w = CreateWindow("NcCalc", "W", WS_OVERLAPPEDWINDOW, 40, 40, 200, 150, NULL, NULL, module,
                     NULL);
    ShowWindow(w, SW_SHOWNORMAL);
    UpdateWindow(w);
    pump();

    stripes = FALSE;
    mode = MODE_ANSWER;
    answer = how;
    validRects = rects;
    begin();
    SetWindowPos(w, NULL, 0, 0, 240, 170, SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE);
    UpdateWindow(w);
    pump();
    logging = FALSE;
    probe("log", name, events);

    GetClientRect(w, &client);
    corner.x = 0;
    corner.y = 0;
    ClientToScreen(w, &corner);
    screen = GetDC(NULL);

    at = probeResult;
    y = corner.y + 20;

    for (x = corner.x; x < corner.x + client.right; x++) {
        *at++ = digit(GetPixel(screen, x, y));
    }

    *at = '\0';
    wsprintf(probeArgs, "%s,row", (LPSTR)name);
    probe("bits", probeArgs, probeResult);

    at = probeResult;
    x = corner.x + 30;

    for (y = corner.y; y < corner.y + client.bottom; y++) {
        *at++ = digit(GetPixel(screen, x, y));
    }

    *at = '\0';
    wsprintf(probeArgs, "%s,column", (LPSTR)name);
    probe("bits", probeArgs, probeResult);

    ReleaseDC(NULL, screen);
    mode = MODE_DEF;
    validRects = FALSE;
    DestroyWindow(w);
    pump();
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;

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
    kind.lpszClassName = "NcCalc";
    RegisterClass(&kind);
    kind.lpfnWndProc = ChildProc;
    kind.hbrBackground = GetStockObject(BLACK_BRUSH);
    kind.lpszClassName = "NcChild";
    RegisterClass(&kind);

    /* The pointer out of the way. */
    ShowCursor(FALSE);
    SetCursorPos(639, 479);

    shapeCase("def", WS_OVERLAPPEDWINDOW, MODE_DEF);
    shapeCase("inset", WS_OVERLAPPEDWINDOW, MODE_INSET);
    shapeCase("zero", WS_OVERLAPPEDWINDOW, MODE_ZERO);
    shapeCase("whole", WS_OVERLAPPEDWINDOW, MODE_WHOLE);
    shapeCase("whole-popup", WS_POPUP | WS_CAPTION | WS_SYSMENU, MODE_WHOLE);

    bitsCase("valid-0", 0, FALSE);
    bitsCase("valid-right", 0xc0, FALSE);
    bitsCase("valid-redraw", 0x300, FALSE);
    bitsCase("valid-rects", 0x400, TRUE);
    bitsCase("valid-high", 0x800, FALSE);

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
