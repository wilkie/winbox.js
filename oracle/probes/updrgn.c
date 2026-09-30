/*
 * A window's update region: `InvalidateRgn`, `ValidateRgn`, `GetUpdateRgn`
 * and `ExcludeUpdateRgn`, and whether what is to be painted is a region or
 * only its box.
 *
 * `T`, a child window 64 by 48, is validated before each case. For each:
 *
 * * `update`: `GetUpdateRect`'s box, then `GetUpdateRgn`'s answer and the
 *   region's box, and `PtInRegion` of the region at (20, 20), inside the box
 *   of the two-part cases and outside both parts.
 * * `exclude`: `ExcludeUpdateRgn`'s answer for a device context of `T`, the
 *   clip box after, and `PtVisible` at (15, 15), inside the update, and at
 *   (40, 40), outside it.
 * * `paint`: with two parts to paint, `T` filled white and then updated: the
 *   `rcPaint` `BeginPaint` gave, and the pixels its paint, which fills the
 *   whole client area black, left at (5, 5) and (50, 35), inside the parts,
 *   and at (20, 20), between them.
 *
 * The cases: `one`, (10, 10)-(30, 20); `two`, (0, 0)-(10, 10) and
 * (40, 30)-(60, 40); `cut`, (10, 10)-(30, 20) less (10, 10)-(20, 20) by
 * `ValidateRgn`; `all`, `InvalidateRgn` of NULL; `none`, then `ValidateRgn`
 * of NULL.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\UPDRGN.OUT"

static HWND target;
static RECT painted;

LONG FAR PASCAL _export PlainProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_PAINT) {
        PAINTSTRUCT ps;
        RECT all;

        BeginPaint(hwnd, &ps);
        painted = ps.rcPaint;
        GetClientRect(hwnd, &all);
        FillRect(ps.hdc, &all, GetStockObject(BLACK_BRUSH));
        EndPaint(hwnd, &ps);
        return 0;
    }

    if (message == WM_ERASEBKGND) {
        return 1;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

static void invalidate(int left, int top, int right, int bottom)
{
    HRGN region = CreateRectRgn(left, top, right, bottom);

    InvalidateRgn(target, region, FALSE);
    DeleteObject(region);
}

static void update(LPCSTR name)
{
    RECT box;
    HRGN region = CreateRectRgn(0, 0, 0, 0);
    int kind;
    RECT rbox;

    SetRectEmpty(&box);
    GetUpdateRect(target, &box, FALSE);
    kind = GetUpdateRgn(target, region, FALSE);
    GetRgnBox(region, &rbox);
    wsprintf(probeResult, "%d,%d,%d,%d;%d:%d,%d,%d,%d;%d", box.left, box.top, box.right,
             box.bottom, kind, rbox.left, rbox.top, rbox.right, rbox.bottom,
             PtInRegion(region, 20, 20));
    probe("update", name, probeResult);
    DeleteObject(region);
}

static char digit(COLORREF colour)
{
    return (colour & 0xffffffL) == 0 ? '0' : (colour & 0xffffffL) == 0xffffffL ? 'f' : '?';
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HWND frame;

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
    kind.lpszClassName = "UpdRgn";
    RegisterClass(&kind);

    frame = CreateWindow("UpdRgn", "F", WS_POPUP | WS_VISIBLE, 100, 100, 100, 80, NULL, NULL,
                         instance, NULL);
    target = CreateWindow("UpdRgn", "T", WS_CHILD | WS_VISIBLE, 8, 8, 64, 48, frame, (HMENU)1,
                          instance, NULL);
    UpdateWindow(frame);
    ValidateRect(target, NULL);

    invalidate(10, 10, 30, 20);
    update("one");
    ValidateRect(target, NULL);

    invalidate(0, 0, 10, 10);
    invalidate(40, 30, 60, 40);
    update("two");
    ValidateRect(target, NULL);

    {
        HRGN part = CreateRectRgn(10, 10, 20, 20);

        invalidate(10, 10, 30, 20);
        ValidateRgn(target, part);
        DeleteObject(part);
        update("cut");
        ValidateRect(target, NULL);
    }

    InvalidateRgn(target, NULL, FALSE);
    update("all");
    ValidateRgn(target, NULL);
    update("none");

    {
        HDC dc;
        RECT clip;
        int answer;

        invalidate(10, 10, 30, 20);
        dc = GetDC(target);
        answer = ExcludeUpdateRgn(dc, target);
        GetClipBox(dc, &clip);
        wsprintf(probeResult, "%d;%d,%d,%d,%d;%d,%d", answer, clip.left, clip.top, clip.right,
                 clip.bottom, PtVisible(dc, 15, 15), PtVisible(dc, 40, 40));
        probe("exclude", "one", probeResult);
        ReleaseDC(target, dc);
        ValidateRect(target, NULL);
    }

    {
        HDC dc = GetDC(target);
        RECT all;

        GetClientRect(target, &all);
        FillRect(dc, &all, GetStockObject(WHITE_BRUSH));
        ValidateRect(target, NULL);

        invalidate(0, 0, 10, 10);
        invalidate(40, 30, 60, 40);
        UpdateWindow(target);

        wsprintf(probeResult, "%d,%d,%d,%d;%c%c%c", painted.left, painted.top, painted.right,
                 painted.bottom, digit(GetPixel(dc, 5, 5)), digit(GetPixel(dc, 50, 35)),
                 digit(GetPixel(dc, 20, 20)));
        probe("paint", "two", probeResult);
        ReleaseDC(target, dc);
    }

    DestroyWindow(frame);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
