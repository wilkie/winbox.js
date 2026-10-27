/*
 * Drawing through a device context whose visible region reaches outside
 * its own window, or whose origin is not its window's corner: where each
 * kind of drawing lands (`visprobe.h`).
 *
 * P is a pop-up 200 by 150 at (100, 100), white, without
 * `WS_CLIPCHILDREN`. In it, C at (50, 40), 60 by 40, of a class with
 * `CS_PARENTDC`, and D at (120, 90), 40 by 30, of one without. Q is a
 * pop-up 100 by 80 at (260, 200), over P's corner. Before each drawing the
 * screen from (40, 40) to (380, 300) is whitened through the screen's own
 * context, and `drawn` is where it went black after.
 *
 * * `parentdc`: C's `GetDC`, the parent's region at C's corner, and each
 *   way of drawing reaching out of C: `PatBlt`, `Rectangle`, `Ellipse`,
 *   `LineTo`, `Polygon`, `SetPixel` and `GetPixel`, `TextOut`,
 *   `ExtTextOut` clipped and opaque, `BitBlt` and `StretchBlt` from a
 *   memory context, `FillRect`; and `BitBlt` from C's context, reading
 *   outside C.
 * * `parentclip`: D's `GetDCEx` with `DCX_PARENTCLIP`, and `PatBlt`.
 * * `origin`: P's `GetDC` with `SetDCOrg` moved left of and above P, and
 *   `PatBlt`, `TextOut` and `LineTo` from there.
 */

#include "probe.h"
#include "visprobe.h"

#define OUTPUT "C:\\ORACLE\\VISDRAW.OUT"

#define DCX_CACHE 0x00000002L
#define DCX_PARENTCLIP 0x00000020L

static void drawnAs(LPCSTR function, LPCSTR what)
{
    blackText(probeResult, 40, 40, 380, 300);
    probe(function, what, probeResult);
}

static void clear(void)
{
    whiten(40, 40, 380, 300);
}

static void answer(LPCSTR function, LPCSTR what, long value)
{
    wsprintf(probeResult, "%ld", value);
    probe(function, what, probeResult);
}

static void registerClass(HINSTANCE instance, LPCSTR name, UINT style)
{
    WNDCLASS kind;

    kind.style = style;
    kind.lpfnWndProc = DefWindowProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = name;
    RegisterClass(&kind);
}

static void pump(void)
{
    MSG msg;

    while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
        DispatchMessage(&msg);
    }
}

/* The pixels of a memory context that are black, as bands. */
static HDC bandMemory;

