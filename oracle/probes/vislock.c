/*
 * LockWindowUpdate and the visible region: what the locked window's
 * contexts have, what drawing on it and on other windows while it is locked
 * leaves due when it is unlocked, and what was due before it was locked
 * (`visprobe.h`).
 *
 * C is a pop-up 100 by 60 at (40, 150); A, over it, a pop-up 120 by 80 at
 * (100, 100) with a child K at (10, 10), 30 by 20; B, over A, a pop-up 80
 * by 60 at (180, 140). All white, of a class whose paint draws nothing but
 * whose background is erased, and A's paint notes its rectangle and clip
 * box. Each case starts with every window painted and nothing due.
 *
 * * `lock`: the case and the call; what it answered.
 * * `dc`: the case and the context; its origin, clip box and visible
 *   region.
 * * `update`: the case and the window; its update region in its terms.
 * * `screen`: the case; where the screen is black from (30, 90) to
 *   (270, 220).
 * * `paint`: the case; A's `BeginPaint` rectangle and clip box.
 * * `painting`: as `update`, for the case of A painted while it is locked.
 */

#include "probe.h"
#include "visprobe.h"

#define OUTPUT "C:\\ORACLE\\VISLOCK.OUT"

#define DCX_CACHE 0x00000002L
#define DCX_LOCKWINDOWUPDATE 0x00000400L

static HWND a;
static HWND b;
static HWND c;
static HWND k;
static HRGN rgn;
static BOOL noting;
static LPCSTR updateFunction = "update";

LONG FAR PASCAL _export NoteProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_PAINT && noting) {
        PAINTSTRUCT ps;
        RECT box;
        int kind;

        BeginPaint(hwnd, &ps);
        kind = GetClipBox(ps.hdc, &box);
        wsprintf(probeResult, "%d,%d,%d,%d clip %d %d,%d,%d,%d", ps.rcPaint.left, ps.rcPaint.top,
                 ps.rcPaint.right, ps.rcPaint.bottom, kind, box.left, box.top, box.right,
                 box.bottom);
        probe("paint", "A", probeResult);
        EndPaint(hwnd, &ps);
        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

static void registerClass(HINSTANCE instance, LPCSTR name, WNDPROC proc)
{
    WNDCLASS kind;

    kind.style = 0;
    kind.lpfnWndProc = proc;
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
    UpdateWindow(c);
    UpdateWindow(a);
    UpdateWindow(k);
    UpdateWindow(b);
    pump();
}

static void answer(LPCSTR name, LPCSTR call, long value)
{
    wsprintf(probeArgs, "%s %s", name, call);
    wsprintf(probeResult, "%ld", value);
    probe("lock", probeArgs, probeResult);
}

static void dcAs(LPCSTR name, LPCSTR which, HDC dc)
{
    wsprintf(probeArgs, "%s %s", name, which);
    dcText(probeResult, dc);
    probe("dc", probeArgs, probeResult);
}

static void updateAs(LPCSTR name, LPCSTR which, HWND window)
{
    wsprintf(probeArgs, "%s %s", name, which);
    GetUpdateRgn(window, rgn, FALSE);
    regionText(probeResult, rgn);
    probe(updateFunction, probeArgs, probeResult);
}

static void updates(LPCSTR name)
{
    updateAs(name, "A", a);
    updateAs(name, "K", k);
    updateAs(name, "B", b);
    updateAs(name, "C", c);
}

static void screenAs(LPCSTR name)
{
    blackText(probeResult, 30, 90, 270, 220);
    probe("screen", name, probeResult);
}

static void fill(HWND window, int left, int top, int right, int bottom)
{
    HDC dc = GetDC(window);

    PatBlt(dc, left, top, right - left, bottom - top, BLACKNESS);
    ReleaseDC(window, dc);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HDC dc;
    RECT rect;

    probeOpen(OUTPUT);
    visImports();
    rgn = CreateRectRgn(0, 0, 0, 0);

    registerClass(instance, "VisLockW", DefWindowProc);
    registerClass(instance, "VisLockA", NoteProc);

    c = CreateWindow("VisLockW", "", WS_POPUP | WS_VISIBLE, 40, 150, 100, 60, NULL, NULL, instance,
                     NULL);
    a = CreateWindow("VisLockA", "", WS_POPUP | WS_VISIBLE, 100, 100, 120, 80, NULL, NULL,
                     instance, NULL);
    k = CreateWindow("VisLockW", "", WS_CHILD | WS_VISIBLE, 10, 10, 30, 20, a, NULL, instance,
                     NULL);
    b = CreateWindow("VisLockW", "", WS_POPUP | WS_VISIBLE, 180, 140, 80, 60, NULL, NULL,
                     instance, NULL);
    settle();

    /* What was due as it was locked. */
    SetRect(&rect, 50, 0, 80, 30);
    InvalidateRect(a, &rect, TRUE);
    SetRect(&rect, 0, 0, 30, 20);
    InvalidateRect(c, &rect, TRUE);
    answer("pending", "lock", LockWindowUpdate(a));
    updates("pending locked");
    answer("pending", "unlock", LockWindowUpdate(NULL));
    updates("pending unlocked");
    settle();

    /* The locked window's contexts, and drawing through them. */
    answer("draw", "lock", LockWindowUpdate(a));
    dc = GetDC(a);
    dcAs("draw", "GetDC", dc);
    PatBlt(dc, 40, 20, 20, 20, BLACKNESS);
    ReleaseDC(a, dc);
    dc = GetWindowDC(a);
    dcAs("draw", "GetWindowDC", dc);
    ReleaseDC(a, dc);
    dc = pGetDCEx(a, NULL, DCX_CACHE | DCX_LOCKWINDOWUPDATE);
    dcAs("draw", "GetDCEx lock", dc);
    PatBlt(dc, 70, 10, 10, 10, BLACKNESS);
    ReleaseDC(a, dc);
    dc = GetDC(k);
    dcAs("draw", "GetDC K", dc);
    ReleaseDC(k, dc);
    screenAs("draw locked");
    updates("draw locked");
    answer("draw", "unlock", LockWindowUpdate(NULL));
    updates("draw unlocked");
    screenAs("draw unlocked");
    settle();
    screenAs("draw painted");

    /* A child of the locked window drawn on. */
    LockWindowUpdate(a);
    fill(k, 0, 0, 10, 10);
    LockWindowUpdate(NULL);
    updates("child");
    settle();

    /* A window over it and a window under it drawn on where they meet it. */
    LockWindowUpdate(a);
    fill(b, 0, 0, 20, 20);
    LockWindowUpdate(NULL);
    updates("above");
    screenAs("above");
    settle();

    LockWindowUpdate(a);
    fill(c, 40, 0, 90, 30);
    LockWindowUpdate(NULL);
    updates("below");
    screenAs("below");
    settle();

    /* All of it drawn on. */
    LockWindowUpdate(a);
    dc = GetWindowDC(a);
    PatBlt(dc, 0, 0, 120, 80, BLACKNESS);
    ReleaseDC(a, dc);
    LockWindowUpdate(NULL);
    updates("whole");
    settle();

    /* Painted while it is locked: written as `painting`. */
    updateFunction = "painting";
    LockWindowUpdate(a);
    InvalidateRect(a, NULL, TRUE);
    updates("paint locked");
    noting = TRUE;
    UpdateWindow(a);
    noting = FALSE;
    updates("paint painted");
    LockWindowUpdate(NULL);
    updates("paint unlocked");
    settle();

    DeleteObject(rgn);
    DestroyWindow(b);
    DestroyWindow(a);
    DestroyWindow(c);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
