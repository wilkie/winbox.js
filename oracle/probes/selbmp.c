/*
 * A bitmap selected into a device context that is not a memory context: a
 * window's from `GetDC`, `BeginPaint`'s, the screen's from `GetDC(NULL)`,
 * and one `CreateDC("DISPLAY")` makes. Four Seasons' Visual Basic picture
 * box, painting, selects a memory context's first bitmap into
 * `BeginPaint`'s context and, answered, selects the answer back, before it
 * draws its picture there with `StretchDIBits`.
 *
 * `T`, a child window 64 by 48, is filled black before each case; a bitmap
 * 8 by 8 is made, filled black in a memory context and taken out of it
 * again. For each context:
 *
 * * `select`: `SelectObject` of the bitmap: `0` for nought, `1`, `stock`
 *   for the memory context's first bitmap's handle, `bitmap` for the
 *   bitmap's own, or `other`.
 * * `drawn`: `PatBlt` with `WHITENESS` of (2, 2)-(6, 6) of `T`'s client
 *   area, through the context, then the pixel at (3, 3) read from a screen
 *   context of its own, and the bitmap's pixel at (3, 3) read through the
 *   memory context: `0` black, `f` white, `?` another.
 * * `stock`: `SelectObject` of the memory context's first bitmap, as
 *   `select`.
 * * `one`: `SelectObject` of 1, as Visual Basic selects the answer back.
 * * `clip`: `GetClipBox`'s answer and box after, and a second `PatBlt`
 *   with `WHITENESS`, of (10, 10)-(14, 14), read back at (11, 11) from the
 *   screen as `drawn` reads it.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\SELBMP.OUT"

static HWND target;
static HDC memory;
static HBITMAP stock;
static BOOL asking;

static LPCSTR named(HANDLE got, HBITMAP bitmap)
{
    if (got == NULL) {
        return "0";
    }

    if (got == (HANDLE)1) {
        return "1";
    }

    if (got == (HANDLE)stock) {
        return "stock";
    }

    if (got == (HANDLE)bitmap) {
        return "bitmap";
    }

    return "other";
}

static char digit(COLORREF colour)
{
    return (colour & 0xffffffL) == 0 ? '0' : (colour & 0xffffffL) == 0xffffffL ? 'f' : '?';
}

/* The pixel at (x, y) of `T`'s client area, as the screen shows it. */
static COLORREF shown(int x, int y)
{
    POINT at;
    HDC screen = GetDC(NULL);
    COLORREF colour;

    at.x = x;
    at.y = y;
    ClientToScreen(target, &at);
    colour = GetPixel(screen, at.x, at.y);
    ReleaseDC(NULL, screen);
    return colour;
}

static void blacken(void)
{
    HDC dc = GetDC(target);

    PatBlt(dc, 0, 0, 64, 48, BLACKNESS);
    ReleaseDC(target, dc);
}

/* The case, through `dc`, whose corner is `T`'s client area's less (dx, dy). */
static void run(LPCSTR name, HDC dc, int dx, int dy)
{
    HBITMAP bitmap = CreateCompatibleBitmap(memory, 8, 8);
    HANDLE got;
    RECT box;
    int kind;
    COLORREF inside;

    SelectObject(memory, bitmap);
    PatBlt(memory, 0, 0, 8, 8, BLACKNESS);
    SelectObject(memory, stock);

    got = SelectObject(dc, bitmap);
    probe("select", name, named(got, bitmap));

    PatBlt(dc, dx + 2, dy + 2, 4, 4, WHITENESS);
    SelectObject(memory, bitmap);
    inside = GetPixel(memory, 3, 3);
    SelectObject(memory, stock);
    wsprintf(probeResult, "%c%c", digit(shown(3, 3)), digit(inside));
    probe("drawn", name, probeResult);

    got = SelectObject(dc, stock);
    probe("stock", name, named(got, bitmap));
    got = SelectObject(dc, (HBITMAP)1);
    probe("one", name, named(got, bitmap));

    SetRectEmpty(&box);
    kind = GetClipBox(dc, &box);
    PatBlt(dc, dx + 10, dy + 10, 4, 4, WHITENESS);
    wsprintf(probeResult, "%d:%d,%d,%d,%d;%c", kind, box.left - dx, box.top - dy,
             box.right - dx, box.bottom - dy, digit(shown(11, 11)));
    probe("clip", name, probeResult);

    DeleteObject(bitmap);
}

LONG FAR PASCAL _export PlainProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_PAINT) {
        PAINTSTRUCT ps;

        BeginPaint(hwnd, &ps);

        if (hwnd == target && asking) {
            run("paint", ps.hdc, 0, 0);
        }

        EndPaint(hwnd, &ps);
        return 0;
    }

    if (message == WM_ERASEBKGND) {
        return 1;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HWND frame;
    HDC dc;
    HBITMAP first;
    POINT corner;

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
    kind.lpszClassName = "SelBmp";
    RegisterClass(&kind);

    frame = CreateWindow("SelBmp", "F", WS_POPUP | WS_VISIBLE, 100, 100, 100, 80, NULL, NULL,
                         instance, NULL);
    target = CreateWindow("SelBmp", "T", WS_CHILD | WS_VISIBLE, 8, 8, 64, 48, frame, (HMENU)1,
                          instance, NULL);
    UpdateWindow(frame);
    ValidateRect(target, NULL);

    dc = GetDC(NULL);
    memory = CreateCompatibleDC(dc);
    ReleaseDC(NULL, dc);
    first = CreateCompatibleBitmap(memory, 8, 8);
    stock = SelectObject(memory, first);
    SelectObject(memory, stock);
    DeleteObject(first);

    corner.x = 0;
    corner.y = 0;
    ClientToScreen(target, &corner);

    blacken();
    dc = GetDC(target);
    run("window", dc, 0, 0);
    ReleaseDC(target, dc);

    blacken();
    asking = TRUE;
    InvalidateRect(target, NULL, FALSE);
    UpdateWindow(target);
    asking = FALSE;

    blacken();
    dc = GetDC(NULL);
    run("screen", dc, corner.x, corner.y);
    ReleaseDC(NULL, dc);

    blacken();
    dc = CreateDC("DISPLAY", NULL, NULL, NULL);
    run("display", dc, corner.x, corner.y);
    DeleteDC(dc);

    /* And a window's context asked again after: whether it draws on the
     * screen as before. */
    blacken();
    dc = GetDC(target);
    PatBlt(dc, 2, 2, 4, 4, WHITENESS);
    wsprintf(probeResult, "%c", digit(shown(3, 3)));
    probe("after", "window", probeResult);
    ReleaseDC(target, dc);

    DeleteDC(memory);
    DestroyWindow(frame);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
