/*
 * A wallpaper of more than eight bits a pixel, as the screen shows it.
 *
 * USER loads a wallpaper's file itself (`USER.EXE` seg21 `0131`): it reads
 * the header whatever its bit count, makes a bitmap of the screen's with
 * `CreateCompatibleBitmap` and sets its bits with `SetDIBits`, and on a
 * display with a palette makes a palette first (seg21 `0000`) -- of 256
 * colours, a cube, for 24 bits or more. This probe sets a wallpaper of 16,
 * 24 and 32 bits a pixel with `SystemParametersInfo`, tiled, and reads the
 * screen back with `GetPixel`, as `deskwall` does.
 *
 * Each bitmap is 8 by 8, a row a colour: black, white, dark red (one of the
 * VGA's), a dark grey and a light grey (neither of them), orange, a blue
 * and a green (neither). 16 bits are five of red, green and blue each.
 *
 * * `dibits`: what `SetDIBits` answers for the bitmap at each bit count,
 *   set into a bitmap of the screen's that was white, and that bitmap's
 *   pixel at the bottom left, the green row (pixel=colour).
 * * `set`: what `SPI_SETDESKWALLPAPER` answered. The screen is not read
 *   for 16 or 32 bits: `SetDIBits` sets nothing there, and the bitmap shows
 *   what the memory it was given held -- for 32 bits, after 24, the 24
 *   bits' bitmap just let go of; for 16, not the same from one run to the
 *   next.
 * * `pixels`: the desktop's top left, 16 by 8, a row a record, one
 *   character a pixel: the sixteen colours of the VGA's palette as hex
 *   digits, and any other colour as a letter from `g` on, in the order
 *   first seen, each listed at the end as `colours`.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\DESKDEEP.OUT"

static const char HEX[] = "0123456789abcdef";

static const COLORREF PALETTE[16] = {
    RGB(0, 0, 0),       RGB(128, 0, 0),     RGB(0, 128, 0),   RGB(128, 128, 0),
    RGB(0, 0, 128),     RGB(128, 0, 128),   RGB(0, 128, 128), RGB(192, 192, 192),
    RGB(128, 128, 128), RGB(255, 0, 0),     RGB(0, 255, 0),   RGB(255, 255, 0),
    RGB(0, 0, 255),     RGB(255, 0, 255),   RGB(0, 255, 255), RGB(255, 255, 255),
};

/* A row's colour, red, green and blue. */
static const BYTE ROWS[8][3] = {
    {0, 0, 0},     {255, 255, 255}, {128, 0, 0},  {64, 64, 64},
    {160, 160, 160}, {255, 128, 0},   {0, 0, 200}, {100, 200, 50},
};

/* The colours outside the palette, as first seen. */
static COLORREF others[40];
static int otherCount;

static char digit(COLORREF colour)
{
    int index;

    colour &= 0xffffffL;

    for (index = 0; index < 16; index++) {
        if (PALETTE[index] == colour) {
            return HEX[index];
        }
    }

    for (index = 0; index < otherCount; index++) {
        if (others[index] == colour) {
            return (char)('g' + index);
        }
    }

    if (otherCount < 40) {
        others[otherCount++] = colour;
        return (char)('g' + otherCount - 1);
    }

    return '?';
}

static void corner(LPCSTR step)
{
    HDC screen = GetDC(NULL);
    int x;
    int y;

    for (y = 0; y < 8; y++) {
        LPSTR at = probeResult;

        for (x = 0; x < 16; x++) {
            *at++ = digit(GetPixel(screen, x, y));
        }

        *at = '\0';
        wsprintf(probeArgs, "%s,y=%d", (LPSTR)step, y);
        probe("pixels", probeArgs, probeResult);
    }

    ReleaseDC(NULL, screen);
}

static BYTE bits[8 * 32];

/* An 8 by 8 bitmap of the rows' colours, at a bit count, in `bits`, and
 * as a file where there is a path. */
