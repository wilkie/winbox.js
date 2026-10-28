/*
 * Scrolling a window part of which another window covers: what
 * `ScrollWindow`, `ScrollWindowEx` and `ScrollDC` copy, what they say is
 * left to paint, the children they move and the caret (`visprobe.h`).
 *
 * P is a pop-up 120 by 80 at (100, 100) of a class with no background,
 * whose paint draws nothing. Q, a pop-up 80 by 40 at (160, 120), white with
 * a black square at (10, 10) to (20, 20) of its own, covers P from (60, 20)
 * to the right edge, down to (60, 60). Before each case P is drawn white,
 * through its own context, with black squares at (0, 0) to (10, 10),
 * (30, 10) to (50, 30) and (40, 50) to (70, 70), and what P was due is
 * validated. No message is dispatched between a scroll and what is read.
 *
 * * `screen`: the case; where the screen is black from (90, 90) to
 *   (250, 190), as bands.
 * * `update`: the case; P's update region (`GetUpdateRgn`), in its terms.
 * * `answer`: the case; what the call answered, the update rectangle it
 *   gave and its update region.
 *
 * R is a pop-up 100 by 80 at (300, 100), white, with a black child K at
 * (10, 10), 20 by 20, which counts its `WM_MOVE`s. For R's cases `screen`
 * is from (290, 90) to (420, 200), and `child` is where K is on the screen,
 * the `WM_MOVE`s it was sent and the last one's position, and K's update
 * rectangle. The caret is P's, 2 by 6, at (5, 5); `caret` is where it is
 * after.
 */

#include "probe.h"
#include "visprobe.h"

#define OUTPUT "C:\\ORACLE\\VISSCRL.OUT"

#define SW_SCROLLCHILDREN 0x0001
#define SW_INVALIDATE 0x0002
#define SW_ERASE 0x0004

static HWND p;
static HWND q;
static HWND r;
static HWND k;
static int moves;
static LPARAM lastMove;
static HRGN rgn;

