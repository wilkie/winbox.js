/*
 * How long WinG's calls take, and GDI's into a WinG device context, under
 * the recorder's DOSBox (`cycles=max`) on the 256-colour display with WinG
 * installed (`install-wing.mjs`), set against how fast it runs a program's
 * own instructions -- `callcost`'s measure for the calls SimTower makes most.
 * Timings, not answers: they vary with the host and from run to run, and are
 * kept in `fixtures/timings/`, not replayed.
 *
 * Set up as WinG asks a program to: a bitmap of 640 by 480, bottom-up, its
 * colour table WinG's halftone palette's, and that palette selected and
 * realized in a window over the whole screen, so the bitmap's colours are
 * the system palette's, one for one.
 *
 * Each call is made in a batch, batch after batch, until at least two
 * seconds by `GetTickCount` have passed, three times over:
 *
 * * `rate`: `cpurate`'s `alu` workload in the same run, as instructions a
 *   millisecond, the passes and the milliseconds.
 * * `cost`: the call, as nanoseconds a call, the calls and the
 *   milliseconds. The batch's own loop is in it, a few instructions a call.
 *
 * The calls: `WinGBitBlt` from the bitmap to the window of 16 by 16, 64 by
 * 64, 160 by 120, 320 by 240 and 640 by 480; `WinGStretchBlt` of 160 by 120
 * to 320 by 240; `WinGSetDIBColorTable` of 256 entries and of 16; and into
 * the WinG device context, `SelectObject` of a pen and back, `MoveTo` and
 * `LineTo` of 10 pixels, `Rectangle` of 10 by 10, `GetNearestColor`, and
 * `SaveDC` and `RestoreDC`.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\WINGCOST.OUT"

typedef HDC(FAR PASCAL *WG_CREATEDC)(void);
typedef HBITMAP(FAR PASCAL *WG_CREATEBITMAP)(HDC, BITMAPINFO FAR *, void FAR *FAR *);
typedef UINT(FAR PASCAL *WG_COLORTABLE)(HDC, UINT, UINT, RGBQUAD FAR *);
typedef HPALETTE(FAR PASCAL *WG_HALFTONEPALETTE)(void);
typedef BOOL(FAR PASCAL *WG_STRETCHBLT)(HDC, int, int, int, int, HDC, int, int, int, int);
typedef BOOL(FAR PASCAL *WG_BITBLT)(HDC, int, int, int, int, HDC, int, int);

static WG_CREATEDC createDC;
static WG_CREATEBITMAP createBitmap;
static WG_COLORTABLE setColorTable;
static WG_HALFTONEPALETTE halftonePalette;
static WG_STRETCHBLT stretchBlt;
static WG_BITBLT bitBlt;

static struct {
    BITMAPINFOHEADER header;
    RGBQUAD colours[256];
} info;

static HDC wingDC;
static HDC windowDC;
static HPEN pen;
static int blitWidth;
static int blitHeight;
static UINT tableCount;

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

static void batchStretchBlt(int batch)
{
    int i;

    for (i = 0; i < batch; i++) {
        stretchBlt(windowDC, 0, 0, 320, 240, wingDC, 0, 0, 160, 120);
    }
}

static void batchColorTable(int batch)
{
    int i;

    for (i = 0; i < batch; i++) {
        setColorTable(wingDC, 0, tableCount, info.colours);
    }
}

static void batchSelectObject(int batch)
{
    int i;

    for (i = 0; i < batch; i++) {
        SelectObject(wingDC, SelectObject(wingDC, pen));
    }
}

static void batchLineTo(int batch)
{
    int i;

    for (i = 0; i < batch; i++) {
        MoveTo(wingDC, 20, 20);
        LineTo(wingDC, 30, 20);
    }
}

static void batchRectangle(int batch)
{
    int i;

    for (i = 0; i < batch; i++) {
        Rectangle(wingDC, 40, 40, 50, 50);
    }
}

static void batchNearestColor(int batch)
{
    int i;

    for (i = 0; i < batch; i++) {
        GetNearestColor(wingDC, RGB(i, 128, 64));
    }
}

static void batchSaveRestore(int batch)
{
    int i;

    for (i = 0; i < batch; i++) {
        RestoreDC(wingDC, SaveDC(wingDC));
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
    setColorTable = (WG_COLORTABLE)GetProcAddress(wing, MAKEINTRESOURCE(1006));
    halftonePalette = (WG_HALFTONEPALETTE)GetProcAddress(wing, MAKEINTRESOURCE(1007));
    stretchBlt = (WG_STRETCHBLT)GetProcAddress(wing, MAKEINTRESOURCE(1009));
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
    kind.lpszClassName = "WinGCost";
    RegisterClass(&kind);

    window = CreateWindow("WinGCost", "", WS_POPUP | WS_VISIBLE, 0, 0, 640, 480, NULL, NULL,
                          instance, NULL);
    UpdateWindow(window);
    windowDC = GetDC(window);

    /* The halftone palette, realized, and the bitmap's colours the same. */
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
        info.colours[k].rgbRed = entries[k].peRed;
        info.colours[k].rgbGreen = entries[k].peGreen;
        info.colours[k].rgbBlue = entries[k].peBlue;
    }

    wingDC = createDC();
    bitmap = createBitmap(wingDC, (BITMAPINFO FAR *)&info, &bits);
    SelectObject(wingDC, bitmap);
    pen = CreatePen(PS_SOLID, 1, RGB(255, 0, 0));

    rate();
    blits();
    cost("WinGStretchBlt/160x120-320x240", batchStretchBlt, 10);
    tableCount = 256;
    cost("WinGSetDIBColorTable/256", batchColorTable, 10);
    tableCount = 16;
    cost("WinGSetDIBColorTable/16", batchColorTable, 100);
    cost("SelectObject", batchSelectObject, 100);
    cost("MoveTo+LineTo", batchLineTo, 100);
    cost("Rectangle", batchRectangle, 100);
    cost("GetNearestColor", batchNearestColor, 100);
    cost("SaveDC+RestoreDC", batchSaveRestore, 100);
    rate();

    DeleteObject(pen);
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
