/*
 * Where `SetWindowPos` puts a window in the order of windows: `HWND_TOP`,
 * `HWND_BOTTOM`, after a window given, `HWND_TOPMOST` and `HWND_NOTOPMOST`;
 * with `SWP_NOACTIVATE` and without; for windows at the top and for
 * children. And what each window is sent as the change uncovers it, at once
 * and once the messages are taken.
 *
 * `A`, `B`, `C` and `D` are pop-ups with borders, 200 by 150, at (40, 40),
 * (80, 70), (120, 100) and (160, 130), each over the one before, made in
 * that order and shown, so D is at the front and active. `P` is a pop-up
 * at (300, 200), 320 by 260, with children `K1`, `K2` and `K3`, 120 by 100,
 * at (10, 10), (50, 40) and (90, 70) in its client area, K3 at the front.
 *
 * * `order`: the windows named among the desktop's children, the front
 *   first, or among P's, with `*` after one with WS_EX_TOPMOST, and then
 *   the active window.
 * * `sent`: the messages sent, as `X:` and then `85` for WM_NCPAINT, `14`
 *   for WM_ERASEBKGND, `f{l,t,r,b}` for WM_PAINT with BeginPaint's
 *   rcPaint, `6(s)` for WM_ACTIVATE with its state, `46` and `47` for
 *   WM_WINDOWPOSCHANGING and WM_WINDOWPOSCHANGED (with `@a` naming the
 *   window to go after as the structure gives it, `T` for 0, `M` for
 *   1, `X` for -1, `N` for -2); at once, and with the messages taken.
 * * `answer`: what SetWindowPos answered.
 *
 * Each step is a SetWindowPos with SWP_NOMOVE | SWP_NOSIZE and the flags
 * named:
 *
 * * `bottom`: D to HWND_BOTTOM, not activated; `bottomact` C to the
 *   bottom, activated.
 * * `after`: A after B, not activated; `afterlast` A after the window at
 *   the back; `afteract` B after C, activated; `afterself` B after B;
 *   `afterhidden` C after a hidden window, H, made at (0, 0), 10 by 10.
 * * `top`: the window at the back to HWND_TOP, not activated.
 * * `topmost`: B to HWND_TOPMOST, not activated; then `toptop` C to
 *   HWND_TOP and `topbottom` B to HWND_BOTTOM, not activated; `notopmost`
 *   B to HWND_NOTOPMOST; `topmostact` C to HWND_TOPMOST, activated;
 *   `aftertopmost` A after C, which is topmost; `notopmost2` C to
 *   HWND_NOTOPMOST.
 * * `kbottom`: K3 to HWND_BOTTOM among P's children; `kafter` K3 after K1;
 *   `ktop` K1 to HWND_TOP; `ktopmost` K2 to HWND_TOPMOST.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\SWPORDER.OUT"

#define HWND_TOPMOST_ ((HWND)-1)
#define HWND_NOTOPMOST_ ((HWND)-2)
#define WS_EX_TOPMOST_ 0x00000008L

static char seen[1600];
static HWND windows[10];
static const char *names[] = { "A", "B", "C", "D", "P", "K1", "K2", "K3", "H" };
#define COUNT 9

static void record(LPCSTR function, LPCSTR args, LPCSTR result)
{
    probe(function, args, result);
    _lclose(probeHandle);
    probeHandle = _lopen(OUTPUT, OF_WRITE);
    _llseek(probeHandle, 0, 2);
}

#define probe record

static LPCSTR nameOf(HWND hwnd)
{
    int i;

    if (!hwnd) {
        return "0";
    }

    for (i = 0; i < COUNT; i++) {
        if (windows[i] == hwnd) {
            return names[i];
        }
    }

    return "?";
}

static LPCSTR afterOf(HWND hwnd)
{
    if (hwnd == HWND_TOP) {
        return "T";
    }

    if (hwnd == HWND_BOTTOM) {
        return "M";
    }

    if (hwnd == HWND_TOPMOST_) {
        return "X";
    }

    if (hwnd == HWND_NOTOPMOST_) {
        return "N";
    }

    return nameOf(hwnd);
}

static void note(HWND window, LPCSTR what)
{
    char one[60];

    wsprintf(one, "%s:%s,", nameOf(window), what);
    lstrcat(seen, one);
}

LRESULT CALLBACK __export Proc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    char one[40];
    PAINTSTRUCT paint;
    WINDOWPOS FAR *pos;

    switch (message) {
    case WM_PAINT:
        BeginPaint(window, &paint);
        wsprintf(one, "f{%d,%d,%d,%d}", paint.rcPaint.left, paint.rcPaint.top,
                 paint.rcPaint.right, paint.rcPaint.bottom);
        note(window, one);
        EndPaint(window, &paint);
        return 0;
    case WM_NCPAINT:
    case WM_ERASEBKGND:
        wsprintf(one, "%x", message);
        note(window, one);
        break;
    case WM_ACTIVATE:
        wsprintf(one, "6(%d)", wParam);
        note(window, one);
        break;
    case WM_WINDOWPOSCHANGING:
    case WM_WINDOWPOSCHANGED:
        pos = (WINDOWPOS FAR *)lParam;
        wsprintf(one, "%x@%s", message, afterOf(pos->hwndInsertAfter));
        note(window, one);
        break;
    }

    return DefWindowProc(window, message, wParam, lParam);
}

static void take(void)
{
    MSG msg;

    while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
        DispatchMessage(&msg);
    }
}

static void order(LPCSTR name, HWND parent)
{
    char text[120];
    LPSTR at = text;
    HWND hwnd;
    int i;

    *at = '\0';

    for (hwnd = GetWindow(parent, GW_CHILD); hwnd; hwnd = GetWindow(hwnd, GW_HWNDNEXT)) {
        for (i = 0; i < COUNT; i++) {
            if (windows[i] == hwnd) {
                at += wsprintf(at, "%s%s%s%s", (LPSTR)(at == text ? "" : ","), nameOf(hwnd),
                               (LPSTR)(GetWindowLong(hwnd, GWL_EXSTYLE) & WS_EX_TOPMOST_ ? "*"
                                                                                        : ""),
                               (LPSTR)(IsWindowVisible(hwnd) ? "" : "-"));
            }
        }
    }

    wsprintf(probeResult, "%s;active=%s", (LPSTR)text, nameOf(GetActiveWindow()));
    probe("order", name, probeResult);
}

/* A step: the call, what it answered, the order, and what was sent. */
static void step(LPCSTR name, HWND window, HWND after, UINT flags, HWND parent)
{
    char label[60];
    BOOL answer;

    take();
    seen[0] = '\0';
    answer = SetWindowPos(window, after, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | flags);
    wsprintf(probeResult, "%d", answer);
    probe("answer", name, probeResult);
    order(name, parent);
    wsprintf(label, "%s, at once", name);
    probe("sent", label, seen[0] ? seen : "none");
    seen[0] = '\0';
    take();
    wsprintf(label, "%s, messages taken", name);
    probe("sent", label, seen[0] ? seen : "none");
    seen[0] = '\0';
}

