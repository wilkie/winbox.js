/*
 * Scroll bars turned off: `EnableScrollBar`, and a list box that keeps its
 * scroll bar when it has nothing to scroll (`LBS_DISABLENOSCROLL`), as
 * `COMMDLG.DLL`'s file lists do.
 *
 * In an ordinary window, in the System font:
 *
 * * A list box with a border, a vertical scroll bar and
 *   `LBS_DISABLENOSCROLL`, 100 by 84: given two items, then fourteen, then
 *   emptied.
 * * A vertical scroll bar control, 16 by 100, and a horizontal one, 100 by
 *   16, ranged 0 to 10 at 3: each arrow turned off, both, and both on again.
 * * A child window with a vertical scroll bar of its own, turned off.
 *
 * Records:
 *
 * * `answer`: what a call answered.
 * * `state`: a list box's count, top index and scroll position after a step.
 * * `rows`: the control's pixels, a row a record, by capture name.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\NOSCROLL.OUT"

static const char HEX[] = "0123456789abcdef";

static const COLORREF PALETTE[16] = {
    RGB(0, 0, 0),       RGB(128, 0, 0),     RGB(0, 128, 0),   RGB(128, 128, 0),
    RGB(0, 0, 128),     RGB(128, 0, 128),   RGB(0, 128, 128), RGB(192, 192, 192),
    RGB(128, 128, 128), RGB(255, 0, 0),     RGB(0, 255, 0),   RGB(255, 255, 0),
    RGB(0, 0, 255),     RGB(255, 0, 255),   RGB(0, 255, 255), RGB(255, 255, 255),
};

static char digit(COLORREF colour)
{
    int index;

    for (index = 0; index < 16; index++) {
        if (PALETTE[index] == (colour & 0xffffffL)) {
            return HEX[index];
        }
    }

    return '?';
}

LONG FAR PASCAL _export HostProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_DESTROY) {
        PostQuitMessage(0);
        return 0;
    }

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

static void answer(LPCSTR what, LONG value)
{
    wsprintf(probeResult, "%ld", value);
    probe("answer", what, probeResult);
}

static void state(HWND box, LPCSTR step)
{
    wsprintf(probeResult, "count=%d,top=%d,v=%d", (int)SendMessage(box, LB_GETCOUNT, 0, 0L),
             (int)SendMessage(box, LB_GETTOPINDEX, 0, 0L), GetScrollPos(box, SB_VERT));
    probe("state", step, probeResult);
}

static void capture(HWND box, LPCSTR name)
{
    RECT window;
    HDC screen = GetDC(NULL);
    int x;
    int y;

    GetWindowRect(box, &window);

    for (y = window.top; y < window.bottom; y++) {
        LPSTR out = probeResult;

        for (x = window.left; x < window.right; x++) {
            *out++ = digit(GetPixel(screen, x, y));
        }

        *out = '\0';
        wsprintf(probeArgs, "%s,y=%d", name, y - window.top);
        probe("rows", probeArgs, probeResult);
    }

    ReleaseDC(NULL, screen);
}

static const char *WORDS[] = { "pear",  "apple", "fig",   "banana", "cherry", "grape", "kiwi",
                               "lemon", "mango", "olive", "peach",  "plum",   "date",  "lime" };

/* The steps each scroll bar control goes through, and what each is called. */
static const UINT STEPS[] = { ESB_DISABLE_LTUP, ESB_DISABLE_RTDN, ESB_DISABLE_BOTH,
                              ESB_DISABLE_BOTH, ESB_ENABLE_BOTH };
