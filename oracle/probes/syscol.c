/*
 * SetSysColors, the desktop made white, over a window of the probe's own:
 * what the screen shows at once, after the probe takes its messages, and
 * after a window with no background brush is shown over it all.
 *
 * * `screen`: a row every 40 pixels down, sampled every 40 across, as `.`
 *   for white, `#` for black, `s` for light grey, `n` for navy, and a letter
 *   for the rest.
 * * `messages`: what the probe's window was sent, in order, as it took them.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\SYSCOL.OUT"

static char seen[400];

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
    char one[8];

    if (message == WM_SYSCOLORCHANGE || message == WM_ERASEBKGND || message == WM_PAINT ||
        message == WM_NCPAINT || message == WM_CTLCOLOR) {
        wsprintf(one, "%x,", message);
        lstrcat(seen, one);
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

static void take(void)
{
    MSG msg;

    while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
        DispatchMessage(&msg);
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static int which[] = { COLOR_BACKGROUND };
    static COLORREF colours[] = { RGB(255, 255, 255) };
    static COLORREF back[1];
    WNDCLASS kind;
    HWND beneath;
    HWND popup;

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
    kind.hbrBackground = NULL;
    kind.lpszClassName = "NoBrush";
    RegisterClass(&kind);

    beneath = CreateWindow("Beneath", "Beneath", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 60, 40, 520,
                           380, NULL, NULL, instance, NULL);
    UpdateWindow(beneath);
    take();
    seen[0] = '\0';

    back[0] = GetSysColor(COLOR_BACKGROUND);
    SetSysColors(1, which, colours);
    sample("at once");
    take();
    sample("messages taken");
    probe("messages", "Beneath", seen[0] ? seen : "none");

    popup = CreateWindow("NoBrush", "", WS_POPUP | WS_VISIBLE, 0, 0, 640, 480, NULL, NULL,
                         instance, NULL);
    UpdateWindow(popup);
    take();
    sample("popup");

    DestroyWindow(popup);
    SetSysColors(1, which, back);
    take();
    DestroyWindow(beneath);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
