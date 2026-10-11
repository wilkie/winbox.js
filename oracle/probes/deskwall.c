/*
 * The desktop's pattern and its wallpaper, as the screen shows them.
 *
 * USER paints the desktop with a brush of its own (`USER.EXE` seg45
 * `[52Eh]`), made from `[Desktop]`'s `Pattern` (seg41 `0a61`), or with the
 * wallpaper's bitmap where there is one (seg21 `086e`). This probe sets
 * each with `SystemParametersInfo`, as Control Panel's Desktop does, and
 * reads the screen back with `GetPixel`.
 *
 * `M` is an overlapped window at (440, 300), 150 by 100, shown and active;
 * `I` one made minimized, its icon's title not lit. The pointer is hidden.
 * A region is written a row a record, one character a pixel: the sixteen
 * colours of the VGA's palette as the hex digits `chrome` writes, and any
 * other colour as a letter from `g` on, in the order first seen, each
 * listed after as `colours`.
 *
 * * `corner`: the desktop's top left, 32 by 16.
 * * `icon`: `I`'s icon and its title: from 24 to the left of the icon to 24
 *   to its right, from its top to 20 below it.
 * * `centre`: 40 by 20 about the middle of the screen.
 *
 * The steps, each written as `sent`, what `M` was sent meanwhile, and the
 * regions named:
 *
 * 1. `start`: as Windows starts, no pattern and no wallpaper; then
 *    `solid`, `SPI_SETDESKPATTERN` with "(None)", the brush made again.
 * 2. `pattern`: `SPI_SETDESKPATTERN` with "128 64,32x16 8 4 2 259".
 * 3. `colours`: then `SetSysColors` with `COLOR_BACKGROUND` teal and
 *    `COLOR_WINDOWTEXT` red; then put back.
 * 4. `tiled`: `SPI_SETDESKWALLPAPER` with a bitmap of sixteen colours, 13 by
 *    7, its pixel at (x, y) the colour (x + 3y) mod 16, `TileWallpaper=1`.
 * 5. `origin`: the same with `WallpaperOriginX=5` and `WallpaperOriginY=3`.
 * 6. `centred`: `TileWallpaper=0` and the origin taken away; then
 *    `placed`, with `WallpaperOriginX=7` and `WallpaperOriginY=9`.
 * 7. `mono`: a bitmap of two colours, 8 by 8, a diagonal, tiled.
 * 8. `256`: a bitmap of 256 colours, 4 by 4, sixteen greys none of the
 *    palette's, tiled.
 * 9. `none`: the wallpaper "(None)", then the pattern "(None)".
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\DESKWALL.OUT"

static HINSTANCE module;
static HWND m;
static HWND icon;
static BOOL logging;
static char events[1200];

static const char HEX[] = "0123456789abcdef";

static const COLORREF PALETTE[16] = {
    RGB(0, 0, 0),       RGB(128, 0, 0),     RGB(0, 128, 0),   RGB(128, 128, 0),
    RGB(0, 0, 128),     RGB(128, 0, 128),   RGB(0, 128, 128), RGB(192, 192, 192),
    RGB(128, 128, 128), RGB(255, 0, 0),     RGB(0, 255, 0),   RGB(255, 255, 0),
    RGB(0, 0, 255),     RGB(255, 0, 255),   RGB(0, 255, 255), RGB(255, 255, 255),
};

/* The colours outside the palette, as first seen. */
static COLORREF others[20];
static int otherCount;

static void add(LPCSTR text)
{
    if (logging && lstrlen(events) + lstrlen(text) + 2 < sizeof(events)) {
        lstrcat(events, text);
        lstrcat(events, ",");
    }
}

LONG FAR PASCAL _export Proc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    char one[16];

    if (hwnd == m && message != WM_NCHITTEST && message != WM_SETCURSOR &&
        message != WM_MOUSEMOVE) {
        wsprintf(one, "%x", message);
        add(one);
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
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

    if (otherCount < 20) {
        others[otherCount++] = colour;
        return (char)('g' + otherCount - 1);
    }

    return '?';
}

/* A region of the screen, a row a record. */
static void region(LPCSTR step, LPCSTR name, int left, int top, int right, int bottom)
{
    HDC screen = GetDC(NULL);
    int x;
    int y;

    for (y = top; y < bottom; y++) {
        LPSTR at = probeResult;

        for (x = left; x < right; x++) {
            *at++ = digit(GetPixel(screen, x, y));
        }

        *at = '\0';
        wsprintf(probeArgs, "%s,%s,y=%d", (LPSTR)step, (LPSTR)name, y);
        probe("pixels", probeArgs, probeResult);
    }

    ReleaseDC(NULL, screen);
}

