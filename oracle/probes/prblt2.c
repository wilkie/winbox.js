/*
 * What GDI draws itself for a printer's driver that can only `BitBlt`:
 * `StretchBlt`, `SetDIBitsToDevice` and `StretchDIBits`, stretched and
 * converted into bitmaps of GDI's own and copied with the driver's
 * `BitBlt`. Recorded on the installation with a printer, `vgaprint`.
 *
 * The driver is the probe's own (`prblt2.dll.c`, `prdrv.dll.c` under
 * `PRDRV_COPIES`): it logs each call GDI makes to it, sums the bits of a
 * monochrome source within the rectangle it is given, and carries out a
 * copy from one monochrome bitmap into another, so that GDI's bitmaps hold
 * what GDI put in them. Its devices: `X`, which can `BitBlt` and no more;
 * `XS`, which can also `StretchBlt`.
 *
 * * Stretches of a bitmap of a memory context made compatible with the
 *   printer's: larger, turned over either way, smaller in each stretch
 *   mode, larger or smaller by a pixel, the same size turned over both
 *   ways, from beyond the bitmap, far larger than the page either way,
 *   and under a clip of two rectangles.
 * * DIBs set and stretched: of sixteen colours, in part, from a later
 *   scan, the same size, turned over, from a part; of two colours either
 *   way round, of 256 and of 24 bits, and compressed, `BI_RLE4` and
 *   `BI_RLE8`.
 * * A bitmap made compatible with the printer's context: its shape, a DIB
 *   set into it and got back, and one made of a DIB.
 * * A bitmap of a memory context compatible with the display's, of one
 *   colour and of sixteen, stretched to the printer.
 *
 * * `call`: each call's answer.
 * * `driver`: each line of the driver's log, as it was written.
 * * `dib`: what `GetDIBits` wrote.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\PRBLT2.OUT"
#define LOG "C:\\ORACLE\\PRDRV.LOG"
#define LIBRARY "C:\\WINDOWS\\PRBLT2D.DLL"
#define DRIVER_FILE "C:\\WINDOWS\\PRBLT2D.DRV"
#define DRIVER "PRBLT2D"

static void exact(LPCSTR name, long answer)
{
    wsprintf(probeResult, "%ld", answer);
    probe("call", name, probeResult);
}

static char chunk[4096];
static char line[512];

/* The driver's file, as GDI looks for it: its name and `.DRV`. */
static void install(void)
{
    OFSTRUCT info;
    HFILE from = OpenFile(LIBRARY, &info, OF_READ);
    HFILE to = _lcreat(DRIVER_FILE, 0);
    int read;

    while ((read = _lread(from, chunk, sizeof(chunk))) > 0) {
        _lwrite(to, chunk, read);
    }

    _lclose(from);
    _lclose(to);
}

static int lineCount;

/* Each line of the driver's log so far, the log emptied after. */
static void drained(void)
{
    OFSTRUCT info;
    HFILE file = OpenFile(LOG, &info, OF_READ);
    int length = 0;
    int read;
    int at;

    if (file == HFILE_ERROR) {
        return;
    }

    while ((read = _lread(file, chunk, sizeof(chunk))) > 0) {
        for (at = 0; at < read; at++) {
            if (chunk[at] == '\n') {
                if (length > 0 && line[length - 1] == '\r') {
                    length--;
                }

                line[length] = '\0';
                wsprintf(probeArgs, "%d", lineCount++);
                probe("driver", probeArgs, line);
                length = 0;
            } else if (length < (int)sizeof(line) - 1) {
                line[length++] = chunk[at];
            }
        }
    }

    _lclose(file);
    OpenFile(LOG, &info, OF_DELETE);
}

/* A DIB's header and up to 256 colours. */
typedef struct {
    BITMAPINFOHEADER header;
    RGBQUAD colors[256];
} DIB;

static DIB picture;
static BYTE bits[256];
static BYTE pattern[16] = {0xaa, 0, 0x55, 0, 0xaa, 0, 0x55, 0, 0xaa, 0, 0x55, 0, 0xaa, 0, 0x55, 0};

