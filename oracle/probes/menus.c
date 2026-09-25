/*
 * What Windows draws for a menu: the menu bar, a menu pulled down from it,
 * the item selected in it, a pop-up menu, and the system menu.
 *
 * A menu is modal: once it is open, Windows runs its own message loop until
 * it closes, and the program gets control back only then. So each capture is
 * made from inside that loop, by a timer set before the menu opens -- the
 * menu's loop dispatches `WM_TIMER` to the window -- which reads the screen
 * back and then posts Escape until the menu is gone.
 *
 * The File menu holds what a menu can: an item with a shortcut after a tab, a
 * separator, a checked item, a grayed item, and a pop-up.
 *
 * * `bar`: the window with its menu bar, nothing open.
 * * `file`: File pulled down with its mnemonic, as Alt+F would.
 * * `down`: the same, with Down pressed once after it opened.
 * * `popup`: a pop-up menu from `TrackPopupMenu`.
 * * `system`: the system menu, opened with Alt+Space.
 *
 * Every pixel of a rectangle of the screen around the window is read with
 * `GetPixel`, a row a record, a palette digit a pixel as `chrome` writes them.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\MENUS.OUT"

#define LEFT   40
#define TOP    40
#define WIDTH  240
#define HEIGHT 160

/* The part of the screen each capture reads. */
#define AREA_LEFT   32
#define AREA_TOP    32
#define AREA_RIGHT  352
#define AREA_BOTTOM 272

#define TIMER 1

static const char HEX[] = "0123456789abcdef";

static const COLORREF PALETTE[16] = {
    RGB(0, 0, 0),       RGB(128, 0, 0),     RGB(0, 128, 0),   RGB(128, 128, 0),
    RGB(0, 0, 128),     RGB(128, 0, 128),   RGB(0, 128, 128), RGB(192, 192, 192),
    RGB(128, 128, 128), RGB(255, 0, 0),     RGB(0, 255, 0),   RGB(255, 255, 0),
    RGB(0, 0, 255),     RGB(255, 0, 255),   RGB(0, 255, 255), RGB(255, 255, 255),
};

static HINSTANCE module;
static HWND frame;
static HMENU recent;
static LPCSTR pending;

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

/* Every pixel of the area, a row a record. */
static void capture(LPCSTR name)
{
    HDC screen = GetDC(NULL);
    int x;
    int y;

    for (y = AREA_TOP; y < AREA_BOTTOM; y++) {
        LPSTR at = probeResult;

        for (x = AREA_LEFT; x < AREA_RIGHT; x++) {
            *at++ = digit(GetPixel(screen, x, y));
        }

        *at = '\0';

        wsprintf(probeArgs, "%s,y=%d", name, y - AREA_TOP);
        probe("screen", probeArgs, probeResult);
    }

    ReleaseDC(NULL, screen);
}

/* The window's procedure: what `DefWindowProc` does, and the captures. */
LONG FAR PASCAL _export ProbeProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_PAINT) {
        PAINTSTRUCT paint;

        BeginPaint(hwnd, &paint);
        EndPaint(hwnd, &paint);
        return 0;
    }

    if (message == WM_TIMER && wParam == TIMER) {
        KillTimer(hwnd, TIMER);

        if (pending) {
            capture(pending);
            pending = NULL;
        }

        /* Out of the menu, however deep: a pop-up, then the bar. */
        PostMessage(hwnd, WM_KEYDOWN, VK_ESCAPE, 0L);
        PostMessage(hwnd, WM_KEYDOWN, VK_ESCAPE, 0L);
        PostMessage(hwnd, WM_KEYDOWN, VK_ESCAPE, 0L);
        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

/* Lets every queued message be handled, so the window is fully painted. */
static void pump(void)
{
    MSG message;

    while (PeekMessage(&message, NULL, 0, 0, PM_REMOVE)) {
        TranslateMessage(&message);
        DispatchMessage(&message);
    }
}

/* Opens a menu with a system command, and captures it from inside. */
static void captureOpen(LPCSTR name, WPARAM command, LPARAM key, BOOL down)
{
    pending = name;
    SetTimer(frame, TIMER, 300, NULL);

    if (down) {
        PostMessage(frame, WM_KEYDOWN, VK_DOWN, 0L);
    }

    SendMessage(frame, WM_SYSCOMMAND, command, key);
    pump();

    if (pending) {
        probe("setup", name, "the menu did not open");
        pending = NULL;
        KillTimer(frame, TIMER);
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HMENU bar;
    HMENU file;
    HMENU edit;
    HMENU popup;

    module = instance;
    probeOpen(OUTPUT);

    ShowCursor(FALSE);
    SetCursorPos(639, 479);

    kind.style = CS_HREDRAW | CS_VREDRAW;
    kind.lpfnWndProc = ProbeProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = LoadIcon(NULL, IDI_APPLICATION);
    kind.hCursor = LoadCursor(NULL, IDC_ARROW);
    kind.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "ProbeMenus";

    if (!RegisterClass(&kind)) {
        probe("setup", "RegisterClass", "failed");
        probeFinish();
        return 0;
    }

    recent = CreatePopupMenu();
    AppendMenu(recent, MF_STRING, 20, "&First");
    AppendMenu(recent, MF_STRING, 21, "&Second");

    file = CreatePopupMenu();
    AppendMenu(file, MF_STRING, 10, "&New");
    AppendMenu(file, MF_STRING, 11, "&Open...\tCtrl+O");
    AppendMenu(file, MF_SEPARATOR, 0, NULL);
    AppendMenu(file, MF_STRING | MF_CHECKED, 12, "&Word Wrap");
    AppendMenu(file, MF_STRING | MF_GRAYED, 13, "&Print");
    AppendMenu(file, MF_POPUP, (UINT)recent, "&Recent");
    AppendMenu(file, MF_SEPARATOR, 0, NULL);
    AppendMenu(file, MF_STRING, 14, "E&xit");

    edit = CreatePopupMenu();
    AppendMenu(edit, MF_STRING, 30, "&Undo");

    bar = CreateMenu();
    AppendMenu(bar, MF_POPUP, (UINT)file, "&File");
    AppendMenu(bar, MF_POPUP, (UINT)edit, "&Edit");
    AppendMenu(bar, MF_STRING, 40, "&Help");

    frame = CreateWindow("ProbeMenus", "Menus", WS_OVERLAPPEDWINDOW, LEFT, TOP, WIDTH, HEIGHT,
                         NULL, bar, instance, NULL);
    ShowWindow(frame, SW_SHOWNORMAL);
    UpdateWindow(frame);
    pump();

    probeNote("the menu bar, nothing open");
    capture("bar");

    probeNote("File pulled down by its mnemonic, then with Down pressed once");
    captureOpen("file", SC_KEYMENU, (LPARAM)'f', FALSE);
    captureOpen("down", SC_KEYMENU, (LPARAM)'f', TRUE);

    probeNote("a pop-up menu from TrackPopupMenu");
    popup = CreatePopupMenu();
    AppendMenu(popup, MF_STRING, 50, "&Cut");
    AppendMenu(popup, MF_STRING, 51, "C&opy");
    AppendMenu(popup, MF_STRING | MF_GRAYED, 52, "&Paste");
    pending = "popup";
    SetTimer(frame, TIMER, 300, NULL);
    TrackPopupMenu(popup, TPM_LEFTALIGN, 150, 120, 0, frame, NULL);
    pump();
    DestroyMenu(popup);

    probeNote("the system menu, opened with Alt+Space");
    captureOpen("system", SC_KEYMENU, (LPARAM)' ', FALSE);

    DestroyWindow(frame);
    pump();

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
