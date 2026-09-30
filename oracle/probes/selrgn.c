/*
 * A region selected into a device context with `SelectObject`, as Roulette
 * selects an elliptic one before it draws its wheel.
 *
 * On a memory device context with a bitmap 40 by 40, black:
 *
 * * `select`: `SelectObject`'s answer for an elliptic region (2, 2)-(31,
 *   31), a rectangular one (4, 4)-(20, 20), an empty one, and NULL, in
 *   hexadecimal; and `GetClipBox`'s answer and box after each.
 * * `pixels`: after the elliptic region is selected, the bitmap filled
 *   white with `PatBlt(WHITENESS)` over the whole of it, and `GetPixel` at
 *   (2, 2), outside the ellipse, with the region still selected, then with
 *   none, and at (16, 16), inside, in hexadecimal; the same for the
 *   rectangular one at (3, 3) and (10, 10).
 * * `after`: whether the region can still be used after, by `PtInRegion`.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\SELRGN.OUT"

static HDC memory;

static void clip(LPCSTR name, HGDIOBJ object)
{
    RECT box;
    DWORD answer = (DWORD)(UINT)SelectObject(memory, object);
    int kind;

    wsprintf(probeResult, "%lx", answer);
    probe("select", name, probeResult);

    kind = GetClipBox(memory, &box);
    wsprintf(probeArgs, "%s,GetClipBox", name);
    wsprintf(probeResult, "%d,%d,%d,%d,%d", kind, box.left, box.top, box.right, box.bottom);
    probe("select", probeArgs, probeResult);
}

static void filled(LPCSTR name, int ox, int oy, int ix, int iy)
{
    PatBlt(memory, 0, 0, 40, 40, WHITENESS);
    wsprintf(probeArgs, "%s,outside,clipped", name);
    wsprintf(probeResult, "%lx", GetPixel(memory, ox, oy));
    probe("pixels", probeArgs, probeResult);
    SelectClipRgn(memory, NULL);
    wsprintf(probeArgs, "%s,outside", name);
    wsprintf(probeResult, "%lx", GetPixel(memory, ox, oy));
    probe("pixels", probeArgs, probeResult);
    wsprintf(probeArgs, "%s,inside", name);
    wsprintf(probeResult, "%lx", GetPixel(memory, ix, iy));
    probe("pixels", probeArgs, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HDC screen;
    HBITMAP bitmap;
    HRGN ellipse;
    HRGN rect;
    HRGN empty;

    probeOpen(OUTPUT);
    screen = GetDC(NULL);
    memory = CreateCompatibleDC(screen);
    bitmap = CreateCompatibleBitmap(screen, 40, 40);
    SelectObject(memory, bitmap);
    PatBlt(memory, 0, 0, 40, 40, BLACKNESS);

    ellipse = CreateEllipticRgn(2, 2, 31, 31);
    rect = CreateRectRgn(4, 4, 20, 20);
    empty = CreateRectRgn(0, 0, 0, 0);

    clip("ellipse", ellipse);
    filled("ellipse", 2, 2, 16, 16);

    SelectClipRgn(memory, NULL);
    PatBlt(memory, 0, 0, 40, 40, BLACKNESS);

    clip("rect", rect);
    filled("rect", 3, 3, 10, 10);

    clip("empty", empty);
    clip("null", NULL);

    probe("after", "PtInRegion(ellipse)", PtInRegion(ellipse, 16, 16) ? "yes" : "no");

    DeleteObject(ellipse);
    DeleteObject(rect);
    DeleteObject(empty);
    DeleteDC(memory);
    DeleteObject(bitmap);
    ReleaseDC(NULL, screen);
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
