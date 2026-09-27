/*
 * Small functions programs call on their way up.
 *
 * * `menu`: a menu of four items -- a command, a separator, a pop-up of two
 *   commands, a command -- asked about with `GetMenuItemCount`,
 *   `GetMenuItemID`, `GetMenuState` and `GetMenuString`, and taken apart with
 *   `RemoveMenu` and `DeleteMenu`: what each answered.
 * * `ansi`: `AnsiUpperBuff` and `AnsiLowerBuff` over a buffer, what they
 *   answered and the buffer after, as hexadecimal bytes.
 * * `cursor`: what `ShowCursor` answered, call by call.
 * * `task`: whether `GetCurrentTask` is the task of a window the probe made,
 *   and `GetNumTasks`.
 * * `top`: `BringWindowToTop` over two top-level windows and two children:
 *   what it answered, which of the two top-level windows is above the other,
 *   which is active, which has the focus, and which child is on top.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\MINIS.OUT"

static HWND windows[4];
static const char *NAMES[] = { "A", "B", "C1", "C2" };

static LPCSTR name(HWND hwnd)
{
    int index;

    if (!hwnd) {
        return "0";
    }

    for (index = 0; index < 4; index++) {
        if (windows[index] == hwnd) {
            return NAMES[index];
        }
    }

    return "?";
}

LONG FAR PASCAL _export ProbeProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    return DefWindowProc(hwnd, message, wParam, lParam);
}

static void pump(void)
{
    MSG message;

    while (PeekMessage(&message, NULL, 0, 0, PM_REMOVE)) {
        TranslateMessage(&message);
        DispatchMessage(&message);
    }
}

static void menuRecord(LPCSTR what, LONG value)
{
    wsprintf(probeResult, "%ld", value);
    probe("menu", what, probeResult);
}

static void stringRecord(HMENU menu, LPCSTR what, UINT item, int size, UINT flags)
{
    char buffer[32];
    int answer;

    lstrcpy(buffer, "untouched");
    answer = GetMenuString(menu, item, buffer, size, flags);
    wsprintf(probeResult, "%d,%s", answer, (LPSTR)buffer);
    probe("menu", what, probeResult);
}

static void menus(void)
{
    HMENU menu = CreateMenu();
    HMENU popup = CreatePopupMenu();
    HMENU other = CreatePopupMenu();

    AppendMenu(popup, MF_STRING, 20, "&Inner");
    AppendMenu(popup, MF_STRING | MF_CHECKED, 21, "Second");
    AppendMenu(menu, MF_STRING, 10, "&First");
    AppendMenu(menu, MF_SEPARATOR, 0, NULL);
    AppendMenu(menu, MF_POPUP, (UINT)popup, "&Pop");
    AppendMenu(menu, MF_STRING | MF_GRAYED, 11, "Last");
    AppendMenu(other, MF_STRING, 30, "Other");

    menuRecord("count", GetMenuItemCount(menu));
    menuRecord("count-popup", GetMenuItemCount(popup));
    menuRecord("count-none", GetMenuItemCount((HMENU)0x1234));
    menuRecord("id-0", (UINT)GetMenuItemID(menu, 0));
    menuRecord("id-1", (UINT)GetMenuItemID(menu, 1));
    menuRecord("id-2", (UINT)GetMenuItemID(menu, 2));
    menuRecord("id-9", (UINT)GetMenuItemID(menu, 9));
    menuRecord("state-0", (UINT)GetMenuState(menu, 0, MF_BYPOSITION));
    menuRecord("state-1", (UINT)GetMenuState(menu, 1, MF_BYPOSITION));
    menuRecord("state-2", (UINT)GetMenuState(menu, 2, MF_BYPOSITION));
    menuRecord("state-3", (UINT)GetMenuState(menu, 3, MF_BYPOSITION));
    menuRecord("state-21", (UINT)GetMenuState(menu, 21, MF_BYCOMMAND));
    menuRecord("state-99", (UINT)GetMenuState(menu, 99, MF_BYCOMMAND));

    stringRecord(menu, "string-0", 0, 32, MF_BYPOSITION);
    stringRecord(menu, "string-0-short", 0, 4, MF_BYPOSITION);
    stringRecord(menu, "string-1", 1, 32, MF_BYPOSITION);
    stringRecord(menu, "string-2", 2, 32, MF_BYPOSITION);
    stringRecord(menu, "string-20", 20, 32, MF_BYCOMMAND);
    stringRecord(menu, "string-99", 99, 32, MF_BYCOMMAND);

    menuRecord("delete-20", DeleteMenu(menu, 20, MF_BYCOMMAND));
    menuRecord("after-delete-20", GetMenuItemCount(popup));
    menuRecord("delete-99", DeleteMenu(menu, 99, MF_BYCOMMAND));
    menuRecord("remove-pop", RemoveMenu(menu, 2, MF_BYPOSITION));
    menuRecord("after-remove-pop", GetMenuItemCount(menu));
    menuRecord("popup-kept", GetMenuItemCount(popup));
    AppendMenu(menu, MF_POPUP, (UINT)other, "Other");
    menuRecord("delete-other", DeleteMenu(menu, 3, MF_BYPOSITION));
    menuRecord("after-delete-other", GetMenuItemCount(menu));
    menuRecord("other-gone", GetMenuItemCount(other));
    menuRecord("remove-9", RemoveMenu(menu, 9, MF_BYPOSITION));
    menuRecord("id-after", (UINT)GetMenuItemID(menu, 2));

    DestroyMenu(popup);
    DestroyMenu(menu);
}

static void ansiRecord(LPCSTR what, BOOL upper, LPCSTR text, int length, UINT count)
{
    char buffer[16];
    UINT answer;
    int index;
    LPSTR out;

    for (index = 0; index < 16; index++) {
        buffer[index] = index < length ? text[index] : 'q';
    }

    answer = upper ? AnsiUpperBuff(buffer, count) : AnsiLowerBuff(buffer, count);
    wsprintf(probeResult, "%u,", answer);
    out = probeResult + lstrlen(probeResult);

    for (index = 0; index < 10; index++) {
        wsprintf(out, "%02x", (BYTE)buffer[index]);
        out += 2;
    }

    probe("ansi", what, probeResult);
}

static void ansi(void)
{
    static const char TEXT[] = { 'a', 'B', (char)0xe0, (char)0xf7, 0, 'z', (char)0xc0, 'q' };

    ansiRecord("upper-5", TRUE, TEXT, 8, 5);
    ansiRecord("upper-8", TRUE, TEXT, 8, 8);
    ansiRecord("lower-8", FALSE, TEXT, 8, 8);
    ansiRecord("upper-1", TRUE, TEXT, 8, 1);
}

static void cursor(void)
{
    static const BOOL STEPS[] = { FALSE, TRUE, TRUE, FALSE, FALSE, FALSE, TRUE };
    char one[8];
    int index;

    probeResult[0] = '\0';

    for (index = 0; index < 7; index++) {
        wsprintf(one, "%s%d", (LPSTR)(index ? "," : ""), ShowCursor(STEPS[index]));
        lstrcat(probeResult, one);
    }

    probe("cursor", "steps", probeResult);
}

/* Whether one window is above another: found walking down from it. */
static BOOL above(HWND upper, HWND lower)
{
    HWND at;

    for (at = GetWindow(upper, GW_HWNDNEXT); at; at = GetWindow(at, GW_HWNDNEXT)) {
        if (at == lower) {
            return TRUE;
        }
    }

    return FALSE;
}

