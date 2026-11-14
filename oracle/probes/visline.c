/*
 * Lines drawn through a visible region of more than one rectangle: GDI
 * clips a line to each rectangle of the region for a driver that clips to
 * one rectangle, and the Hercules' driver clips none (`visprobe.h`).
 *
 * W is a pop-up 200 by 100 at (100, 100), white; X a pop-up 60 by 40 at
 * (170, 130) over it, white. Through W's context, each case whitens the
 * screen from (90, 90) to (310, 210), draws, and writes where the screen
 * went black, as bands: `solid`, a line of the black pen from (10, 10) to
 * (190, 90), crossing X; `across`, one from (0, 50) to (200, 50); `dotted`,
 * a `PS_DOT` pen's line the same, and from (0, 20) to (200, 20), where the
 * region is one rectangle (`dotted, one rectangle`); `wide`, a black pen five wide from
 * (10, 90) to (190, 10); `ellipse`, `Ellipse` (20, 10, 180, 90) with the
 * black pen and the null brush; `poly`, `Polyline` through (10, 30),
 * (190, 30), (190, 70), (10, 70).
 */

#include "probe.h"
#include "visprobe.h"

#define OUTPUT "C:\\ORACLE\\VISLINE.OUT"

static HWND w;

static void drawn(LPCSTR what)
{
    blackText(probeResult, 90, 90, 310, 210);
    probe(what, "drawn", probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HWND x;
    HDC dc;
    HPEN pen;
    HPEN old;
    POINT points[4];

    probeOpen(OUTPUT);
    visImports();

    kind.style = 0;
    kind.lpfnWndProc = DefWindowProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "VisLine";
    RegisterClass(&kind);

    w = CreateWindow("VisLine", "", WS_POPUP | WS_VISIBLE, 100, 100, 200, 100, NULL, NULL, instance,
                     NULL);
    x = CreateWindow("VisLine", "", WS_POPUP | WS_VISIBLE, 170, 130, 60, 40, NULL, NULL, instance,
                     NULL);
    UpdateWindow(w);
    UpdateWindow(x);

    dc = GetDC(w);
    dcText(probeResult, dc);
    probe("region", "W", probeResult);

    whiten(90, 90, 310, 210);
    MoveTo(dc, 10, 10);
    LineTo(dc, 190, 90);
    drawn("solid");

    whiten(90, 90, 310, 210);
    MoveTo(dc, 0, 50);
    LineTo(dc, 200, 50);
    drawn("across");

    pen = CreatePen(PS_DOT, 1, RGB(0, 0, 0));
    old = SelectObject(dc, pen);
    whiten(90, 90, 310, 210);
    MoveTo(dc, 0, 50);
    LineTo(dc, 200, 50);
    drawn("dotted");
    whiten(90, 90, 310, 210);
    MoveTo(dc, 0, 20);
    LineTo(dc, 200, 20);
    drawn("dotted, one rectangle");
    SelectObject(dc, old);
    DeleteObject(pen);

    pen = CreatePen(PS_SOLID, 5, RGB(0, 0, 0));
    old = SelectObject(dc, pen);
    whiten(90, 90, 310, 210);
    MoveTo(dc, 10, 90);
    LineTo(dc, 190, 10);
    drawn("wide");
    SelectObject(dc, old);
    DeleteObject(pen);

    SelectObject(dc, GetStockObject(NULL_BRUSH));
    whiten(90, 90, 310, 210);
    Ellipse(dc, 20, 10, 180, 90);
    drawn("ellipse");

    points[0].x = 10;
    points[0].y = 30;
    points[1].x = 190;
    points[1].y = 30;
    points[2].x = 190;
    points[2].y = 70;
    points[3].x = 10;
    points[3].y = 70;
    whiten(90, 90, 310, 210);
    Polyline(dc, points, 4);
    drawn("poly");

    ReleaseDC(w, dc);
    DestroyWindow(x);
    DestroyWindow(w);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
