/*
 * The 3.10 mark of a list box made with a module's instance other than the
 * program's: `CreateWindow` asks `GetExpWinVer` (`KERNEL` 167) of the
 * instance it is given (`USER.EXE` seg8 `0425`-`0432`), and a list box
 * without the mark tells its parent `LBN_SELCHANGE` before `LBN_DBLCLK` on
 * a double click (seg35 `16a2`-`16b5`).
 *
 * Four notifying list boxes in an ordinary window, each made with another
 * instance: the probe's own, `SHELL`'s (`SHELL.DLL` is made for 3.00),
 * `USER`'s (3.10) and `KERNEL`'s (`KRNL386.EXE`, 3.00). Each is given three
 * items and a double click on its second, sent with `SendMessage`. Records:
 *
 * * `expwinver`: what `GetExpWinVer`, found by its ordinal, answers for
 *   each instance (its low word).
 * * `notes`: the notifications the parent was sent for each list's double
 *   click, each `WM_COMMAND`'s control and code.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\LBMARK.OUT"

typedef WORD(FAR PASCAL *EXPWINVERPROC)(HINSTANCE);

static char notes[256];

LONG FAR PASCAL _export HostProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_COMMAND && LOWORD(lParam) != 0) {
        int length = lstrlen(notes);

        if (length < 240) {
            wsprintf(notes + length, "%s%d:%x", (LPSTR)(length ? "," : ""), wParam, HIWORD(lParam));
        }

        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

static void pump(void)
{
    MSG message;

    while (PeekMessage(&message, NULL, 0, 0, PM_REMOVE)) {
        TranslateMessage(&message);
        DispatchMessage(&message);
    }
}

static const char *NAMES[] = { "own", "shell", "user", "kernel" };

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS windowClass;
    HWND host;
    HWND boxes[4];
    HINSTANCE instances[4];
    EXPWINVERPROC expWinVer;
    int index;
    int item;
    DWORD style = WS_CHILD | WS_VISIBLE | WS_BORDER | LBS_NOTIFY;
    LPARAM at;

    probeOpen(OUTPUT);
    ShowCursor(FALSE);
    SetCursorPos(GetSystemMetrics(SM_CXSCREEN) - 1, GetSystemMetrics(SM_CYSCREEN) - 1);

    instances[0] = instance;
    instances[1] = LoadLibrary("SHELL.DLL");
    instances[2] = GetModuleHandle("USER");
    instances[3] = GetModuleHandle("KERNEL");

    expWinVer = (EXPWINVERPROC)GetProcAddress(GetModuleHandle("KERNEL"), MAKEINTRESOURCE(167));

    for (index = 0; index < 4; index++) {
        wsprintf(probeResult, "%x", expWinVer(instances[index]));
        probe("expwinver", NAMES[index], probeResult);
    }

    windowClass.style = 0;
    windowClass.lpfnWndProc = HostProc;
    windowClass.cbClsExtra = 0;
    windowClass.cbWndExtra = 0;
    windowClass.hInstance = instance;
    windowClass.hIcon = NULL;
    windowClass.hCursor = NULL;
    windowClass.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    windowClass.lpszMenuName = NULL;
    windowClass.lpszClassName = "MarkHost";
    RegisterClass(&windowClass);

    host = CreateWindow("MarkHost", "Marks", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 20, 20, 460, 140,
                        NULL, NULL, instance, NULL);

    for (index = 0; index < 4; index++) {
        boxes[index] = CreateWindow("LISTBOX", "", style, 8 + 108 * index, 8, 100, 60, host,
                                    (HMENU)(100 + index), instances[index], NULL);

        for (item = 0; item < 3; item++) {
            SendMessage(boxes[index], LB_ADDSTRING, 0, (LPARAM)(LPSTR)NAMES[item]);
        }
    }

    UpdateWindow(host);
    pump();

    for (index = 0; index < 4; index++) {
        int height = (int)SendMessage(boxes[index], LB_GETITEMHEIGHT, 0, 0L);

        at = MAKELONG(10, height + height / 2);
        notes[0] = '\0';
        SendMessage(boxes[index], WM_LBUTTONDOWN, MK_LBUTTON, at);
        SendMessage(boxes[index], WM_LBUTTONUP, 0, at);
        SendMessage(boxes[index], WM_LBUTTONDBLCLK, MK_LBUTTON, at);
        SendMessage(boxes[index], WM_LBUTTONUP, 0, at);
        pump();
        probe("notes", NAMES[index], notes);
    }

    DestroyWindow(host);
    pump();
    FreeLibrary(instances[1]);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
