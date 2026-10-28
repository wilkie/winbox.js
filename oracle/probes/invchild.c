/*
 * InvalidateRect and InvalidateRgn of a parent, and what its children are
 * then due; BeginPaint's rectangle; UpdateWindow painting the windows in a
 * window (`visprobe.h`).
 *
 * P is a pop-up 200 by 120 at (100, 100) without WS_CLIPCHILDREN. In it: K,
 * a child at (10, 10), 60 by 40, with a child of its own, G, at (5, 5), 20
 * by 15; D, a child of a CS_PARENTDC class, at (100, 10), 60 by 40; and E,
 * at (170, 90), 60 by 50, reaching out of P. Q is a pop-up the same size at
 * (340, 100) with WS_CLIPCHILDREN, with L at (10, 10) and M, of the
 * CS_PARENTDC class, at (100, 10), each 60 by 40. R, a pop-up 50 by 50 at
 * (140, 130), lies over P and part of K. H is a pop-up at (300, 300), 50 by
 * 50, hidden, with a child HK at (5, 5), 20 by 20. Every window is white,
 * and each case starts with every window painted and nothing due.
 *
 * * `update`: the case and the window; `GetUpdateRgn`'s region, in its
 *   terms.
 * * `rect`: the case and the window; `GetUpdateRect`'s answer and box.
 * * `paint`: the case and the window painted, in order; `BeginPaint`'s
 *   rectangle, `fErase`, and its context's clip box.
 * * `erase`: the case and the window sent `WM_ERASEBKGND`, in order.
 * * `ncpaint`: the case and the window sent `WM_NCPAINT`, in order.
 *
 * The cases:
 *
 * * `rect`: InvalidateRect of P's (0, 0)-(130, 60), not to erase; painted by
 *   UpdateWindow of P.
 * * `null`: InvalidateRect of all of P, to erase; UpdateWindow of P.
 * * `rgn`: InvalidateRgn of P's (20, 20)-(40, 40) and (180, 100)-(200,
 *   120), not to erase; painted by the message loop.
 * * `clip`: InvalidateRect of all of Q; UpdateWindow of Q.
 * * `validated`: InvalidateRect of all of P, then ValidateRect of all of K;
 *   UpdateWindow of P.
 * * `validate`: InvalidateRect of all of K and of P's (150, 0)-(200, 60),
 *   then ValidateRect of all of P.
 * * `hidden`: InvalidateRect of all of H and of HK, then H shown and
 *   painted by the message loop.
 * * `covered`: InvalidateRect of all of K, R over part of it; UpdateWindow
 *   of K.
 * * `under`: InvalidateRect of all of K with a pop-up T over all of it;
 *   UpdateWindow of K.
 * * `child`: InvalidateRect of K's (0, 0)-(10, 10), to erase; UpdateWindow
 *   of K.
 */

#include "probe.h"
#include "visprobe.h"

#define OUTPUT "C:\\ORACLE\\INVCHILD.OUT"

