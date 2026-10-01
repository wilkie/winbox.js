/*
 * What a window's device context keeps from one `GetDC` to the next: a
 * common one, of a class without `CS_OWNDC`, and one of a class with it.
 * Cribbage selects a fixed font into its window's device context, gives it
 * back, and draws its status line in the next it gets without selecting a
 * font; Windows draws it in the System font.
 *
 * For each window: `GetDC`, then the ANSI fixed font, red text, a green
 * background, `TRANSPARENT`, `R2_NOT`, a white pen and a black brush
 * selected or set; `ReleaseDC`; `GetDC` again.
 *
 * * `kept`: then, `GetTextFace`, `GetTextColor` and `GetBkColor` in
 *   hexadecimal, `GetBkMode`, `GetROP2`, and whether the pen and brush that
 *   `SelectObject` gives back for the stock black pen and white brush are
 *   the ones set (`set`) or the defaults (`default`).
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\DCRESET.OUT"

static void run(HINSTANCE instance, LPCSTR name, LPCSTR className)
{
    HWND window = CreateWindow(className, "W", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 20, 20, 200, 100,
                               NULL, NULL, instance, NULL);
    HDC hdc;
    char face[40];
    HGDIOBJ pen;
    HGDIOBJ brush;

    UpdateWindow(window);

    hdc = GetDC(window);
    SelectObject(hdc, GetStockObject(ANSI_FIXED_FONT));
    SetTextColor(hdc, RGB(255, 0, 0));
    SetBkColor(hdc, RGB(0, 255, 0));
    SetBkMode(hdc, TRANSPARENT);
    SetROP2(hdc, R2_NOT);
    SelectObject(hdc, GetStockObject(WHITE_PEN));
    SelectObject(hdc, GetStockObject(BLACK_BRUSH));
    ReleaseDC(window, hdc);

    hdc = GetDC(window);
    GetTextFace(hdc, sizeof(face), face);
    wsprintf(probeArgs, "%s,face", name);
    probe("kept", probeArgs, face);
    wsprintf(probeArgs, "%s,colours", name);
    wsprintf(probeResult, "%lx,%lx,%d,%d", GetTextColor(hdc), GetBkColor(hdc), GetBkMode(hdc),
             GetROP2(hdc));
    probe("kept", probeArgs, probeResult);
    pen = SelectObject(hdc, GetStockObject(BLACK_PEN));
    brush = SelectObject(hdc, GetStockObject(WHITE_BRUSH));
    wsprintf(probeArgs, "%s,objects", name);
    wsprintf(probeResult, "%s,%s", (LPSTR)(pen == GetStockObject(WHITE_PEN) ? "set" : "default"),
             (LPSTR)(brush == GetStockObject(BLACK_BRUSH) ? "set" : "default"));
    probe("kept", probeArgs, probeResult);
    ReleaseDC(window, hdc);

    DestroyWindow(window);
}

static void kind(HINSTANCE instance, LPCSTR name, UINT style)
{
    WNDCLASS k;

    k.style = style;
    k.lpfnWndProc = DefWindowProc;
    k.cbClsExtra = 0;
    k.cbWndExtra = 0;
    k.hInstance = instance;
    k.hIcon = NULL;
    k.hCursor = NULL;
    k.hbrBackground = GetStockObject(WHITE_BRUSH);
    k.lpszMenuName = NULL;
    k.lpszClassName = name;
    RegisterClass(&k);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    probeOpen(OUTPUT);

    kind(instance, "DcResetCommon", CS_HREDRAW | CS_VREDRAW);
    kind(instance, "DcResetOwn", CS_HREDRAW | CS_VREDRAW | CS_OWNDC);

    run(instance, "common", "DcResetCommon");
    run(instance, "own", "DcResetOwn");

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
