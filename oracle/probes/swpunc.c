/*
 * SetWindowPos's copy of a moved window's bits and what it makes due of what
 * it uncovers (`USER.EXE` seg7 `0526`): the copy through the visible regions
 * as they were and are, and the rest made due through the parent of the
 * windows placed by USER's walk (seg1 `3ed7`), with RDW_ALLCHILDREN, or
 * RDW_NOCHILDREN where every window placed was shown (`visprobe.h`).
 *
 * Every window is of a class whose paint and erase draw nothing, so what
 * shows is what was copied or left; each is filled black or white through
 * its own context, in the order made, and then nothing is due. A case's
 * windows are made for it and destroyed after it.
 *
 * * `screen`: the case; where the screen is black over its windows, as
 *   bands, read as the call answers.
 * * `update`: the case and the window; `GetUpdateRgn`'s region, in its
 *   terms, as the call answers.
 * * `ncpaint` (with `wParam`), `erase`, `paint` (`BeginPaint`'s rectangle
 *   and `fErase`): the case and the window, in the order sent, from the
 *   call and then from the message loop after it, `step pump` between.
 *
 * The cases:
 *
 * * `sib`: R, a pop-up 240 by 140 at (40, 40), white, with children A at
 *   (10, 10), black, and B at (40, 20), white, each 60 by 40, made in that
 *   order and without WS_CLIPSIBLINGS; A moved to (120, 50). `sibc`: the
 *   same with WS_CLIPSIBLINGS.
 * * `par`: P, a pop-up 240 by 140 at (300, 40) without WS_CLIPCHILDREN,
 *   white; children C at (10, 10), 50 by 40, black, and S at (100, 60), 60
 *   by 50, white; C moved to (110, 40), over S. `parc`: P with
 *   WS_CLIPCHILDREN.
 * * `nocopy`: X, a pop-up 80 by 60 at (40, 250), black, and Y, 80 by 60 at
 *   (100, 270), white, over it; X moved to (60, 260) with SWP_NOCOPYBITS.
 *   `copy`: the same without.
 * * `defer2`: Q, a pop-up 240 by 140 at (300, 250) with WS_CLIPCHILDREN,
 *   white; children D1 at (10, 10) and D2 at (100, 10), 40 by 30, black,
 *   U at (20, 60), 120 by 50, white, and H1 at (30, 70) and H2 at (90, 70),
 *   40 by 30, hidden; none with WS_CLIPSIBLINGS. D1 and D2 moved down 50
 *   in one DeferWindowPos. `show2`: H1 and H2 shown in one. `showmove`: H1
 *   shown and D2 moved down 50 in one. `show1`: H1 shown by SetWindowPos.
 * * `pend`: Z, a pop-up 200 by 150 at (40, 40), white, and V, a pop-up
 *   with WS_BORDER 100 by 60 at (100, 100), black, over it; V due (10, 10)
 *   to (40, 30) and moved 30 right and 20 down. `pendall`: V due all over.
 * * `grand`: P3, a pop-up 240 by 140 at (40, 250), white, without
 *   WS_CLIPCHILDREN; its child K at (10, 10), 120 by 80, white; K's child G
 *   at (10, 10), 30 by 20, black; G moved to (100, 30), half out of K.
 *   `grandc`: K with WS_CLIPCHILDREN. `grandp`: P3 due (0, 0) to (60, 60)
 *   as G moves.
 * * `hide`: W, a pop-up 200 by 150 at (300, 40), white, T, 80 by 60 at
 *   (350, 90), black, over it; T hidden with SWP_HIDEWINDOW. `show`: T
 *   shown again with SWP_SHOWWINDOW.
 * * `hidec`: W2, a pop-up 200 by 150 at (300, 250) without
 *   WS_CLIPCHILDREN, white, with children SB at (20, 20), 100 by 60,
 *   white, and CH at (60, 40), 60 by 50, black, neither with
 *   WS_CLIPSIBLINGS; CH hidden. `showc`: CH shown.
 * * `nocopye`: X of a class erased white by DefWindowProc, alone, moved as
 *   in `nocopy`; `erasedc`: its erase's context's origin, clip box and
 *   visible region as it erases. `nocopyf`: the same with Y over it.
 * * `size`: N, a pop-up with WS_BORDER of a CS_HREDRAW | CS_VREDRAW class,
 *   100 by 60 at (100, 100), black, over Z; made 130 wide. `sizev`: made
 *   80 high. `sizep`: the same window of the plain class made 130 wide and
 *   80 high. `sizes`: the plain one made 70 by 40.
 */

