/*
 * Run-length encoded DIBs, `BI_RLE8` and `BI_RLE4`, set into bitmaps and
 * drawn on the screen: `SetDIBits`, `SetDIBitsToDevice` and
 * `StretchDIBits`, which hand them to the display driver's routines of run
 * lengths (`VGA.DRV` export 501, seg9 `12ec`; `SVGA256.DRV` seg9 `15ac`).
 * Recorded on each display (`per-display.mjs`).
 *
 * The colour table is the sixteen colours of the display in order, so each
 * pixel's value is its digit. Each stream exercises some of the format:
 * runs, the escapes -- end of line, end of bitmap, a delta -- absolute runs
 * of odd lengths with their padding, the two colours of a run of four bits,
 * lines left short, runs past the bitmap's right edge, lines past its top.
 *
 * Each case draws into a bitmap of the display's format, sixteen by eight,
 * filled with digit 4 first, or into a pop-up window 32 by 16, white; and
 * records:
 *
 * * `answer`: what the call answered.
 * * `rows`: the pixels as digits, `/` between rows; `leftover` for a
 *   stretch through GDI's own bitmap of the DIB's size where the stream
 *   leaves pixels unset, which are as that bitmap's memory was.
 */

#include "probe.h"

#include <string.h>

#define OUTPUT "C:\\ORACLE\\RLEDIB.OUT"

#define WIDE 16
#define HIGH 8
#define WINDOW_WIDE 32
#define WINDOW_HIGH 16

static const char HEX[] = "0123456789abcdef";

static const COLORREF PALETTE[16] = {
    RGB(0, 0, 0),       RGB(128, 0, 0),     RGB(0, 128, 0),   RGB(128, 128, 0),
    RGB(0, 0, 128),     RGB(128, 0, 128),   RGB(0, 128, 128), RGB(192, 192, 192),
    RGB(128, 128, 128), RGB(255, 0, 0),     RGB(0, 255, 0),   RGB(255, 255, 0),
    RGB(0, 0, 255),     RGB(255, 0, 255),   RGB(0, 255, 255), RGB(255, 255, 255),
};

typedef struct {
    BITMAPINFOHEADER header;
    RGBQUAD colours[16];
} INFO;

static INFO info;

/* Eight bits: a run of 16 of digit L + 1 on each line L, to the end. */
static BYTE basic8[] = {
    16, 1, 0, 0, 16, 2, 0, 0, 16, 3, 0, 0, 16, 4, 0, 0,
    16, 5, 0, 0, 16, 6, 0, 0, 16, 7, 0, 0, 16, 8, 0, 1,
};

/* Four lines of the same, for a DIB four high. */
static BYTE small8[] = {16, 1, 0, 0, 16, 2, 0, 0, 16, 3, 0, 0, 16, 5, 0, 1};

/* Lines left short, deltas, and the bitmap ended early. */
static BYTE partial8[] = {
    5, 0x0a, 0, 0,  /* line 0: five of a */
    0, 2, 3, 1,     /* to line 2, column 3 */
    4, 0x0b,        /* four of b */
    0, 2, 2, 0,     /* on two, to column 9 */
    2, 0x0c,        /* two of c */
    0, 0,           /* line 3 */
    0, 2, 0, 2,     /* to line 5, column 0 */
    1, 0x0d, 0, 1,  /* one of d, and the end */
};

/* Absolute runs of three, five and four, an empty line, and a run. */
static BYTE absolute8[] = {
    0, 3, 1, 2, 3, 0,       /* three, padded */
    0, 5, 4, 5, 6, 7, 8, 0, /* five, padded */
    3, 9,                   /* three of 9 */
    0, 4, 10, 11, 12, 13,   /* four */
    0, 0,                   /* line 1, empty */
    0, 0,                   /* line 2 */
    16, 0x0e, 0, 1,
};

