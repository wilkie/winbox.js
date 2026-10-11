/*
 * The hardware hooks, `WH_HARDWARE`, called for an event of the system
 * queue that is neither a key nor the mouse's (`USER.EXE` seg1 `2c18`); and
 * the computer-based training hooks' `HCBT_KEYSKIPPED` and
 * `HCBT_CLICKSKIPPED`, called as a key or a mouse event leaves the queue
 * where a keyboard or a mouse hook is in (`3312`-`333b`, `2f84`-`2fa7`,
 * `2c6c`-`2cb6`).
 *
 * `T` is an overlapped window at (40, 40), 400 by 300, with a child `A` of
 * the probe's own class at (10, 10), 150 by 100, which has the focus. Every
 * hook is put in with `SetWindowsHookEx` for the probe's own task, and
 * passes on with `CallNextHookEx`. They write:
 *
 * * the hardware hook `h`, its code, its `wParam`, and from the
 *   `HARDWAREHOOKSTRUCT` the window, the message, its `wParam` and
 *   `lParam`;
 * * the CBT hook, for `HCBT_KEYSKIPPED`, `c7`, the virtual key and the
 *   `lParam`; for `HCBT_CLICKSKIPPED`, `c6`, the message, and from the
 *   `MOUSEHOOKSTRUCT` the window, the hit-test code and the point; nothing
 *   for its other codes, nor for the mouse's moves;
 * * the keyboard hook `k`, its code and the virtual key; the mouse hook `m`,
 *   its code and the message, but not for the mouse's moves.
 *
 * The windows write the window, the message, its `wParam` and `lParam`, for
 * the keys' messages, the buttons', `WM_QUEUESYNC` and from `WM_USER` to
 * `WM_USER + 15`.
 *
 * Each case puts its input in through USER's own `KEYBD_EVENT` and
 * `MOUSE_EVENT`, or plays an event back through a journal playback hook,
 * which takes itself out as the event is taken; looks at the first of it
 * with `PeekMessage` and `PM_NOREMOVE` (`peek`); then takes and dispatches
 * all that is waiting. USER's `HARDWARE_EVENT` is not called: it reads the
 * system queue's selector from DS as it is called (`4d84`), which must be
 * USER's own segment, as it is where USER calls it itself.
 *
 * * `hard`: `WM_USER + 1` played back, `paramL` 3456h and `paramH` 7.
 * * `hardeat`: the same, the hardware hook answering 1 for `WM_USER + 1`.
 * * `sync`: `WM_QUEUESYNC` played back, `paramL` `T`.
 * * `keynohook`: X pressed and let go, with only the CBT hook in.
 * * `keyhook`: the same, with a keyboard hook in too.
 * * `keyeat`: Q pressed and let go, the keyboard hook answering 1 for Q.
 * * `clicknohook`: the left button pressed and let go in the middle of `A`,
 *   with only the CBT hook in.
 * * `clickhook`: the same, with a mouse hook in too.
 * * `clickeat`: the same, the mouse hook answering 1 for the press.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\HWHOOK.OUT"

static HINSTANCE module;
static HWND top;
static HWND a;
static FARPROC keybdEvent;
static FARPROC mouseEvent;
static HOOKPROC procPlay;
static HOOKPROC nextPlay;
static BOOL playing;
static UINT playMessage;
static UINT playL;
static UINT playH;
static HHOOK hardwareHook;
static HHOOK cbtHook;
static HHOOK keyboardHook;
static HHOOK mouseHook;
static BOOL eatKey;
static BOOL eatPress;
static BOOL eatHard;
static BOOL logging;
static char events[1600];

static WORD keyAX;
static WORD keyBX;
static WORD mouseFlags;
static WORD mouseX;
static WORD mouseY;

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

DWORD FAR PASCAL _export HardwareHook(int code, WPARAM wParam, LPARAM lParam)
{
    char one[64];
    HARDWAREHOOKSTRUCT FAR *hard = (HARDWAREHOOKSTRUCT FAR *)lParam;

    if (logging) {
        wsprintf(one, "h%d:%x/%s/%x/%x/%lx", code, wParam, whose(hard->hWnd), hard->wMessage,
                 hard->wParam, hard->lParam);
        add(one);
    }

    if (code >= 0 && eatHard && hard->wMessage == WM_USER + 1) {
        return 1;
    }

    return CallNextHookEx(hardwareHook, code, wParam, lParam);
}

DWORD FAR PASCAL _export CbtHook(int code, WPARAM wParam, LPARAM lParam)
{
    char one[64];

    if (logging && code == HCBT_KEYSKIPPED) {
        wsprintf(one, "c7:%x/%lx", wParam, lParam);
        add(one);
    } else if (logging && code == HCBT_CLICKSKIPPED && wParam != WM_MOUSEMOVE &&
               wParam != WM_NCMOUSEMOVE) {
        MOUSEHOOKSTRUCT FAR *mouse = (MOUSEHOOKSTRUCT FAR *)lParam;

        wsprintf(one, "c6:%x/%s/%d/%d,%d", wParam, whose(mouse->hwnd), mouse->wHitTestCode,
                 mouse->pt.x, mouse->pt.y);
        add(one);
    }

    return CallNextHookEx(cbtHook, code, wParam, lParam);
}

DWORD FAR PASCAL _export KeyboardHook(int code, WPARAM wParam, LPARAM lParam)
{
    char one[32];

    if (logging) {
        wsprintf(one, "k%d:%x", code, wParam);
        add(one);
    }

    if (code >= 0 && eatKey && wParam == 0x51) {
        return 1;
    }

    return CallNextHookEx(keyboardHook, code, wParam, lParam);
}

DWORD FAR PASCAL _export MouseHook(int code, WPARAM wParam, LPARAM lParam)
{
    char one[32];

    if (logging && wParam != WM_MOUSEMOVE && wParam != WM_NCMOUSEMOVE) {
        wsprintf(one, "m%d:%x", code, wParam);
        add(one);
    }

    if (code >= 0 && eatPress && wParam == WM_LBUTTONDOWN) {
        return 1;
    }

    return CallNextHookEx(mouseHook, code, wParam, lParam);
}

DWORD FAR PASCAL _export Play(int code, WPARAM wParam, LPARAM lParam)
{
    if (code == HC_GETNEXT) {
        EVENTMSG FAR *event = (EVENTMSG FAR *)lParam;

        event->message = playMessage;
        event->paramL = playL;
        event->paramH = playH;
        event->time = GetTickCount();
        return 0;
    }

    if (code == HC_SKIP) {
        if (playing) {
            UnhookWindowsHook(WH_JOURNALPLAYBACK, procPlay);
            playing = FALSE;
        }

        return 0;
    }

    return DefHookProc(code, wParam, lParam, &nextPlay);
}

static void note(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    char one[40];

    if ((message >= WM_KEYDOWN && message <= WM_SYSCHAR) || message == WM_LBUTTONDOWN ||
        message == WM_LBUTTONUP || message == WM_QUEUESYNC ||
        (message >= WM_USER && message < WM_USER + 16)) {
        if (message == WM_QUEUESYNC) {
            /* Its `lParam` a window: named, not its handle. */
            wsprintf(one, "%s%x:%x/%s/%x", whose(hwnd), message, wParam,
                     whose((HWND)LOWORD(lParam)), HIWORD(lParam));
        } else {
            wsprintf(one, "%s%x:%x/%lx", whose(hwnd), message, wParam, lParam);
        }

        add(one);
    }
}

