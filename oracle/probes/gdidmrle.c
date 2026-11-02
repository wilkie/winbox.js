/*
 * `DMDibBits` setting a run-length encoded DIB, `BI_RLE8` or `BI_RLE4`,
 * into a memory bitmap of the display's format and of one plane: the
 * display driver's routine of run lengths (`VGA.DRV` export 501, seg9
 * `12ec`; `SVGA256.DRV` seg9 `15ac`), seen in the bitmap's memory and in
 * 64 bytes either side of it, so that what is written past the bitmap is
 * seen too. Recorded on each display (`per-display.mjs`).
 *
 * The streams are `rledib`'s. The colour table is the sixteen colours of
 * the display in order; on the 256-colour display, which takes a table of
 * palette indices from GDI, the words `3 + 7i`.
 *
 * Records: `set`, the answer and the memory's bytes, before, the bitmap's,
 * after, `/` between.
 */

#define PROBE_FLUSH
#include <string.h>
#include "probe.h"

#define OUTPUT "C:\\ORACLE\\GDIDMRLE.OUT"

typedef int(FAR PASCAL *DIBBITSPROC)(LPSTR, WORD, WORD, WORD, LPSTR, LPSTR, LPSTR, LPSTR);

/* A bitmap as a driver is handed it: GDI's `BITMAP` for drivers. */
typedef struct {
    short bmType;
    short bmWidth;
    short bmHeight;
    short bmWidthBytes;
    BYTE bmPlanes;
    BYTE bmBitsPixel;
    LPSTR bmBits;
    DWORD bmWidthPlanes;
    LPSTR bmlpPDevice;
    short bmSegmentIndex;
    short bmScanSegment;
    short bmFillBytes;
    short reserved[2];
} DRVBITMAP;

#define WIDTH 16
#define HEIGHT 8
#define GUARD 64

static const COLORREF PALETTE[16] = {
    RGB(0, 0, 0),       RGB(128, 0, 0),     RGB(0, 128, 0),   RGB(128, 128, 0),
    RGB(0, 0, 128),     RGB(128, 0, 128),   RGB(0, 128, 128), RGB(192, 192, 192),
    RGB(128, 128, 128), RGB(255, 0, 0),     RGB(0, 255, 0),   RGB(255, 255, 0),
    RGB(0, 0, 255),     RGB(255, 0, 255),   RGB(0, 255, 255), RGB(255, 255, 255),
};

static BYTE basic8[] = {
    16, 1, 0, 0, 16, 2, 0, 0, 16, 3, 0, 0, 16, 4, 0, 0,
    16, 5, 0, 0, 16, 6, 0, 0, 16, 7, 0, 0, 16, 8, 0, 1,
};
static BYTE small8[] = {16, 1, 0, 0, 16, 2, 0, 0, 16, 3, 0, 0, 16, 5, 0, 1};
static BYTE partial8[] = {
    5, 0x0a, 0, 0, 0, 2, 3, 1, 4, 0x0b, 0, 2, 2, 0, 2, 0x0c, 0, 0, 0, 2, 0, 2, 1, 0x0d, 0, 1,
};
static BYTE absolute8[] = {
    0, 3, 1, 2, 3, 0, 0, 5, 4, 5, 6, 7, 8, 0, 3, 9, 0, 4, 10, 11, 12, 13, 0, 0, 0, 0,
    16, 0x0e, 0, 1,
};
static BYTE right8[] = {
    16, 1, 0, 0, 16, 2, 0, 0, 20, 0x0c, 0, 0, 14, 3, 0, 4, 9, 10, 11, 12, 0, 0, 16, 5, 0, 1,
};
static BYTE past8[] = {
    16, 1, 0, 0, 16, 2, 0, 0, 16, 3, 0, 0, 16, 4, 0, 0, 16, 5, 0, 0,
    16, 6, 0, 0, 16, 7, 0, 0, 16, 8, 0, 0, 16, 9, 0, 0, 8, 10, 0, 1,
};
static BYTE basic4[] = {
    16, 0x11, 0, 0, 16, 0x22, 0, 0, 16, 0x33, 0, 0, 16, 0x44, 0, 0,
    16, 0x55, 0, 0, 16, 0x66, 0, 0, 16, 0x77, 0, 0, 16, 0x88, 0, 1,
};
static BYTE nibbles4[] = {
    7, 0x9c, 0, 0, 0, 2, 1, 0, 5, 0x3a, 0, 2, 1, 0, 4, 0x5b, 0, 0, 0, 3, 0x12, 0x30,
    0, 5, 0x45, 0x67, 0x80, 0, 0, 4, 0xab, 0xcd, 0, 0, 0, 2, 3, 0, 0, 3, 0xef, 0x10, 0, 1,
};
static BYTE right4[] = {20, 0x9a, 0, 0, 13, 0x55, 0, 6, 0x12, 0x34, 0x56, 0, 0, 1};

static DIBBITSPROC dibBits;
static DRVBITMAP colour, mono;
static BYTE colourArea[GUARD + WIDTH * HEIGHT + GUARD];
static BYTE monoArea[GUARD + 2 * HEIGHT + GUARD];
static int colourSize, monoSize;
static BYTE drawMode[0x20];
static BYTE info[sizeof(BITMAPINFOHEADER) + 16 * 4];
static BOOL indexed;

static void hex(LPSTR out, BYTE FAR *bytes, int count)
{
    int at;

    for (at = 0; at < count; at++) {
        wsprintf(out + at * 2, "%02x", bytes[at]);
    }

    out[count * 2] = '\0';
}

