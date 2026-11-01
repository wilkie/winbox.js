/*
 * A window maximized and restored by `ShowWindow`: whether its bits go with
 * it to the new place, what it and the window beneath are sent, and what
 * the screen shows, at once and after the messages are taken. `swpbits`
 * asks the same of a window moved by `SetWindowPos`.
 *
 * `Beneath` is a pop-up over the whole screen, light grey, so its client
 * area is the screen's. `M` is the window maximized, `WS_OVERLAPPEDWINDOW`,
 * 200 by 100 at (100, 100): white where it is erased, and black where it
 * paints, which it does over its whole client area.
 *
 * * `sent`: the messages each window was sent, in order, as `B:` or `M:`
 *   and then `24` for WM_GETMINMAXINFO, `46` for WM_WINDOWPOSCHANGING and
 *   `47` for WM_WINDOWPOSCHANGED with their flags after a slash, `83` for
 *   WM_NCCALCSIZE, `3` for WM_MOVE, `5` for WM_SIZE, `85` for WM_NCPAINT,
 *   `14` for WM_ERASEBKGND, `88` for WM_SYNCPAINT, and `f{l,t,r,b}e` for
 *   WM_PAINT with BeginPaint's rcPaint and fErase.
 * * `update`: GetUpdateRect of M, then of Beneath, at once, or `none`.
 * * `screen`: the rows at y = 130 and y = 300, every 10 pixels from 5, as
 *   `.` for white, `#` for black, `s` for light grey, `g` for dark grey,
 *   `n` for dark blue, `t` for dark cyan and `?` for the rest; at once,
 *   then with the messages taken.
 *
 * Cases, each with a fresh M, painted and its messages taken first:
 *
 * * `max`: SW_SHOWMAXIMIZED; `restore`: then SW_RESTORE.
 * * `maxredraw`: `max`, M's class with CS_HREDRAW | CS_VREDRAW; then
 *   `restoreredraw`.
 * * `maxicon`: M minimized with SW_MINIMIZE, its messages taken, then
 *   SW_SHOWMAXIMIZED; `restoreicon`: minimized again, then SW_RESTORE.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\MAXCOPY.OUT"

static char seen[1600];
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
    static const COLORREF known[] = { RGB(255, 255, 255), RGB(0, 0, 0),   RGB(128, 128, 128),
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
    if (lstrlen(seen) > (int)sizeof(seen) - 48) {
        return;
    }

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
    case WM_WINDOWPOSCHANGED: {
        WINDOWPOS FAR *place = (WINDOWPOS FAR *)lParam;

        wsprintf(one, "%x/%x", message, place->flags);
        note(window, one);
        break;
    }
    case WM_GETMINMAXINFO:
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

static void row(LPCSTR what, int y)
{
    HDC screen = GetDC(NULL);
    char line[70];
    char label[70];
    int x;

    for (x = 0; x < 64; x++) {
        line[x] = code(GetPixel(screen, 5 + x * 10, y));
    }

    line[64] = '\0';
    wsprintf(label, "%s, y %d", what, y);
    probe("screen", label, line);
    ReleaseDC(NULL, screen);
}

static void sample(LPCSTR what)
{
    row(what, 130);
    row(what, 300);
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

static HWND make(LPCSTR kind, HINSTANCE instance)
{
    mover = CreateWindow(kind, "M", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 100, 100, 200, 100, NULL,
                         NULL, instance, NULL);
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

static void settle(int how)
{
    ShowWindow(mover, how);
    take();
    seen[0] = '\0';
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;

    probeOpen(OUTPUT);
    ShowCursor(FALSE);
    SetCursorPos(GetSystemMetrics(SM_CXSCREEN) - 1, GetSystemMetrics(SM_CYSCREEN) - 1);

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

    beneath = CreateWindow("Beneath", "B", WS_POPUP | WS_VISIBLE, 0, 0, 640, 480, NULL, NULL,
                           instance, NULL);
    UpdateWindow(beneath);
    take();
    seen[0] = '\0';

    make("Mover", instance);
    sample("start");
    ShowWindow(mover, SW_SHOWMAXIMIZED);
    after("max");
    ShowWindow(mover, SW_RESTORE);
    after("restore");
    done();

    make("Redraw", instance);
    ShowWindow(mover, SW_SHOWMAXIMIZED);
    after("maxredraw");
    ShowWindow(mover, SW_RESTORE);
    after("restoreredraw");
    done();

    make("Mover", instance);
    settle(SW_MINIMIZE);
    ShowWindow(mover, SW_SHOWMAXIMIZED);
    after("maxicon");
    settle(SW_MINIMIZE);
    ShowWindow(mover, SW_RESTORE);
    after("restoreicon");
    done();

    DestroyWindow(beneath);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
