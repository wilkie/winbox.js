/*
 * The program `postend.c` starts, told by its command line what to do
 * before it ends, the probe's window being "Probe P" (class "PostEndP"):
 *
 * * `1`: post the probe `WM_USER + 1` and end at once, from `WinMain`.
 * * `2`: post the probe `WM_DDE_ACK` and end at once.
 * * `3`: make a window, post the probe `WM_USER + 1`, post its own window
 *   `WM_CLOSE`, and end when its message loop is told to quit.
 * * `4`: the same with `WM_DDE_ACK`.
 * * `5`, `6`: make a window and wait; when the probe posts it
 *   `WM_USER + 5`, post the probe `WM_USER + 1` (`5`) or `WM_DDE_ACK`
 *   (`6`), then post itself `WM_CLOSE`, as Program Manager does for
 *   [ExitProgman] -- and end.
 * * `7`: post the probe `WM_USER + 1` and wait, to be closed by the probe.
 * * `8`: the same with `WM_DDE_ACK`.
 * * A message number, three hexadecimal digits after `x` (`x3e1`): post
 *   the probe that message, `lParam` 1234h, and end at once.
 *
 * Its window, where it has one, is "Probe Q", class "PostEndQ". It writes
 * nothing.
 */

#include <windows.h>
#include <dde.h>

static HWND probe;
static int mode;

LRESULT CALLBACK __export Proc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_USER + 5) {
        if (mode == 5) {
            PostMessage(probe, WM_USER + 1, (WPARAM)window, 0x1234L);
        } else {
            PostMessage(probe, WM_DDE_ACK, (WPARAM)window, MAKELPARAM(0x8000, 0x1234));
        }

        PostMessage(window, WM_CLOSE, 0, 0L);
        return 0;
    }

    if (message == WM_DESTROY) {
        PostQuitMessage(0);
        return 0;
    }

    return DefWindowProc(window, message, wParam, lParam);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HWND window;
    MSG msg;

    mode = command[0] - '0';
    probe = FindWindow("PostEndP", NULL);

    if (command[0] == 'x') {
        UINT message = 0;
        int i;

        for (i = 1; i <= 3; i++) {
            message = message * 16 + (command[i] <= '9' ? command[i] - '0' : command[i] - 'a' + 10);
        }

        PostMessage(probe, message, 0, 0x1234L);
        return 0;
    }

    if (mode == 1) {
        PostMessage(probe, WM_USER + 1, 0, 0x1234L);
        return 0;
    }

    if (mode == 2) {
        PostMessage(probe, WM_DDE_ACK, 0, MAKELPARAM(0x8000, 0x1234));
        return 0;
    }

    kind.style = 0;
    kind.lpfnWndProc = Proc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "PostEndQ";

    if (!previous) {
        RegisterClass(&kind);
    }

    window = CreateWindow("PostEndQ", "Probe Q", WS_OVERLAPPEDWINDOW, 340, 40, 200, 150, NULL,
                          NULL, instance, NULL);

    if (mode == 3) {
        PostMessage(probe, WM_USER + 1, (WPARAM)window, 0x1234L);
        PostMessage(window, WM_CLOSE, 0, 0L);
    }

    if (mode == 4) {
        PostMessage(probe, WM_DDE_ACK, (WPARAM)window, MAKELPARAM(0x8000, 0x1234));
        PostMessage(window, WM_CLOSE, 0, 0L);
    }

    if (mode == 7) {
        PostMessage(probe, WM_USER + 1, (WPARAM)window, 0x1234L);
    }

    if (mode == 8) {
        PostMessage(probe, WM_DDE_ACK, (WPARAM)window, MAKELPARAM(0x8000, 0x1234));
    }

    while (GetMessage(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }

    (void)show;
    return 0;
}
