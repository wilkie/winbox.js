/*
 * Realizing a logical palette on the 256-colour display, as SimTower does
 * with the palette it draws its pictures in. Recorded with `--display
 * vga256`.
 *
 * A pop-up at (0, 0), 64 by 64, shown and active. Its palette `A` has eight
 * entries: a static colour (`ff0000`), one of the driver's own (`5f3f3f`),
 * four new colours, one of them twice, and two `PC_RESERVED`; `B` has four
 * new colours of its own.
 *
 * * `realize`: what `RealizePalette` answers: A in the foreground; A again;
 *   B selected into a second device context of the window in the
 *   background; A after `UnrealizeObject`.
 * * `system`: `GetSystemPaletteEntries` 0 to 31 after each, eight a record,
 *   `rrggbb/ff`.
 * * `pixel`: with A selected and realized, `SetPixel` then `GetPixel` of the
 *   window for `PALETTEINDEX(n)`, `PALETTERGB` of a new colour of A's, and
 *   `RGB` of the same and of one near it; `GetNearestColor` of each.
 * * `animate`: `AnimatePalette` of A's reserved entries to two other
 *   colours: the answer, then the system palette's 10 to 17, and
 *   `GetPixel` of a pixel drawn in the first reserved entry before.
 * * `message`: the palette messages the window's procedure was sent, in
 *   order, as their numbers.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\PALREAL.OUT"

static char messages[256];

static HPALETTE make(int count, const PALETTEENTRY *entries)
{
    static struct {
        WORD version;
        WORD count;
        PALETTEENTRY entries[16];
    } logical;
    int i;

    logical.version = 0x300;
    logical.count = count;

    for (i = 0; i < count; i++) {
        logical.entries[i] = entries[i];
    }

    return CreatePalette((LOGPALETTE FAR *)&logical);
}

LRESULT FAR PASCAL _export WindowProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_PALETTECHANGED || message == WM_QUERYNEWPALETTE ||
        message == WM_PALETTEISCHANGING || message == WM_SYSCOLORCHANGE) {
        wsprintf(messages + lstrlen(messages), "%x,", message);
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

static void system(LPCSTR when, HDC dc)
{
    PALETTEENTRY entries[32];
    int i;
    int k;

    GetSystemPaletteEntries(dc, 0, 32, entries);

    for (i = 0; i < 32; i += 8) {
        LPSTR at = probeResult;

        for (k = i; k < i + 8; k++) {
            at += wsprintf(at, "%02x%02x%02x/%02x%s", entries[k].peRed, entries[k].peGreen,
                           entries[k].peBlue, entries[k].peFlags, (LPSTR)(k < i + 7 ? "," : ""));
        }

        wsprintf(probeArgs, "%s,%d-%d", when, i, i + 7);
        probe("system", probeArgs, probeResult);
    }
}

static void hex(LPSTR at, COLORREF colour)
{
    wsprintf(at, "%02x%02x%02x", GetRValue(colour), GetGValue(colour), GetBValue(colour));
}

static void pixel(LPCSTR name, HDC dc, COLORREF colour)
{
    LPSTR at;

    SetPixel(dc, 5, 5, colour);
    at = probeResult;
    at += wsprintf(at, "get=");
    hex(at, GetPixel(dc, 5, 5));
    at += 6;
    at += wsprintf(at, ",nearest=");
    hex(at, GetNearestColor(dc, colour));
    probe("pixel", name, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static const PALETTEENTRY A[8] = {
        { 0xff, 0x00, 0x00, 0 },  { 0x5f, 0x3f, 0x3f, 0 }, { 0x12, 0x34, 0x56, 0 },
        { 0x65, 0x43, 0x21, 0 },  { 0x12, 0x34, 0x56, 0 }, { 0xaa, 0xbb, 0xcc, PC_NOCOLLAPSE },
        { 0x11, 0x22, 0x33, PC_RESERVED }, { 0x44, 0x55, 0x66, PC_RESERVED },
    };
    static const PALETTEENTRY B[4] = {
        { 0x01, 0x02, 0x03, 0 }, { 0x04, 0x05, 0x06, 0 }, { 0x07, 0x08, 0x09, 0 },
        { 0x0a, 0x0b, 0x0c, 0 },
    };
    PALETTEENTRY to[2] = { { 0x99, 0x88, 0x77, PC_RESERVED }, { 0x66, 0x55, 0x44, PC_RESERVED } };
    WNDCLASS kind;
    HWND window;
    HDC dc;
    HDC second;
    HPALETTE a;
    HPALETTE b;
    HPALETTE before;
    HPALETTE secondBefore;
    int i;

    probeOpen(OUTPUT);
    ShowCursor(FALSE);
    SetCursorPos(639, 479);

    kind.style = 0;
    kind.lpfnWndProc = WindowProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = GetStockObject(BLACK_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "PalReal";
    RegisterClass(&kind);

    window = CreateWindow("PalReal", "", WS_POPUP | WS_VISIBLE, 0, 0, 64, 64, NULL, NULL, instance,
                          NULL);
    UpdateWindow(window);
    pump();
    messages[0] = '\0';

    a = make(8, A);
    b = make(4, B);
    dc = GetDC(window);

    before = SelectPalette(dc, a, FALSE);
    wsprintf(probeResult, "%u", RealizePalette(dc));
    probe("realize", "A,foreground", probeResult);
    pump();
    system("A", dc);

    for (i = 0; i < 9; i++) {
        wsprintf(probeArgs, "index-%d", i);
        pixel(probeArgs, dc, PALETTEINDEX(i));
    }

    pixel("paletteRGB-123456", dc, PALETTERGB(0x12, 0x34, 0x56));
    pixel("rgb-123456", dc, RGB(0x12, 0x34, 0x56));
    pixel("rgb-133557", dc, RGB(0x13, 0x35, 0x57));
    pixel("rgb-5f3f3f", dc, RGB(0x5f, 0x3f, 0x3f));

    wsprintf(probeResult, "%u", RealizePalette(dc));
    probe("realize", "A,again", probeResult);

    second = GetDC(window);
    secondBefore = SelectPalette(second, b, TRUE);
    wsprintf(probeResult, "%u", RealizePalette(second));
    probe("realize", "B,background", probeResult);
    pump();
    system("B", dc);
    SelectPalette(second, secondBefore, TRUE);
    ReleaseDC(window, second);

    /* The first reserved entry drawn, then animated. */
    SetPixel(dc, 7, 7, PALETTEINDEX(6));
    AnimatePalette(a, 6, 2, to);
    probe("animate", "answer", "done");
    pump();
    system("animated", dc);
    hex(probeResult, GetPixel(dc, 7, 7));
    probe("animate", "pixel", probeResult);

    UnrealizeObject(a);
    wsprintf(probeResult, "%u", RealizePalette(dc));
    probe("realize", "A,unrealized", probeResult);
    pump();

    SelectPalette(dc, before, FALSE);
    ReleaseDC(window, dc);
    probe("message", "palette", messages[0] ? messages : "none");

    DestroyWindow(window);
    DeleteObject(a);
    DeleteObject(b);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