/* A DIB of 8 by 8 of `count` bits a pixel and `compression`. */
static void shaped(int count, DWORD compression, DWORD size)
{
    int i;
    int colours = count == 24 ? 0 : 1 << count;

    picture.header.biSize = sizeof(BITMAPINFOHEADER);
    picture.header.biWidth = 8;
    picture.header.biHeight = 8;
    picture.header.biPlanes = 1;
    picture.header.biBitCount = count;
    picture.header.biCompression = compression;
    picture.header.biSizeImage = size;
    picture.header.biXPelsPerMeter = 0;
    picture.header.biYPelsPerMeter = 0;
    picture.header.biClrUsed = colours;
    picture.header.biClrImportant = 0;

    for (i = 0; i < colours; i++) {
        if (count == 4) {
            picture.colors[i].rgbRed = (BYTE)(i & 1 ? 255 : 0);
            picture.colors[i].rgbGreen = (BYTE)(i & 2 ? 255 : 0);
            picture.colors[i].rgbBlue = (BYTE)(i & 4 ? 255 : 0);
        } else {
            picture.colors[i].rgbRed = (BYTE)i;
            picture.colors[i].rgbGreen = (BYTE)i;
            picture.colors[i].rgbBlue = (BYTE)i;
        }

        picture.colors[i].rgbReserved = 0;
    }

    for (i = 0; i < (int)sizeof(bits); i++) {
        bits[i] = (BYTE)(i * 0x13);
    }
}

/* Two colours, the first and the second as given. */
static void twoColours(BYTE first, BYTE second)
{
    shaped(1, BI_RGB, 0);
    picture.colors[0].rgbRed = picture.colors[0].rgbGreen = picture.colors[0].rgbBlue = first;
    picture.colors[1].rgbRed = picture.colors[1].rgbGreen = picture.colors[1].rgbBlue = second;
}

/* Each row a run of four pixels of two colours in turn, then four given
 * (`00 04`, two bytes, a word); the end of the line, and at last of the
 * bitmap. */
static void rle4(void)
{
    int row;
    int at = 0;

    shaped(4, BI_RLE4, 0);

    for (row = 0; row < 8; row++) {
        bits[at++] = 4;
        bits[at++] = (BYTE)(row * 0x11 + 0x2);
        bits[at++] = 0;
        bits[at++] = 4;
        bits[at++] = (BYTE)(0x60 + row);
        bits[at++] = (BYTE)(0xa5 ^ (row << 4));
        bits[at++] = 0;
        bits[at++] = 0;
    }

    bits[at++] = 0;
    bits[at++] = 1;
    picture.header.biSizeImage = at;
}

static void rle8(void)
{
    int row;
    int at = 0;

    shaped(8, BI_RLE8, 0);

    for (row = 0; row < 8; row++) {
        bits[at++] = 5;
        bits[at++] = (BYTE)(row * 32);
        bits[at++] = 3;
        bits[at++] = (BYTE)(255 - row * 16);
        bits[at++] = 0;
        bits[at++] = 0;
    }

    bits[at++] = 0;
    bits[at++] = 1;
    picture.header.biSizeImage = at;
}

static BYTE got[256];

/* What GetDIBits wrote: its header's size of image and colours, and the
 * colours and bits. */
static void dibOf(LPCSTR name, int count)
{
    char *at = probeResult;
    int colours = 1 << picture.header.biBitCount;
    int i;

    wsprintf(at, "image %ld colours", picture.header.biSizeImage);
    at += lstrlen(at);

    for (i = 0; i < colours && i < 16; i++) {
        wsprintf(at, " %02X%02X%02X", picture.colors[i].rgbRed, picture.colors[i].rgbGreen,
                 picture.colors[i].rgbBlue);
        at += lstrlen(at);
    }

    lstrcpy(at, " bits");
    at += lstrlen(at);

    for (i = 0; i < count; i++) {
        wsprintf(at, " %02X", got[i]);
        at += lstrlen(at);
    }

    probe("dib", name, probeResult);
}

#define LABEL(text) wsprintf(label, "%s " text, name)

