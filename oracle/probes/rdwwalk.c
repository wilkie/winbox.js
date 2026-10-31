/*
 * RedrawWindow's flags through USER's walk (`USER.EXE` seg1 `3e1e`, `3ed7`,
 * `4034`, `4202`): what each window is due after the call, and the order of
 * WM_NCPAINT, WM_ERASEBKGND and WM_PAINT during it and after it.
 *
 * P is a pop-up with a border, 220 by 140 at (20, 20), without
 * WS_CLIPCHILDREN. In it: A, a child with a border at (10, 10), 80 by 50,
 * with a child of its own, A1, at (5, 5), 30 by 20; B, a child with a border
 * at (60, 40), 80 by 50, overlapping A; and Z, a child at (300, 10), 30 by 30,
 * outside P's client area. Q is a pop-up with a border, the same size at
 * (260, 20), with WS_CLIPCHILDREN. In it: C, with a border and
 * WS_CLIPSIBLINGS at (10, 10), 80 by 50, with C1 at (5, 5), 30 by 20; D, with
 * a border and WS_CLIPSIBLINGS at (60, 40), 80 by 50, overlapping C; and X, with
 * WS_EX_TRANSPARENT and WS_CLIPSIBLINGS at (120, 20), 60 by 60, overlapping
 * D. I is
 * a pop-up of a class with an icon, minimized. Every window is white, and
 * each case starts with every window painted and nothing due.
 *
 * Each case is one or more calls of RedrawWindow on P and then on Q (the
 * case's name, then `P` or `Q`); `rect` is P's or Q's (20, 20)-(120, 70) in
 * its client area, `rgn` a region of (0, 0)-(30, 30) and (100, 60)-(130,
 * 90) there. A case named `pre` first makes the tree due all over, erase
 * and frame (`RDW_INVALIDATE | RDW_ERASE | RDW_FRAME | RDW_ALLCHILDREN`).
 *
 * * `answer`: the case; what RedrawWindow answered.
 * * `during`: the case and the window, in order; the message sent while
 *   RedrawWindow ran: `ncpaint` and its region (1, or the region's kind and
 *   box, bands where it is complex), `erase`, or `paint` with BeginPaint's
 *   rectangle and fErase.
 * * `update`: the case and the window; GetUpdateRgn's kind and box (bands
 *   where it is complex), after the calls.
 * * `after`: as `during`, for the messages the message loop then brings.
 */

#include "probe.h"
#include "visprobe.h"

#ifndef OUTPUT
#define OUTPUT "C:\\ORACLE\\RDWWALK.OUT"
#endif

#ifndef RDW_INVALIDATE
#define RDW_INVALIDATE 0x0001
#define RDW_INTERNALPAINT 0x0002
#define RDW_ERASE 0x0004
#define RDW_VALIDATE 0x0008
#define RDW_NOINTERNALPAINT 0x0010
#define RDW_NOERASE 0x0020
#define RDW_NOCHILDREN 0x0040
#define RDW_ALLCHILDREN 0x0080
#define RDW_UPDATENOW 0x0100
#define RDW_ERASENOW 0x0200
#define RDW_FRAME 0x0400
#define RDW_NOFRAME 0x0800
#endif

#define PRE (RDW_INVALIDATE | RDW_ERASE | RDW_FRAME | RDW_ALLCHILDREN)

static HWND p, a, a1, b, z, q, c, c1, d, x, ic;
static HRGN rgn;
static LPCSTR phase = NULL;
static char caseName[64];

static void nameOf(HWND hwnd, LPSTR out)
{
    char title[8];

    GetWindowText(hwnd, title, sizeof(title));
    wsprintf(out, "%s %s", (LPSTR)caseName, (LPSTR)title);
}

