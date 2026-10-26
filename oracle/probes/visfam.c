/*
 * GDI's visible-region calls, made by a program on a window's device
 * context, and what is drawn after each (`visprobe.h`).
 *
 * W is a pop-up 200 by 100 at (100, 100), white, nothing over it. Before
 * each drawing the screen from (40, 40) to (360, 260) is whitened through
 * the screen's own context; the context then fills its whole client area
 * and more, (-60, -60) to (260, 160), black with `PatBlt`, and `drawn` is
 * where the screen went black.
 *
 * * `save`: `SaveVisRgn` and `RestoreVisRgn`, what each answers -- a
 *   handle written as `handle` -- and the region after.
 * * `intersect`, `exclude`, `offset`, `select`: `IntersectVisRect` and
 *   `ExcludeVisRect` with a rectangle in the screen's terms, `OffsetVisRgn`,
 *   `SelectVisRgn` with a region that reaches out of the window; what each
 *   answers, the context after, and what is drawn.
 * * `again`: the context given back and got again. Between the others it
 *   is got again and its region made again by USER's hook (`fresh`).
 * * `hook`: `SelectVisRgn` of a small region, then `SetHookFlags` with
 *   `DCHF_INVALIDATEVISRGN` -- what USER's hook makes of it.
 * * `origin`: `SetDCOrg`, what it answers, and where drawing lands.
 * * `cliprgn`: `GetClipRgn`'s region after `SelectClipRgn`, and after
 *   `SetDCOrg`.
 * * `state`: `GetDCState` and `SetDCState`.
 * * `frame`: `FastWindowFrame` on the window's context, on one whose
 *   visible region is not a rectangle, and on a memory context.
 */

#include "probe.h"
#include "visprobe.h"

#define OUTPUT "C:\\ORACLE\\VISFAM.OUT"

static HWND w;

static void state(LPCSTR function, LPCSTR what, HDC dc)
{
    dcText(probeResult, dc);
    probe(function, what, probeResult);
}

static void drawn(LPCSTR function, LPCSTR what, HDC dc)
{
    whiten(40, 40, 360, 260);
    PatBlt(dc, -60, -60, 320, 220, BLACKNESS);
    blackText(probeResult, 40, 40, 360, 260);
    probe(function, what, probeResult);
}

static void answer(LPCSTR function, LPCSTR what, long value)
{
    wsprintf(probeResult, "%ld", value);
    probe(function, what, probeResult);
}

static void handleAnswer(LPCSTR function, LPCSTR what, HRGN value)
{
    probe(function, what, value ? "handle" : "0");
}

static void again(HDC FAR *dc)
{
    ReleaseDC(w, *dc);
    *dc = GetDC(w);
}

/* Given back, got again, and its visible region made again by USER's hook:
 * what a program did to the region outlives `ReleaseDC` (`again`). */
