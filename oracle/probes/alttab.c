/*
 * Alt and Tab, Alt and Escape: `DefWindowProc` sends the active window
 * `WM_SYSCOMMAND` with `SC_NEXTWINDOW` or `SC_PREVWINDOW` for Tab, Escape
 * or F6 pressed with Alt, and carries the command out with a loop of its own
 * (`USER.EXE` seg23 `0932`) that takes the keys until Alt is let go, showing
 * the fast switch box -- or, with `CoolSwitch=0`, the window itself -- for
 * each window Tab comes to.
 *
 * Top-level windows, front to back: `A`, "Probe A", at (20, 20); `P`, a
 * pop-up owned by `B`, at (420, 30); `B`, "Probe B", at (200, 100); `E`,
 * hidden; `F`, "Probe F", disabled; `C`, "Probe C", at (340, 200), whose
 * class has no icon; `D`, "Probe D", minimized. Each case puts them back in
 * that order with `A` active and `D` an icon. Their procedure writes the
 * messages named below it is handed; `SC_KEYMENU` it does not pass on.
 * Keys and the mouse go in through USER's own `KEYBD_EVENT` and
 * `MOUSE_EVENT`, before any is taken. A message filter hook writes each
 * message the loop looks at (`F`, the code, the message, `wParam`), and on
 * the look named takes the screen with `GetPixel`, a row a record, each
 * pixel a palette digit, runs as the digit, `*` and the count.
 *
 * * `tab`: Alt, Tab, Tab let go, Alt let go, all put in before the loop
 *   runs: what the windows were handed, the window then active, the
 *   windows' order, whether `D` is an icon.
 * * `tab2`, `tab3`: Tab twice and three times.
 * * `held`, `held2`, `held3`: the same with Alt let go only from the hook,
 *   once the loop has looked at every Tab; the screen where the box is just
 *   before (`screen`). `C`'s class has no icon, `D` is an icon.
 * * `back`: Alt, Shift, Tab.
 * * `esc`, `shiftesc`: Alt and Escape, Alt, Shift and Escape.
 * * `cancel`: Alt, Tab, then Escape pressed and let go before Alt.
 * * `key`: Alt, Tab, then X pressed.
 * * `click`: Alt, Tab, then the left button pressed and let go over `C`.
 * * `owner`: `B` made active, then `A`; Alt and Tab. (`P` was made
 *   active as it was made, so in the cases before, `B`'s last pop-up active
 *   is `P`.)
 * * `f6`: Alt and F6.
 * * `outline`: `CoolSwitch` 0 by `SPI_SETFASTTASKSWITCH`, Alt and Tab; the
 *   screen where `B` is (`screen`, `outline`).
 * * `sysmodal`: `A` the system-modal window, Alt and Tab.
 */

#define PROBE_FLUSH
#include "probe.h"

#define OUTPUT "C:\\ORACLE\\ALTTAB.OUT"

#define SPI_SETFASTTASKSWITCH 36

#define BOX_LEFT   100
#define BOX_TOP    195
#define BOX_RIGHT  540
#define BOX_BOTTOM 285

static HINSTANCE module;
static HWND winA;
static HWND winB;
static HWND winC;
static HWND winD;
static HWND winE;
static HWND winF;
static HWND winP;
static FARPROC keybdEvent;
static FARPROC mouseEvent;
static HHOOK filter;
static char events[1600];
static int looks;
static int shootAt;
static int releaseAt;
static LPCSTR shotName;
static RECT shotBox;

static WORD keyAX;
static WORD keyBX;
static WORD mouseFlags;
static WORD mouseX;
static WORD mouseY;

static const char HEX[] = "0123456789abcdef";

static const COLORREF PALETTE[16] = {
    RGB(0, 0, 0),       RGB(128, 0, 0),     RGB(0, 128, 0),   RGB(128, 128, 0),
    RGB(0, 0, 128),     RGB(128, 0, 128),   RGB(0, 128, 128), RGB(192, 192, 192),
    RGB(128, 128, 128), RGB(255, 0, 0),     RGB(0, 255, 0),   RGB(255, 255, 0),
    RGB(0, 0, 255),     RGB(255, 0, 255),   RGB(0, 255, 255), RGB(255, 255, 255),
};

