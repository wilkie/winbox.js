/*
 * What Windows does to a window it maximizes, restores, minimizes, moves
 * and sizes, and what it draws while it does.
 *
 * One ordinary window, of the `chrome` probe's style and place:
 *
 * * `rects`: the window's rectangle and its client area's, after each step.
 * * `maximized`: the top of the screen with the window maximized, where the
 *   maximize box has become a restore box.
 * * `minimized`: the screen around the window minimized: its icon, and its
 *   title under it.
 * * `moved`, `sized`: the window moved, and sized, from the keyboard --
 *   `SC_MOVE` or `SC_SIZE`, then arrow keys and Enter, all posted before the
 *   loop that takes them starts. Moving and sizing are modal, like a menu,
 *   but their loop does not dispatch a timer -- a first version of this probe
 *   waited for one there and never finished -- so what is drawn while the
 *   window moves is not captured: only where it ends up.
 *
 * And what places and labels an icon: `iconmetric` records the icon spacing
 * metrics and what `SystemParametersInfo` says of the spacing and the icon
 * title's font.
 *
 * Every pixel of each area is read with `GetPixel`, a row a record, a palette
 * digit a pixel as `chrome` writes them.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\SIZING.OUT"

#define LEFT   40
#define TOP    40
#define WIDTH  200
#define HEIGHT 120

static const char HEX[] = "0123456789abcdef";

static const COLORREF PALETTE[16] = {
    RGB(0, 0, 0),       RGB(128, 0, 0),     RGB(0, 128, 0),   RGB(128, 128, 0),
    RGB(0, 0, 128),     RGB(128, 0, 128),   RGB(0, 128, 128), RGB(192, 192, 192),
    RGB(128, 128, 128), RGB(255, 0, 0),     RGB(0, 255, 0),   RGB(255, 255, 0),
    RGB(0, 0, 255),     RGB(255, 0, 255),   RGB(0, 255, 255), RGB(255, 255, 255),
};

static HWND frame;

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

/* Every pixel of a rectangle of the screen, a row a record, and where it was. */
static void capture(LPCSTR name, int left, int top, int right, int bottom)
{
    HDC screen = GetDC(NULL);
    int x;
    int y;

    wsprintf(probeArgs, "%s", name);
    wsprintf(probeResult, "%d:%d:%d:%d", left, top, right, bottom);
    probe("area", probeArgs, probeResult);

    for (y = top; y < bottom; y++) {
        LPSTR at = probeResult;

        for (x = left; x < right; x++) {
            *at++ = digit(GetPixel(screen, x, y));
        }

        *at = '\0';

        wsprintf(probeArgs, "%s,y=%d", name, y - top);
        probe("screen", probeArgs, probeResult);
    }

    ReleaseDC(NULL, screen);
}

/* The window's rectangles, as `chrome` writes them. */
static void rects(LPCSTR name)
{
    RECT window;
    RECT client;
    POINT corner;

    GetWindowRect(frame, &window);
    GetClientRect(frame, &client);

    corner.x = 0;
    corner.y = 0;
    ClientToScreen(frame, &corner);

    wsprintf(probeArgs, "%s", name);
    wsprintf(probeResult, "window=%d:%d:%d:%d,client=%d:%d:%d:%d,iconic=%d,zoomed=%d",
             window.left, window.top, window.right, window.bottom, corner.x, corner.y,
             corner.x + client.right, corner.y + client.bottom, IsIconic(frame) ? 1 : 0,
             IsZoomed(frame) ? 1 : 0);
    probe("rects", probeArgs, probeResult);
}