static int layOut(DRVBITMAP *bitmap, int planes, int bitsPixel, BYTE *area)
{
    int widthBytes = ((WIDTH * bitsPixel + 15) / 16) * 2;

    bitmap->bmType = 0;
    bitmap->bmWidth = WIDTH;
    bitmap->bmHeight = HEIGHT;
    bitmap->bmWidthBytes = widthBytes;
    bitmap->bmPlanes = (BYTE)planes;
    bitmap->bmBitsPixel = (BYTE)bitsPixel;
    bitmap->bmBits = (LPSTR)(area + GUARD);
    bitmap->bmWidthPlanes = (DWORD)widthBytes * HEIGHT;
    bitmap->bmlpPDevice = NULL;
    bitmap->bmSegmentIndex = 0;
    bitmap->bmScanSegment = HEIGHT;
    bitmap->bmFillBytes = 0;
    return widthBytes * planes * HEIGHT;
}

static void header(int height, int depth, int compression, DWORD size)
{
    BITMAPINFOHEADER FAR *h = (BITMAPINFOHEADER FAR *)info;
    int index;

    _fmemset(info, 0, sizeof(info));
    h->biSize = sizeof(BITMAPINFOHEADER);
    h->biWidth = WIDTH;
    h->biHeight = height;
    h->biPlanes = 1;
    h->biBitCount = depth;
    h->biCompression = compression;
    h->biSizeImage = size;
    h->biClrUsed = 16;

    for (index = 0; index < 16; index++) {
        BYTE FAR *entry = info + sizeof(BITMAPINFOHEADER);

        if (indexed) {
            ((WORD FAR *)entry)[index] = (WORD)(3 + 7 * index);
        } else {
            entry[index * 4] = GetBValue(PALETTE[index]);
            entry[index * 4 + 1] = GetGValue(PALETTE[index]);
            entry[index * 4 + 2] = GetRValue(PALETTE[index]);
            entry[index * 4 + 3] = 0;
        }
    }
}

static void set(LPCSTR name, DRVBITMAP *bitmap, BYTE *stream, int length, int height, int depth,
                int compression, int start, int count)
{
    BOOL isMono = bitmap == &mono;
    BYTE *area = isMono ? monoArea : colourArea;
    int size = isMono ? monoSize : colourSize;
    int answer;
    int i;
    LPSTR out;

    for (i = 0; i < GUARD + size + GUARD; i++) {
        area[i] = (BYTE)(i * 29 + 7 + (i >> 3) * 13);
    }

    header(height, depth, compression, length);
    answer = dibBits((LPSTR)bitmap, 0, start, count, (LPSTR)stream, (LPSTR)info, (LPSTR)drawMode,
                     NULL);
    wsprintf(probeResult, "%d ", answer);
    out = probeResult + lstrlen(probeResult);
    hex(out, area, GUARD);
    out += GUARD * 2;
    *out++ = '/';
    hex(out, area + GUARD, size);
    out += size * 2;
    *out++ = '/';
    hex(out, area + GUARD + size, GUARD);
    probe("set", name, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HDC screen;
    int planes, bitsPixel;

    probeOpen(OUTPUT);
    dibBits = (DIBBITSPROC)GetProcAddress(GetModuleHandle("GDI"), MAKEINTRESOURCE(217));

    screen = GetDC(0);
    planes = GetDeviceCaps(screen, PLANES);
    bitsPixel = GetDeviceCaps(screen, BITSPIXEL);
    ReleaseDC(0, screen);
    wsprintf(probeResult, "%d %d", planes, bitsPixel);
    probe("display", "planes bits", probeResult);
    indexed = planes * bitsPixel == 8;

    colourSize = layOut(&colour, planes, bitsPixel, colourArea);
    monoSize = layOut(&mono, 1, 1, monoArea);

    set("basic8", &colour, basic8, sizeof(basic8), HEIGHT, 8, BI_RLE8, 0, HEIGHT);
    set("partial8", &colour, partial8, sizeof(partial8), HEIGHT, 8, BI_RLE8, 0, HEIGHT);
    set("absolute8", &colour, absolute8, sizeof(absolute8), HEIGHT, 8, BI_RLE8, 0, HEIGHT);
    set("right8", &colour, right8, sizeof(right8), HEIGHT, 8, BI_RLE8, 0, HEIGHT);
    set("past8", &colour, past8, sizeof(past8), HEIGHT, 8, BI_RLE8, 0, HEIGHT);
    set("start8", &colour, small8, sizeof(small8), HEIGHT, 8, BI_RLE8, 2, 3);
    set("small8", &colour, small8, sizeof(small8), 4, 8, BI_RLE8, 0, 4);
    set("basic4", &colour, basic4, sizeof(basic4), HEIGHT, 4, BI_RLE4, 0, HEIGHT);
    set("nibbles4", &colour, nibbles4, sizeof(nibbles4), HEIGHT, 4, BI_RLE4, 0, HEIGHT);
    set("right4", &colour, right4, sizeof(right4), HEIGHT, 4, BI_RLE4, 0, HEIGHT);
    set("bitfields", &colour, nibbles4, sizeof(nibbles4), HEIGHT, 8, 3, 0, HEIGHT);
    set("mono8", &mono, partial8, sizeof(partial8), HEIGHT, 8, BI_RLE8, 0, HEIGHT);
    set("mono4", &mono, right4, sizeof(right4), HEIGHT, 4, BI_RLE4, 0, HEIGHT);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
