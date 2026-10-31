/*
 * The bits USER saves under a window of a class with CS_SAVEBITS, and puts
 * back as it is hidden or moved off them (`USER.EXE` seg7 `0b75`-`0bde`,
 * seg13 `1e72`; seg7 `076d`-`07f3`, seg13 `211e`), kept in the display
 * driver through its SaveScreenBitmap where it can (`[0x184]`, seg13
 * `1f5e`-`1f7b`), and let go as the window is moved without being hidden
 * (seg7 `088f`-`08b3`). What a window behind it draws, and what is made due
 * there, spoils them (seg1 `074e`, `079a`, `087b`; seg1 `3f41`-`3f7c`).
 *
 * W, a pop-up 200 by 150 at (300, 40), white, of a class whose paint and
 * erase draw nothing (`swpharn.h`); S, a pop-up 80 by 60 at (350, 90) of
 * the same procedure and CS_SAVEBITS, made hidden, shown by SetWindowPos
 * with SWP_SHOWWINDOW, its messages taken and then filled black. Each case
 * then does its own and hides S with SWP_HIDEWINDOW, and reports. A pixel
 * where S was that is black after is one not put back.
 *
 * The cases:
 *
 * * `same`: nothing between.
 * * `drawn`: W filled black from (40, 40) to (70, 70) of its client area
 *   through GetDC, a corner under S. `drawoff`: from (0, 0) to (20, 20),
 *   nowhere under S.
 * * `inval`: InvalidateRect of W from (60, 60) to (90, 90), under S,
 *   without an erase.
 * * `moved`: S moved to (370, 110) by SetWindowPos. `noz`: S given
 *   SetWindowPos with SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER and
 *   SWP_NOACTIVATE, nothing else.
 * * `cover`: V, a pop-up 80 by 60 at (400, 120) of the plain class, made
 *   shown over S's corner and filled white.
 * * `two`: S2, a second pop-up of the saving class 60 by 40 at (380, 60),
 *   shown and filled black after S; S2 hidden and reported, then S hidden
 *   and reported (`two2`).
 */

#include "probe.h"
#include "visprobe.h"
#include "swpharn.h"

#define OUTPUT "C:\\ORACLE\\SAVEBIT.OUT"

static HWND w, s;

static void up(LPCSTR name)
{
    begin(name, 300, 40, 500, 190);
    w = make("SaveBitW", "W", POPUP, NULL, 300, 40, 200, 150, FALSE);
    s = make("SaveBitS", "S", WS_POPUP, NULL, 350, 90, 80, 60, TRUE);
    settle();
    noting = FALSE;
    SetWindowPos(s, NULL, 0, 0, 0, 0, SHOW);
    pump();
    fill(1);
    ValidateRect(w, NULL);
    ValidateRect(s, NULL);
    noting = TRUE;
}

static void blacken(HWND hwnd, int left, int top, int right, int bottom)
{
    HDC dc = GetDC(hwnd);

    PatBlt(dc, left, top, right - left, bottom - top, BLACKNESS);
    ReleaseDC(hwnd, dc);
}

static void down(void)
{
    SetWindowPos(s, NULL, 0, 0, 0, 0, HIDE);
    finish();
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    RECT rect;
    HWND s2;

    inst = instance;
    probeOpen(OUTPUT);
    rgn = CreateRectRgn(0, 0, 0, 0);
    visImports();
    registerClass("SaveBitW", 0);
    registerClass("SaveBitS", CS_SAVEBITS);

    up("same");
    down();

    up("drawn");
    blacken(w, 40, 40, 70, 70);
    down();

    up("drawoff");
    blacken(w, 0, 0, 20, 20);
    down();

    up("inval");
    SetRect(&rect, 60, 60, 90, 90);
    InvalidateRect(w, &rect, FALSE);
    down();

    up("moved");
    SetWindowPos(s, NULL, 370, 110, 0, 0, MOVE);
    down();

    up("noz");
    SetWindowPos(s, NULL, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
    down();

    up("cover");
    noting = FALSE;
    make("SaveBitW", "V", POPUP, NULL, 400, 120, 80, 60, FALSE);
    pump();
    fill(2);
    ValidateRect(wins[2], NULL);
    noting = TRUE;
    down();

    up("two");
    noting = FALSE;
    s2 = make("SaveBitS", "S2", WS_POPUP, NULL, 380, 60, 60, 40, TRUE);
    SetWindowPos(s2, NULL, 0, 0, 0, 0, SHOW);
    pump();
    fill(2);
    ValidateRect(s2, NULL);
    noting = TRUE;
    SetWindowPos(s2, NULL, 0, 0, 0, 0, HIDE);
    report(FALSE);
    caseName = "two2";
    down();

    DeleteObject(rgn);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
