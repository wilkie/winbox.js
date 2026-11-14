/*
 * The device context a control hands its owner in `WM_DRAWITEM`: its
 * visible region, its clip region and its window origin. The list box's
 * own is read out (`USER.EXE` seg35 `04bd`-`051d`): `GetDC` of the list,
 * its font selected, `IntersectClipRect` of its client area -- of nothing
 * where it is hidden -- and `SetWindowOrg` to how far it is scrolled
 * across (the word at 38h of its block).
 *
 * P is an overlapped window, 400 by 300 at (40, 40), without
 * `WS_CLIPCHILDREN`, holding L, an owner-drawn list box (fixed rows of 16)
 * 120 by 100 at (10, 10) with a horizontal scroll bar, B, an owner-drawn
 * button 80 by 30 at (150, 10), and C, an owner-drawn drop-down list
 * (fixed rows of 16) 120 wide at (250, 10). Each `WM_DRAWITEM` P is sent,
 * up to forty, is written under the case's name: the control's type, item
 * (not a button's, which is whatever was there) and action; then the
 * context's origin, clip box and visible region (`visprobe.h`), its clip
 * region (`GetClipRgn`, GDI's 173, in the screen's terms), and its window
 * origin. The cases: `shown`, P shown and painted; `selected`, L's second
 * item selected; `scrolled`, L scrolled across by 30 and painted again;
 * `hidden`, L hidden and an item of it redrawn.
 */

#include "probe.h"
#include "visprobe.h"

#define OUTPUT "C:\\ORACLE\\VISITEM.OUT"

static int seen;
static LPCSTR stage = "start";

LRESULT CALLBACK __export Proc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_MEASUREITEM) {
        MEASUREITEMSTRUCT FAR *measure = (MEASUREITEMSTRUCT FAR *)lParam;

        measure->itemHeight = 16;
        return TRUE;
    }

    if (message == WM_DRAWITEM && seen < 40) {
        DRAWITEMSTRUCT FAR *draw = (DRAWITEMSTRUCT FAR *)lParam;
        DWORD org;
        LPSTR at;

        seen++;
        /* A button's item is whatever was there: not written. */
        wsprintf(probeArgs, "type %u item %d action %u", draw->CtlType,
                 draw->CtlType == ODT_BUTTON ? 0 : (int)draw->itemID, draw->itemAction);
        at = probeResult;
        dcText(at, draw->hDC);
        at += lstrlen(at);
        at += wsprintf(at, " cliprgn ");
        regionText(at, pGetClipRgn(draw->hDC));
        at += lstrlen(at);
        org = GetWindowOrg(draw->hDC);
        wsprintf(at, " worg %d,%d rc %d,%d,%d,%d", (int)LOWORD(org), (int)HIWORD(org),
                 draw->rcItem.left, draw->rcItem.top, draw->rcItem.right, draw->rcItem.bottom);
        probe(stage, probeArgs, probeResult);
        return TRUE;
    }

    return DefWindowProc(window, message, wParam, lParam);
}

static void pump(void)
{
    MSG msg;

    while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
        DispatchMessage(&msg);
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HWND p;
    HWND l;
    HWND b;
    HWND c;

    probeOpen(OUTPUT);
    visImports();

    kind.style = 0;
    kind.lpfnWndProc = Proc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "VisItem";
    RegisterClass(&kind);

    p = CreateWindow("VisItem", "P", WS_OVERLAPPEDWINDOW, 40, 40, 400, 300, NULL, NULL, instance,
                     NULL);
    l = CreateWindow("LISTBOX", "",
                     WS_CHILD | WS_VISIBLE | WS_BORDER | WS_HSCROLL | LBS_OWNERDRAWFIXED |
                         LBS_NOINTEGRALHEIGHT,
                     10, 10, 120, 100, p, (HMENU)1, instance, NULL);
    b = CreateWindow("BUTTON", "", WS_CHILD | WS_VISIBLE | BS_OWNERDRAW, 150, 10, 80, 30, p,
                     (HMENU)2, instance, NULL);
    c = CreateWindow("COMBOBOX", "",
                     WS_CHILD | WS_VISIBLE | CBS_DROPDOWNLIST | CBS_OWNERDRAWFIXED, 250, 10, 120,
                     100, p, (HMENU)3, instance, NULL);
    SendMessage(l, LB_ADDSTRING, 0, 1L);
    SendMessage(l, LB_ADDSTRING, 0, 2L);
    SendMessage(l, LB_SETHORIZONTALEXTENT, 400, 0L);
    SendMessage(c, CB_ADDSTRING, 0, 1L);
    SendMessage(c, CB_SETCURSEL, 0, 0L);

    stage = "shown";
    ShowWindow(p, SW_SHOWNORMAL);
    UpdateWindow(p);
    pump();

    stage = "selected";
    SendMessage(l, LB_SETCURSEL, 1, 0L);
    pump();

    stage = "scrolled";
    SendMessage(l, WM_HSCROLL, SB_THUMBPOSITION, MAKELPARAM(30, 0));
    UpdateWindow(l);
    pump();

    stage = "hidden";
    ShowWindow(l, SW_HIDE);
    SendMessage(l, LB_SETCURSEL, 0, 0L);
    pump();

    DestroyWindow(p);
    probeFinish();

    (void)b;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
