/*
 * A journal record hook, `WH_JOURNALRECORD`, as Recorder puts one in: what
 * USER hands it for each key and each press of the mouse, and when.
 *
 * `T` is an overlapped window at (40, 40), 400 by 300, with a child `A` of
 * the probe's own class at (10, 10), 150 by 100, which has the focus. The
 * hook is put in with `SetWindowsHook`, passes on with `DefHookProc`, and
 * notes each call: the code, `wParam`, and for `HC_ACTION` the event the
 * `EVENTMSG` at `lParam` holds -- its message, `paramL` and `paramH` in
 * hex -- and whether its time is the time `GetMessageTime` gives for the
 * message the event became (`=`), or not (`~`), or the event became no
 * message the probe saw (`?`).
 *
 * Each case puts its input in through USER's own `KEYBD_EVENT` and
 * `MOUSE_EVENT`, as the drivers would, then takes and dispatches all that
 * is waiting with `TranslateMessage`. A window procedure's messages are
 * written too, as the window and the message's number in hex.
 *
 * * `keys`: X pressed and let go.
 * * `peek`: X pressed; `PeekMessage` with `PM_NOREMOVE` looks at it; then
 *   X let go, and everything taken.
 * * `nofocus`: the focus taken away, then X pressed and let go: the key
 *   reaches `T` as a system key.
 * * `alt`: Alt pressed, X pressed and let go, Alt let go.
 * * `mouse`: the mouse moved to the middle of `A`, its left button pressed
 *   and let go there.
 * * `sysmodal`: `SetSysModalWindow(T)`, X pressed and let go, then
 *   `SetSysModalWindow(NULL)`.
 *
 * Then the hook is taken out with `UnhookWindowsHook` (`unhook`), and X
 * pressed and let go once more (`after`).
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\JRNLREC.OUT"

static HINSTANCE module;
static HWND top;
static HWND a;
static FARPROC keybdEvent;
static FARPROC mouseEvent;
static HOOKPROC next;
static HOOKPROC procRecord;
static char events[1600];
static DWORD lastTime;
static BOOL lastOpen;

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

/* The last event the hook was handed, matched with the message it became. */
static void settle(char mark)
{
    char one[4];

    if (lastOpen) {
        wsprintf(one, "%c", mark);
        add(one);
        lastOpen = FALSE;
    }
}

DWORD FAR PASCAL _export Record(int code, WPARAM wParam, LPARAM lParam)
{
    char one[48];

    settle('?');

    if (code == HC_ACTION && lParam) {
        EVENTMSG FAR *event = (EVENTMSG FAR *)lParam;

        wsprintf(one, "r%d:%x:%x/%x/%x", code, wParam, event->message, event->paramL,
                 event->paramH);
        lastTime = event->time;
        lastOpen = TRUE;
        add(one);
    } else {
        wsprintf(one, "r%d:%x:%lx", code, wParam, lParam);
        add(one);
    }

    return DefHookProc(code, wParam, lParam, &next);
}

static void note(HWND hwnd, UINT message, WPARAM wParam)
{
    char one[32];

    if (message >= WM_KEYDOWN && message <= WM_SYSCHAR) {
        if (message != WM_CHAR && message != WM_SYSCHAR) {
            settle(GetMessageTime() == (LONG)lastTime ? '=' : '~');
        }

        wsprintf(one, "%s%x:%x", whose(hwnd), message, wParam);
    } else if (message == WM_LBUTTONDOWN || message == WM_LBUTTONUP) {
        settle(GetMessageTime() == (LONG)lastTime ? '=' : '~');
        wsprintf(one, "%s%x", whose(hwnd), message);
    } else if (message == WM_MOUSEMOVE) {
        settle(GetMessageTime() == (LONG)lastTime ? '=' : '~');
        return;
    } else {
        return;
    }

    add(one);
}

LONG FAR PASCAL _export TopProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    note(hwnd, message, wParam);
    return DefWindowProc(hwnd, message, wParam, lParam);
}

LONG FAR PASCAL _export KidProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    note(hwnd, message, wParam);
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

static void run(LPCSTR name)
{
    MSG message;
    char one[48];

    SetFocus(a);
    pump();
    events[0] = '\0';
    lastOpen = FALSE;

    if (lstrcmp(name, "keys") == 0 || lstrcmp(name, "after") == 0) {
        press(VK_X, 0x2d);
    } else if (lstrcmp(name, "peek") == 0) {
        key(VK_X, 0x2d, FALSE);

        if (PeekMessage(&message, NULL, WM_KEYFIRST, WM_KEYLAST, PM_NOREMOVE)) {
            wsprintf(one, "peek:%s%x", whose(message.hwnd), message.message);
        } else {
            lstrcpy(one, "peek:none");
        }

        add(one);
        key(VK_X, 0x2d, TRUE);
    } else if (lstrcmp(name, "nofocus") == 0) {
        SetFocus(NULL);
        press(VK_X, 0x2d);
    } else if (lstrcmp(name, "alt") == 0) {
        key(VK_MENU, 0x38, FALSE);
        press(VK_X, 0x2d);
        key(VK_MENU, 0x38, TRUE);
    } else if (lstrcmp(name, "mouse") == 0) {
        RECT rect;
        WORD x;
        WORD y;

        GetWindowRect(a, &rect);
        x = across((rect.left + rect.right) / 2);
        y = down((rect.top + rect.bottom) / 2);
        wsprintf(one, "at:%x/%x", (rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2);
        add(one);
        mouse(0x8001, x, y);
        mouse(0x8002, x, y);
        mouse(0x8004, x, y);
    } else if (lstrcmp(name, "sysmodal") == 0) {
        SetSysModalWindow(top);
        add("on");
        press(VK_X, 0x2d);
        pump();
        SetSysModalWindow(NULL);
        add("off");
    }

    pump();
    settle('?');

    probe("record", name, events);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    char one[16];

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
    kind.lpszClassName = "JrecTop";
    RegisterClass(&kind);

    kind.lpfnWndProc = KidProc;
    kind.lpszClassName = "JrecKid";
    RegisterClass(&kind);

    keybdEvent = GetProcAddress(GetModuleHandle("USER"), "KEYBD_EVENT");
    mouseEvent = GetProcAddress(GetModuleHandle("USER"), "MOUSE_EVENT");
    probe("entry", "KEYBD_EVENT", keybdEvent ? "found" : "missing");
    probe("entry", "MOUSE_EVENT", mouseEvent ? "found" : "missing");

    if (keybdEvent && mouseEvent) {
        top = CreateWindow("JrecTop", "T", WS_OVERLAPPEDWINDOW, 40, 40, 400, 300, NULL, NULL,
                           module, NULL);
        a = CreateWindow("JrecKid", "", WS_CHILD | WS_VISIBLE | WS_BORDER, 10, 10, 150, 100, top,
                         (HMENU)1, module, NULL);
        ShowWindow(top, SW_SHOWNORMAL);
        UpdateWindow(top);
        SetFocus(a);
        pump();

        procRecord = (HOOKPROC)MakeProcInstance((FARPROC)Record, instance);
        next = (HOOKPROC)SetWindowsHook(WH_JOURNALRECORD, procRecord);

        run("keys");
        run("peek");
        run("nofocus");
        run("alt");
        run("mouse");
        run("sysmodal");

        wsprintf(one, "%d", UnhookWindowsHook(WH_JOURNALRECORD, procRecord));
        probe("unhook", "", one);
        run("after");
    }

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
