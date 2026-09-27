/*
 * A popup menu over a window of the probe's own, closed by Escape, as
 * `menubits` -- but with the window underneath invalidated, erase and all,
 * while the menu is up, and once more only a part of it that the menu does
 * not cover. What the window underneath is sent while the menu is up, when
 * it goes, and after the probe takes its messages; and what the screen
 * shows at once.
 *
 * * `sent`: the messages the window underneath was sent, in order, as `14`
 *   for WM_ERASEBKGND, `85` for WM_NCPAINT, `88` for WM_SYNCPAINT, and
 *   `f{l,t,r,b}e` for WM_PAINT with BeginPaint's rcPaint and fErase.
 * * `track`: TrackPopupMenu's answer.
 * * `screen`: a row across the menu's place, sampled every 10 pixels, while
 *   it is up and at once after, as `.` for white, `#` for black, `s` for
 *   light grey, `t` for teal, and a letter for the rest.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\MENUINV.OUT"

static char seen[400];
static HWND beneath;
static int which;
static RECT away = { 400, 250, 500, 300 };

static void record(LPCSTR function, LPCSTR args, LPCSTR result)
{
    probe(function, args, result);
    _lclose(probeHandle);
    probeHandle = _lopen(OUTPUT, OF_WRITE);
    _llseek(probeHandle, 0, 2);
}

#define probe record

static char code(COLORREF colour)
{
    static const COLORREF known[] = { RGB(255, 255, 255), RGB(0, 0, 0), RGB(128, 128, 128),
                                      RGB(192, 192, 192), RGB(0, 0, 128), RGB(0, 128, 128) };
    static const char names[] = ".#gsnt";
    int i;

    for (i = 0; i < 6; i++) {
        if (known[i] == colour) {
            return names[i];
        }
    }

    return '?';
}

static void sample(LPCSTR what)
{
    HDC screen = GetDC(NULL);
    char row[40];
    int x;

    for (x = 0; x < 32; x++) {
        row[x] = code(GetPixel(screen, 105 + x * 5, 160));
    }

    row[32] = '\0';
    probe("screen", what, row);
    ReleaseDC(NULL, screen);
}

static void sent(LPCSTR what)
{
    probe("sent", what, seen[0] ? seen : "none");
    seen[0] = '\0';
}

LRESULT CALLBACK __export Proc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    char one[40];
    PAINTSTRUCT paint;

    if (message == WM_PAINT) {
        BeginPaint(window, &paint);
        wsprintf(one, "f{%d,%d,%d,%d}%d,", paint.rcPaint.left, paint.rcPaint.top,
                 paint.rcPaint.right, paint.rcPaint.bottom, paint.fErase);
        lstrcat(seen, one);
        EndPaint(window, &paint);
        return 0;
    }

    if (message == WM_ERASEBKGND || message == WM_NCPAINT || message == 0x88) {
        wsprintf(one, "%x,", message);
        lstrcat(seen, one);
    }

    if (message == WM_TIMER) {
        KillTimer(window, 1);
        InvalidateRect(window, which ? &away : NULL, TRUE);
        sent(which ? "menu up, part away" : "menu up, all");
        sample(which ? "menu up, part away" : "menu up, all");
        PostMessage(window, WM_KEYDOWN, VK_ESCAPE, 0x00010001L);
        PostMessage(window, WM_KEYUP, VK_ESCAPE, 0xC0010001L);
        return 0;
    }

    return DefWindowProc(window, message, wParam, lParam);
}

static void take(void)
{
    MSG msg;

    while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
        DispatchMessage(&msg);
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HMENU menu;
    BOOL answer;

    probeOpen(OUTPUT);

    kind.style = 0;
    kind.lpfnWndProc = Proc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = GetStockObject(LTGRAY_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "Beneath";
    RegisterClass(&kind);

    beneath = CreateWindow("Beneath", "Beneath", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 60, 40, 520,
                           380, NULL, NULL, instance, NULL);
    UpdateWindow(beneath);
    take();
    seen[0] = '\0';

    menu = CreatePopupMenu();
    AppendMenu(menu, MF_STRING, 101, "First item");
    AppendMenu(menu, MF_STRING, 102, "Second item");
    AppendMenu(menu, MF_STRING, 103, "Third item");

    for (which = 0; which < 2; which++) {
        sample(which ? "before, part away" : "before, all");
        SetTimer(beneath, 1, 200, NULL);
        answer = TrackPopupMenu(menu, 0, 100, 150, 0, beneath, NULL);
        wsprintf(probeResult, "%d", answer);
        probe("track", which ? "part away" : "all", probeResult);
        sent(which ? "menu gone, at once, part away" : "menu gone, at once, all");
        sample(which ? "at once, part away" : "at once, all");
        take();
        sent(which ? "messages taken, part away" : "messages taken, all");
    }

    DestroyMenu(menu);
    DestroyWindow(beneath);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
