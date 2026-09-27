/*
 * A window of the probe's own uncovered by another: hidden, moved, and
 * destroyed. What the window underneath is sent at once, before the probe
 * takes its messages, and after; and what the screen shows at once.
 *
 * * `sent`: the messages the window underneath was sent, in order, as
 *   `14` for WM_ERASEBKGND, `85` for WM_NCPAINT, `88` for WM_SYNCPAINT, and
 *   `f{l,t,r,b}e` for WM_PAINT with BeginPaint's rcPaint and fErase.
 * * `update`: GetUpdateRect of the window underneath, at once.
 * * `screen`: a row across where the cover was, sampled every 10 pixels,
 *   as `.` for white, `#` for black, `s` for light grey, `t` for teal, and
 *   a letter for the rest.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\UNCOVER.OUT"

static char seen[400];

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

    return DefWindowProc(window, message, wParam, lParam);
}

static void sample(LPCSTR what, int y)
{
    HDC screen = GetDC(NULL);
    char row[40];
    int x;

    for (x = 0; x < 32; x++) {
        row[x] = code(GetPixel(screen, 5 + x * 10, y));
    }

    row[32] = '\0';
    probe("screen", what, row);
    ReleaseDC(NULL, screen);
}

static void take(void)
{
    MSG msg;

    while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
        DispatchMessage(&msg);
    }
}

static void atOnce(HWND beneath, LPCSTR what)
{
    RECT update;
    char label[40];

    wsprintf(label, "%s, at once", what);
    probe("sent", label, seen[0] ? seen : "none");
    seen[0] = '\0';

    if (GetUpdateRect(beneath, &update, FALSE)) {
        wsprintf(probeResult, "{%d,%d,%d,%d}", update.left, update.top, update.right,
                 update.bottom);
    } else {
        lstrcpy(probeResult, "none");
    }

    probe("update", what, probeResult);
    sample(what, 150);

    take();
    wsprintf(label, "%s, messages taken", what);
    probe("sent", label, seen[0] ? seen : "none");
    seen[0] = '\0';
}

static HWND cover(HINSTANCE instance)
{
    HWND made = CreateWindow("Cover", "", WS_POPUP | WS_VISIBLE, 20, 100, 200, 100, NULL, NULL,
                             instance, NULL);

    UpdateWindow(made);
    take();
    seen[0] = '\0';
    return made;
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HWND beneath;
    HWND over;

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

    kind.lpfnWndProc = DefWindowProc;
    kind.hbrBackground = GetStockObject(BLACK_BRUSH);
    kind.lpszClassName = "Cover";
    RegisterClass(&kind);

    beneath = CreateWindow("Beneath", "Beneath", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 60, 40, 520,
                           380, NULL, NULL, instance, NULL);
    UpdateWindow(beneath);
    take();

    over = cover(instance);
    sample("covered", 150);
    ShowWindow(over, SW_HIDE);
    atOnce(beneath, "hidden");
    DestroyWindow(over);
    take();

    over = cover(instance);
    SetWindowPos(over, NULL, 320, 100, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
    atOnce(beneath, "moved");
    DestroyWindow(over);
    take();

    over = cover(instance);
    DestroyWindow(over);
    atOnce(beneath, "destroyed");

    InvalidateRect(beneath, NULL, TRUE);
    atOnce(beneath, "invalidated");

    DestroyWindow(beneath);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
