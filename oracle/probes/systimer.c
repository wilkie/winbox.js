/*
 * USER's ordinals 11 and 182, called by ordinal: a system timer set and
 * killed, as `SetTimer` and `KillTimer` with the timer marked as the
 * system's (`USER.EXE` seg1 `744c`, `74f4`), which comes as `WM_SYSTIMER`.
 *
 * * `set`: ordinal 11's answer for a window's timer, and `SetTimer`'s for a
 *   timer of the same window and identifier.
 * * `message`: the `WM_SYSTIMER` and `WM_TIMER` taken for them, their
 *   `wParam` and `lParam`.
 * * `kill`: `KillTimer` of the identifier, the system timer still coming,
 *   then ordinal 182, again, and `KillTimer` again.
 * * `proc`: a system timer set with a procedure: its message's `lParam`
 *   (`proc` where it is the procedure), and what `DispatchMessage` of it does:
 *   whether the procedure is called, and with what message.
 * * `nowindow`: ordinal 11 for no window, identifier nought: whether it
 *   answers non-nought, and ordinal 182 of that.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\SYSTIMER.OUT"

#define WM_SYSTIMER 0x0118

typedef UINT(FAR PASCAL *SETSYS)(HWND, UINT, UINT, FARPROC);
typedef BOOL(FAR PASCAL *KILLSYS)(HWND, UINT);

static SETSYS setSystemTimer;
static KILLSYS killSystemTimer;
static UINT called;
static UINT calledMessage;

void CALLBACK __export Tick(HWND window, UINT message, UINT id, DWORD time)
{
    called++;
    calledMessage = message;

    (void)window;
    (void)id;
    (void)time;
}

LRESULT CALLBACK __export WindowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    return DefWindowProc(window, message, wParam, lParam);
}

static void take(HWND window, UINT message, LPCSTR what)
{
    MSG msg;

    GetMessage(&msg, window, message, message);
    wsprintf(probeResult, "%04x %u %08lx", msg.message, msg.wParam, msg.lParam);
    probe("message", what, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS wc;
    HWND window;
    HMODULE user;
    FARPROC tick;
    MSG msg;
    UINT answer;

    probeOpen(OUTPUT);

    user = GetModuleHandle("USER");
    setSystemTimer = (SETSYS)GetProcAddress(user, MAKEINTRESOURCE(11));
    killSystemTimer = (KILLSYS)GetProcAddress(user, MAKEINTRESOURCE(182));
    tick = MakeProcInstance((FARPROC)Tick, instance);

    wc.style = 0;
    wc.lpfnWndProc = WindowProc;
    wc.cbClsExtra = 0;
    wc.cbWndExtra = 0;
    wc.hInstance = instance;
    wc.hIcon = NULL;
    wc.hCursor = NULL;
    wc.hbrBackground = NULL;
    wc.lpszMenuName = NULL;
    wc.lpszClassName = "SysTimerProbe";
    RegisterClass(&wc);

    window = CreateWindow("SysTimerProbe", "", WS_POPUP, 0, 0, 10, 10, NULL, NULL, instance, NULL);

    while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
        DispatchMessage(&msg);
    }

    wsprintf(probeResult, "%u", setSystemTimer(window, 7, 55, NULL));
    probe("set", "system 7", probeResult);
    wsprintf(probeResult, "%u", SetTimer(window, 7, 55, NULL));
    probe("set", "SetTimer 7", probeResult);
    take(window, WM_SYSTIMER, "system");
    take(window, WM_TIMER, "timer");

    wsprintf(probeResult, "%d", KillTimer(window, 7));
    probe("kill", "KillTimer 7", probeResult);
    take(window, WM_SYSTIMER, "system after KillTimer");
    wsprintf(probeResult, "%d", killSystemTimer(window, 7));
    probe("kill", "system 7", probeResult);
    wsprintf(probeResult, "%d", killSystemTimer(window, 7));
    probe("kill", "system 7 again", probeResult);
    wsprintf(probeResult, "%d", KillTimer(window, 7));
    probe("kill", "KillTimer 7 again", probeResult);
    wsprintf(probeResult, "%u", setSystemTimer(window, 0, 55, NULL));
    probe("set", "system 0", probeResult);
    wsprintf(probeResult, "%d", killSystemTimer(window, 0));
    probe("kill", "system 0", probeResult);

    while (PeekMessage(&msg, window, 0, 0, PM_REMOVE)) {
    }

    wsprintf(probeResult, "%u", setSystemTimer(window, 9, 55, tick));
    probe("proc", "set", probeResult);
    GetMessage(&msg, window, WM_SYSTIMER, WM_SYSTIMER);
    wsprintf(probeResult, "%04x %u %s", msg.message, msg.wParam,
             msg.lParam == (LPARAM)tick ? "proc" : msg.lParam ? "other" : "none");
    probe("proc", "message", probeResult);
    called = 0;
    calledMessage = 0;
    DispatchMessage(&msg);
    wsprintf(probeResult, "%u %04x", called, calledMessage);
    probe("proc", "dispatched", probeResult);
    wsprintf(probeResult, "%d", killSystemTimer(window, 9));
    probe("proc", "kill", probeResult);

    answer = setSystemTimer(NULL, 0, 55, tick);
    probe("nowindow", "set", answer ? "non-nought" : "nought");
    wsprintf(probeResult, "%d", killSystemTimer(NULL, answer));
    probe("nowindow", "kill", probeResult);

    DestroyWindow(window);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