static char digit(COLORREF colour)
{
    int index;

    for (index = 0; index < 16; index++) {
        if (PALETTE[index] == (colour & 0xffffffL)) {
            return HEX[index];
        }
    }

    return '?';
}

static LPCSTR whose(HWND hwnd)
{
    static char handle[8];

    if (hwnd == NULL) {
        return "0";
    }

    if (hwnd == winA) return "A";
    if (hwnd == winB) return "B";
    if (hwnd == winC) return "C";
    if (hwnd == winD) return "D";
    if (hwnd == winE) return "E";
    if (hwnd == winF) return "F";
    if (hwnd == winP) return "P";

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

/* The screen in a rectangle, a row a record. */
static void capture(LPCSTR name, RECT FAR *box)
{
    HDC screen = GetDC(NULL);
    int x;
    int y;

    for (y = box->top; y < box->bottom; y++) {
        LPSTR at = probeResult;
        char last = 0;
        int count = 0;

        for (x = box->left; x <= box->right; x++) {
            char one = x < box->right ? digit(GetPixel(screen, x, y)) : 0;

            if (one == last) {
                count++;
                continue;
            }

            if (count) {
                if (at != probeResult) {
                    *at++ = ',';
                }

                *at++ = last;

                if (count > 1) {
                    at += wsprintf(at, "*%d", count);
                }
            }

            last = one;
            count = 1;
        }

        *at = '\0';
        wsprintf(probeArgs, "%s,y=%d", name, y - box->top);
        probe("screen", probeArgs, probeResult);
    }

    ReleaseDC(NULL, screen);
}

static void key(BYTE vk, BYTE scan, BOOL up);

#define SC_ALT   0x38

DWORD FAR PASCAL _export FilterProc(int code, WPARAM wParam, LPARAM lParam)
{
    MSG FAR *msg = (MSG FAR *)lParam;
    char one[40];

    if (code >= 0) {
        wsprintf(one, "F%d:%x:%x", code, msg->message, msg->wParam);
        add(one);
        looks++;

        if (shotName && looks == shootAt) {
            capture(shotName, &shotBox);
            shotName = NULL;
        }

        /* Alt let go only now, so that it is down while the loop runs. */
        if (looks == releaseAt) {
            releaseAt = 0;
            key(VK_MENU, SC_ALT, TRUE);
        }
    }

    return CallNextHookEx(filter, code, wParam, lParam);
}

LONG FAR PASCAL _export TopProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    char one[40];

    switch (message) {
    case WM_KEYDOWN:
    case WM_KEYUP:
    case WM_CHAR:
    case WM_SYSKEYDOWN:
    case WM_SYSKEYUP:
    case WM_SYSCHAR:
        wsprintf(one, "%s%x:%x", whose(hwnd), message, wParam);
        add(one);
        break;

    case WM_SYSCOMMAND:
        wsprintf(one, "%s112:%x:%x", whose(hwnd), wParam, LOWORD(lParam));
        add(one);

        if ((wParam & 0xfff0) == SC_KEYMENU) {
            return 0;
        }

        break;

    case WM_ACTIVATE:
        wsprintf(one, "%s6:%x:%s", whose(hwnd), wParam, whose((HWND)LOWORD(lParam)));
        add(one);
        break;

    case WM_NCACTIVATE:
    case WM_SIZE:
        wsprintf(one, "%s%x:%x", whose(hwnd), message, wParam);
        add(one);
        break;

    case WM_WINDOWPOSCHANGING:
    case WM_WINDOWPOSCHANGED:
        wsprintf(one, "%s%x:%x", whose(hwnd), message, ((WINDOWPOS FAR *)lParam)->flags & 0xff);
        add(one);
        break;

    case WM_QUERYDRAGICON:
    case WM_QUERYOPEN:
    case WM_SETFOCUS:
    case WM_KILLFOCUS:
    case WM_CANCELMODE:
    case WM_MOUSEACTIVATE:
    case WM_LBUTTONDOWN:
    case WM_LBUTTONUP:
        wsprintf(one, "%s%x", whose(hwnd), message);
        add(one);
        break;
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

#define MOUSEEVENTF_MOVE     0x0001
#define MOUSEEVENTF_LEFTDOWN 0x0002
#define MOUSEEVENTF_LEFTUP   0x0004
#define MOUSEEVENTF_ABSOLUTE 0x8000

static void pump(void)
{
    MSG message;
    int count = 0;

    while (count < 120 && PeekMessage(&message, NULL, 0, 0, PM_REMOVE)) {
        TranslateMessage(&message);
        DispatchMessage(&message);
        count++;
    }
}

#define VK_X 0x58

#define SC_TAB   0x0f
#define SC_ESC   0x01
#define SC_SHIFT 0x2a
#define SC_F6    0x40
#define SC_X     0x2d

/* The windows put back in their order, `A` active and `D` an icon. */
static void reset(void)
{
    if (!IsIconic(winD)) {
        ShowWindow(winD, SW_SHOWMINNOACTIVE);
    }

    SetWindowPos(winD, HWND_TOP, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    SetWindowPos(winC, HWND_TOP, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    SetWindowPos(winF, HWND_TOP, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    SetWindowPos(winE, HWND_TOP, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    SetWindowPos(winB, HWND_TOP, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    SetWindowPos(winP, HWND_TOP, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    SetWindowPos(winA, HWND_TOP, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    SetActiveWindow(winA);
    pump();
    events[0] = '\0';
    looks = 0;
    shotName = NULL;
    releaseAt = 0;
}

/* The windows' order, front to back: the probe's own. */
static void order(LPCSTR name)
{
    HWND hwnd = GetWindow(winA, GW_HWNDFIRST);
    char text[64];

    text[0] = '\0';

    while (hwnd) {
        LPCSTR who = whose(hwnd);

        if (lstrlen(who) == 1) {
            lstrcat(text, who);
        }

        hwnd = GetWindow(hwnd, GW_HWNDNEXT);
    }

    probe("order", name, text);
}

static void finish(LPCSTR name)
{
    pump();
    probe("events", name, events);
    probe("active", name, whose(GetActiveWindow()));
    order(name);
    probe("icon", name, (LPSTR)(IsIconic(winD) ? "D" : "-"));
}

static void shoot(LPCSTR name, int at, int left, int top, int right, int bottom)
{
    shotName = name;
    shootAt = at;
    SetRect(&shotBox, left, top, right, bottom);
}

/* Alt held, Tab pressed `times` times, then Alt let go from the filter
 * hook once the loop has looked at each, the screen taken first: Alt is
 * down while the loop runs, as `GetAsyncKeyState` sees it. */
static void held(LPCSTR name, int times)
{
    int i;

    key(VK_MENU, SC_ALT, FALSE);

    for (i = 0; i < times; i++) {
        press(VK_TAB, SC_TAB);
    }

    shoot(name, times * 2, BOX_LEFT, BOX_TOP, BOX_RIGHT, BOX_BOTTOM);
    releaseAt = times * 2;
    pump();
}

/* Alt held, Tab pressed `times` times, Shift with it where asked. */
static void tabs(int times, BOOL shift)
{
    int i;

    key(VK_MENU, SC_ALT, FALSE);

    if (shift) {
        key(VK_SHIFT, SC_SHIFT, FALSE);
    }

    for (i = 0; i < times; i++) {
        press(VK_TAB, SC_TAB);
    }

    if (shift) {
        key(VK_SHIFT, SC_SHIFT, TRUE);
    }

    key(VK_MENU, SC_ALT, TRUE);
}

static HWND make(LPCSTR kind, LPCSTR title, DWORD style, int x, int y, int cx, int cy, HWND owner)
{
    return CreateWindow(kind, title, style, x, y, cx, cy, owner, NULL, module, NULL);
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
    kind.hIcon = LoadIcon(NULL, IDI_APPLICATION);
    kind.hCursor = LoadCursor(NULL, IDC_ARROW);
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "AltTop";
    RegisterClass(&kind);

    kind.hIcon = NULL;
    kind.lpszClassName = "AltBare";
    RegisterClass(&kind);

    keybdEvent = GetProcAddress(GetModuleHandle("USER"), "KEYBD_EVENT");
    mouseEvent = GetProcAddress(GetModuleHandle("USER"), "MOUSE_EVENT");

    if (!keybdEvent || !mouseEvent) {
        probe("entry", "KEYBD_EVENT", "missing");
        probeFinish();
        return 0;
    }

    winD = make("AltTop", "Probe D", WS_OVERLAPPEDWINDOW, 60, 300, 200, 120, NULL);
    ShowWindow(winD, SW_SHOWMINNOACTIVE);
    winC = make("AltBare", "Probe C", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 340, 200, 280, 180, NULL);
    winF = make("AltTop", "Probe F", WS_OVERLAPPEDWINDOW | WS_VISIBLE | WS_DISABLED, 10, 330,
                200, 100, NULL);
    winE = make("AltTop", "Probe E", WS_OVERLAPPEDWINDOW, 100, 150, 200, 100, NULL);
    winB = make("AltTop", "Probe B", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 200, 100, 300, 200, NULL);
    winP = make("AltTop", "Probe P", WS_POPUP | WS_CAPTION | WS_VISIBLE, 420, 30, 180, 80, winB);
    winA = make("AltTop", "Probe A", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 20, 20, 300, 200, NULL);
    UpdateWindow(winC);
    UpdateWindow(winB);
    UpdateWindow(winP);
    UpdateWindow(winA);
    pump();

    filter = SetWindowsHookEx(WH_MSGFILTER, (HOOKPROC)FilterProc, instance, GetCurrentTask());

    reset();
    tabs(1, FALSE);
    finish("tab");

    reset();
    tabs(2, FALSE);
    finish("tab2");

    reset();
    tabs(3, FALSE);
    finish("tab3");

    reset();
    held("held", 1);
    finish("held");

    reset();
    held("held2", 2);
    finish("held2");

    reset();
    held("held3", 3);
    finish("held3");

    reset();
    tabs(1, TRUE);
    finish("back");

    reset();
    key(VK_MENU, SC_ALT, FALSE);
    press(VK_ESCAPE, SC_ESC);
    key(VK_MENU, SC_ALT, TRUE);
    finish("esc");

    reset();
    key(VK_MENU, SC_ALT, FALSE);
    key(VK_SHIFT, SC_SHIFT, FALSE);
    press(VK_ESCAPE, SC_ESC);
    key(VK_SHIFT, SC_SHIFT, TRUE);
    key(VK_MENU, SC_ALT, TRUE);
    finish("shiftesc");

    reset();
    key(VK_MENU, SC_ALT, FALSE);
    press(VK_TAB, SC_TAB);
    press(VK_ESCAPE, SC_ESC);
    key(VK_MENU, SC_ALT, TRUE);
    finish("cancel");

    reset();
    key(VK_MENU, SC_ALT, FALSE);
    press(VK_TAB, SC_TAB);
    press(VK_X, SC_X);
    key(VK_MENU, SC_ALT, TRUE);
    finish("key");

    reset();
    mouse(MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE, across(560), down(340));
    pump();
    events[0] = '\0';
    key(VK_MENU, SC_ALT, FALSE);
    press(VK_TAB, SC_TAB);
    mouse(MOUSEEVENTF_LEFTDOWN | MOUSEEVENTF_ABSOLUTE, across(560), down(340));
    mouse(MOUSEEVENTF_LEFTUP | MOUSEEVENTF_ABSOLUTE, across(560), down(340));
    key(VK_MENU, SC_ALT, TRUE);
    finish("click");

    reset();
    SetActiveWindow(winB);
    pump();
    SetActiveWindow(winA);
    pump();
    events[0] = '\0';
    tabs(1, FALSE);
    finish("owner");

    reset();
    key(VK_MENU, SC_ALT, FALSE);
    press(VK_F6, SC_F6);
    key(VK_MENU, SC_ALT, TRUE);
    finish("f6");

    reset();
    SystemParametersInfo(SPI_SETFASTTASKSWITCH, 0, NULL, 0);
    shoot("outline", 1, 200, 100, 500, 300);
    tabs(1, FALSE);
    finish("outline");
    SystemParametersInfo(SPI_SETFASTTASKSWITCH, 1, NULL, 0);

    reset();
    SetSysModalWindow(winA);
    tabs(1, FALSE);
    finish("sysmodal");

    UnhookWindowsHookEx(filter);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
