/*
 * A window moved by `SetWindowPos` and `MoveWindow`: whether its bits go
 * with it to the new place, what it and the window beneath are sent, and
 * what the screen shows, at once and after the messages are taken.
 *
 * `Beneath` is a pop-up over the whole screen, light grey, so its client
 * area is the screen's. `M` is the window moved, 200 by 100 at (100, 100):
 * white where it is erased, and black where it paints, which it does over
 * its whole client area. In `lid`, `L`, a dark grey pop-up 100 by 50 at
 * (250, 100), lies over part of it.
 *
 * * `sent`: the messages each window was sent, in order, as `B:` or `M:`
 *   and then `46` for WM_WINDOWPOSCHANGING, `47` for WM_WINDOWPOSCHANGED,
 *   `83` for WM_NCCALCSIZE, `3` for WM_MOVE, `5` for WM_SIZE, `85` for
 *   WM_NCPAINT, `14` for WM_ERASEBKGND, `88` for WM_SYNCPAINT, and
 *   `f{l,t,r,b}e` for WM_PAINT with BeginPaint's rcPaint and fErase.
 * * `update`: GetUpdateRect of M, then of Beneath, at once, or `none`.
 * * `screen`: the row at y = 130, every 10 pixels from 5, as `.` for
 *   white, `#` for black, `s` for light grey, `g` for dark grey, and a
 *   letter for the rest; at once, then with the messages taken.
 *
 * Cases, each with a fresh M, painted and its messages taken first:
 *
 * * `move`: SetWindowPos to (150, 120), SWP_NOSIZE | SWP_NOZORDER |
 *   SWP_NOACTIVATE, over part of where it was.
 * * `far`: the same to (400, 100), clear of where it was.
 * * `nocopy`: `move` with SWP_NOCOPYBITS.
 * * `redraw`: `move`, M's class with CS_HREDRAW | CS_VREDRAW.
 * * `size`: to (150, 120), 240 by 120, SWP_NOZORDER | SWP_NOACTIVATE.
 * * `sizeredraw`: `size`, M's class with CS_HREDRAW | CS_VREDRAW.
 * * `shrink`: to (150, 120), 160 by 80, plain, and `shrinkredraw`.
 * * `movewin`: MoveWindow to (150, 120), 200 by 100, repainting;
 *   `movewin0` not repainting.
 * * `lid`: L over M; M moved to (50, 100), what L covered of it now shows.
 * * `child`: M a child of Beneath at (100, 100), moved by MoveWindow to
 *   (150, 120); `childnocopy` by SetWindowPos with SWP_NOCOPYBITS.
 * * `framed`: M with WS_CAPTION, moved by SetWindowPos as in `move`.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\SWPBITS.OUT"

static char seen[1200];
static HWND beneath;
static HWND mover;

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

static void note(HWND window, LPCSTR what)
{
    lstrcat(seen, window == beneath ? "B:" : window == mover ? "M:" : "?:");
    lstrcat(seen, what);
    lstrcat(seen, ",");
}

LRESULT CALLBACK __export Proc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    char one[40];
    PAINTSTRUCT paint;
    RECT client;

    switch (message) {
    case WM_PAINT:
        BeginPaint(window, &paint);
        wsprintf(one, "f{%d,%d,%d,%d}%d", paint.rcPaint.left, paint.rcPaint.top,
                 paint.rcPaint.right, paint.rcPaint.bottom, paint.fErase);
        note(window, one);

        if (window == mover) {
            GetClientRect(window, &client);
            FillRect(paint.hdc, &client, GetStockObject(BLACK_BRUSH));
        }

        EndPaint(window, &paint);
        return 0;
    case WM_WINDOWPOSCHANGING:
    case WM_WINDOWPOSCHANGED:
    case WM_NCCALCSIZE:
    case WM_MOVE:
    case WM_SIZE:
    case WM_NCPAINT:
    case WM_ERASEBKGND:
    case 0x88:
        wsprintf(one, "%x", message);
        note(window, one);
        break;
    }

    return DefWindowProc(window, message, wParam, lParam);
}

static void sample(LPCSTR what)
{
    HDC screen = GetDC(NULL);
    char row[70];
    int x;

    for (x = 0; x < 64; x++) {
        row[x] = code(GetPixel(screen, 5 + x * 10, 130));
    }

    row[64] = '\0';
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

static void updateOf(HWND window, LPSTR out)
{
    RECT update;

    if (GetUpdateRect(window, &update, FALSE)) {
        wsprintf(out, "{%d,%d,%d,%d}", update.left, update.top, update.right, update.bottom);
    } else {
        lstrcpy(out, "none");
    }
}

/* What came of the case: at once, and with the messages taken. */
static void after(LPCSTR what)
{
    char label[60];
    char one[40];

    wsprintf(label, "%s, at once", what);
    probe("sent", label, seen[0] ? seen : "none");
    seen[0] = '\0';

    updateOf(mover, one);
    lstrcpy(probeResult, one);
    lstrcat(probeResult, " ");
    updateOf(beneath, one);
    lstrcat(probeResult, one);
    probe("update", what, probeResult);
    sample(label);

    take();
    wsprintf(label, "%s, messages taken", what);
    probe("sent", label, seen[0] ? seen : "none");
    seen[0] = '\0';
    sample(label);
}

