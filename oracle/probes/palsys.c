/*
 * The system palette of a 256-colour display before any program realizes a
 * palette of its own, and how a colour given as RGB becomes a pixel on it.
 * Recorded on the Super VGA 256-colour driver (`--display vga256`); SimTower
 * runs only on such a display.
 *
 * * `system`: `GetSystemPaletteEntries` of all 256, sixteen a record, as
 *   `rrggbb/ff` each (colour, flags).
 * * `nearest`: `GetNearestColor` of the screen, as `rrggbb`.
 * * `pixel`: `SetPixel` of the colour on the screen and on a memory bitmap
 *   compatible with it, then `GetPixel`, as `set=rrggbb,get=rrggbb` each.
 * * `brush`: a solid brush of the colour, `PatBlt` over 8 by 2 pixels of a
 *   memory bitmap, every pixel read back by `GetPixel` as `rrggbb`.
 *
 * The colours: the static ones, others between them, and three of the
 * driver's own entries between the static ones, `5f3f3f`, `dfdfbf` and
 * `3fff9f`.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\PALSYS.OUT"

static const COLORREF COLOURS[] = {
    RGB(0, 0, 0),       RGB(255, 255, 255), RGB(128, 128, 128), RGB(192, 192, 192),
    RGB(255, 0, 0),     RGB(128, 0, 0),     RGB(255, 255, 0),   RGB(127, 127, 127),
    RGB(64, 64, 64),    RGB(16, 32, 48),    RGB(255, 128, 0),   RGB(0, 255, 128),
    RGB(18, 52, 86),    RGB(255, 251, 240), RGB(160, 160, 164), RGB(192, 220, 192),
    RGB(166, 202, 240), RGB(200, 100, 50),  RGB(0x5f, 0x3f, 0x3f), RGB(0xdf, 0xdf, 0xbf),
    RGB(0x3f, 0xff, 0x9f),
};

static char text[400];

static void hex(LPSTR at, COLORREF colour)
{
    wsprintf(at, "%02x%02x%02x", GetRValue(colour), GetGValue(colour), GetBValue(colour));
}

static void colourArgs(COLORREF colour)
{
    hex(probeArgs, colour);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HDC screen;
    HDC memory;
    HBITMAP bitmap;
    HBITMAP before;
    PALETTEENTRY entries[256];
    UINT got;
    int i;
    int k;

    probeOpen(OUTPUT);
    ShowCursor(FALSE);
    SetCursorPos(639, 479);

    screen = GetDC(NULL);
    got = GetSystemPaletteEntries(screen, 0, 256, entries);

    for (i = 0; i < 256; i += 16) {
        LPSTR at = text;

        at += wsprintf(at, "%u:", got);

        for (k = i; k < i + 16; k++) {
            at += wsprintf(at, "%02x%02x%02x/%02x%s", entries[k].peRed, entries[k].peGreen,
                           entries[k].peBlue, entries[k].peFlags, (LPSTR)(k < i + 15 ? "," : ""));
        }

        wsprintf(probeArgs, "%d-%d", i, i + 15);
        probe("system", probeArgs, text);
    }

    memory = CreateCompatibleDC(screen);
    bitmap = CreateCompatibleBitmap(screen, 8, 2);
    before = SelectObject(memory, bitmap);

    for (i = 0; i < sizeof(COLOURS) / sizeof(COLOURS[0]); i++) {
        COLORREF colour = COLOURS[i];
        HBRUSH brush;
        HBRUSH was;
        LPSTR at;

        colourArgs(colour);
        hex(text, GetNearestColor(screen, colour));
        probe("nearest", probeArgs, text);

        at = text;
        at += wsprintf(at, "screen:set=");
        hex(at, SetPixel(screen, 600, 470, colour));
        at += 6;
        at += wsprintf(at, ",get=");
        hex(at, GetPixel(screen, 600, 470));
        at += 6;
        at += wsprintf(at, ";memory:set=");
        hex(at, SetPixel(memory, 0, 0, colour));
        at += 6;
        at += wsprintf(at, ",get=");
        hex(at, GetPixel(memory, 0, 0));
        probe("pixel", probeArgs, text);

        brush = CreateSolidBrush(colour);
        was = SelectObject(memory, brush);
        PatBlt(memory, 0, 0, 8, 2, PATCOPY);
        SelectObject(memory, was);
        DeleteObject(brush);

        at = text;

        for (k = 0; k < 16; k++) {
            hex(at, GetPixel(memory, k % 8, k / 8));
            at += 6;
            *at++ = k < 15 ? ',' : '\0';
        }

        probe("brush", probeArgs, text);
    }

    SelectObject(memory, before);
    DeleteObject(bitmap);
    DeleteDC(memory);
    ReleaseDC(NULL, screen);
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