static BOOL blackInMemory(int x, int y)
{
    return GetPixel(bandMemory, x, y) == RGB(0, 0, 0);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HWND p, c, d, q;
    HDC dc;
    HDC memory;
    HDC screen;
    HBITMAP bitmap;
    HBITMAP old;
    HGDIOBJ pen;
    HGDIOBJ brush;
    RECT rect;
    POINT points[3];

    probeOpen(OUTPUT);
    visImports();

    registerClass(instance, "VisDrawWin", 0);
    registerClass(instance, "VisDrawParentDC", CS_PARENTDC);

    p = CreateWindow("VisDrawWin", "", WS_POPUP | WS_VISIBLE, 100, 100, 200, 150, NULL, NULL,
                     instance, NULL);
    c = CreateWindow("VisDrawParentDC", "", WS_CHILD | WS_VISIBLE, 50, 40, 60, 40, p, NULL,
                     instance, NULL);
    d = CreateWindow("VisDrawWin", "", WS_CHILD | WS_VISIBLE, 120, 90, 40, 30, p, NULL, instance,
                     NULL);
    q = CreateWindow("VisDrawWin", "", WS_POPUP | WS_VISIBLE, 260, 200, 100, 80, NULL, NULL,
                     instance, NULL);
    UpdateWindow(p);
    UpdateWindow(q);
    pump();

    /* A black bitmap to copy from. */
    screen = GetDC(NULL);
    memory = CreateCompatibleDC(screen);
    bitmap = CreateCompatibleBitmap(screen, 40, 40);
    ReleaseDC(NULL, screen);
    old = SelectObject(memory, bitmap);
    PatBlt(memory, 0, 0, 40, 40, BLACKNESS);

    dc = GetDC(c);
    dcText(probeResult, dc);
    probe("parentdc", "GetDC", probeResult);

    clear();
    PatBlt(dc, -80, -60, 300, 250, BLACKNESS);
    drawnAs("parentdc", "PatBlt");

    pen = SelectObject(dc, GetStockObject(BLACK_PEN));
    brush = SelectObject(dc, GetStockObject(BLACK_BRUSH));
    clear();
    Rectangle(dc, -30, -20, 90, 70);
    drawnAs("parentdc", "Rectangle");

    clear();
    Ellipse(dc, -30, -20, 90, 70);
    drawnAs("parentdc", "Ellipse");

    clear();
    MoveTo(dc, -40, -30);
    LineTo(dc, 100, 70);
    drawnAs("parentdc", "LineTo");

    clear();
    points[0].x = -30;
    points[0].y = -20;
    points[1].x = 40;
    points[1].y = -20;
    points[2].x = -30;
    points[2].y = 30;
    Polygon(dc, points, 3);
    drawnAs("parentdc", "Polygon");
    SelectObject(dc, pen);
    SelectObject(dc, brush);

    clear();
    answer("parentdc", "SetPixel -10,-10", (long)SetPixel(dc, -10, -10, RGB(0, 0, 0)));
    answer("parentdc", "GetPixel -10,-10", (long)GetPixel(dc, -10, -10));
    answer("parentdc", "GetPixel -60,-50, outside P", (long)GetPixel(dc, -60, -50));
    answer("parentdc", "GetPixel 70,10, over D", (long)GetPixel(dc, 70, 10));
    drawnAs("parentdc", "SetPixel");

    clear();
    TextOut(dc, -40, -15, "Ab", 2);
    drawnAs("parentdc", "TextOut");

    clear();
    SetBkColor(dc, RGB(0, 0, 0));
    SetRect(&rect, -30, -15, -5, 5);
    ExtTextOut(dc, -40, -20, ETO_CLIPPED | ETO_OPAQUE, &rect, "Ab", 2, NULL);
    SetBkColor(dc, RGB(255, 255, 255));
    drawnAs("parentdc", "ExtTextOut clipped");

    clear();
    BitBlt(dc, -30, -20, 40, 30, memory, 0, 0, SRCCOPY);
    drawnAs("parentdc", "BitBlt");

    clear();
    StretchBlt(dc, -30, -20, 60, 40, memory, 0, 0, 10, 10, SRCCOPY);
    drawnAs("parentdc", "StretchBlt");

    clear();
    SetRect(&rect, -25, -25, 15, 5);
    FillRect(dc, &rect, GetStockObject(BLACK_BRUSH));
    drawnAs("parentdc", "FillRect");

    /* Read from outside C: a black square on the screen at (110, 110) to
     * (130, 130), which is (-40, -30) to (-20, -10) in C's terms. */
    clear();
    screen = GetDC(NULL);
    PatBlt(screen, 110, 110, 20, 20, BLACKNESS);
    ReleaseDC(NULL, screen);
    PatBlt(memory, 0, 0, 40, 40, WHITENESS);
    BitBlt(memory, 0, 0, 40, 40, dc, -50, -40, SRCCOPY);
    bandMemory = memory;
    bandsOf(probeResult, 0, 0, 40, 40, blackInMemory);
    probe("parentdc", "BitBlt from C, read", probeResult);
    PatBlt(memory, 0, 0, 40, 40, BLACKNESS);
    ReleaseDC(c, dc);

    /* `DCX_PARENTCLIP` on a window whose class has no `CS_PARENTDC`. */
    dc = pGetDCEx(d, NULL, DCX_CACHE | DCX_PARENTCLIP);
    dcText(probeResult, dc);
    probe("parentclip", "GetDCEx", probeResult);
    clear();
    PatBlt(dc, -150, -120, 300, 250, BLACKNESS);
    drawnAs("parentclip", "PatBlt");
    ReleaseDC(d, dc);

    /* The origin moved left of and above P's client area. */
    dc = GetDC(p);
    answer("origin", "SetDCOrg 60,50", (long)pSetDCOrg(dc, 60, 50));
    dcText(probeResult, dc);
    probe("origin", "after", probeResult);
    clear();
    PatBlt(dc, 30, 40, 100, 80, BLACKNESS);
    drawnAs("origin", "PatBlt");
    clear();
    TextOut(dc, 45, 55, "Ab", 2);
    drawnAs("origin", "TextOut");
    clear();
    pen = SelectObject(dc, GetStockObject(BLACK_PEN));
    MoveTo(dc, 20, 30);
    LineTo(dc, 160, 130);
    SelectObject(dc, pen);
    drawnAs("origin", "LineTo");
    clear();
    BitBlt(dc, 30, 40, 40, 30, memory, 0, 0, SRCCOPY);
    drawnAs("origin", "BitBlt");
    ReleaseDC(p, dc);

    SelectObject(memory, old);
    DeleteObject(bitmap);
    DeleteDC(memory);
    DestroyWindow(q);
    DestroyWindow(p);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
