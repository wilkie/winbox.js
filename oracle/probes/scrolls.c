/*
 * Scrolling a window's contents: `ScrollWindow`, `ScrollWindowEx` and
 * `ScrollDC`, what each moves, what it leaves behind, and what it says is
 * left to paint.
 *
 * `T`, a child window 32 by 24 whose class has no background brush and whose
 * paint draws nothing, is filled before each case through its device context
 * with blocks 4 by 4, colour `(x / 4 + y / 4 * 3) % 16` of the palette. No
 * message is dispatched between the scroll and the reading, so what is on
 * the screen is what the scroll left.
 *
 * For each case:
 * * `rows`: the case and the row, a palette digit a pixel.
 * * `update`: `GetUpdateRect` of `T` after, then validated.
 * * `answer`: what the call answered, and its update rectangle and the
 *   update region's box where it gives them.
 * * `child`: for the cases with a child 6 by 6 at (10, 10) in `T`, where
 *   the child is after, in `T`'s client area.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\SCROLLS.OUT"

#define W 32
#define H 24

static const char HEX[] = "0123456789abcdef";

static const COLORREF PALETTE[16] = {
    RGB(0, 0, 0),       RGB(128, 0, 0),     RGB(0, 128, 0),   RGB(128, 128, 0),
    RGB(0, 0, 128),     RGB(128, 0, 128),   RGB(0, 128, 128), RGB(192, 192, 192),
    RGB(128, 128, 128), RGB(255, 0, 0),     RGB(0, 255, 0),   RGB(255, 255, 0),
    RGB(0, 0, 255),     RGB(255, 0, 255),   RGB(0, 255, 255), RGB(255, 255, 255),
};

static HWND target;

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

static void fill(void)
{
    HDC dc = GetDC(target);
    int x;
    int y;

    for (y = 0; y < H; y += 4) {
        for (x = 0; x < W; x += 4) {
            HBRUSH brush = CreateSolidBrush(PALETTE[(x / 4 + y / 4 * 3) % 16]);
            RECT cell;

            SetRect(&cell, x, y, x + 4, y + 4);
            FillRect(dc, &cell, brush);
            DeleteObject(brush);
        }
    }

    ReleaseDC(target, dc);
    ValidateRect(target, NULL);
}

static void rows(LPCSTR name)
{
    HDC dc = GetDC(target);
    RECT update;
    int x;
    int y;

    for (y = 0; y < H; y++) {
        for (x = 0; x < W; x++) {
            probeResult[x] = digit(GetPixel(dc, x, y));
        }

        probeResult[W] = '\0';
        wsprintf(probeArgs, "%s,y=%d", name, y);
        probe("rows", probeArgs, probeResult);
    }

    ReleaseDC(target, dc);

    SetRectEmpty(&update);
    GetUpdateRect(target, &update, FALSE);
    wsprintf(probeResult, "%d,%d,%d,%d", update.left, update.top, update.right, update.bottom);
    probe("update", name, probeResult);
    ValidateRect(target, NULL);
}

static void box(LPSTR out, HRGN region)
{
    RECT r;
    int kind = GetRgnBox(region, &r);

    wsprintf(out, "%d:%d,%d,%d,%d", kind, r.left, r.top, r.right, r.bottom);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HWND frame;
    RECT scroll;
    RECT clip;
    RECT updated;
    HRGN region;
    char text[64];

    probeOpen(OUTPUT);
    ShowCursor(FALSE);
    SetCursorPos(GetSystemMetrics(SM_CXSCREEN) - 1, GetSystemMetrics(SM_CYSCREEN) - 1);

    kind.style = 0;
    kind.lpfnWndProc = PlainProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = NULL;
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "Scrolls";
    RegisterClass(&kind);

    frame = CreateWindow("Scrolls", "S", WS_POPUP | WS_VISIBLE, 100, 100, 80, 60, NULL, NULL,
                         instance, NULL);
    target = CreateWindow("Scrolls", "T", WS_CHILD | WS_VISIBLE, 8, 8, W, H, frame, (HMENU)1,
                          instance, NULL);
    UpdateWindow(frame);

    fill();
    ScrollWindow(target, 5, 3, NULL, NULL);
    rows("window+5+3");

    fill();
    ScrollWindow(target, -6, -2, NULL, NULL);
    rows("window-6-2");

    fill();
    SetRect(&scroll, 4, 4, 24, 20);
    ScrollWindow(target, 5, 3, &scroll, NULL);
    rows("rect");

    fill();
    SetRect(&clip, 0, 0, 20, 16);
    ScrollWindow(target, 5, 3, NULL, &clip);
    rows("clip");

    {
        HWND child;
        RECT at;
        POINT corner;

        fill();
        child = CreateWindow("Scrolls", "K", WS_CHILD | WS_VISIBLE, 10, 10, 6, 6, target,
                             (HMENU)2, instance, NULL);
        ValidateRect(target, NULL);
        ValidateRect(child, NULL);
        ScrollWindow(target, 5, 3, NULL, NULL);
        GetWindowRect(child, &at);
        corner.x = at.left;
        corner.y = at.top;
        ScreenToClient(target, &corner);
        wsprintf(probeResult, "%d,%d", corner.x, corner.y);
        probe("child", "window", probeResult);
        DestroyWindow(child);
        ValidateRect(target, NULL);

        fill();
        child = CreateWindow("Scrolls", "K", WS_CHILD | WS_VISIBLE, 10, 10, 6, 6, target,
                             (HMENU)2, instance, NULL);
        ValidateRect(target, NULL);
        SetRect(&scroll, 0, 0, W, H);
        ScrollWindow(target, 5, 3, &scroll, NULL);
        GetWindowRect(child, &at);
        corner.x = at.left;
        corner.y = at.top;
        ScreenToClient(target, &corner);
        wsprintf(probeResult, "%d,%d", corner.x, corner.y);
        probe("child", "rect", probeResult);
        DestroyWindow(child);
        ValidateRect(target, NULL);

        fill();
        child = CreateWindow("Scrolls", "K", WS_CHILD | WS_VISIBLE, 10, 10, 6, 6, target,
                             (HMENU)2, instance, NULL);
        ValidateRect(target, NULL);
        ScrollWindowEx(target, 5, 3, NULL, NULL, NULL, NULL, SW_SCROLLCHILDREN);
        GetWindowRect(child, &at);
        corner.x = at.left;
        corner.y = at.top;
        ScreenToClient(target, &corner);
        wsprintf(probeResult, "%d,%d", corner.x, corner.y);
        probe("child", "ex children", probeResult);
        DestroyWindow(child);
        ValidateRect(target, NULL);

        fill();
        child = CreateWindow("Scrolls", "K", WS_CHILD | WS_VISIBLE, 10, 10, 6, 6, target,
                             (HMENU)2, instance, NULL);
        ValidateRect(target, NULL);
        ScrollWindowEx(target, 5, 3, NULL, NULL, NULL, NULL, 0);
        GetWindowRect(child, &at);
        corner.x = at.left;
        corner.y = at.top;
        ScreenToClient(target, &corner);
        wsprintf(probeResult, "%d,%d", corner.x, corner.y);
        probe("child", "ex none", probeResult);
        DestroyWindow(child);
        ValidateRect(target, NULL);
    }

    fill();
    region = CreateRectRgn(0, 0, 0, 0);
    SetRectEmpty(&updated);
    wsprintf(text, "%d", ScrollWindowEx(target, 5, 3, NULL, NULL, region, &updated, 0));
    wsprintf(probeResult, "%s;%d,%d,%d,%d;", (LPSTR)text, updated.left, updated.top,
             updated.right, updated.bottom);
    box(probeResult + lstrlen(probeResult), region);
    probe("answer", "ex 0", probeResult);
    rows("ex 0");

    fill();
    SetRectEmpty(&updated);
    wsprintf(text, "%d",
             ScrollWindowEx(target, 5, 3, NULL, NULL, region, &updated, SW_INVALIDATE));
    wsprintf(probeResult, "%s;%d,%d,%d,%d;", (LPSTR)text, updated.left, updated.top,
             updated.right, updated.bottom);
    box(probeResult + lstrlen(probeResult), region);
    probe("answer", "ex invalidate", probeResult);
    rows("ex invalidate");

    fill();
    SetRectEmpty(&updated);
    SetRect(&scroll, 4, 4, 24, 20);
    wsprintf(text, "%d",
             ScrollWindowEx(target, -3, 2, &scroll, NULL, region, &updated, SW_INVALIDATE));
    wsprintf(probeResult, "%s;%d,%d,%d,%d;", (LPSTR)text, updated.left, updated.top,
             updated.right, updated.bottom);
    box(probeResult + lstrlen(probeResult), region);
    probe("answer", "ex rect", probeResult);
    rows("ex rect");

    {
        HDC dc;

        fill();
        dc = GetDC(target);
        SetRectEmpty(&updated);
        wsprintf(text, "%d", ScrollDC(dc, 5, 3, NULL, NULL, region, &updated));
        wsprintf(probeResult, "%s;%d,%d,%d,%d;", (LPSTR)text, updated.left, updated.top,
                 updated.right, updated.bottom);
        box(probeResult + lstrlen(probeResult), region);
        probe("answer", "dc", probeResult);
        ReleaseDC(target, dc);
        rows("dc");

        fill();
        dc = GetDC(target);
        SetRectEmpty(&updated);
        SetRect(&scroll, 4, 4, 24, 20);
        SetRect(&clip, 0, 0, 20, 16);
        wsprintf(text, "%d", ScrollDC(dc, -5, 3, &scroll, &clip, region, &updated));
        wsprintf(probeResult, "%s;%d,%d,%d,%d;", (LPSTR)text, updated.left, updated.top,
                 updated.right, updated.bottom);
        box(probeResult + lstrlen(probeResult), region);
        probe("answer", "dc rect clip", probeResult);
        ReleaseDC(target, dc);
        rows("dc rect clip");
    }

    DeleteObject(region);
    DestroyWindow(frame);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