/* Stretches on a context of the driver's. */
static void stretches(HDC dc, LPCSTR name, BOOL all)
{
    HDC memory = CreateCompatibleDC(dc);
    HBITMAP bitmap = CreateBitmap(16, 8, 1, 1, pattern);
    HBITMAP kept;
    char label[64];

    probeNote(name);
    kept = SelectObject(memory, bitmap);
    drained();

    LABEL("by a pixel both ways");
    exact(label, StretchBlt(dc, 40, 4, 17, 9, memory, 0, 0, 16, 8, SRCCOPY));
    drained();

    LABEL("by a pixel less");
    exact(label, StretchBlt(dc, 40, 4, 15, 8, memory, 0, 0, 16, 8, SRCCOPY));
    drained();

    LABEL("by a pixel down");
    exact(label, StretchBlt(dc, 40, 4, 16, 9, memory, 0, 0, 16, 8, SRCCOPY));
    drained();

    LABEL("by a pixel across");
    exact(label, StretchBlt(dc, 40, 4, 17, 8, memory, 0, 0, 16, 8, SRCCOPY));
    drained();

    LABEL("by a pixel less both ways");
    exact(label, StretchBlt(dc, 40, 4, 15, 7, memory, 0, 0, 16, 8, SRCCOPY));
    drained();

    LABEL("turned over both ways");
    exact(label, StretchBlt(dc, 21, 14, -16, -8, memory, 16, 8, -16, -8, SRCCOPY));
    drained();

    if (!all) {
        goto done;
    }

    LABEL("larger");
    exact(label, StretchBlt(dc, 30, 30, 32, 16, memory, 0, 0, 16, 8, SRCCOPY));
    drained();

    LABEL("turned across");
    exact(label, StretchBlt(dc, 62, 30, -32, 16, memory, 0, 0, 16, 8, SRCCOPY));
    drained();

    LABEL("turned down");
    exact(label, StretchBlt(dc, 30, 46, 32, -16, memory, 0, 0, 16, 8, SRCCOPY));
    drained();

    LABEL("smaller");
    exact(label, StretchBlt(dc, 4, 4, 8, 4, memory, 0, 0, 16, 8, SRCCOPY));
    drained();

    SetStretchBltMode(dc, WHITEONBLACK);
    LABEL("smaller turned across, WHITEONBLACK");
    exact(label, StretchBlt(dc, 12, 4, -8, 4, memory, 0, 0, 16, 8, SRCCOPY));
    drained();

    SetStretchBltMode(dc, COLORONCOLOR);
    LABEL("smaller turned across, COLORONCOLOR");
    exact(label, StretchBlt(dc, 12, 4, -8, 4, memory, 0, 0, 16, 8, SRCCOPY));
    drained();

    LABEL("smaller turned down, COLORONCOLOR");
    exact(label, StretchBlt(dc, 4, 12, 8, -4, memory, 0, 0, 16, 8, SRCCOPY));
    drained();

    LABEL("larger turned down, COLORONCOLOR");
    exact(label, StretchBlt(dc, 30, 46, 32, -16, memory, 0, 0, 16, 8, SRCCOPY));
    drained();
    SetStretchBltMode(dc, BLACKONWHITE);

    LABEL("from beyond the bitmap");
    exact(label, StretchBlt(dc, 0, 0, 64, 16, memory, 0, 0, 32, 8, SRCCOPY));
    drained();

    LABEL("inverting");
    exact(label, StretchBlt(dc, 30, 30, 32, 16, memory, 0, 0, 16, 8, SRCINVERT));
    drained();

    LABEL("far larger");
    exact(label, StretchBlt(dc, -900, 0, 2000, 300, memory, 0, 0, 16, 8, SRCCOPY));
    drained();

    LABEL("far larger turned across");
    exact(label, StretchBlt(dc, 1100, 0, -2000, 300, memory, 0, 0, 16, 8, SRCCOPY));
    drained();

    SaveDC(dc);
    IntersectClipRect(dc, 0, 0, 40, 40);
    ExcludeClipRect(dc, 34, 34, 38, 38);
    LABEL("larger, clipped");
    exact(label, StretchBlt(dc, 30, 30, 32, 16, memory, 0, 0, 16, 8, SRCCOPY));
    drained();

    LABEL("turned across, clipped");
    exact(label, StretchBlt(dc, 62, 30, -32, 16, memory, 0, 0, 16, 8, SRCCOPY));
    drained();
    RestoreDC(dc, -1);

done:
    SelectObject(memory, kept);
    DeleteDC(memory);
    DeleteObject(bitmap);
    drained();
}

