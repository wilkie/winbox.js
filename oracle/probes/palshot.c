/*
 * The twenty static colours of the 256-colour display, as the screen shows
 * them: one swatch each, filling the screen, for the recorder to take
 * (`record.mjs palshot --display vga256 --shoot ready:3`). What a screenshot
 * holds for a colour is the display's DAC, which need not be the palette's
 * entry -- winbox.js's comparison of screens reads them through this.
 *
 * * `entry`: each static index and its entry, as `GetSystemPaletteEntries`
 *   answers it, `rrggbb`, and the swatch's place: column and row of a grid
 *   of five by four, each 128 by 120, from the left and top.
 * * `ready`: the swatches are painted.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\PALSHOT.OUT"

/* Each record closed into the file at once, for the recorder to see while
 * the swatches are up, as `launch` does. */
static void record(LPCSTR function, LPCSTR args, LPCSTR result)
{
    probe(function, args, result);
    _lclose(probeHandle);
    probeHandle = _lopen(OUTPUT, OF_WRITE);
    _llseek(probeHandle, 0, 2);
}

static const int STATICS[20] = { 0,   1,   2,   3,   4,   5,   6,   7,   8,   9,
                                 246, 247, 248, 249, 250, 251, 252, 253, 254, 255 };

static PALETTEENTRY entries[256];

static void paint(HDC dc)
{
    int k;

    for (k = 0; k < 20; k++) {
        PALETTEENTRY e = entries[STATICS[k]];
        HBRUSH brush = CreateSolidBrush(RGB(e.peRed, e.peGreen, e.peBlue));
        RECT r;

        r.left = (k % 5) * 128;
        r.top = (k / 5) * 120;
        r.right = r.left + 128;
        r.bottom = r.top + 120;
        FillRect(dc, &r, brush);
        DeleteObject(brush);
    }
}

static LRESULT CALLBACK Proc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_PAINT) {
        PAINTSTRUCT ps;
        HDC dc = BeginPaint(window, &ps);

        paint(dc);
        EndPaint(window, &ps);
        return 0;
    }

    return DefWindowProc(window, message, wParam, lParam);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HWND window;
    HDC screen;
    MSG msg;
    DWORD until;
    int k;

    probeOpen(OUTPUT);
    ShowCursor(FALSE);
    SetCursorPos(639, 479);

    screen = GetDC(NULL);
    GetSystemPaletteEntries(screen, 0, 256, entries);
    ReleaseDC(NULL, screen);

    for (k = 0; k < 20; k++) {
        PALETTEENTRY e = entries[STATICS[k]];

        wsprintf(probeArgs, "%d", STATICS[k]);
        wsprintf(probeResult, "%02x%02x%02x,%d,%d", e.peRed, e.peGreen, e.peBlue, k % 5, k / 5);
        record("entry", probeArgs, probeResult);
    }

    kind.style = 0;
    kind.lpfnWndProc = Proc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = NULL;
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "PalShot";
    RegisterClass(&kind);

    window = CreateWindow("PalShot", "", WS_POPUP | WS_VISIBLE, 0, 0, 640, 480, NULL, NULL,
                          instance, NULL);
    UpdateWindow(window);
    record("ready", "swatches", "yes");

    /* Up while the screen is taken. */
    until = GetTickCount() + 30000;

    while (GetTickCount() < until) {
        if (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
            DispatchMessage(&msg);
        }
    }

    DestroyWindow(window);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
