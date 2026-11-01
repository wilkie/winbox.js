/*
 * A list of windows placed in one call (`EndDeferWindowPos`, `USER.EXE`
 * seg7 `0526`): the visible regions of all of them as they were taken
 * before any moves (`09a0`), all placed (`0a33`), and then window by
 * window what is copied -- less what the windows before it in the list
 * copied, taken where its bits come from (`066e`-`068c`) -- and what is made
 * due, less what every window so far copied (`082a`-`088c`), gathered and
 * made due once through the parent of the first window (`0939`-`0958`). And
 * windows at the top shown, hidden and put elsewhere in the order of
 * windows, alone and in a list, by the same rule (`swpharn.h`).
 *
 * The cases:
 *
 * * `chain`: Q, a pop-up 240 by 140 at (300, 250) with WS_CLIPCHILDREN,
 *   filled black; its children A at (10, 10), white, and B at (60, 10),
 *   black, each 40 by 30, made in that order and without WS_CLIPSIBLINGS. A
 *   moved to (60, 10), where B was, and B to (110, 10), in that order in one
 *   DeferWindowPos: B's bits come from where A's went. `chain2`: the same,
 *   B first in the list.
 * * `swap`: Z, a pop-up 300 by 150 at (40, 40), white; X, 80 by 60 at
 *   (60, 60), black, and Y, 80 by 60 at (220, 60), white, pop-ups over it.
 *   X moved to (220, 60) and Y to (60, 60) in one list. `swap2`: Y first.
 * * `pair`: Z as above; X at (60, 60) and Y at (100, 90), 80 by 60, Y over
 *   X; both moved 120 right in one list, X first. `pair2`: Y first.
 * * `hideshow`: W, a pop-up 200 by 150 at (300, 40), white; T1, 80 by 60
 *   at (330, 70), black, over it; T2, hidden, 80 by 60 at (370, 110),
 *   black. T1 hidden and T2 shown in one list.
 * * `top`: W as above; R1 at (330, 70) and R2 at (370, 110), 80 by 60, R2
 *   over R1, R1 black and R2 white. R1 put at the top with
 *   SWP_NOACTIVATE by SetWindowPos. `bottom`: R2 put at the bottom.
 *   `toplist`: R1 put at the top and R2 after R1, in one list.
 * * `hidetop`: R2 hidden by SetWindowPos; `showtop`: shown again.
 */

#include "probe.h"
#include "visprobe.h"
#include "swpharn.h"

#ifndef OUTPUT
#define OUTPUT "C:\\ORACLE\\SWPLIST.OUT"
#endif

static void chain(LPCSTR name, BOOL bFirst)
{
    HWND a, b;
    HDWP defer;

    begin(name, 300, 250, 540, 390);
    make("SwpListW", "Q", POPUP | WS_CLIPCHILDREN, NULL, 300, 250, 240, 140, TRUE);
    a = make("SwpListW", "A", CHILD, wins[0], 10, 10, 40, 30, FALSE);
    b = make("SwpListW", "B", CHILD, wins[0], 60, 10, 40, 30, TRUE);
    settle();
    defer = BeginDeferWindowPos(2);

    if (bFirst) {
        defer = DeferWindowPos(defer, b, NULL, 110, 10, 0, 0, MOVE);
        defer = DeferWindowPos(defer, a, NULL, 60, 10, 0, 0, MOVE);
    } else {
        defer = DeferWindowPos(defer, a, NULL, 60, 10, 0, 0, MOVE);
        defer = DeferWindowPos(defer, b, NULL, 110, 10, 0, 0, MOVE);
    }

    EndDeferWindowPos(defer);
    finish();
}

static void two(LPCSTR name, int xx, int xy, int yx, int yy, int dx, int dy, BOOL yFirst)
{
    HWND x, y;
    HDWP defer;

    begin(name, 40, 40, 400, 190);
    make("SwpListW", "Z", POPUP, NULL, 40, 40, 300, 150, FALSE);
    x = make("SwpListW", "X", POPUP, NULL, xx, xy, 80, 60, TRUE);
    y = make("SwpListW", "Y", POPUP, NULL, yx, yy, 80, 60, FALSE);
    settle();
    defer = BeginDeferWindowPos(2);

    if (yFirst) {
        defer = DeferWindowPos(defer, y, NULL, yx + dx, yy + dy, 0, 0, MOVE);
        defer = DeferWindowPos(defer, x, NULL, xx + dx, xy + dy, 0, 0, MOVE);
    } else {
        defer = DeferWindowPos(defer, x, NULL, xx + dx, xy + dy, 0, 0, MOVE);
        defer = DeferWindowPos(defer, y, NULL, yx + dx, yy + dy, 0, 0, MOVE);
    }

    EndDeferWindowPos(defer);
    finish();
}