/* DIBs on a context of the driver's. */
static void dibs(HDC dc)
{
    HDC memory = CreateCompatibleDC(dc);
    LPBITMAPINFO info = (LPBITMAPINFO)&picture;

    probeNote("DIBs");
    drained();

    shaped(4, BI_RGB, 0);
    exact("SetDIBitsToDevice", SetDIBitsToDevice(dc, 2, 2, 8, 8, 0, 0, 0, 8, bits, info,
                                                 DIB_RGB_COLORS));
    drained();

    exact("SetDIBitsToDevice a part", SetDIBitsToDevice(dc, 2, 20, 8, 4, 0, 2, 0, 8, bits, info,
                                                        DIB_RGB_COLORS));
    drained();

    exact("SetDIBitsToDevice later scans", SetDIBitsToDevice(dc, 20, 20, 6, 8, 2, 0, 2, 4,
                                                             bits, info, DIB_RGB_COLORS));
    drained();

    exact("StretchDIBits", StretchDIBits(dc, 40, 2, 16, 16, 0, 0, 8, 8, bits, info,
                                         DIB_RGB_COLORS, SRCCOPY));
    drained();

    exact("StretchDIBits the same size", StretchDIBits(dc, 40, 30, 8, 8, 0, 0, 8, 8, bits, info,
                                                       DIB_RGB_COLORS, SRCCOPY));
    drained();

    exact("StretchDIBits turned across", StretchDIBits(dc, 56, 30, -16, 16, 0, 0, 8, 8, bits,
                                                       info, DIB_RGB_COLORS, SRCCOPY));
    drained();

    exact("StretchDIBits a part", StretchDIBits(dc, 20, 30, 8, 8, 2, 1, 4, 4, bits, info,
                                                DIB_RGB_COLORS, SRCCOPY));
    drained();

    exact("StretchDIBits inverting", StretchDIBits(dc, 40, 30, 8, 8, 0, 0, 8, 8, bits, info,
                                                   DIB_RGB_COLORS, SRCINVERT));
    drained();

    twoColours(0, 255);
    exact("SetDIBitsToDevice black and white", SetDIBitsToDevice(dc, 2, 2, 8, 8, 0, 0, 0, 8,
                                                                 bits, info, DIB_RGB_COLORS));
    drained();

    twoColours(255, 0);
    exact("SetDIBitsToDevice white and black", SetDIBitsToDevice(dc, 2, 2, 8, 8, 0, 0, 0, 8,
                                                                 bits, info, DIB_RGB_COLORS));
    drained();

    twoColours(255, 255);
    exact("SetDIBitsToDevice white and white", SetDIBitsToDevice(dc, 2, 2, 8, 8, 0, 0, 0, 8,
                                                                 bits, info, DIB_RGB_COLORS));
    drained();

    shaped(8, BI_RGB, 0);
    exact("SetDIBitsToDevice 256", SetDIBitsToDevice(dc, 2, 2, 8, 8, 0, 0, 0, 8, bits, info,
                                                     DIB_RGB_COLORS));
    drained();

    shaped(24, BI_RGB, 0);
    picture.header.biHeight = 2;
    exact("SetDIBitsToDevice 24 bits", SetDIBitsToDevice(dc, 2, 2, 8, 2, 0, 0, 0, 2, bits, info,
                                                         DIB_RGB_COLORS));
    drained();

    rle4();
    exact("SetDIBitsToDevice RLE4", SetDIBitsToDevice(dc, 2, 2, 8, 8, 0, 0, 0, 8, bits, info,
                                                      DIB_RGB_COLORS));
    drained();

    exact("StretchDIBits RLE4", StretchDIBits(dc, 40, 2, 16, 16, 0, 0, 8, 8, bits, info,
                                              DIB_RGB_COLORS, SRCCOPY));
    drained();

    rle8();
    exact("SetDIBitsToDevice RLE8", SetDIBitsToDevice(dc, 2, 2, 8, 8, 0, 0, 0, 8, bits, info,
                                                      DIB_RGB_COLORS));
    drained();

    DeleteDC(memory);
    drained();
}

