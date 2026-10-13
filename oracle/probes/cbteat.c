/*
 * A computer-based training hook answering 1 for `HCBT_CREATEWND`: USER
 * then takes the window it has made apart again (`USER.EXE` seg8 `047d`,
 * `073b`), its children first, sending it `WM_NCDESTROY` (`0c36`-`0c84`),
 * and `CreateWindow` answers nought (`039d`).
 *
 * The hook, put in with `SetWindowsHookEx` for the probe's task, notes each
 * call, `c<code>`; the probe's window procedure notes each message it is
 * sent. A record is written before `CreateWindow` and one after, so that a
 * step that never comes back shows as the last record written.
 */

#define PROBE_FLUSH
#include "probe.h"

#define OUTPUT "C:\\ORACLE\\CBTEAT.OUT"

static HHOOK cbtHook;
static BOOL logging;
static char events[600];

static void add(LPCSTR text)
{
    if (lstrlen(events) + lstrlen(text) + 2 < sizeof(events)) {
        lstrcat(events, text);
        lstrcat(events, ",");
    }
}

LRESULT FAR PASCAL _export CbtHook(int code, WPARAM wParam, LPARAM lParam)
{
    char one[16];

    if (logging) {
        wsprintf(one, "c%d", code);
        add(one);
    }

    if (code == HCBT_CREATEWND) {
        return 1;
    }

    return CallNextHookEx(cbtHook, code, wParam, lParam);
}

LONG FAR PASCAL _export WindowProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    char one[16];

    if (logging) {
        wsprintf(one, "m%x", message);
        add(one);
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HWND made;

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
    kind.lpszClassName = "CbtEat";
    RegisterClass(&kind);

    cbtHook = SetWindowsHookEx(WH_CBT, (HOOKPROC)MakeProcInstance((FARPROC)CbtHook, instance),
                               instance, GetCurrentTask());

    probe("step", "create", "begun");
    events[0] = '\0';
    logging = TRUE;
    made = CreateWindow("CbtEat", "Eaten", WS_POPUP, 50, 60, 100, 80, NULL, NULL, instance, NULL);
    logging = FALSE;
    lstrcat(events, made ? "=made" : "=none");
    probe("done", "create", events);

    UnhookWindowsHookEx(cbtHook);
    probe("done", "unhooked", "1");
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
