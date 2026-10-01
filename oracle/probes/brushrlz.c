/*
 * Where a dithered brush's pattern starts when one brush is used in two
 * windows: realised in the first, then used again in the second, with and
 * without `UnrealizeObject` between. Chess answers the brush it erases its
 * window with for its labels' `WM_CTLCOLOR`, and Windows shows the labels'
 * pattern in step with the window's.
 *
 * Two pop-ups without borders: `A` at (100, 100) and `B` at (203, 150), so
 * their corners differ by an odd sum, which a checkered pattern shows. A
 * solid brush of 408080h, which the VGA dithers as a checker.
 *
 * * `rows`: the first two rows of eight pixels at each window's corner,
 *   palette digits, after `PatBlt(PATCOPY)` with the brush: in A first; then
 *   in B, the brush not unrealised; then in B after `UnrealizeObject` and the
 *   brush selected again; then in A again, the brush not unrealised.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\BRUSHRLZ.OUT"

static const char HEX[] = "0123456789abcdef";

static const COLORREF PALETTE[16] = {
    RGB(0, 0, 0),       RGB(128, 0, 0),     RGB(0, 128, 0),   RGB(128, 128, 0),
    RGB(0, 0, 128),     RGB(128, 0, 128),   RGB(0, 128, 128), RGB(192, 192, 192),
    RGB(128, 128, 128), RGB(255, 0, 0),     RGB(0, 255, 0),   RGB(255, 255, 0),
    RGB(0, 0, 255),     RGB(255, 0, 255),   RGB(0, 255, 255), RGB(255, 255, 255),
};

static HBRUSH brush;

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

static void fill(LPCSTR name, HWND window, BOOL unrealize)
{
    HDC hdc = GetDC(window);
    HBRUSH before;
    int x;
    int y;

    if (unrealize) {
        UnrealizeObject(brush);
    }

    before = SelectObject(hdc, brush);
    PatBlt(hdc, 0, 0, 40, 20, PATCOPY);

    for (y = 0; y < 2; y++) {
        for (x = 0; x < 8; x++) {
            probeResult[x] = digit(GetPixel(hdc, x, y));
        }

        probeResult[8] = '\0';
        wsprintf(probeArgs, "%s,y=%d", name, y);
        probe("rows", probeArgs, probeResult);
    }

    SelectObject(hdc, before);
    ReleaseDC(window, hdc);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HWND a;
    HWND b;

    probeOpen(OUTPUT);
    ShowCursor(FALSE);
    SetCursorPos(639, 479);

    kind.style = 0;
    kind.lpfnWndProc = DefWindowProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = GetStockObject(BLACK_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "BrushRlz";
    RegisterClass(&kind);

    a = CreateWindow("BrushRlz", "", WS_POPUP | WS_VISIBLE, 100, 100, 60, 40, NULL, NULL, instance,
                     NULL);
    b = CreateWindow("BrushRlz", "", WS_POPUP | WS_VISIBLE, 203, 150, 60, 40, NULL, NULL, instance,
                     NULL);
    UpdateWindow(a);
    UpdateWindow(b);

    brush = CreateSolidBrush(RGB(0x80, 0x80, 0x40));

    fill("A first", a, FALSE);
    fill("B kept", b, FALSE);
    fill("B unrealized", b, TRUE);
    fill("A kept", a, FALSE);

    DeleteObject(brush);
    DestroyWindow(a);
    DestroyWindow(b);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
