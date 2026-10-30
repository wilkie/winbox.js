/*
 * GDI's device-independent helpers for drivers, called as a printer's
 * driver calls them when GDI hands it a memory bitmap: each found in GDI
 * by its number, given a bitmap's `BITMAP` laid out in the probe's own
 * memory, of four planes (the display's) or of one. Recorded on the VGA.
 *
 * * `transpose`: `DMTranspose` of two rows of eight bytes, at a stride
 *   forward, backward, of one and of nought: the bytes it wrote.
 * * `colorinfo`: `DMColorInfo` of a colour, for each bitmap: the answer and
 *   the physical colour it wrote; `colorback`, of a physical colour with
 *   no buffer: the answer.
 * * `pixel`: `DMPixel` setting a pixel under a raster operation, and
 *   reading one back: the answer; `bits`: the bitmap's bytes after.
 * * `scanlr`: `DMScanLR` from a point, each way, for the colour and for
 *   anything else: the answer.
 * * `enumobj`: `DMEnumObj` of pens and of brushes: how many, the answer,
 *   and the first, second and last objects; `stopped`: the answer when the
 *   callback answers nought at the third.
 * * `notbitmap`: the high word of the answer for a device that is not a
 *   bitmap (its first word not nought), and for one marked `DI`.
 */

#include <string.h>
#include "probe.h"

#define OUTPUT "C:\\ORACLE\\GDIDM.OUT"

typedef void(FAR PASCAL *TRANSPOSEPROC)(LPSTR, LPSTR, int);
typedef DWORD(FAR PASCAL *COLORINFOPROC)(LPSTR, DWORD, LPSTR);
typedef DWORD(FAR PASCAL *PIXELPROC)(LPSTR, int, int, DWORD, LPSTR);
typedef int(FAR PASCAL *SCANLRPROC)(LPSTR, int, int, DWORD, int);
typedef int(FAR PASCAL *ENUMOBJPROC)(LPSTR, int, FARPROC, LPSTR);

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

static TRANSPOSEPROC transpose;
static COLORINFOPROC colorInfo;
static PIXELPROC pixel;
static SCANLRPROC scanLR;
static ENUMOBJPROC enumObj;

static DRVBITMAP colour;
static DRVBITMAP mono;
static BYTE colourBits[2 * 4 * 8];
static BYTE monoBits[2 * 8];
static WORD drawMode[24];

static int counted;
static int stopAt;
static char seen[3][64];

static FARPROC gdiProc(int ordinal)
{
    return GetProcAddress(GetModuleHandle("GDI"), MAKEINTRESOURCE(ordinal));
}

static void hex(LPSTR out, BYTE FAR *bytes, int count)
{
    int at;

    for (at = 0; at < count; at++) {
        wsprintf(out + at * 2, "%02x", bytes[at]);
    }

    out[count * 2] = '\0';
}

static void layOut(DRVBITMAP *bitmap, int planes, BYTE *bits)
{
    bitmap->bmType = 0;
    bitmap->bmWidth = 16;
    bitmap->bmHeight = 8;
    bitmap->bmWidthBytes = 2;
    bitmap->bmPlanes = (BYTE)planes;
    bitmap->bmBitsPixel = 1;
    bitmap->bmBits = (LPSTR)bits;
    bitmap->bmWidthPlanes = 16;
    bitmap->bmlpPDevice = NULL;
    bitmap->bmSegmentIndex = 0;
    bitmap->bmScanSegment = 8;
    bitmap->bmFillBytes = 0;
}

static void transposed(LPCSTR name, int stride, int at)
{
    static BYTE source[32];
    static BYTE out[24];
    int i;

    for (i = 0; i < sizeof(source); i++) {
        source[i] = (BYTE)(i * 37 + 11);
    }

    _fmemset(out, 0xee, sizeof(out));
    transpose((LPSTR)(source + at), (LPSTR)out, stride);
    hex(probeResult, out, sizeof(out));
    probe("transpose", name, probeResult);
}

static DWORD colourInfo(LPCSTR device, DRVBITMAP *bitmap, DWORD rgb)
{
    DWORD physical = 0xeeeeeeeeL;
    DWORD answer = colorInfo((LPSTR)bitmap, rgb, (LPSTR)&physical);

    wsprintf(probeArgs, "%s %08lx", device, rgb);
    wsprintf(probeResult, "%08lx %08lx", answer, physical);
    probe("colorinfo", probeArgs, probeResult);
    return physical;
}

static void colourBack(LPCSTR device, DRVBITMAP *bitmap, DWORD physical)
{
    wsprintf(probeArgs, "%s %08lx", device, physical);
    wsprintf(probeResult, "%08lx", colorInfo((LPSTR)bitmap, physical, NULL));
    probe("colorback", probeArgs, probeResult);
}

