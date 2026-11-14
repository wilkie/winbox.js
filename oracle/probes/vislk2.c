/*
 * `LockWindowUpdate` while another task holds the lock: Windows answers
 * nought, to locking and to unlocking alike (`USER.EXE` seg13
 * `2282`-`2294`, the lock's queue at 13Ah against the caller's, seg1
 * `817b`).
 *
 * `A`, "Probe Lock A", is this program's window at (40, 40), 200 by 150;
 * `B`, "Probe Lock B", the window of VISLK2C.EXE (`vislk2.child.c`), which
 * answers `WM_USER` sent it with its own `LockWindowUpdate`'s answer. Each
 * record is one call's answer, made by `A` or, sent, by `B`, in turn.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\VISLK2.OUT"

static HWND mine;
static HWND other;

static void settle(int rounds)
{
    MSG message;
    int i;

    for (i = 0; i < rounds; i++) {
        while (PeekMessage(&message, NULL, 0, 0, PM_REMOVE)) {
            TranslateMessage(&message);
            DispatchMessage(&message);
        }

        Yield();
    }
}

static void answer(LPCSTR who, LPCSTR what, long value)
{
    wsprintf(probeResult, "%ld", value);
    probe(who, what, probeResult);
}

static long fromB(WPARAM how, HWND window)
{
    return SendMessage(other, WM_USER, how, MAKELPARAM((UINT)window, 0));
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    int i;

    probeOpen(OUTPUT);

    kind.style = 0;
    kind.lpfnWndProc = DefWindowProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "VisLk2A";
    RegisterClass(&kind);

    mine = CreateWindow("VisLk2A", "Probe Lock A", WS_OVERLAPPEDWINDOW, 40, 40, 200, 150, NULL, NULL,
                        instance, NULL);
    ShowWindow(mine, SW_SHOWNORMAL);
    UpdateWindow(mine);

    WinExec("VISLK2C.EXE", SW_SHOWNOACTIVATE);

    for (i = 0; i < 200 && !other; i++) {
        settle(1);
        other = FindWindow(NULL, "Probe Lock B");
    }

    probe("started", "B", (LPSTR)(other ? "yes" : "no"));

    if (other) {
        /* A holds the lock. */
        answer("A", "LockWindowUpdate A", LockWindowUpdate(mine));
        answer("B", "LockWindowUpdate nought", fromB(0, NULL));
        answer("B", "LockWindowUpdate B", fromB(1, NULL));
        answer("B", "LockWindowUpdate A", fromB(2, mine));
        answer("A", "LockWindowUpdate A again", LockWindowUpdate(mine));
        answer("A", "LockWindowUpdate nought", LockWindowUpdate(NULL));
        answer("A", "LockWindowUpdate nought again", LockWindowUpdate(NULL));

        /* B holds it. */
        answer("B", "LockWindowUpdate B", fromB(1, NULL));
        answer("A", "LockWindowUpdate A", LockWindowUpdate(mine));
        answer("A", "LockWindowUpdate B", LockWindowUpdate(other));
        answer("A", "LockWindowUpdate nought", LockWindowUpdate(NULL));
        answer("B", "LockWindowUpdate nought", fromB(0, NULL));
        answer("A", "LockWindowUpdate nought, none held", LockWindowUpdate(NULL));

        /* B locks A's window, and A unlocks it. */
        answer("B", "LockWindowUpdate A", fromB(2, mine));
        answer("A", "LockWindowUpdate nought", LockWindowUpdate(NULL));
        answer("B", "LockWindowUpdate nought", fromB(0, NULL));

        SendMessage(other, WM_CLOSE, 0, 0L);
        settle(20);
    }

    DestroyWindow(mine);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
