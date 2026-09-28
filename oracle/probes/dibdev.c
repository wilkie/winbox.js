/*
 * Device-independent bits drawn straight to a device context:
 * SetDIBitsToDevice and StretchDIBits.
 *
 * The DIB is seven by five at four bits a pixel, its colour table the
 * sixteen colours of the display in order, so each pixel's value is its
 * digit. The pixel in column x of the DIB's row y -- counted from the
 * bottom, as a DIB's rows are stored -- is (x + 3y) mod 16. Seven wide, so a
 * row is padded. A one-bit DIB and an eight-bit one come too.
 *
 * Each case draws into a sixteen by twelve bitmap of the display's format,
 * filled white first (grey for `invert`); the `window-` cases draw into a
 * pop-up window of that size at the screen's corner instead. Each records:
 *
 * * `answer`: what the call answered.
 * * `rows`: the bitmap's rows as digits, `/` between them.
 */

#include "probe.h"

#include <string.h>

#define OUTPUT "C:\\ORACLE\\DIBDEV.OUT"

#define WIDE 16
#define HIGH 12

static const char HEX[] = "0123456789abcdef";

static const COLORREF PALETTE[16] = {
    RGB(0, 0, 0),       RGB(128, 0, 0),     RGB(0, 128, 0),   RGB(128, 128, 0),
    RGB(0, 0, 128),     RGB(128, 0, 128),   RGB(0, 128, 128), RGB(192, 192, 192),
    RGB(128, 128, 128), RGB(255, 0, 0),     RGB(0, 255, 0),   RGB(255, 255, 0),
    RGB(0, 0, 255),     RGB(255, 0, 255),   RGB(0, 255, 255), RGB(255, 255, 255),
};

typedef struct {
    BITMAPINFOHEADER header;
    RGBQUAD colours[256];
} INFO;

static INFO info4;
static INFO info1;
static INFO info8;

/* Four bits: 7 pixels is 4 bytes, padded to 4. */
static BYTE bits4[5 * 4];
/* One bit: 8 by 4, a byte a row padded to 4. */
static BYTE bits1[4 * 4];
/* Eight bits: 5 by 3, 5 bytes a row padded to 8. */
static BYTE bits8[3 * 8];

static HDC screen;
static HDC target;
static HBITMAP canvas;
static char rows[400];

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

static void table(INFO *info, int count)
{
    int index;

    for (index = 0; index < count; index++) {
        COLORREF colour = PALETTE[index % 16];

        info->colours[index].rgbRed = GetRValue(colour);
        info->colours[index].rgbGreen = GetGValue(colour);
        info->colours[index].rgbBlue = GetBValue(colour);
        info->colours[index].rgbReserved = 0;
    }
}

static void header(INFO *info, int width, int height, int depth)
{
    memset(&info->header, 0, sizeof(info->header));
    info->header.biSize = sizeof(BITMAPINFOHEADER);
    info->header.biWidth = width;
    info->header.biHeight = height;
    info->header.biPlanes = 1;
    info->header.biBitCount = depth;
    info->header.biCompression = BI_RGB;
}

static void clear(int grey)
{
    RECT all;

    all.left = 0;
    all.top = 0;
    all.right = WIDE;
    all.bottom = HIGH;
    FillRect(target, &all, GetStockObject(grey ? GRAY_BRUSH : WHITE_BRUSH));
}

static void record(LPCSTR name, int answer)
{
    LPSTR out = rows;
    int x;
    int y;

    wsprintf(probeResult, "%d", answer);
    probe("answer", name, probeResult);

    for (y = 0; y < HIGH; y++) {
        if (y) {
            *out++ = '/';
        }

        for (x = 0; x < WIDE; x++) {
            *out++ = digit(GetPixel(target, x, y));
        }
    }

    *out = '\0';
    probe("rows", name, rows);
}

static HINSTANCE instance;

static void onWindow(LPCSTR name, INFO *info, LPVOID bits, int x, int y, int cx, int cy,
                     int xSrc, int ySrc, int start, int lines)
{
    HDC saved = target;
    HWND window = CreateWindow("DibDev", "", WS_POPUP | WS_VISIBLE, 0, 0, WIDE, HIGH, NULL, NULL,
                               instance, NULL);
    MSG msg;

    UpdateWindow(window);
    while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
        DispatchMessage(&msg);
    }

    target = GetDC(window);
    clear(0);
    record(name, SetDIBitsToDevice(target, x, y, cx, cy, xSrc, ySrc, start, lines, bits,
                                   (BITMAPINFO FAR *)info, DIB_RGB_COLORS));
    ReleaseDC(window, target);
    target = saved;
    DestroyWindow(window);
}

static void toDevice(LPCSTR name, INFO *info, LPVOID bits, int x, int y, int cx, int cy, int xSrc,
                     int ySrc, int start, int lines)
{
    clear(0);
    record(name, SetDIBitsToDevice(target, x, y, cx, cy, xSrc, ySrc, start, lines, bits,
                                   (BITMAPINFO FAR *)info, DIB_RGB_COLORS));
}

