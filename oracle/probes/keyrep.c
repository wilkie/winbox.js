/*
 * A key pressed again before it is taken: USER's system queue adds one to
 * the repeat count of the press at its end rather than putting in another
 * (`USER.EXE` seg1 `4c54`-`4c71`). And a key for a window outside the
 * system-modal window, which a look passes over (`3204`-`3235`).
 *
 * `T` is an overlapped window at (40, 40), 300 by 200, with the focus. Its
 * procedure writes each key's message it is handed with its virtual key and
 * `lParam`, `WM_SYSCOMMAND`'s `wParam` -- `SC_KEYMENU` it does not pass on
 * -- and nothing else. Keys go in through USER's own `KEYBD_EVENT`, as the
 * keyboard driver puts them in, and everything waiting is taken, translated
 * and dispatched after each case.
 *
 * * `three`: X pressed three times, and let go.
 * * `taken`: X pressed and taken; X pressed twice more, and let go.
 * * `system`: Alt pressed; X pressed twice, and let go; Alt let go.
 * * `between`: X, Y and X pressed; X and Y let go.
 * * `move`: X pressed; the mouse moved, through `MOUSE_EVENT`; X pressed;
 *   X let go.
 * * `extended`: X pressed; X pressed as an extended key, 1 in BH; X let go.
 * * `peek`: X pressed; what `PeekMessage` with `PM_NOREMOVE` finds, with its
 *   `lParam` (`peek:`); X pressed again, and let go.
 * * `first`: X pressed; what `PeekMessage` with `PM_NOREMOVE` finds
 *   (`peek:`); `WM_USER` posted to `T`, which writes `400`; X let go.
 * * `sysmodal`: `S`, a pop-up at (100, 300), made system-modal; the focus
 *   given to `T`; X pressed and let go; everything taken (`|` after it);
 *   `S` destroyed; everything taken.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\KEYREP.OUT"

static HINSTANCE module;
static HWND top;
static HWND modal;
static FARPROC keybdEvent;
static FARPROC mouseEvent;
static char events[600];

static WORD keyAX;
static WORD keyBX;
static WORD mouseFlags;
static WORD mouseX;
static WORD mouseY;

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
        wsprintf(one, "%s%x:%x:%lx", (LPSTR)(hwnd == top ? "T" : "S"), message, wParam, lParam);
        add(one);
    } else if (message == WM_USER) {
        add("400");
    } else if (message == WM_SYSCOMMAND) {
        wsprintf(one, "112:%x", wParam);
        add(one);

        if ((wParam & 0xfff0) == SC_KEYMENU) {
            return 0;
        }
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

/* One key, as the keyboard driver hands it to USER: AL the virtual key, AH
 * 80h for a release, BL the scan code, BH 1 for an extended key. */
static void keyEx(BYTE vk, BYTE scan, BOOL up, BOOL extended)
{
    keyAX = (WORD)vk | (up ? 0x8000 : 0);
    keyBX = scan | (extended ? 0x100 : 0);

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

static void key(BYTE vk, BYTE scan, BOOL up)
{
    keyEx(vk, scan, up, FALSE);
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

static void begin(void)
{
    SetFocus(top);
    pump();
    events[0] = '\0';
}

static void end(LPCSTR name)
{
    pump();
    probe("keys", name, events);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    MSG message;
    char text[48];

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
    kind.lpszClassName = "KeyRep";
    RegisterClass(&kind);

    keybdEvent = GetProcAddress(GetModuleHandle("USER"), "KEYBD_EVENT");
    mouseEvent = GetProcAddress(GetModuleHandle("USER"), "MOUSE_EVENT");

    if (!keybdEvent || !mouseEvent) {
        probe("entry", "KEYBD_EVENT", "missing");
        probeFinish();
        return 0;
    }

    top = CreateWindow("KeyRep", "T", WS_OVERLAPPEDWINDOW, 40, 40, 300, 200, NULL, NULL, module,
                       NULL);
    ShowWindow(top, SW_SHOWNORMAL);
    UpdateWindow(top);

    begin();
    key(VK_X, 0x2d, FALSE);
    key(VK_X, 0x2d, FALSE);
    key(VK_X, 0x2d, FALSE);
    key(VK_X, 0x2d, TRUE);
    end("three");

    begin();
    key(VK_X, 0x2d, FALSE);
    pump();
    key(VK_X, 0x2d, FALSE);
    key(VK_X, 0x2d, FALSE);
    key(VK_X, 0x2d, TRUE);
    end("taken");

    begin();
    key(VK_MENU, 0x38, FALSE);
    key(VK_X, 0x2d, FALSE);
    key(VK_X, 0x2d, FALSE);
    key(VK_X, 0x2d, TRUE);
    key(VK_MENU, 0x38, TRUE);
    end("system");

    begin();
    key(VK_X, 0x2d, FALSE);
    key(VK_Y, 0x15, FALSE);
    key(VK_X, 0x2d, FALSE);
    key(VK_X, 0x2d, TRUE);
    key(VK_Y, 0x15, TRUE);
    end("between");

    begin();
    key(VK_X, 0x2d, FALSE);
    mouse(0x8001, 20000, 20000);
    key(VK_X, 0x2d, FALSE);
    key(VK_X, 0x2d, TRUE);
    end("move");

    begin();
    key(VK_X, 0x2d, FALSE);
    keyEx(VK_X, 0x2d, FALSE, TRUE);
    key(VK_X, 0x2d, TRUE);
    end("extended");

    begin();
    key(VK_X, 0x2d, FALSE);

    if (PeekMessage(&message, NULL, 0, 0, PM_NOREMOVE)) {
        wsprintf(text, "peek:%x:%x:%lx", message.message, message.wParam, message.lParam);
    } else {
        lstrcpy(text, "peek:none");
    }

    add(text);
    key(VK_X, 0x2d, FALSE);
    key(VK_X, 0x2d, TRUE);
    end("peek");

    begin();
    key(VK_X, 0x2d, FALSE);

    if (PeekMessage(&message, NULL, 0, 0, PM_NOREMOVE)) {
        wsprintf(text, "peek:%x:%x", message.message, message.wParam);
    } else {
        lstrcpy(text, "peek:none");
    }

    add(text);
    PostMessage(top, WM_USER, 0, 0L);
    key(VK_X, 0x2d, TRUE);
    end("first");

    modal = CreateWindow("KeyRep", "S", WS_POPUP | WS_CAPTION | WS_VISIBLE, 100, 300, 200, 100,
                         top, NULL, module, NULL);
    SetSysModalWindow(modal);
    pump();
    events[0] = '\0';
    SetFocus(top);
    wsprintf(text, "focus:%s", (LPSTR)(GetFocus() == top ? "T" : GetFocus() == modal ? "S" : "none"));
    add(text);
    key(VK_X, 0x2d, FALSE);
    key(VK_X, 0x2d, TRUE);
    pump();
    add("|");
    DestroyWindow(modal);
    SetFocus(top);
    end("sysmodal");

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