static void begin(void)
{
    events[0] = '\0';
    logging = TRUE;
}

static void sent(LPCSTR step)
{
    pump();
    logging = FALSE;
    probe("sent", step, events);
}

static void corner(LPCSTR step)
{
    region(step, "corner", 0, 0, 32, 16);
}

static void iconRegion(LPCSTR step)
{
    RECT r;

    GetWindowRect(icon, &r);
    region(step, "icon", r.left - 24, r.top, r.right + 24, r.bottom + 20);
}

static void centre(LPCSTR step)
{
    int x = GetSystemMetrics(SM_CXSCREEN) / 2;
    int y = GetSystemMetrics(SM_CYSCREEN) / 2;

    region(step, "centre", x - 20, y - 10, x + 20, y + 10);
}

/* A bitmap file: its header, the colours and the bits, bottom row first. */
static void writeBitmap(LPCSTR path, int width, int height, int bits, const RGBQUAD *colours,
                        int count, const BYTE *rows)
{
    BITMAPFILEHEADER file;
    BITMAPINFOHEADER info;
    int stride = ((width * bits + 31) / 32) * 4;
    HFILE handle = _lcreat(path, 0);
    int y;

    file.bfType = 0x4d42;
    file.bfOffBits = sizeof(file) + sizeof(info) + count * sizeof(RGBQUAD);
    file.bfSize = file.bfOffBits + (DWORD)stride * height;
    file.bfReserved1 = 0;
    file.bfReserved2 = 0;

    info.biSize = sizeof(info);
    info.biWidth = width;
    info.biHeight = height;
    info.biPlanes = 1;
    info.biBitCount = bits;
    info.biCompression = BI_RGB;
    info.biSizeImage = 0;
    info.biXPelsPerMeter = 0;
    info.biYPelsPerMeter = 0;
    info.biClrUsed = 0;
    info.biClrImportant = 0;

    _lwrite(handle, (LPCSTR)&file, sizeof(file));
    _lwrite(handle, (LPCSTR)&info, sizeof(info));
    _lwrite(handle, (LPCSTR)colours, count * sizeof(RGBQUAD));

    for (y = height - 1; y >= 0; y--) {
        _lwrite(handle, (LPCSTR)(rows + y * stride), stride);
    }

    _lclose(handle);
}

static RGBQUAD colours[256];
static BYTE rows[256];

