/*
 * SetWindowPos copying a window's bits through the visible region: what of
 * a moved window comes with it when another window covers part of it, when
 * its parent or its child has something due, and when a sibling without
 * `WS_CLIPSIBLINGS` lies over it (`visprobe.h`).
 *
 * Every window is of a class whose paint draws nothing and whose
 * background is not erased, so what shows is what was copied or left; each
 * is filled through its own context. No message is dispatched between a
 * move and what is read.
 *
 * * `covered`: A, a pop-up 100 by 60 at (100, 250), black; B, a pop-up 80
 *   by 60 at (150, 270), white, over it. A moved 20 right and 10 down.
 * * `parentdue`: P, a pop-up 160 by 100 at (100, 100), white, without
 *   `WS_CLIPCHILDREN`; its child K at (10, 10), 30 by 20, black. P is due
 *   (70, 10) to (100, 40), and K is moved to (60, 10).
 * * `childdue`: K at (10, 10) again, white, with a child G at (5, 5), 10
 *   by 10, black and due all over; K moved to (60, 50).
 * * `siblings`: R, a pop-up 160 by 100 at (300, 100), white; its children
 *   L at (10, 10) and T at (30, 20), 40 by 30, neither with
 *   `WS_CLIPSIBLINGS`, L white and then T black, drawn over L. L moved to
 *   (100, 50).
 *
 * For each, `screen`: where the screen is black over the windows, as
 * bands; and `update`: each window's update region in its terms.
 */

#include "probe.h"
#include "visprobe.h"

#define OUTPUT "C:\\ORACLE\\VISMOVE.OUT"

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

static void registerClass(HINSTANCE instance, LPCSTR name)
{
    WNDCLASS kind;

    kind.style = 0;
    kind.lpfnWndProc = PlainProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = NULL;
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

static void fill(HWND window, DWORD rop)
{
    HDC dc = GetDC(window);
    RECT box;

    GetClientRect(window, &box);
    PatBlt(dc, 0, 0, box.right, box.bottom, rop);
    ReleaseDC(window, dc);
}

static void updateAs(LPCSTR name, LPCSTR which, HWND window)
{
    wsprintf(probeArgs, "%s %s", name, which);
    GetUpdateRgn(window, rgn, FALSE);
    regionText(probeResult, rgn);
    probe("update", probeArgs, probeResult);
}

static void screenAs(LPCSTR name, int left, int top, int right, int bottom)
{
    blackText(probeResult, left, top, right, bottom);
    probe("screen", name, probeResult);
}

#define MOVE (SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE)

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HWND a, b, p, k, g, r, l, t;
    RECT rect;

    probeOpen(OUTPUT);
    rgn = CreateRectRgn(0, 0, 0, 0);
    registerClass(instance, "VisMoveW");

    a = CreateWindow("VisMoveW", "", WS_POPUP | WS_VISIBLE, 100, 250, 100, 60, NULL, NULL,
                     instance, NULL);
    b = CreateWindow("VisMoveW", "", WS_POPUP | WS_VISIBLE, 150, 270, 80, 60, NULL, NULL,
                     instance, NULL);
    p = CreateWindow("VisMoveW", "", WS_POPUP | WS_VISIBLE, 100, 100, 160, 100, NULL, NULL,
                     instance, NULL);
    k = CreateWindow("VisMoveW", "", WS_CHILD | WS_VISIBLE, 10, 10, 30, 20, p, NULL, instance,
                     NULL);
    r = CreateWindow("VisMoveW", "", WS_POPUP | WS_VISIBLE, 300, 100, 160, 100, NULL, NULL,
                     instance, NULL);
    l = CreateWindow("VisMoveW", "", WS_CHILD | WS_VISIBLE, 10, 10, 40, 30, r, NULL, instance,
                     NULL);
    t = CreateWindow("VisMoveW", "", WS_CHILD | WS_VISIBLE, 30, 20, 40, 30, r, NULL, instance,
                     NULL);
    pump();

    /* A, partly under B. */
    fill(a, BLACKNESS);
    fill(b, WHITENESS);
    ValidateRect(a, NULL);
    ValidateRect(b, NULL);
    screenAs("covered before", 90, 240, 250, 340);
    SetWindowPos(a, NULL, 120, 260, 0, 0, MOVE);
    screenAs("covered", 90, 240, 250, 340);
    updateAs("covered", "A", a);
    updateAs("covered", "B", b);
    pump();

    /* K moved where its parent is due. */
    fill(p, WHITENESS);
    fill(k, BLACKNESS);
    ValidateRect(p, NULL);
    ValidateRect(k, NULL);
    SetRect(&rect, 70, 10, 100, 40);
    InvalidateRect(p, &rect, FALSE);
    SetWindowPos(k, NULL, 60, 10, 0, 0, MOVE);
    screenAs("parentdue", 90, 90, 270, 210);
    updateAs("parentdue", "P", p);
    updateAs("parentdue", "K", k);
    pump();

    /* K moved with its child due. */
    SetWindowPos(k, NULL, 10, 10, 0, 0, MOVE);
    g = CreateWindow("VisMoveW", "", WS_CHILD | WS_VISIBLE, 5, 5, 10, 10, k, NULL, instance,
                     NULL);
    pump();
    fill(p, WHITENESS);
    fill(k, WHITENESS);
    fill(g, BLACKNESS);
    ValidateRect(p, NULL);
    ValidateRect(k, NULL);
    InvalidateRect(g, NULL, FALSE);
    SetWindowPos(k, NULL, 60, 50, 0, 0, MOVE);
    screenAs("childdue", 90, 90, 270, 210);
    updateAs("childdue", "P", p);
    updateAs("childdue", "K", k);
    updateAs("childdue", "G", g);
    pump();

    /* L moved from under T, neither clipping the other. */
    fill(r, WHITENESS);
    fill(l, WHITENESS);
    fill(t, BLACKNESS);
    ValidateRect(r, NULL);
    ValidateRect(l, NULL);
    ValidateRect(t, NULL);
    screenAs("siblings before", 290, 90, 470, 210);
    SetWindowPos(l, NULL, 100, 50, 0, 0, MOVE);
    screenAs("siblings", 290, 90, 470, 210);
    updateAs("siblings", "R", r);
    updateAs("siblings", "L", l);
    updateAs("siblings", "T", t);
    pump();

    DeleteObject(rgn);
    DestroyWindow(r);
    DestroyWindow(p);
    DestroyWindow(b);
    DestroyWindow(a);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