/* A region's kind and box, and its bands where it is complex. */
static void shortRegion(LPSTR out, HRGN region)
{
    RECT box;
    int kind = GetRgnBox(region, &box);

    if (kind == COMPLEXREGION) {
        regionText(out, region);
    } else {
        wsprintf(out, "%d %d,%d,%d,%d", kind, box.left, box.top, box.right, box.bottom);
    }
}

LONG FAR PASCAL _export NoteProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_PAINT) {
        PAINTSTRUCT ps;

        BeginPaint(hwnd, &ps);

        if (phase) {
            nameOf(hwnd, probeArgs);
            wsprintf(probeResult, "paint %d,%d,%d,%d erase %d", ps.rcPaint.left, ps.rcPaint.top,
                     ps.rcPaint.right, ps.rcPaint.bottom, ps.fErase);
            probe(phase, probeArgs, probeResult);
        }

        EndPaint(hwnd, &ps);
        return 0;
    }

    if (message == WM_ERASEBKGND && phase) {
        nameOf(hwnd, probeArgs);
        probe(phase, probeArgs, "erase");
    }

    if (message == WM_NCPAINT && phase) {
        char text[1024];

        nameOf(hwnd, probeArgs);

        if (wParam == 1) {
            lstrcpy(text, "1");
        } else {
            shortRegion(text, (HRGN)wParam);
        }

        wsprintf(probeResult, "ncpaint %s", (LPSTR)text);
        probe(phase, probeArgs, probeResult);
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

static void registerClass(HINSTANCE instance, LPCSTR name, HICON icon)
{
    WNDCLASS kind;

    kind.style = 0;
    kind.lpfnWndProc = NoteProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = icon;
    kind.hCursor = NULL;
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = name;
    RegisterClass(&kind);
}

static void pump(void)
{
    MSG msg;

    while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
        DispatchMessage(&msg);
    }
}

/* Every window painted, nothing due. */
static void settle(void)
{
    UpdateWindow(p);
    UpdateWindow(q);
    pump();
}

static void updateOf(HWND window)
{
    char title[8];

    GetWindowText(window, title, sizeof(title));
    wsprintf(probeArgs, "%s %s", (LPSTR)caseName, (LPSTR)title);
    GetUpdateRgn(window, rgn, FALSE);
    shortRegion(probeResult, rgn);
    probe("update", probeArgs, probeResult);
}

static void updates(HWND top)
{
    if (top == p) {
        updateOf(p);
        updateOf(a);
        updateOf(a1);
        updateOf(b);
        updateOf(z);
    } else {
        updateOf(q);
        updateOf(c);
        updateOf(c1);
        updateOf(d);
        updateOf(x);
    }
}

#define NONE 0
#define RECT_ 1
#define RGN_ 2

/* One call of RedrawWindow on a window, its messages noted. */
static void redraw(HWND window, int what, UINT flags)
{
    RECT rect;
    HRGN two = NULL;
    HRGN part;
    BOOL answer;

    SetRect(&rect, 20, 20, 120, 70);

    if (what == RGN_) {
        two = CreateRectRgn(0, 0, 30, 30);
        part = CreateRectRgn(100, 60, 130, 90);
        CombineRgn(two, two, part, RGN_OR);
        DeleteObject(part);
    }

    phase = "during";
    answer = RedrawWindow(window, what == RECT_ || what == RGN_ ? &rect : NULL, two, flags);
    phase = NULL;

    if (two) {
        DeleteObject(two);
    }

    wsprintf(probeResult, "%d", answer);
    probe("answer", caseName, probeResult);
}

/* A case on one tree: optionally made due all over first, then up to two calls. */
static void caseOn(LPCSTR name, HWND top, BOOL pre, int what, UINT flags, UINT then)
{
    wsprintf(caseName, "%s %s", name, (LPSTR)(top == p ? "P" : "Q"));

    if (pre) {
        RedrawWindow(top, NULL, NULL, PRE);
    }

    redraw(top, what, flags);

    if (then) {
        redraw(top, what, then);
    }

    updates(top);
    phase = "after";
    pump();
    phase = NULL;
    settle();
}

