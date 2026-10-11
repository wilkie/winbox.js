/*
 * Hot keys: `WM_SETHOTKEY` and `WM_GETHOTKEY`, which `DefWindowProc`
 * answers from USER's table of them, and the key itself, which USER's system
 * queue takes for itself, posting `WM_SYSCOMMAND` with `SC_HOTKEY` to the
 * active window, which `DefWindowProc` switches to the window with the key.
 * Program Manager gives the programs it starts their shortcut keys so.
 *
 * `T`, "Probe T", at (40, 40), and `W`, "Probe W", at (360, 60), are
 * overlapped windows; `C` a child of `T`. Their procedure writes the keys'
 * messages it is handed and `WM_SYSCOMMAND` with its `wParam` and `lParam`;
 * `SC_KEYMENU` it does not pass on. Keys go in through USER's own
 * `KEYBD_EVENT`, before any is taken. A key with its modifiers is written as
 * `WM_SETHOTKEY` takes it: the virtual key, and above it 1 for Shift, 2 for
 * Control and 4 for Alt.
 *
 * * `set`, `get`: what `WM_SETHOTKEY` answers and what `WM_GETHOTKEY` then
 *   does, for: Control, Alt and K given `T` (`T`), the same given `W`
 *   (`W same`), Escape, Space and Tab with Control and Alt, the same key
 *   given the child (`C`), and nought given `W` (`W clear`).
 * * `press`: `W` active; Control, Alt and K pressed, and let go in the
 *   other order; what the windows were handed, and the window active.
 * * `hidden`: `T` hidden, `W` active, as `press`.
 * * `plain`: `T` given J without modifiers; `W` active, J pressed and let go.
 * * `icon`: `T` minimized, `W` active, as `press`; and whether `T` is an icon.
 * * `gone`: a third window given Control, Alt and L, and destroyed; `W`
 *   active, those pressed.
 */

#define PROBE_FLUSH
#include "probe.h"

#define OUTPUT "C:\\ORACLE\\HOTKEY.OUT"

#define WM_SETHOTKEY 0x0032
#define WM_GETHOTKEY 0x0033
#define SC_HOTKEY 0xF150

static HINSTANCE module;
static HWND top;
static HWND other;
static HWND child;
static FARPROC keybdEvent;
static char events[600];

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

    if (hwnd == other) {
        return "W";
    }

    if (hwnd == child) {
        return "C";
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

LONG FAR PASCAL _export TopProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    char one[40];

    if (message >= WM_KEYDOWN && message <= WM_SYSCHAR) {
        wsprintf(one, "%s%x:%x", whose(hwnd), message, wParam);
        add(one);
    } else if (message == WM_SYSCOMMAND) {
        wsprintf(one, "%s112:%x:%s", whose(hwnd), wParam, whose((HWND)LOWORD(lParam)));
        add(one);

        if ((wParam & 0xfff0) == SC_KEYMENU) {
            return 0;
        }
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

static void set(LPCSTR name, HWND hwnd, WORD hotkey)
{
    char text[24];

    wsprintf(text, "%lx", SendMessage(hwnd, WM_SETHOTKEY, hotkey, 0L));
    probe("set", name, text);
    wsprintf(text, "%lx", SendMessage(hwnd, WM_GETHOTKEY, 0, 0L));
    probe("get", name, text);
}

#define VK_J 0x4a
#define VK_K 0x4b
#define VK_L 0x4c

/* Control, Alt and a key pressed, and let go in the other order. */
static void chord(BYTE vk, BYTE scan)
{
    key(VK_CONTROL, 0x1d, FALSE);
    key(VK_MENU, 0x38, FALSE);
    key(vk, scan, FALSE);
    key(vk, scan, TRUE);
    key(VK_MENU, 0x38, TRUE);
    key(VK_CONTROL, 0x1d, TRUE);
}

static void pressed(LPCSTR name, BYTE vk, BYTE scan, BOOL plain)
{
    SetActiveWindow(other);
    pump();
    events[0] = '\0';

    if (plain) {
        key(vk, scan, FALSE);
        key(vk, scan, TRUE);
    } else {
        chord(vk, scan);
    }

    pump();
    add(whose(GetActiveWindow()));
    probe("press", name, events);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HWND third;

    probeOpen(OUTPUT);
    module = instance;

    kind.style = 0;
    kind.lpfnWndProc = TopProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = LoadIcon(NULL, IDI_APPLICATION);
    kind.hCursor = LoadCursor(NULL, IDC_ARROW);
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "HotTop";
    RegisterClass(&kind);

    keybdEvent = GetProcAddress(GetModuleHandle("USER"), "KEYBD_EVENT");

    if (!keybdEvent) {
        probe("entry", "KEYBD_EVENT", "missing");
        probeFinish();
        return 0;
    }

    other = CreateWindow("HotTop", "Probe W", WS_OVERLAPPEDWINDOW, 360, 60, 240, 160, NULL, NULL,
                         module, NULL);
    top = CreateWindow("HotTop", "Probe T", WS_OVERLAPPEDWINDOW, 40, 40, 300, 200, NULL, NULL,
                       module, NULL);
    child = CreateWindow("HotTop", "", WS_CHILD | WS_VISIBLE, 10, 10, 50, 50, top, (HMENU)1,
                         module, NULL);
    ShowWindow(other, SW_SHOWNORMAL);
    UpdateWindow(other);
    ShowWindow(top, SW_SHOWNORMAL);
    UpdateWindow(top);
    pump();

    set("T", top, 0x600 | VK_K);
    set("W same", other, 0x600 | VK_K);
    set("T escape", top, 0x600 | VK_ESCAPE);
    set("T space", top, 0x600 | VK_SPACE);
    set("T tab", top, 0x600 | VK_TAB);
    set("C", child, 0x600 | VK_K);
    set("W clear", other, 0);

    pressed("press", VK_K, 0x25, FALSE);

    ShowWindow(top, SW_HIDE);
    pressed("hidden", VK_K, 0x25, FALSE);
    ShowWindow(top, SW_SHOWNORMAL);

    set("T plain", top, VK_J);
    pressed("plain", VK_J, 0x24, TRUE);
    set("T again", top, 0x600 | VK_K);

    ShowWindow(top, SW_MINIMIZE);
    pressed("icon", VK_K, 0x25, FALSE);
    probe("icon", "T", (LPSTR)(IsIconic(top) ? "icon" : "open"));

    third = CreateWindow("HotTop", "Probe 3", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 100, 300, 200,
                         100, NULL, NULL, module, NULL);
    set("third", third, 0x600 | VK_L);
    DestroyWindow(third);
    pressed("gone", VK_L, 0x26, FALSE);

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
