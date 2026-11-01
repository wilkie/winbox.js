/*
 * `DMDibBits` on a memory bitmap of the display's format, and of one plane,
 * with a translation table of the probe's own -- the argument GDI hands a
 * driver after the DIB's header, which `gdidmdrw` leaves null. The
 * 256-colour display's driver reads it for every DIB it gets but one of
 * 8 bits from its own format, and matches a DIB of 24 bits it sets through
 * GDI's `DeviceColorMatch` with it. Recorded on each display
 * (`per-display.mjs`).
 *
 * * `get`: scans got as a DIB of 1, 4, 8 and 24 bits through a table of
 *   256 bytes (for 24 bits, of 256 four-byte colours): the answer and the
 *   DIB's bits.
 * * `set`: scans of 24 bits set through a table `DeviceColorMatch` reads
 *   -- a word, the offset of the word to answer in each entry, and a far
 *   pointer to a count, a word and ten-byte entries -- the answer and the
 *   bitmap's bits.
 */

#define PROBE_FLUSH
#include <string.h>
#include "probe.h"

#define OUTPUT "C:\\ORACLE\\GDIDMDIB.OUT"

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
#define HEIGHT 4
#define GUARD 8

static DIBBITSPROC dibBits;
static DRVBITMAP colour, mono;
static BYTE colourBits[WIDTH * HEIGHT * 4 + GUARD], monoBits[WIDTH * HEIGHT + GUARD];
static int colourSize, monoSize;
static BYTE drawMode[0x20];
static BYTE dib[256];
static BYTE info[sizeof(BITMAPINFOHEADER) + 16 * 4];
static BYTE translate[256 * 4];

/* `DeviceColorMatch`'s device: the word to answer, then the table's far pointer. */
static struct {
    WORD field;
    LPSTR table;
} device;

static void hex(LPSTR out, BYTE FAR *bytes, int count)
{
    int at;

    for (at = 0; at < count; at++) {
        wsprintf(out + at * 2, "%02x", bytes[at]);
    }

    out[count * 2] = '\0';
}

static int layOut(DRVBITMAP *bitmap, int planes, int bitsPixel, BYTE *bits)
{
    int widthBytes = ((WIDTH * bitsPixel + 15) / 16) * 2;

    bitmap->bmType = 0;
    bitmap->bmWidth = WIDTH;
    bitmap->bmHeight = HEIGHT;
    bitmap->bmWidthBytes = widthBytes;
    bitmap->bmPlanes = (BYTE)planes;
    bitmap->bmBitsPixel = (BYTE)bitsPixel;
    bitmap->bmBits = (LPSTR)bits;
    bitmap->bmWidthPlanes = (DWORD)widthBytes * HEIGHT;
    bitmap->bmlpPDevice = NULL;
    bitmap->bmSegmentIndex = 0;
    bitmap->bmScanSegment = HEIGHT;
    bitmap->bmFillBytes = 0;
    return widthBytes * planes * HEIGHT;
}

static void fill(DRVBITMAP *bitmap, int seed)
{
    int size = bitmap == &mono ? monoSize : colourSize;
    BYTE FAR *bits = (BYTE FAR *)bitmap->bmBits;
    int i;

    for (i = 0; i < size; i++) {
        bits[i] = (BYTE)(i * seed + 7 + (i >> 3) * 13);
    }

    for (i = 0; i < GUARD; i++) {
        bits[size + i] = 0xa5;
    }
}

static void header(int bits)
{
    BITMAPINFOHEADER FAR *h = (BITMAPINFOHEADER FAR *)info;

    _fmemset(info, 0xee, sizeof(info));
    h->biSize = sizeof(BITMAPINFOHEADER);
    h->biWidth = WIDTH;
    h->biHeight = HEIGHT;
    h->biPlanes = 1;
    h->biBitCount = bits;
    h->biCompression = 0;
    h->biSizeImage = 0;
    h->biXPelsPerMeter = 0;
    h->biYPelsPerMeter = 0;
    h->biClrUsed = 0;
    h->biClrImportant = 0;
}

