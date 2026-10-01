/*
 * Which character is underlined when a text has more than one `&`, as
 * FIBS/W's About box has a button `&I &A&gr&e&e`, which Windows shows with
 * only its last "e" underlined.
 *
 * A pop-up at (40, 40), 220 by 120, without a border, holds a push button
 * of FIBS/W's text, a check box `a&b&c` and static text `x&y&z`; and
 * `DrawText` draws `&p&q&r` into the pop-up below them.
 *
 * * `screen`: every pixel of the pop-up, a row a record, a palette digit a
 *   pixel as `menus` writes them.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\MULTIPFX.OUT"

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
    HDC hdc;
    RECT area;

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
    kind.lpszClassName = "MultiPfx";
    RegisterClass(&kind);

    host = CreateWindow("MultiPfx", "", WS_POPUP | WS_VISIBLE, LEFT, TOP, WIDTH, HEIGHT, NULL,
                        NULL, instance, NULL);
    CreateWindow("BUTTON", "&I &A&gr&e&e", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON, 10, 10, 100, 24,
                 host, (HMENU)100, instance, NULL);
    CreateWindow("BUTTON", "a&b&c", WS_CHILD | WS_VISIBLE | BS_CHECKBOX, 10, 42, 100, 16, host,
                 (HMENU)101, instance, NULL);
    CreateWindow("STATIC", "x&y&z", WS_CHILD | WS_VISIBLE | SS_LEFT, 10, 64, 100, 16, host,
                 (HMENU)102, instance, NULL);
    UpdateWindow(host);
    pump();

    hdc = GetDC(host);
    area.left = 10;
    area.top = 88;
    area.right = 110;
    area.bottom = 108;
    DrawText(hdc, "&p&q&r", -1, &area, DT_LEFT | DT_TOP | DT_SINGLELINE);
    ReleaseDC(host, hdc);

    capture("shown");

    DestroyWindow(host);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