static void setPixel(LPCSTR device, DRVBITMAP *bitmap, int x, int y, DWORD physical, int rop)
{
    drawMode[0] = (WORD)rop;
    wsprintf(probeArgs, "%s set %d,%d %08lx rop %d", device, x, y, physical, rop);
    wsprintf(probeResult, "%08lx", pixel((LPSTR)bitmap, x, y, physical, (LPSTR)drawMode));
    probe("pixel", probeArgs, probeResult);
}

static void getPixel(LPCSTR device, DRVBITMAP *bitmap, int x, int y)
{
    wsprintf(probeArgs, "%s get %d,%d", device, x, y);
    wsprintf(probeResult, "%08lx", pixel((LPSTR)bitmap, x, y, 0L, NULL));
    probe("pixel", probeArgs, probeResult);
}

static void scan(LPCSTR device, DRVBITMAP *bitmap, int x, int y, DWORD physical, int style)
{
    wsprintf(probeArgs, "%s %d,%d %08lx style %d", device, x, y, physical, style);
    wsprintf(probeResult, "%d", scanLR((LPSTR)bitmap, x, y, physical, style));
    probe("scanlr", probeArgs, probeResult);
}

int FAR PASCAL _export PenSeen(LPSTR object, LPSTR data)
{
    LOGPEN FAR *pen = (LOGPEN FAR *)object;
    int slot = counted < 2 ? counted : 2;

    wsprintf(seen[slot], "%u,%d,%d,%08lx,%ld", pen->lopnStyle, pen->lopnWidth.x,
             pen->lopnWidth.y, pen->lopnColor, (long)data);
    counted++;
    return counted == stopAt ? 0 : counted + 100;
}

int FAR PASCAL _export BrushSeen(LPSTR object, LPSTR data)
{
    LOGBRUSH FAR *brush = (LOGBRUSH FAR *)object;
    int slot = counted < 2 ? counted : 2;

    wsprintf(seen[slot], "%u,%08lx,%d,%ld", brush->lbStyle, brush->lbColor, brush->lbHatch,
             (long)data);
    counted++;
    return counted == stopAt ? 0 : counted + 100;
}