static void writeBitmap(LPCSTR path, int count)
{
    BITMAPFILEHEADER file;
    BITMAPINFOHEADER info;
    int stride = ((8 * count + 31) / 32) * 4;
    HFILE handle;
    int x;
    int y;

    for (y = 0; y < 8; y++) {
        /* Bottom row first. */
        BYTE *at = bits + (7 - y) * stride;
        BYTE red = ROWS[y][0];
        BYTE green = ROWS[y][1];
        BYTE blue = ROWS[y][2];

        for (x = 0; x < 8; x++) {
            if (count == 16) {
                UINT value = ((UINT)(red >> 3) << 10) | ((UINT)(green >> 3) << 5) | (blue >> 3);

                *at++ = (BYTE)value;
                *at++ = (BYTE)(value >> 8);
            } else {
                *at++ = blue;
                *at++ = green;
                *at++ = red;

                if (count == 32) {
                    *at++ = 0;
                }
            }
        }
    }

    if (path == NULL) {
        return;
    }

    handle = _lcreat(path, 0);
    file.bfType = 0x4d42;
    file.bfOffBits = sizeof(file) + sizeof(info);
    file.bfSize = file.bfOffBits + (DWORD)stride * 8;
    file.bfReserved1 = 0;
    file.bfReserved2 = 0;

    info.biSize = sizeof(info);
    info.biWidth = 8;
    info.biHeight = 8;
    info.biPlanes = 1;
    info.biBitCount = count;
    info.biCompression = BI_RGB;
    info.biSizeImage = 0;
    info.biXPelsPerMeter = 0;
    info.biYPelsPerMeter = 0;
    info.biClrUsed = 0;
    info.biClrImportant = 0;

    _lwrite(handle, (LPCSTR)&file, sizeof(file));
    _lwrite(handle, (LPCSTR)&info, sizeof(info));
    _lwrite(handle, (LPCSTR)bits, stride * 8);
    _lclose(handle);
}

/* What `SetDIBits` answers for the bitmap at a bit count, set into a
 * bitmap of the screen's, and the bitmap's bottom left pixel read back, with
 * the colour it was cleared to before: white. */
static void dibits(LPCSTR step, int count)
{
    struct {
        BITMAPINFOHEADER header;
        RGBQUAD colours[2];
    } info;
    HDC screen = GetDC(NULL);
    HDC memory = CreateCompatibleDC(screen);
    HBITMAP bitmap = CreateCompatibleBitmap(screen, 8, 8);
    HBITMAP old = SelectObject(memory, bitmap);
    int answer;
    COLORREF pixel;

    PatBlt(memory, 0, 0, 8, 8, WHITENESS);
    SelectObject(memory, old);
    writeBitmap(NULL, count);
    info.header.biSize = sizeof(info.header);
    info.header.biWidth = 8;
    info.header.biHeight = 8;
    info.header.biPlanes = 1;
    info.header.biBitCount = count;
    info.header.biCompression = BI_RGB;
    info.header.biSizeImage = 0;
    info.header.biXPelsPerMeter = 0;
    info.header.biYPelsPerMeter = 0;
    info.header.biClrUsed = 0;
    info.header.biClrImportant = 0;
    answer = SetDIBits(screen, bitmap, 0, 8, bits, (BITMAPINFO FAR *)&info, DIB_RGB_COLORS);
    old = SelectObject(memory, bitmap);
    pixel = GetPixel(memory, 0, 7);
    SelectObject(memory, old);
    wsprintf(probeResult, "answer=%d,pixel=%06lx", answer, pixel);
    probe("dibits", step, probeResult);
    DeleteObject(bitmap);
    DeleteDC(memory);
    ReleaseDC(NULL, screen);
}

static void wallpaper(LPCSTR step, LPCSTR path, BOOL read)
{
    char one[16];
    BOOL done;
    MSG message;

    done = SystemParametersInfo(SPI_SETDESKWALLPAPER, 0, (LPVOID)path, 0);

    while (PeekMessage(&message, NULL, 0, 0, PM_REMOVE)) {
        TranslateMessage(&message);
        DispatchMessage(&message);
    }

    wsprintf(one, "%d", done);
    probe("set", step, one);

    if (read) {
        corner(step);
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    char list[400];
    int k;

    probeOpen(OUTPUT);

    ShowCursor(FALSE);
    SetCursorPos(639, 479);
    WriteProfileString("Desktop", "TileWallpaper", "1");
    WriteProfileString("Desktop", "WallpaperOriginX", NULL);
    WriteProfileString("Desktop", "WallpaperOriginY", NULL);

    writeBitmap("C:\\ORACLE\\DEEP16.BMP", 16);
    writeBitmap("C:\\ORACLE\\DEEP24.BMP", 24);
    writeBitmap("C:\\ORACLE\\DEEP32.BMP", 32);

    dibits("16", 16);
    dibits("24", 24);
    dibits("32", 32);

    wallpaper("16", "C:\\ORACLE\\DEEP16.BMP", FALSE);
    wallpaper("24", "C:\\ORACLE\\DEEP24.BMP", TRUE);
    wallpaper("32", "C:\\ORACLE\\DEEP32.BMP", FALSE);
    wallpaper("none", "(None)", TRUE);

    list[0] = '\0';

    for (k = 0; k < otherCount; k++) {
        char one[12];

        wsprintf(one, "%c=%06lx,", 'g' + k, others[k]);
        lstrcat(list, one);
    }

    probe("colours", "", list);
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
