/*
 * A window of the probe's own uncovered by another program's: the program
 * started with WinExec shows a window over the probe's, hides it, and waits
 * for messages. What the probe's window was sent by the time WinExec
 * answers, and after the probe takes its messages; and what the screen
 * shows when WinExec answers.
 *
 * * `sent`: the messages the probe's window was sent, in order, as `14` for
 *   WM_ERASEBKGND, `85` for WM_NCPAINT, `88` for WM_SYNCPAINT, and
 *   `f{l,t,r,b}e` for WM_PAINT with BeginPaint's rcPaint and fErase.
 * * `update`: GetUpdateRect of the probe's window when WinExec answers.
 * * `screen`: a row across where the other window was, sampled every 10
 *   pixels, as `.` for white, `#` for black, `s` for light grey, `t` for
 *   teal, and a letter for the rest.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\SYNCPNT.OUT"

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

static void sample(LPCSTR what)
{
    HDC screen = GetDC(NULL);
    char row[40];
    int x;

    for (x = 0; x < 32; x++) {
        row[x] = code(GetPixel(screen, 5 + x * 10, 150));
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
    HWND beneath;
    HWND other;
    RECT update;
    UINT answer;
    int i;

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

    answer = WinExec("SYNCPNTC.EXE", SW_SHOWNORMAL);
    probe("exec", "child", (LPSTR)(answer > 32 ? "inst" : "error"));
    sent("when WinExec answers");

    if (GetUpdateRect(beneath, &update, FALSE)) {
        wsprintf(probeResult, "{%d,%d,%d,%d}", update.left, update.top, update.right,
                 update.bottom);
    } else {
        lstrcpy(probeResult, "none");
    }

    probe("update", "when WinExec answers", probeResult);
    sample("when WinExec answers");
    take();
    sent("messages taken");

    other = FindWindow("SyncCover", NULL);
    PostMessage(other, WM_CLOSE, 0, 0);

    for (i = 0; i < 20; i++) {
        Yield();
        take();
    }

    DestroyWindow(beneath);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