static const char *STEP_NAMES[] = { "ltup", "rtdn", "both", "again", "enable" };

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS windowClass;
    HWND host;
    HWND list;
    HWND vertical;
    HWND horizontal;
    HWND child;
    int index;
    char name[32];

    probeOpen(OUTPUT);
    ShowCursor(FALSE);
    SetCursorPos(GetSystemMetrics(SM_CXSCREEN) - 1, GetSystemMetrics(SM_CYSCREEN) - 1);

    windowClass.style = 0;
    windowClass.lpfnWndProc = HostProc;
    windowClass.cbClsExtra = 0;
    windowClass.cbWndExtra = 0;
    windowClass.hInstance = instance;
    windowClass.hIcon = NULL;
    windowClass.hCursor = NULL;
    windowClass.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    windowClass.lpszMenuName = NULL;
    windowClass.lpszClassName = "NoScroll";
    RegisterClass(&windowClass);

    host = CreateWindow("NoScroll", "Scroll", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 20, 20, 440, 220,
                        NULL, NULL, instance, NULL);
    list = CreateWindow("LISTBOX", "",
                        WS_CHILD | WS_VISIBLE | WS_BORDER | WS_VSCROLL | LBS_NOTIFY |
                            LBS_DISABLENOSCROLL,
                        8, 8, 100, 84, host, (HMENU)100, instance, NULL);
    vertical = CreateWindow("SCROLLBAR", "", WS_CHILD | WS_VISIBLE | SBS_VERT, 120, 8, 16, 100,
                            host, (HMENU)101, instance, NULL);
    horizontal = CreateWindow("SCROLLBAR", "", WS_CHILD | WS_VISIBLE | SBS_HORZ, 148, 8, 100, 16,
                              host, (HMENU)102, instance, NULL);
    child = CreateWindow("NoScroll", "", WS_CHILD | WS_VISIBLE | WS_BORDER | WS_VSCROLL, 260, 8,
                         80, 100, host, (HMENU)103, instance, NULL);

    UpdateWindow(host);
    pump();
    capture(list, "made");
    state(list, "made");

    /* Two items, which fit: the scroll bar stays, turned off. */
    SendMessage(list, LB_ADDSTRING, 0, (LPARAM)(LPSTR)WORDS[0]);
    SendMessage(list, LB_ADDSTRING, 0, (LPARAM)(LPSTR)WORDS[1]);
    pump();
    state(list, "few");
    capture(list, "few");

    /* Fourteen, which do not: turned on. */
    for (index = 2; index < 14; index++) {
        SendMessage(list, LB_ADDSTRING, 0, (LPARAM)(LPSTR)WORDS[index]);
    }

    pump();
    state(list, "many");
    capture(list, "many");

    /* Emptied: off again. */
    SendMessage(list, LB_RESETCONTENT, 0, 0L);
    pump();
    state(list, "empty");
    capture(list, "empty");

    /* The controls, each arrow off, both, and on again. */
    SetScrollRange(vertical, SB_CTL, 0, 10, FALSE);
    SetScrollPos(vertical, SB_CTL, 3, TRUE);
    SetScrollRange(horizontal, SB_CTL, 0, 10, FALSE);
    SetScrollPos(horizontal, SB_CTL, 3, TRUE);
    pump();
    capture(vertical, "v-on");
    capture(horizontal, "h-on");

    for (index = 0; index < 5; index++) {
        wsprintf(name, "v-%s", (LPSTR)STEP_NAMES[index]);
        answer(name, EnableScrollBar(vertical, SB_CTL, STEPS[index]));
        pump();
        capture(vertical, name);

        wsprintf(name, "h-%s", (LPSTR)STEP_NAMES[index]);
        answer(name, EnableScrollBar(horizontal, SB_CTL, STEPS[index]));
        pump();
        capture(horizontal, name);
    }

    /* Turned off, then moved: whether a position still takes. */
    EnableScrollBar(vertical, SB_CTL, ESB_DISABLE_BOTH);
    answer("v-setpos", SetScrollPos(vertical, SB_CTL, 7, TRUE));
    answer("v-getpos", GetScrollPos(vertical, SB_CTL));
    pump();
    capture(vertical, "v-moved");

    /* A window's own scroll bar. */
    SetScrollRange(child, SB_VERT, 0, 10, TRUE);
    pump();
    capture(child, "w-on");
    answer("w-both", EnableScrollBar(child, SB_VERT, ESB_DISABLE_BOTH));
    pump();
    capture(child, "w-both");

    DestroyWindow(host);
    probeFinish();

    return 0;
}
