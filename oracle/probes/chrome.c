/*
 * What Windows draws around a window, pixel for pixel.
 *
 * A window's frame, caption, menu bar and scroll bars are USER's to draw, and
 * so are the standard controls. winbox.js has drawn all of them with HTML and
 * CSS, which is close and not exact. To draw them as Windows does, there has to
 * be something to be exact against, and this is it: windows of the common
 * styles made one at a time on an empty desktop, and every pixel of each read
 * back off the screen.
 *
 * The pixels are read with `GetPixel` on the screen's device context, which
 * `bitblt` recorded returning the palette's own colours, and written as one hex
 * digit a pixel: the colour's place in the Windows palette, light grey 7 and
 * dark grey 8, as a program names them. A colour outside the palette would be
 * `?`, and on a sixteen-colour display there is none. A row is a record.
 *
 * Beside the pixels: each window's rectangle and its client rectangle on the
 * screen, every system colour, and the system metrics that size a frame, so a
 * difference in a pixel can be told from a difference in a measurement.
 *
 * The windows:
 *
 * * `overlapped`, the ordinary window: caption, system menu, minimize and
 *   maximize boxes, a sizing frame. Active.
 * * `inactive`, the same window once another has been made active.
 * * `caption`, a caption and system menu on a thin border, no sizing frame.
 * * `menu`, the ordinary window with a menu bar of three items.
 * * `scroll`, the ordinary window with both scroll bars.
 * * `dialog`, a popup with a dialog frame.
 * * `popup`, a popup with a thin border.
 * * `controls`, the ordinary window holding a push button, a default push
 *   button, a checked check box, a checked radio button, static text, an edit
 *   control, a list box and a scroll bar control.
 *
 * The mouse pointer is hidden and moved to the corner first, so it is in no
 * capture.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\CHROME.OUT"

#define LEFT   40
#define TOP    40
#define WIDTH  200
#define HEIGHT 120

static HINSTANCE module;

static const char HEX[] = "0123456789abcdef";

/* The sixteen colours of the palette, in the order Windows documents them. */
static const COLORREF PALETTE[16] = {
    RGB(0, 0, 0),       RGB(128, 0, 0),     RGB(0, 128, 0),   RGB(128, 128, 0),
    RGB(0, 0, 128),     RGB(128, 0, 128),   RGB(0, 128, 128), RGB(192, 192, 192),
    RGB(128, 128, 128), RGB(255, 0, 0),     RGB(0, 255, 0),   RGB(255, 255, 0),
    RGB(0, 0, 255),     RGB(255, 0, 255),   RGB(0, 255, 255), RGB(255, 255, 255),
};

/* A window procedure that paints only what `DefWindowProc` would. */
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

/* Lets every queued message be handled, so the window is fully painted. */
static void pump(void)
{
    MSG message;

    while (PeekMessage(&message, NULL, 0, 0, PM_REMOVE)) {
        TranslateMessage(&message);
        DispatchMessage(&message);
    }
}

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

/* A window's rectangles, and every pixel of it, a row a record. */
static void capture(LPCSTR name, HWND hwnd)
{
    HDC screen;
    RECT window;
    RECT client;
    POINT corner;
    int x;
    int y;

    UpdateWindow(hwnd);
    pump();

    GetWindowRect(hwnd, &window);
    GetClientRect(hwnd, &client);

    corner.x = 0;
    corner.y = 0;
    ClientToScreen(hwnd, &corner);

    wsprintf(probeArgs, "%s", (LPSTR)name);
    wsprintf(probeResult, "window=%d:%d:%d:%d,client=%d:%d:%d:%d", window.left, window.top,
             window.right, window.bottom, corner.x, corner.y, corner.x + client.right,
             corner.y + client.bottom);
    probe("rects", probeArgs, probeResult);

    screen = GetDC(NULL);

    for (y = window.top; y < window.bottom; y++) {
        LPSTR at = probeResult;

        for (x = window.left; x < window.right; x++) {
            *at++ = digit(GetPixel(screen, x, y));
        }

        *at = '\0';

        wsprintf(probeArgs, "%s,y=%d", (LPSTR)name, y - window.top);
        probe("pixels", probeArgs, probeResult);
    }

    ReleaseDC(NULL, screen);
}

static HWND make(DWORD style, HMENU menu, int width, int height)
{
    HWND hwnd = CreateWindow("ProbeFrame", "Probe", style, LEFT, TOP, width, height, NULL, menu,
                             module, NULL);

    ShowWindow(hwnd, SW_SHOWNORMAL);
    return hwnd;
}

/* One window of a style, captured and gone again. */
static void probeStyle(LPCSTR name, DWORD style, HMENU menu)
{
    HWND hwnd = make(style, menu, WIDTH, HEIGHT);

    capture(name, hwnd);
    DestroyWindow(hwnd);
    pump();
}

