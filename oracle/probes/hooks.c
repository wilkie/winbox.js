/*
 * Message filter hooks: `SetWindowsHook` with `WH_MSGFILTER`, as most of the
 * accessories install one, and `SetWindowsHookEx`.
 *
 * Three hooks, installed in turn: A and B with `SetWindowsHook`, each
 * passing on with `DefHookProc`, and C with `SetWindowsHookEx`, passing on
 * with `CallNextHookEx`. Each notes what it is called with.
 *
 * * `set`: what each installation answered -- nought, or which hook it
 *   names as the one before.
 * * `calls`: during a step, each call a hook had, in order, as the hook, the
 *   code, and the message's number, `A:0:100`; at most forty. Not
 *   `WM_MOUSEMOVE`, which depends on where the pointer happens to be.
 * * `answer`: what a call answered.
 *
 * The steps: a modal dialog box with an edit control, closed by an Escape
 * posted to it from a timer; a pop-up menu, closed the same way;
 * `CallMsgFilter` with a message of its own; the same with C answering
 * non-nought; and after each unhooking.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\HOOKS.OUT"

static HOOKPROC procA;
static HOOKPROC procB;
static HOOKPROC procC;
static HOOKPROC nextA;
static HOOKPROC nextB;
static HHOOK hookC;
static char log[512];
static int calls;
static int logging;
static BOOL stopAtC;
static HWND host;
static BYTE FAR *template;
static int at;

static void note(char which, int code, LPARAM lParam)
{
    char one[24];
    MSG FAR *message = (MSG FAR *)lParam;

    /* The mouse's moves depend on where the pointer was: not noted. */
    if (!logging || calls >= 40 || (message && message->message == WM_MOUSEMOVE)) {
        return;
    }

    wsprintf(one, "%s%c:%d:%x", (LPSTR)(calls ? " " : ""), which, code,
             message ? message->message : 0);
    lstrcat(log, one);
    calls++;
}

DWORD FAR PASCAL _export HookA(int code, WPARAM wParam, LPARAM lParam)
{
    note('A', code, lParam);
    return DefHookProc(code, wParam, lParam, &nextA);
}

DWORD FAR PASCAL _export HookB(int code, WPARAM wParam, LPARAM lParam)
{
    note('B', code, lParam);
    return DefHookProc(code, wParam, lParam, &nextB);
}

LRESULT FAR PASCAL _export HookC(int code, WPARAM wParam, LPARAM lParam)
{
    note('C', code, lParam);

    if (stopAtC && code >= 0) {
        return 1;
    }

    return CallNextHookEx(hookC, code, wParam, lParam);
}

static void begin(void)
{
    log[0] = '\0';
    calls = 0;
    logging = 1;
}

static void end(LPCSTR step)
{
    logging = 0;
    probe("calls", step, log);
}

static void answer(LPCSTR what, LONG value)
{
    wsprintf(probeResult, "%ld", value);
    probe("answer", what, probeResult);
}

static LPCSTR which(HOOKPROC proc)
{
    if (!proc) {
        return "0";
    }

    if (proc == procA) {
        return "A";
    }

    if (proc == procB) {
        return "B";
    }

    return "?";
}

BOOL FAR PASCAL _export DialogProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    switch (message) {
    case WM_INITDIALOG:
        SetTimer(hwnd, 1, 50, NULL);
        return TRUE;

    case WM_TIMER:
        KillTimer(hwnd, 1);
        PostMessage(GetFocus(), WM_KEYDOWN, VK_ESCAPE, 0x00010001L);
        return TRUE;

    case WM_COMMAND:
        if (wParam == IDCANCEL) {
            EndDialog(hwnd, 7);
        }

        return TRUE;
    }

    return FALSE;
}

