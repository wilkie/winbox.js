/*
 * The server `ddeterm.c` starts: an overlapped window, "Term Server", that
 * speaks DDE by hand, with no DDEML. It answers WM_DDE_INITIATE for the
 * application "TERMSRV" and the topic "TTOPIC" (either left out matching)
 * with WM_DDE_ACK sent, its atoms added for the receiver to delete, and
 * does not answer WM_DDE_TERMINATE -- it keeps the window that sent it --
 * until `WM_USER + 1` says to: then it posts WM_DDE_TERMINATE to each
 * window it kept, and answers those that come after at once. `WM_USER + 2`
 * makes it deaf again. `WM_USER + 9` closes it.
 *
 * Each message it is handed is written to C:\ORACLE\DDET.TXT: `S:initiate`,
 * `S:terminate` (`kept` or `answered`), `S:answer` for each kept one
 * answered.
 */

#include <windows.h>
#include <dde.h>

#define LOG "C:\\ORACLE\\DDET.TXT"

static BOOL answering;
static HWND kept[8];
static int keptCount;

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

LRESULT CALLBACK __export Proc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    ATOM a;
    ATOM t;
    int i;

    switch (message) {
    case WM_DDE_INITIATE:
        if ((HWND)wParam == window || !IsWindow((HWND)wParam)) {
            return 0;
        }

        a = GlobalAddAtom("TERMSRV");
        t = GlobalAddAtom("TTOPIC");

        if ((!LOWORD(lParam) || LOWORD(lParam) == a) && (!HIWORD(lParam) || HIWORD(lParam) == t)) {
            note("S:initiate");
            SendMessage((HWND)wParam, WM_DDE_ACK, (WPARAM)window, MAKELONG(a, t));
        } else {
            GlobalDeleteAtom(a);
            GlobalDeleteAtom(t);
        }

        return 0;

    case WM_DDE_TERMINATE:
        if (answering) {
            note("S:terminate:answered");
            PostMessage((HWND)wParam, WM_DDE_TERMINATE, (WPARAM)window, 0L);
        } else {
            note("S:terminate:kept");

            if (keptCount < 8) {
                kept[keptCount++] = (HWND)wParam;
            }
        }

        return 0;

    case WM_USER + 1:
        answering = TRUE;

        for (i = 0; i < keptCount; i++) {
            note(IsWindow(kept[i]) ? "S:answer" : "S:answer:gone");
            PostMessage(kept[i], WM_DDE_TERMINATE, (WPARAM)window, 0L);
        }

        keptCount = 0;
        return 0;

    case WM_USER + 2:
        answering = FALSE;
        return 0;

    case WM_USER + 9:
        DestroyWindow(window);
        return 0;

    case WM_DESTROY:
        PostQuitMessage(0);
        return 0;
    }

    return DefWindowProc(window, message, wParam, lParam);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HWND window;
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
    kind.lpszClassName = "DdeTermS";
    RegisterClass(&kind);

    window = CreateWindow("DdeTermS", "Term Server", WS_OVERLAPPEDWINDOW, 400, 20, 200, 100, NULL,
                          NULL, instance, NULL);
    ShowWindow(window, SW_SHOWNOACTIVATE);

    while (GetMessage(&message, NULL, 0, 0)) {
        TranslateMessage(&message);
        DispatchMessage(&message);
    }

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