static void control(HWND parent, LPCSTR type, LPCSTR text, DWORD style, int x, int y, int w,
                    int h, int id)
{
    CreateWindow(type, text, WS_CHILD | WS_VISIBLE | style, x, y, w, h, parent, (HMENU)id, module,
                 NULL);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static const int METRICS[] = {
        SM_CXSCREEN, SM_CYSCREEN, SM_CXVSCROLL, SM_CYHSCROLL, SM_CYCAPTION, SM_CXBORDER,
        SM_CYBORDER, SM_CXDLGFRAME, SM_CYDLGFRAME, SM_CYVTHUMB, SM_CXHTHUMB, SM_CXICON,
        SM_CYICON, SM_CXCURSOR, SM_CYCURSOR, SM_CYMENU, SM_CXFULLSCREEN, SM_CYFULLSCREEN,
        SM_CYKANJIWINDOW, SM_MOUSEPRESENT, SM_CYVSCROLL, SM_CXHSCROLL, SM_DEBUG, SM_SWAPBUTTON,
        SM_CXMIN, SM_CYMIN, SM_CXSIZE, SM_CYSIZE, SM_CXFRAME, SM_CYFRAME, SM_CXMINTRACK,
        SM_CYMINTRACK, -1,
    };

    WNDCLASS kind;
    HMENU menu;
    HWND first;
    HWND second;
    HWND controls;
    int index;

    module = instance;
    probeOpen(OUTPUT);

    ShowCursor(FALSE);
    SetCursorPos(639, 479);

    probeNote("the system colours, and the metrics that size a frame");

    for (index = 0; index <= COLOR_BTNHIGHLIGHT; index++) {
        wsprintf(probeArgs, "%d", index);
        wsprintf(probeResult, "%06lx", GetSysColor(index) & 0xffffffL);
        probe("syscolor", probeArgs, probeResult);
    }

    for (index = 0; METRICS[index] >= 0; index++) {
        wsprintf(probeArgs, "%d", METRICS[index]);
        wsprintf(probeResult, "%d", GetSystemMetrics(METRICS[index]));
        probe("metric", probeArgs, probeResult);
    }

    kind.style = CS_HREDRAW | CS_VREDRAW;
    kind.lpfnWndProc = ProbeProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = LoadIcon(NULL, IDI_APPLICATION);
    kind.hCursor = LoadCursor(NULL, IDC_ARROW);
    kind.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "ProbeFrame";

    if (!RegisterClass(&kind)) {
        probe("setup", "RegisterClass", "failed");
        probeFinish();
        return 0;
    }

    probeNote("windows of each style, alone on the desktop");
    probeStyle("overlapped", WS_OVERLAPPEDWINDOW, NULL);
    probeStyle("caption", WS_CAPTION | WS_SYSMENU, NULL);
    probeStyle("scroll", WS_OVERLAPPEDWINDOW | WS_VSCROLL | WS_HSCROLL, NULL);
    probeStyle("dialog", WS_POPUP | WS_DLGFRAME, NULL);
    probeStyle("popup", WS_POPUP | WS_BORDER, NULL);

    menu = CreateMenu();
    AppendMenu(menu, MF_STRING, 1, "&File");
    AppendMenu(menu, MF_STRING, 2, "&Edit");
    AppendMenu(menu, MF_STRING, 3, "&Help");
    probeStyle("menu", WS_OVERLAPPEDWINDOW, menu);

    probeNote("the ordinary window made inactive by another");
    first = make(WS_OVERLAPPEDWINDOW, NULL, WIDTH, HEIGHT);
    pump();
    second = CreateWindow("ProbeFrame", "Other", WS_OVERLAPPEDWINDOW, 400, 300, 160, 100, NULL,
                          NULL, instance, NULL);
    ShowWindow(second, SW_SHOWNORMAL);
    pump();
    capture("inactive", first);
    DestroyWindow(second);
    DestroyWindow(first);
    pump();

    probeNote("the standard controls, in the ordinary window");
    controls = make(WS_OVERLAPPEDWINDOW, NULL, 260, 190);
    control(controls, "BUTTON", "Push", BS_PUSHBUTTON, 8, 8, 64, 24, 10);
    control(controls, "BUTTON", "Default", BS_DEFPUSHBUTTON, 80, 8, 72, 24, 11);
    control(controls, "BUTTON", "Check", BS_CHECKBOX, 8, 40, 72, 16, 12);
    control(controls, "BUTTON", "Radio", BS_RADIOBUTTON, 88, 40, 72, 16, 13);
    control(controls, "STATIC", "Static text", SS_LEFT, 168, 40, 80, 16, 14);
    control(controls, "EDIT", "Edit", WS_BORDER | ES_LEFT, 8, 64, 100, 22, 15);
    control(controls, "LISTBOX", "", WS_BORDER | LBS_NOTIFY, 120, 64, 100, 48, 16);
    control(controls, "SCROLLBAR", "", SBS_HORZ, 8, 124, 200, 16, 17);
    SendDlgItemMessage(controls, 12, BM_SETCHECK, 1, 0L);
    SendDlgItemMessage(controls, 13, BM_SETCHECK, 1, 0L);
    SendDlgItemMessage(controls, 16, LB_ADDSTRING, 0, (LPARAM)(LPSTR) "First");
    SendDlgItemMessage(controls, 16, LB_ADDSTRING, 0, (LPARAM)(LPSTR) "Second");
    pump();
    capture("controls", controls);
    DestroyWindow(controls);
    pump();

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
