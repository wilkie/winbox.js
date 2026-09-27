/*
 * The shell hook: when USER calls a `WH_SHELL` hook, and what SHELL's
 * `RegisterShellHook` -- Program Manager registers itself with it -- posts to
 * the windows registered with it.
 *
 * * `answer`: what `RegisterShellHook` answered.
 * * `hook`: what the probe's own `WH_SHELL` hook was called with during a
 *   step, each as `code:window`, the window named as the step's (`it`), the
 *   probe's own (`self`), `0`, or `other`, in sequence with the `WM_CREATE`
 *   and `WM_DESTROY` the windows were sent: `none` for no call.
 * * `posted`: which of SHELL's messages -- `created`, `destroyed`,
 *   `activate` -- reached the probe's window after the step, with their
 *   `wParam` named the same way.
 */

#include "probe.h"

#include <string.h>

#define OUTPUT "C:\\ORACLE\\SHLHOOK.OUT"

typedef BOOL(FAR PASCAL *REGPROC)(HWND, UINT);

static HWND self;
static HWND it;
static char hooked[600];
static HOOKPROC chain;
static UINT created;
static UINT destroyed;
static UINT activate;

static LPCSTR nameOf(WORD window)
{
    if (!window) {
        return "0";
    }

    if (window == (WORD)it) {
        return "it";
    }

    if (window == (WORD)self) {
        return "self";
    }

    return "other";
}

static int codes[16];
static WORD windows[16];
static int calls;

/* Kept as they come and named after the step: the hook is called inside
 * `CreateWindow`, before its answer is known. */
LRESULT FAR PASCAL _export ShellProc(int code, WPARAM wParam, LPARAM lParam)
{
    if (calls < 16) {
        codes[calls] = code;
        windows[calls] = (WORD)wParam;
        calls++;
    }

    return DefHookProc(code, wParam, lParam, &chain);
}

/* The windows' own procedure, which puts their creation and destruction in
 * the same sequence as the hook's calls: as codes 100 and 200. */
LRESULT FAR PASCAL _export WindowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    if ((message == WM_CREATE || message == WM_DESTROY) && calls < 16) {
        codes[calls] = message == WM_CREATE ? 100 : 200;
        windows[calls] = (WORD)window;
        calls++;
    }

    return DefWindowProc(window, message, wParam, lParam);
}

static void step(LPCSTR name)
{
    MSG msg;
    char posted[600];
    char one[40];
    int i;

    posted[0] = '\0';

    while (PeekMessage(&msg, self, 0, 0, PM_REMOVE)) {
        LPCSTR which = msg.message == created ? "created"
                       : msg.message == destroyed ? "destroyed"
                       : msg.message == activate ? "activate"
                       : NULL;

        if (which) {
            wsprintf(one, "%s%s:%s", (LPSTR)(posted[0] ? "," : ""), which, nameOf(msg.wParam));

            if (lstrlen(posted) + lstrlen(one) < sizeof(posted) - 1) {
                lstrcat(posted, one);
            }
        }
    }

    hooked[0] = '\0';

    for (i = 0; i < calls; i++) {
        if (codes[i] == 100 || codes[i] == 200) {
            wsprintf(one, "%s%s:%s", (LPSTR)(i ? "," : ""),
                     (LPSTR)(codes[i] == 100 ? "WM_CREATE" : "WM_DESTROY"), nameOf(windows[i]));
        } else {
            wsprintf(one, "%s%d:%s", (LPSTR)(i ? "," : ""), codes[i], nameOf(windows[i]));
        }
        lstrcat(hooked, one);
    }

    calls = 0;
    probe("hook", name, hooked[0] ? hooked : "none");
    probe("posted", name, posted[0] ? posted : "none");
    hooked[0] = '\0';
}

static HWND make(LPCSTR name, DWORD style, HWND parent, HINSTANCE instance)
{
    it = CreateWindow("ShlHook", name, style, 10, 10, 100, 60, parent, NULL, instance, NULL);
    step(name);
    return it;
}

static void destroy(LPCSTR name, HWND window)
{
    it = window;
    DestroyWindow(window);
    step(name);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    REGPROC reg;
    FARPROC proc;
    HWND window;

    probeOpen(OUTPUT);

    memset(&kind, 0, sizeof(kind));
    kind.lpfnWndProc = WindowProc;
    kind.hInstance = instance;
    kind.lpszClassName = "ShlHook";
    RegisterClass(&kind);

    self = CreateWindow("ShlHook", "Self", WS_OVERLAPPEDWINDOW, 0, 0, 100, 60, NULL, NULL, instance,
                        NULL);

    created = RegisterWindowMessage("OTHERWINDOWCREATED");
    destroyed = RegisterWindowMessage("OTHERWINDOWDESTROYED");
    activate = RegisterWindowMessage("ACTIVATESHELLWINDOW");

    proc = MakeProcInstance((FARPROC)ShellProc, instance);
    chain = SetWindowsHook(WH_SHELL, (HOOKPROC)proc);

    /* SHELL is not loaded until something needs it: Program Manager imports
     * it, and the probe loads it. */
    reg = (REGPROC)GetProcAddress(LoadLibrary("SHELL.DLL"), MAKEINTRESOURCE(102));
    wsprintf(probeResult, "%d", reg(self, 1));
    probe("answer", "register", probeResult);
    step("registered");

    window = make("hidden", WS_OVERLAPPEDWINDOW, NULL, instance);
    ShowWindow(window, SW_SHOWNORMAL);
    step("shown");
    destroy("hidden-destroyed", window);

    window = make("visible", WS_OVERLAPPEDWINDOW | WS_VISIBLE, NULL, instance);
    destroy("visible-destroyed", window);

    window = make("child", WS_CHILD | WS_VISIBLE, self, instance);
    destroy("child-destroyed", window);

    window = make("owned", WS_POPUP | WS_VISIBLE, self, instance);
    destroy("owned-destroyed", window);

    window = make("popup", WS_POPUP | WS_VISIBLE, NULL, instance);
    destroy("popup-destroyed", window);

    wsprintf(probeResult, "%d", reg(self, 0));
    probe("answer", "unregister", probeResult);

    window = make("after", WS_OVERLAPPEDWINDOW | WS_VISIBLE, NULL, instance);
    destroy("after-destroyed", window);

    UnhookWindowsHook(WH_SHELL, (HOOKPROC)proc);
    DestroyWindow(self);

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