/* Past the right edge: a run of 20, and an absolute run from column 14. */
static BYTE right8[] = {
    16, 1, 0, 0, 16, 2, 0, 0,
    20, 0x0c, 0, 0,
    14, 3, 0, 4, 9, 10, 11, 12, 0, 0,
    16, 5, 0, 1,
};

/* Ten lines into eight. */
static BYTE past8[] = {
    16, 1, 0, 0, 16, 2, 0, 0, 16, 3, 0, 0, 16, 4, 0, 0,  16, 5, 0, 0,
    16, 6, 0, 0, 16, 7, 0, 0, 16, 8, 0, 0, 16, 9, 0, 0,  8, 10, 0, 1,
};

/* Four bits: each line's run its own digit twice. */
static BYTE basic4[] = {
    16, 0x11, 0, 0, 16, 0x22, 0, 0, 16, 0x33, 0, 0, 16, 0x44, 0, 0,
    16, 0x55, 0, 0, 16, 0x66, 0, 0, 16, 0x77, 0, 0, 16, 0x88, 0, 1,
};

/* The two digits of a run, from even and odd columns; absolute runs of
 * three, five and four digits, and one from an odd column. */
static BYTE nibbles4[] = {
    7, 0x9c, 0, 0,                         /* line 0 */
    0, 2, 1, 0, 5, 0x3a, 0, 2, 1, 0, 4, 0x5b, 0, 0, /* line 1 */
    0, 3, 0x12, 0x30,                      /* line 2: three */
    0, 5, 0x45, 0x67, 0x80, 0,             /* five, padded */
    0, 4, 0xab, 0xcd, 0, 0,                /* four */
    0, 2, 3, 0, 0, 3, 0xef, 0x10, 0, 1,    /* line 3, from column 3 */
};

/* Past the right edge in four bits. */
static BYTE right4[] = {
    20, 0x9a, 0, 0,
    13, 0x55, 0, 6, 0x12, 0x34, 0x56, 0, 0, 1,
};

static HDC screen;
static HDC target;
static HBITMAP canvas;
static HBITMAP mono;
static HBITMAP large;
static char rows[800];
static HINSTANCE instance;
static int wide = WIDE;
static int high = HIGH;
static LPCSTR rowsName = "rows";

static char digit(COLORREF colour)
{
    int index;

    for (index = 0; index < 16; index++) {
        if (PALETTE[index] == (colour & 0xffffffL)) {
            return HEX[index];
        }
    }

    return '?';
}

static void header(int width, int height, int depth, DWORD size)
{
    memset(&info.header, 0, sizeof(info.header));
    info.header.biSize = sizeof(BITMAPINFOHEADER);
    info.header.biWidth = width;
    info.header.biHeight = height;
    info.header.biPlanes = 1;
    info.header.biBitCount = depth;
    info.header.biCompression = depth == 8 ? BI_RLE8 : BI_RLE4;
    info.header.biSizeImage = size;
    info.header.biClrUsed = 16;
}

static void fill(COLORREF colour)
{
    RECT all;
    HBRUSH brush = CreateSolidBrush(colour);

    all.left = 0;
    all.top = 0;
    all.right = wide;
    all.bottom = high;
    FillRect(target, &all, brush);
    DeleteObject(brush);
}

static void record(LPCSTR name, int answer)
{
    LPSTR out = rows;
    int x;
    int y;

    wsprintf(probeResult, "%d", answer);
    probe("answer", name, probeResult);

    for (y = 0; y < high; y++) {
        if (y) {
            *out++ = '/';
        }

        for (x = 0; x < wide; x++) {
            *out++ = digit(GetPixel(target, x, y));
        }
    }

    *out = '\0';
    probe(rowsName, name, rows);
}

/* `SetDIBits` into the bitmap sixteen by eight, filled with digit 4. */
static void set(LPCSTR name, BYTE *bits, int size, int height, int depth, int start, int lines)
{
    header(WIDE, height, depth, size);
    fill(PALETTE[4]);
    record(name, SetDIBits(target, canvas, start, lines, bits, (BITMAPINFO FAR *)&info,
                           DIB_RGB_COLORS));
}