static void fresh(HDC FAR *dc)
{
    again(dc);
    pSetHookFlags(*dc, 1);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HDC dc;
    HRGN first;
    HRGN region;
    DWORD origin;

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
    kind.lpszClassName = "VisFam";
    RegisterClass(&kind);

    w = CreateWindow("VisFam", "", WS_POPUP | WS_VISIBLE, 100, 100, 200, 100, NULL, NULL, instance,
                     NULL);
    UpdateWindow(w);
    dc = GetDC(w);

    state("start", "GetDC", dc);
    drawn("start", "drawn", dc);
    first = pInquireVisRgn(dc);
    probe("start", "InquireVisRgn again, same handle", first == pInquireVisRgn(dc) ? "yes" : "no");

    /* Saved and restored. */
    handleAnswer("save", "SaveVisRgn 1", pSaveVisRgn(dc));
    pIntersectVisRect(dc, 100, 100, 150, 150);
    handleAnswer("save", "SaveVisRgn 2", pSaveVisRgn(dc));
    pIntersectVisRect(dc, 100, 100, 120, 120);
    state("save", "after two", dc);
    probe("save", "InquireVisRgn after, same handle", first == pInquireVisRgn(dc) ? "yes" : "no");
    answer("save", "RestoreVisRgn 1", (long)pRestoreVisRgn(dc));
    state("save", "after one restored", dc);
    answer("save", "RestoreVisRgn 2", (long)pRestoreVisRgn(dc));
    state("save", "after two restored", dc);
    probe("save", "InquireVisRgn restored, same handle", first == pInquireVisRgn(dc) ? "yes" : "no");
    answer("save", "RestoreVisRgn, none saved", (long)pRestoreVisRgn(dc));
    state("save", "after none", dc);

    /* Narrowed, in the screen's terms. */
    answer("intersect", "IntersectVisRect 150,120,250,170", (long)pIntersectVisRect(dc, 150, 120, 250, 170));
    state("intersect", "after", dc);
    drawn("intersect", "drawn", dc);
    answer("intersect", "IntersectVisRect wrong way round", (long)pIntersectVisRect(dc, 250, 170, 150, 120));
    state("intersect", "after wrong way round", dc);
    fresh(&dc);

    answer("exclude", "ExcludeVisRect 150,120,250,170", (long)pExcludeVisRect(dc, 150, 120, 250, 170));
    state("exclude", "after", dc);
    drawn("exclude", "drawn", dc);
    fresh(&dc);

    answer("offset", "OffsetVisRgn -30,-20", (long)pOffsetVisRgn(dc, -30, -20));
    state("offset", "after", dc);
    drawn("offset", "drawn", dc);
    fresh(&dc);

    region = CreateRectRgn(60, 70, 160, 130);
    answer("select", "SelectVisRgn 60,70,160,130", (long)pSelectVisRgn(dc, region));
    state("select", "after", dc);
    probe("select", "region still its own", pInquireVisRgn(dc) != region ? "yes" : "no");
    regionText(probeResult, region);
    probe("select", "region given, after", probeResult);
    drawn("select", "drawn", dc);
    SetRectRgn(region, 0, 0, 10, 10);
    state("select", "after the region given is changed", dc);
    again(&dc);
    state("again", "got again", dc);
    drawn("again", "drawn", dc);

    /* USER's hook makes the region again. */
    SetRectRgn(region, 110, 110, 130, 130);
    pSelectVisRgn(dc, region);
    state("hook", "selected", dc);
    answer("hook", "SetHookFlags INVALIDATE", (long)pSetHookFlags(dc, 1));
    state("hook", "after", dc);
    pSelectVisRgn(dc, region);
    pSaveVisRgn(dc);
    answer("hook", "SetHookFlags INVALIDATE, one saved", (long)pSetHookFlags(dc, 1));
    state("hook", "after, one saved", dc);
    answer("hook", "RestoreVisRgn", (long)pRestoreVisRgn(dc));
    state("hook", "restored", dc);
    fresh(&dc);

    /* The origin. */
    origin = pSetDCOrg(dc, 10, 20);
    wsprintf(probeResult, "%d,%d", (int)LOWORD(origin), (int)HIWORD(origin));
    probe("origin", "SetDCOrg 10,20", probeResult);
    state("origin", "after", dc);
    drawn("origin", "drawn", dc);
    origin = pSetDCOrg(dc, 150, 120);
    wsprintf(probeResult, "%d,%d", (int)LOWORD(origin), (int)HIWORD(origin));
    probe("origin", "SetDCOrg 150,120", probeResult);
    state("origin", "after", dc);
    drawn("origin", "drawn at 150,120", dc);
    again(&dc);
    state("origin", "got again", dc);
    fresh(&dc);
    state("origin", "made again by the hook", dc);

    /* The clip region is kept in the screen's terms. */
    SetRectRgn(region, 0, 0, 20, 20);
    SelectClipRgn(dc, region);
    regionText(probeResult, pGetClipRgn(dc));
    probe("cliprgn", "GetClipRgn", probeResult);
    pSetDCOrg(dc, 130, 110);
    regionText(probeResult, pGetClipRgn(dc));
    probe("cliprgn", "GetClipRgn after SetDCOrg 130,110", probeResult);
    state("cliprgn", "after SetDCOrg", dc);
    drawn("cliprgn", "drawn", dc);
    again(&dc);
    regionText(probeResult, pGetClipRgn(dc));
    probe("cliprgn", "GetClipRgn got again", probeResult);
    fresh(&dc);

    /* The state, without the visible region. */
    {
        HDC saved;

        SetTextColor(dc, RGB(255, 0, 0));
        saved = pGetDCState(dc);
        probe("state", "GetDCState", saved ? "handle" : "0");
        SetTextColor(dc, RGB(0, 0, 255));
        pIntersectVisRect(dc, 100, 100, 130, 130);
        pSetDCState(dc, saved);
        answer("state", "GetTextColor after SetDCState", (long)GetTextColor(dc));
        state("state", "after SetDCState", dc);
        fresh(&dc);
    }

    /* A frame, by the display driver where it can. */
    {
        RECT rect;
        HDC memory;
        HBITMAP bitmap;
        HBITMAP old;

        SetRect(&rect, 10, 10, 110, 60);
        whiten(40, 40, 360, 260);
        answer("frame", "FastWindowFrame window", (long)pFastWindowFrame(dc, &rect, 4, 3, PATINVERT));
        blackText(probeResult, 40, 40, 360, 260);
        probe("frame", "drawn", probeResult);
        pExcludeVisRect(dc, 150, 120, 160, 130);
        whiten(40, 40, 360, 260);
        answer("frame", "FastWindowFrame, not a rectangle", (long)pFastWindowFrame(dc, &rect, 4, 3, PATINVERT));
        blackText(probeResult, 40, 40, 360, 260);
        probe("frame", "drawn, not a rectangle", probeResult);
        fresh(&dc);
        memory = CreateCompatibleDC(dc);
        bitmap = CreateCompatibleBitmap(dc, 120, 70);
        old = SelectObject(memory, bitmap);
        answer("frame", "FastWindowFrame memory", (long)pFastWindowFrame(memory, &rect, 4, 3, PATINVERT));
        SelectObject(memory, old);
        DeleteObject(bitmap);
        DeleteDC(memory);
    }

    DeleteObject(region);
    ReleaseDC(w, dc);
    DestroyWindow(w);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
