/*
 * What `swplist` and `savebit` share with `swpunc`: windows of classes whose
 * paint and erase draw nothing, each filled black or white through its own
 * context in the order made, and a case's report -- the screen over its
 * windows as bands, each window's update region, and the paint messages sent
 * during the call and from the message loop after (`visprobe.h`).
 *
 * * `screen`: the case; where the screen is black over its area, as bands,
 *   read as the call answers.
 * * `update`: the case and the window; `GetUpdateRgn`'s region, in its
 *   terms, as the call answers.
 * * `ncpaint` (1 for all of it, else 2 for a region), `erase`, `paint`
 *   (`BeginPaint`'s rectangle and `fErase`): the case and the window, in the
 *   order sent, from the call and then from the message loop after it,
 *   `step pump` between; then `screen` again, `after`, once the loop has
 *   painted.
 */

#ifndef SWPHARN_H
#define SWPHARN_H

#define MOVE (SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE)
#define SIZE (SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE)
#define SHOW (SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_SHOWWINDOW)
#define HIDE (SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_HIDEWINDOW)
#define ORDER (SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE)

#define MAXWIN 8

#define POPUP (WS_POPUP | WS_VISIBLE)
#define CHILD (WS_CHILD | WS_VISIBLE)

static HINSTANCE inst;
static HRGN rgn;
static BOOL noting;
static LPCSTR caseName = "";
static HWND wins[MAXWIN];
static BOOL black[MAXWIN];
static int count;
static int areaLeft, areaTop, areaRight, areaBottom;

static void nameOf(HWND hwnd, LPSTR out)
{
    char title[8];

    GetWindowText(hwnd, title, sizeof(title));
    wsprintf(out, "%s %s", caseName, (LPSTR)title);
}

LONG FAR PASCAL _export NoteProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_PAINT) {
        PAINTSTRUCT ps;

        BeginPaint(hwnd, &ps);

        if (noting) {
            nameOf(hwnd, probeArgs);
            wsprintf(probeResult, "%d,%d,%d,%d erase %d", ps.rcPaint.left, ps.rcPaint.top,
                     ps.rcPaint.right, ps.rcPaint.bottom, ps.fErase);
            probe("paint", probeArgs, probeResult);
        }

        EndPaint(hwnd, &ps);
        return 0;
    }

    if (message == WM_ERASEBKGND) {
        if (noting) {
            nameOf(hwnd, probeArgs);
            probe("erase", probeArgs, "sent");
        }

        return 1;
    }

    if (message == WM_NCPAINT && noting) {
        nameOf(hwnd, probeArgs);
        wsprintf(probeResult, "%d", wParam == 1 ? 1 : 2);
        probe("ncpaint", probeArgs, probeResult);
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

static void registerClass(LPCSTR name, UINT style)
{
    WNDCLASS kind;

    kind.style = style;
    kind.lpfnWndProc = NoteProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = inst;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = NULL;
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

/* A case begun: its name and the part of the screen it reads. */
static void begin(LPCSTR name, int left, int top, int right, int bottom)
{
    caseName = name;
    count = 0;
    areaLeft = left;
    areaTop = top;
    areaRight = right;
    areaBottom = bottom;
}

static HWND make(LPCSTR kind, LPCSTR name, DWORD style, HWND parent, int x, int y, int width,
                 int height, BOOL dark)
{
    HWND made = CreateWindow(kind, name, style, x, y, width, height, parent, NULL, inst, NULL);

    wins[count] = made;
    black[count] = dark;
    count++;
    return made;
}

/* One window filled black or white through its own context. */
static void fill(int i)
{
    HDC dc = GetDC(wins[i]);
    RECT box;

    GetClientRect(wins[i], &box);
    PatBlt(dc, 0, 0, box.right, box.bottom, black[i] ? BLACKNESS : WHITENESS);
    ReleaseDC(wins[i], dc);
}

/* Every window of the case painted and filled, in the order made; nothing due. */
static void settle(void)
{
    int i;

    pump();

    for (i = 0; i < count; i++) {
        if (IsWindowVisible(wins[i])) {
            fill(i);
        }
    }

    for (i = 0; i < count; i++) {
        ValidateRect(wins[i], NULL);
    }

    noting = TRUE;
}

/* What the call left: the screen, each window's update region, then what the message loop paints. */
static void report(BOOL destroy)
{
    int i;

    noting = FALSE;
    blackText(probeResult, areaLeft, areaTop, areaRight, areaBottom);
    probe("screen", caseName, probeResult);

    for (i = 0; i < count; i++) {
        char title[8];

        GetWindowText(wins[i], title, sizeof(title));
        wsprintf(probeArgs, "%s %s", caseName, (LPSTR)title);
        GetUpdateRgn(wins[i], rgn, FALSE);
        regionText(probeResult, rgn);
        probe("update", probeArgs, probeResult);
    }

    probe("step", caseName, "pump");
    noting = TRUE;
    pump();
    noting = FALSE;
    blackText(probeResult, areaLeft, areaTop, areaRight, areaBottom);
    wsprintf(probeArgs, "%s after", caseName);
    probe("screen", probeArgs, probeResult);

    if (!destroy) {
        return;
    }

    for (i = count - 1; i >= 0; i--) {
        if (IsWindow(wins[i]) && !GetParent(wins[i])) {
            DestroyWindow(wins[i]);
        }
    }

    pump();
}

static void finish(void)
{
    report(TRUE);
}

#endif
