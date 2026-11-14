/*
 * The corners `visible-regions` left: what a context answers and draws in
 * the cases WinBox had not recorded (`visprobe.h`).
 *
 * W is a pop-up 200 by 100 at (100, 100), white, nothing over it; O a
 * pop-up of a `CS_OWNDC` class, 200 by 100 at (100, 260); P an overlapped
 * window, 300 by 100 at (320, 100), holding C, a child of a `CS_PARENTDC`
 * class, 60 by 40 at (20, 20), and D, a child 60 by 40 at (100, 20).
 *
 * * `nothing`: `BeginPaint` of W with nothing due -- after `UpdateWindow`,
 *   after `ValidateRect` of all it was due, and with only
 *   `RDW_INTERNALPAINT` -- and, beside them, with a part due and all of it
 *   due: `rcPaint`, `fErase`, the context, and where its `PatBlt` of the
 *   whole client area lands (USER.EXE seg1 `7640`-`7671`, `86e7`-`873f`).
 * * `flags`: `GetDCEx` of C with `DCX_PARENTCLIP` and the high word's 8
 *   (80000h, seg1 `84ff`), and with bits it does not know (`a676`).
 * * `focus`: `DrawFocusRect` on W's context with a clip region selected:
 *   how many pixels it turned black, and their box.
 * * `memory`: `SetDCOrg` on a memory context: the context, and the
 *   bitmap's bits after a `PatBlt` at (0, 0).
 * * `scroll`: `ScrollWindow` of O, whose own context maps two pixels to a
 *   unit from (10, 10): the pixels moved, and what is due.
 * * `given`: the region USER saves for `DCX_INTERSECTRGN`: a program's
 *   `SaveVisRgn` on the context, and `InquireVisRgn` after `ReleaseDC`.
 * * `source`: `BitBlt` and `StretchBlt` from W's context, read from left
 *   of the window where the screen is black: the bitmap's bits.
 * * `glyph`: a TrueType "W" from W's context whose visible region was
 *   made to reach left of the window, drawn across its left edge: the
 *   black pixels left of the window and within it.
 * * `meta`: `FastWindowFrame` on a metafile's context.
 */

#include "probe.h"
#include "visprobe.h"

#ifndef OUTPUT
#define OUTPUT "C:\\ORACLE\\VISNEXT.OUT"
#endif

#define DCX_WINDOW 0x00000001L
#define DCX_CACHE 0x00000002L
#define DCX_CLIPCHILDREN 0x00000008L
#define DCX_CLIPSIBLINGS 0x00000010L
#define DCX_PARENTCLIP 0x00000020L
#define DCX_EXCLUDERGN 0x00000040L
#define DCX_INTERSECTRGN 0x00000080L

static HWND w;
static HWND o;
static HWND p;
static HWND c;
static HWND d;

static void answer(LPCSTR function, LPCSTR what, long value)
{
    wsprintf(probeResult, "%ld", value);
    probe(function, what, probeResult);
}

static void state(LPCSTR function, LPCSTR what, HDC dc)
{
    dcText(probeResult, dc);
    probe(function, what, probeResult);
}

/* The black pixels of a rectangle of the screen: how many, and their box. */
static void blackCount(LPSTR out, int left, int top, int right, int bottom)
{
    HDC screen = GetDC(NULL);
    int x;
    int y;
    long n = 0;
    int l = 32767, t = 32767, r = -32767, b = -32767;

    for (y = top; y < bottom; y++) {
        for (x = left; x < right; x++) {
            if (GetPixel(screen, x, y) == RGB(0, 0, 0)) {
                n++;
                l = min(l, x);
                t = min(t, y);
                r = max(r, x + 1);
                b = max(b, y + 1);
            }
        }
    }

    ReleaseDC(NULL, screen);

    if (n) {
        wsprintf(out, "%ld %d,%d,%d,%d", n, l, t, r, b);
    } else {
        lstrcpy(out, "0");
    }
}

