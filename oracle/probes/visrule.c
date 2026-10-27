/*
 * The corners of USER's rule for a window's visible region (`USER.EXE` seg1
 * `1582`, `1612`, `16f2`, `1c5f`, `1c12`; `GetDCEx` seg1 `847b`-`87b7`)
 * that `visrgn` does not reach: `InquireVisRgn`'s region, its box and its
 * pixels, with `GetDCOrg` and `GetClipBox` (`visprobe.h`).
 *
 * The windows, on the VGA's 640 by 480:
 *
 * * P, overlapped with `WS_CLIPCHILDREN`, 400 by 300 at (20, 20). In it:
 *   K, a child with `WS_CLIPCHILDREN`, 200 by 150 at (10, 10), holding
 *   G1, 60 by 40 at (20, 20); GT, the same with `WS_EX_TRANSPARENT` at
 *   (100, 20); GS, 80 by 40 at (60, 30) with `WS_CLIPSIBLINGS`, under
 *   both; and KK, 100 by 60 at (20, 80) with `WS_CLIPCHILDREN`, holding
 *   KKK, 30 by 20 at (10, 10). And three siblings, the first lowest: S1,
 *   100 by 80 at (220, 10); S2 with `WS_CLIPSIBLINGS`, at (260, 40); S3,
 *   80 by 60 at (300, 70); S1C, 60 by 50 at (30, 20) in S1, and S2C the
 *   same in S2.
 * * Q, overlapped, 200 by 150 at (430, 20): QA, 50 by 40 at (10, 10), and
 *   QH, hidden, at (70, 10).
 * * M, overlapped of a class with an icon, minimized, with a child MC; N,
 *   of a class without one, minimized.
 * * HP, overlapped and hidden, with HC, a child shown.
 * * T1, overlapped, 200 by 150 at (430, 200), and T2, a pop-up 100 by 80
 *   at (500, 250) over it.
 * * L, overlapped, 180 by 100 at (240, 330), with LC, 60 by 40 at (10, 10),
 *   locked by `LockWindowUpdate`.
 *
 * `children`: `WS_CLIPCHILDREN` at each depth, transparent children.
 * `siblings`: siblings at each level up. `parentclip`: when
 * `DCX_PARENTCLIP` is not taken. `minimized`, `hidden`, `top`, `lock`,
 * `given`: a minimized or hidden window or ancestor, a window at the top
 * without `DCX_CLIPSIBLINGS`, the lock, `DCX_EXCLUDERGN` and
 * `DCX_INTERSECTRGN` given 1.
 */

#include "probe.h"
#include "visprobe.h"

#define OUTPUT "C:\\ORACLE\\VISRULE.OUT"

#define DCX_WINDOW 0x00000001L
#define DCX_CACHE 0x00000002L
#define DCX_CLIPCHILDREN 0x00000008L
#define DCX_CLIPSIBLINGS 0x00000010L
#define DCX_PARENTCLIP 0x00000020L
#define DCX_EXCLUDERGN 0x00000040L
#define DCX_INTERSECTRGN 0x00000080L
#define DCX_LOCKWINDOWUPDATE 0x00000400L

#ifndef WS_EX_TRANSPARENT
#define WS_EX_TRANSPARENT 0x00000020L
#endif

static void describe(LPCSTR function, LPCSTR what, HWND window, HDC dc)
{
    dcText(probeResult, dc);
    probe(function, what, probeResult);

    if (dc) {
        ReleaseDC(window, dc);
    }
}

