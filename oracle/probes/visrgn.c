/*
 * The visible region USER gives a window's device context, by the kind of
 * window and of context: `InquireVisRgn`'s region, its box and its pixels
 * (in the screen's terms), with `GetDCOrg` and `GetClipBox` beside it
 * (`visprobe.h`).
 *
 * The windows, on the VGA's 640 by 480:
 *
 * * P, overlapped, 300 by 200 at (40, 30), and in its client area:
 *   A, a child 80 by 60 at (10, 10); B, the same with `WS_CLIPSIBLINGS` at
 *   (100, 10); C, a child 80 by 60 at (60, 40) brought to the top of its
 *   siblings, over part of A and of B; D, 40 by 30 at (200, 100), of a class
 *   with `CS_PARENTDC`.
 * * P2, overlapped with `WS_CLIPCHILDREN`, 200 by 150 at (380, 30), and E, a
 *   child 50 by 40 at (10, 10) in it.
 * * Q, a pop-up 150 by 100 at (-30, 300), partly off the screen, and R, a
 *   pop-up 100 by 80 at (60, 350) over part of it.
 * * H, overlapped and never shown.
 * * O, a pop-up 150 by 100 at (400, 250) of a class with `CS_OWNDC`: its
 *   context got once, then asked again after O is moved, and after R is
 *   moved over it, without being got again.
 *
 * `kind`: each window's contexts. `paint`: P's context from `BeginPaint`,
 * a part of it invalidated. `own`: O's.
 */

#include "probe.h"
#include "visprobe.h"

#define OUTPUT "C:\\ORACLE\\VISRGN.OUT"

#define DCX_WINDOW 0x00000001L
#define DCX_CACHE 0x00000002L
#define DCX_CLIPCHILDREN 0x00000008L
#define DCX_CLIPSIBLINGS 0x00000010L
#define DCX_PARENTCLIP 0x00000020L

static HWND p;
static BOOL painting;

static void describe(LPCSTR function, LPCSTR what, HWND window, HDC dc)
{
    dcText(probeResult, dc);
    probe(function, what, probeResult);

    if (dc) {
        ReleaseDC(window, dc);
    }
}

LRESULT CALLBACK _export VisProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_PAINT && window == p && painting) {
        PAINTSTRUCT ps;

        BeginPaint(window, &ps);
        dcText(probeResult, ps.hdc);
        probe("paint", "BeginPaint", probeResult);
        wsprintf(probeResult, "%d,%d,%d,%d", ps.rcPaint.left, ps.rcPaint.top, ps.rcPaint.right,
                 ps.rcPaint.bottom);
        probe("paint", "rcPaint", probeResult);
        EndPaint(window, &ps);
        painting = FALSE;
        return 0;
    }

    return DefWindowProc(window, message, wParam, lParam);
}

