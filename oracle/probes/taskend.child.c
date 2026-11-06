/*
 * The program `taskend.c` runs and watches end: it puts in hooks whose
 * procedures are in `TASKENDD.DLL`, makes windows -- its own, a button, a
 * popup it owns, one of a class whose procedure is the library's, a child
 * of the probe's window -- tells the library it is ready, and ends when it
 * is told to, without destroying a window or taking a hook out.
 *
 * Its hooks, all `WH_GETMESSAGE` but the fifth:
 *
 * * 0, `SetWindowsHookEx` for its own task, its instance given;
 * * 1, `SetWindowsHookEx` for every task, its instance given;
 * * 2, `SetWindowsHook`, which puts a message hook in for every task;
 * * 3, `SetWindowsHookEx` for every task, the library's instance given;
 * * 4, `SetWindowsHook` with `WH_MSGFILTER`, the task's own.
 */

#define IMPORTS_PROBE_LIBRARY
#include <windows.h>

void FAR PASCAL TeSetWindow(int which, HWND hwnd);
HWND FAR PASCAL TeWindow(int which);
void FAR PASCAL TeNote(LPCSTR who, HWND hwnd, UINT message);
void FAR PASCAL TeSetHook(int which, DWORD hook, BOOL isOld);
void FAR PASCAL TeSetReady(BOOL on);
DWORD FAR PASCAL TeHook0(int code, WPARAM wParam, LPARAM lParam);
DWORD FAR PASCAL TeHook1(int code, WPARAM wParam, LPARAM lParam);
DWORD FAR PASCAL TeHook2(int code, WPARAM wParam, LPARAM lParam);
DWORD FAR PASCAL TeHook3(int code, WPARAM wParam, LPARAM lParam);
DWORD FAR PASCAL TeHook4(int code, WPARAM wParam, LPARAM lParam);
LRESULT FAR PASCAL TeWndProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam);

#define WM_TE_END (WM_USER + 1)

LRESULT FAR PASCAL _export ChildProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    TeNote("c", hwnd, message);

    if (message == WM_TE_END) {
        PostQuitMessage(0);
        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS wc;
    HINSTANCE library = GetModuleHandle("TASKENDD");
    HWND w1;
    MSG msg;

    wc.style = 0;
    wc.lpfnWndProc = ChildProc;
    wc.cbClsExtra = 0;
    wc.cbWndExtra = 0;
    wc.hInstance = instance;
    wc.hIcon = NULL;
    wc.hCursor = LoadCursor(NULL, IDC_ARROW);
    wc.hbrBackground = GetStockObject(WHITE_BRUSH);
    wc.lpszMenuName = NULL;
    wc.lpszClassName = "TECHILD";
    RegisterClass(&wc);

    wc.style = CS_GLOBALCLASS;
    wc.lpfnWndProc = TeWndProc;
    wc.lpszClassName = "TEGLOBAL";
    RegisterClass(&wc);

    TeSetHook(0, (DWORD)SetWindowsHookEx(WH_GETMESSAGE, (HOOKPROC)TeHook0, instance, GetCurrentTask()),
              FALSE);
    TeSetHook(1, (DWORD)SetWindowsHookEx(WH_GETMESSAGE, (HOOKPROC)TeHook1, instance, NULL), FALSE);
    TeSetHook(2, (DWORD)SetWindowsHook(WH_GETMESSAGE, (HOOKPROC)TeHook2), TRUE);
    TeSetHook(3, (DWORD)SetWindowsHookEx(WH_GETMESSAGE, (HOOKPROC)TeHook3, library, NULL), FALSE);
    TeSetHook(4, (DWORD)SetWindowsHook(WH_MSGFILTER, (HOOKPROC)TeHook4), TRUE);

    w1 = CreateWindow("TECHILD", "w1", WS_OVERLAPPEDWINDOW, 300, 20, 200, 150, NULL, NULL, instance,
                      NULL);
    TeSetWindow(0, w1);
    TeSetWindow(1, CreateWindow("BUTTON", "w1a", WS_CHILD | WS_VISIBLE, 4, 4, 60, 20, w1, (HMENU)1,
                                instance, NULL));
    TeSetWindow(2, CreateWindow("TECHILD", "w1b", WS_CHILD | WS_VISIBLE, 70, 4, 60, 20, w1,
                                (HMENU)2, instance, NULL));
    TeSetWindow(3, CreateWindow("TECHILD", "w2", WS_POPUP | WS_CAPTION, 320, 200, 120, 60, w1, NULL,
                                instance, NULL));
    TeSetWindow(4, CreateWindow("TEGLOBAL", "w3", WS_OVERLAPPED | WS_CAPTION, 460, 200, 120, 60, NULL,
                                NULL, instance, NULL));
    TeSetWindow(5, CreateWindow("TECHILD", "w4", WS_CHILD | WS_VISIBLE, 10, 10, 40, 20, TeWindow(7),
                                (HMENU)3, instance, NULL));

    ShowWindow(w1, SW_SHOWNOACTIVATE);
    ShowWindow(TeWindow(3), SW_SHOWNOACTIVATE);
    ShowWindow(TeWindow(4), SW_SHOWNOACTIVATE);
    UpdateWindow(w1);
    TeSetReady(TRUE);

    while (GetMessage(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }

    TeSetReady(FALSE);

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
