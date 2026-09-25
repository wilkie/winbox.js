/*
 * What `GetBitmapBits` hands back, and in what shape.
 *
 * Every probe that draws reads its cell back with `GetBitmapBits`, and every
 * one of them uses a monochrome bitmap a multiple of thirty-two pixels wide.
 * At those widths a row padded to two bytes and a row padded to four are the
 * same bytes, so none of them can say which a device-dependent bitmap uses,
 * and winbox.js pads to four in both `CreateBitmap` and `GetBitmapBits`. A
 * program's sprites are not so obliging: sixteen and twenty-four pixel
 * bitmaps are ordinary.
 *
 * So ask it at widths that tell the two apart, three ways:
 *
 * * `CreateBitmap` with known bits, read straight back, at widths from eight
 *   to forty. The bits are a counting pattern, so a row that starts in the
 *   wrong place shows as the wrong numbers. The record is what the call
 *   returned and every byte it wrote.
 * * A twenty-four pixel bitmap drawn into -- white, then a black rectangle --
 *   and read back, which says the bits follow the drawing and not the
 *   bitmap as it was created.
 * * A buffer smaller than the bitmap, which says what the return value
 *   counts and how much is written.
 *
 * The drawn bitmaps are made from zeroed bits, because one made from none is
 * not cleared, and its padding holds whatever the memory held before.
 *
 * The buffer is filled with `0xAA` first, so a byte the call did not write
 * is distinguishable from one it wrote.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\BITBITS.OUT"

#define BUFFER 128

static const char HEX[] = "0123456789abcdef";

static unsigned char source[BUFFER];
static unsigned char zeroes[BUFFER];
static unsigned char bits[BUFFER];

/* The bytes, all of them, as hex. */
static void writeBytes(int count)
{
    LPSTR at = probeResult;
    int index;

    wsprintf(at, "%d,", count);

    while (*at) {
        at++;
    }

    for (index = 0; index < BUFFER; index++) {
        *at++ = HEX[(bits[index] >> 4) & 0x0f];
        *at++ = HEX[bits[index] & 0x0f];
    }

    *at = '\0';
}

static void fillBits(void)
{
    int index;

    for (index = 0; index < BUFFER; index++) {
        bits[index] = 0xAA;
    }
}

/* A bitmap made from known bits and read straight back. */
static void probeCreated(int width, int height)
{
    HBITMAP bitmap;
    LONG count;

    bitmap = CreateBitmap(width, height, 1, 1, source);

    fillBits();
    count = GetBitmapBits(bitmap, (LONG)BUFFER, bits);

    wsprintf(probeArgs, "created,w=%d,h=%d,buffer=%d", width, height, BUFFER);
    writeBytes((int)count);
    probe("bits", probeArgs, probeResult);

    DeleteObject(bitmap);
}

/* A bitmap drawn into, then read back: white, and a black rectangle. */
static void probeDrawn(HDC memory, int width, int height, int left, int top, int right, int bottom,
                       LONG buffer)
{
    HBITMAP bitmap;
    HBITMAP previous;
    LONG count;

    /* From zeroed bits rather than none. A bitmap made with no bits is not
     * cleared: the first recording found its padding -- the bytes past the
     * pixels of a row, which drawing never touches -- holding the bytes of the
     * bitmap freed just before it. That is the allocator's history, not
     * something a record can be replayed against. */
    bitmap = CreateBitmap(width, height, 1, 1, zeroes);
    previous = (HBITMAP)SelectObject(memory, bitmap);

    PatBlt(memory, 0, 0, width, height, WHITENESS);
    PatBlt(memory, left, top, right - left, bottom - top, BLACKNESS);

    fillBits();
    count = GetBitmapBits(bitmap, buffer, bits);

    wsprintf(probeArgs, "drawn,w=%d,h=%d,rect=%d:%d:%d:%d,buffer=%ld", width, height, left, top,
             right, bottom, buffer);
    writeBytes((int)count);
    probe("bits", probeArgs, probeResult);

    SelectObject(memory, previous);
    DeleteObject(bitmap);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HDC screen;
    HDC memory;
    int index;

    probeOpen(OUTPUT);

    for (index = 0; index < BUFFER; index++) {
        source[index] = (unsigned char)(index + 1);
    }

    probeNote("bitmaps made from known bits, read straight back");
    probeCreated(8, 3);
    probeCreated(16, 3);
    probeCreated(24, 3);
    probeCreated(32, 3);
    probeCreated(40, 3);

    screen = GetDC(NULL);
    memory = CreateCompatibleDC(screen);

    probeNote("bitmaps drawn into, then read back");
    probeDrawn(memory, 24, 4, 3, 1, 11, 3, (LONG)BUFFER);
    probeDrawn(memory, 16, 4, 0, 0, 16, 1, (LONG)BUFFER);
    probeDrawn(memory, 40, 3, 30, 0, 40, 3, (LONG)BUFFER);

    probeNote("a buffer smaller than the bitmap");
    probeDrawn(memory, 24, 4, 3, 1, 11, 3, 5L);
    probeDrawn(memory, 24, 4, 3, 1, 11, 3, 1L);

    DeleteDC(memory);
    ReleaseDC(NULL, screen);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