/* A monochrome bitmap's bits, a row of hex bytes each, `/` between. */
static void bitsText(LPSTR out, HBITMAP bitmap, int widthBytes, int rows)
{
    BYTE bits[256];
    int i;
    int y;

    GetBitmapBits(bitmap, (DWORD)widthBytes * rows, bits);

    for (y = 0; y < rows; y++) {
        for (i = 0; i < widthBytes; i++) {
            out += wsprintf(out, "%02x", bits[y * widthBytes + i]);
        }

        *out++ = y + 1 < rows ? '/' : '\0';
    }

    *out = '\0';
}

static void paintCase(LPCSTR what)
{
    PAINTSTRUCT ps;
    HDC dc;

    dc = BeginPaint(w, &ps);
    wsprintf(probeResult, "rcPaint %d,%d,%d,%d fErase %d", ps.rcPaint.left, ps.rcPaint.top,
             ps.rcPaint.right, ps.rcPaint.bottom, ps.fErase);
    probe("nothing", what, probeResult);
    state("nothing", what, dc);
    whiten(40, 40, 360, 260);
    PatBlt(dc, 0, 0, 200, 100, BLACKNESS);
    blackText(probeResult, 40, 40, 360, 260);
    probe("nothing", "drawn", probeResult);
    EndPaint(w, &ps);
    ValidateRect(w, NULL);
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

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HDC dc;
    HRGN region;
    RECT rect;

    probeOpen(OUTPUT);
    visImports();

    registerClass(instance, "VisNext", 0);
    registerClass(instance, "VisNextOwn", CS_OWNDC);
    registerClass(instance, "VisNextParent", CS_PARENTDC);

    w = CreateWindow("VisNext", "", WS_POPUP | WS_VISIBLE, 100, 100, 200, 100, NULL, NULL, instance,
                     NULL);
    o = CreateWindow("VisNextOwn", "", WS_POPUP | WS_VISIBLE, 100, 260, 200, 100, NULL, NULL,
                     instance, NULL);
    p = CreateWindow("VisNext", "P", WS_OVERLAPPED | WS_VISIBLE, 320, 100, 300, 100, NULL, NULL,
                     instance, NULL);
    c = CreateWindow("VisNextParent", "", WS_CHILD | WS_VISIBLE, 20, 20, 60, 40, p, NULL, instance,
                     NULL);
    d = CreateWindow("VisNext", "", WS_CHILD | WS_VISIBLE, 100, 20, 60, 40, p, NULL, instance, NULL);
    UpdateWindow(w);
    UpdateWindow(o);
    UpdateWindow(p);

    /* BeginPaint with nothing due, and beside it with something due. */
    paintCase("after UpdateWindow");
    InvalidateRect(w, NULL, TRUE);
    ValidateRect(w, NULL);
    paintCase("after ValidateRect");
    RedrawWindow(w, NULL, NULL, RDW_INTERNALPAINT);
    paintCase("internal paint");
    SetRect(&rect, 20, 10, 60, 30);
    InvalidateRect(w, &rect, FALSE);
    paintCase("a part due");
    InvalidateRect(w, NULL, FALSE);
    paintCase("all due");
    InvalidateRect(w, NULL, TRUE);
    paintCase("all due, erased");

    /* GetDCEx's flags. */
    dc = pGetDCEx(c, NULL, DCX_CACHE | DCX_PARENTCLIP);
    state("flags", "C PARENTCLIP", dc);
    ReleaseDC(c, dc);
    dc = pGetDCEx(c, NULL, DCX_CACHE | DCX_PARENTCLIP | 0x80000L);
    state("flags", "C PARENTCLIP 80000h", dc);
    ReleaseDC(c, dc);
    dc = pGetDCEx(p, NULL, DCX_CACHE | DCX_CLIPCHILDREN | 0x80000L);
    state("flags", "P CLIPCHILDREN 80000h", dc);
    ReleaseDC(p, dc);
    dc = pGetDCEx(p, NULL, 0x10000L | 0x80000L);
    state("flags", "P USESTYLE 80000h", dc);
    ReleaseDC(p, dc);
    dc = pGetDCEx(c, NULL, DCX_CACHE | 0x0004L);
    state("flags", "C CACHE 4", dc);
    ReleaseDC(c, dc);
    dc = pGetDCEx(c, NULL, DCX_CACHE | 0x0100L);
    state("flags", "C CACHE 100h", dc);
    ReleaseDC(c, dc);
    dc = pGetDCEx(c, NULL, DCX_CACHE | 0x200000L);
    state("flags", "C CACHE 200000h", dc);
    ReleaseDC(c, dc);

    /* DrawFocusRect through a clip region. */
    dc = GetDC(w);
    region = CreateRectRgn(0, 0, 30, 100);
    SelectClipRgn(dc, region);
    whiten(40, 40, 360, 260);
    SetRect(&rect, 10, 10, 60, 40);
    DrawFocusRect(dc, &rect);
    blackCount(probeResult, 40, 40, 360, 260);
    probe("focus", "clip 0,0,30,100", probeResult);
    SelectClipRgn(dc, NULL);
    whiten(40, 40, 360, 260);
    DrawFocusRect(dc, &rect);
    blackCount(probeResult, 40, 40, 360, 260);
    probe("focus", "no clip", probeResult);
    ReleaseDC(w, dc);
    DeleteObject(region);

    /* SetDCOrg on a memory context. */
    {
        HDC memory = CreateCompatibleDC(NULL);
        HBITMAP bitmap = CreateBitmap(32, 16, 1, 1, NULL);
        HBITMAP old = SelectObject(memory, bitmap);
        DWORD origin;

        PatBlt(memory, 0, 0, 32, 16, WHITENESS);
        state("memory", "before", memory);
        origin = pSetDCOrg(memory, 8, 4);
        wsprintf(probeResult, "%d,%d", (int)LOWORD(origin), (int)HIWORD(origin));
        probe("memory", "SetDCOrg 8,4", probeResult);
        state("memory", "after", memory);
        PatBlt(memory, 0, 0, 8, 4, BLACKNESS);
        answer("memory", "GetPixel 0,0", (long)GetPixel(memory, 0, 0));
        answer("memory", "GetPixel -8,-4", (long)GetPixel(memory, -8, -4));
        SelectObject(memory, old);
        bitsText(probeResult, bitmap, 4, 16);
        probe("memory", "bits", probeResult);
        DeleteObject(bitmap);
        DeleteDC(memory);
    }

    /* ScrollWindow on a window with a context of its own, mapped. */
    {
        HDC own = GetDC(o);
        HDC screen;

        SetMapMode(own, MM_ANISOTROPIC);
        SetWindowExt(own, 1, 1);
        SetViewportExt(own, 2, 2);
        SetViewportOrg(own, 10, 10);
        whiten(40, 200, 360, 420);
        screen = GetDC(NULL);
        PatBlt(screen, 140, 290, 20, 20, BLACKNESS);
        ReleaseDC(NULL, screen);
        ScrollWindow(o, 5, 5, NULL, NULL);
        blackText(probeResult, 40, 200, 360, 420);
        probe("scroll", "5,5 drawn", probeResult);
        GetUpdateRect(o, &rect, FALSE);
        wsprintf(probeResult, "%d,%d,%d,%d", rect.left, rect.top, rect.right, rect.bottom);
        probe("scroll", "5,5 GetUpdateRect", probeResult);
        ValidateRect(o, NULL);
        SetRect(&rect, 0, 0, 40, 30);
        ScrollWindow(o, -5, 0, &rect, NULL);
        blackText(probeResult, 40, 200, 360, 420);
        probe("scroll", "-5,0 in 0,0,40,30 drawn", probeResult);
        GetUpdateRect(o, &rect, FALSE);
        wsprintf(probeResult, "%d,%d,%d,%d", rect.left, rect.top, rect.right, rect.bottom);
        probe("scroll", "-5,0 GetUpdateRect", probeResult);
        ValidateRect(o, NULL);
        ReleaseDC(o, own);
    }

    /* The region USER saves for one given. */
    {
        HDC plain = GetDC(w);
        HRGN before = pInquireVisRgn(plain);
        HRGN saved;

        ReleaseDC(w, plain);
        region = CreateRectRgn(120, 120, 180, 160);
        dc = pGetDCEx(w, region, DCX_CACHE | DCX_CLIPSIBLINGS | DCX_INTERSECTRGN);
        probe("given", "same context", dc == plain ? "yes" : "no");
        probe("given", "InquireVisRgn same as before", pInquireVisRgn(dc) == before ? "yes" : "no");
        saved = pSaveVisRgn(dc);
        probe("given", "SaveVisRgn", saved ? "handle" : "0");
        probe("given", "SaveVisRgn is the region before", saved == before ? "yes" : "no");
        answer("given", "RestoreVisRgn", (long)pRestoreVisRgn(dc));
        state("given", "restored", dc);
        ReleaseDC(w, dc);
        dc = GetDC(w);
        probe("given", "after ReleaseDC, InquireVisRgn same as before",
              pInquireVisRgn(dc) == before ? "yes" : "no");
        probe("given", "after ReleaseDC, InquireVisRgn is what SaveVisRgn answered",
              saved && pInquireVisRgn(dc) == saved ? "yes" : "no");
        state("given", "after ReleaseDC", dc);
        ReleaseDC(w, dc);
    }

    /* Reading from left of the window. */
    {
        HDC memory = CreateCompatibleDC(NULL);
        HBITMAP bitmap = CreateBitmap(32, 16, 1, 1, NULL);
        HBITMAP old = SelectObject(memory, bitmap);
        HDC screen;

        whiten(40, 40, 360, 260);
        screen = GetDC(NULL);
        PatBlt(screen, 84, 100, 16, 16, BLACKNESS);
        ReleaseDC(NULL, screen);
        dc = GetDC(w);
        PatBlt(memory, 0, 0, 32, 16, WHITENESS);
        BitBlt(memory, 0, 0, 32, 16, dc, -16, 0, SRCCOPY);
        bitsText(probeResult, bitmap, 4, 16);
        probe("source", "BitBlt from -16,0", probeResult);
        PatBlt(memory, 0, 0, 32, 16, WHITENESS);
        StretchBlt(memory, 0, 0, 32, 16, dc, -16, 0, 32, 16, SRCCOPY);
        bitsText(probeResult, bitmap, 4, 16);
        probe("source", "StretchBlt from -16,0", probeResult);
        PatBlt(memory, 0, 0, 32, 16, WHITENESS);
        StretchBlt(memory, 0, 0, 32, 16, dc, -16, 0, 16, 8, SRCCOPY);
        bitsText(probeResult, bitmap, 4, 16);
        probe("source", "StretchBlt from -16,0 doubled", probeResult);
        ReleaseDC(w, dc);
        SelectObject(memory, old);
        DeleteObject(bitmap);
        DeleteDC(memory);
    }

    /* A TrueType glyph across the window's left edge. */
    {
        HFONT font = CreateFont(-40, 0, 0, 0, FW_NORMAL, 0, 0, 0, ANSI_CHARSET, OUT_TT_ONLY_PRECIS,
                                CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY, VARIABLE_PITCH | FF_SWISS,
                                "Arial");
        HFONT oldFont;

        dc = GetDC(w);
        region = CreateRectRgn(40, 40, 360, 260);
        pSelectVisRgn(dc, region);
        oldFont = SelectObject(dc, font);
        SetBkMode(dc, TRANSPARENT);
        whiten(40, 40, 360, 260);
        TextOut(dc, -20, 10, "W", 1);
        blackCount(probeResult, 40, 40, 100, 260);
        probe("glyph", "left of the window", probeResult);
        blackCount(probeResult, 100, 40, 360, 260);
        probe("glyph", "within it", probeResult);
        SelectObject(dc, oldFont);
        DeleteObject(font);
        pSetHookFlags(dc, 1);
        ReleaseDC(w, dc);
    }

    /* FastWindowFrame on a metafile's context. */
    {
        HDC meta = CreateMetaFile(NULL);
        HMETAFILE done;

        SetRect(&rect, 10, 10, 110, 60);
        answer("meta", "FastWindowFrame", (long)pFastWindowFrame(meta, &rect, 4, 3, PATINVERT));
        done = CloseMetaFile(meta);
        DeleteMetaFile(done);
    }

    DeleteObject(region);
    DestroyWindow(p);
    DestroyWindow(o);
    DestroyWindow(w);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
