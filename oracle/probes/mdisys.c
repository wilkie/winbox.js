/*
 * An MDI document window's system menu: opened by Alt and the hyphen, by a
 * click on its box and on its icon, and, the window maximized, from the
 * frame's menu bar, where it sits as the bar's first item.
 *
 * `F` is an MDI frame at (20, 20), 560 by 400, with a bar of "&File" (`file`:
 * "&New" 100, "E&xit" 101) and "&Window" (`win`: "&Tile" 200), and the MDI
 * client `C` filling it. In `C` are the document windows `A`, at (10, 10),
 * and `B`, at (240, 10), each 200 by 150, made in that order, so `B` is
 * active. Each window's system menu is asked for once at the start, so the
 * menus are named the same throughout: `Fsys`, `Asys` and `Bsys`.
 *
 * Each case puts its keys or its clicks in through USER's own `KEYBD_EVENT`
 * and `MOUSE_EVENT`, as the drivers would, then takes and dispatches every
 * message, with `TranslateMDISysAccel` and `TranslateMessage`, for a second
 * of a timer's:
 *
 * * `althyphen`: `B` focused; +Alt +'-' -'-' -Alt, then Escape twice.
 * * `altletter`: the same with F for the hyphen.
 * * `altspace`: the same with Space.
 * * `framehyphen`: the focus on `F` itself, which keeps it (its procedure
 *   does not pass `WM_SETFOCUS` on to `DefFrameProc` while it is asked to);
 *   Alt and the hyphen, then Escape twice.
 * * `boxclick`: a click on `B`'s system menu box.
 * * `iconclick`: `A` minimized, a click on its icon; then `A` restored.
 * * `maximize`: `B` maximized by `WM_MDIMAXIMIZE`.
 * * `maxhyphen`: `B` maximized and focused; Alt and the hyphen, then Escape
 *   twice.
 * * `maxclick`: a click on the frame's bar, at its left end.
 * * `maxchoose`: Alt and the hyphen, then R.
 * * `maxbutton`: `B` maximized again; a click on the bar at its right end.
 *
 * A menu still open when the input has run out is ended at its first
 * `WM_ENTERIDLE` by `WM_CANCELMODE` to the window told.
 *
 * For each case, `log`: what the three procedures were handed, in order, as
 * the window (`F`, `A`, `B`) and the message in hex: `WM_SYSCOMMAND` with
 * wParam and lParam; `WM_COMMAND` with wParam; `WM_SYSCHAR` with the
 * character; `WM_INITMENU` and `WM_INITMENUPOPUP` with the menu named and
 * lParam; `WM_MENUCHAR` with the character, the flags and the menu named;
 * `WM_MENUSELECT` with the item -- a pop-up named -- and the flags;
 * `WM_NCLBUTTONDOWN` with the hit; `WM_ENTERIDLE` the first time. A menu
 * is named `bar` for `F`'s, `file` and `win`, `Fsys`, `Asys` and `Bsys`,
 * `hold(...)` for one whose first item opens one of those, else `other`.
 * Then `state`: the active child and whether it is maximized, `A`'s and
 * `B`'s state (`n`, `min`, `max`), where the focus is, and `F`'s title.
 *
 * And for `maximize` and `maxbutton`, `bar`: each item of `F`'s bar, by
 * position: `GetMenuState`, `GetMenuItemID`, the pop-up it opens named, and
 * its text; and `sys`: each item of `Bsys` the same way, at the start and
 * maximized.
 *
 * And `pix`, the screen a row a record, a palette digit a pixel, as `menus`
 * writes them: `caption`, the top left of `B` at the start, 60 by 26; and
 * the top 48 rows of `F`, `maxbar` with `B` maximized and `bar` once it is
 * restored.
 */

#define PROBE_FLUSH

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\MDISYS.OUT"

#define VK_HYPHEN 0xbd
#define VK_F_ 0x46
#define VK_R_ 0x52

