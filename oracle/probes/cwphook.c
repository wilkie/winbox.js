/*
 * The `WH_CALLWNDPROC` hook: which messages USER calls it with, when, and
 * with what. Put in the way MFC's programs put it in, with
 * `SetWindowsHookEx` for the task's own.
 *
 * * `order`: what happened during a step, in sequence: `h` and the message
 *   for a call of the hook, `p` and the message for the window procedure
 *   receiving one. Messages in hex, the window procedure's only for the
 *   step's window.
 * * `hook`: the distinct shapes of the hook's calls during a step, each as
 *   `code/wParam/where`: the hook's code and `wParam` as numbers, and
 *   where its `lParam` points -- `stack` on the stack segment, or `other`.
 * * `words`: the words at the hook's `lParam` when called with the step's
 *   own message, in order, the window named as `it`.
 * * `got`: what the window procedure received for the step's message, when
 *   the hook changes the words it was handed.
 * * `answer`: what `SendMessage` answered.
 */

#include "probe.h"

#include <string.h>

#define OUTPUT "C:\\ORACLE\\CWPHOOK.OUT"

static HWND it;
static HHOOK hook;
static char order[1600];
static char shapes[200];
static char words[120];
static char got[120];
static UINT watched;
static int change;

static void add(LPSTR into, int size, LPCSTR one)
{
    if (lstrlen(into) + lstrlen(one) < size - 1) {
        lstrcat(into, one);
    }
}

LRESULT FAR PASCAL _export CallWndProc(int code, WPARAM wParam, LPARAM lParam)
{
    WORD FAR *at = (WORD FAR *)lParam;
    char one[60];
    WORD stack;

    _asm mov stack, ss;

    wsprintf(one, "%sh%x", (LPSTR)(order[0] ? " " : ""), at[3]);
    add(order, sizeof(order), one);

    wsprintf(one, "%d/%d/%s", code, wParam,
             (LPSTR)(HIWORD(lParam) == stack ? "stack" : "other"));

    if (!strstr(shapes, one)) {
        if (shapes[0]) {
            add(shapes, sizeof(shapes), ",");
        }
        add(shapes, sizeof(shapes), one);
    }

    if (at[3] == watched) {
        wsprintf(words, "%04x %04x %04x %04x %s", at[0], at[1], at[2], at[3],
                 (LPSTR)(at[4] == (WORD)it ? "it" : "other"));

        if (change) {
            at[0] = 0x1111;
            at[1] = 0x2222;
            at[2] = 0x3333;
            at[3] = watched + 1;
        }
    }

    return CallNextHookEx(hook, code, wParam, lParam);
}

LRESULT FAR PASCAL _export WindowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    char one[40];

    if (window == it || !it) {
        wsprintf(one, "%sp%x", (LPSTR)(order[0] ? " " : ""), message);
        add(order, sizeof(order), one);
    }

    if (message == watched || message == watched + 1) {
        wsprintf(got, "%x %x %lx", message, wParam, lParam);
        return 0x55;
    }

    return DefWindowProc(window, message, wParam, lParam);
}

static void begin(UINT message)
{
    order[0] = '\0';
    shapes[0] = '\0';
    words[0] = '\0';
    got[0] = '\0';
    watched = message;
}

static void step(LPCSTR name)
{
    probe("order", name, order[0] ? order : "none");
    probe("hook", name, shapes[0] ? shapes : "none");

    if (watched) {
        probe("words", name, words[0] ? words : "none");
        probe("got", name, got[0] ? got : "none");
    }

    begin(0);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    MSG msg;

    probeOpen(OUTPUT);

    memset(&kind, 0, sizeof(kind));
    kind.lpfnWndProc = WindowProc;
    kind.hInstance = instance;
    kind.lpszClassName = "CwpHook";
    RegisterClass(&kind);

    hook = SetWindowsHookEx(WH_CALLWNDPROC, (HOOKPROC)CallWndProc, instance, GetCurrentTask());

    /* Creation: everything USER sends a new window. Hidden, so the
     * sequence is creation's own and not showing's too. */
    begin(0);
    it = CreateWindow("CwpHook", "It", WS_OVERLAPPEDWINDOW, 10, 10, 200, 120, NULL, NULL, instance,
                      NULL);
    step("create");

    begin(WM_USER);
    wsprintf(probeResult, "%lx", SendMessage(it, WM_USER, 0x1234, 0x56789abcL));
    step("send");
    probe("answer", "send", probeResult);

    begin(WM_USER);
    PostMessage(it, WM_USER, 0x4321, 0x0badf00dL);
    while (PeekMessage(&msg, it, WM_USER, WM_USER, PM_REMOVE)) {
        DispatchMessage(&msg);
    }
    step("post");

    begin(WM_USER);
    change = 1;
    wsprintf(probeResult, "%lx", SendMessage(it, WM_USER, 0x1234, 0x56789abcL));
    change = 0;
    step("change");
    probe("answer", "change", probeResult);

    begin(0);
    DestroyWindow(it);
    step("destroy");

    UnhookWindowsHookEx(hook);

    begin(WM_USER);
    it = CreateWindow("CwpHook", "After", WS_OVERLAPPEDWINDOW, 10, 10, 200, 120, NULL, NULL,
                      instance, NULL);
    SendMessage(it, WM_USER, 1, 2);
    step("unhooked");
    DestroyWindow(it);

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
