/*
 * How long `WinGBitBlt` takes when the bitmap's colours are not the system
 * palette's one for one -- WinG's slow path, which translates every pixel --
 * set against `wingcost`, whose bitmap's colours are. Under the recorder's
 * DOSBox on the 256-colour display with WinG installed. SimTower's colour
 * table, as winbox.js realizes it, is never the system palette's.
 *
 * Set up as `wingcost` is -- a bitmap of 640 by 480, bottom-up, the halftone
 * palette selected and realized in a window over the whole screen -- but
 * the bitmap's colour table the halftone palette's backwards.
 *
 * Each call is made in a batch, batch after batch, until at least two
 * seconds by `GetTickCount` have passed, three times over:
 *
 * * `rate`: `cpurate`'s `alu` workload in the same run, as instructions a
 *   millisecond, the passes and the milliseconds.
 * * `cost`: `WinGBitBlt` from the bitmap to the window of 16 by 16, 64 by
 *   64, 160 by 120, 320 by 240 and 640 by 480, as nanoseconds a call, the
 *   calls and the milliseconds.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\WINGXLAT.OUT"

typedef HDC(FAR PASCAL *WG_CREATEDC)(void);
typedef HBITMAP(FAR PASCAL *WG_CREATEBITMAP)(HDC, BITMAPINFO FAR *, void FAR *FAR *);
typedef HPALETTE(FAR PASCAL *WG_HALFTONEPALETTE)(void);
typedef BOOL(FAR PASCAL *WG_BITBLT)(HDC, int, int, int, int, HDC, int, int);

static WG_CREATEDC createDC;
static WG_CREATEBITMAP createBitmap;
static WG_HALFTONEPALETTE halftonePalette;
static WG_BITBLT bitBlt;

static struct {
    BITMAPINFOHEADER header;
    RGBQUAD colours[256];
} info;

static HDC wingDC;
static HDC windowDC;
static int blitWidth;
static int blitHeight;

static void passAlu(void)
{
    _asm {
        mov cx, 65535
        mov bx, 3
        mov dx, 5
    top:
        add ax, bx
        sub ax, cx
        xor ax, dx
        and ax, bx
        or ax, cx
        shl ax, 1
        inc ax
        dec ax
        loop top
    }
}

static void rate(void)
{
    int run;

    for (run = 1; run <= 3; run++) {
        DWORD start = GetTickCount();
        DWORD elapsed;
        long passes = 0;

        do {
            passAlu();
            passes++;
            elapsed = GetTickCount() - start;
        } while (elapsed < 2000);

        wsprintf(probeArgs, "alu,%d", run);
        wsprintf(probeResult, "%ld,%ld,%ld", (long)((passes * 65535L * 9L) / (long)elapsed),
                 passes, (long)elapsed);
        probe("rate", probeArgs, probeResult);
    }
}

static void batchBitBlt(int batch)
{
    int i;

    for (i = 0; i < batch; i++) {
        bitBlt(windowDC, 0, 0, blitWidth, blitHeight, wingDC, 0, 0);
    }
}

static void cost(LPCSTR name, void (*pass)(int), int batch)
{
    int run;

    for (run = 1; run <= 3; run++) {
        DWORD start = GetTickCount();
        DWORD elapsed;
        long calls = 0;

        do {
            pass(batch);
            calls += batch;
            elapsed = GetTickCount() - start;
        } while (elapsed < 2000);

        wsprintf(probeArgs, "%s,%d", name, run);
        wsprintf(probeResult, "%ld,%ld,%ld", (long)((elapsed * 1000000L) / calls), calls,
                 (long)elapsed);
        probe("cost", probeArgs, probeResult);
    }
}

static void blits(void)
{
    static const int SIZES[][2] = { { 16, 16 }, { 64, 64 }, { 160, 120 }, { 320, 240 }, { 640, 480 } };
    int k;

    for (k = 0; k < sizeof(SIZES) / sizeof(SIZES[0]); k++) {
        char name[40];

        blitWidth = SIZES[k][0];
        blitHeight = SIZES[k][1];
        wsprintf(name, "WinGBitBlt/%dx%d", blitWidth, blitHeight);
        cost(name, batchBitBlt, k < 2 ? 100 : 10);
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HINSTANCE wing;
    WNDCLASS kind;
    HWND window;
    HPALETTE palette;
    PALETTEENTRY entries[256];
    void FAR *bits = NULL;
    HBITMAP bitmap;
    int k;

    probeOpen(OUTPUT);
    ShowCursor(FALSE);
    SetCursorPos(639, 479);

    wing = LoadLibrary("WING.DLL");

    if (wing < HINSTANCE_ERROR) {
        wsprintf(probeResult, "%d", (int)wing);
        probe("load", "WING.DLL", probeResult);
        probeFinish();
        return 0;
    }

    createDC = (WG_CREATEDC)GetProcAddress(wing, MAKEINTRESOURCE(1001));
    createBitmap = (WG_CREATEBITMAP)GetProcAddress(wing, MAKEINTRESOURCE(1003));
    halftonePalette = (WG_HALFTONEPALETTE)GetProcAddress(wing, MAKEINTRESOURCE(1007));
    bitBlt = (WG_BITBLT)GetProcAddress(wing, MAKEINTRESOURCE(1010));

    kind.style = 0;
    kind.lpfnWndProc = DefWindowProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = GetStockObject(BLACK_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "WinGXlat";
    RegisterClass(&kind);

    window = CreateWindow("WinGXlat", "", WS_POPUP | WS_VISIBLE, 0, 0, 640, 480, NULL, NULL,
                          instance, NULL);
    UpdateWindow(window);
    windowDC = GetDC(window);

    /* The halftone palette, realized, and the bitmap's colours it backwards. */
    palette = halftonePalette();
    GetPaletteEntries(palette, 0, 256, entries);
    SelectPalette(windowDC, palette, FALSE);
    RealizePalette(windowDC);

    _fmemset(&info, 0, sizeof(info));
    info.header.biSize = sizeof(BITMAPINFOHEADER);
    info.header.biWidth = 640;
    info.header.biHeight = 480;
    info.header.biPlanes = 1;
    info.header.biBitCount = 8;
    info.header.biCompression = BI_RGB;
    info.header.biClrUsed = 256;

    for (k = 0; k < 256; k++) {
        info.colours[k].rgbRed = entries[255 - k].peRed;
        info.colours[k].rgbGreen = entries[255 - k].peGreen;
        info.colours[k].rgbBlue = entries[255 - k].peBlue;
    }

    wingDC = createDC();
    bitmap = createBitmap(wingDC, (BITMAPINFO FAR *)&info, &bits);
    SelectObject(wingDC, bitmap);

    rate();
    blits();
    rate();

    DeleteDC(wingDC);
    DeleteObject(bitmap);
    ReleaseDC(window, windowDC);
    DestroyWindow(window);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
