/*
 * The server `ddelist.c` starts: two overlapped windows of plain DDE, with
 * no DDEML, "List Server" (A) and "List Second" (B). A answers
 * WM_DDE_INITIATE for its names -- "LISTSRV" and "LTOPIC", or once
 * `WM_USER + 1` with lParam 1 says so, "Progman" and "Progman" -- either
 * left out matching, with WM_DDE_ACK sent from A, the two atoms added for
 * the receiver to delete. With `WM_USER + 1`'s wParam 1, it acknowledges
 * twice, from A and then from B, each with atoms of its own; an initiate
 * that comes while it is acknowledging is acknowledged once, from A. B
 * answers no initiate. Each window answers WM_DDE_TERMINATE with a
 * terminate posted back.
 *
 * What each window is handed is written to C:\ORACLE\DDEL.TXT: `S:init`
 * with the window it came to and how deep in acknowledging, `S:ack` from
 * which window, `S:term` at which window, `sent` or `posted`, and from a
 * window of which class.
 *
 * `WM_USER + 9` closes it.
 */

#include <windows.h>
#include <dde.h>

#define LOG "C:\\ORACLE\\DDEL.TXT"

static HWND first;
static HWND second;
static BOOL twice;
static BOOL asProgman;
static int depth;

static void note(LPCSTR text)
{
    HFILE file = _lopen(LOG, OF_READWRITE);

    if (file == HFILE_ERROR) {
        file = _lcreat(LOG, 0);
    }

    _llseek(file, 0L, 2);
    _lwrite(file, text, lstrlen(text));
    _lwrite(file, "\r\n", 2);
    _lclose(file);
}

static LPCSTR nameOf(HWND window)
{
    return window == first ? "A" : window == second ? "B" : "?";
}

static void acknowledge(HWND from, HWND client)
{
    char line[40];
    ATOM a = GlobalAddAtom(asProgman ? "Progman" : "LISTSRV");
    ATOM t = GlobalAddAtom(asProgman ? "Progman" : "LTOPIC");

    wsprintf(line, "S:ack:%s", nameOf(from));
    note(line);
    SendMessage(client, WM_DDE_ACK, (WPARAM)from, MAKELONG(a, t));
}

LRESULT CALLBACK __export Proc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    char line[80];
    char kind[24];
    ATOM a;
    ATOM t;
    BOOL ours;

    switch (message) {
    case WM_DDE_INITIATE:
        if (window != first || !IsWindow((HWND)wParam) || GetWindowTask((HWND)wParam)
                                                              == GetCurrentTask()) {
            return 0;
        }

        a = GlobalAddAtom(asProgman ? "Progman" : "LISTSRV");
        t = GlobalAddAtom(asProgman ? "Progman" : "LTOPIC");
        ours = (!LOWORD(lParam) || LOWORD(lParam) == a) && (!HIWORD(lParam) || HIWORD(lParam) == t);
        GlobalDeleteAtom(a);
        GlobalDeleteAtom(t);

        if (!ours) {
            return 0;
        }

        wsprintf(line, "S:init:%s:%d", nameOf(window), depth);
        note(line);
        depth++;
        acknowledge(first, (HWND)wParam);

        if (twice && depth == 1) {
            acknowledge(second, (HWND)wParam);
        }

        depth--;
        return 0;

    case WM_DDE_TERMINATE:
        kind[0] = '\0';

        if (IsWindow((HWND)wParam)) {
            GetClassName((HWND)wParam, kind, sizeof(kind));
        }

        wsprintf(line, "S:term:%s:%s:%s", nameOf(window), (LPSTR)(InSendMessage() ? "sent" : "posted"),
                 (LPSTR)(kind[0] ? kind : "gone"));
        note(line);
        PostMessage((HWND)wParam, WM_DDE_TERMINATE, (WPARAM)window, 0L);
        return 0;

    case WM_USER + 1:
        twice = wParam != 0;
        asProgman = lParam != 0;
        return 0;

    case WM_USER + 9:
        DestroyWindow(second);
        DestroyWindow(first);
        return 0;

    case WM_DESTROY:
        if (window == first) {
            PostQuitMessage(0);
        }

        return 0;
    }

    return DefWindowProc(window, message, wParam, lParam);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    MSG message;

    kind.style = 0;
    kind.lpfnWndProc = Proc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "DdeListS";
    RegisterClass(&kind);

    second = CreateWindow("DdeListS", "List Second", WS_OVERLAPPEDWINDOW, 400, 140, 200, 100,
                          NULL, NULL, instance, NULL);
    first = CreateWindow("DdeListS", "List Server", WS_OVERLAPPEDWINDOW, 400, 20, 200, 100, NULL,
                         NULL, instance, NULL);
    ShowWindow(second, SW_SHOWNOACTIVATE);
    ShowWindow(first, SW_SHOWNOACTIVATE);

    while (GetMessage(&message, NULL, 0, 0)) {
        TranslateMessage(&message);
        DispatchMessage(&message);
    }

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
