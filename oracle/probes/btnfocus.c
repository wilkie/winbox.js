/*
 * The focus on a button: a push button, a check box and a radio button
 * given the focus in turn, as Caribbean Treasure's installer shows its
 * first button focused.
 *
 * A pop-up at (40, 40), 220 by 120, without a border, holds the three
 * buttons, made active.
 *
 * * `screen`: every pixel of the pop-up, a row a record, a palette digit a
 *   pixel as `menus` writes them, with the focus on each button in turn.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\BTNFOCUS.OUT"

#define LEFT   40
#define TOP    40
#define WIDTH  220
#define HEIGHT 120

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

static void capture(LPCSTR name)
{
    HDC screen = GetDC(NULL);
    int x;
    int y;

    for (y = TOP; y < TOP + HEIGHT; y++) {
        LPSTR at = probeResult;

        for (x = LEFT; x < LEFT + WIDTH; x++) {
            *at++ = digit(GetPixel(screen, x, y));
        }

        *at = '\0';
        wsprintf(probeArgs, "%s,y=%d", name, y - TOP);
        probe("screen", probeArgs, probeResult);
    }

    ReleaseDC(NULL, screen);
}

static void pump(void)
{
    MSG message;

    while (PeekMessage(&message, NULL, 0, 0, PM_REMOVE)) {
        TranslateMessage(&message);
        DispatchMessage(&message);
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HWND host;
    HWND controls[4];

    probeOpen(OUTPUT);
    ShowCursor(FALSE);
    SetCursorPos(639, 479);

    kind.style = 0;
    kind.lpfnWndProc = DefWindowProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "BtnFocus";
    RegisterClass(&kind);

    host = CreateWindow("BtnFocus", "", WS_POPUP | WS_VISIBLE, LEFT, TOP, WIDTH, HEIGHT, NULL, NULL,
                        instance, NULL);
    controls[0] = CreateWindow("BUTTON", "Push", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON, 10, 10,
                               100, 24, host, (HMENU)100, instance, NULL);
    controls[1] = CreateWindow("BUTTON", "Check", WS_CHILD | WS_VISIBLE | BS_CHECKBOX, 10, 42,
                               100, 16, host, (HMENU)101, instance, NULL);
    controls[2] = CreateWindow("BUTTON", "Radio", WS_CHILD | WS_VISIBLE | BS_RADIOBUTTON, 10, 64,
                               100, 16, host, (HMENU)102, instance, NULL);
    controls[3] = NULL;
    SetActiveWindow(host);
    UpdateWindow(host);
    pump();

    SetFocus(controls[0]);
    pump();
    capture("push");
    SetFocus(controls[1]);
    pump();
    capture("check");
    SetFocus(controls[2]);
    pump();
    capture("radio");

    DestroyWindow(host);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