static void enumerated(LPCSTR name, DRVBITMAP *bitmap, int style, FARPROC proc, int stop)
{
    int answer;

    counted = 0;
    stopAt = stop;
    seen[0][0] = seen[1][0] = seen[2][0] = '\0';
    answer = enumObj((LPSTR)bitmap, style, proc, (LPSTR)0x00120034L);
    wsprintf(probeResult, "%d answer %d first %s second %s last %s", counted, answer,
             (LPSTR)seen[0], (LPSTR)seen[1], (LPSTR)seen[2]);
    probe(stop ? "stopped" : "enumobj", name, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static short other[16] = {1};
    static short dib[16] = {0x4944};
    static DWORD colours[] = {0x000000L, 0xffffffL, 0x0000ffL, 0x00ff00L, 0xff0000L,
                              0x808080L, 0xc0c0c0L, 0x0080c0L, 0x40ff00L, 0x1000005L,
                              0x2ff0000L, 0xff102030L};
    static DWORD physicals[] = {0x0f00ff00L, 0x3fffffffL, 0x20000000L, 0x09ff0000L,
                                0x1000ff00L, 0x00123456L};
    DWORD red, white, yellow, blue, black, green;
    FARPROC pens, brushes;
    DWORD physical;
    int i;

    probeOpen(OUTPUT);

    transpose = (TRANSPOSEPROC)gdiProc(220);
    colorInfo = (COLORINFOPROC)gdiProc(202);
    pixel = (PIXELPROC)gdiProc(209);
    scanLR = (SCANLRPROC)gdiProc(212);
    enumObj = (ENUMOBJPROC)gdiProc(207);

    layOut(&colour, 4, colourBits);
    layOut(&mono, 1, monoBits);

    transposed("stride 2", 2, 0);
    transposed("stride -2", -2, 0);
    transposed("stride 1", 1, 3);
    transposed("stride 0", 0, 5);
    transposed("stride 3", 3, 1);

    for (i = 0; i < sizeof(colours) / sizeof(colours[0]); i++) {
        colourInfo("colour", &colour, colours[i]);
        colourInfo("mono", &mono, colours[i]);
    }

    for (i = 0; i < sizeof(physicals) / sizeof(physicals[0]); i++) {
        colourBack("colour", &colour, physicals[i]);
        colourBack("mono", &mono, physicals[i]);
    }

    red = colourInfo("colour", &colour, 0x0000ffL);
    white = colourInfo("colour", &colour, 0xffffffL);
    yellow = colourInfo("colour", &colour, 0x00ffffL);
    blue = colourInfo("colour", &colour, 0xff0000L);
    black = colourInfo("colour", &colour, 0x000000L);
    green = colourInfo("colour", &colour, 0x00ff00L);

    _fmemset(colourBits, 0, sizeof(colourBits));
    setPixel("colour", &colour, 1, 0, red, R2_COPYPEN);
    setPixel("colour", &colour, 2, 1, white, R2_XORPEN);
    setPixel("colour", &colour, 2, 1, yellow, R2_XORPEN);
    setPixel("colour", &colour, 3, 2, yellow, R2_NOT);
    setPixel("colour", &colour, 15, 7, blue, R2_MERGEPEN);
    setPixel("colour", &colour, 15, 7, red, R2_MERGEPEN);
    setPixel("colour", &colour, 8, 3, green, R2_WHITE);
    setPixel("colour", &colour, 9, 3, green, R2_MASKNOTPEN);
    setPixel("colour", &colour, 8, 3, red, R2_NOTMASKPEN);
    setPixel("colour", &colour, 16, 0, red, R2_COPYPEN);
    setPixel("colour", &colour, 0, 8, red, R2_COPYPEN);
    setPixel("colour", &colour, -1, 0, red, R2_COPYPEN);

    for (i = 3; i <= 6; i++) {
        setPixel("colour", &colour, i, 4, red, R2_COPYPEN);
    }

    for (i = 1; i <= 16; i++) {
        setPixel("colour", &colour, i % 16, 5, red, i);
    }

    hex(probeResult, colourBits, sizeof(colourBits));
    probe("bits", "colour", probeResult);

    getPixel("colour", &colour, 1, 0);
    getPixel("colour", &colour, 2, 1);
    getPixel("colour", &colour, 3, 2);
    getPixel("colour", &colour, 15, 7);
    getPixel("colour", &colour, 8, 3);
    getPixel("colour", &colour, 5, 5);
    getPixel("colour", &colour, 0, 0);
    getPixel("colour", &colour, 16, 0);
    getPixel("colour", &colour, 3, 9);

    for (i = 0; i < 4; i++) {
        scan("colour", &colour, 0, 4, red, i);
        scan("colour", &colour, 4, 4, red, i);
        scan("colour", &colour, 8, 4, red, i);
        scan("colour", &colour, 15, 4, black, i);
        scan("colour", &colour, 0, 4, black, i);
        scan("colour", &colour, 15, 6, black, i);
    }

    scan("colour", &colour, 16, 4, red, 0);
    scan("colour", &colour, 0, 8, red, 0);
    scan("colour", &colour, -1, 4, red, 2);

    for (i = 0; i < sizeof(monoBits); i++) {
        monoBits[i] = (BYTE)(i & 1 ? 0x0f : 0xf0);
    }

    physical = colourInfo("mono", &mono, 0xffffffL);
    setPixel("mono", &mono, 0, 0, physical, R2_COPYPEN);
    setPixel("mono", &mono, 5, 1, physical, R2_XORPEN);
    setPixel("mono", &mono, 12, 2, black, R2_COPYPEN);
    setPixel("mono", &mono, 13, 3, black, R2_NOT);
    setPixel("mono", &mono, 7, 4, yellow, R2_COPYPEN);
    setPixel("mono", &mono, 6, 4, red, R2_COPYPEN);
    setPixel("mono", &mono, 20, 4, red, R2_COPYPEN);
    hex(probeResult, monoBits, sizeof(monoBits));
    probe("bits", "mono", probeResult);

    getPixel("mono", &mono, 0, 0);
    getPixel("mono", &mono, 5, 1);
    getPixel("mono", &mono, 12, 2);
    getPixel("mono", &mono, 8, 0);
    getPixel("mono", &mono, 16, 1);

    for (i = 0; i < 4; i++) {
        scan("mono", &mono, 0, 0, physical, i);
        scan("mono", &mono, 3, 2, physical, i);
        scan("mono", &mono, 12, 5, black, i);
        scan("mono", &mono, 15, 7, black, i);
    }

    pens = MakeProcInstance((FARPROC)PenSeen, instance);
    brushes = MakeProcInstance((FARPROC)BrushSeen, instance);
    enumerated("pens colour", &colour, OBJ_PEN, pens, 0);
    enumerated("brushes colour", &colour, OBJ_BRUSH, brushes, 0);
    enumerated("pens mono", &mono, OBJ_PEN, pens, 0);
    enumerated("brushes mono", &mono, OBJ_BRUSH, brushes, 0);
    enumerated("pens", &colour, OBJ_PEN, pens, 3);
    enumerated("brushes", &colour, OBJ_BRUSH, brushes, 3);
    enumerated("other", &colour, 3, pens, 0);

    wsprintf(probeResult, "%04x",
             HIWORD(colorInfo((LPSTR)other, 0x0000ffL, (LPSTR)&physical)));
    probe("notbitmap", "colorinfo", probeResult);
    wsprintf(probeResult, "%04x", HIWORD(pixel((LPSTR)other, 1, 1, 0L, NULL)));
    probe("notbitmap", "pixel", probeResult);
    wsprintf(probeResult, "%04x",
             HIWORD(colorInfo((LPSTR)dib, 0x0000ffL, (LPSTR)&physical)));
    probe("notbitmap", "dib colorinfo", probeResult);

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