static void registerClass(HINSTANCE instance, LPCSTR name, HICON icon)
{
    WNDCLASS kind;

    kind.style = 0;
    kind.lpfnWndProc = DefWindowProc;
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

static HWND child(HINSTANCE instance, HWND parent, DWORD style, int x, int y, int w, int h)
{
    return CreateWindow("VisRule", "", WS_CHILD | WS_VISIBLE | style, x, y, w, h, parent, NULL,
                        instance, NULL);
}

static void top(HWND window)
{
    SetWindowPos(window, HWND_TOP, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
}

static void pump(void)
{
    MSG msg;

    while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
        DispatchMessage(&msg);
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HWND p, k, g1, gt, gs, kk, kkk, s1, s2, s3, s1c, s2c;
    HWND q, qa, qh, m, mc, n, hp, hc, t1, t2, l, lc;

    probeOpen(OUTPUT);
    visImports();

    registerClass(instance, "VisRule", NULL);
    registerClass(instance, "VisRuleIcon", LoadIcon(NULL, IDI_APPLICATION));

    p = CreateWindow("VisRule", "P", WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN | WS_VISIBLE, 20, 20, 400,
                     300, NULL, NULL, instance, NULL);
    k = child(instance, p, WS_CLIPCHILDREN, 10, 10, 200, 150);
    gs = child(instance, k, WS_CLIPSIBLINGS, 60, 30, 80, 40);
    g1 = child(instance, k, 0, 20, 20, 60, 40);
    gt = CreateWindowEx(WS_EX_TRANSPARENT, "VisRule", "", WS_CHILD | WS_VISIBLE, 100, 20, 60, 40, k,
                        NULL, instance, NULL);
    kk = child(instance, k, WS_CLIPCHILDREN, 20, 80, 100, 60);
    kkk = child(instance, kk, 0, 10, 10, 30, 20);
    top(g1);
    top(gt);
    s1 = child(instance, p, 0, 220, 10, 100, 80);
    s2 = child(instance, p, WS_CLIPSIBLINGS, 260, 40, 100, 80);
    s3 = child(instance, p, 0, 300, 70, 80, 60);
    s1c = child(instance, s1, 0, 30, 20, 60, 50);
    s2c = child(instance, s2, 0, 30, 20, 60, 50);
    top(s1);
    top(s2);
    top(s3);

    q = CreateWindow("VisRule", "Q", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 430, 20, 200, 150, NULL, NULL,
                     instance, NULL);
    qa = child(instance, q, 0, 10, 10, 50, 40);
    qh = CreateWindow("VisRule", "", WS_CHILD, 70, 10, 50, 40, q, NULL, instance, NULL);

    m = CreateWindow("VisRuleIcon", "M", WS_OVERLAPPEDWINDOW, 100, 100, 150, 100, NULL, NULL,
                     instance, NULL);
    mc = child(instance, m, 0, 10, 10, 40, 30);
    ShowWindow(m, SW_SHOWMINNOACTIVE);
    n = CreateWindow("VisRule", "N", WS_OVERLAPPEDWINDOW, 120, 120, 150, 100, NULL, NULL, instance,
                     NULL);
    ShowWindow(n, SW_SHOWMINNOACTIVE);

    hp = CreateWindow("VisRule", "HP", WS_OVERLAPPEDWINDOW, 100, 350, 100, 80, NULL, NULL, instance,
                      NULL);
    hc = child(instance, hp, 0, 10, 10, 40, 30);

    t1 = CreateWindow("VisRule", "T1", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 430, 200, 200, 150, NULL,
                      NULL, instance, NULL);
    t2 = CreateWindow("VisRule", "", WS_POPUP | WS_VISIBLE, 500, 250, 100, 80, NULL, NULL, instance,
                      NULL);

    l = CreateWindow("VisRule", "L", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 240, 330, 180, 100, NULL, NULL,
                     instance, NULL);
    lc = child(instance, l, 0, 10, 10, 60, 40);

    UpdateWindow(p);
    UpdateWindow(q);
    UpdateWindow(t1);
    UpdateWindow(l);
    pump();

    describe("children", "P GetDC (CLIPCHILDREN)", p, GetDC(p));
    describe("children", "K GetDC (CLIPCHILDREN, GT transparent)", k, GetDC(k));
    describe("children", "K CACHE", k, pGetDCEx(k, NULL, DCX_CACHE));
    describe("children", "KK GetDC (CLIPCHILDREN)", kk, GetDC(kk));
    describe("children", "KK GetWindowDC", kk, GetWindowDC(kk));
    describe("children", "KKK GetDC", kkk, GetDC(kkk));
    describe("children", "GS GetDC (CLIPSIBLINGS, under G1 and GT)", gs, GetDC(gs));
    describe("children", "G1 GetDC", g1, GetDC(g1));

    describe("siblings", "S1C GetDC (S1 without CLIPSIBLINGS)", s1c, GetDC(s1c));
    describe("siblings", "S2C GetDC (S2 with CLIPSIBLINGS)", s2c, GetDC(s2c));
    describe("siblings", "S2C CACHE CLIPSIBLINGS", s2c, pGetDCEx(s2c, NULL, DCX_CACHE | DCX_CLIPSIBLINGS));
    describe("siblings", "S2 GetDC", s2, GetDC(s2));
    describe("siblings", "S2 GetWindowDC", s2, GetWindowDC(s2));
    describe("siblings", "S2 CACHE", s2, pGetDCEx(s2, NULL, DCX_CACHE));
    describe("siblings", "S1 GetDC", s1, GetDC(s1));

    describe("parentclip", "G1 CACHE PARENTCLIP (K CLIPCHILDREN)", g1,
             pGetDCEx(g1, NULL, DCX_CACHE | DCX_PARENTCLIP));
    describe("parentclip", "QA CACHE PARENTCLIP", qa, pGetDCEx(qa, NULL, DCX_CACHE | DCX_PARENTCLIP));
    describe("parentclip", "QA CACHE PARENTCLIP CLIPSIBLINGS", qa,
             pGetDCEx(qa, NULL, DCX_CACHE | DCX_PARENTCLIP | DCX_CLIPSIBLINGS));
    describe("parentclip", "QA CACHE PARENTCLIP CLIPCHILDREN", qa,
             pGetDCEx(qa, NULL, DCX_CACHE | DCX_PARENTCLIP | DCX_CLIPCHILDREN));
    describe("parentclip", "QH CACHE PARENTCLIP (hidden)", qh,
             pGetDCEx(qh, NULL, DCX_CACHE | DCX_PARENTCLIP));
    describe("parentclip", "QA WINDOW CACHE PARENTCLIP", qa,
             pGetDCEx(qa, NULL, DCX_WINDOW | DCX_CACHE | DCX_PARENTCLIP));

    describe("minimized", "M GetDC (icon)", m, GetDC(m));
    describe("minimized", "M CACHE (icon)", m, pGetDCEx(m, NULL, DCX_CACHE));
    describe("minimized", "M GetWindowDC (icon)", m, GetWindowDC(m));
    describe("minimized", "MC GetDC (minimized parent)", mc, GetDC(mc));
    describe("minimized", "MC GetWindowDC (minimized parent)", mc, GetWindowDC(mc));
    describe("minimized", "N GetWindowDC (no icon)", n, GetWindowDC(n));

    describe("hidden", "HC GetDC (hidden parent)", hc, GetDC(hc));
    describe("hidden", "HC GetWindowDC (hidden parent)", hc, GetWindowDC(hc));
    describe("hidden", "QH GetDC", qh, GetDC(qh));

    describe("top", "T1 GetDC", t1, GetDC(t1));
    describe("top", "T1 CACHE (no CLIPSIBLINGS)", t1, pGetDCEx(t1, NULL, DCX_CACHE));
    describe("top", "T1 WINDOW CACHE (no CLIPSIBLINGS)", t1, pGetDCEx(t1, NULL, DCX_WINDOW | DCX_CACHE));
    describe("top", "T2 GetDC", t2, GetDC(t2));

    describe("given", "Q CACHE EXCLUDERGN 1", q, pGetDCEx(q, (HRGN)1, DCX_CACHE | DCX_EXCLUDERGN));
    describe("given", "Q CACHE INTERSECTRGN 1", q, pGetDCEx(q, (HRGN)1, DCX_CACHE | DCX_INTERSECTRGN));

    LockWindowUpdate(l);
    describe("lock", "LC GetDC (L locked)", lc, GetDC(lc));
    describe("lock", "L GetWindowDC (locked)", l, GetWindowDC(l));
    describe("lock", "L CACHE LOCKWINDOWUPDATE", l, pGetDCEx(l, NULL, DCX_CACHE | DCX_LOCKWINDOWUPDATE));
    describe("lock", "LC CACHE LOCKWINDOWUPDATE", lc,
             pGetDCEx(lc, NULL, DCX_CACHE | DCX_LOCKWINDOWUPDATE));
    describe("lock", "Q GetDC (another)", q, GetDC(q));
    LockWindowUpdate(NULL);
    describe("lock", "LC GetDC (unlocked)", lc, GetDC(lc));

    DestroyWindow(l);
    DestroyWindow(t2);
    DestroyWindow(t1);
    DestroyWindow(hp);
    DestroyWindow(n);
    DestroyWindow(m);
    DestroyWindow(q);
    DestroyWindow(p);
    probeFinish();

    (void)kkk;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