#include "probe.h"
#include "visprobe.h"

#ifndef OUTPUT
#define OUTPUT "C:\\ORACLE\\SWPUNC.OUT"
#endif

#define MOVE (SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE)
#define SIZE (SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE)
#define SHOW (SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_SHOWWINDOW)
#define HIDE (SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_HIDEWINDOW)

#define MAXWIN 8

static HINSTANCE inst;
static HRGN rgn;
static BOOL noting;
static LPCSTR caseName = "";
static HWND wins[MAXWIN];
static BOOL black[MAXWIN];
static int count;
static int areaLeft, areaTop, areaRight, areaBottom;

static void nameOf(HWND hwnd, LPSTR out)
{
    char title[8];

    GetWindowText(hwnd, title, sizeof(title));
    wsprintf(out, "%s %s", caseName, (LPSTR)title);
}

LONG FAR PASCAL _export NoteProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_PAINT) {
        PAINTSTRUCT ps;

        BeginPaint(hwnd, &ps);

        if (noting) {
            nameOf(hwnd, probeArgs);
            wsprintf(probeResult, "%d,%d,%d,%d erase %d", ps.rcPaint.left, ps.rcPaint.top,
                     ps.rcPaint.right, ps.rcPaint.bottom, ps.fErase);
            probe("paint", probeArgs, probeResult);
        }

        EndPaint(hwnd, &ps);
        return 0;
    }

    if (message == WM_ERASEBKGND) {
        if (noting) {
            nameOf(hwnd, probeArgs);
            probe("erase", probeArgs, "sent");
        }

        /* The erasing class erases as DefWindowProc does, and says what
         * its context draws on first. */
        if (GetClassWord(hwnd, GCW_HBRBACKGROUND)) {
            if (noting) {
                nameOf(hwnd, probeArgs);
                dcText(probeResult, (HDC)wParam);
                probe("erasedc", probeArgs, probeResult);
            }

            return DefWindowProc(hwnd, message, wParam, lParam);
        }

        return 1;
    }

    if (message == WM_NCPAINT && noting) {
        nameOf(hwnd, probeArgs);
        wsprintf(probeResult, "%d", wParam == 1 ? 1 : 2);
        probe("ncpaint", probeArgs, probeResult);
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

static void registerClass(LPCSTR name, UINT style, HBRUSH brush)
{
    WNDCLASS kind;

    kind.style = style;
    kind.lpfnWndProc = NoteProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = inst;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = brush;
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

/* A case begun: its name and the part of the screen it reads. */
static void begin(LPCSTR name, int left, int top, int right, int bottom)
{
    caseName = name;
    count = 0;
    areaLeft = left;
    areaTop = top;
    areaRight = right;
    areaBottom = bottom;
}

static HWND make(LPCSTR kind, LPCSTR name, DWORD style, HWND parent, int x, int y, int width,
                 int height, BOOL dark)
{
    HWND made = CreateWindow(kind, name, style, x, y, width, height, parent, NULL, inst, NULL);

    wins[count] = made;
    black[count] = dark;
    count++;
    return made;
}

#define POPUP (WS_POPUP | WS_VISIBLE)
#define CHILD (WS_CHILD | WS_VISIBLE)

/* Every window of the case painted and filled, in the order made; nothing due. */
static void settle(void)
{
    int i;

    pump();

    for (i = 0; i < count; i++) {
        if (IsWindowVisible(wins[i])) {
            HDC dc = GetDC(wins[i]);
            RECT box;

            GetClientRect(wins[i], &box);
            PatBlt(dc, 0, 0, box.right, box.bottom, black[i] ? BLACKNESS : WHITENESS);
            ReleaseDC(wins[i], dc);
        }
    }

    for (i = 0; i < count; i++) {
        ValidateRect(wins[i], NULL);
    }

    noting = TRUE;
}

/* What the call left: the screen, each window's update region, then what the message loop paints. */
static void report(BOOL destroy)
{
    int i;

    noting = FALSE;
    blackText(probeResult, areaLeft, areaTop, areaRight, areaBottom);
    probe("screen", caseName, probeResult);

    for (i = 0; i < count; i++) {
        char title[8];

        GetWindowText(wins[i], title, sizeof(title));
        wsprintf(probeArgs, "%s %s", caseName, (LPSTR)title);
        GetUpdateRgn(wins[i], rgn, FALSE);
        regionText(probeResult, rgn);
        probe("update", probeArgs, probeResult);
    }

    probe("step", caseName, "pump");
    noting = TRUE;
    pump();
    noting = FALSE;

    if (!destroy) {
        return;
    }

    for (i = count - 1; i >= 0; i--) {
        if (IsWindow(wins[i]) && !GetParent(wins[i])) {
            DestroyWindow(wins[i]);
        }
    }

    pump();
}

static void finish(void)
{
    report(TRUE);
}

static void siblings(LPCSTR name, DWORD clip)
{
    HWND r, a;

    begin(name, 40, 40, 280, 180);
    r = make("SwpUncW", "R", POPUP, NULL, 40, 40, 240, 140, FALSE);
    a = make("SwpUncW", "A", CHILD | clip, r, 10, 10, 60, 40, TRUE);
    make("SwpUncW", "B", CHILD | clip, r, 40, 20, 60, 40, FALSE);
    settle();
    SetWindowPos(a, NULL, 120, 50, 0, 0, MOVE);
    finish();
}

static void parent(LPCSTR name, DWORD clip)
{
    HWND p, c;

    begin(name, 300, 40, 540, 180);
    p = make("SwpUncW", "P", POPUP | clip, NULL, 300, 40, 240, 140, FALSE);
    c = make("SwpUncW", "C", CHILD, p, 10, 10, 50, 40, TRUE);
    make("SwpUncW", "S", CHILD, p, 100, 60, 60, 50, FALSE);
    settle();
    SetWindowPos(c, NULL, 110, 40, 0, 0, MOVE);
    finish();
}

static void nocopy(LPCSTR name, UINT more)
{
    HWND x;

    begin(name, 40, 250, 180, 330);
    x = make("SwpUncW", "X", POPUP, NULL, 40, 250, 80, 60, TRUE);
    make("SwpUncW", "Y", POPUP, NULL, 100, 270, 80, 60, FALSE);
    settle();
    SetWindowPos(x, NULL, 60, 260, 0, 0, MOVE | more);
    finish();
}

static void nocopyErased(LPCSTR name, BOOL covered)
{
    HWND x;

    begin(name, 40, 250, 180, 330);
    x = make("SwpUncE", "X", POPUP, NULL, 40, 250, 80, 60, TRUE);

    if (covered) {
        make("SwpUncW", "Y", POPUP, NULL, 100, 270, 80, 60, FALSE);
    }

    settle();
    SetWindowPos(x, NULL, 60, 260, 0, 0, MOVE | SWP_NOCOPYBITS);
    finish();
}

static HWND d1, d2, h1, h2;

static void deferred(LPCSTR name)
{
    begin(name, 300, 250, 540, 390);
    make("SwpUncW", "Q", POPUP | WS_CLIPCHILDREN, NULL, 300, 250, 240, 140, FALSE);
    d1 = make("SwpUncW", "D1", CHILD, wins[0], 10, 10, 40, 30, TRUE);
    d2 = make("SwpUncW", "D2", CHILD, wins[0], 100, 10, 40, 30, TRUE);
    make("SwpUncW", "U", CHILD, wins[0], 20, 60, 120, 50, FALSE);
    h1 = make("SwpUncW", "H1", WS_CHILD, wins[0], 30, 70, 40, 30, TRUE);
    h2 = make("SwpUncW", "H2", WS_CHILD, wins[0], 90, 70, 40, 30, TRUE);
    settle();
}

static void pending(LPCSTR name, BOOL all)
{
    HWND v;
    RECT rect;

    begin(name, 40, 40, 240, 190);
    make("SwpUncW", "Z", POPUP, NULL, 40, 40, 200, 150, FALSE);
    v = make("SwpUncW", "V", POPUP | WS_BORDER, NULL, 100, 100, 100, 60, TRUE);
    settle();
    SetRect(&rect, 10, 10, 40, 30);
    InvalidateRect(v, all ? NULL : &rect, FALSE);
    SetWindowPos(v, NULL, 130, 120, 0, 0, MOVE);
    finish();
}

static void grand(LPCSTR name, DWORD clip, BOOL due)
{
    HWND p3, k, g;
    RECT rect;

    begin(name, 40, 250, 280, 390);
    p3 = make("SwpUncW", "P3", POPUP, NULL, 40, 250, 240, 140, FALSE);
    k = make("SwpUncW", "K", CHILD | clip, p3, 10, 10, 120, 80, FALSE);
    g = make("SwpUncW", "G", CHILD, k, 10, 10, 30, 20, TRUE);
    settle();

    if (due) {
        SetRect(&rect, 0, 0, 60, 60);
        InvalidateRect(p3, &rect, FALSE);
    }

    SetWindowPos(g, NULL, 100, 30, 0, 0, MOVE);
    finish();
    (void)k;
}

static void hideShow(LPCSTR name, LPCSTR again)
{
    HWND t;

    begin(name, 300, 40, 500, 190);
    make("SwpUncW", "W", POPUP, NULL, 300, 40, 200, 150, FALSE);
    t = make("SwpUncW", "T", POPUP, NULL, 350, 90, 80, 60, TRUE);
    settle();
    SetWindowPos(t, NULL, 0, 0, 0, 0, HIDE);
    report(FALSE);
    caseName = again;
    settle();
    SetWindowPos(t, NULL, 0, 0, 0, 0, SHOW);
    finish();
}

static void hideShowChild(LPCSTR name, LPCSTR again)
{
    HWND w2, ch;

    begin(name, 300, 250, 500, 400);
    w2 = make("SwpUncW", "W2", POPUP, NULL, 300, 250, 200, 150, FALSE);
    make("SwpUncW", "SB", CHILD, w2, 20, 20, 100, 60, FALSE);
    ch = make("SwpUncW", "CH", CHILD, w2, 60, 40, 60, 50, TRUE);
    settle();
    SetWindowPos(ch, NULL, 0, 0, 0, 0, HIDE);
    report(FALSE);
    caseName = again;
    settle();
    SetWindowPos(ch, NULL, 0, 0, 0, 0, SHOW);
    finish();
}

static void sized(LPCSTR name, LPCSTR kind, int width, int height)
{
    HWND n;

    begin(name, 40, 40, 240, 190);
    make("SwpUncW", "Z", POPUP, NULL, 40, 40, 200, 150, FALSE);
    n = make(kind, "N", POPUP | WS_BORDER, NULL, 100, 100, 100, 60, TRUE);
    settle();
    SetWindowPos(n, NULL, 0, 0, width, height, SIZE);
    finish();
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HDWP defer;

    inst = instance;
    probeOpen(OUTPUT);
    rgn = CreateRectRgn(0, 0, 0, 0);
    visImports();
    registerClass("SwpUncW", 0, NULL);
    registerClass("SwpUncR", CS_HREDRAW | CS_VREDRAW, NULL);
    registerClass("SwpUncE", 0, GetStockObject(WHITE_BRUSH));

    siblings("sib", 0);
    siblings("sibc", WS_CLIPSIBLINGS);
    parent("par", 0);
    parent("parc", WS_CLIPCHILDREN);
    nocopy("nocopy", SWP_NOCOPYBITS);
    nocopy("copy", 0);

    deferred("defer2");
    defer = BeginDeferWindowPos(2);
    defer = DeferWindowPos(defer, d1, NULL, 10, 60, 0, 0, MOVE);
    defer = DeferWindowPos(defer, d2, NULL, 100, 60, 0, 0, MOVE);
    EndDeferWindowPos(defer);
    finish();

    deferred("show2");
    defer = BeginDeferWindowPos(2);
    defer = DeferWindowPos(defer, h1, NULL, 0, 0, 0, 0, SHOW);
    defer = DeferWindowPos(defer, h2, NULL, 0, 0, 0, 0, SHOW);
    EndDeferWindowPos(defer);
    finish();

    deferred("showmove");
    defer = BeginDeferWindowPos(2);
    defer = DeferWindowPos(defer, h1, NULL, 0, 0, 0, 0, SHOW);
    defer = DeferWindowPos(defer, d2, NULL, 100, 60, 0, 0, MOVE);
    EndDeferWindowPos(defer);
    finish();

    deferred("show1");
    SetWindowPos(h1, NULL, 0, 0, 0, 0, SHOW);
    finish();

    pending("pend", FALSE);
    pending("pendall", TRUE);
    grand("grand", 0, FALSE);
    grand("grandc", WS_CLIPCHILDREN, FALSE);
    grand("grandp", 0, TRUE);
    hideShow("hide", "show");
    hideShowChild("hidec", "showc");
    sized("size", "SwpUncR", 130, 60);
    sized("sizev", "SwpUncR", 100, 80);
    sized("sizep", "SwpUncW", 130, 80);
    sized("sizes", "SwpUncW", 70, 40);
    nocopyErased("nocopye", FALSE);
    nocopyErased("nocopyf", TRUE);

    DeleteObject(rgn);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