#define SF_ABSOLUTE 0x8000
#define MOVE 0x0001
#define LEFTDOWN 0x0002
#define LEFTUP 0x0004

static HINSTANCE module;
static HWND frame;
static HWND client;
static HWND childA;
static HWND childB;
static HMENU bar;
static HMENU fileMenu;
static HMENU winMenu;
static HMENU sysF;
static HMENU sysA;
static HMENU sysB;
static FARPROC keybdEvent;
static FARPROC mouseEvent;
static BOOL idled;
static BOOL keepFocus;
static char events[1800];

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

    if (hwnd == frame) {
        return "F";
    }

    if (hwnd == client) {
        return "C";
    }

    if (hwnd == childA) {
        return "A";
    }

    if (hwnd == childB) {
        return "B";
    }

    wsprintf(handle, "%04x", hwnd);
    return handle;
}

static LPCSTR plainName(HMENU menu)
{
    if (menu == NULL) {
        return "0";
    }

    if (menu == bar) {
        return "bar";
    }

    if (menu == fileMenu) {
        return "file";
    }

    if (menu == winMenu) {
        return "win";
    }

    if (menu == sysF) {
        return "Fsys";
    }

    if (menu == sysA) {
        return "Asys";
    }

    if (menu == sysB) {
        return "Bsys";
    }

    return NULL;
}

static LPCSTR menuName(HMENU menu)
{
    static char text[24];
    LPCSTR plain = plainName(menu);
    LPCSTR inner;

    if (plain) {
        return plain;
    }

    inner = IsMenu(menu) ? plainName(GetSubMenu(menu, 0)) : NULL;

    if (inner) {
        wsprintf(text, "hold(%s)", inner);
        return text;
    }

    return "other";
}

static void add(LPCSTR text)
{
    if (lstrlen(events) + lstrlen(text) + 2 < sizeof(events)) {
        lstrcat(events, text);
        lstrcat(events, ",");
    }
}

static void note(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    char one[64];
    LPCSTR who = whose(hwnd);

    switch (message) {
    case WM_SYSCOMMAND:
        wsprintf(one, "%s%x:%x/%lx", who, message, wParam, lParam);
        break;
    case WM_COMMAND:
    case WM_SYSCHAR:
    case WM_NCLBUTTONDOWN:
        wsprintf(one, "%s%x:%x", who, message, wParam);
        break;
    case WM_INITMENU:
        wsprintf(one, "%s%x:%s", who, message, menuName((HMENU)wParam));
        break;
    case WM_INITMENUPOPUP:
        wsprintf(one, "%s%x:%s/%lx", who, message, menuName((HMENU)wParam), lParam);
        break;
    case WM_MENUCHAR:
        wsprintf(one, "%s%x:%x/%x/%s", who, message, wParam, LOWORD(lParam),
                 menuName((HMENU)HIWORD(lParam)));
        break;
    case WM_MENUSELECT:
        if (LOWORD(lParam) == 0xffff) {
            wsprintf(one, "%s%x:end", who, message);
        } else if (LOWORD(lParam) & MF_POPUP) {
            wsprintf(one, "%s%x:%s/%x", who, message, menuName((HMENU)wParam),
                     LOWORD(lParam) & ~(MF_GRAYED | MF_DISABLED));
        } else {
            wsprintf(one, "%s%x:%x/%x", who, message, wParam,
                     LOWORD(lParam) & ~(MF_GRAYED | MF_DISABLED));
        }
        break;
    case WM_ENTERIDLE:
        if (idled) {
            return;
        }

        wsprintf(one, "%s%x", who, message);
        break;
    default:
        return;
    }

    add(one);
}

/* A menu still open when the input has run out: ended. */
static BOOL idle(HWND hwnd, UINT message)
{
    if (message != WM_ENTERIDLE) {
        return FALSE;
    }

    idled = TRUE;
    SendMessage(hwnd, WM_CANCELMODE, 0, 0L);
    return TRUE;
}

