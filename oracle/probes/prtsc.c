/*
 * Print Screen: USER's system queue takes the key for itself, and copies the
 * screen, or with Alt the active window, to the clipboard as a bitmap.
 *
 * `T`, "Probe T", is an overlapped window with a white client area at
 * (40, 40), 300 by 200, active and with the focus. Its procedure writes the
 * keys' messages it is handed and `WM_SYSCOMMAND`, which it does not pass
 * on. Keys go in through USER's own `KEYBD_EVENT`, as the keyboard driver
 * puts them in: Print Screen alone as `VK_SNAPSHOT` with 1 in BL, with Alt
 * with nought (`KEYBOARD.DRV` seg10 `00fa`-`013f`). Before each case the
 * clipboard is emptied.
 *
 * * `screen`: Print Screen pressed and let go, everything taken.
 * * `window`: Alt pressed, Print Screen pressed and let go, Alt let go.
 * * `offscreen`: `T` moved to (-50, -30); as `window`.
 * * `open`: the clipboard held open by `T`; Print Screen as `screen`.
 * * `peek`: Print Screen pressed; `PeekMessage` with `PM_NOREMOVE`, and what
 *   it found (`peek:`); the clipboard's formats then; let go.
 *
 * For each: the messages `T` was handed (`keys`); and the clipboard: its
 * formats in order, its owner (`desk` the desktop window), and the bitmap's
 * width, height, planes and bits a pixel, and some of its pixels as RGB.
 */

#define PROBE_FLUSH
#include "probe.h"

#define OUTPUT "C:\\ORACLE\\PRTSC.OUT"

static HINSTANCE module;
static HWND top;
static FARPROC keybdEvent;
static char events[400];

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

    if (hwnd == GetDesktopWindow()) {
        return "desk";
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
        wsprintf(one, "%s112:%x", whose(hwnd), wParam);
        add(one);
        return 0;
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

static void empty(void)
{
    OpenClipboard(top);
    EmptyClipboard();
    CloseClipboard();
}

/* The clipboard's formats, in order. */
static void formats(LPSTR out)
{
    UINT format = 0;
    char one[8];

    out[0] = '\0';

    if (!OpenClipboard(top)) {
        lstrcpy(out, "busy");
        return;
    }

    while ((format = EnumClipboardFormats(format)) != 0) {
        wsprintf(one, "%x ", format);
        lstrcat(out, one);
    }

    CloseClipboard();

    if (!out[0]) {
        lstrcpy(out, "none");
    }
}

static void pixel(LPSTR out, HDC dc, int x, int y)
{
    char one[24];

    wsprintf(one, " %d,%d=%06lx", x, y, GetPixel(dc, x, y));
    lstrcat(out, one);
}

/* What the clipboard holds, as the case left it. */
static void taken(LPCSTR name)
{
    char text[200];
    BITMAP bitmap;
    HBITMAP handle;
    HDC dc;
    HBITMAP was;
    int w;
    int h;

    probe("keys", name, events);
    formats(text);
    probe("formats", name, text);

    OpenClipboard(top);
    probe("owner", name, whose(GetClipboardOwner()));
    handle = (HBITMAP)GetClipboardData(CF_BITMAP);

    if (handle && GetObject(handle, sizeof(bitmap), &bitmap)) {
        wsprintf(text, "%d,%d,%d,%d", bitmap.bmWidth, bitmap.bmHeight, bitmap.bmPlanes,
                 bitmap.bmBitsPixel);
        probe("bitmap", name, text);
        w = bitmap.bmWidth;
        h = bitmap.bmHeight;
        dc = CreateCompatibleDC(NULL);
        was = SelectObject(dc, handle);
        text[0] = '\0';
        pixel(text, dc, 0, 0);
        pixel(text, dc, 1, 1);
        pixel(text, dc, 4, 4);
        pixel(text, dc, 10, 10);
        pixel(text, dc, w / 2, h / 2);
        pixel(text, dc, w - 1, h - 1);
        pixel(text, dc, 60, 50);
        pixel(text, dc, 150, 48);
        SelectObject(dc, was);
        DeleteDC(dc);
        probe("pixels", name, text);
    } else {
        probe("bitmap", name, "none");
    }

    CloseClipboard();
}

#define VK_SNAPSHOT 0x2c

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    MSG message;
    char text[80];

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
    kind.lpszClassName = "SnapTop";
    RegisterClass(&kind);

    keybdEvent = GetProcAddress(GetModuleHandle("USER"), "KEYBD_EVENT");

    if (!keybdEvent) {
        probe("entry", "KEYBD_EVENT", "missing");
        probeFinish();
        return 0;
    }

    top = CreateWindow("SnapTop", "Probe T", WS_OVERLAPPEDWINDOW, 40, 40, 300, 200, NULL, NULL,
                       module, NULL);
    ShowWindow(top, SW_SHOWNORMAL);
    UpdateWindow(top);
    pump();

    /* screen */
    empty();
    events[0] = '\0';
    key(VK_SNAPSHOT, 1, FALSE);
    key(VK_SNAPSHOT, 1, TRUE);
    pump();
    taken("screen");

    /* window */
    empty();
    events[0] = '\0';
    key(VK_MENU, 0x38, FALSE);
    key(VK_SNAPSHOT, 0, FALSE);
    key(VK_SNAPSHOT, 0, TRUE);
    key(VK_MENU, 0x38, TRUE);
    pump();
    taken("window");

    /* offscreen */
    MoveWindow(top, -50, -30, 300, 200, TRUE);
    UpdateWindow(top);
    pump();
    empty();
    events[0] = '\0';
    key(VK_MENU, 0x38, FALSE);
    key(VK_SNAPSHOT, 0, FALSE);
    key(VK_SNAPSHOT, 0, TRUE);
    key(VK_MENU, 0x38, TRUE);
    pump();
    taken("offscreen");
    MoveWindow(top, 40, 40, 300, 200, TRUE);
    UpdateWindow(top);
    pump();

    /* open */
    empty();
    events[0] = '\0';
    OpenClipboard(top);
    key(VK_SNAPSHOT, 1, FALSE);
    key(VK_SNAPSHOT, 1, TRUE);
    pump();
    CloseClipboard();
    taken("open");

    /* peek */
    empty();
    events[0] = '\0';
    key(VK_SNAPSHOT, 1, FALSE);

    if (PeekMessage(&message, NULL, 0, 0, PM_NOREMOVE)) {
        wsprintf(text, "peek:%s%x:%x", whose(message.hwnd), message.message, message.wParam);
    } else {
        lstrcpy(text, "peek:none");
    }

    add(text);
    formats(text);
    add(text);
    key(VK_SNAPSHOT, 1, TRUE);
    pump();
    taken("peek");

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
