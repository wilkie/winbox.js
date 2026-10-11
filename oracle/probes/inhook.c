/*
 * The keyboard and mouse hooks, `WH_KEYBOARD` and `WH_MOUSE`: when USER
 * calls them as a key or a press of the mouse is looked at and as it is
 * taken, with what, and what a hook that answers non-nought does.
 *
 * `T` is an overlapped window at (40, 40), 400 by 300, with a child `A` of
 * the probe's own class at (10, 10), 150 by 100, which has the focus. Both
 * hooks are put in with `SetWindowsHookEx` for the probe's own task, and
 * pass on with `CallNextHookEx`. The keyboard hook is written `k`, its code,
 * the virtual key, and `lParam` in hex; the mouse hook `m`, its code, the
 * message, and from the `MOUSEHOOKSTRUCT` the window, the hit-test code and
 * the point. Neither is written for the mouse's moves. A journal record
 * hook, where a case puts one in too, is written `r` and the message of its
 * event. A window procedure's messages are written as the window and the
 * message's number in hex.
 *
 * Each case puts its input in through USER's own `KEYBD_EVENT` and
 * `MOUSE_EVENT`, as the drivers would; looks at the first of it with
 * `PeekMessage` and `PM_NOREMOVE` (`peek`), for the keys' range or the
 * mouse's; then takes and dispatches all that is waiting.
 *
 * * `keys`: X pressed and let go.
 * * `eat`: Q pressed and let go, the keyboard hook answering 1 for Q.
 * * `mouse`: the left button pressed and let go in the middle of `A`.
 * * `mouseeat`: the same, the mouse hook answering 1 for the press.
 * * `journal`: X pressed and let go, and the button pressed and let go in
 *   `A`, with a journal record hook put in as well.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\INHOOK.OUT"

static HINSTANCE module;
static HWND top;
static HWND a;
static FARPROC keybdEvent;
static FARPROC mouseEvent;
static HHOOK keyboardHook;
static HHOOK mouseHook;
static HOOKPROC procRecord;
static HOOKPROC nextRecord;
static BOOL eatKey;
static BOOL eatPress;
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

DWORD FAR PASCAL _export KeyboardHook(int code, WPARAM wParam, LPARAM lParam)
{
    char one[48];

    wsprintf(one, "k%d:%x/%lx", code, wParam, lParam);
    add(one);

    if (code >= 0 && eatKey && wParam == 0x51) {
        return 1;
    }

    return CallNextHookEx(keyboardHook, code, wParam, lParam);
}

DWORD FAR PASCAL _export MouseHook(int code, WPARAM wParam, LPARAM lParam)
{
    char one[64];
    MOUSEHOOKSTRUCT FAR *mouse = (MOUSEHOOKSTRUCT FAR *)lParam;

    if (wParam != WM_MOUSEMOVE && wParam != WM_NCMOUSEMOVE) {
        wsprintf(one, "m%d:%x/%s/%d/%d,%d", code, wParam, whose(mouse->hwnd),
                 mouse->wHitTestCode, mouse->pt.x, mouse->pt.y);
        add(one);
    }

    if (code >= 0 && eatPress && wParam == WM_LBUTTONDOWN) {
        return 1;
    }

    return CallNextHookEx(mouseHook, code, wParam, lParam);
}

DWORD FAR PASCAL _export Record(int code, WPARAM wParam, LPARAM lParam)
{
    char one[32];

    if (code == HC_ACTION && lParam) {
        EVENTMSG FAR *event = (EVENTMSG FAR *)lParam;

        if (event->message != WM_MOUSEMOVE) {
            wsprintf(one, "r%d:%x", code, event->message);
            add(one);
        }
    }

    return DefHookProc(code, wParam, lParam, &nextRecord);
}

static void note(HWND hwnd, UINT message, WPARAM wParam)
{
    char one[32];

    if (message >= WM_KEYDOWN && message <= WM_SYSCHAR) {
        wsprintf(one, "%s%x:%x", whose(hwnd), message, wParam);
    } else if (message == WM_LBUTTONDOWN || message == WM_LBUTTONUP) {
        wsprintf(one, "%s%x", whose(hwnd), message);
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

static void run(LPCSTR name)
{
    MSG message;
    BOOL keys = TRUE;

    SetFocus(a);
    pump();
    events[0] = '\0';

    if (lstrcmp(name, "keys") == 0) {
        press(VK_X, 0x2d);
    } else if (lstrcmp(name, "eat") == 0) {
        eatKey = TRUE;
        press(VK_Q, 0x10);
    } else if (lstrcmp(name, "mouse") == 0) {
        click();
        keys = FALSE;
    } else if (lstrcmp(name, "mouseeat") == 0) {
        eatPress = TRUE;
        click();
        keys = FALSE;
    } else if (lstrcmp(name, "journal") == 0) {
        procRecord = (HOOKPROC)MakeProcInstance((FARPROC)Record, module);
        nextRecord = (HOOKPROC)SetWindowsHook(WH_JOURNALRECORD, procRecord);
        press(VK_X, 0x2d);
        click();
    }

    add("peek");

    if (keys) {
        PeekMessage(&message, NULL, WM_KEYFIRST, WM_KEYLAST, PM_NOREMOVE);
    } else {
        PeekMessage(&message, NULL, WM_LBUTTONDOWN, WM_LBUTTONDOWN, PM_NOREMOVE);
    }

    add("take");
    pump();

    if (lstrcmp(name, "journal") == 0) {
        UnhookWindowsHook(WH_JOURNALRECORD, procRecord);
    }

    eatKey = FALSE;
    eatPress = FALSE;
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
    kind.lpszClassName = "InhkTop";
    RegisterClass(&kind);

    kind.lpfnWndProc = KidProc;
    kind.lpszClassName = "InhkKid";
    RegisterClass(&kind);

    keybdEvent = GetProcAddress(GetModuleHandle("USER"), "KEYBD_EVENT");
    mouseEvent = GetProcAddress(GetModuleHandle("USER"), "MOUSE_EVENT");
    probe("entry", "KEYBD_EVENT", keybdEvent ? "found" : "missing");
    probe("entry", "MOUSE_EVENT", mouseEvent ? "found" : "missing");

    if (keybdEvent && mouseEvent) {
        top = CreateWindow("InhkTop", "T", WS_OVERLAPPEDWINDOW, 40, 40, 400, 300, NULL, NULL,
                           module, NULL);
        a = CreateWindow("InhkKid", "", WS_CHILD | WS_VISIBLE | WS_BORDER, 10, 10, 150, 100, top,
                         (HMENU)1, module, NULL);
        ShowWindow(top, SW_SHOWNORMAL);
        UpdateWindow(top);
        SetFocus(a);
        pump();

        keyboardHook = SetWindowsHookEx(WH_KEYBOARD,
                                        (HOOKPROC)MakeProcInstance((FARPROC)KeyboardHook, instance),
                                        instance, GetCurrentTask());
        mouseHook = SetWindowsHookEx(WH_MOUSE,
                                     (HOOKPROC)MakeProcInstance((FARPROC)MouseHook, instance),
                                     instance, GetCurrentTask());

        run("keys");
        run("eat");
        run("mouse");
        run("mouseeat");
        run("journal");

        UnhookWindowsHookEx(keyboardHook);
        UnhookWindowsHookEx(mouseHook);
    }

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