static int dibBytes(int bits)
{
    return ((WIDTH * bits + 31) / 32) * 4 * HEIGHT;
}

static void get(LPCSTR name, DRVBITMAP *bitmap, int bits)
{
    int answer;

    header(bits);
    _fmemset(dib, 0xee, sizeof(dib));
    answer = dibBits((LPSTR)bitmap, 1, 0, HEIGHT, (LPSTR)dib, (LPSTR)info, (LPSTR)drawMode,
                     (LPSTR)translate);
    wsprintf(probeArgs, "%s %d", name, bits);
    wsprintf(probeResult, "%d ", answer);
    hex(probeResult + lstrlen(probeResult), dib, dibBytes(bits));
    probe("get", probeArgs, probeResult);
}

static void set(LPCSTR name, DRVBITMAP *bitmap, WORD field)
{
    int size = bitmap == &mono ? monoSize : colourSize;
    int answer;
    int i;

    header(24);

    for (i = 0; i < dibBytes(24); i++) {
        dib[i] = (BYTE)(i * 37 + 11);
    }

    fill(bitmap, 29);
    device.field = field;
    answer = dibBits((LPSTR)bitmap, 0, 0, HEIGHT, (LPSTR)dib, (LPSTR)info, (LPSTR)drawMode,
                     (LPSTR)&device);
    wsprintf(probeArgs, "%s %u", name, field);
    wsprintf(probeResult, "%d ", answer);
    hex(probeResult + lstrlen(probeResult), (BYTE FAR *)bitmap->bmBits, size + GUARD);
    probe("set", probeArgs, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HDC screen;
    HGLOBAL handle;
    BYTE FAR *table;
    int planes, bitsPixel;
    int i;

    probeOpen(OUTPUT);
    dibBits = (DIBBITSPROC)GetProcAddress(GetModuleHandle("GDI"), MAKEINTRESOURCE(217));

    screen = GetDC(0);
    planes = GetDeviceCaps(screen, PLANES);
    bitsPixel = GetDeviceCaps(screen, BITSPIXEL);
    ReleaseDC(0, screen);
    wsprintf(probeResult, "%d %d", planes, bitsPixel);
    probe("display", "planes bits", probeResult);

    colourSize = layOut(&colour, planes, bitsPixel, colourBits);
    monoSize = layOut(&mono, 1, 1, monoBits);

    /* The translation table: a byte for each index, and for 24 bits four. */
    for (i = 0; i < sizeof(translate); i++) {
        translate[i] = (BYTE)(i * 7 + 3);
    }

    /* `DeviceColorMatch`'s table, which must start its segment: four
     * entries of blue, green and red at 6, 7 and 8, a word to answer at
     * nought and another at 2. */
    handle = GlobalAlloc(GMEM_FIXED | GMEM_ZEROINIT, 0x100);
    table = (BYTE FAR *)GlobalLock(handle);
    *(WORD FAR *)(table + 0) = 4;

    for (i = 0; i < 4; i++) {
        BYTE FAR *entry = table + 4 + i * 10;

        *(WORD FAR *)(entry + 0) = 0x10 + i * 0x31;
        *(WORD FAR *)(entry + 2) = i ? 0x80 + i : 0;
        entry[6] = (BYTE)(i * 0x50);
        entry[7] = (BYTE)(0xff - i * 0x40);
        entry[8] = (BYTE)(i & 1 ? 0xff : 0x20);
    }

    device.table = (LPSTR)table;

    fill(&colour, 29);
    get("colour", &colour, 1);
    get("colour", &colour, 4);
    get("colour", &colour, 8);
    get("colour", &colour, 24);
    fill(&mono, 29);
    get("mono", &mono, 1);
    get("mono", &mono, 4);
    get("mono", &mono, 8);
    get("mono", &mono, 24);

    set("colour", &colour, 0);
    set("colour", &colour, 2);
    set("mono", &mono, 2);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