static HWND p;
static HWND k;
static HWND g;
static HWND d;
static HWND e;
static HWND q;
static HWND l;
static HWND m;
static HWND r;
static HWND h;
static HWND hk;
static HRGN rgn;
static BOOL noting;
static LPCSTR caseName = "";

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
        RECT box;
        int kind;

        BeginPaint(hwnd, &ps);
        kind = GetClipBox(ps.hdc, &box);

        if (noting) {
            nameOf(hwnd, probeArgs);
            wsprintf(probeResult, "%d,%d,%d,%d erase %d clip %d %d,%d,%d,%d", ps.rcPaint.left,
                     ps.rcPaint.top, ps.rcPaint.right, ps.rcPaint.bottom, ps.fErase, kind,
                     box.left, box.top, box.right, box.bottom);
            probe("paint", probeArgs, probeResult);
        }

        EndPaint(hwnd, &ps);
        return 0;
    }

    if (message == WM_ERASEBKGND && noting) {
        nameOf(hwnd, probeArgs);
        probe("erase", probeArgs, "sent");
    }

    if (message == WM_NCPAINT && noting) {
        nameOf(hwnd, probeArgs);
        probe("ncpaint", probeArgs, "sent");
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

static void registerClass(HINSTANCE instance, LPCSTR name, UINT style)
{
    WNDCLASS kind;

    kind.style = style;
    kind.lpfnWndProc = NoteProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
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
    UpdateWindow(r);
    pump();
}

static void updateAs(LPCSTR which, HWND window)
{
    RECT box;
    BOOL any;

    wsprintf(probeArgs, "%s %s", caseName, which);
    GetUpdateRgn(window, rgn, FALSE);
    regionText(probeResult, rgn);
    probe("update", probeArgs, probeResult);
    any = GetUpdateRect(window, &box, FALSE);
    wsprintf(probeResult, "%d %d,%d,%d,%d", any, box.left, box.top, box.right, box.bottom);
    probe("rect", probeArgs, probeResult);
}

static void updatesP(void)
{
    updateAs("P", p);
    updateAs("K", k);
    updateAs("G", g);
    updateAs("D", d);
    updateAs("E", e);
}

static void updatesQ(void)
{
    updateAs("Q", q);
    updateAs("L", l);
    updateAs("M", m);
}

static void paintNow(HWND window)
{
    noting = TRUE;
    UpdateWindow(window);
    noting = FALSE;
}

static void paintByLoop(void)
{
    noting = TRUE;
    pump();
    noting = FALSE;
}

static HWND child(HINSTANCE instance, LPCSTR kind, LPCSTR name, HWND parent, int x, int y,
                  int width, int height)
{
    return CreateWindow(kind, name, WS_CHILD | WS_VISIBLE, x, y, width, height, parent, NULL,
                        instance, NULL);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    RECT rect;
    HRGN two;
    HRGN part;
    HWND t;

    probeOpen(OUTPUT);
    visImports();
    rgn = CreateRectRgn(0, 0, 0, 0);

    registerClass(instance, "InvChildW", 0);
    registerClass(instance, "InvChildP", CS_PARENTDC);

    p = CreateWindow("InvChildW", "P", WS_POPUP | WS_VISIBLE, 100, 100, 200, 120, NULL, NULL,
                     instance, NULL);
    k = child(instance, "InvChildW", "K", p, 10, 10, 60, 40);
    g = child(instance, "InvChildW", "G", k, 5, 5, 20, 15);
    d = child(instance, "InvChildP", "D", p, 100, 10, 60, 40);
    e = child(instance, "InvChildW", "E", p, 170, 90, 60, 50);
    q = CreateWindow("InvChildW", "Q", WS_POPUP | WS_VISIBLE | WS_CLIPCHILDREN, 340, 100, 200,
                     120, NULL, NULL, instance, NULL);
    l = child(instance, "InvChildW", "L", q, 10, 10, 60, 40);
    m = child(instance, "InvChildP", "M", q, 100, 10, 60, 40);
    r = CreateWindow("InvChildW", "R", WS_POPUP | WS_VISIBLE, 140, 130, 50, 50, NULL, NULL,
                     instance, NULL);
    h = CreateWindow("InvChildW", "H", WS_POPUP, 300, 300, 50, 50, NULL, NULL, instance, NULL);
    hk = child(instance, "InvChildW", "HK", h, 5, 5, 20, 20);
    settle();

    caseName = "rect";
    SetRect(&rect, 0, 0, 130, 60);
    InvalidateRect(p, &rect, FALSE);
    updatesP();
    paintNow(p);
    caseName = "rect painted";
    updatesP();
    settle();

    caseName = "null";
    InvalidateRect(p, NULL, TRUE);
    updatesP();
    paintNow(p);
    caseName = "null painted";
    updatesP();
    settle();

    caseName = "rgn";
    two = CreateRectRgn(20, 20, 40, 40);
    part = CreateRectRgn(180, 100, 200, 120);
    CombineRgn(two, two, part, RGN_OR);
    InvalidateRgn(p, two, FALSE);
    DeleteObject(part);
    DeleteObject(two);
    updatesP();
    paintByLoop();
    caseName = "rgn painted";
    updatesP();
    settle();

    caseName = "clip";
    InvalidateRect(q, NULL, FALSE);
    updatesQ();
    paintNow(q);
    caseName = "clip painted";
    updatesQ();
    settle();

    caseName = "validated";
    InvalidateRect(p, NULL, FALSE);
    ValidateRect(k, NULL);
    updatesP();
    paintNow(p);
    caseName = "validated painted";
    updatesP();
    settle();

    caseName = "validate";
    InvalidateRect(k, NULL, FALSE);
    SetRect(&rect, 150, 0, 200, 60);
    InvalidateRect(p, &rect, FALSE);
    ValidateRect(p, NULL);
    updatesP();
    paintByLoop();
    settle();

    caseName = "hidden";
    InvalidateRect(h, NULL, TRUE);
    InvalidateRect(hk, NULL, TRUE);
    updateAs("H", h);
    updateAs("HK", hk);
    noting = TRUE;
    ShowWindow(h, SW_SHOWNA);
    pump();
    noting = FALSE;
    caseName = "hidden shown";
    updateAs("H", h);
    updateAs("HK", hk);
    ShowWindow(h, SW_HIDE);
    settle();

    caseName = "covered";
    InvalidateRect(k, NULL, TRUE);
    updatesP();
    paintNow(k);
    settle();

    caseName = "under";
    t = CreateWindow("InvChildW", "T", WS_POPUP | WS_VISIBLE, 105, 105, 70, 50, NULL, NULL,
                     instance, NULL);
    UpdateWindow(t);
    pump();
    InvalidateRect(k, NULL, TRUE);
    updatesP();
    paintNow(k);
    caseName = "under painted";
    updatesP();
    DestroyWindow(t);
    settle();

    caseName = "child";
    SetRect(&rect, 0, 0, 10, 10);
    InvalidateRect(k, &rect, TRUE);
    updatesP();
    paintNow(k);
    settle();

    DeleteObject(rgn);
    DestroyWindow(h);
    DestroyWindow(r);
    DestroyWindow(q);
    DestroyWindow(p);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
