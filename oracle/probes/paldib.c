/*
 * Device-independent bitmaps drawn with a logical palette realized, on the
 * 256-colour display (`--display vga256`), as SimTower draws its pictures:
 * it realizes its palette and draws with `SetDIBitsToDevice` and WinG.
 *
 * A pop-up at (0, 0), 64 by 64, shown and active, with `A` selected and
 * realized in the foreground: 123456, 654321, 5f3f3f, 133557 and aabbcc.
 *
 * * `system`: `GetSystemPaletteEntries` 8 to 15 after realizing.
 * * `dib`: a DIB of 8 bits, 5 by 1, each pixel the next index, drawn by
 *   `SetDIBitsToDevice` at (0, row) -- with `DIB_RGB_COLORS` and a table of
 *   123456, 133557 (not in A), 5f3f3f, 808080 and 112233 (not in A); and
 *   with `DIB_PAL_COLORS` and indices 0, 1, 2, 3, 9 (past A) into A -- then
 *   `GetPixel` of each, `rrggbb`.
 * * `wing`: a WinG bitmap of 16 by 1, `WinGBitBlt` to the window: with the
 *   system palette's own 256 colours as its table (an identity palette),
 *   indices 10 to 14; and with A's colours at indices 100 to 104 of an
 *   otherwise black table, indices 100 to 104. `GetPixel` of each.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\PALDIB.OUT"

typedef HDC(FAR PASCAL *WG_CREATEDC)(void);
typedef HBITMAP(FAR PASCAL *WG_CREATEBITMAP)(HDC, BITMAPINFO FAR *, void FAR *FAR *);
typedef BOOL(FAR PASCAL *WG_BITBLT)(HDC, int, int, int, int, HDC, int, int);

static struct {
    BITMAPINFOHEADER header;
    RGBQUAD colours[256];
} info;

static void hex(LPSTR at, COLORREF colour)
{
    wsprintf(at, "%02x%02x%02x", GetRValue(colour), GetGValue(colour), GetBValue(colour));
}

static void row(LPCSTR name, HDC dc, int y, int count)
{
    LPSTR at = probeResult;
    int x;

    for (x = 0; x < count; x++) {
        hex(at, GetPixel(dc, x, y));
        at += 6;
        *at++ = x < count - 1 ? ',' : '\0';
    }

    probe("dib", name, probeResult);
}

static void header(int width, int used)
{
    _fmemset(&info, 0, sizeof(info));
    info.header.biSize = sizeof(BITMAPINFOHEADER);
    info.header.biWidth = width;
    info.header.biHeight = 1;
    info.header.biPlanes = 1;
    info.header.biBitCount = 8;
    info.header.biCompression = BI_RGB;
    info.header.biClrUsed = used;
}

static void colour(int index, BYTE red, BYTE green, BYTE blue)
{
    info.colours[index].rgbRed = red;
    info.colours[index].rgbGreen = green;
    info.colours[index].rgbBlue = blue;
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static struct {
        WORD version;
        WORD count;
        PALETTEENTRY entries[5];
    } logical = { 0x300, 5,
                  { { 0x12, 0x34, 0x56, 0 },
                    { 0x65, 0x43, 0x21, 0 },
                    { 0x5f, 0x3f, 0x3f, 0 },
                    { 0x13, 0x35, 0x57, 0 },
                    { 0xaa, 0xbb, 0xcc, 0 } } };
    static BYTE pixels[16] = { 0, 1, 2, 3, 4 };
    WNDCLASS kind;
    HWND window;
    HDC dc;
    HPALETTE palette;
    HPALETTE before;
    PALETTEENTRY system[256];
    LPSTR at;
    int i;

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
    kind.hbrBackground = GetStockObject(BLACK_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "PalDib";
    RegisterClass(&kind);

    window = CreateWindow("PalDib", "", WS_POPUP | WS_VISIBLE, 0, 0, 64, 64, NULL, NULL, instance,
                          NULL);
    UpdateWindow(window);

    palette = CreatePalette((LOGPALETTE FAR *)&logical);
    dc = GetDC(window);
    before = SelectPalette(dc, palette, FALSE);
    RealizePalette(dc);

    GetSystemPaletteEntries(dc, 0, 256, system);
    at = probeResult;

    for (i = 8; i < 16; i++) {
        at += wsprintf(at, "%02x%02x%02x%s", system[i].peRed, system[i].peGreen, system[i].peBlue,
                       (LPSTR)(i < 15 ? "," : ""));
    }

    probe("system", "8-15", probeResult);

    /* RGB colours. */
    header(5, 5);
    colour(0, 0x12, 0x34, 0x56);
    colour(1, 0x13, 0x35, 0x57);
    colour(2, 0x5f, 0x3f, 0x3f);
    colour(3, 0x80, 0x80, 0x80);
    colour(4, 0x11, 0x22, 0x33);
    SetDIBitsToDevice(dc, 0, 0, 5, 1, 0, 0, 0, 1, pixels, (BITMAPINFO FAR *)&info, DIB_RGB_COLORS);
    row("rgb", dc, 0, 5);

    /* Palette indices. */
    header(5, 5);
    {
        WORD FAR *indices = (WORD FAR *)info.colours;

        indices[0] = 0;
        indices[1] = 1;
        indices[2] = 2;
        indices[3] = 3;
        indices[4] = 9;
    }
    SetDIBitsToDevice(dc, 0, 1, 5, 1, 0, 0, 0, 1, pixels, (BITMAPINFO FAR *)&info, DIB_PAL_COLORS);
    row("pal", dc, 1, 5);

    /* WinG, with an identity palette and without. */
    {
        HINSTANCE wing = LoadLibrary("WING.DLL");

        if (wing >= HINSTANCE_ERROR) {
            WG_CREATEDC createDC = (WG_CREATEDC)GetProcAddress(wing, MAKEINTRESOURCE(1001));
            WG_CREATEBITMAP createBitmap =
                (WG_CREATEBITMAP)GetProcAddress(wing, MAKEINTRESOURCE(1003));
            WG_BITBLT bitBlt = (WG_BITBLT)GetProcAddress(wing, MAKEINTRESOURCE(1010));
            HDC wingDC = createDC();
            BYTE huge *bits = NULL;
            HBITMAP bitmap;
            HBITMAP first;

            header(16, 256);
            info.header.biHeight = -1;

            for (i = 0; i < 256; i++) {
                colour(i, system[i].peRed, system[i].peGreen, system[i].peBlue);
            }

            bitmap = createBitmap(wingDC, (BITMAPINFO FAR *)&info, (void FAR *FAR *)&bits);

            for (i = 0; i < 5; i++) {
                bits[i] = (BYTE)(10 + i);
            }

            first = SelectObject(wingDC, bitmap);
            bitBlt(dc, 0, 2, 16, 1, wingDC, 0, 0);
            row("wing-identity", dc, 2, 5);
            SelectObject(wingDC, first);
            DeleteObject(bitmap);

            header(16, 256);
            info.header.biHeight = -1;

            for (i = 0; i < 5; i++) {
                colour(100 + i, logical.entries[i].peRed, logical.entries[i].peGreen,
                       logical.entries[i].peBlue);
            }

            bitmap = createBitmap(wingDC, (BITMAPINFO FAR *)&info, (void FAR *FAR *)&bits);

            for (i = 0; i < 5; i++) {
                bits[i] = (BYTE)(100 + i);
            }

            first = SelectObject(wingDC, bitmap);
            bitBlt(dc, 0, 3, 16, 1, wingDC, 0, 0);
            row("wing-other", dc, 3, 5);
            SelectObject(wingDC, first);
            DeleteObject(bitmap);
            DeleteDC(wingDC);
            FreeLibrary(wing);
        }
    }

    SelectPalette(dc, before, FALSE);
    ReleaseDC(window, dc);
    DestroyWindow(window);
    DeleteObject(palette);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