LONG FAR PASCAL _export ProbeProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_PAINT) {
        PAINTSTRUCT paint;

        BeginPaint(hwnd, &paint);
        EndPaint(hwnd, &paint);
        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

static void pump(void)
{
    MSG message;

    while (PeekMessage(&message, NULL, 0, 0, PM_REMOVE)) {
        TranslateMessage(&message);
        DispatchMessage(&message);
    }
}

/* Moves or sizes from the keyboard, every key posted before the loop starts. */
static void track(WPARAM command, int right, int down)
{
    int step;

    for (step = 0; step < right; step++) {
        PostMessage(frame, WM_KEYDOWN, VK_RIGHT, 0L);
    }

    for (step = 0; step < down; step++) {
        PostMessage(frame, WM_KEYDOWN, VK_DOWN, 0L);
    }

    PostMessage(frame, WM_KEYDOWN, VK_RETURN, 0L);
    SendMessage(frame, WM_SYSCOMMAND, command, 0L);
    pump();
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    RECT icon;
    int width = GetSystemMetrics(SM_CXSCREEN);
    int height = GetSystemMetrics(SM_CYSCREEN);

    probeOpen(OUTPUT);

    probeNote("what places and labels an icon");
    {
        LOGFONT title;
        int value;

        wsprintf(probeResult, "%d", GetSystemMetrics(SM_CXICON));
        probe("iconmetric", "SM_CXICON", probeResult);
        wsprintf(probeResult, "%d", GetSystemMetrics(SM_CYICON));
        probe("iconmetric", "SM_CYICON", probeResult);
        wsprintf(probeResult, "%d", GetSystemMetrics(SM_CXICONSPACING));
        probe("iconmetric", "SM_CXICONSPACING", probeResult);
        wsprintf(probeResult, "%d", GetSystemMetrics(SM_CYICONSPACING));
        probe("iconmetric", "SM_CYICONSPACING", probeResult);

        value = 0;
        SystemParametersInfo(SPI_ICONHORIZONTALSPACING, 0, &value, 0);
        wsprintf(probeResult, "%d", value);
        probe("iconmetric", "SPI_ICONHORIZONTALSPACING", probeResult);
        value = 0;
        SystemParametersInfo(SPI_ICONVERTICALSPACING, 0, &value, 0);
        wsprintf(probeResult, "%d", value);
        probe("iconmetric", "SPI_ICONVERTICALSPACING", probeResult);
        value = 0;
        SystemParametersInfo(SPI_GETICONTITLEWRAP, 0, &value, 0);
        wsprintf(probeResult, "%d", value);
        probe("iconmetric", "SPI_GETICONTITLEWRAP", probeResult);

        SystemParametersInfo(SPI_GETICONTITLELOGFONT, sizeof(title), &title, 0);
        wsprintf(probeResult, "height=%d,width=%d,weight=%d,italic=%d,charset=%d,face=%s",
                 title.lfHeight, title.lfWidth, title.lfWeight, title.lfItalic, title.lfCharSet,
                 (LPSTR)title.lfFaceName);
        probe("iconmetric", "SPI_GETICONTITLELOGFONT", probeResult);
    }

    ShowCursor(FALSE);
    SetCursorPos(width - 1, height - 1);

    kind.style = CS_HREDRAW | CS_VREDRAW;
    kind.lpfnWndProc = ProbeProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = LoadIcon(NULL, IDI_APPLICATION);
    kind.hCursor = LoadCursor(NULL, IDC_ARROW);
    kind.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "ProbeSizing";

    if (!RegisterClass(&kind)) {
        probe("setup", "RegisterClass", "failed");
        probeFinish();
        return 0;
    }

    frame = CreateWindow("ProbeSizing", "Probe", WS_OVERLAPPEDWINDOW, LEFT, TOP, WIDTH, HEIGHT,
                         NULL, NULL, instance, NULL);
    ShowWindow(frame, SW_SHOWNORMAL);
    UpdateWindow(frame);
    pump();
    rects("normal");

    probeNote("maximized, and restored");
    ShowWindow(frame, SW_SHOWMAXIMIZED);
    UpdateWindow(frame);
    pump();
    rects("maximized");
    capture("maximized", 0, 0, width, 24);
    ShowWindow(frame, SW_RESTORE);
    UpdateWindow(frame);
    pump();
    rects("restored");

    probeNote("minimized: the icon and its title");
    ShowWindow(frame, SW_SHOWMINIMIZED);
    UpdateWindow(frame);
    pump();
    rects("minimized");
    GetWindowRect(frame, &icon);
    capture("minimized", icon.left > 48 ? icon.left - 48 : 0, icon.top - 4,
            icon.right + 48 < width ? icon.right + 48 : width, height);
    ShowWindow(frame, SW_RESTORE);
    UpdateWindow(frame);
    pump();
    rects("unminimized");

    probeNote("moved and sized from the keyboard, three right and two down");
    track(SC_MOVE, 3, 2);
    UpdateWindow(frame);
    pump();
    rects("moved");
    track(SC_SIZE, 3, 2);
    UpdateWindow(frame);
    pump();
    rects("sized");

    DestroyWindow(frame);
    pump();

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