static void stretched(LPCSTR name, int x, int y, int dw, int dh, int xSrc, int ySrc, int sw, int sh,
                      int mode, DWORD rop)
{
    clear(rop != SRCCOPY);
    SetStretchBltMode(target, mode);
    record(name, StretchDIBits(target, x, y, dw, dh, xSrc, ySrc, sw, sh, bits4,
                               (BITMAPINFO FAR *)&info4, DIB_RGB_COLORS, rop));
}

int PASCAL WinMain(HINSTANCE self, HINSTANCE previous, LPSTR command, int show)
{
    int x;
    int y;

    WNDCLASS kind;

    instance = self;
    probeOpen(OUTPUT);

    memset(&kind, 0, sizeof(kind));
    kind.lpfnWndProc = DefWindowProc;
    kind.hInstance = instance;
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszClassName = "DibDev";
    RegisterClass(&kind);

    screen = GetDC(NULL);
    target = CreateCompatibleDC(screen);
    canvas = CreateCompatibleBitmap(screen, WIDE, HIGH);
    SelectObject(target, canvas);

    header(&info4, 7, 5, 4);
    table(&info4, 16);
    for (y = 0; y < 5; y++) {
        for (x = 0; x < 7; x++) {
            BYTE value = (BYTE)((x + 3 * y) % 16);

            bits4[y * 4 + x / 2] |= x % 2 ? value : value << 4;
        }
    }

    /* Red for 0 and blue for 1. */
    header(&info1, 8, 4, 1);
    info1.colours[0].rgbRed = 255;
    info1.colours[1].rgbBlue = 255;
    bits1[0] = 0xf0;
    bits1[4] = 0xcc;
    bits1[8] = 0xaa;
    bits1[12] = 0x81;

    /* Eight bits, the table the sixteen over again: value v is digit v mod 16. */
    header(&info8, 5, 3, 8);
    table(&info8, 256);
    for (y = 0; y < 3; y++) {
        for (x = 0; x < 5; x++) {
            bits8[y * 8 + x] = (BYTE)(x * 17 + y * 5);
        }
    }

    toDevice("whole", &info4, bits4, 1, 1, 7, 5, 0, 0, 0, 5);
    toDevice("part", &info4, bits4, 1, 1, 4, 3, 2, 1, 0, 5);
    toDevice("lines-0-2", &info4, bits4, 1, 1, 7, 5, 0, 0, 0, 2);
    toDevice("lines-2-3", &info4, bits4, 1, 1, 7, 5, 0, 0, 2, 3);
    toDevice("lines-part", &info4, bits4, 1, 1, 5, 3, 1, 1, 1, 2);
    toDevice("wide", &info4, bits4, 1, 1, 12, 9, 0, 0, 0, 5);
    toDevice("edge", &info4, bits4, 13, 9, 7, 5, 0, 0, 0, 5);
    toDevice("one-bit", &info1, bits1, 2, 2, 8, 4, 0, 0, 0, 4);
    toDevice("eight-bit", &info8, bits8, 2, 2, 5, 3, 0, 0, 0, 3);

    onWindow("window-whole", &info4, bits4, 1, 1, 7, 5, 0, 0, 0, 5);
    onWindow("window-part", &info4, bits4, 1, 1, 4, 3, 2, 1, 0, 5);
    onWindow("window-lines-0-2", &info4, bits4, 1, 1, 7, 5, 0, 0, 0, 2);
    onWindow("window-lines-2-3", &info4, bits4, 1, 1, 7, 5, 0, 0, 2, 3);
    onWindow("window-lines-part", &info4, bits4, 1, 1, 5, 3, 1, 1, 1, 2);
    onWindow("window-wide", &info4, bits4, 1, 1, 12, 9, 0, 0, 0, 5);
    onWindow("window-edge", &info4, bits4, 13, 9, 7, 5, 0, 0, 0, 5);
    onWindow("window-one-bit", &info1, bits1, 2, 2, 8, 4, 0, 0, 0, 4);
    onWindow("window-eight-bit", &info8, bits8, 2, 2, 5, 3, 0, 0, 0, 3);

    stretched("stretch-same", 1, 1, 7, 5, 0, 0, 7, 5, COLORONCOLOR, SRCCOPY);
    stretched("stretch-grow", 0, 0, 14, 10, 0, 0, 7, 5, COLORONCOLOR, SRCCOPY);
    stretched("stretch-shrink", 0, 0, 4, 3, 0, 0, 7, 5, COLORONCOLOR, SRCCOPY);
    stretched("stretch-part", 1, 1, 6, 4, 2, 1, 3, 2, COLORONCOLOR, SRCCOPY);
    stretched("stretch-mirror", 8, 1, -7, 5, 0, 0, 7, 5, COLORONCOLOR, SRCCOPY);
    stretched("stretch-flip", 1, 6, 7, -5, 0, 0, 7, 5, COLORONCOLOR, SRCCOPY);
    stretched("stretch-invert", 1, 1, 7, 5, 0, 0, 7, 5, COLORONCOLOR, SRCINVERT);
    stretched("stretch-shrink-bw", 0, 0, 4, 3, 0, 0, 7, 5, BLACKONWHITE, SRCCOPY);

    DeleteDC(target);
    DeleteObject(canvas);
    ReleaseDC(NULL, screen);

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