LONG FAR PASCAL _export PlainProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_PAINT) {
        PAINTSTRUCT ps;

        BeginPaint(hwnd, &ps);
        EndPaint(hwnd, &ps);
        return 0;
    }

    if (message == WM_ERASEBKGND) {
        return 1;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

LONG FAR PASCAL _export ChildProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_MOVE) {
        moves++;
        lastMove = lParam;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

static void registerClass(HINSTANCE instance, LPCSTR name, WNDPROC proc, int brush)
{
    WNDCLASS kind;

    kind.style = 0;
    kind.lpfnWndProc = proc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = brush < 0 ? NULL : GetStockObject(brush);
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

static void black(HDC dc, int left, int top, int right, int bottom)
{
    PatBlt(dc, left, top, right - left, bottom - top, BLACKNESS);
}

/* P drawn as each case starts, and Q's square again; nothing due. */
static void prepare(void)
{
    HDC dc = GetDC(p);

    PatBlt(dc, 0, 0, 120, 80, WHITENESS);
    black(dc, 0, 0, 10, 10);
    black(dc, 30, 10, 50, 30);
    black(dc, 40, 50, 70, 70);
    ReleaseDC(p, dc);

    dc = GetDC(q);
    PatBlt(dc, 0, 0, 80, 40, WHITENESS);
    black(dc, 10, 10, 20, 20);
    ReleaseDC(q, dc);

    ValidateRect(p, NULL);
    ValidateRect(q, NULL);
}

/* R drawn white again, K where it began and black, nothing due. */
static void prepareR(void)
{
    HDC dc;

    SetWindowPos(k, NULL, 10, 10, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
    pump();
    dc = GetDC(r);
    PatBlt(dc, 0, 0, 100, 80, WHITENESS);
    ReleaseDC(r, dc);
    dc = GetDC(k);
    PatBlt(dc, 0, 0, 20, 20, BLACKNESS);
    ReleaseDC(k, dc);
    ValidateRect(r, NULL);
    ValidateRect(k, NULL);
    moves = 0;
    lastMove = 0;
}

static void screenAs(LPCSTR name, int left, int top, int right, int bottom)
{
    blackText(probeResult, left, top, right, bottom);
    probe("screen", name, probeResult);
}

static void updateAs(LPCSTR name, HWND window)
{
    GetUpdateRgn(window, rgn, FALSE);
    regionText(probeResult, rgn);
    probe("update", name, probeResult);
}

static void answerAs(LPCSTR name, int answer, RECT *rect, HRGN region)
{
    LPSTR at = probeResult + wsprintf(probeResult, "%d %d,%d,%d,%d ", answer, rect->left,
                                      rect->top, rect->right, rect->bottom);

    regionText(at, region);
    probe("answer", name, probeResult);
}

static void childAs(LPCSTR name)
{
    RECT box;
    RECT due;
    BOOL any;

    GetWindowRect(k, &box);
    any = GetUpdateRect(k, &due, FALSE);
    wsprintf(probeResult, "%d,%d,%d,%d moves %d %d,%d due %d %d,%d,%d,%d", box.left, box.top,
             box.right, box.bottom, moves, (int)LOWORD(lastMove), (int)HIWORD(lastMove), any,
             due.left, due.top, due.right, due.bottom);
    probe("child", name, probeResult);
}

static void caretAs(LPCSTR name)
{
    POINT at;

    GetCaretPos(&at);
    wsprintf(probeResult, "%d,%d", at.x, at.y);
    probe("caret", name, probeResult);
}

/* What P's case left: the screen and what P is due. */
static void pAfter(LPCSTR name)
{
    screenAs(name, 90, 90, 250, 190);
    updateAs(name, p);
}

static void rAfter(LPCSTR name)
{
    screenAs(name, 290, 90, 420, 200);
    updateAs(name, r);
    childAs(name);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HDC dc;
    RECT rect;
    RECT clip;
    RECT update;
    int answer;

    probeOpen(OUTPUT);
    visImports();
    rgn = CreateRectRgn(0, 0, 0, 0);

    registerClass(instance, "VisScrollP", PlainProc, -1);
    registerClass(instance, "VisScrollW", DefWindowProc, WHITE_BRUSH);
    registerClass(instance, "VisScrollK", ChildProc, BLACK_BRUSH);

    p = CreateWindow("VisScrollP", "", WS_POPUP | WS_VISIBLE, 100, 100, 120, 80, NULL, NULL,
                     instance, NULL);
    q = CreateWindow("VisScrollW", "", WS_POPUP | WS_VISIBLE, 160, 120, 80, 40, NULL, NULL,
                     instance, NULL);
    r = CreateWindow("VisScrollW", "", WS_POPUP | WS_VISIBLE, 300, 100, 100, 80, NULL, NULL,
                     instance, NULL);
    k = CreateWindow("VisScrollK", "", WS_CHILD | WS_VISIBLE, 10, 10, 20, 20, r, NULL, instance,
                     NULL);
    UpdateWindow(p);
    UpdateWindow(q);
    UpdateWindow(r);
    pump();

    prepare();
    pAfter("start");

    prepare();
    ScrollWindow(p, 20, 0, NULL, NULL);
    pAfter("ScrollWindow 20,0");

    prepare();
    ScrollWindow(p, -20, -10, NULL, NULL);
    pAfter("ScrollWindow -20,-10");

    prepare();
    SetRect(&rect, 10, 10, 100, 70);
    ScrollWindow(p, 0, -10, &rect, NULL);
    pAfter("ScrollWindow 0,-10 rect");

    prepare();
    SetRect(&update, 1, 2, 3, 4);
    answer = ScrollWindowEx(p, 20, 10, NULL, NULL, rgn, &update, 0);
    answerAs("ScrollWindowEx 20,10", answer, &update, rgn);
    pAfter("ScrollWindowEx 20,10");

    prepare();
    SetRect(&update, 1, 2, 3, 4);
    answer = ScrollWindowEx(p, 20, 10, NULL, NULL, NULL, &update, SW_INVALIDATE | SW_ERASE);
    wsprintf(probeResult, "%d %d,%d,%d,%d", answer, update.left, update.top, update.right,
             update.bottom);
    probe("answer", "ScrollWindowEx 20,10 invalidate", probeResult);
    pAfter("ScrollWindowEx 20,10 invalidate");

    prepare();
    dc = GetDC(p);
    SetRect(&update, 1, 2, 3, 4);
    answer = ScrollDC(dc, 20, 10, NULL, NULL, rgn, &update);
    ReleaseDC(p, dc);
    answerAs("ScrollDC 20,10", answer, &update, rgn);
    pAfter("ScrollDC 20,10");

    prepare();
    dc = GetDC(p);
    SetRect(&clip, 0, 0, 90, 50);
    SetRect(&update, 1, 2, 3, 4);
    answer = ScrollDC(dc, -20, 0, NULL, &clip, rgn, &update);
    ReleaseDC(p, dc);
    answerAs("ScrollDC -20,0 clip", answer, &update, rgn);
    pAfter("ScrollDC -20,0 clip");

    /* Clipped clear of Q: one rectangle, scrolled one way and then both. */
    prepare();
    dc = GetDC(p);
    SetRect(&clip, 0, 0, 50, 80);
    SetRect(&update, 1, 2, 3, 4);
    answer = ScrollDC(dc, 0, 10, &clip, &clip, rgn, &update);
    answerAs("ScrollDC 0,10 clear", answer, &update, rgn);
    pAfter("ScrollDC 0,10 clear");
    SetRect(&update, 1, 2, 3, 4);
    answer = ScrollDC(dc, 10, 10, &clip, &clip, rgn, &update);
    answerAs("ScrollDC 10,10 clear", answer, &update, rgn);
    SetRect(&update, 1, 2, 3, 4);
    answer = ScrollDC(dc, 10, 10, &clip, &clip, NULL, &update);
    wsprintf(probeResult, "%d %d,%d,%d,%d", answer, update.left, update.top, update.right,
             update.bottom);
    probe("answer", "ScrollDC 10,10 clear no region", probeResult);
    SetRect(&update, 1, 2, 3, 4);
    SetRect(&rect, 0, 0, 20, 20);
    answer = ScrollDC(dc, 30, 0, &rect, &clip, rgn, &update);
    answerAs("ScrollDC 30,0 apart", answer, &update, rgn);
    ReleaseDC(p, dc);
    pAfter("ScrollDC clear after");

    /* Something due before the scroll. */
    prepare();
    SetRect(&rect, 0, 0, 20, 20);
    InvalidateRect(p, &rect, FALSE);
    ScrollWindow(p, 20, 10, NULL, NULL);
    pAfter("pending ScrollWindow");

    prepare();
    SetRect(&rect, 0, 0, 20, 20);
    InvalidateRect(p, &rect, FALSE);
    SetRect(&update, 1, 2, 3, 4);
    answer = ScrollWindowEx(p, 20, 10, NULL, NULL, rgn, &update, 0);
    answerAs("pending ScrollWindowEx", answer, &update, rgn);
    pAfter("pending ScrollWindowEx");

    prepare();
    SetRect(&rect, 0, 0, 20, 20);
    InvalidateRect(p, &rect, FALSE);
    SetRect(&update, 1, 2, 3, 4);
    answer = ScrollWindowEx(p, 20, 10, NULL, NULL, rgn, &update, SW_INVALIDATE);
    answerAs("pending ScrollWindowEx invalidate", answer, &update, rgn);
    pAfter("pending ScrollWindowEx invalidate");

    /* Nothing to move. */
    prepare();
    SetRect(&update, 1, 2, 3, 4);
    answer = ScrollWindowEx(p, 0, 0, NULL, NULL, rgn, &update, SW_INVALIDATE);
    answerAs("ScrollWindowEx 0,0", answer, &update, rgn);

    /* The children. */
    prepareR();
    rAfter("R start");

    prepareR();
    ScrollWindow(r, 15, 5, NULL, NULL);
    rAfter("ScrollWindow 15,5");

    prepareR();
    SetRect(&rect, 0, 0, 100, 80);
    ScrollWindow(r, 15, 5, &rect, NULL);
    rAfter("ScrollWindow 15,5 rect");

    prepareR();
    SetRect(&rect, 0, 0, 100, 80);
    ScrollWindowEx(r, 15, 5, &rect, NULL, NULL, NULL, SW_SCROLLCHILDREN | SW_INVALIDATE);
    rAfter("ScrollWindowEx 15,5 rect children");

    prepareR();
    ScrollWindowEx(r, 15, 5, NULL, NULL, NULL, NULL, SW_SCROLLCHILDREN);
    rAfter("ScrollWindowEx 15,5 children");

    prepareR();
    SetRect(&update, 1, 2, 3, 4);
    answer = ScrollWindowEx(r, 15, 5, NULL, NULL, rgn, &update, 0);
    answerAs("ScrollWindowEx 15,5 no children", answer, &update, rgn);
    rAfter("ScrollWindowEx 15,5 no children");

    /* The caret. */
    prepare();
    CreateCaret(p, NULL, 2, 6);
    SetCaretPos(5, 5);
    ScrollWindow(p, 20, 10, NULL, NULL);
    caretAs("ScrollWindow 20,10");
    SetRect(&rect, 50, 50, 120, 80);
    ScrollWindowEx(p, 20, 10, &rect, NULL, NULL, NULL, SW_SCROLLCHILDREN);
    caretAs("ScrollWindowEx rect clear of it");
    SetRect(&rect, 0, 0, 60, 40);
    ScrollWindowEx(p, -10, -5, &rect, NULL, NULL, NULL, SW_SCROLLCHILDREN);
    caretAs("ScrollWindowEx rect over it");
    ScrollWindowEx(p, -10, -5, NULL, NULL, NULL, NULL, 0);
    caretAs("ScrollWindowEx no children");
    DestroyCaret();

    DeleteObject(rgn);
    DestroyWindow(r);
    DestroyWindow(q);
    DestroyWindow(p);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
