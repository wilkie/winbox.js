/*
 * Palettes on a display with fixed colours: what the palette calls answer,
 * and what a colour given as a palette index draws as.
 *
 * * `caps`: `RC_PALETTE`, `SIZEPALETTE`, `NUMRESERVED`, `COLORRES`.
 * * `answer`: what a call answered, a handle as `pal`, `default` (the stock
 *   palette) or `other`.
 * * `entries`: palette entries read back, as `rrggbb/ff` each (colour, flags).
 *   A palette made larger is read back only as far as it was: the entries it
 *   gains are whatever memory held.
 * * `pixel`: the colour a pixel came out, drawn in a colour given as
 *   `PALETTEINDEX` or `PALETTERGB`, into a memory bitmap compatible with the
 *   screen.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\PALETTE.OUT"

static HPALETTE made;
static HPALETTE stock;
static char text[256];

static LPCSTR which(HANDLE handle)
{
    if (!handle) {
        return "0";
    }

    if (handle == made) {
        return "pal";
    }

    if (handle == stock) {
        return "default";
    }

    return "other";
}

static void answer(LPCSTR what, LONG value)
{
    wsprintf(probeResult, "%ld", value);
    probe("answer", what, probeResult);
}

static void entries(LPCSTR what, HPALETTE palette, int start, int count)
{
    PALETTEENTRY list[24];
    UINT got;
    UINT index;
    char one[16];

    for (index = 0; index < 24; index++) {
        list[index].peRed = 0x11;
        list[index].peGreen = 0x22;
        list[index].peBlue = 0x33;
        list[index].peFlags = 0x44;
    }

    got = GetPaletteEntries(palette, start, count, list);
    wsprintf(text, "%u:", got);

    for (index = 0; index < (UINT)count && index < 24; index++) {
        wsprintf(one, "%s%02x%02x%02x/%02x", (LPSTR)(index ? "," : ""), list[index].peRed,
                 list[index].peGreen, list[index].peBlue, list[index].peFlags);
        lstrcat(text, one);
    }

    probe("entries", what, text);
}

static void pixel(LPCSTR what, HDC dc, COLORREF colour)
{
    HBRUSH brush;
    RECT all;

    SetPixel(dc, 0, 0, colour);
    brush = CreateSolidBrush(colour);
    all.left = 1;
    all.top = 0;
    all.right = 9;
    all.bottom = 8;
    FillRect(dc, &all, brush);
    DeleteObject(brush);
    wsprintf(probeResult, "set=%06lx,brush=%06lx", GetPixel(dc, 0, 0) & 0xffffffL,
             GetPixel(dc, 1, 0) & 0xffffffL);
    probe("pixel", what, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HDC screen;
    HDC memory;
    HBITMAP bitmap;
    HGLOBAL block;
    LOGPALETTE FAR *logical;
    PALETTEENTRY entry;
    PALETTEENTRY system[20];
    HPALETTE before;
    WORD count;
    int index;
    char one[16];

    probeOpen(OUTPUT);
    screen = GetDC(NULL);

    wsprintf(probeResult, "palette=%d,size=%d,reserved=%d,res=%d",
             (GetDeviceCaps(screen, RASTERCAPS) & RC_PALETTE) ? 1 : 0,
             GetDeviceCaps(screen, SIZEPALETTE), GetDeviceCaps(screen, NUMRESERVED),
             GetDeviceCaps(screen, COLORRES));
    probe("caps", "screen", probeResult);

    /* The stock palette. */
    stock = GetStockObject(DEFAULT_PALETTE);
    count = 0;
    answer("default-getobject", GetObject(stock, sizeof(count), &count));
    answer("default-count", count);
    entries("default", stock, 0, 20);

    /* A palette of four. */
    block = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT,
                        sizeof(LOGPALETTE) + 4 * sizeof(PALETTEENTRY));
    logical = (LOGPALETTE FAR *)GlobalLock(block);
    logical->palVersion = 0x300;
    logical->palNumEntries = 4;
    logical->palPalEntry[0].peRed = 255;
    logical->palPalEntry[1].peGreen = 255;
    logical->palPalEntry[2].peBlue = 255;
    logical->palPalEntry[2].peFlags = PC_RESERVED;
    logical->palPalEntry[3].peRed = 128;
    logical->palPalEntry[3].peGreen = 128;
    logical->palPalEntry[3].peBlue = 128;
    logical->palPalEntry[3].peFlags = PC_NOCOLLAPSE;
    made = CreatePalette(logical);
    GlobalUnlock(block);
    GlobalFree(block);
    probe("answer", "create", which(made));

    count = 0;
    answer("getobject", GetObject(made, sizeof(count), &count));
    answer("count", count);
    entries("made", made, 0, 4);
    entries("made-past", made, 2, 6);
    entry.peRed = 1;
    entry.peGreen = 2;
    entry.peBlue = 3;
    entry.peFlags = PC_EXPLICIT;
    answer("set", SetPaletteEntries(made, 1, 1, &entry));
    answer("set-past", SetPaletteEntries(made, 3, 4, &entry));
    entries("after-set", made, 0, 4);
    answer("nearest-red", GetNearestPaletteIndex(made, RGB(250, 10, 10)));
    answer("nearest-grey", GetNearestPaletteIndex(made, RGB(120, 130, 125)));
    answer("nearest-black", GetNearestPaletteIndex(made, RGB(0, 0, 0)));
    answer("resize", ResizePalette(made, 6));
    count = 0;
    GetObject(made, sizeof(count), &count);
    answer("count-resized", count);
    entries("resized", made, 0, 4);

    /* Selected and realized, in the screen and in a memory context. */
    before = SelectPalette(screen, made, FALSE);
    probe("answer", "select-screen", which(before));
    answer("realize-screen", RealizePalette(screen));
    probe("answer", "select-back", which(SelectPalette(screen, before, FALSE)));

    memory = CreateCompatibleDC(screen);
    bitmap = CreateCompatibleBitmap(screen, 16, 8);
    SelectObject(memory, bitmap);
    PatBlt(memory, 0, 0, 16, 8, WHITENESS);
    before = SelectPalette(memory, made, FALSE);
    probe("answer", "select-memory", which(before));
    answer("realize-memory", RealizePalette(memory));

    for (index = 0; index < 4; index++) {
        wsprintf(one, "index-%d", index);
        pixel(one, memory, PALETTEINDEX(index));
    }

    pixel("index-9", memory, PALETTEINDEX(9));
    pixel("rgb-red", memory, PALETTERGB(255, 0, 0));
    pixel("rgb-grey", memory, PALETTERGB(120, 130, 125));
    pixel("plain-grey", memory, RGB(120, 130, 125));
    SelectPalette(memory, before, FALSE);
    pixel("index-1-default", memory, PALETTEINDEX(1));

    /* The system palette. */
    for (index = 0; index < 20; index++) {
        system[index].peRed = 0x11;
        system[index].peGreen = 0x22;
        system[index].peBlue = 0x33;
        system[index].peFlags = 0x44;
    }

    wsprintf(text, "%u:", GetSystemPaletteEntries(screen, 0, 20, system));

    for (index = 0; index < 20; index++) {
        wsprintf(one, "%s%02x%02x%02x/%02x", (LPSTR)(index ? "," : ""), system[index].peRed,
                 system[index].peGreen, system[index].peBlue, system[index].peFlags);
        lstrcat(text, one);
    }

    probe("entries", "system", text);
    answer("system-use", GetSystemPaletteUse(screen));
    answer("set-system-use", SetSystemPaletteUse(screen, SYSPAL_NOSTATIC));
    answer("system-use-after", GetSystemPaletteUse(screen));
    SetSystemPaletteUse(screen, SYSPAL_STATIC);
    answer("unrealize", UnrealizeObject(made));
    answer("delete", DeleteObject(made));

    DeleteDC(memory);
    DeleteObject(bitmap);
    ReleaseDC(NULL, screen);
    probeFinish();

    return 0;
}