static void wallpaper(LPCSTR step, LPCSTR path)
{
    char one[16];
    BOOL done;

    begin();
    done = SystemParametersInfo(SPI_SETDESKWALLPAPER, 0, (LPVOID)path, 0);
    sent(step);
    wsprintf(one, "%d", done);
    probe("set", step, one);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    int k;
    int x;
    int y;
    COLORREF before[2];
    COLORREF after[2];
    int which[2];
    char list[200];

    probeOpen(OUTPUT);
    module = instance;

    kind.style = 0;
    kind.lpfnWndProc = Proc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = LoadIcon(NULL, IDI_APPLICATION);
    kind.hCursor = LoadCursor(NULL, IDC_ARROW);
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "DeskWall";
    RegisterClass(&kind);

    ShowCursor(FALSE);
    SetCursorPos(639, 479);

    icon = CreateWindow("DeskWall", "Icon", WS_OVERLAPPEDWINDOW, 100, 100, 200, 150, NULL, NULL,
                        module, NULL);
    ShowWindow(icon, SW_SHOWMINNOACTIVE);
    m = CreateWindow("DeskWall", "M", WS_OVERLAPPEDWINDOW, 440, 300, 150, 100, NULL, NULL, module,
                     NULL);
    ShowWindow(m, SW_SHOWNORMAL);
    UpdateWindow(m);
    pump();

    wsprintf(probeResult, "%06lx", GetSysColor(COLOR_BACKGROUND));
    probe("background", "", probeResult);
    corner("start");
    iconRegion("start");

    begin();
    SystemParametersInfo(SPI_SETDESKPATTERN, 0, (LPVOID) "(None)", 0);
    sent("solid");
    corner("solid");

    /* The pattern. */
    begin();
    SystemParametersInfo(SPI_SETDESKPATTERN, 0, (LPVOID) "128 64,32x16 8 4 2 259", 0);
    sent("pattern");
    corner("pattern");
    iconRegion("pattern");

    /* The colours it is made in. */
    which[0] = COLOR_BACKGROUND;
    which[1] = COLOR_WINDOWTEXT;
    before[0] = GetSysColor(COLOR_BACKGROUND);
    before[1] = GetSysColor(COLOR_WINDOWTEXT);
    after[0] = RGB(0, 128, 128);
    after[1] = RGB(255, 0, 0);
    begin();
    SetSysColors(2, which, after);
    sent("colours");
    corner("colours");
    iconRegion("colours");
    SetSysColors(2, which, before);
    pump();

    /* A bitmap of sixteen colours, tiled. */
    for (k = 0; k < 16; k++) {
        colours[k].rgbRed = GetRValue(PALETTE[k]);
        colours[k].rgbGreen = GetGValue(PALETTE[k]);
        colours[k].rgbBlue = GetBValue(PALETTE[k]);
        colours[k].rgbReserved = 0;
    }

    for (y = 0; y < 7; y++) {
        for (x = 0; x < 13; x++) {
            BYTE value = (BYTE)((x + 3 * y) % 16);
            BYTE *at = rows + y * 8 + x / 2;

            if (x % 2 == 0) {
                *at = (BYTE)(value << 4);
            } else {
                *at |= value;
            }
        }
    }

    writeBitmap("C:\\ORACLE\\WALL16.BMP", 13, 7, 4, colours, 16, rows);
    WriteProfileString("Desktop", "TileWallpaper", "1");
    wallpaper("tiled", "C:\\ORACLE\\WALL16.BMP");
    corner("tiled");
    iconRegion("tiled");

    WriteProfileString("Desktop", "WallpaperOriginX", "5");
    WriteProfileString("Desktop", "WallpaperOriginY", "3");
    wallpaper("origin", "C:\\ORACLE\\WALL16.BMP");
    corner("origin");

    WriteProfileString("Desktop", "TileWallpaper", "0");
    WriteProfileString("Desktop", "WallpaperOriginX", NULL);
    WriteProfileString("Desktop", "WallpaperOriginY", NULL);
    wallpaper("centred", "C:\\ORACLE\\WALL16.BMP");
    centre("centred");
    corner("centred");
    iconRegion("centred");

    WriteProfileString("Desktop", "WallpaperOriginX", "7");
    WriteProfileString("Desktop", "WallpaperOriginY", "9");
    wallpaper("placed", "C:\\ORACLE\\WALL16.BMP");
    corner("placed");

    /* Two colours. */
    WriteProfileString("Desktop", "TileWallpaper", "1");
    WriteProfileString("Desktop", "WallpaperOriginX", NULL);
    WriteProfileString("Desktop", "WallpaperOriginY", NULL);
    colours[0].rgbRed = colours[0].rgbGreen = colours[0].rgbBlue = 0;
    colours[1].rgbRed = colours[1].rgbGreen = colours[1].rgbBlue = 255;

    for (y = 0; y < 8; y++) {
        rows[y * 4] = (BYTE)(0x80 >> y);
        rows[y * 4 + 1] = rows[y * 4 + 2] = rows[y * 4 + 3] = 0;
    }

    writeBitmap("C:\\ORACLE\\WALL2.BMP", 8, 8, 1, colours, 2, rows);
    wallpaper("mono", "C:\\ORACLE\\WALL2.BMP");
    corner("mono");

    /* 256 colours, sixteen of them greys the palette does not have. */
    for (k = 0; k < 256; k++) {
        BYTE grey = (BYTE)(k < 16 ? 20 + k * 13 : 0);

        colours[k].rgbRed = colours[k].rgbGreen = colours[k].rgbBlue = grey;
        colours[k].rgbReserved = 0;
    }

    for (y = 0; y < 4; y++) {
        for (x = 0; x < 4; x++) {
            rows[y * 4 + x] = (BYTE)(y * 4 + x);
        }
    }

    writeBitmap("C:\\ORACLE\\WALL256.BMP", 4, 4, 8, colours, 256, rows);
    wallpaper("256", "C:\\ORACLE\\WALL256.BMP");
    corner("256");

    /* None. */
    wallpaper("none", "(None)");
    corner("none");
    begin();
    SystemParametersInfo(SPI_SETDESKPATTERN, 0, (LPVOID) "(None)", 0);
    sent("nopattern");
    corner("nopattern");

    list[0] = '\0';

    for (k = 0; k < otherCount; k++) {
        char one[12];

        wsprintf(one, "%c=%06lx,", 'g' + k, others[k]);
        lstrcat(list, one);
    }

    probe("colours", "", list);

    DestroyWindow(m);
    DestroyWindow(icon);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
