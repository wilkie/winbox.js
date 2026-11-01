/*
 * What is left of USER's painting calls and its hit test after `rdwmore`
 * and `wfpwalk`: InvalidateRect and InvalidateRgn of no window, the bErase
 * of GetUpdateRect and GetUpdateRgn, the records USER keeps told what is
 * made due of the desktop, and a system-modal window that answers
 * HTTRANSPARENT.
 *
 * Every window is of a class whose erase draws nothing; its paint calls
 * BeginPaint and logs `paint` with `rcPaint` and `fErase`. Logged in order:
 * `ncpaint` (1 for all of it, else 2), `erase`, `paint`; `update`, the
 * window's GetUpdateRgn region in its terms; `step` between parts. Each
 * record's arguments end with its number within the case, for the order.
 *
 * The cases, each with W, a pop-up with WS_BORDER 120 by 80 at (300, 40):
 *
 * * `invnull`: InvalidateRect of no window, a rectangle (0, 0, 10, 10) and
 *   bErase FALSE -- RedrawWindow of no window, no rectangle, with 285h
 *   (`USER.EXE` seg1 `aa27`, `014c`-`0176`): what W is sent in the call, its
 *   update region, then the loop.
 * * `rgnnull`: InvalidateRgn of no window, a region and TRUE: the handle
 *   refused (seg1 `aa6d`, `ae6d`).
 * * `berase`: W made due all over with an erase, then GetUpdateRect with
 *   bErase TRUE: what it is sent in the call (seg1 `466f`-`467c`, `7913`),
 *   its answer and rectangle, its update region, the loop. `bernoe`: made
 *   due without an erase. `bergn`: GetUpdateRgn with TRUE (`478e`-`479b`).
 *   `berect0`: GetUpdateRect with FALSE, as before.
 * * `desklock`: W locked by LockWindowUpdate, the desktop made due through
 *   RedrawWindow of no window with (320, 60, 360, 100) and RDW_INVALIDATE,
 *   W unlocked: W's update region, then the loop -- the lock told what is
 *   made due of the desktop (seg1 `3f41`-`3f7c`). `deskall`: of no
 *   rectangle.
 * * `desksave`: S, a pop-up of a class with CS_SAVEBITS, 60 by 40 at
 *   (330, 60), shown over W; the desktop made due under it (320, 60, 400,
 *   100); S hidden: W's update region, then the loop.
 * * `modal`: M, a pop-up 100 by 60 at (40, 300), made system-modal, its
 *   procedure answering HTTRANSPARENT: WindowFromPoint in M, in W, and
 *   where no window is (`wfp`, the window's name, 0 for none, `D` for the
 *   desktop window) -- the walk begun at M ends at no window (seg1
 *   `7282`-`7285`, `71c6`). `modalc`: M answering HTCLIENT.
 */

#include "probe.h"
#include "visprobe.h"

#define OUTPUT "C:\\ORACLE\\UWLEFT.OUT"

#define POPUP (WS_POPUP | WS_VISIBLE)

static HINSTANCE inst;
static HRGN rgn;
static BOOL noting;
static BOOL transparent;
static LPCSTR caseName = "";
static HWND wModal;
static int seq;

static void nameOf(HWND hwnd, LPSTR out)
{
    char title[8];

    GetWindowText(hwnd, title, sizeof(title));
    wsprintf(out, "%s %s %d", caseName, (LPSTR)title, seq++);
}

LONG FAR PASCAL _export NoteProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_NCHITTEST && hwnd == wModal) {
        return transparent ? HTTRANSPARENT : HTCLIENT;
    }

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

static void pump(void)
{
    MSG msg;

    while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
        DispatchMessage(&msg);
    }
}

static HWND make(LPCSTR kind, LPCSTR name, DWORD style, int x, int y, int width, int height)
{
    return CreateWindow(kind, name, style, x, y, width, height, NULL, NULL, inst, NULL);
}

/* Everything painted and nothing due; then noting. */
static void settle(LPCSTR name)
{
    noting = FALSE;
    pump();
    caseName = name;
    seq = 0;
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
    wsprintf(probeArgs, "%s %d", caseName, seq++);
    probe("step", probeArgs, what);
}

static void loop(void)
{
    step("pump");
    pump();
}

static void done(HWND w)
{
    noting = FALSE;
    DestroyWindow(w);
    pump();
}