static HWND make(LPCSTR kind, DWORD style, HWND parent, HINSTANCE instance)
{
    mover = CreateWindow(kind, "M", style | WS_VISIBLE, 100, 100, 200, 100, parent, NULL,
                         instance, NULL);
    UpdateWindow(mover);
    take();
    seen[0] = '\0';
    return mover;
}

static void done(void)
{
    DestroyWindow(mover);
    mover = NULL;
    take();
    seen[0] = '\0';
}

#define QUIET (SWP_NOZORDER | SWP_NOACTIVATE)

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HWND lid;

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

    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszClassName = "Mover";
    RegisterClass(&kind);

    kind.style = CS_HREDRAW | CS_VREDRAW;
    kind.lpszClassName = "Redraw";
    RegisterClass(&kind);

    kind.style = 0;
    kind.lpfnWndProc = DefWindowProc;
    kind.hbrBackground = GetStockObject(GRAY_BRUSH);
    kind.lpszClassName = "Lid";
    RegisterClass(&kind);

    beneath = CreateWindow("Beneath", "B", WS_POPUP | WS_VISIBLE, 0, 0, 640, 480, NULL, NULL,
                           instance, NULL);
    UpdateWindow(beneath);
    take();
    seen[0] = '\0';

    make("Mover", WS_POPUP, NULL, instance);
    sample("start");
    SetWindowPos(mover, NULL, 150, 120, 0, 0, SWP_NOSIZE | QUIET);
    after("move");
    done();

    make("Mover", WS_POPUP, NULL, instance);
    SetWindowPos(mover, NULL, 400, 100, 0, 0, SWP_NOSIZE | QUIET);
    after("far");
    done();

    make("Mover", WS_POPUP, NULL, instance);
    SetWindowPos(mover, NULL, 150, 120, 0, 0, SWP_NOSIZE | SWP_NOCOPYBITS | QUIET);
    after("nocopy");
    done();

    make("Redraw", WS_POPUP, NULL, instance);
    SetWindowPos(mover, NULL, 150, 120, 0, 0, SWP_NOSIZE | QUIET);
    after("redraw");
    done();

    make("Mover", WS_POPUP, NULL, instance);
    SetWindowPos(mover, NULL, 150, 120, 240, 120, QUIET);
    after("size");
    done();

    make("Redraw", WS_POPUP, NULL, instance);
    SetWindowPos(mover, NULL, 150, 120, 240, 120, QUIET);
    after("sizeredraw");
    done();

    make("Mover", WS_POPUP, NULL, instance);
    SetWindowPos(mover, NULL, 150, 120, 160, 80, QUIET);
    after("shrink");
    done();

    make("Redraw", WS_POPUP, NULL, instance);
    SetWindowPos(mover, NULL, 150, 120, 160, 80, QUIET);
    after("shrinkredraw");
    done();

    make("Mover", WS_POPUP, NULL, instance);
    MoveWindow(mover, 150, 120, 200, 100, TRUE);
    after("movewin");
    done();

    make("Mover", WS_POPUP, NULL, instance);
    MoveWindow(mover, 150, 120, 200, 100, FALSE);
    after("movewin0");
    done();

    make("Mover", WS_POPUP, NULL, instance);
    lid = CreateWindow("Lid", "L", WS_POPUP | WS_VISIBLE, 250, 100, 100, 50, NULL, NULL,
                       instance, NULL);
    UpdateWindow(lid);
    take();
    seen[0] = '\0';
    sample("lid");
    SetWindowPos(mover, NULL, 50, 100, 0, 0, SWP_NOSIZE | QUIET);
    after("lid");
    DestroyWindow(lid);
    done();

    make("Mover", WS_CHILD, beneath, instance);
    MoveWindow(mover, 150, 120, 200, 100, TRUE);
    after("child");
    done();

    make("Mover", WS_CHILD, beneath, instance);
    SetWindowPos(mover, NULL, 150, 120, 0, 0, SWP_NOSIZE | SWP_NOCOPYBITS | QUIET);
    after("childnocopy");
    done();

    make("Mover", WS_POPUP | WS_CAPTION, NULL, instance);
    SetWindowPos(mover, NULL, 150, 120, 0, 0, SWP_NOSIZE | QUIET);
    after("framed");
    done();

    DestroyWindow(beneath);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
