/*
 * Which window a key goes to, when the focus moves between the key being
 * put in and its being taken: USER's system queue.
 *
 * `T` is an overlapped window at (40, 40), 400 by 300. In it are two
 * children of the probe's own class, `A` at (10, 10) and `B` at (210, 10),
 * each 150 by 100. A child pressed with the left button takes the focus.
 * Each case gives `A` the focus, takes and dispatches everything waiting,
 * then puts its input in through USER's own `KEYBD_EVENT` and `MOUSE_EVENT`,
 * as the drivers would, before taking any of it; then takes and dispatches
 * all that is waiting.
 *
 * * `setfocus`: X pressed and let go; then `SetFocus(B)`.
 * * `click`: X pressed and let go; the left button pressed and let go in
 *   the middle of `B`; Y pressed and let go.
 * * `peek`: X pressed. `PeekMessage` with `PM_NOREMOVE` looks at it, and
 *   which window it names is written (`peek:`); then `SetFocus(B)`, and X
 *   let go.
 * * `nofocus`: `SetFocus(NULL)`, then X pressed and let go.
 * * `range`: X pressed and let go; then `PeekMessage` with `PM_REMOVE` for
 *   `WM_KEYUP` alone, whose message is written (`range:`); then everything.
 * * `twokeys`: X pressed and let go, then `SetFocus(B)`, then Y pressed and
 *   let go, then `SetFocus(A)`.
 *
 * The result, in order: each message a window procedure was handed of the
 * keys' (`WM_KEYDOWN` to `WM_SYSCHAR`), the buttons' and the focus's, as the
 * window (`T`, `A`, `B`) and the message's number in hex, a key's with its
 * virtual key; then `=` and the window with the focus.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\SYSQ.OUT"

static HINSTANCE module;
static HWND top;
static HWND a;
static HWND b;
static FARPROC keybdEvent;
static FARPROC mouseEvent;
static char events[1200];

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

    if (hwnd == b) {
        return "B";
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

static void note(HWND hwnd, UINT message, WPARAM wParam)
{
    char one[32];

    if (message >= WM_KEYDOWN && message <= WM_SYSCHAR) {
        wsprintf(one, "%s%x:%x", whose(hwnd), message, wParam);
    } else if (message == WM_LBUTTONDOWN || message == WM_LBUTTONUP ||
               message == WM_SETFOCUS || message == WM_KILLFOCUS) {
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

    if (message == WM_LBUTTONDOWN) {
        SetFocus(hwnd);
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

/* One key, as the keyboard driver hands it to USER: AL the virtual key, AH
 * 80h for a release, BL the scan code. */
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

/* A point of the screen as MOUSE_EVENT's absolute coordinates, 0 to 65535. */
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

/* The left button pressed and let go in the middle of a window. */
static void click(HWND hwnd)
{
    RECT rect;
    WORD x;
    WORD y;

    GetWindowRect(hwnd, &rect);
    x = across((rect.left + rect.right) / 2);
    y = down((rect.top + rect.bottom) / 2);
    mouse(0x8001, x, y);
    mouse(0x8002, x, y);
    mouse(0x8004, x, y);
}

/* Everything waiting taken, translated and dispatched. */
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
#define VK_Y 0x59

static void run(LPCSTR name)
{
    MSG message;
    char one[48];

    SetFocus(a);
    pump();
    events[0] = '\0';

    if (lstrcmp(name, "setfocus") == 0) {
        press(VK_X, 0x2d);
        SetFocus(b);
    } else if (lstrcmp(name, "click") == 0) {
        press(VK_X, 0x2d);
        click(b);
        press(VK_Y, 0x15);
    } else if (lstrcmp(name, "peek") == 0) {
        key(VK_X, 0x2d, FALSE);

        if (PeekMessage(&message, NULL, WM_KEYFIRST, WM_KEYLAST, PM_NOREMOVE)) {
            wsprintf(one, "peek:%s%x", whose(message.hwnd), message.message);
        } else {
            lstrcpy(one, "peek:none");
        }

        add(one);
        SetFocus(b);
        key(VK_X, 0x2d, TRUE);
    } else if (lstrcmp(name, "nofocus") == 0) {
        SetFocus(NULL);
        press(VK_X, 0x2d);
    } else if (lstrcmp(name, "range") == 0) {
        press(VK_X, 0x2d);

        if (PeekMessage(&message, NULL, WM_KEYUP, WM_KEYUP, PM_REMOVE)) {
            wsprintf(one, "range:%s%x", whose(message.hwnd), message.message);
        } else {
            lstrcpy(one, "range:none");
        }

        add(one);
    } else if (lstrcmp(name, "twokeys") == 0) {
        press(VK_X, 0x2d);
        SetFocus(b);
        press(VK_Y, 0x15);
        SetFocus(a);
    }

    pump();

    wsprintf(one, "=%s", whose(GetFocus()));
    add(one);
    probe("input", name, events);
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
    kind.lpszClassName = "SysqTop";
    RegisterClass(&kind);

    kind.lpfnWndProc = KidProc;
    kind.lpszClassName = "SysqKid";
    RegisterClass(&kind);

    keybdEvent = GetProcAddress(GetModuleHandle("USER"), "KEYBD_EVENT");
    mouseEvent = GetProcAddress(GetModuleHandle("USER"), "MOUSE_EVENT");
    probe("entry", "KEYBD_EVENT", keybdEvent ? "found" : "missing");
    probe("entry", "MOUSE_EVENT", mouseEvent ? "found" : "missing");

    if (keybdEvent && mouseEvent) {
        top = CreateWindow("SysqTop", "T", WS_OVERLAPPEDWINDOW, 40, 40, 400, 300, NULL, NULL,
                           module, NULL);
        a = CreateWindow("SysqKid", "", WS_CHILD | WS_VISIBLE | WS_BORDER, 10, 10, 150, 100, top,
                         (HMENU)1, module, NULL);
        b = CreateWindow("SysqKid", "", WS_CHILD | WS_VISIBLE | WS_BORDER, 210, 10, 150, 100, top,
                         (HMENU)2, module, NULL);
        ShowWindow(top, SW_SHOWNORMAL);
        UpdateWindow(top);

        run("setfocus");
        run("click");
        run("peek");
        run("nofocus");
        run("range");
        run("twokeys");
    }

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