LONG FAR PASCAL _export TopProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (logging) {
        note(hwnd, message, wParam, lParam);
    }

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

static void press(BYTE vk, BYTE scan)
{
    key(vk, scan, FALSE);
    key(vk, scan, TRUE);
}

static void mouse(WORD flags, WORD x, WORD y)
{
    mouseFlags = flags;
    mouseX = x;
    mouseY = y;

    _asm {
        push si
        push di
        mov ax, mouseFlags
        mov bx, mouseX
        mov cx, mouseY
        mov dx, 2
        xor si, si
        xor di, di
        call dword ptr mouseEvent
        pop di
        pop si
    }
}

/* One event played back through a journal playback hook. */
static void play(UINT message, UINT paramL, UINT paramH)
{
    playMessage = message;
    playL = paramL;
    playH = paramH;
    playing = TRUE;
    nextPlay = (HOOKPROC)SetWindowsHook(WH_JOURNALPLAYBACK, procPlay);
}

static WORD across(int x)
{
    return (WORD)(((DWORD)x * 65536L + GetSystemMetrics(SM_CXSCREEN) - 1) /
                  GetSystemMetrics(SM_CXSCREEN));
}

static WORD down(int y)
{
    return (WORD)(((DWORD)y * 65536L + GetSystemMetrics(SM_CYSCREEN) - 1) /
                  GetSystemMetrics(SM_CYSCREEN));
}

/* The mouse moved to the middle of `A`, and its left button pressed and let
 * go there. */
