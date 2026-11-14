/*
 * A common context given back with a palette of the program's selected:
 * `ReleaseDC` sets its state back with `SetDCState`, the palette the stock
 * one again, and on a palette device realizes the stock palette where it
 * is not the one realized last (`GDI.EXE` seg1 `074f`-`075e`, seg22
 * `1088`-`10fa`). What a program sees of it after: what `RealizePalette`
 * answers, realizing its palette again in a context got again, and the
 * system palette's entries. Recorded on the 256-colour display.
 *
 * W is an overlapped window 200 by 100 at (40, 40); P a palette of eight
 * colours none of the static twenty has.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\PALREL.OUT"

static HWND w;
static HPALETTE p;

static void answer(LPCSTR function, LPCSTR what, long value)
{
    wsprintf(probeResult, "%ld", value);
    probe(function, what, probeResult);
}

/* The system palette's entries 10 to 17, as hex. */
static void system(LPCSTR function)
{
    PALETTEENTRY entries[8];
    HDC screen = GetDC(NULL);
    LPSTR at = probeResult;
    int i;

    GetSystemPaletteEntries(screen, 10, 8, entries);
    ReleaseDC(NULL, screen);

    for (i = 0; i < 8; i++) {
        at += wsprintf(at, "%s%02x%02x%02x", (LPSTR)(i ? " " : ""), entries[i].peRed,
                       entries[i].peGreen, entries[i].peBlue);
    }

    probe(function, "system palette 10-17", probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    struct {
        WORD version;
        WORD count;
        PALETTEENTRY entries[8];
    } logical;
    HDC dc;
    HPALETTE old;
    int i;

    probeOpen(OUTPUT);

    kind.style = 0;
    kind.lpfnWndProc = DefWindowProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "PalRel";
    RegisterClass(&kind);

    w = CreateWindow("PalRel", "W", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 40, 40, 200, 100, NULL, NULL,
                     instance, NULL);
    UpdateWindow(w);

    logical.version = 0x300;
    logical.count = 8;

    for (i = 0; i < 8; i++) {
        logical.entries[i].peRed = (BYTE)(17 + i * 29);
        logical.entries[i].peGreen = (BYTE)(201 - i * 23);
        logical.entries[i].peBlue = (BYTE)(55 + i * 11);
        logical.entries[i].peFlags = 0;
    }

    p = CreatePalette((LOGPALETTE FAR *)&logical);
    system("start");

    dc = GetDC(w);
    old = SelectPalette(dc, p, FALSE);
    probe("first", "SelectPalette answers the stock palette",
          old == GetStockObject(DEFAULT_PALETTE) ? "yes" : "no");
    answer("first", "RealizePalette", (long)RealizePalette(dc));
    answer("first", "RealizePalette again", (long)RealizePalette(dc));
    ReleaseDC(w, dc);
    system("first");

    dc = GetDC(w);
    old = SelectPalette(dc, p, FALSE);
    probe("again", "SelectPalette answers the stock palette",
          old == GetStockObject(DEFAULT_PALETTE) ? "yes" : "no");
    answer("again", "RealizePalette", (long)RealizePalette(dc));
    SelectPalette(dc, old, FALSE);
    answer("again", "RealizePalette of the stock palette", (long)RealizePalette(dc));
    SelectPalette(dc, p, FALSE);
    answer("again", "RealizePalette after the stock one", (long)RealizePalette(dc));
    ReleaseDC(w, dc);
    system("again");

    dc = GetDC(w);
    SelectPalette(dc, p, TRUE);
    answer("background", "RealizePalette", (long)RealizePalette(dc));
    ReleaseDC(w, dc);
    system("background");

    DestroyWindow(w);
    DeleteObject(p);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