static HWND make(int which, DWORD style, int x, int y, int width, int height, HWND parent,
                 HINSTANCE instance)
{
    windows[which] = CreateWindow("Order", names[which], style, x, y, width, height, parent,
                                  NULL, instance, NULL);
    return windows[which];
}

#define NA SWP_NOACTIVATE

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HWND desktop = GetDesktopWindow();
    int i;

    probeOpen(OUTPUT);

    kind.style = 0;
    kind.lpfnWndProc = Proc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "Order";
    RegisterClass(&kind);

    make(8, WS_POPUP, 0, 0, 10, 10, NULL, instance);

    for (i = 0; i < 4; i++) {
        make(i, WS_POPUP | WS_BORDER | WS_VISIBLE, 40 * (i + 1), 40 + 30 * i, 200, 150, NULL,
             instance);
        UpdateWindow(windows[i]);
    }

    take();
    order("start", desktop);

    step("bottom", windows[3], HWND_BOTTOM, NA, desktop);
    step("bottomact", windows[2], HWND_BOTTOM, 0, desktop);
    step("top", windows[2], HWND_TOP, NA, desktop);
    step("after", windows[0], windows[1], NA, desktop);
    step("afterlast", windows[0], windows[3], NA, desktop);
    step("afteract", windows[1], windows[2], 0, desktop);
    step("afterself", windows[1], windows[1], NA, desktop);
    step("afterhidden", windows[2], windows[8], NA, desktop);
    step("topmost", windows[1], HWND_TOPMOST_, NA, desktop);
    step("toptop", windows[2], HWND_TOP, NA, desktop);
    step("topbottom", windows[1], HWND_BOTTOM, NA, desktop);
    step("notopmost", windows[1], HWND_NOTOPMOST_, NA, desktop);
    step("topmostact", windows[2], HWND_TOPMOST_, 0, desktop);
    step("aftertopmost", windows[0], windows[2], NA, desktop);
    step("notopmost2", windows[2], HWND_NOTOPMOST_, NA, desktop);

    make(4, WS_POPUP | WS_BORDER | WS_VISIBLE, 300, 200, 320, 260, NULL, instance);

    for (i = 5; i < 8; i++) {
        make(i, WS_CHILD | WS_BORDER | WS_VISIBLE, 10 + 40 * (i - 5), 10 + 30 * (i - 5), 120,
             100, windows[4], instance);
    }

    UpdateWindow(windows[4]);
    take();
    order("children", windows[4]);

    step("kbottom", windows[7], HWND_BOTTOM, 0, windows[4]);
    step("kafter", windows[7], windows[5], 0, windows[4]);
    step("ktop", windows[5], HWND_TOP, 0, windows[4]);
    step("ktopmost", windows[6], HWND_TOPMOST_, 0, windows[4]);

    for (i = COUNT - 1; i >= 0; i--) {
        if (IsWindow(windows[i])) {
            DestroyWindow(windows[i]);
        }
    }

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
