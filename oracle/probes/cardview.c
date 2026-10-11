/*
 * Cardfile's window and its children in its card view, its list view and
 * the card view again: whether a view changes the window's size.
 *
 * The probe starts `CARDFILE.EXE` and waits for its window, the top-level
 * window whose caption begins "Cardfile". In each view it records:
 *
 * * `window`: the window's rectangle on the screen, and its client area's
 *   size;
 * * `child`: each child window, in the order `GetWindow` walks them, its
 *   class, its identifier, whether it shows, and its rectangle in the
 *   window's client area.
 *
 * The views are changed with View's own commands, `WM_COMMAND` 142 (List)
 * and 141 (Card), sent to the window. Then the window is closed.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\CARDVIEW.OUT"

static HWND found;

BOOL CALLBACK _export FindProc(HWND window, LPARAM lParam)
{
    char caption[64];

    GetWindowText(window, caption, sizeof(caption));

    if (_fstrncmp(caption, "Cardfile", 8) == 0) {
        found = window;
        return FALSE;
    }

    (void)lParam;
    return TRUE;
}

static void pump(int rounds)
{
    MSG msg;
    int round;

    for (round = 0; round < rounds; round++) {
        while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
            TranslateMessage(&msg);
            DispatchMessage(&msg);
        }

        Yield();
    }
}

static void report(LPCSTR view, HWND window)
{
    RECT rect;
    RECT client;
    HWND child;
    char name[32];
    char args[64];

    GetWindowRect(window, &rect);
    GetClientRect(window, &client);
    wsprintf(probeResult, "%d,%d,%d,%d client %d,%d", rect.left, rect.top, rect.right,
             rect.bottom, client.right, client.bottom);
    probe("window", view, probeResult);

    for (child = GetWindow(window, GW_CHILD); child; child = GetWindow(child, GW_HWNDNEXT)) {
        GetClassName(child, name, sizeof(name));
        GetWindowRect(child, &rect);
        MapWindowPoints(NULL, window, (POINT FAR *)&rect, 2);
        wsprintf(args, "%s,%s", view, (LPSTR)name);
        wsprintf(probeResult, "id %d %s %d,%d,%d,%d", GetDlgCtrlID(child),
                 IsWindowVisible(child) ? (LPSTR) "shown" : (LPSTR) "hidden", rect.left, rect.top,
                 rect.right, rect.bottom);
        probe("child", args, probeResult);
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    UINT answer;
    int tries;

    probeOpen(OUTPUT);

    answer = WinExec("CARDFILE.EXE", SW_SHOWNORMAL);
    wsprintf(probeResult, "%u", answer >= 32 ? 32 : answer);
    probe("started", "CARDFILE.EXE", probeResult);

    for (tries = 0; tries < 200 && !found; tries++) {
        pump(5);
        EnumWindows(FindProc, 0);
    }

    if (found) {
        pump(50);
        report("card", found);
        SendMessage(found, WM_COMMAND, 142, 0);
        pump(50);
        report("list", found);
        SendMessage(found, WM_COMMAND, 141, 0);
        pump(50);
        report("card again", found);
        PostMessage(found, WM_CLOSE, 0, 0);
        pump(100);
    } else {
        probe("window", "card", "none");
    }

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