static void both(LPCSTR name, BOOL pre, int what, UINT flags, UINT then)
{
    caseOn(name, p, pre, what, flags, then);
    caseOn(name, q, pre, what, flags, then);
}

static HWND child(HINSTANCE instance, LPCSTR name, HWND parent, DWORD style, DWORD ex, int left,
                  int top, int width, int height)
{
    return CreateWindowEx(ex, "RdwWalk", name, WS_CHILD | WS_VISIBLE | style, left, top, width,
                          height, parent, NULL, instance, NULL);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    probeOpen(OUTPUT);
    rgn = CreateRectRgn(0, 0, 0, 0);

    registerClass(instance, "RdwWalk", NULL);
    registerClass(instance, "RdwIcon", LoadIcon(NULL, IDI_APPLICATION));

    p = CreateWindow("RdwWalk", "P", WS_POPUP | WS_BORDER | WS_VISIBLE, 20, 20, 220, 140, NULL,
                     NULL, instance, NULL);
    a = child(instance, "A", p, WS_BORDER, 0, 10, 10, 80, 50);
    a1 = child(instance, "A1", a, 0, 0, 5, 5, 30, 20);
    b = child(instance, "B", p, WS_BORDER, 0, 60, 40, 80, 50);
    z = child(instance, "Z", p, 0, 0, 300, 10, 30, 30);
    q = CreateWindow("RdwWalk", "Q", WS_POPUP | WS_BORDER | WS_VISIBLE | WS_CLIPCHILDREN, 260, 20,
                     220, 140, NULL, NULL, instance, NULL);
    c = child(instance, "C", q, WS_BORDER | WS_CLIPSIBLINGS, 0, 10, 10, 80, 50);
    c1 = child(instance, "C1", c, 0, 0, 5, 5, 30, 20);
    d = child(instance, "D", q, WS_BORDER | WS_CLIPSIBLINGS, 0, 60, 40, 80, 50);
    x = child(instance, "X", q, WS_CLIPSIBLINGS, WS_EX_TRANSPARENT, 120, 20, 60, 60);
    ic = CreateWindow("RdwIcon", "I", WS_POPUP | WS_BORDER, 20, 300, 100, 60, NULL, NULL,
                      instance, NULL);
    ShowWindow(ic, SW_SHOWMINNOACTIVE);
    UpdateWindow(p);
    UpdateWindow(q);
    UpdateWindow(ic);
    pump();
    settle();

    /* Making due. */
    both("inv", FALSE, NONE, RDW_INVALIDATE, 0);
    both("inv rect", FALSE, RECT_, RDW_INVALIDATE, 0);
    both("inv rgn", FALSE, RGN_, RDW_INVALIDATE, 0);
    both("erase", FALSE, NONE, RDW_INVALIDATE | RDW_ERASE, 0);
    both("frame", FALSE, NONE, RDW_INVALIDATE | RDW_FRAME, 0);
    both("frame rect", FALSE, RECT_, RDW_INVALIDATE | RDW_ERASE | RDW_FRAME, 0);
    both("all", FALSE, NONE, RDW_INVALIDATE | RDW_ERASE | RDW_ALLCHILDREN, 0);
    both("all rect", FALSE, RECT_, RDW_INVALIDATE | RDW_ERASE | RDW_ALLCHILDREN, 0);
    both("no", FALSE, NONE, RDW_INVALIDATE | RDW_ERASE | RDW_NOCHILDREN, 0);
    both("no erase", FALSE, NONE, RDW_ERASE | RDW_FRAME, 0);
    both("both", FALSE, NONE, RDW_INVALIDATE | RDW_VALIDATE, 0);

    /* Painting now. */
    both("updatenow", FALSE, NONE, RDW_INVALIDATE | RDW_ERASE | RDW_UPDATENOW, 0);
    both("updatenow all", FALSE, NONE,
         RDW_INVALIDATE | RDW_ERASE | RDW_FRAME | RDW_UPDATENOW | RDW_ALLCHILDREN, 0);
    both("updatenow no", FALSE, NONE, RDW_INVALIDATE | RDW_ERASE | RDW_UPDATENOW | RDW_NOCHILDREN,
         0);
    both("erasenow", FALSE, NONE, RDW_INVALIDATE | RDW_ERASE | RDW_ERASENOW, 0);
    both("erasenow all", FALSE, NONE,
         RDW_INVALIDATE | RDW_ERASE | RDW_FRAME | RDW_ERASENOW | RDW_ALLCHILDREN, 0);
    both("erasenow no", FALSE, NONE, RDW_INVALIDATE | RDW_ERASE | RDW_ERASENOW | RDW_NOCHILDREN,
         0);
    both("erasenow rect", FALSE, RECT_, RDW_INVALIDATE | RDW_FRAME | RDW_ERASENOW, 0);
    both("now both", FALSE, NONE,
         RDW_INVALIDATE | RDW_ERASE | RDW_UPDATENOW | RDW_ERASENOW | RDW_ALLCHILDREN, 0);
    both("pre updatenow", TRUE, NONE, RDW_UPDATENOW, 0);
    both("pre erasenow", TRUE, NONE, RDW_ERASENOW | RDW_ALLCHILDREN, 0);

    /* Internal paints. */
    both("internal", FALSE, NONE, RDW_INTERNALPAINT, 0);
    both("internal all", FALSE, NONE, RDW_INTERNALPAINT | RDW_ALLCHILDREN, 0);
    both("internal now", FALSE, NONE, RDW_INTERNALPAINT | RDW_UPDATENOW, 0);
    both("internal no", FALSE, NONE, RDW_INTERNALPAINT | RDW_ALLCHILDREN,
         RDW_NOINTERNALPAINT | RDW_ALLCHILDREN);
    both("internal validate", TRUE, NONE, RDW_INTERNALPAINT | RDW_VALIDATE, 0);

    /* Validating. */
    both("pre validate", TRUE, NONE, RDW_VALIDATE, 0);
    both("pre validate all", TRUE, NONE, RDW_VALIDATE | RDW_ALLCHILDREN, 0);
    both("pre validate no", TRUE, NONE, RDW_VALIDATE | RDW_NOCHILDREN, 0);
    both("pre validate rect", TRUE, RECT_, RDW_VALIDATE | RDW_ALLCHILDREN, 0);
    both("pre noerase", TRUE, NONE, RDW_NOERASE | RDW_ALLCHILDREN, 0);
    both("pre validate noerase", TRUE, RECT_, RDW_VALIDATE | RDW_NOERASE | RDW_ALLCHILDREN, 0);
    both("pre validate noframe", TRUE, NONE, RDW_VALIDATE | RDW_NOFRAME, 0);
    both("pre validate noframe rect", TRUE, RECT_, RDW_VALIDATE | RDW_NOFRAME | RDW_NOCHILDREN, 0);
    both("pre noframe noerase", TRUE, NONE,
         RDW_VALIDATE | RDW_NOFRAME | RDW_NOERASE | RDW_NOCHILDREN, 0);
    both("pre inv", TRUE, NONE, RDW_INVALIDATE | RDW_ALLCHILDREN, 0);

    /* The minimized window of a class with an icon. */
    lstrcpy(caseName, "icon");
    redraw(ic, NONE, RDW_INVALIDATE | RDW_ERASE);
    updateOf(ic);
    phase = "after";
    pump();
    phase = NULL;
    lstrcpy(caseName, "icon frame");
    redraw(ic, NONE, RDW_INVALIDATE | RDW_ERASE | RDW_FRAME);
    updateOf(ic);
    phase = "after";
    pump();
    phase = NULL;

    DeleteObject(rgn);
    DestroyWindow(ic);
    DestroyWindow(q);
    DestroyWindow(p);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
