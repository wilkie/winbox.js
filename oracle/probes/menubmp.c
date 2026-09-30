/*
 * What Windows draws for a menu item given bitmaps of its own by
 * `SetMenuItemBitmaps`, in a pop-up menu from `TrackPopupMenu`:
 *
 * * `items`: the menu as it opens, its first item, Alpha, selected. Alpha is checked and
 *   Beta not, each with an 8 by 8 box checked and an 8 by 8 diagonal
 *   unchecked; Gamma checked and Delta not, each with the box checked and
 *   no bitmap unchecked; Epsilon checked with a 20 by 20 bitmap, larger
 *   than the check mark; Zeta checked with no bitmaps; Eta checked, given
 *   the box and then no bitmaps again.
 * * `selected`: the same with Down pressed once, Beta selected.
 * * `selbeta`: with Down pressed twice, Gamma selected.
 *
 * The bitmaps are monochrome, a bit set a pixel of the bitmap's white.
 * Every pixel of the menu's left part, its border, the bitmaps' column and
 * the text's first letters, is read with `GetPixel`, a row a record, a
 * palette digit a pixel as `menus` writes them: the rest of a menu is
 * `menus`' to measure, and reading it all takes a run whole past its time.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\MENUBMP.OUT"

#define LEFT   40
#define TOP    40
#define WIDTH  240
#define HEIGHT 160

/* The part of the screen each capture reads. */
#define AREA_LEFT   146
#define AREA_TOP    116
#define AREA_RIGHT  190
#define AREA_BOTTOM 252

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

static const BYTE BOX[16] = {
    0xff, 0, 0x81, 0, 0x81, 0, 0x99, 0, 0x99, 0, 0x81, 0, 0x81, 0, 0xff, 0,
};

static const BYTE DIAGONAL[16] = {
    0x80, 0, 0x40, 0, 0x20, 0, 0x10, 0, 0x08, 0, 0x04, 0, 0x02, 0, 0x01, 0,
};

/* Opens the menu at the same place, Down pressed `downs` times, and captures it. */
static void open(HMENU popup, LPCSTR name, int downs)
{
    int n;

    pending = name;
    SetTimer(frame, TIMER, 300, NULL);

    for (n = 0; n < downs; n++) {
        PostMessage(frame, WM_KEYDOWN, VK_DOWN, 0L);
    }

    TrackPopupMenu(popup, TPM_LEFTALIGN, 150, 120, 0, frame, NULL);
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
    HMENU popup;
    HBITMAP box;
    HBITMAP diagonal;
    HBITMAP large;
    BYTE bits[20 * 4];
    int y;

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
    kind.lpszClassName = "ProbeMenuBmp";

    if (!RegisterClass(&kind)) {
        probe("setup", "RegisterClass", "failed");
        probeFinish();
        return 0;
    }

    box = CreateBitmap(8, 8, 1, 1, BOX);
    diagonal = CreateBitmap(8, 8, 1, 1, DIAGONAL);

    /* 20 by 20, rows of four bytes: the top half one pattern, the bottom
     * another, so where it is cut shows. */
    for (y = 0; y < 20; y++) {
        bits[y * 4] = y < 10 ? 0xf0 : 0x0f;
        bits[y * 4 + 1] = y < 10 ? 0xf0 : 0x0f;
        bits[y * 4 + 2] = y < 10 ? 0xf0 : 0x0f;
        bits[y * 4 + 3] = 0;
    }

    large = CreateBitmap(20, 20, 1, 1, bits);

    frame = CreateWindow("ProbeMenuBmp", "Bitmaps", WS_OVERLAPPEDWINDOW, LEFT, TOP, WIDTH,
                         HEIGHT, NULL, NULL, instance, NULL);
    ShowWindow(frame, SW_SHOWNORMAL);
    UpdateWindow(frame);
    pump();

    popup = CreatePopupMenu();
    AppendMenu(popup, MF_STRING | MF_CHECKED, 60, "&Alpha");
    AppendMenu(popup, MF_STRING, 61, "&Beta");
    AppendMenu(popup, MF_STRING | MF_CHECKED, 62, "&Gamma");
    AppendMenu(popup, MF_STRING, 63, "&Delta");
    AppendMenu(popup, MF_STRING | MF_CHECKED, 64, "&Epsilon");
    AppendMenu(popup, MF_STRING | MF_CHECKED, 65, "&Zeta");
    AppendMenu(popup, MF_STRING | MF_CHECKED, 66, "E&ta");

    SetMenuItemBitmaps(popup, 60, MF_BYCOMMAND, diagonal, box);
    SetMenuItemBitmaps(popup, 61, MF_BYCOMMAND, diagonal, box);
    SetMenuItemBitmaps(popup, 62, MF_BYCOMMAND, NULL, box);
    SetMenuItemBitmaps(popup, 63, MF_BYCOMMAND, NULL, box);
    SetMenuItemBitmaps(popup, 64, MF_BYCOMMAND, NULL, large);
    SetMenuItemBitmaps(popup, 66, MF_BYCOMMAND, diagonal, box);
    SetMenuItemBitmaps(popup, 66, MF_BYCOMMAND, NULL, NULL);

    probeNote("the menu as it opens");
    open(popup, "items", 0);

    probeNote("Down pressed once, then twice");
    open(popup, "selected", 1);
    open(popup, "selbeta", 2);

    DestroyMenu(popup);
    DestroyWindow(frame);
    pump();
    DeleteObject(box);
    DeleteObject(diagonal);
    DeleteObject(large);

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
