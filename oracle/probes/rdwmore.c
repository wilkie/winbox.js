/*
 * What is left of RedrawWindow's body after `rdwwalk` (`USER.EXE` seg1
 * `3e1e`, `3ed7`, `4202`, `441d`): a window's paint taken without
 * BeginPaint, the lock told of a frame, the desktop, and a window made due
 * by another task.
 *
 * Every window is of a class whose erase draws nothing; its paint calls
 * BeginPaint and logs `paint` with `rcPaint` and `fErase`, but in the modes
 * below. Logged in order: `ncpaint` (1 for all of it, else 2), `erase`,
 * `paint`, `nobegin`; `update`, the window's `GetUpdateRgn` region in its
 * terms; `step` between parts.
 *
 * The cases:
 *
 * * `nobegin`: W, a pop-up with WS_BORDER 120 by 80 at (300, 40), made due
 *   all over, erase and frame (RDW_INVALIDATE | RDW_ERASE | RDW_FRAME), and
 *   UpdateWindow'd while its paint returns nought without BeginPaint
 *   (`nobegin`): seg1 `447f`, `44b5` then send what is due of the frame and
 *   the erase through `7913`. Its update region after, then the message
 *   loop with its paint as usual. `noval`: its paint calls ValidateRect of
 *   all of it instead. `rdwnow`: as `nobegin`, by RDW_UPDATENOW.
 * * `lockfr`: P, a pop-up 200 by 120 at (40, 250); its child C with
 *   WS_BORDER 80 by 50 at (20, 20); Q, a pop-up 100 by 60 at (300, 250). C
 *   locked by LockWindowUpdate, given RedrawWindow with RDW_INVALIDATE |
 *   RDW_FRAME, unlocked: each window's update region, then the loop. The
 *   lock is told the window's whole rectangle with RDW_FRAME (seg1
 *   `3edd`-`3efc`, `3f41`-`3f7c`). `lockcl`: without RDW_FRAME.
 * * `desk`: the screen from (560, 400) to (600, 440), where no window is,
 *   blackened through the screen's context, and RedrawWindow of no window
 *   with that rectangle and RDW_INVALIDATE | RDW_ERASE: where it is black
 *   at once (`screen`), whether the desktop window is due (`deskdue`,
 *   GetUpdateRect's answer and rectangle), then after the loop. `desknow`:
 *   with RDW_ERASENOW too.
 * * `other`: W2, a pop-up 120 by 80 at (300, 160), made due all over by the
 *   window of RDWMOREC.EXE (`rdwmore.child.c`), another task, through
 *   InvalidateRect, and at once ValidateRect of it by the probe -- before
 *   GetUpdateRgn, which takes the flag 20h off (seg1 `4684`, `47a3`): its
 *   update region; ValidateRect again, its update region; the loop (seg1
 *   `4242`-`424c`, `4315`-`4320`). `othrdw`: RedrawWindow with RDW_VALIDATE
 *   for the first ValidateRect. `theirs`: validated by the other task.
 *   `self`: made due by the probe itself, then ValidateRect.
 */

#include "probe.h"
#include "visprobe.h"

#define OUTPUT "C:\\ORACLE\\RDWMORE.OUT"

#define POPUP (WS_POPUP | WS_VISIBLE)

static HINSTANCE inst;
static HRGN rgn;
static BOOL noting;
static int mode;
static LPCSTR caseName = "";

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

        if (mode) {
            if (noting) {
                nameOf(hwnd, probeArgs);
                probe("nobegin", probeArgs, mode == 2 ? "validate" : "none");
            }

            if (mode == 2) {
                ValidateRect(hwnd, NULL);
            }

            return 0;
        }

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

static void pump(void)
{
    MSG msg;

    while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
        DispatchMessage(&msg);
    }
}

static HWND make(LPCSTR name, DWORD style, HWND parent, int x, int y, int width, int height)
{
    return CreateWindow("RdwMoreW", name, style, x, y, width, height, parent, NULL, inst, NULL);
}

/* Everything painted and nothing due; then noting. */
static void settle(LPCSTR name)
{
    noting = FALSE;
    mode = 0;
    pump();
    caseName = name;
    noting = TRUE;
}

static void update(HWND hwnd)
{
    noting = FALSE;
    nameOf(hwnd, probeArgs);
    GetUpdateRgn(hwnd, rgn, FALSE);
    regionText(probeResult, rgn);
    probe("update", probeArgs, probeResult);
    noting = TRUE;
}

static void step(LPCSTR what)
{
    probe("step", caseName, what);
}

