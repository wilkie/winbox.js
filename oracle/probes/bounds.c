/*
 * The bounds GDI keeps of what is drawn in a device context: the
 * program's, by `SetBoundsRect` and `GetBoundsRect`, and Windows' own, by
 * `IsDCDirty` and `SetDCStatus` and the same two calls with 8000h in the
 * flags.
 *
 * A memory device context with a bitmap of 200 by 150 of its own, mapping
 * `MM_TEXT` unless said:
 *
 * * `state`: the answers of the calls themselves -- a new context's, with
 *   each flag, a rectangle given to accumulate.
 * * `drawn`: each call that draws, alone, after the bounds are reset and
 *   enabled: the answer of `GetBoundsRect` and its rectangle (ffff where it
 *   was left alone). Pens of width 1 and 5, a null pen and brush.
 * * `mapped`: the same under `MM_LOMETRIC` and with the window origin moved.
 * * `window`: a window's context, whose bounds are kept in the screen's
 *   coordinates. Not Windows' own bounds there: a context USER lends has
 *   kept them from whatever it drew for USER before.
 * * `windows`: Windows' own bounds -- `IsDCDirty`'s answer and rectangle.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\BOUNDS.OUT"

typedef int(FAR PASCAL *DIRTYPROC)(HDC, RECT FAR *);
typedef int(FAR PASCAL *STATUSPROC)(HDC, int, RECT FAR *);

static DIRTYPROC isDCDirty;
static STATUSPROC setDCStatus;

static HDC hdc;

static void got(LPCSTR function, LPCSTR what, UINT flags)
{
    RECT box;
    UINT answer;

    box.left = box.top = box.right = box.bottom = -1;
    answer = GetBoundsRect(hdc, &box, flags);
    wsprintf(probeResult, "%04x %d,%d,%d,%d", answer, box.left, box.top, box.right, box.bottom);
    probe(function, what, probeResult);
}

static void reset(void)
{
    SetBoundsRect(hdc, NULL, DCB_RESET | DCB_ENABLE);
}

static void dirty(LPCSTR what)
{
    RECT box;
    int answer;

    box.left = box.top = box.right = box.bottom = -1;
    answer = isDCDirty(hdc, &box);
    wsprintf(probeResult, "%d %d,%d,%d,%d", answer, box.left, box.top, box.right, box.bottom);
    probe("windows", what, probeResult);
}

static void drawAll(LPCSTR function)
{
    static POINT points[4] = {{30, 40}, {90, 10}, {70, 80}, {10, 60}};
    static int counts[2] = {3, 3};
    static POINT twice[6] = {{10, 10}, {40, 10}, {20, 30}, {60, 60}, {90, 60}, {70, 90}};
    HPEN wide, old;
    HBRUSH brush;
    HDC source;
    HBITMAP picture;
    RECT rc;
    HRGN region;

    reset();
    Rectangle(hdc, 10, 20, 50, 60);
    got(function, "Rectangle", 0);

    reset();
    Ellipse(hdc, 10, 20, 50, 60);
    got(function, "Ellipse", 0);

    reset();
    RoundRect(hdc, 10, 20, 50, 60, 8, 8);
    got(function, "RoundRect", 0);

    reset();
    Arc(hdc, 10, 20, 50, 60, 50, 40, 10, 40);
    got(function, "Arc", 0);

    reset();
    Pie(hdc, 10, 20, 50, 60, 50, 40, 10, 40);
    got(function, "Pie", 0);

    reset();
    Chord(hdc, 10, 20, 50, 60, 50, 40, 10, 40);
    got(function, "Chord", 0);

    reset();
    MoveTo(hdc, 5, 6);
    got(function, "MoveTo", 0);
    LineTo(hdc, 40, 30);
    got(function, "LineTo", 0);

    reset();
    MoveTo(hdc, 40, 30);
    LineTo(hdc, 5, 6);
    got(function, "LineTo back", 0);

    reset();
    Polyline(hdc, points, 4);
    got(function, "Polyline", 0);

    reset();
    Polygon(hdc, points, 4);
    got(function, "Polygon", 0);

    reset();
    PolyPolygon(hdc, twice, counts, 2);
    got(function, "PolyPolygon", 0);

    reset();
    SetPixel(hdc, 7, 8, RGB(255, 0, 0));
    got(function, "SetPixel", 0);

    reset();
    PatBlt(hdc, 10, 12, 30, 20, PATCOPY);
    got(function, "PatBlt", 0);

    reset();
    PatBlt(hdc, 40, 32, -30, -20, PATCOPY);
    got(function, "PatBlt backwards", 0);

    source = CreateCompatibleDC(hdc);
    picture = CreateCompatibleBitmap(hdc, 30, 30);
    SelectObject(source, picture);
    reset();
    BitBlt(hdc, 15, 25, 20, 10, source, 0, 0, SRCCOPY);
    got(function, "BitBlt", 0);
    reset();
    StretchBlt(hdc, 15, 25, 40, 30, source, 0, 0, 20, 10, SRCCOPY);
    got(function, "StretchBlt", 0);
    DeleteDC(source);
    DeleteObject(picture);

    reset();
    TextOut(hdc, 10, 20, "Hi", 2);
    got(function, "TextOut", 0);

    rc.left = 5;
    rc.top = 6;
    rc.right = 60;
    rc.bottom = 40;
    reset();
    ExtTextOut(hdc, 10, 20, ETO_OPAQUE, &rc, "Hi", 2, NULL);
    got(function, "ExtTextOut opaque", 0);

    reset();
    ExtTextOut(hdc, 10, 20, ETO_CLIPPED, &rc, "Hi", 2, NULL);
    got(function, "ExtTextOut clipped", 0);

    reset();
    FillRect(hdc, &rc, GetStockObject(GRAY_BRUSH));
    got(function, "FillRect", 0);

    reset();
    FrameRect(hdc, &rc, GetStockObject(BLACK_BRUSH));
    got(function, "FrameRect", 0);

    reset();
    InvertRect(hdc, &rc);
    got(function, "InvertRect", 0);

    region = CreateEllipticRgn(10, 20, 50, 60);
    reset();
    FillRgn(hdc, region, GetStockObject(BLACK_BRUSH));
    got(function, "FillRgn", 0);
    reset();
    PaintRgn(hdc, region);
    got(function, "PaintRgn", 0);
    reset();
    InvertRgn(hdc, region);
    got(function, "InvertRgn", 0);
    reset();
    FrameRgn(hdc, region, GetStockObject(BLACK_BRUSH), 2, 3);
    got(function, "FrameRgn", 0);
    DeleteObject(region);

    reset();
    FloodFill(hdc, 100, 100, RGB(0, 0, 0));
    got(function, "FloodFill", 0);

    wide = CreatePen(PS_SOLID, 5, RGB(0, 0, 0));
    old = SelectObject(hdc, wide);
    reset();
    Rectangle(hdc, 10, 20, 50, 60);
    got(function, "Rectangle wide", 0);
    reset();
    MoveTo(hdc, 5, 6);
    LineTo(hdc, 40, 30);
    got(function, "LineTo wide", 0);
    reset();
    Ellipse(hdc, 10, 20, 50, 60);
    got(function, "Ellipse wide", 0);
    SelectObject(hdc, old);
    DeleteObject(wide);

    old = SelectObject(hdc, GetStockObject(NULL_PEN));
    reset();
    Rectangle(hdc, 10, 20, 50, 60);
    got(function, "Rectangle no pen", 0);
    SelectObject(hdc, old);

    brush = SelectObject(hdc, GetStockObject(NULL_BRUSH));
    reset();
    Rectangle(hdc, 10, 20, 50, 60);
    got(function, "Rectangle no brush", 0);
    SelectObject(hdc, brush);

    reset();
    Rectangle(hdc, -10, -20, 30, 40);
    got(function, "Rectangle over the edge", 0);

    reset();
    Rectangle(hdc, 190, 140, 260, 220);
    got(function, "Rectangle past the end", 0);

    reset();
    Rectangle(hdc, 10, 20, 50, 60);
    Rectangle(hdc, 70, 5, 90, 15);
    got(function, "two rectangles", 0);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HWND window;
    HBITMAP bitmap;
    RECT rc;
    probeOpen(OUTPUT);

    isDCDirty = (DIRTYPROC)GetProcAddress(GetModuleHandle("GDI"), MAKEINTRESOURCE(169));
    setDCStatus = (STATUSPROC)GetProcAddress(GetModuleHandle("GDI"), MAKEINTRESOURCE(170));

    hdc = CreateCompatibleDC(NULL);
    bitmap = CreateCompatibleBitmap(GetDC(NULL), 200, 150);
    SelectObject(hdc, bitmap);
    PatBlt(hdc, 0, 0, 200, 150, WHITENESS);
    /* Stock objects, so a pen or brush put back is one. */
    SelectObject(hdc, GetStockObject(BLACK_PEN));
    SelectObject(hdc, GetStockObject(WHITE_BRUSH));

    /* state */
    wsprintf(probeResult, "%04x", SetBoundsRect(hdc, NULL, 0));
    probe("state", "set 0, new", probeResult);
    got("state", "get, new", 0);
    wsprintf(probeResult, "%04x", SetBoundsRect(hdc, NULL, DCB_ENABLE));
    probe("state", "enable", probeResult);
    wsprintf(probeResult, "%04x", SetBoundsRect(hdc, NULL, 0));
    probe("state", "set 0, enabled", probeResult);
    rc.left = 3;
    rc.top = 4;
    rc.right = 30;
    rc.bottom = 40;
    wsprintf(probeResult, "%04x", SetBoundsRect(hdc, &rc, DCB_ACCUMULATE));
    probe("state", "accumulate", probeResult);
    got("state", "get, accumulated", 0);
    rc.left = 50;
    rc.top = 2;
    rc.right = 60;
    rc.bottom = 10;
    wsprintf(probeResult, "%04x", SetBoundsRect(hdc, &rc, DCB_ACCUMULATE));
    probe("state", "accumulate again", probeResult);
    got("state", "get, twice", 0);
    rc.left = 70;
    rc.top = 70;
    rc.right = 70;
    rc.bottom = 80;
    wsprintf(probeResult, "%04x", SetBoundsRect(hdc, &rc, DCB_ACCUMULATE));
    probe("state", "accumulate empty", probeResult);
    got("state", "get, empty given", 0);
    wsprintf(probeResult, "%04x", SetBoundsRect(hdc, &rc, DCB_SET));
    probe("state", "set empty", probeResult);
    got("state", "get, set empty", 0);
    rc.left = 1;
    rc.top = 2;
    rc.right = 3;
    rc.bottom = 4;
    wsprintf(probeResult, "%04x", SetBoundsRect(hdc, &rc, DCB_SET));
    probe("state", "set", probeResult);
    got("state", "get and reset", DCB_RESET);
    got("state", "get after reset", 0);
    wsprintf(probeResult, "%04x", SetBoundsRect(hdc, NULL, DCB_DISABLE));
    probe("state", "disable", probeResult);
    Rectangle(hdc, 10, 10, 20, 20);
    got("state", "drawn disabled", 0);
    wsprintf(probeResult, "%04x", SetBoundsRect(hdc, NULL, DCB_ENABLE | DCB_DISABLE));
    probe("state", "enable and disable", probeResult);
    wsprintf(probeResult, "%04x", SetBoundsRect(hdc, NULL, 0));
    probe("state", "after both", probeResult);

    drawAll("drawn");

    SetMapMode(hdc, MM_LOMETRIC);
    reset();
    Rectangle(hdc, 100, -200, 500, -600);
    got("mapped", "Rectangle lometric", 0);
    rc.left = 100;
    rc.top = -100;
    rc.right = 300;
    rc.bottom = -300;
    SetBoundsRect(hdc, NULL, DCB_RESET);
    wsprintf(probeResult, "%04x", SetBoundsRect(hdc, &rc, DCB_ACCUMULATE));
    probe("mapped", "accumulate lometric", probeResult);
    got("mapped", "get lometric", 0);
    SetMapMode(hdc, MM_TEXT);
    SetWindowOrg(hdc, 20, 10);
    reset();
    Rectangle(hdc, 30, 30, 60, 50);
    got("mapped", "Rectangle origin", 0);
    SetWindowOrg(hdc, 0, 0);

    /* windows */
    SetBoundsRect(hdc, NULL, DCB_RESET | DCB_DISABLE);
    wsprintf(probeResult, "%04x", SetBoundsRect(hdc, NULL, 0x8000));
    probe("windows", "set 8000h", probeResult);
    dirty("dirty, after drawing");
    dirty("dirty again");
    Rectangle(hdc, 11, 12, 21, 22);
    dirty("dirty, a rectangle");
    Rectangle(hdc, 11, 12, 21, 22);
    got("windows", "get 8000h", 0x8000);
    wsprintf(probeResult, "%d", setDCStatus(hdc, 0, NULL));
    probe("windows", "status 0", probeResult);
    dirty("dirty after status 0");
    rc.left = 4;
    rc.top = 5;
    rc.right = 6;
    rc.bottom = 7;
    wsprintf(probeResult, "%d", setDCStatus(hdc, 1, &rc));
    probe("windows", "status 1", probeResult);
    dirty("dirty after status 1");
    wsprintf(probeResult, "%04x", SetBoundsRect(hdc, NULL, 0x8000 | DCB_DISABLE));
    probe("windows", "disable 8000h", probeResult);
    Rectangle(hdc, 11, 12, 21, 22);
    dirty("dirty, disabled");
    wsprintf(probeResult, "%04x", SetBoundsRect(hdc, NULL, 0x8000 | DCB_ENABLE));
    probe("windows", "enable 8000h", probeResult);

    DeleteDC(hdc);
    DeleteObject(bitmap);

    /* window */
    kind.style = 0;
    kind.lpfnWndProc = DefWindowProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "Bounds";
    RegisterClass(&kind);
    window = CreateWindow("Bounds", "Bounds", WS_OVERLAPPEDWINDOW, 10, 10, 200, 120, NULL, NULL,
                          instance, NULL);
    ShowWindow(window, SW_SHOWNORMAL);
    UpdateWindow(window);

    hdc = GetDC(window);
    wsprintf(probeResult, "%04x", SetBoundsRect(hdc, NULL, 0));
    probe("window", "set 0", probeResult);
    reset();
    Rectangle(hdc, 10, 20, 50, 60);
    got("window", "Rectangle", 0);
    reset();
    Rectangle(hdc, 150, 70, 250, 120);
    got("window", "Rectangle past the client", 0);
    rc.left = 1;
    rc.top = 2;
    rc.right = 3;
    rc.bottom = 4;
    reset();
    SetBoundsRect(hdc, &rc, DCB_ACCUMULATE);
    got("window", "accumulated", 0);
    SetBoundsRect(hdc, NULL, DCB_RESET | DCB_DISABLE);
    ReleaseDC(window, hdc);

    DestroyWindow(window);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