static void registerClass(HINSTANCE instance, LPCSTR name, UINT style)
{
    WNDCLASS kind;

    kind.style = style;
    kind.lpfnWndProc = VisProc;
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

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HWND a, b, c, d, p2, e, q, r, h, o;
    HDC own;
    RECT rect;

    probeOpen(OUTPUT);
    visImports();

    registerClass(instance, "VisWin", 0);
    registerClass(instance, "VisParentDC", CS_PARENTDC);
    registerClass(instance, "VisOwnDC", CS_OWNDC);

    p = CreateWindow("VisWin", "P", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 40, 30, 300, 200, NULL,
                     NULL, instance, NULL);
    a = CreateWindow("VisWin", "", WS_CHILD | WS_VISIBLE, 10, 10, 80, 60, p, NULL, instance, NULL);
    b = CreateWindow("VisWin", "", WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS, 100, 10, 80, 60, p,
                     NULL, instance, NULL);
    c = CreateWindow("VisWin", "", WS_CHILD | WS_VISIBLE, 60, 40, 80, 60, p, NULL, instance, NULL);
    SetWindowPos(c, HWND_TOP, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    d = CreateWindow("VisParentDC", "", WS_CHILD | WS_VISIBLE, 200, 100, 40, 30, p, NULL, instance,
                     NULL);
    p2 = CreateWindow("VisWin", "P2", WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN | WS_VISIBLE, 380, 30,
                      200, 150, NULL, NULL, instance, NULL);
    e = CreateWindow("VisWin", "", WS_CHILD | WS_VISIBLE, 10, 10, 50, 40, p2, NULL, instance, NULL);
    q = CreateWindow("VisWin", "", WS_POPUP | WS_VISIBLE, -30, 300, 150, 100, NULL, NULL, instance,
                     NULL);
    r = CreateWindow("VisWin", "", WS_POPUP | WS_VISIBLE, 60, 350, 100, 80, NULL, NULL, instance,
                     NULL);
    h = CreateWindow("VisWin", "H", WS_OVERLAPPEDWINDOW, 100, 100, 100, 100, NULL, NULL, instance,
                     NULL);
    o = CreateWindow("VisOwnDC", "", WS_POPUP | WS_VISIBLE, 400, 250, 150, 100, NULL, NULL,
                     instance, NULL);
    UpdateWindow(p);
    UpdateWindow(p2);
    pump();

    wsprintf(probeResult, "A %x B %x C %x P %x", (int)((GetWindowLong(a, GWL_STYLE) >> 16) & 0xffff),
             (int)((GetWindowLong(b, GWL_STYLE) >> 16) & 0xffff),
             (int)((GetWindowLong(c, GWL_STYLE) >> 16) & 0xffff),
             (int)((GetWindowLong(p, GWL_STYLE) >> 16) & 0xffff));
    probe("style", "high words", probeResult);
    wsprintf(probeResult, "Q %x R %x O %x P2 %x", (int)((GetWindowLong(q, GWL_STYLE) >> 16) & 0xffff),
             (int)((GetWindowLong(r, GWL_STYLE) >> 16) & 0xffff),
             (int)((GetWindowLong(o, GWL_STYLE) >> 16) & 0xffff),
             (int)((GetWindowLong(p2, GWL_STYLE) >> 16) & 0xffff));
    probe("style", "high words, top", probeResult);

    describe("kind", "A GetDC", a, GetDC(a));
    describe("kind", "A GetWindowDC", a, GetWindowDC(a));
    describe("kind", "A CACHE CLIPSIBLINGS", a, pGetDCEx(a, NULL, DCX_CACHE | DCX_CLIPSIBLINGS));
    describe("kind", "A CACHE PARENTCLIP", a, pGetDCEx(a, NULL, DCX_CACHE | DCX_PARENTCLIP));
    describe("kind", "B GetDC", b, GetDC(b));
    describe("kind", "B GetWindowDC", b, GetWindowDC(b));
    describe("kind", "C GetDC", c, GetDC(c));
    describe("kind", "D GetDC (CS_PARENTDC)", d, GetDC(d));
    describe("kind", "D GetWindowDC (CS_PARENTDC)", d, GetWindowDC(d));
    describe("kind", "D CACHE", d, pGetDCEx(d, NULL, DCX_CACHE));
    describe("kind", "P GetDC", p, GetDC(p));
    describe("kind", "P GetWindowDC", p, GetWindowDC(p));
    describe("kind", "P CACHE CLIPCHILDREN", p, pGetDCEx(p, NULL, DCX_CACHE | DCX_CLIPCHILDREN));
    describe("kind", "P2 GetDC (CLIPCHILDREN)", p2, GetDC(p2));
    describe("kind", "P2 GetWindowDC (CLIPCHILDREN)", p2, GetWindowDC(p2));
    describe("kind", "P2 CACHE", p2, pGetDCEx(p2, NULL, DCX_CACHE));
    describe("kind", "E GetDC", e, GetDC(e));
    describe("kind", "Q GetDC", q, GetDC(q));
    describe("kind", "Q GetWindowDC", q, GetWindowDC(q));
    describe("kind", "R GetDC", r, GetDC(r));
    describe("kind", "H GetDC (hidden)", h, GetDC(h));
    describe("kind", "desktop GetDC(NULL)", NULL, GetDC(NULL));
    describe("kind", "desktop GetWindowDC(desktop)", GetDesktopWindow(),
             GetWindowDC(GetDesktopWindow()));

    {
        HDC memory = CreateCompatibleDC(NULL);
        HBITMAP bitmap = CreateCompatibleBitmap(memory, 30, 20);
        HBITMAP old;

        dcText(probeResult, memory);
        probe("kind", "memory, new", probeResult);
        old = SelectObject(memory, bitmap);
        dcText(probeResult, memory);
        probe("kind", "memory, 30 by 20", probeResult);
        SelectObject(memory, old);
        DeleteDC(memory);
        DeleteObject(bitmap);
    }

    SetRect(&rect, 20, 100, 60, 140);
    InvalidateRect(p, &rect, TRUE);
    SetRect(&rect, 200, 20, 260, 40);
    InvalidateRect(p, &rect, TRUE);
    painting = TRUE;
    UpdateWindow(p);

    own = GetDC(o);
    dcText(probeResult, own);
    probe("own", "got", probeResult);
    SetWindowPos(o, NULL, 420, 270, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
    dcText(probeResult, own);
    probe("own", "after O moved", probeResult);
    SetWindowPos(r, HWND_TOP, 380, 300, 0, 0, SWP_NOSIZE | SWP_NOACTIVATE);
    dcText(probeResult, own);
    probe("own", "after R moved over it", probeResult);
    ShowWindow(r, SW_HIDE);
    dcText(probeResult, own);
    probe("own", "after R hidden", probeResult);
    ReleaseDC(o, own);
    describe("own", "got again", o, GetDC(o));

    DestroyWindow(o);
    DestroyWindow(h);
    DestroyWindow(r);
    DestroyWindow(q);
    DestroyWindow(p2);
    DestroyWindow(p);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