static void swap(LPCSTR name, BOOL yFirst)
{
    HWND x, y;
    HDWP defer;

    begin(name, 40, 40, 400, 190);
    make("SwpListW", "Z", POPUP, NULL, 40, 40, 300, 150, FALSE);
    x = make("SwpListW", "X", POPUP, NULL, 60, 60, 80, 60, TRUE);
    y = make("SwpListW", "Y", POPUP, NULL, 220, 60, 80, 60, FALSE);
    settle();
    defer = BeginDeferWindowPos(2);

    if (yFirst) {
        defer = DeferWindowPos(defer, y, NULL, 60, 60, 0, 0, MOVE);
        defer = DeferWindowPos(defer, x, NULL, 220, 60, 0, 0, MOVE);
    } else {
        defer = DeferWindowPos(defer, x, NULL, 220, 60, 0, 0, MOVE);
        defer = DeferWindowPos(defer, y, NULL, 60, 60, 0, 0, MOVE);
    }

    EndDeferWindowPos(defer);
    finish();
}

static void hideShow(void)
{
    HWND t1, t2;
    HDWP defer;

    begin("hideshow", 300, 40, 500, 190);
    make("SwpListW", "W", POPUP, NULL, 300, 40, 200, 150, FALSE);
    t1 = make("SwpListW", "T1", POPUP, NULL, 330, 70, 80, 60, TRUE);
    t2 = make("SwpListW", "T2", WS_POPUP, NULL, 370, 110, 80, 60, TRUE);
    settle();
    defer = BeginDeferWindowPos(2);
    defer = DeferWindowPos(defer, t1, NULL, 0, 0, 0, 0, HIDE);
    defer = DeferWindowPos(defer, t2, NULL, 0, 0, 0, 0, SHOW);
    EndDeferWindowPos(defer);
    finish();
}

static HWND r1, r2;

static void stacked(LPCSTR name)
{
    begin(name, 300, 40, 500, 190);
    make("SwpListW", "W", POPUP, NULL, 300, 40, 200, 150, FALSE);
    r1 = make("SwpListW", "R1", POPUP, NULL, 330, 70, 80, 60, TRUE);
    r2 = make("SwpListW", "R2", POPUP, NULL, 370, 110, 80, 60, FALSE);
    settle();
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HDWP defer;

    inst = instance;
    probeOpen(OUTPUT);
    rgn = CreateRectRgn(0, 0, 0, 0);
    visImports();
    registerClass("SwpListW", 0);

    chain("chain", FALSE);
    chain("chain2", TRUE);
    swap("swap", FALSE);
    swap("swap2", TRUE);
    two("pair", 60, 60, 100, 90, 120, 0, FALSE);
    two("pair2", 60, 60, 100, 90, 120, 0, TRUE);
    hideShow();

    stacked("top");
    SetWindowPos(r1, HWND_TOP, 0, 0, 0, 0, ORDER);
    finish();

    stacked("bottom");
    SetWindowPos(r2, HWND_BOTTOM, 0, 0, 0, 0, ORDER);
    finish();

    stacked("toplist");
    defer = BeginDeferWindowPos(2);
    defer = DeferWindowPos(defer, r1, HWND_TOP, 0, 0, 0, 0, ORDER);
    defer = DeferWindowPos(defer, r2, r1, 0, 0, 0, 0, ORDER);
    EndDeferWindowPos(defer);
    finish();

    stacked("hidetop");
    SetWindowPos(r2, NULL, 0, 0, 0, 0, HIDE);
    report(FALSE);
    caseName = "showtop";
    settle();
    SetWindowPos(r2, NULL, 0, 0, 0, 0, SHOW);
    finish();

    DeleteObject(rgn);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
