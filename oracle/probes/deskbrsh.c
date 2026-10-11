/*
 * The desktop's brush of its colour alone, as Windows starts and as it is
 * made again, beside a program's own brush of the same colour.
 *
 * `deskwall` found the desktop dithered in `COLOR_BACKGROUND` as Windows
 * starts on the EGA and the Hercules, and solid in the nearest colour once
 * `SPI_SETDESKPATTERN` has made its brush again with "(None)" -- though
 * both brushes are `CreateSolidBrush` of the same colour (`USER.EXE` seg3
 * `084f`, seg41 `0ba6`). This asks which brush is not as it seems.
 *
 * Each step writes the desktop's top left, 16 by 4 (`desk`), and 16 by 4
 * filled with `FillRect` on the screen's device context with a brush of
 * `COLOR_BACKGROUND`'s colour made then (`own`), at (32, 0); one hex digit
 * a pixel, as `chrome` writes them.
 *
 * * `start`: as Windows starts.
 * * `redrawn`: the desktop drawn again with `RedrawWindow`, `RDW_ERASE`,
 *   `RDW_INVALIDATE` and `RDW_ERASENOW`, its brush as it was.
 * * `syscolors`: `SetSysColors` with `COLOR_BACKGROUND` as it is, which
 *   makes its brush again with `CreateSolidBrush` (seg41 `0ccd`).
 * * `pattern`: `SPI_SETDESKPATTERN` with "(None)".
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\DESKBRSH.OUT"

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

static void pump(void)
{
    MSG message;
    int count = 0;

    while (count < 200 && PeekMessage(&message, NULL, 0, 0, PM_REMOVE)) {
        TranslateMessage(&message);
        DispatchMessage(&message);
        count++;
    }
}

static void region(LPCSTR step, LPCSTR name, int left)
{
    HDC screen = GetDC(NULL);
    int x;
    int y;

    for (y = 0; y < 4; y++) {
        LPSTR at = probeResult;

        for (x = left; x < left + 16; x++) {
            *at++ = digit(GetPixel(screen, x, y));
        }

        *at = '\0';
        wsprintf(probeArgs, "%s,%s,y=%d", (LPSTR)step, (LPSTR)name, y);
        probe("pixels", probeArgs, probeResult);
    }

    ReleaseDC(NULL, screen);
}

static void step(LPCSTR name)
{
    HDC screen;
    HBRUSH brush;
    RECT r;

    pump();
    region(name, "desk", 0);

    screen = GetDC(NULL);
    brush = CreateSolidBrush(GetSysColor(COLOR_BACKGROUND));
    SetRect(&r, 32, 0, 48, 4);
    FillRect(screen, &r, brush);
    DeleteObject(brush);
    ReleaseDC(NULL, screen);
    region(name, "own", 32);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    int which = COLOR_BACKGROUND;
    COLORREF colour;

    probeOpen(OUTPUT);
    ShowCursor(FALSE);
    SetCursorPos(639, 479);

    wsprintf(probeResult, "%06lx", GetSysColor(COLOR_BACKGROUND));
    probe("background", "", probeResult);
    step("start");

    RedrawWindow(GetDesktopWindow(), NULL, NULL, RDW_ERASE | RDW_INVALIDATE | RDW_ERASENOW);
    step("redrawn");

    colour = GetSysColor(COLOR_BACKGROUND);
    SetSysColors(1, &which, &colour);
    step("syscolors");

    SystemParametersInfo(SPI_SETDESKPATTERN, 0, (LPVOID) "(None)", 0);
    step("pattern");

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
