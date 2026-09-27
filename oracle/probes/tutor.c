/*
 * The Tutorial's first screen, read as soon as WinExec answers -- when the
 * Tutorial first waits for a message with none waiting, before its first
 * timer -- over a window of the probe's own.
 *
 * * `exec`: WinExec's answer, `inst` for an instance.
 * * `screen`: a row of the screen every 10 pixels down, sampled every 10
 *   across, as `.` for white, `#` for black, and a letter for the rest.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\TUTOR.OUT"

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
                                      RGB(192, 192, 192), RGB(0, 0, 128), RGB(0, 0, 255),
                                      RGB(0, 128, 128), RGB(0, 255, 255), RGB(128, 0, 0),
                                      RGB(255, 0, 0), RGB(0, 128, 0), RGB(0, 255, 0),
                                      RGB(128, 128, 0), RGB(255, 255, 0), RGB(128, 0, 128),
                                      RGB(255, 0, 255) };
    static const char names[] = ".#gsnbtcmrdlyYpP";
    int i;

    for (i = 0; i < 16; i++) {
        if (known[i] == colour) {
            return names[i];
        }
    }

    return '?';
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HWND window;
    HDC screen;
    UINT answer;
    char row[70];
    char what[8];
    int x;
    int y;

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
    kind.lpszClassName = "Tutor";
    RegisterClass(&kind);

    window = CreateWindow("Tutor", "Beneath", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 60, 40, 520, 380,
                          NULL, NULL, instance, NULL);
    UpdateWindow(window);

    answer = WinExec("WINTUTOR.EXE", SW_SHOWNORMAL);
    probe("exec", "tutorial", (LPSTR)(answer > 32 ? "inst" : "error"));

    screen = GetDC(NULL);

    for (y = 0; y < 480; y += 10) {
        for (x = 0; x < 64; x++) {
            row[x] = code(GetPixel(screen, x * 10, y));
        }

        row[64] = '\0';
        wsprintf(what, "%d", y);
        probe("screen", what, row);
    }

    ReleaseDC(NULL, screen);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
