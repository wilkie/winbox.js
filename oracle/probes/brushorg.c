/*
 * Where a pattern brush's pattern starts in a window's device context: at
 * the window's corner, or the screen's, before and after `SetBrushOrg`, as
 * Borland's BWCC sets it to (0, 0) and fills its dialogs with a pattern.
 *
 * A pop-up at (101, 53), 60 by 40, without a border, so its client area's
 * corner is at an odd place on the screen. A brush of an 8 by 8 pattern,
 * black but for its top left pixel, white.
 *
 * * `org`: `GetBrushOrg` of the window's device context, as "x,y", as
 *   `GetDC` gives it, and after `SetBrushOrg(0, 0)`.
 * * `white`: after `PatBlt` over the whole client area, where the white
 *   pixels are in the first eight rows and columns of the client area, as
 *   "x,y", before and after `SetBrushOrg(0, 0)` with `UnrealizeObject` and
 *   the brush selected again.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\BRUSHORG.OUT"

static const BYTE BITS[8 * 2] = {
    0x80, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
};

static HWND window;

static void whites(LPCSTR name, HDC hdc)
{
    int x;
    int y;

    probeResult[0] = '\0';

    for (y = 0; y < 8; y++) {
        for (x = 0; x < 8; x++) {
            if ((GetPixel(hdc, x, y) & 0xffffffL) == 0xffffffL) {
                wsprintf(probeResult + lstrlen(probeResult), "%s%d,%d",
                         (LPSTR)(probeResult[0] ? " " : ""), x, y);
            }
        }
    }

    probe("white", name, probeResult);
}

static void org(LPCSTR name, HDC hdc)
{
    DWORD at = GetBrushOrg(hdc);

    wsprintf(probeResult, "%d,%d", LOWORD(at), HIWORD(at));
    probe("org", name, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HBITMAP bitmap;
    HBRUSH brush;
    HDC hdc;

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
    kind.lpszClassName = "BrushOrg";
    RegisterClass(&kind);

    window = CreateWindow("BrushOrg", "", WS_POPUP | WS_VISIBLE, 101, 53, 60, 40, NULL, NULL,
                          instance, NULL);
    UpdateWindow(window);

    bitmap = CreateBitmap(8, 8, 1, 1, BITS);
    brush = CreatePatternBrush(bitmap);

    hdc = GetDC(window);
    org("GetDC", hdc);
    SetTextColor(hdc, RGB(0, 0, 0));
    SetBkColor(hdc, RGB(255, 255, 255));
    SelectObject(hdc, brush);
    PatBlt(hdc, 0, 0, 60, 40, PATCOPY);
    whites("as given", hdc);

    SetBrushOrg(hdc, 0, 0);
    org("SetBrushOrg(0,0)", hdc);
    SelectObject(hdc, GetStockObject(BLACK_BRUSH));
    UnrealizeObject(brush);
    SelectObject(hdc, brush);
    PatBlt(hdc, 0, 0, 60, 40, PATCOPY);
    whites("after SetBrushOrg(0,0)", hdc);

    SelectObject(hdc, GetStockObject(BLACK_BRUSH));
    ReleaseDC(window, hdc);
    DeleteObject(brush);
    DeleteObject(bitmap);
    DestroyWindow(window);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