static void loop(void)
{
    step("pump");
    mode = 0;
    pump();
}

static void noBegin(LPCSTR name, int how, UINT more)
{
    HWND w = make("W", POPUP | WS_BORDER, NULL, 300, 40, 120, 80);

    settle(name);
    mode = how;

    if (more) {
        RedrawWindow(w, NULL, NULL, RDW_INVALIDATE | RDW_ERASE | RDW_FRAME | more);
    } else {
        RedrawWindow(w, NULL, NULL, RDW_INVALIDATE | RDW_ERASE | RDW_FRAME);
        step("update");
        UpdateWindow(w);
    }

    mode = 0;
    update(w);
    loop();
    update(w);
    noting = FALSE;
    DestroyWindow(w);
    pump();
}

static void lockFrame(LPCSTR name, UINT frame)
{
    HWND p = make("P", POPUP, NULL, 40, 250, 200, 120);
    HWND c = make("C", WS_CHILD | WS_VISIBLE | WS_BORDER, p, 20, 20, 80, 50);
    HWND q = make("Q", POPUP, NULL, 300, 250, 100, 60);

    settle(name);
    LockWindowUpdate(c);
    RedrawWindow(c, NULL, NULL, RDW_INVALIDATE | frame);
    update(c);
    step("unlock");
    LockWindowUpdate(NULL);
    update(p);
    update(c);
    update(q);
    loop();
    noting = FALSE;
    DestroyWindow(q);
    DestroyWindow(p);
    pump();
}

static void desk(LPCSTR name, UINT more)
{
    HDC screen;
    RECT rect;
    int answer;

    settle(name);
    noting = FALSE;
    screen = GetDC(NULL);
    PatBlt(screen, 560, 400, 40, 40, BLACKNESS);
    ReleaseDC(NULL, screen);
    noting = TRUE;
    SetRect(&rect, 560, 400, 600, 440);
    RedrawWindow(NULL, &rect, NULL, RDW_INVALIDATE | RDW_ERASE | more);
    blackText(probeResult, 560, 400, 600, 440);
    probe("screen", caseName, probeResult);
    answer = GetUpdateRect(GetDesktopWindow(), &rect, FALSE);
    wsprintf(probeResult, "%d %d,%d,%d,%d", answer, rect.left, rect.top, rect.right, rect.bottom);
    probe("deskdue", caseName, probeResult);
    loop();
    blackText(probeResult, 560, 400, 600, 440);
    wsprintf(probeArgs, "%s after", caseName);
    probe("screen", probeArgs, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HWND r = NULL;
    HWND w2;
    int i;

    inst = instance;
    probeOpen(OUTPUT);
    rgn = CreateRectRgn(0, 0, 0, 0);
    visImports();

    kind.style = 0;
    kind.lpfnWndProc = NoteProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = inst;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = NULL;
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "RdwMoreW";
    RegisterClass(&kind);

    noBegin("nobegin", 1, 0);
    noBegin("noval", 2, 0);
    noBegin("rdwnow", 1, RDW_UPDATENOW);
    lockFrame("lockfr", RDW_FRAME);
    lockFrame("lockcl", 0);
    desk("desk", 0);
    desk("desknow", RDW_ERASENOW);

    WinExec("RDWMOREC.EXE", SW_HIDE);

    for (i = 0; i < 200 && !r; i++) {
        pump();
        Yield();
        r = FindWindow(NULL, "Probe R");
    }

    probe("started", "R", (LPSTR)(r ? "yes" : "no"));

    if (r) {
        w2 = make("W2", POPUP, NULL, 300, 160, 120, 80);
        settle("other");
        SendMessage(r, WM_USER + 1, (WPARAM)w2, 0);
        ValidateRect(w2, NULL);
        update(w2);
        step("again");
        ValidateRect(w2, NULL);
        update(w2);
        loop();

        settle("othrdw");
        SendMessage(r, WM_USER + 1, (WPARAM)w2, 0);
        RedrawWindow(w2, NULL, NULL, RDW_VALIDATE);
        update(w2);
        loop();

        settle("theirs");
        SendMessage(r, WM_USER + 1, (WPARAM)w2, 0);
        SendMessage(r, WM_USER + 2, (WPARAM)w2, 0);
        update(w2);
        loop();

        settle("self");
        InvalidateRect(w2, NULL, FALSE);
        update(w2);
        step("validate");
        ValidateRect(w2, NULL);
        update(w2);
        loop();
        noting = FALSE;
        DestroyWindow(w2);
        SendMessage(r, WM_CLOSE, 0, 0);
        pump();
    }

    DeleteObject(rgn);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
