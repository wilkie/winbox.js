/*
 * The debugging hook, `WH_DEBUG`. USER's one caller of hooks (`USER.EXE`
 * seg1 `800d`) looks, before each hook it calls, at whether a debugging
 * hook is in, the task's (`[64h]` of its queue) or the system's (`[8B6h]`),
 * and if so calls that chain first (`803d`-`805f`): code nought, `wParam`
 * the task of the hook about to be called (`[2]` of its queue), and
 * `lParam` a `DEBUGHOOKINFO` on the stack -- the hook's module, then the
 * caller's return address, the `lParam`, `wParam` and code the hook is to
 * be called with. A non-nought answer, in DX:AX, is the answer, and the
 * hook is not called. The debugging hook is itself called through the same
 * caller, which makes the same look before it.
 *
 * `F` is a message filter put in for the probe's task. Each step writes a
 * record before and one after, so that a step that never comes back shows
 * as the last record written.
 *
 * * `filter`: `CallMsgFilter` with `F` alone.
 * * `debug`: a debugging hook `G` put in for the probe's task; then
 *   `CallMsgFilter`.
 */

#define PROBE_FLUSH
#include "probe.h"

#define OUTPUT "C:\\ORACLE\\DBGHOOK.OUT"

static HHOOK filterHook;
static HHOOK debugHook;
static int depth;
static char events[600];

static void add(LPCSTR text)
{
    if (lstrlen(events) + lstrlen(text) + 2 < sizeof(events)) {
        lstrcat(events, text);
        lstrcat(events, ",");
    }
}

LRESULT FAR PASCAL _export Filter(int code, WPARAM wParam, LPARAM lParam)
{
    char one[32];

    wsprintf(one, "F%d:%x", code, ((MSG FAR *)lParam)->message);
    add(one);
    return CallNextHookEx(filterHook, code, wParam, lParam);
}

LRESULT FAR PASCAL _export Debug(int code, WPARAM wParam, LPARAM lParam)
{
    char one[80];
    DEBUGHOOKINFO FAR *info = (DEBUGHOOKINFO FAR *)lParam;

    depth++;

    if (depth < 4) {
        wsprintf(one, "G%d:%s/%s/%lx/%x/%d", code, wParam == (WPARAM)GetCurrentTask() ? "me" : "?",
                 info->hModuleHook ? "mod" : "0", info->lParam, info->wParam, info->code);
        add(one);
    }

    depth--;
    return CallNextHookEx(debugHook, code, wParam, lParam);
}

static LONG direct(void)
{
    MSG message;

    message.hwnd = NULL;
    message.message = WM_USER + 1;
    message.wParam = 0;
    message.lParam = 0;
    message.time = 0;
    message.pt.x = 0;
    message.pt.y = 0;
    return CallMsgFilter(&message, 77);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    char one[24];
    LONG answer;

    probeOpen(OUTPUT);

    filterHook = SetWindowsHookEx(WH_MSGFILTER,
                                  (HOOKPROC)MakeProcInstance((FARPROC)Filter, instance), instance,
                                  GetCurrentTask());

    probe("step", "filter", "begun");
    events[0] = '\0';
    answer = direct();
    wsprintf(one, "=%ld", answer);
    lstrcat(events, one);
    probe("step", "filter", events);

    debugHook = SetWindowsHookEx(WH_DEBUG, (HOOKPROC)MakeProcInstance((FARPROC)Debug, instance),
                                 instance, GetCurrentTask());
    probe("set", "debug", debugHook ? "handle" : "0");

    probe("step", "debug", "begun");
    events[0] = '\0';
    answer = direct();
    wsprintf(one, "=%ld", answer);
    lstrcat(events, one);
    probe("step", "debug", events);

    UnhookWindowsHookEx(debugHook);
    UnhookWindowsHookEx(filterHook);
    probe("step", "unhooked", "1");
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
