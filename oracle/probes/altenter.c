/*
 * What `DefWindowProc` does with `WM_SYSCHAR` for Enter (`USER.EXE` seg1
 * `622c`-`6290`): for a window minimized, posts it `SC_RESTORE`, with Alt's
 * bit in `lParam` or without; for one shown normally, sends it `SC_KEYMENU`
 * with the character, as for any character typed with Alt.
 *
 * Each record is a `WM_SYSCHAR` sent to the window, whose procedure hands it
 * to `DefWindowProc`: what was sent to the window meanwhile, `sent(...)`,
 * and then what was posted to it, `posted(...)`, each `WM_SYSCOMMAND` with
 * its `wParam` and `lParam` in hexadecimal. The procedure answers
 * `WM_SYSCOMMAND` itself, and what was posted is taken and not dispatched,
 * so nothing is carried out.
 */

#define PROBE_FLUSH
#include "probe.h"

#define OUTPUT "C:\\ORACLE\\ALTENTER.OUT"

static char log[256];

static void note(LPCSTR text)
{
    if (lstrlen(log) + lstrlen(text) < sizeof(log) - 2) {
        if (log[0]) {
            lstrcat(log, " ");
        }

        lstrcat(log, text);
    }
}

LRESULT CALLBACK _export HostProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    char text[64];

    if (message == WM_SYSCOMMAND) {
        wsprintf(text, "sent(%x,%lx)", wParam, lParam);
        note(text);
        return 0;
    }

    return DefWindowProc(window, message, wParam, lParam);
}

static void type(HWND window, LPCSTR name, UINT character, LONG lParam)
{
    MSG msg;
    char text[64];

    log[0] = '\0';
    SendMessage(window, WM_SYSCHAR, character, lParam);

    while (PeekMessage(&msg, window, WM_SYSCOMMAND, WM_SYSCOMMAND, PM_REMOVE)) {
        if (msg.message == WM_SYSCOMMAND) {
            wsprintf(text, "posted(%x,%lx)", msg.wParam, msg.lParam);
            note(text);
        }
    }

    probe("syschar", name, log[0] ? log : "nothing");
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HWND window;

    probeOpen(OUTPUT);

    kind.style = 0;
    kind.lpfnWndProc = HostProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = LoadCursor(NULL, IDC_ARROW);
    kind.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "AltEnter";
    RegisterClass(&kind);

    window = CreateWindow("AltEnter", "altenter", WS_OVERLAPPEDWINDOW, 20, 20, 300, 200, NULL,
                          NULL, instance, NULL);
    ShowWindow(window, SW_SHOWNORMAL);
    UpdateWindow(window);

    type(window, "normal,alt,enter", 0x0d, 0x20000001L);
    type(window, "normal,alt,x", 'x', 0x20000001L);

    ShowWindow(window, SW_MINIMIZE);
    type(window, "minimized,alt,enter", 0x0d, 0x20000001L);
    type(window, "minimized,enter", 0x0d, 1L);
    type(window, "minimized,alt,x", 'x', 0x20000001L);

    DestroyWindow(window);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
