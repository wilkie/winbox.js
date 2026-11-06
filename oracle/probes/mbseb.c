/*
 * `MessageBox` with `MB_SYSTEMMODAL` and no icon, or the hand: USER's system
 * error box, not a dialog (`USER.EXE` seg1 `9bd2`-`9bfb`, `9a86`-`9b8e`).
 * What a program sees of it: the answer for each style and default button,
 * the messages its window is sent while the box is up, and the windows at
 * the top, the active window and the focus before and after.
 *
 * Each box is written as `box` before it comes up, and a key is pressed at
 * it from outside (`record.mjs --shoot box:3 --then ...`): Enter at each but
 * the last, which Escape answers. (One with the exclamation icon is a
 * dialog instead: its owner `W` is sent `WM_CANCELMODE`, loses the focus
 * and the activation, as `msgbox` records.)
 *
 * The probe's window `W`, overlapped, has the focus throughout.
 */

#define PROBE_FLUSH
#include "probe.h"

#define OUTPUT "C:\\ORACLE\\MBSEB.OUT"

static HWND window;
static char seen[600];
static BOOL logging;

static void note(LPCSTR text)
{
    if (logging && lstrlen(seen) + lstrlen(text) < sizeof seen - 2) {
        lstrcat(seen, text);
    }
}

LONG FAR PASCAL _export WindowProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    char one[24];

    if (message == WM_PAINT) {
        PAINTSTRUCT paint;

        BeginPaint(hwnd, &paint);
        EndPaint(hwnd, &paint);
        return 0;
    }

    if (message != WM_MOUSEMOVE && message != WM_NCMOUSEMOVE && message != WM_SETCURSOR &&
        message != WM_NCHITTEST && message != WM_ENTERIDLE && message != WM_GETTEXT &&
        message != WM_CTLCOLOR && message != WM_ERASEBKGND && message != WM_NCPAINT) {
        wsprintf(one, "%x/%x,", message, wParam);
        note(one);
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

static void pump(void)
{
    MSG message;
    int count = 0;

    while (count < 80 && PeekMessage(&message, NULL, 0, 0, PM_REMOVE)) {
        TranslateMessage(&message);
        DispatchMessage(&message);
        count++;
    }
}

/* The windows at the top that show, front to back, by class; the active window and the focus. */
static void state(LPCSTR name, LPCSTR when)
{
    char text[300];
    char klass[32];
    char label[60];
    LPSTR to = text;
    HWND hwnd;

    *to = '\0';

    for (hwnd = GetWindow(GetDesktopWindow(), GW_CHILD); hwnd;
         hwnd = GetWindow(hwnd, GW_HWNDNEXT)) {
        if (!IsWindowVisible(hwnd)) {
            continue;
        }

        GetClassName(hwnd, klass, sizeof klass);
        to += wsprintf(to, "%s%s", (LPSTR)(to == text ? "" : ","),
                       (LPSTR)(hwnd == window ? "W" : klass));
    }

    wsprintf(to, ";active=%s;focus=%s;modal=%s",
             (LPSTR)(GetActiveWindow() == window ? "W" : GetActiveWindow() ? "?" : "0"),
             (LPSTR)(GetFocus() == window ? "W" : GetFocus() ? "?" : "0"),
             (LPSTR)(GetSysModalWindow() == window ? "W" : GetSysModalWindow() ? "?" : "0"));
    wsprintf(label, "%s, %s", name, when);
    probe("state", label, text);
}

static void box(LPCSTR name, LPCSTR text, LPCSTR caption, UINT style)
{
    char one[16];
    int answer;

    state(name, "before");
    probe("box", name, "up");
    seen[0] = '\0';
    logging = TRUE;
    answer = MessageBox(window, text, caption, style);
    logging = FALSE;
    wsprintf(one, "%d", answer);
    probe("answer", name, one);
    probe("sent", name, seen[0] ? seen : "none");
    seen[0] = '\0';
    pump();
    state(name, "after");
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;

    probeOpen(OUTPUT);

    kind.style = 0;
    kind.lpfnWndProc = WindowProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "MbSeb";
    RegisterClass(&kind);

    window = CreateWindow("MbSeb", "W", WS_OVERLAPPEDWINDOW, 40, 40, 300, 200, NULL, NULL,
                          instance, NULL);
    ShowWindow(window, SW_SHOWNORMAL);
    UpdateWindow(window);
    SetFocus(window);
    ShowCursor(FALSE);
    SetCursorPos(GetSystemMetrics(SM_CXSCREEN) - 1, GetSystemMetrics(SM_CYSCREEN) - 1);
    pump();

    box("ok", "One button", "Box", MB_SYSTEMMODAL | MB_OK);
    box("yesno hand", "Two buttons\nand the hand", "Box", MB_SYSTEMMODAL | MB_YESNO | MB_ICONHAND);
    box("yesnocancel 2", "Three, the second", "Box",
        MB_SYSTEMMODAL | MB_YESNOCANCEL | MB_DEFBUTTON2);
    box("abort 3", "Three, the third", "Box",
        MB_SYSTEMMODAL | MB_ABORTRETRYIGNORE | MB_DEFBUTTON3);
    box("retry 3", "Two, the third", NULL, MB_SYSTEMMODAL | MB_RETRYCANCEL | MB_DEFBUTTON3);
    box("okcancel 2", "Two, the second", "Box", MB_SYSTEMMODAL | MB_OKCANCEL | MB_DEFBUTTON2);
    box("okcancel esc", "Escape", "Box", MB_SYSTEMMODAL | MB_OKCANCEL);

    DestroyWindow(window);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