LONG FAR PASCAL _export HostProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_TIMER && wParam == 2) {
        KillTimer(hwnd, 2);
        PostMessage(hwnd, WM_KEYDOWN, VK_ESCAPE, 0x00010001L);
        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

static void byte(BYTE value)
{
    template[at++] = value;
}

static void word(WORD value)
{
    byte(LOBYTE(value));
    byte(HIBYTE(value));
}

static void string(LPCSTR text)
{
    while (*text) {
        byte(*text++);
    }

    byte(0);
}

static void build(void)
{
    DWORD style = WS_POPUP | WS_CAPTION | DS_MODALFRAME;
    DWORD edit = ES_LEFT | WS_BORDER | WS_TABSTOP | WS_CHILD | WS_VISIBLE;

    at = 0;
    word(LOWORD(style));
    word(HIWORD(style));
    byte(1);
    word(10);
    word(10);
    word(120);
    word(50);
    byte(0);
    byte(0);
    string("Hooked");
    word(6);
    word(6);
    word(80);
    word(12);
    word(101);
    word(LOWORD(edit));
    word(HIWORD(edit));
    byte(0x81);
    string("");
    byte(0);
}

static void filter(LPCSTR step, UINT number)
{
    MSG message;

    message.hwnd = host;
    message.message = number;
    message.wParam = 0;
    message.lParam = 0;
    message.time = 0;
    message.pt.x = 0;
    message.pt.y = 0;
    begin();
    answer(step, CallMsgFilter(&message, 0x42));
    end(step);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS windowClass;
    HGLOBAL memory;
    HMENU menu;
    DLGPROC dialogProc;
    HOOKPROC previousHook;

    probeOpen(OUTPUT);
    ShowCursor(FALSE);
    SetCursorPos(GetSystemMetrics(SM_CXSCREEN) - 1, GetSystemMetrics(SM_CYSCREEN) - 1);

    windowClass.style = 0;
    windowClass.lpfnWndProc = HostProc;
    windowClass.cbClsExtra = 0;
    windowClass.cbWndExtra = 0;
    windowClass.hInstance = instance;
    windowClass.hIcon = NULL;
    windowClass.hCursor = NULL;
    windowClass.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    windowClass.lpszMenuName = NULL;
    windowClass.lpszClassName = "Hooks";
    RegisterClass(&windowClass);
    host = CreateWindow("Hooks", "Hooks", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 20, 20, 300, 200,
                        NULL, NULL, instance, NULL);
    UpdateWindow(host);

    procA = (HOOKPROC)MakeProcInstance((FARPROC)HookA, instance);
    procB = (HOOKPROC)MakeProcInstance((FARPROC)HookB, instance);
    procC = (HOOKPROC)MakeProcInstance((FARPROC)HookC, instance);

    nextA = SetWindowsHook(WH_MSGFILTER, procA);
    probe("set", "A", which(nextA));
    nextB = SetWindowsHook(WH_MSGFILTER, procB);
    probe("set", "B", which(nextB));
    hookC = SetWindowsHookEx(WH_MSGFILTER, procC, instance, GetCurrentTask());
    probe("set", "C", hookC ? "handle" : "0");

    /* A modal dialog box. */
    memory = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, 256);
    template = (BYTE FAR *)GlobalLock(memory);
    build();
    dialogProc = (DLGPROC)MakeProcInstance((FARPROC)DialogProc, instance);
    begin();
    answer("dialog", DialogBoxIndirect(instance, memory, host, dialogProc));
    end("dialog");

    /* A pop-up menu. */
    menu = CreatePopupMenu();
    AppendMenu(menu, MF_STRING, 10, "One");
    AppendMenu(menu, MF_STRING, 11, "Two");
    SetTimer(host, 2, 50, NULL);
    begin();
    answer("menu", TrackPopupMenu(menu, 0, 40, 40, 0, host, NULL));
    end("menu");
    DestroyMenu(menu);

    /* Called directly. */
    filter("direct", WM_USER + 5);
    stopAtC = TRUE;
    filter("direct-stop", WM_USER + 6);
    stopAtC = FALSE;

    answer("unhook-B", UnhookWindowsHook(WH_MSGFILTER, procB));
    filter("after-B", WM_USER + 7);
    answer("unhook-C", UnhookWindowsHookEx(hookC));
    filter("after-C", WM_USER + 8);
    answer("unhook-A", UnhookWindowsHook(WH_MSGFILTER, procA));
    filter("after-A", WM_USER + 9);

    DestroyWindow(host);
    probeFinish();

    return 0;
}