LONG FAR PASCAL _export FrameProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    note(hwnd, message, wParam, lParam);

    if (idle(hwnd, message)) {
        return 0;
    }

    if (message == WM_SETFOCUS && keepFocus) {
        return 0;
    }

    return DefFrameProc(hwnd, client, message, wParam, lParam);
}

LONG FAR PASCAL _export ChildProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    note(hwnd, message, wParam, lParam);

    if (idle(hwnd, message)) {
        return 0;
    }

    return DefMDIChildProc(hwnd, message, wParam, lParam);
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

static void alt(BYTE vk, BYTE scan)
{
    key(VK_MENU, 0x38, FALSE);
    press(vk, scan);
    key(VK_MENU, 0x38, TRUE);
}

static void mouse(WORD flags, int x, int y)
{
    mouseFlags = flags;
    mouseX = (WORD)(((DWORD)x * 65536L + GetSystemMetrics(SM_CXSCREEN) - 1) /
                    GetSystemMetrics(SM_CXSCREEN));
    mouseY = (WORD)(((DWORD)y * 65536L + GetSystemMetrics(SM_CYSCREEN) - 1) /
                    GetSystemMetrics(SM_CYSCREEN));

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

static void click(int x, int y)
{
    mouse(SF_ABSOLUTE | MOVE, x, y);
    mouse(SF_ABSOLUTE | MOVE | LEFTDOWN, x, y);
    mouse(SF_ABSOLUTE | MOVE | LEFTUP, x, y);
}

/* Messages dispatched for a second, a timer's, as an MDI program's loop does. */
static void settle(void)
{
    MSG message;

    SetTimer(frame, 99, 1000, NULL);

    while (GetMessage(&message, NULL, 0, 0)) {
        if (message.message == WM_TIMER && message.hwnd == frame && message.wParam == 99) {
            break;
        }

        if (message.message == WM_SYSCOMMAND || message.message == WM_COMMAND) {
            char one[24];

            wsprintf(one, "@%s%x:%x", whose(message.hwnd), message.message, message.wParam);
            add(one);
        }

        if (!TranslateMDISysAccel(client, &message)) {
            TranslateMessage(&message);
            DispatchMessage(&message);
        }
    }

    KillTimer(frame, 99);
}

static void begin(void)
{
    events[0] = '\0';
    idled = FALSE;
}

static LPCSTR stateOf(HWND hwnd)
{
    if (IsIconic(hwnd)) {
        return "min";
    }

    return IsZoomed(hwnd) ? "max" : "n";
}

static void finish(LPCSTR name)
{
    DWORD active;
    char title[64];

    settle();
    probe("log", name, events);

    active = SendMessage(client, WM_MDIGETACTIVE, 0, 0L);
    GetWindowText(frame, title, sizeof(title));
    wsprintf(probeResult, "active=%s%s,A=%s,B=%s,focus=%s,title=%s",
             whose((HWND)LOWORD(active)), (LPSTR)(HIWORD(active) ? "+max" : ""),
             stateOf(childA), stateOf(childB), whose(GetFocus()), (LPSTR)title);
    probe("state", name, probeResult);
}

static void items(LPCSTR record, LPCSTR name, HMENU menu)
{
    int count = GetMenuItemCount(menu);
    int i;
    char *at = probeResult;
    char text[40];

    at += wsprintf(at, "%d", count);

    for (i = 0; i < count; i++) {
        text[0] = '\0';
        GetMenuString(menu, i, text, sizeof(text), MF_BYPOSITION);
        at += wsprintf(at, "|%x %x %s %s", GetMenuState(menu, i, MF_BYPOSITION),
                       GetMenuItemID(menu, i), menuName(GetSubMenu(menu, i)), (LPSTR)text);
    }

    probe(record, name, probeResult);
}

static const char HEX[] = "0123456789abcdef";

static const COLORREF PALETTE[16] = {
    RGB(0, 0, 0),       RGB(128, 0, 0),     RGB(0, 128, 0),   RGB(128, 128, 0),
    RGB(0, 0, 128),     RGB(128, 0, 128),   RGB(0, 128, 128), RGB(192, 192, 192),
    RGB(128, 128, 128), RGB(255, 0, 0),     RGB(0, 255, 0),   RGB(255, 255, 0),
    RGB(0, 0, 255),     RGB(255, 0, 255),   RGB(0, 255, 255), RGB(255, 255, 255),
};

static char row[600];

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

/* A part of the screen, a row a record, a palette digit a pixel. */
static void pixels(LPCSTR record, LPCSTR name, int left, int top, int width, int height)
{
    HDC screen = GetDC(NULL);
    int x;
    int y;

    for (y = 0; y < height; y++) {
        for (x = 0; x < width; x++) {
            row[x] = digit(GetPixel(screen, left + x, top + y));
        }

        row[width] = '\0';
        wsprintf(probeArgs, "%s,y=%d", name, y);
        probe(record, probeArgs, row);
    }

    ReleaseDC(NULL, screen);
}

/* Where the frame's menu bar is on the screen: its left and right ends, and
 * a line through its middle. */
static void barPlace(int *left, int *right, int *middle)
{
    POINT corner;
    RECT area;

    corner.x = 0;
    corner.y = 0;
    ClientToScreen(frame, &corner);
    GetClientRect(frame, &area);
    *left = corner.x + 4;
    *right = corner.x + area.right - 6;
    *middle = corner.y - GetSystemMetrics(SM_CYMENU) / 2;
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    CLIENTCREATESTRUCT made;
    MDICREATESTRUCT child;
    RECT box;
    int left;
    int right;
    int middle;

    probeOpen(OUTPUT);
    module = instance;

    kind.style = 0;
    kind.lpfnWndProc = FrameProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = LoadIcon(NULL, IDI_APPLICATION);
    kind.hCursor = LoadCursor(NULL, IDC_ARROW);
    kind.hbrBackground = (HBRUSH)(COLOR_APPWORKSPACE + 1);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "MdiSysFrame";
    RegisterClass(&kind);

    kind.lpfnWndProc = ChildProc;
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszClassName = "MdiSysChild";
    RegisterClass(&kind);

    fileMenu = CreatePopupMenu();
    AppendMenu(fileMenu, MF_STRING, 100, "&New");
    AppendMenu(fileMenu, MF_STRING, 101, "E&xit");
    winMenu = CreatePopupMenu();
    AppendMenu(winMenu, MF_STRING, 200, "&Tile");
    bar = CreateMenu();
    AppendMenu(bar, MF_POPUP, (UINT)fileMenu, "&File");
    AppendMenu(bar, MF_POPUP, (UINT)winMenu, "&Window");

    frame = CreateWindow("MdiSysFrame", "F", WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN, 20, 20, 560,
                         400, NULL, bar, instance, NULL);

    made.hWindowMenu = winMenu;
    made.idFirstChild = 1000;
    client = CreateWindow("MDICLIENT", NULL, WS_CHILD | WS_CLIPCHILDREN | WS_VISIBLE, 0, 0, 0, 0,
                          frame, (HMENU)1, instance, (LPSTR)&made);

    child.szClass = "MdiSysChild";
    child.szTitle = "A";
    child.hOwner = instance;
    child.x = 10;
    child.y = 10;
    child.cx = 200;
    child.cy = 150;
    child.style = 0;
    child.lParam = 0;
    childA = (HWND)LOWORD(SendMessage(client, WM_MDICREATE, 0, (LONG)(LPMDICREATESTRUCT)&child));

    child.szTitle = "B";
    child.x = 240;
    childB = (HWND)LOWORD(SendMessage(client, WM_MDICREATE, 0, (LONG)(LPMDICREATESTRUCT)&child));

    ShowWindow(frame, SW_SHOWNORMAL);
    UpdateWindow(frame);

    sysF = GetSystemMenu(frame, FALSE);
    sysA = GetSystemMenu(childA, FALSE);
    sysB = GetSystemMenu(childB, FALSE);

    keybdEvent = GetProcAddress(GetModuleHandle("USER"), "KEYBD_EVENT");
    mouseEvent = GetProcAddress(GetModuleHandle("USER"), "MOUSE_EVENT");
    wsprintf(probeResult, "%s,%s", (LPSTR)(keybdEvent ? "found" : "missing"),
             (LPSTR)(mouseEvent ? "found" : "missing"));
    probe("entry", "KEYBD_EVENT,MOUSE_EVENT", probeResult);

    if (!keybdEvent || !mouseEvent) {
        probeFinish();
        return 0;
    }

    ShowCursor(FALSE);
    SetCursorPos(GetSystemMetrics(SM_CXSCREEN) - 1, GetSystemMetrics(SM_CYSCREEN) - 1);
    settle();
    items("sys", "start", sysB);
    GetWindowRect(childB, &box);
    pixels("pix", "caption", box.left, box.top, 60, 26);

    begin();
    SetFocus(childB);
    alt(VK_HYPHEN, 0x0c);
    press(VK_ESCAPE, 0x01);
    press(VK_ESCAPE, 0x01);
    finish("althyphen");

    begin();
    SetFocus(childB);
    alt(VK_F_, 0x21);
    press(VK_ESCAPE, 0x01);
    press(VK_ESCAPE, 0x01);
    finish("altletter");

    begin();
    SetFocus(childB);
    alt(VK_SPACE, 0x39);
    press(VK_ESCAPE, 0x01);
    press(VK_ESCAPE, 0x01);
    finish("altspace");

    begin();
    keepFocus = TRUE;
    SetFocus(frame);
    alt(VK_HYPHEN, 0x0c);
    press(VK_ESCAPE, 0x01);
    press(VK_ESCAPE, 0x01);
    finish("framehyphen");
    keepFocus = FALSE;

    SetFocus(childB);
    settle();
    GetWindowRect(childB, &box);
    begin();
    click(box.left + GetSystemMetrics(SM_CXFRAME) + 4, box.top + GetSystemMetrics(SM_CYFRAME) + 4);
    finish("boxclick");

    ShowWindow(childA, SW_MINIMIZE);
    settle();
    GetWindowRect(childA, &box);
    begin();
    click((box.left + box.right) / 2, (box.top + box.bottom) / 2);
    finish("iconclick");
    SendMessage(client, WM_MDIRESTORE, (WPARAM)childA, 0L);
    SendMessage(client, WM_MDIACTIVATE, (WPARAM)childB, 0L);
    settle();

    begin();
    SendMessage(client, WM_MDIMAXIMIZE, (WPARAM)childB, 0L);
    finish("maximize");
    items("bar", "maximize", bar);
    items("sys", "maximize", sysB);
    GetWindowRect(frame, &box);
    pixels("pix", "maxbar", box.left, box.top, box.right - box.left, 48);

    begin();
    SetFocus(childB);
    alt(VK_HYPHEN, 0x0c);
    press(VK_ESCAPE, 0x01);
    press(VK_ESCAPE, 0x01);
    finish("maxhyphen");

    barPlace(&left, &right, &middle);
    begin();
    click(left, middle);
    finish("maxclick");

    begin();
    SetFocus(childB);
    alt(VK_HYPHEN, 0x0c);
    press(VK_R_, 0x13);
    finish("maxchoose");

    SendMessage(client, WM_MDIMAXIMIZE, (WPARAM)childB, 0L);
    settle();
    items("bar", "maxbutton", bar);
    barPlace(&left, &right, &middle);
    begin();
    click(right, middle);
    finish("maxbutton");
    items("bar", "restored", bar);
    GetWindowRect(frame, &box);
    pixels("pix", "bar", box.left, box.top, box.right - box.left, 48);

    DestroyWindow(frame);
    probeFinish();

    return 0;
}
