/*
 * The control server `pmatom.c` starts: an overlapped window, "Atom
 * Server", that answers WM_DDE_INITIATE by hand, with no DDEML, the way
 * Program Manager does (`PROGMAN.EXE` seg7 `0b24`-`0b8d`): it adds the
 * names it would answer with as atoms, compares them with the initiator's,
 * and on a match sends WM_DDE_ACK with them -- the receiver's to delete --
 * and otherwise deletes them again. It is not Program Manager: what
 * DDEML does with its atoms is what it does for any server.
 *
 * It answers the application "Control" and the topic "Topic" (either left
 * out matching), and, once `WM_USER + 1` with a wParam of 1 says so,
 * "Progman" and "Progman" too -- a server of Program Manager's name that
 * is not Program Manager. WM_DDE_TERMINATE is answered with a terminate
 * posted back. `WM_USER + 9` closes it.
 */

#include <windows.h>
#include <dde.h>

static BOOL asProgman;

/* Program Manager's way, for one pair of names. */
static void answer(HWND window, HWND client, ATOM app, ATOM topic, LPCSTR myApp,
                   LPCSTR myTopic)
{
    ATOM a = GlobalAddAtom(myApp);
    ATOM t = GlobalAddAtom(myTopic);

    if ((!app || app == a) && (!topic || topic == t)) {
        SendMessage(client, WM_DDE_ACK, (WPARAM)window, MAKELONG(a, t));
    } else {
        GlobalDeleteAtom(a);
        GlobalDeleteAtom(t);
    }
}

LRESULT CALLBACK __export Proc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    switch (message) {
    case WM_DDE_INITIATE:
        if ((HWND)wParam != window && IsWindow((HWND)wParam)) {
            answer(window, (HWND)wParam, LOWORD(lParam), HIWORD(lParam), "Control", "Topic");

            if (asProgman) {
                answer(window, (HWND)wParam, LOWORD(lParam), HIWORD(lParam), "Progman",
                       "Progman");
            }
        }

        return 0;

    case WM_DDE_TERMINATE:
        PostMessage((HWND)wParam, WM_DDE_TERMINATE, (WPARAM)window, 0L);
        return 0;

    case WM_USER + 1:
        asProgman = wParam != 0;
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
    kind.lpszClassName = "ProgAtomS";
    RegisterClass(&kind);

    window = CreateWindow("ProgAtomS", "Atom Server", WS_OVERLAPPEDWINDOW, 240, 20, 200, 100,
                          NULL, NULL, instance, NULL);
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
