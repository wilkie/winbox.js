/*
 * EndMenu, called by ordinal, from a window's WM_ENTERIDLE while
 * TrackPopupMenu has its pop-up open, and with no menu open.
 *
 * * `track`: what TrackPopupMenu answered, and the messages the window
 *   was sent meanwhile, in order: `init` for WM_INITMENUPOPUP, `idle` for
 *   WM_ENTERIDLE (EndMenu called at the first), `select:item,flags` for
 *   WM_MENUSELECT, `command:id` for WM_COMMAND.
 * * `capture`: GetCapture after, as `0`, `mine` or `other`.
 * * `none`: EndMenu with no menu open, returning.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\ENDMENU.OUT"

typedef void(FAR PASCAL *VOIDPROC)(void);

static HMODULE user;
static HWND self;
static char seen[600];
static int idles;

static void note(LPCSTR text)
{
    if (lstrlen(seen) + lstrlen(text) + 2 < sizeof(seen)) {
        if (seen[0]) {
            lstrcat(seen, " ");
        }

        lstrcat(seen, text);
    }
}

LRESULT CALLBACK _export WindowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    char text[40];

    switch (message) {
    case WM_INITMENUPOPUP:
        note("init");
        break;

    case WM_ENTERIDLE:
        if (idles++ == 0) {
            note("idle");
            ((VOIDPROC)GetProcAddress(user, MAKEINTRESOURCE(187)))();
        }

        return 0;

    case WM_MENUSELECT:
        wsprintf(text, "select:%04x,%04x", wParam, LOWORD(lParam));
        note(text);
        break;

    case WM_COMMAND:
        wsprintf(text, "command:%u", wParam);
        note(text);
        return 0;
    }

    return DefWindowProc(window, message, wParam, lParam);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    MSG msg;
    HMENU popup;
    BOOL answer;
    HWND capture;

    probeOpen(OUTPUT);
    user = GetModuleHandle("USER");

    kind.style = 0;
    kind.lpfnWndProc = WindowProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = LoadCursor(NULL, IDC_ARROW);
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "EndMenuProbe";
    RegisterClass(&kind);
    self = CreateWindow("EndMenuProbe", "EndMenu", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 10, 10, 300,
                        200, NULL, NULL, instance, NULL);
    UpdateWindow(self);

    while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
        DispatchMessage(&msg);
    }

    ((VOIDPROC)GetProcAddress(user, MAKEINTRESOURCE(187)))();
    probe("none", "EndMenu", "returned");

    popup = CreatePopupMenu();
    AppendMenu(popup, MF_STRING, 101, "One");
    AppendMenu(popup, MF_STRING, 102, "Two");

    /* The cursor well away from the pop-up, so that no item is under it. */
    SetCursorPos(600, 440);
    seen[0] = '\0';
    answer = TrackPopupMenu(popup, TPM_LEFTALIGN, 60, 60, 0, self, NULL);
    wsprintf(probeResult, "%d: %s", answer, (LPSTR)seen);
    probe("track", "EndMenu at the first idle", probeResult);

    capture = GetCapture();
    probe("capture", "after", capture ? (capture == self ? "mine" : "other") : "0");

    while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
        if (msg.message == WM_COMMAND) {
            wsprintf(probeResult, "%u", msg.wParam);
            probe("posted", "WM_COMMAND", probeResult);
        }

        DispatchMessage(&msg);
    }

    DestroyMenu(popup);
    DestroyWindow(self);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
