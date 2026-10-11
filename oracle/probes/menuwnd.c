/*
 * A menu's pop-ups as windows: USER's class `#32768`, and the windows of it
 * a program can find while a menu is up and after.
 *
 * `W` is an overlapped window at (40, 40), 300 by 200, with a menu bar of
 * one pop-up, File: Open, and More, a pop-up of one item, Sub.
 *
 * Each `wnd` record writes, at a moment of the run:
 *
 * * `first`: `FindWindow("#32768", NULL)` -- `none`, or `self` where it is
 *   the window in front of all, `GetWindow(GetDesktopWindow(), GW_CHILD)`,
 *   else `back`;
 * * then each top-level window of the class `EnumWindows` gives, in order,
 *   as `[n]` its place among all of them, then its rectangle on the screen,
 *   `v` and whether it shows, `o` and its owner -- `W`, `0` for none, `?`
 *   another -- `s` its style and `x` its extended style in hexadecimal; and
 *   whether `WindowFromPoint` at its middle names it, `p1` or `p0`;
 * * and, for `bar`, `sub` and `track`, `idle`: the window the `WM_ENTERIDLE`
 *   `W` was sent named in its `lParam`'s low word -- `found` for the one
 *   `FindWindow` names, `0`, `W`, or `?` and its class -- and the high word.
 *
 * The moments:
 *
 * * `start`: before any menu.
 * * `bar`: File opened with `SC_KEYMENU` and `f`, from its first
 *   `WM_ENTERIDLE`. Then Down and Right are posted, which open More.
 * * `sub`: from the `WM_ENTERIDLE` after, with More open. Then `W` is sent
 *   `WM_CANCELMODE`, which ends the menu.
 * * `after`: once the menu has ended.
 * * `track`: `TrackPopupMenu` with File's pop-up at (100, 100), from its
 *   first `WM_ENTERIDLE`; then `WM_CANCELMODE`.
 * * `after-track`: once it has ended.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\MENUWND.OUT"

/* Each record is closed into the file, so a hang leaves those before it. */
static void record(LPCSTR function, LPCSTR args, LPCSTR result)
{
    probe(function, args, result);
    _lclose(probeHandle);
    probeHandle = _lopen(OUTPUT, OF_WRITE);
    _llseek(probeHandle, 0, 2);
}

#define probe record

static HWND w;
static HMENU file;
static int stage;
static LPARAM idleWindow;
static char text[1500];
static int place;

BOOL FAR PASCAL _export EachWindow(HWND hwnd, LPARAM lParam)
{
    char name[32];
    RECT r;
    HWND owner;
    POINT middle;

    place++;
    GetClassName(hwnd, name, sizeof(name));

    if (lstrcmp(name, "#32768") != 0 || lstrlen(text) > (int)sizeof(text) - 120) {
        return TRUE;
    }

    GetWindowRect(hwnd, &r);
    owner = GetWindow(hwnd, GW_OWNER);
    middle.x = (r.left + r.right) / 2;
    middle.y = (r.top + r.bottom) / 2;
    wsprintf(text + lstrlen(text), " [%d]%d,%d,%d,%d v%d o%s s%lx x%lx p%d", place, r.left,
             r.top, r.right, r.bottom, IsWindowVisible(hwnd),
             (LPSTR)(owner == w ? "W" : owner == NULL ? "0" : "?"),
             GetWindowLong(hwnd, GWL_STYLE), GetWindowLong(hwnd, GWL_EXSTYLE),
             WindowFromPoint(middle) == hwnd);
    (void)lParam;
    return TRUE;
}

static void describe(LPCSTR name, BOOL idle)
{
    HWND found = FindWindow("#32768", NULL);
    FARPROC each = MakeProcInstance((FARPROC)EachWindow, GetWindowWord(w, GWW_HINSTANCE));

    if (found == NULL) {
        lstrcpy(text, "none");
    } else {
        lstrcpy(text, found == GetWindow(GetDesktopWindow(), GW_CHILD) ? "self" : "back");
    }

    place = 0;
    EnumWindows((WNDENUMPROC)each, 0);
    FreeProcInstance(each);

    if (idle) {
        HWND named = (HWND)LOWORD(idleWindow);
        char other[32];

        if (named == found) {
            lstrcpy(other, "found");
        } else if (named == NULL) {
            lstrcpy(other, "0");
        } else if (named == w) {
            lstrcpy(other, "W");
        } else {
            other[0] = '?';
            GetClassName(named, other + 1, sizeof(other) - 1);
        }

        wsprintf(text + lstrlen(text), " idle=%s,%x", (LPSTR)other, HIWORD(idleWindow));
    }

    probe("wnd", name, text);
}

LONG FAR PASCAL _export Proc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_ENTERIDLE && wParam == MSGF_MENU) {
        idleWindow = lParam;

        if (stage == 1) {
            stage = 2;
            describe("bar", TRUE);
            PostMessage(hwnd, WM_KEYDOWN, VK_DOWN, 0L);
            PostMessage(hwnd, WM_KEYDOWN, VK_RIGHT, 0L);
        } else if (stage == 2) {
            stage = 3;
            describe("sub", TRUE);
            SendMessage(hwnd, WM_CANCELMODE, 0, 0L);
        } else if (stage == 4) {
            stage = 5;
            describe("track", TRUE);
            SendMessage(hwnd, WM_CANCELMODE, 0, 0L);
        }

        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

static void pump(void)
{
    MSG message;
    int count = 0;

    while (count < 200 && PeekMessage(&message, NULL, 0, 0, PM_REMOVE)) {
        TranslateMessage(&message);
        DispatchMessage(&message);
        count++;
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HMENU bar;
    HMENU more;

    probeOpen(OUTPUT);

    kind.style = 0;
    kind.lpfnWndProc = Proc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = LoadCursor(NULL, IDC_ARROW);
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "MenuWnd";
    RegisterClass(&kind);

    /* The pointer out of the way. */
    ShowCursor(FALSE);
    SetCursorPos(639, 479);

    more = CreatePopupMenu();
    AppendMenu(more, MF_STRING, 201, "&Sub");
    file = CreatePopupMenu();
    AppendMenu(file, MF_STRING, 101, "&Open");
    AppendMenu(file, MF_POPUP, (UINT)more, "&More");
    bar = CreateMenu();
    AppendMenu(bar, MF_POPUP, (UINT)file, "&File");

    w = CreateWindow("MenuWnd", "W", WS_OVERLAPPEDWINDOW, 40, 40, 300, 200, NULL, bar, instance,
                     NULL);
    ShowWindow(w, SW_SHOWNORMAL);
    UpdateWindow(w);
    pump();

    describe("start", FALSE);

    stage = 1;
    SendMessage(w, WM_SYSCOMMAND, SC_KEYMENU, (LPARAM)'f');
    pump();
    describe("after", FALSE);

    stage = 4;
    TrackPopupMenu(file, 0, 100, 100, 0, w, NULL);
    pump();
    describe("after-track", FALSE);

    DestroyWindow(w);
    pump();
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