/* The same into a monochrome bitmap, filled white. */
static void setMono(LPCSTR name, BYTE *bits, int size, int depth)
{
    HBITMAP old = SelectObject(target, mono);

    header(WIDE, HIGH, depth, size);
    fill(PALETTE[15]);
    record(name, SetDIBits(target, mono, 0, HIGH, bits, (BITMAPINFO FAR *)&info, DIB_RGB_COLORS));
    SelectObject(target, old);
}

/* `StretchDIBits` into a bitmap 32 by 16, filled with digit 4. */
static void stretchMemory(LPCSTR name, BYTE *bits, int size, int depth, int x, int y, int dw,
                          int dh, int xSrc, int ySrc, int sw, int sh)
{
    HBITMAP old = SelectObject(target, large);

    wide = WINDOW_WIDE;
    high = WINDOW_HIGH;
    header(WIDE, HIGH, depth, size);
    fill(PALETTE[4]);
    SetStretchBltMode(target, COLORONCOLOR);
    record(name, StretchDIBits(target, x, y, dw, dh, xSrc, ySrc, sw, sh, bits,
                               (BITMAPINFO FAR *)&info, DIB_RGB_COLORS, SRCCOPY));
    SelectObject(target, old);
    wide = WIDE;
    high = HIGH;
}

/* On a pop-up window 32 by 16 at the screen's corner, white: by
 * `SetDIBitsToDevice`, or by `StretchDIBits` where `sw` is not nought. */
static void onWindow(LPCSTR name, BYTE *bits, int size, int height, int depth, int x, int y,
                     int cx, int cy, int xSrc, int ySrc, int start, int lines, int sw, int sh)
{
    HDC saved = target;
    HWND window = CreateWindow("RleDib", "", WS_POPUP | WS_VISIBLE, 0, 0, WINDOW_WIDE,
                               WINDOW_HIGH, NULL, NULL, instance, NULL);
    MSG msg;
    int answer;

    UpdateWindow(window);
    while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
        DispatchMessage(&msg);
    }

    target = GetDC(window);
    wide = WINDOW_WIDE;
    high = WINDOW_HIGH;
    fill(PALETTE[15]);
    header(WIDE, height, depth, size);

    if (sw) {
        SetStretchBltMode(target, COLORONCOLOR);
        answer = StretchDIBits(target, x, y, cx, cy, xSrc, ySrc, sw, sh, bits,
                               (BITMAPINFO FAR *)&info, DIB_RGB_COLORS, SRCCOPY);
    } else {
        answer = SetDIBitsToDevice(target, x, y, cx, cy, xSrc, ySrc, start, lines, bits,
                                   (BITMAPINFO FAR *)&info, DIB_RGB_COLORS);
    }

    record(name, answer);
    ReleaseDC(window, target);
    target = saved;
    wide = WIDE;
    high = HIGH;
    DestroyWindow(window);
}