/* A bitmap made compatible with the printer's context. */
static void compatible(HDC dc)
{
    HDC memory = CreateCompatibleDC(dc);
    HBITMAP bitmap = CreateCompatibleBitmap(dc, 16, 8);
    HBITMAP made;
    BITMAP shape;
    LPBITMAPINFO info = (LPBITMAPINFO)&picture;
    int i;

    probeNote("compatible");
    drained();

    GetObject(bitmap, sizeof(shape), &shape);
    wsprintf(probeResult, "%d %d %d %d %d", shape.bmWidth, shape.bmHeight, shape.bmWidthBytes,
             shape.bmPlanes, shape.bmBitsPixel);
    probe("call", "CreateCompatibleBitmap", probeResult);
    drained();

    shaped(4, BI_RGB, 0);
    exact("SetDIBits", SetDIBits(dc, bitmap, 0, 8, bits, info, DIB_RGB_COLORS));
    drained();

    for (i = 0; i < (int)sizeof(got); i++) {
        got[i] = 0xcd;
    }

    shaped(4, BI_RGB, 0);
    exact("GetDIBits", GetDIBits(dc, bitmap, 0, 8, got, info, DIB_RGB_COLORS));
    drained();
    dibOf("GetDIBits", 32);

    for (i = 0; i < (int)sizeof(got); i++) {
        got[i] = 0xcd;
    }

    twoColours(0, 0);
    picture.header.biWidth = 16;
    exact("GetDIBits two colours, a part", GetDIBits(dc, bitmap, 2, 4, got, info,
                                                     DIB_RGB_COLORS));
    drained();
    dibOf("GetDIBits two colours, a part", 16);

    shaped(4, BI_RGB, 0);
    made = CreateDIBitmap(dc, &picture.header, CBM_INIT, bits, info, DIB_RGB_COLORS);
    exact("CreateDIBitmap", made != NULL);
    drained();

    SelectObject(memory, made);
    exact("StretchBlt of it", StretchBlt(dc, 30, 30, 16, 16, memory, 0, 0, 8, 8, SRCCOPY));
    drained();

    DeleteDC(memory);
    DeleteObject(made);
    DeleteObject(bitmap);
    drained();
}

/* Bitmaps of memory contexts compatible with the display's. */
static void displays(HDC dc)
{
    HDC screen = GetDC(NULL);
    HDC memory = CreateCompatibleDC(NULL);
    HBITMAP mono = CreateBitmap(16, 8, 1, 1, pattern);
    HBITMAP colour = CreateCompatibleBitmap(screen, 16, 8);
    HBITMAP kept;
    HBRUSH brush = CreateSolidBrush(RGB(0, 255, 0));
    RECT rect;

    probeNote("display");
    drained();

    kept = SelectObject(memory, colour);
    SetRect(&rect, 0, 0, 16, 8);
    FillRect(memory, &rect, GetStockObject(WHITE_BRUSH));
    SetRect(&rect, 0, 0, 8, 8);
    FillRect(memory, &rect, brush);
    SelectObject(memory, mono);

    exact("display BitBlt", BitBlt(dc, 30, 30, 16, 8, memory, 0, 0, SRCCOPY));
    drained();

    exact("display StretchBlt", StretchBlt(dc, 30, 30, 32, 16, memory, 0, 0, 16, 8, SRCCOPY));
    drained();

    exact("display StretchBlt turned across", StretchBlt(dc, 62, 30, -32, 16, memory, 0, 0, 16,
                                                         8, SRCCOPY));
    drained();

    SelectObject(memory, colour);
    exact("display StretchBlt of colours", StretchBlt(dc, 30, 30, 32, 16, memory, 0, 0, 16, 8,
                                                      SRCCOPY));
    drained();

    SelectObject(memory, kept);
    DeleteDC(memory);
    DeleteObject(mono);
    DeleteObject(colour);
    DeleteObject(brush);
    ReleaseDC(NULL, screen);
    drained();
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    OFSTRUCT info;
    HDC dc;

    probeOpen(OUTPUT);
    install();
    OpenFile(LOG, &info, OF_DELETE);

    dc = CreateDC(DRIVER, "X", "LPT1:", NULL);
    exact("CreateDC X", dc != NULL);
    drained();
    stretches(dc, "X", TRUE);
    dibs(dc);
    compatible(dc);
    displays(dc);
    exact("DeleteDC X", DeleteDC(dc));
    drained();

    dc = CreateDC(DRIVER, "XS", "LPT1:", NULL);
    exact("CreateDC XS", dc != NULL);
    drained();
    stretches(dc, "XS", FALSE);
    exact("DeleteDC XS", DeleteDC(dc));
    drained();

    probeFinish();
    return 0;
}
