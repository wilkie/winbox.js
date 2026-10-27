/*
 * USER's device context entries: which context `GetDC`, `GetWindowDC`,
 * `GetDCEx` and `BeginPaint` lend, from the five USER makes as Windows
 * starts and the ones a window or a class has of its own; what `ReleaseDC`
 * answers; and when an entry's visible region is worked out again. Only
 * whether two handles are the same is recorded, never a handle
 * (`kb/topics/visible-regions.md`, phase 4).
 *
 * * `same`: a window's context given back and asked for again.
 * * `paint`: `BeginPaint`'s context against `GetDC`'s inside the paint, and
 *   `GetDC`'s after `EndPaint`.
 * * `cycle`: six windows' contexts asked for and given back in turn, then
 *   the first's again: which of those before each one is.
 * * `whole`: `GetWindowDC`'s against `GetDC`'s of the same window.
 * * `held`: six of the screen's held at once -- which of those before each
 *   is -- then a window's asked for, and each given back, what `ReleaseDC`
 *   answers.
 * * `own`: a `CS_OWNDC` window's context asked for twice, given back, and
 *   asked for again, and the text colour set in it kept; a `CS_CLASSDC`
 *   class's two windows'.
 * * `reset`: a common context's text colour and mapping mode after it is
 *   given back and lent again.
 * * `stale`: a parent with `WS_CLIPCHILDREN` and a child; `GetDCEx` of the
 *   parent with `DCX_WINDOW | DCX_CACHE | DCX_CLIPCHILDREN` given back, the
 *   child moved, and asked for again: its visible region -- worked out
 *   again or not -- and after `SetHookFlags(DCHF_INVALIDATEVISRGN)`.
 */

#include "probe.h"
#include "visprobe.h"

#define OUTPUT "C:\\ORACLE\\DCENTRY.OUT"

static HDC painted;
static HDC inside;
static BOOL paintNow;