static void where(LPCSTR step, LONG answer)
{
    wsprintf(probeResult, "%ld,upper=%s,active=%s,focus=%s,childtop=%s", answer,
             (LPSTR)(above(windows[0], windows[1]) ? "A" : "B"), name(GetActiveWindow()),
             name(GetFocus()), name(GetTopWindow(windows[0])));
    probe("top", step, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS windowClass;

    probeOpen(OUTPUT);

    menus();
    ansi();
    cursor();

    windowClass.style = 0;
    windowClass.lpfnWndProc = ProbeProc;
    windowClass.cbClsExtra = 0;
    windowClass.cbWndExtra = 0;
    windowClass.hInstance = instance;
    windowClass.hIcon = NULL;
    windowClass.hCursor = NULL;
    windowClass.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    windowClass.lpszMenuName = NULL;
    windowClass.lpszClassName = "Minis";
    RegisterClass(&windowClass);

    windows[0] = CreateWindow("Minis", "A", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 20, 20, 300, 200,
                              NULL, NULL, instance, NULL);
    windows[1] = CreateWindow("Minis", "B", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 60, 60, 300, 200,
                              NULL, NULL, instance, NULL);
    windows[2] = CreateWindow("Minis", "", WS_CHILD | WS_VISIBLE | WS_BORDER, 10, 10, 50, 50,
                              windows[0], (HMENU)1, instance, NULL);
    windows[3] = CreateWindow("Minis", "", WS_CHILD | WS_VISIBLE | WS_BORDER, 30, 30, 50, 50,
                              windows[0], (HMENU)2, instance, NULL);
    pump();

    wsprintf(probeResult, "%s,count=%d",
             (LPSTR)(GetCurrentTask() == GetWindowTask(windows[0]) ? "same" : "other"),
             GetNumTasks());
    probe("task", "current", probeResult);

    where("made", 0);
    where("bring-A", BringWindowToTop(windows[0]));
    pump();
    where("after-A", 0);
    where("bring-C2", BringWindowToTop(windows[3]));
    pump();
    where("after-C2", 0);
    where("bring-B", BringWindowToTop(windows[1]));
    pump();
    where("after-B", 0);

    DestroyWindow(windows[1]);
    DestroyWindow(windows[0]);
    pump();
    probeFinish();

    return 0;
}