static void invNull(void)
{
    HWND w = make("UwLeftW", "W", POPUP | WS_BORDER, 300, 40, 120, 80);
    RECT rect;

    settle("invnull");
    SetRect(&rect, 0, 0, 10, 10);
    InvalidateRect(NULL, &rect, FALSE);
    step("update");
    update(w);
    loop();
    update(w);

    settle("rgnnull");
    SetRectRgn(rgn, 0, 0, 10, 10);
    InvalidateRgn(NULL, rgn, TRUE);
    step("update");
    update(w);
    loop();
    done(w);
}

static void bErase(LPCSTR name, BOOL erase, int how)
{
    HWND w = make("UwLeftW", "W", POPUP | WS_BORDER, 300, 40, 120, 80);
    RECT rect;
    int answer;

    settle(name);
    InvalidateRect(w, NULL, erase);
    step("ask");

    if (how == 1) {
        answer = GetUpdateRgn(w, rgn, TRUE);
        wsprintf(probeResult, "%d", answer);
    } else {
        SetRect(&rect, -1, -1, -1, -1);
        answer = GetUpdateRect(w, &rect, how == 0);
        wsprintf(probeResult, "%d %d,%d,%d,%d", answer, rect.left, rect.top, rect.right,
                 rect.bottom);
    }

    wsprintf(probeArgs, "%s %d", caseName, seq++);
    probe("asked", probeArgs, probeResult);
    update(w);
    loop();
    update(w);
    done(w);
}

static void deskLock(LPCSTR name, BOOL whole)
{
    HWND w = make("UwLeftW", "W", POPUP | WS_BORDER, 300, 40, 120, 80);
    RECT rect;

    settle(name);
    LockWindowUpdate(w);
    SetRect(&rect, 320, 60, 360, 100);
    RedrawWindow(NULL, whole ? NULL : &rect, NULL, RDW_INVALIDATE);
    step("unlock");
    LockWindowUpdate(NULL);
    update(w);
    loop();
    update(w);
    done(w);
}

static void deskSave(void)
{
    HWND w = make("UwLeftW", "W", POPUP | WS_BORDER, 300, 40, 120, 80);
    HWND s;
    RECT rect;

    settle("desksave");
    noting = FALSE;
    s = make("UwLeftS", "S", POPUP, 330, 60, 60, 40);
    pump();
    noting = TRUE;
    SetRect(&rect, 320, 60, 400, 100);
    RedrawWindow(NULL, &rect, NULL, RDW_INVALIDATE);
    step("hide");
    ShowWindow(s, SW_HIDE);
    update(w);
    loop();
    update(w);
    noting = FALSE;
    DestroyWindow(s);
    done(w);
}

static void wfp(HWND w, int x, int y)
{
    POINT pt;
    HWND found;
    char name[16];

    pt.x = x;
    pt.y = y;
    found = WindowFromPoint(pt);

    if (!found) {
        lstrcpy(name, "0");
    } else if (found == GetDesktopWindow()) {
        lstrcpy(name, "D");
    } else if (found == w || found == wModal) {
        GetWindowText(found, name, sizeof(name));
    } else {
        lstrcpy(name, "?");
    }

    wsprintf(probeArgs, "%s %d,%d", caseName, x, y);
    probe("wfp", probeArgs, name);
}

static void modal(LPCSTR name, BOOL answer)
{
    HWND w = make("UwLeftW", "W", POPUP | WS_BORDER, 300, 40, 120, 80);

    noting = FALSE;
    wModal = make("UwLeftW", "M", POPUP, 40, 300, 100, 60);
    settle(name);
    transparent = answer;
    SetSysModalWindow(wModal);
    wfp(w, 60, 320);
    wfp(w, 350, 70);
    wfp(w, 600, 450);
    SetSysModalWindow(NULL);
    transparent = FALSE;
    noting = FALSE;
    DestroyWindow(wModal);
    wModal = NULL;
    done(w);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;

    inst = instance;
    probeOpen(OUTPUT);
    rgn = CreateRectRgn(0, 0, 0, 0);

    kind.style = 0;
    kind.lpfnWndProc = NoteProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = inst;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = NULL;
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "UwLeftW";
    RegisterClass(&kind);

    kind.style = CS_SAVEBITS;
    kind.lpszClassName = "UwLeftS";
    RegisterClass(&kind);

    invNull();
    bErase("berase", TRUE, 0);
    bErase("bernoe", FALSE, 0);
    bErase("bergn", TRUE, 1);
    bErase("berect0", TRUE, 2);
    deskLock("desklock", FALSE);
    deskLock("deskall", TRUE);
    deskSave();
    modal("modal", TRUE);
    modal("modalc", FALSE);

    DeleteObject(rgn);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