LRESULT FAR PASCAL _export EntryProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_PAINT && paintNow) {
        PAINTSTRUCT ps;

        painted = BeginPaint(hwnd, &ps);
        inside = GetDC(hwnd);
        ReleaseDC(hwnd, inside);
        EndPaint(hwnd, &ps);
        paintNow = FALSE;
        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

static void registerClass(HINSTANCE instance, LPCSTR name, UINT style)
{
    WNDCLASS wc;

    wc.style = style;
    wc.lpfnWndProc = EntryProc;
    wc.cbClsExtra = 0;
    wc.cbWndExtra = 0;
    wc.hInstance = instance;
    wc.hIcon = NULL;
    wc.hCursor = LoadCursor(NULL, IDC_ARROW);
    wc.hbrBackground = GetStockObject(WHITE_BRUSH);
    wc.lpszMenuName = NULL;
    wc.lpszClassName = name;
    RegisterClass(&wc);
}

static HWND make(HINSTANCE instance, LPCSTR name, int x, int y)
{
    HWND hwnd = CreateWindow(name, name, WS_POPUP | WS_BORDER | WS_VISIBLE, x, y, 90, 60, NULL,
                             NULL, instance, NULL);

    UpdateWindow(hwnd);
    return hwnd;
}

/* Which of `before`'s first `count` handles `hdc` is, by its index; `new`
 * where it is none of them. */
static LPSTR whichOf(LPSTR out, HDC hdc, HDC FAR *before, int count)
{
    int i;

    for (i = 0; i < count; i++) {
        if (before[i] == hdc) {
            wsprintf(out, "%d", i);
            return out;
        }
    }

    lstrcpy(out, "new");
    return out;
}

static void sameText(LPCSTR function, LPCSTR what, HDC a, HDC b)
{
    probe(function, what, a == b ? "same" : "other");
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HWND windows[6];
    HDC got[8];
    HDC first, second, whole;
    HWND own, classA, classB, parent, child;
    char text[32];
    int i;
    LPSTR at;
    MSG msg;

    probeOpen(OUTPUT);
    visImports();

    registerClass(instance, "DcEntry", 0);
    registerClass(instance, "DcEntryOwn", CS_OWNDC);
    registerClass(instance, "DcEntryCls", CS_CLASSDC);

    for (i = 0; i < 6; i++) {
        windows[i] = make(instance, "DcEntry", 10 + i * 100, 10);
    }

    /* same */
    first = GetDC(windows[0]);
    ReleaseDC(windows[0], first);
    second = GetDC(windows[0]);
    sameText("same", "a window's, again", first, second);
    ReleaseDC(windows[0], second);

    /* paint */
    InvalidateRect(windows[1], NULL, TRUE);
    paintNow = TRUE;
    UpdateWindow(windows[1]);
    sameText("paint", "GetDC inside against BeginPaint's", inside, painted);
    first = GetDC(windows[1]);
    probe("paint", "GetDC after", first == inside ? "inside" : first == painted ? "painted" : "other");
    ReleaseDC(windows[1], first);

    /* cycle */
    for (i = 0; i < 6; i++) {
        got[i] = GetDC(windows[i]);
        ReleaseDC(windows[i], got[i]);
        wsprintf(probeResult, "window %d", i);
        probe("cycle", probeResult, whichOf(text, got[i], got, i));
    }

    got[6] = GetDC(windows[0]);
    ReleaseDC(windows[0], got[6]);
    probe("cycle", "window 0 again", whichOf(text, got[6], got, 6));
    got[7] = GetDC(windows[1]);
    ReleaseDC(windows[1], got[7]);
    probe("cycle", "window 1 again", whichOf(text, got[7], got, 7));

    /* whole */
    first = GetDC(windows[2]);
    ReleaseDC(windows[2], first);
    whole = GetWindowDC(windows[2]);
    ReleaseDC(windows[2], whole);
    sameText("whole", "GetWindowDC against GetDC", whole, first);
    second = GetDC(windows[2]);
    ReleaseDC(windows[2], second);
    sameText("whole", "GetDC after GetWindowDC", second, first);

    /* held */
    for (i = 0; i < 6; i++) {
        got[i] = GetDC(NULL);
        wsprintf(probeResult, "screen %d", i);
        probe("held", probeResult, whichOf(text, got[i], got, i));
    }

    got[6] = GetDC(windows[3]);
    probe("held", "a window's, all lent", whichOf(text, got[6], got, 6));
    at = probeResult;

    for (i = 0; i < 7; i++) {
        at += wsprintf(at, "%d ", ReleaseDC(i == 6 ? windows[3] : NULL, got[i]));
    }

    probe("held", "ReleaseDC each", probeResult);

    /* own and class */
    own = CreateWindow("DcEntryOwn", "", WS_POPUP | WS_VISIBLE, 10, 100, 90, 60, NULL, NULL,
                       instance, NULL);
    classA = CreateWindow("DcEntryCls", "", WS_POPUP | WS_VISIBLE, 110, 100, 90, 60, NULL, NULL,
                          instance, NULL);
    classB = CreateWindow("DcEntryCls", "", WS_POPUP | WS_VISIBLE, 210, 100, 90, 60, NULL, NULL,
                          instance, NULL);
    first = GetDC(own);
    second = GetDC(own);
    sameText("own", "GetDC twice", first, second);
    SetTextColor(first, RGB(255, 0, 0));
    wsprintf(probeResult, "%d", ReleaseDC(own, first));
    probe("own", "ReleaseDC", probeResult);
    wsprintf(probeResult, "%d", ReleaseDC(own, first));
    probe("own", "ReleaseDC again", probeResult);
    second = GetDC(own);
    sameText("own", "GetDC after", first, second);
    wsprintf(probeResult, "%08lx", GetTextColor(second));
    probe("own", "text colour kept", probeResult);
    probe("own", "a common one's", whichOf(text, second, got, 7));
    first = GetDC(classA);
    second = GetDC(classB);
    sameText("own", "a class's two windows", first, second);
    wsprintf(probeResult, "%d", ReleaseDC(classB, second));
    probe("own", "ReleaseDC class", probeResult);

    /* reset */
    first = GetDC(windows[4]);
    SetTextColor(first, RGB(0, 0, 255));
    SetMapMode(first, MM_LOMETRIC);
    SetBkMode(first, TRANSPARENT);
    ReleaseDC(windows[4], first);
    second = GetDC(windows[4]);
    wsprintf(probeResult, "%s colour=%08lx map=%d bk=%d", (LPSTR)(first == second ? "same" : "other"),
             GetTextColor(second), GetMapMode(second), GetBkMode(second));
    probe("reset", "lent again", probeResult);
    ReleaseDC(windows[4], second);

    /* stale */
    parent = CreateWindow("DcEntry", "", WS_POPUP | WS_VISIBLE | WS_CLIPCHILDREN, 300, 200, 200,
                          120, NULL, NULL, instance, NULL);
    child = CreateWindow("DcEntry", "", WS_CHILD | WS_VISIBLE, 20, 20, 40, 30, parent, NULL,
                         instance, NULL);
    UpdateWindow(parent);

    first = pGetDCEx(parent, NULL, DCX_WINDOW | DCX_CACHE | DCX_CLIPCHILDREN);
    regionText(probeResult, pInquireVisRgn(first));
    probe("stale", "first", probeResult);
    ReleaseDC(parent, first);
    SetWindowPos(child, NULL, 100, 60, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
    second = pGetDCEx(parent, NULL, DCX_WINDOW | DCX_CACHE | DCX_CLIPCHILDREN);
    sameText("stale", "the child moved, same entry", first, second);
    regionText(probeResult, pInquireVisRgn(second));
    probe("stale", "the child moved", probeResult);
    wsprintf(probeResult, "%lx", (DWORD)pSetHookFlags(second, 1));
    probe("stale", "SetHookFlags", probeResult);
    regionText(probeResult, pInquireVisRgn(second));
    probe("stale", "after the hook", probeResult);
    ReleaseDC(parent, second);

    first = GetDC(parent);
    regionText(probeResult, pInquireVisRgn(first));
    probe("stale", "client", probeResult);
    ReleaseDC(parent, first);
    SetWindowPos(child, NULL, 20, 20, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
    second = GetDC(parent);
    sameText("stale", "client, the child moved back, same entry", first, second);
    regionText(probeResult, pInquireVisRgn(second));
    probe("stale", "client, the child moved back", probeResult);
    ReleaseDC(parent, second);

    while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
        DispatchMessage(&msg);
    }

    DestroyWindow(child);
    DestroyWindow(parent);
    DestroyWindow(own);
    DestroyWindow(classA);
    DestroyWindow(classB);

    for (i = 0; i < 6; i++) {
        DestroyWindow(windows[i]);
    }

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