static void click(void)
{
    RECT rect;
    WORD x;
    WORD y;

    GetWindowRect(a, &rect);
    x = across((rect.left + rect.right) / 2);
    y = down((rect.top + rect.bottom) / 2);
    mouse(0x8001, x, y);
    mouse(0x8002, x, y);
    mouse(0x8004, x, y);
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

#define VK_X 0x58
#define VK_Q 0x51

static void peekFor(UINT first, UINT last, UINT flags)
{
    MSG message;
    char one[32];

    if (PeekMessage(&message, NULL, first, last, flags)) {
        wsprintf(one, "P1:%x", message.message);
        add(one);

        if (flags & PM_REMOVE) {
            TranslateMessage(&message);
            DispatchMessage(&message);
        }
    } else {
        add("P0");
    }
}

static void run(LPCSTR name)
{
    SetFocus(a);
    pump();
    events[0] = '\0';
    logging = TRUE;

    if (lstrcmp(name, "hard") == 0) {
        play(WM_USER + 1, 0x3456, 7);
        add("peek");
        peekFor(0, 0, PM_NOREMOVE);
    } else if (lstrcmp(name, "hardeat") == 0) {
        eatHard = TRUE;
        play(WM_USER + 1, 0x3456, 7);
        add("peek");
        peekFor(0, 0, PM_NOREMOVE);
    } else if (lstrcmp(name, "sync") == 0) {
        play(WM_QUEUESYNC, (UINT)top, 0);
        add("peek");
        peekFor(0, 0, PM_NOREMOVE);
    } else if (lstrcmp(name, "keynohook") == 0 || lstrcmp(name, "keyhook") == 0) {
        press(VK_X, 0x2d);
        add("peek");
        peekFor(WM_KEYFIRST, WM_KEYLAST, PM_NOREMOVE);
    } else if (lstrcmp(name, "keyeat") == 0) {
        eatKey = TRUE;
        press(VK_Q, 0x10);
        add("peek");
        peekFor(WM_KEYFIRST, WM_KEYLAST, PM_NOREMOVE);
    } else if (lstrcmp(name, "clickeat") == 0) {
        eatPress = TRUE;
        click();
        add("peek");
        peekFor(WM_LBUTTONDOWN, WM_LBUTTONDOWN, PM_NOREMOVE);
    } else {
        click();
        add("peek");
        peekFor(WM_LBUTTONDOWN, WM_LBUTTONDOWN, PM_NOREMOVE);
    }

    add("take");
    pump();

    if (playing) {
        add("unplayed");
        UnhookWindowsHook(WH_JOURNALPLAYBACK, procPlay);
        playing = FALSE;
    }

    logging = FALSE;
    eatKey = FALSE;
    eatPress = FALSE;
    eatHard = FALSE;
    probe("hooks", name, events);
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
    kind.lpszClassName = "HwhkTop";
    RegisterClass(&kind);

    kind.lpszClassName = "HwhkKid";
    RegisterClass(&kind);

    keybdEvent = GetProcAddress(GetModuleHandle("USER"), "KEYBD_EVENT");
    mouseEvent = GetProcAddress(GetModuleHandle("USER"), "MOUSE_EVENT");
    procPlay = (HOOKPROC)MakeProcInstance((FARPROC)Play, instance);
    probe("entry", "KEYBD_EVENT", keybdEvent ? "found" : "missing");
    probe("entry", "MOUSE_EVENT", mouseEvent ? "found" : "missing");

    if (keybdEvent && mouseEvent) {
        top = CreateWindow("HwhkTop", "T", WS_OVERLAPPEDWINDOW, 40, 40, 400, 300, NULL, NULL,
                           module, NULL);
        a = CreateWindow("HwhkKid", "", WS_CHILD | WS_VISIBLE | WS_BORDER, 10, 10, 150, 100, top,
                         (HMENU)1, module, NULL);
        ShowWindow(top, SW_SHOWNORMAL);
        UpdateWindow(top);
        SetFocus(a);
        pump();

        hardwareHook = SetWindowsHookEx(WH_HARDWARE,
                                        (HOOKPROC)MakeProcInstance((FARPROC)HardwareHook, instance),
                                        instance, GetCurrentTask());
        cbtHook = SetWindowsHookEx(WH_CBT, (HOOKPROC)MakeProcInstance((FARPROC)CbtHook, instance),
                                   instance, GetCurrentTask());

        run("hard");
        run("hardeat");
        run("sync");
        run("keynohook");
        run("clicknohook");

        keyboardHook = SetWindowsHookEx(WH_KEYBOARD,
                                        (HOOKPROC)MakeProcInstance((FARPROC)KeyboardHook, instance),
                                        instance, GetCurrentTask());
        mouseHook = SetWindowsHookEx(WH_MOUSE,
                                     (HOOKPROC)MakeProcInstance((FARPROC)MouseHook, instance),
                                     instance, GetCurrentTask());

        run("keyhook");
        run("keyeat");
        run("clickhook");
        run("clickeat");

        UnhookWindowsHookEx(keyboardHook);
        UnhookWindowsHookEx(mouseHook);
        UnhookWindowsHookEx(cbtHook);
        UnhookWindowsHookEx(hardwareHook);
    }

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
