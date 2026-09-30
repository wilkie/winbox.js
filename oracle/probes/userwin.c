/*
 * USER's calls on windows and menus not yet recorded, each asked once or
 * twice:
 *
 * * `parent`: `SetParent` of a child of `A` to `B`: its answer, whether it
 *   is `A`, `GetParent` after, and where the child is in `B`'s client area.
 * * `owned`: `ShowOwnedPopups` of a window owning a visible pop-up, FALSE
 *   then TRUE: whether the pop-up is visible after each.
 * * `queue`: `GetQueueStatus(QS_ALLINPUT)` with nothing waiting, after a
 *   message posted, and asked again, in hexadecimal.
 * * `appmsg`: `PostAppMessage` to the program's own task: whether it
 *   answered other than nought -- it answers 84h, not 1 -- and the message
 *   `PeekMessage` then takes: its window, message and wParam.
 * * `sysmodal`: `GetSysModalWindow` before, `SetSysModalWindow`'s answer,
 *   `GetSysModalWindow` after, as `A`, `0` or `other`; then set back.
 * * `menu`: `LoadMenuIndirect` of a template of a pop-up "&File" holding
 *   "&Open" (101) and "E&xit" (102), and "&Help" (103): its item count,
 *   its first item's string, its pop-up's count and strings.
 * * `hilite`: `HiliteMenuItem` of "&Help" by command on `A`'s menu bar: its
 *   answer, and `GetMenuState` before and after, in hexadecimal.
 * * `checkmark`: `GetMenuCheckMarkDimensions`, in hexadecimal; and
 *   `SetMenuItemBitmaps`' answer for "&Open".
 * * `clip`: `GetClipCursor` before, after `ClipCursor` of (10, 20)-(300,
 *   200), and after `ClipCursor(NULL)`.
 * * `timer`: `GetTimerResolution`, in decimal.
 * * `arrange`: `ArrangeIconicWindows` of the desktop with none of the
 *   program's windows minimized, then with `C` minimized, then with `D`
 *   minimized too and `C`'s icon moved away: its answers, and where the two
 *   icons are after, on the screen.
 * * `cascade`, `tile`: `CascadeChildWindows` and `TileChildWindows`, found
 *   by `GetProcAddress`, of an MDI-less frame `F` 400 by 300 with three,
 *   four and five children, and one 560 by 420 with three, made in order, each at the top as it is made: each child's
 *   rectangle in `F`'s client area after, the first made first. `client` is
 *   `F`'s client area; `metrics` the caption's height, the sizing frame's
 *   and the border's.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\USERWIN.OUT"

static void number(LPCSTR function, LPCSTR args, DWORD value)
{
    wsprintf(probeResult, "%lx", value);
    probe(function, args, probeResult);
}

static void rectIn(LPCSTR function, LPCSTR args, HWND hwnd, HWND parent)
{
    RECT r;
    POINT a;
    POINT b;

    GetWindowRect(hwnd, &r);
    a.x = r.left;
    a.y = r.top;
    b.x = r.right;
    b.y = r.bottom;

    if (parent) {
        ScreenToClient(parent, &a);
        ScreenToClient(parent, &b);
    }

    wsprintf(probeResult, "%d,%d,%d,%d", a.x, a.y, b.x, b.y);
    probe(function, args, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HWND a;
    HWND b;
    HWND child;
    char text[64];

    probeOpen(OUTPUT);

    kind.style = 0;
    kind.lpfnWndProc = DefWindowProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = LoadIcon(NULL, IDI_APPLICATION);
    kind.hCursor = NULL;
    kind.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "UserWin";
    RegisterClass(&kind);

    a = CreateWindow("UserWin", "A", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 20, 20, 240, 160, NULL,
                     NULL, instance, NULL);
    b = CreateWindow("UserWin", "B", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 300, 40, 240, 160, NULL,
                     NULL, instance, NULL);
    child = CreateWindow("UserWin", "K", WS_CHILD | WS_VISIBLE | WS_BORDER, 10, 12, 50, 30, a,
                         (HMENU)1, instance, NULL);

    {
        HWND old = SetParent(child, b);

        probe("parent", "answer", old == a ? "A" : old ? "other" : "0");
        probe("parent", "GetParent", GetParent(child) == b ? "B" : "other");
        rectIn("parent", "rect", child, b);
    }

    {
        HWND popup = CreateWindow("UserWin", "P", WS_POPUP | WS_VISIBLE | WS_BORDER, 100, 300,
                                  60, 40, a, NULL, instance, NULL);

        ShowOwnedPopups(a, FALSE);
        number("owned", "FALSE", IsWindowVisible(popup));
        ShowOwnedPopups(a, TRUE);
        number("owned", "TRUE", IsWindowVisible(popup));
        DestroyWindow(popup);
    }

    {
        MSG message;

        while (PeekMessage(&message, NULL, 0, 0, PM_REMOVE)) {
            DispatchMessage(&message);
        }

        number("queue", "empty", GetQueueStatus(QS_ALLINPUT));
        PostMessage(a, WM_USER, 1, 2);
        number("queue", "posted", GetQueueStatus(QS_ALLINPUT));
        number("queue", "again", GetQueueStatus(QS_ALLINPUT));

        while (PeekMessage(&message, NULL, 0, 0, PM_REMOVE)) {
            DispatchMessage(&message);
        }

        number("appmsg", "answer", PostAppMessage(GetCurrentTask(), WM_USER + 5, 7, 8) != 0);
        message.hwnd = (HWND)0xffff;
        message.message = 0;
        PeekMessage(&message, NULL, WM_USER + 5, WM_USER + 5, PM_REMOVE);
        wsprintf(probeResult, "%x,%x,%x", message.hwnd, message.message, message.wParam);
        probe("appmsg", "taken", probeResult);
    }

    {
        HWND before = GetSysModalWindow();
        HWND answer = SetSysModalWindow(a);
        HWND after = GetSysModalWindow();

        probe("sysmodal", "before", before == a ? "A" : before ? "other" : "0");
        probe("sysmodal", "answer", answer == a ? "A" : answer ? "other" : "0");
        probe("sysmodal", "after", after == a ? "A" : after ? "other" : "0");
        SetSysModalWindow(NULL);
    }

    {
        static BYTE templ[] = {
            0, 0, 0, 0,                                     /* header */
            0x10, 0, '&', 'F', 'i', 'l', 'e', 0,            /* MF_POPUP "&File" */
            0, 0, 101, 0, '&', 'O', 'p', 'e', 'n', 0,       /* 101 "&Open" */
            0x80, 0, 102, 0, 'E', '&', 'x', 'i', 't', 0,    /* MF_END 102 "E&xit" */
            0x80, 0, 103, 0, '&', 'H', 'e', 'l', 'p', 0,    /* MF_END 103 "&Help" */
        };
        HMENU menu = LoadMenuIndirect(templ);
        HMENU popup;

        number("menu", "count", GetMenuItemCount(menu));
        GetMenuString(menu, 0, text, sizeof(text), MF_BYPOSITION);
        probe("menu", "first", text);
        popup = GetSubMenu(menu, 0);
        number("menu", "popup count", GetMenuItemCount(popup));
        GetMenuString(popup, 0, text, sizeof(text), MF_BYPOSITION);
        probe("menu", "popup first", text);
        GetMenuString(popup, 1, text, sizeof(text), MF_BYPOSITION);
        probe("menu", "popup second", text);

        SetMenu(a, menu);
        number("hilite", "before", GetMenuState(menu, 103, MF_BYCOMMAND));
        number("hilite", "answer", HiliteMenuItem(a, menu, 103, MF_BYCOMMAND | MF_HILITE));
        number("hilite", "after", GetMenuState(menu, 103, MF_BYCOMMAND));
        HiliteMenuItem(a, menu, 103, MF_BYCOMMAND | MF_UNHILITE);
        number("hilite", "unhilited", GetMenuState(menu, 103, MF_BYCOMMAND));

        number("checkmark", "dimensions", GetMenuCheckMarkDimensions());
        {
            HBITMAP check = CreateBitmap(8, 8, 1, 1, NULL);

            number("checkmark", "SetMenuItemBitmaps",
                   SetMenuItemBitmaps(popup, 101, MF_BYCOMMAND, check, check));
            SetMenu(a, NULL);
            DestroyMenu(menu);
            DeleteObject(check);
        }
    }

    {
        RECT r;
        RECT clip;

        GetClipCursor(&r);
        wsprintf(probeResult, "%d,%d,%d,%d", r.left, r.top, r.right, r.bottom);
        probe("clip", "before", probeResult);
        SetRect(&clip, 10, 20, 300, 200);
        ClipCursor(&clip);
        GetClipCursor(&r);
        wsprintf(probeResult, "%d,%d,%d,%d", r.left, r.top, r.right, r.bottom);
        probe("clip", "set", probeResult);
        ClipCursor(NULL);
        GetClipCursor(&r);
        wsprintf(probeResult, "%d,%d,%d,%d", r.left, r.top, r.right, r.bottom);
        probe("clip", "released", probeResult);
    }

    wsprintf(probeResult, "%lu", GetTimerResolution());
    probe("timer", "resolution", probeResult);

    {
        HWND c = CreateWindow("UserWin", "C", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 60, 200, 200,
                              120, NULL, NULL, instance, NULL);

        HWND d = CreateWindow("UserWin", "D", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 80, 220, 200,
                              120, NULL, NULL, instance, NULL);

        number("arrange", "none", ArrangeIconicWindows(GetDesktopWindow()));
        ShowWindow(c, SW_MINIMIZE);
        number("arrange", "one", ArrangeIconicWindows(GetDesktopWindow()));
        ShowWindow(d, SW_MINIMIZE);
        MoveWindow(c, 300, 100, 36, 36, TRUE);
        number("arrange", "two", ArrangeIconicWindows(GetDesktopWindow()));
        rectIn("arrange", "C", c, NULL);
        rectIn("arrange", "D", d, NULL);
        DestroyWindow(d);
        DestroyWindow(c);
    }

    {
        typedef void(FAR PASCAL * ARRANGE)(HWND, UINT);
        HMODULE user = GetModuleHandle("USER");
        ARRANGE cascade = (ARRANGE)GetProcAddress(user, "CASCADECHILDWINDOWS");
        ARRANGE tile = (ARRANGE)GetProcAddress(user, "TILECHILDWINDOWS");
        static const int COUNTS[4] = {3, 4, 5, 3};
        static const int WIDTHS[4] = {400, 400, 400, 560};
        static const int HEIGHTS[4] = {300, 300, 300, 420};
        int round;

        probe("cascade", "found", cascade ? "1" : "0");
        probe("tile", "found", tile ? "1" : "0");
        wsprintf(probeResult, "%d,%d,%d", GetSystemMetrics(SM_CYCAPTION),
                 GetSystemMetrics(SM_CYFRAME), GetSystemMetrics(SM_CYBORDER));
        probe("metrics", "caption,frame,border", probeResult);

        for (round = 0; round < 4; round++) {
            HWND frame = CreateWindow("UserWin", "F", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 0, 0,
                                      WIDTHS[round], HEIGHTS[round], NULL, NULL, instance, NULL);
            HWND kids[5];
            int count = COUNTS[round];
            int index;
            RECT client;

            GetClientRect(frame, &client);
            wsprintf(probeArgs, "%d in %dx%d", count, WIDTHS[round], HEIGHTS[round]);
            wsprintf(probeResult, "%d,%d", client.right, client.bottom);
            probe("client", probeArgs, probeResult);

            for (index = 0; index < count; index++) {
                kids[index] = CreateWindow("UserWin", "W",
                                           WS_CHILD | WS_VISIBLE | WS_CAPTION | WS_THICKFRAME,
                                           5 + index * 7, 5 + index * 9, 100, 80, frame,
                                           (HMENU)(10 + index), instance, NULL);
            }

            if (cascade) {
                cascade(frame, 0);

                for (index = 0; index < count; index++) {
                    wsprintf(text, "%d of %d in %d", index, count, WIDTHS[round]);
                    rectIn("cascade", text, kids[index], frame);
                }
            }

            if (tile) {
                tile(frame, 0);

                for (index = 0; index < count; index++) {
                    wsprintf(text, "%d of %d in %d", index, count, WIDTHS[round]);
                    rectIn("tile", text, kids[index], frame);
                }
            }

            DestroyWindow(frame);
        }
    }

    DestroyWindow(b);
    DestroyWindow(a);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
