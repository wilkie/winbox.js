/*
 * A window whose class has no background brush, shown over another: what
 * the screen shows where it paints nothing.
 *
 * * `screen`: a row of the screen every 40 pixels down, sampled every 40
 *   across, as `.` for white, `#` for black, `s` for light grey, and a
 *   letter for the rest; after the window is shown and painted.
 * * `erase`: what BeginPaint's fErase was, and what DefWindowProc answered
 *   WM_ERASEBKGND.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\NOBRUSH.OUT"

static char erased[40];

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
    if (message == WM_ERASEBKGND) {
        LRESULT answer = DefWindowProc(window, message, wParam, lParam);

        wsprintf(erased + lstrlen(erased), "def=%ld,", answer);
        return answer;
    }

    if (message == WM_PAINT) {
        PAINTSTRUCT paint;

        BeginPaint(window, &paint);
        wsprintf(erased + lstrlen(erased), "fErase=%d,", paint.fErase);
        EndPaint(window, &paint);
        return 0;
    }

    return DefWindowProc(window, message, wParam, lParam);
}

static void sample(LPCSTR what)
{
    HDC screen = GetDC(NULL);
    char row[20];
    char label[20];
    int x;
    int y;

    for (y = 20; y < 480; y += 40) {
        for (x = 0; x < 16; x++) {
            row[x] = code(GetPixel(screen, 20 + x * 40, y));
        }

        row[16] = '\0';
        wsprintf(label, "%s %d", what, y);
        probe("screen", label, row);
    }

    ReleaseDC(NULL, screen);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HWND beneath;
    HWND popup;
    MSG msg;

    probeOpen(OUTPUT);

    kind.style = 0;
    kind.lpfnWndProc = DefWindowProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = GetStockObject(LTGRAY_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "Beneath";
    RegisterClass(&kind);

    kind.lpfnWndProc = Proc;
    kind.hbrBackground = NULL;
    kind.lpszClassName = "NoBrush";
    RegisterClass(&kind);

    beneath = CreateWindow("Beneath", "Beneath", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 60, 40, 520,
                           380, NULL, NULL, instance, NULL);
    UpdateWindow(beneath);
    sample("before");

    popup = CreateWindow("NoBrush", "", WS_POPUP | WS_VISIBLE, 0, 0, 640, 480, NULL, NULL,
                         instance, NULL);
    UpdateWindow(popup);

    while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
        DispatchMessage(&msg);
    }

    sample("popup");
    probe("erase", "popup", erased);

    DestroyWindow(popup);
    DestroyWindow(beneath);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
