/*
 * The low bits of every kind of handle GDI and USER give out.
 *
 * A handle's value is the system's own choice, and this does not record one.
 * But programs lean on its low bits: `PBRUSH.DLL` gives out a DC's handle
 * less one as a bitmap of its own, and tells the two apart by the low bit.
 * So for each kind of handle, several of them, this records the value's low
 * two bits, and whether they were the same for all.
 *
 * * `bits`: for each kind, the low two bits of each of four handles.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\HANDBITS.OUT"

static void bits(LPCSTR kind, UINT a, UINT b, UINT c, UINT d)
{
    wsprintf(probeResult, "%u,%u,%u,%u", a & 3, b & 3, c & 3, d & 3);
    probe("bits", kind, probeResult);
}

LONG FAR PASCAL _export Proc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    return DefWindowProc(hwnd, message, wParam, lParam);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HDC screen;
    HDC dc[4];
    HPEN pen[4];
    HBRUSH brush[4];
    HFONT font[4];
    HBITMAP bitmap[4];
    HRGN region[4];
    HWND window[4];
    HMENU menu[4];
    HGLOBAL global[4];
    int index;

    probeOpen(OUTPUT);

    screen = GetDC(NULL);

    for (index = 0; index < 4; index++) {
        dc[index] = CreateCompatibleDC(screen);
        pen[index] = CreatePen(PS_SOLID, index, RGB(index, 0, 0));
        brush[index] = CreateSolidBrush(RGB(0, index, 0));
        font[index] = CreateFont(10 + index, 0, 0, 0, 400, 0, 0, 0, 0, 0, 0, 0, 0, "System");
        bitmap[index] = CreateCompatibleBitmap(screen, 8 + index, 8);
        region[index] = CreateRectRgn(0, 0, 10 + index, 10);
        menu[index] = CreateMenu();
        global[index] = GlobalAlloc(GMEM_MOVEABLE, 16);
    }

    kind.style = 0;
    kind.lpfnWndProc = Proc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "ProbeBits";
    RegisterClass(&kind);

    for (index = 0; index < 4; index++) {
        window[index] = CreateWindow("ProbeBits", "", WS_OVERLAPPED, 0, 0, 50, 50, NULL, NULL,
                                     instance, NULL);
    }

    bits("dc", (UINT)dc[0], (UINT)dc[1], (UINT)dc[2], (UINT)dc[3]);
    bits("screen-dc", (UINT)screen, (UINT)screen, (UINT)screen, (UINT)screen);
    bits("pen", (UINT)pen[0], (UINT)pen[1], (UINT)pen[2], (UINT)pen[3]);
    bits("brush", (UINT)brush[0], (UINT)brush[1], (UINT)brush[2], (UINT)brush[3]);
    bits("font", (UINT)font[0], (UINT)font[1], (UINT)font[2], (UINT)font[3]);
    bits("bitmap", (UINT)bitmap[0], (UINT)bitmap[1], (UINT)bitmap[2], (UINT)bitmap[3]);
    bits("region", (UINT)region[0], (UINT)region[1], (UINT)region[2], (UINT)region[3]);
    bits("stock", (UINT)GetStockObject(WHITE_BRUSH), (UINT)GetStockObject(BLACK_PEN),
         (UINT)GetStockObject(SYSTEM_FONT), (UINT)GetStockObject(DEFAULT_PALETTE));
    bits("window", (UINT)window[0], (UINT)window[1], (UINT)window[2], (UINT)window[3]);
    bits("menu", (UINT)menu[0], (UINT)menu[1], (UINT)menu[2], (UINT)menu[3]);
    bits("global", (UINT)global[0], (UINT)global[1], (UINT)global[2], (UINT)global[3]);
    bits("instance", (UINT)instance, (UINT)instance, (UINT)instance, (UINT)instance);

    for (index = 0; index < 4; index++) {
        DestroyWindow(window[index]);
        DestroyMenu(menu[index]);
        GlobalFree(global[index]);
        DeleteObject(region[index]);
        DeleteObject(bitmap[index]);
        DeleteObject(font[index]);
        DeleteObject(brush[index]);
        DeleteObject(pen[index]);
        DeleteDC(dc[index]);
    }

    ReleaseDC(NULL, screen);
    probeFinish();

    return 0;
}