int PASCAL WinMain(HINSTANCE self, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    int index;
    int colours;

    instance = self;
    probeOpen(OUTPUT);

    memset(&kind, 0, sizeof(kind));
    kind.lpfnWndProc = DefWindowProc;
    kind.hInstance = instance;
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszClassName = "RleDib";
    RegisterClass(&kind);

    screen = GetDC(NULL);
    colours = GetDeviceCaps(screen, BITSPIXEL) * GetDeviceCaps(screen, PLANES);
    target = CreateCompatibleDC(screen);
    canvas = CreateCompatibleBitmap(screen, WIDE, HIGH);
    large = CreateCompatibleBitmap(screen, WINDOW_WIDE, WINDOW_HIGH);
    mono = CreateBitmap(WIDE, HIGH, 1, 1, NULL);
    SelectObject(target, canvas);

    for (index = 0; index < 16; index++) {
        info.colours[index].rgbRed = GetRValue(PALETTE[index]);
        info.colours[index].rgbGreen = GetGValue(PALETTE[index]);
        info.colours[index].rgbBlue = GetBValue(PALETTE[index]);
        info.colours[index].rgbReserved = 0;
    }

    set("basic8", basic8, sizeof(basic8), HIGH, 8, 0, HIGH);
    set("partial8", partial8, sizeof(partial8), HIGH, 8, 0, HIGH);
    set("absolute8", absolute8, sizeof(absolute8), HIGH, 8, 0, HIGH);
    set("right8", right8, sizeof(right8), HIGH, 8, 0, HIGH);
    set("start8", small8, sizeof(small8), HIGH, 8, 2, 3);
    set("small8", small8, sizeof(small8), 4, 8, 0, 4);
    set("basic4", basic4, sizeof(basic4), HIGH, 4, 0, HIGH);
    set("nibbles4", nibbles4, sizeof(nibbles4), HIGH, 4, 0, HIGH);
    set("right4", right4, sizeof(right4), HIGH, 4, 0, HIGH);

    /* Lines past the top: the VGA's driver addresses before the bits
     * (`VGA.DRV` seg9 `1586`, unclipped), so only the 256-colour one. */
    if (colours == 8) {
        set("past8", past8, sizeof(past8), HIGH, 8, 0, HIGH);
    }

    setMono("mono8", partial8, sizeof(partial8), 8);
    setMono("mono4", nibbles4, sizeof(nibbles4), 4);

    onWindow("window-partial8", partial8, sizeof(partial8), HIGH, 8, 2, 2, 16, 8, 0, 0, 0, 8, 0,
             0);
    onWindow("window-right8", right8, sizeof(right8), HIGH, 8, 2, 2, 16, 8, 0, 0, 0, 8, 0, 0);
    onWindow("window-nibbles4", nibbles4, sizeof(nibbles4), HIGH, 4, 2, 2, 16, 8, 0, 0, 0, 8, 0,
             0);
    onWindow("window-right4", right4, sizeof(right4), HIGH, 4, 2, 2, 16, 8, 0, 0, 0, 8, 0, 0);
    onWindow("window-part8", basic8, sizeof(basic8), HIGH, 8, 2, 2, 8, 4, 4, 2, 0, 8, 0, 0);
    onWindow("window-lines8", basic8, sizeof(basic8), HIGH, 8, 2, 2, 16, 8, 0, 0, 2, 3, 0, 0);
    onWindow("window-edge8", basic8, sizeof(basic8), HIGH, 8, 24, 10, 16, 8, 0, 0, 0, 8, 0, 0);
    onWindow("window-past8", past8, sizeof(past8), HIGH, 8, 2, 4, 16, 8, 0, 0, 0, 8, 0, 0);
    onWindow("window-small8", small8, sizeof(small8), 4, 8, 2, 2, 16, 4, 0, 0, 0, 4, 0, 0);

    onWindow("stretch-same8", partial8, sizeof(partial8), HIGH, 8, 2, 2, 16, 8, 0, 0, 0, 0, 16,
             8);
    rowsName = "leftover";
    onWindow("stretch-grow4", nibbles4, sizeof(nibbles4), HIGH, 4, 0, 0, 32, 16, 0, 0, 0, 0, 16,
             8);
    rowsName = "rows";
    onWindow("stretch-part8", basic8, sizeof(basic8), HIGH, 8, 1, 1, 16, 8, 4, 2, 8, 4, 8, 4);
    rowsName = "leftover";
    stretchMemory("memory-same8", partial8, sizeof(partial8), 8, 2, 2, 16, 8, 0, 0, 16, 8);
    stretchMemory("memory-grow4", nibbles4, sizeof(nibbles4), 4, 0, 0, 32, 16, 0, 0, 16, 8);
    stretchMemory("memory-right8", right8, sizeof(right8), 8, 2, 2, 16, 8, 0, 0, 16, 8);
    rowsName = "rows";

    DeleteDC(target);
    DeleteObject(canvas);
    DeleteObject(large);
    DeleteObject(mono);
    ReleaseDC(NULL, screen);

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
