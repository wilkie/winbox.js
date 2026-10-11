/*
 * The `WH_GETMESSAGE` hook: which looks USER calls it from, with what, and
 * what a hook that changes the message does (`USER.EXE` seg1 `2597`-`25cf`).
 *
 * `T` is an overlapped window at (40, 40), 400 by 300, with a child `A` of
 * the probe's own class at (10, 10), 150 by 100, which has the focus. The
 * hook is put in with `SetWindowsHook`, as DDEML puts in its own, and
 * passes on with `DefHookProc`. It writes `g`, its code, its `wParam`, and
 * from the `MSG` its `lParam` points at the message and the window, in hex;
 * a keyboard hook, where a case puts one in, writes `k`, its code and the
 * virtual key. What a call answered is written `P` for `PeekMessage` and `G`
 * for `GetMessage`, the answer, and the message it handed over with its
 * `wParam`. Messages taken with `PM_NOREMOVE` are left in the queue.
 *
 * * `post`: `WM_USER` posted to `T`, then `PeekMessage` with `PM_NOREMOVE`,
 *   with `PM_REMOVE`, and with `PM_REMOVE` again, finding nothing.
 * * `noyield`: `WM_USER` posted; `PeekMessage` with `PM_REMOVE` and
 *   `PM_NOYIELD`.
 * * `get`: `WM_USER` posted; `GetMessage`.
 * * `change`: the hook makes `WM_USER + 5` into `WM_USER + 6` with a
 *   `wParam` of 66h and an `lParam` of 6666h. `WM_USER + 5` posted, then
 *   `PeekMessage` with `PM_NOREMOVE`, with `PM_REMOVE`, and again.
 * * `toquit`: the hook makes `WM_USER + 7` into `WM_QUIT`. `WM_USER + 7`
 *   posted; `GetMessage`; `PeekMessage` with `PM_REMOVE`.
 * * `fromquit`: the hook makes `WM_QUIT` into `WM_USER + 8`.
 *   `PostQuitMessage(5)`; `GetMessage`.
 * * `key`: a keyboard hook put in for the task. X pressed and let go
 *   through USER's `KEYBD_EVENT`; `PeekMessage` for the keys with
 *   `PM_NOREMOVE`; then `GetMessage` and `TranslateMessage`, three times.
 * * `paint`: `T` made invalid; `GetMessage` for `T`'s `WM_PAINT`.
 * * `timer`: a timer of 10 ms set for `T`; `GetMessage` for `WM_TIMER`.
 * * `sent`: `WM_USER + 9` sent to `T`.
 * * `locked`: `LockMyTask(TRUE)`; `WM_USER` posted; `PeekMessage` with
 *   `PM_REMOVE`; `LockMyTask(FALSE)`.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\GMHOOK.OUT"

typedef void(FAR PASCAL *LOCKMYTASK)(BOOL);

static HINSTANCE module;
static HWND top;
static HWND a;
static FARPROC keybdEvent;
static LOCKMYTASK lockMyTask;
static HOOKPROC procGet;
static HOOKPROC nextGet;
static HHOOK keyboardHook;
static int change;
static BOOL logging;
static char events[1600];

static WORD keyAX;
static WORD keyBX;

static LPCSTR whose(HWND hwnd)
{
    static char handle[8];

    if (hwnd == NULL) {
        return "none";
    }

    if (hwnd == top) {
        return "T";
    }

    if (hwnd == a) {
        return "A";
    }

    wsprintf(handle, "%04x", hwnd);
    return handle;
}

static void add(LPCSTR text)
{
    if (lstrlen(events) + lstrlen(text) + 2 < sizeof(events)) {
        lstrcat(events, text);
        lstrcat(events, ",");
    }
}

DWORD FAR PASCAL _export GetHook(int code, WPARAM wParam, LPARAM lParam)
{
    char one[48];
    MSG FAR *msg = (MSG FAR *)lParam;

    if (logging && code >= 0 && msg->message != WM_MOUSEMOVE) {
        wsprintf(one, "g%d:%x/%x/%s", code, wParam, msg->message, whose(msg->hwnd));
        add(one);

        if (change == 1 && msg->message == WM_USER + 5) {
            msg->message = WM_USER + 6;
            msg->wParam = 0x66;
            msg->lParam = 0x6666L;
        } else if (change == 2 && msg->message == WM_USER + 7) {
            msg->message = WM_QUIT;
        } else if (change == 3 && msg->message == WM_QUIT) {
            msg->message = WM_USER + 8;
        }
    }

    return DefHookProc(code, wParam, lParam, &nextGet);
}

DWORD FAR PASCAL _export KeyboardHook(int code, WPARAM wParam, LPARAM lParam)
{
    char one[32];

    if (logging) {
        wsprintf(one, "k%d:%x", code, wParam);
        add(one);
    }

    return CallNextHookEx(keyboardHook, code, wParam, lParam);
}

LONG FAR PASCAL _export TopProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    return DefWindowProc(hwnd, message, wParam, lParam);
}

static void key(BYTE vk, BYTE scan, BOOL up)
{
    keyAX = (WORD)vk | (up ? 0x8000 : 0);
    keyBX = scan;

    _asm {
        push si
        push di
        mov ax, keyAX
        mov bx, keyBX
        xor si, si
        xor di, di
        call dword ptr keybdEvent
        pop di
        pop si
    }
}

static void pump(void)
{
    MSG message;
    int count = 0;

    while (count < 80 && PeekMessage(&message, NULL, 0, 0, PM_REMOVE)) {
        TranslateMessage(&message);
        DispatchMessage(&message);
        count++;
    }
}

static void peek(HWND hwnd, UINT first, UINT last, UINT flags)
{
    MSG message;
    char one[40];
    BOOL found = PeekMessage(&message, hwnd, first, last, flags);

    if (found) {
        wsprintf(one, "P1:%x/%x", message.message, message.wParam);
    } else {
        lstrcpy(one, "P0");
    }

    add(one);

    if (found && (flags & PM_REMOVE) && message.message != WM_PAINT) {
        DispatchMessage(&message);
    }
}

static void get(HWND hwnd, UINT first, UINT last)
{
    MSG message;
    char one[40];
    BOOL answer = GetMessage(&message, hwnd, first, last);

    wsprintf(one, "G%d:%x/%x", answer, message.message, message.wParam);
    add(one);
    TranslateMessage(&message);
    DispatchMessage(&message);
}

static void start(void)
{
    SetFocus(a);
    pump();
    events[0] = '\0';
    logging = TRUE;
}

static void finish(LPCSTR name)
{
    logging = FALSE;
    change = 0;
    pump();
    probe("hooks", name, events[0] ? events : "none");
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;

    probeOpen(OUTPUT);
    module = instance;

    kind.style = 0;
    kind.lpfnWndProc = TopProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = LoadCursor(NULL, IDC_ARROW);
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "GmhkTop";
    RegisterClass(&kind);

    kind.lpszClassName = "GmhkKid";
    RegisterClass(&kind);

    keybdEvent = GetProcAddress(GetModuleHandle("USER"), "KEYBD_EVENT");
    lockMyTask = (LOCKMYTASK)GetProcAddress(GetModuleHandle("USER"), "LOCKMYTASK");
    probe("entry", "KEYBD_EVENT", keybdEvent ? "found" : "missing");
    probe("entry", "LOCKMYTASK", lockMyTask ? "found" : "missing");

    top = CreateWindow("GmhkTop", "T", WS_OVERLAPPEDWINDOW, 40, 40, 400, 300, NULL, NULL, module,
                       NULL);
    a = CreateWindow("GmhkKid", "", WS_CHILD | WS_VISIBLE | WS_BORDER, 10, 10, 150, 100, top,
                     (HMENU)1, module, NULL);
    ShowWindow(top, SW_SHOWNORMAL);
    UpdateWindow(top);
    SetFocus(a);
    pump();

    procGet = (HOOKPROC)MakeProcInstance((FARPROC)GetHook, instance);
    nextGet = (HOOKPROC)SetWindowsHook(WH_GETMESSAGE, procGet);

    start();
    PostMessage(top, WM_USER, 1, 0L);
    peek(NULL, 0, 0, PM_NOREMOVE);
    peek(NULL, 0, 0, PM_REMOVE);
    peek(NULL, 0, 0, PM_REMOVE);
    finish("post");

    start();
    PostMessage(top, WM_USER, 2, 0L);
    peek(NULL, 0, 0, PM_REMOVE | PM_NOYIELD);
    finish("noyield");

    start();
    PostMessage(top, WM_USER, 3, 0L);
    get(NULL, 0, 0);
    finish("get");

    start();
    change = 1;
    PostMessage(top, WM_USER + 5, 5, 0L);
    peek(NULL, 0, 0, PM_NOREMOVE);
    peek(NULL, 0, 0, PM_REMOVE);
    peek(NULL, 0, 0, PM_REMOVE);
    finish("change");

    start();
    change = 2;
    PostMessage(top, WM_USER + 7, 7, 0L);
    get(NULL, 0, 0);
    peek(NULL, 0, 0, PM_REMOVE);
    finish("toquit");

    start();
    change = 3;
    PostQuitMessage(5);
    get(NULL, 0, 0);
    finish("fromquit");

    if (keybdEvent) {
        keyboardHook = SetWindowsHookEx(WH_KEYBOARD,
                                        (HOOKPROC)MakeProcInstance((FARPROC)KeyboardHook, instance),
                                        instance, GetCurrentTask());
        start();
        key(0x58, 0x2d, FALSE);
        key(0x58, 0x2d, TRUE);
        peek(NULL, WM_KEYFIRST, WM_KEYLAST, PM_NOREMOVE);
        get(NULL, 0, 0);
        get(NULL, 0, 0);
        get(NULL, 0, 0);
        finish("key");
        UnhookWindowsHookEx(keyboardHook);
    }

    start();
    InvalidateRect(top, NULL, FALSE);
    get(top, WM_PAINT, WM_PAINT);
    finish("paint");

    start();
    SetTimer(top, 1, 10, NULL);
    get(NULL, WM_TIMER, WM_TIMER);
    KillTimer(top, 1);
    finish("timer");

    start();
    SendMessage(top, WM_USER + 9, 9, 0L);
    finish("sent");

    if (lockMyTask) {
        start();
        lockMyTask(TRUE);
        PostMessage(top, WM_USER, 4, 0L);
        peek(NULL, 0, 0, PM_REMOVE);
        lockMyTask(FALSE);
        finish("locked");
    }

    UnhookWindowsHook(WH_GETMESSAGE, procGet);

    start();
    PostMessage(top, WM_USER, 5, 0L);
    peek(NULL, 0, 0, PM_REMOVE);
    finish("unhooked");

    DestroyWindow(top);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
