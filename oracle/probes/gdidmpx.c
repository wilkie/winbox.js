/*
 * GDI's helpers `DMPixel`, `DMScanLR` and `DMEnumObj`, and `DMOutput`'s
 * styles 50h and 51h, on a memory bitmap of the display's own format
 * ("colour": its planes and bits a pixel) and on a monochrome one, as
 * `gdidm` asks them of the VGA's four planes alone. Recorded on each
 * display (`per-display.mjs`): the Hercules's and the 256-colour display's
 * drivers have routines of their own.
 *
 * * `pixel`: each raster operation setting a pixel, and pixels read back;
 *   `bits`: the bitmap's bytes after.
 * * `scanlr`: from points of a row each way, for the colour and for
 *   anything else, at its ends and past them; on a bitmap whose width is
 *   less than its bytes hold.
 * * `enumobj`: pens and brushes, how many, the answer, the first, second
 *   and last; `stopped`, the answer when the callback stops at the third.
 * * `output`: styles 50h and 51h, the answer, and a scanline drawn between.
 */

#include <string.h>
#include "probe.h"

#define OUTPUT "C:\\ORACLE\\GDIDMPX.OUT"

typedef DWORD(FAR PASCAL *COLORINFOPROC)(LPSTR, DWORD, LPSTR);
typedef DWORD(FAR PASCAL *PIXELPROC)(LPSTR, int, int, DWORD, LPSTR);
typedef int(FAR PASCAL *SCANLRPROC)(LPSTR, int, int, DWORD, int);
typedef int(FAR PASCAL *ENUMOBJPROC)(LPSTR, int, FARPROC, LPSTR);
typedef int(FAR PASCAL *OUTPUTPROC)(LPSTR, int, int, LPPOINT, LPSTR, LPSTR, LPSTR, LPRECT);
typedef DWORD(FAR PASCAL *REALIZEPROC)(LPSTR, int, LPSTR, LPSTR, LPSTR);

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

/* `Output`'s style for scanlines. */
#define OS_SCANLINES 4

static COLORINFOPROC colorInfo;
static PIXELPROC pixel;
static SCANLRPROC scanLR;
static ENUMOBJPROC enumObj;
static OUTPUTPROC output;
static REALIZEPROC realize;

static DRVBITMAP colour;
static DRVBITMAP mono;
static DRVBITMAP narrow;
static BYTE colourBits[WIDTH * HEIGHT * 4];
static BYTE monoBits[WIDTH / 8 * HEIGHT];
static BYTE narrowBits[WIDTH * HEIGHT * 4];
static int colourSize;
static int monoSize;
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

/* A bitmap of the planes and bits given, `width` across: its size. */
static int layOut(DRVBITMAP *bitmap, int planes, int bits, BYTE *store, int width)
{
    int widthBytes = bits == 8 ? WIDTH : (WIDTH + 15) / 16 * 2;

    bitmap->bmType = 0;
    bitmap->bmWidth = width;
    bitmap->bmHeight = HEIGHT;
    bitmap->bmWidthBytes = widthBytes;
    bitmap->bmPlanes = (BYTE)planes;
    bitmap->bmBitsPixel = (BYTE)bits;
    bitmap->bmBits = (LPSTR)store;
    bitmap->bmWidthPlanes = (DWORD)widthBytes * HEIGHT;
    bitmap->bmlpPDevice = NULL;
    bitmap->bmSegmentIndex = 0;
    bitmap->bmScanSegment = HEIGHT;
    bitmap->bmFillBytes = 0;
    return widthBytes * HEIGHT * planes;
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

/* From each point of a row, each way, for both styles. */
static void scans(LPCSTR device, DRVBITMAP *bitmap, int y, DWORD physical)
{
    static int xs[] = {0, 1, 3, 7, 8, 9, 12, 13, 14, 15, 16, -1};
    int i;
    int style;

    for (style = 0; style < 4; style++) {
        for (i = 0; i < sizeof(xs) / sizeof(xs[0]); i++) {
            scan(device, bitmap, xs[i], y, physical, style);
        }
    }
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

/* `DMOutput` of styles 50h and 51h, with a scanline between: the answers
 * and the bitmap's bytes after. */
static void begun(LPCSTR device, DRVBITMAP *bitmap, BYTE *bits, int size, DWORD rgb)
{
    static BYTE brush[64];
    static LOGBRUSH logical;
    static POINT line[2];
    static RECT clip = {0, 0, WIDTH, HEIGHT};
    int answer;

    logical.lbStyle = BS_SOLID;
    logical.lbColor = rgb;
    logical.lbHatch = 0;
    _fmemset(brush, 0, sizeof(brush));
    realize((LPSTR)bitmap, 2, (LPSTR)&logical, (LPSTR)brush, NULL);
    drawMode[0] = R2_COPYPEN;
    _fmemset(bits, 0, size);

    answer = output((LPSTR)bitmap, 0x50, 0, NULL, NULL, (LPSTR)brush, (LPSTR)drawMode, &clip);
    wsprintf(probeArgs, "%s 50", device);
    wsprintf(probeResult, "%d", answer);
    probe("output", probeArgs, probeResult);

    line[0].x = 2;
    line[0].y = 2;
    line[1].x = 3;
    line[1].y = 9;
    answer = output((LPSTR)bitmap, OS_SCANLINES, 2, line, NULL, (LPSTR)brush, (LPSTR)drawMode,
                    &clip);
    wsprintf(probeArgs, "%s scanlines", device);
    wsprintf(probeResult, "%d", answer);
    probe("output", probeArgs, probeResult);

    answer = output((LPSTR)bitmap, 0x51, 0, NULL, NULL, (LPSTR)brush, (LPSTR)drawMode, &clip);
    wsprintf(probeArgs, "%s 51", device);
    wsprintf(probeResult, "%d", answer);
    probe("output", probeArgs, probeResult);

    hex(probeResult, bits, size);
    probe("bits", device, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    DWORD red, white, black, green, yellow, blue;
    DWORD monoWhite, monoBlack;
    FARPROC pens, brushes;
    HDC screen;
    int planes;
    int bitsPixel;
    int i;

    probeOpen(OUTPUT);

    colorInfo = (COLORINFOPROC)gdiProc(202);
    enumObj = (ENUMOBJPROC)gdiProc(207);
    output = (OUTPUTPROC)gdiProc(208);
    pixel = (PIXELPROC)gdiProc(209);
    realize = (REALIZEPROC)gdiProc(210);
    scanLR = (SCANLRPROC)gdiProc(212);

    screen = GetDC(0);
    planes = GetDeviceCaps(screen, PLANES);
    bitsPixel = GetDeviceCaps(screen, BITSPIXEL);
    ReleaseDC(0, screen);

    wsprintf(probeResult, "%d %d", planes, bitsPixel);
    probe("display", "planes bits", probeResult);

    colourSize = layOut(&colour, planes, bitsPixel, colourBits, WIDTH);
    monoSize = layOut(&mono, 1, 1, monoBits, WIDTH);
    layOut(&narrow, planes, bitsPixel, narrowBits, 13);

    red = colourInfo("colour", &colour, 0x0000ffL);
    white = colourInfo("colour", &colour, 0xffffffL);
    black = colourInfo("colour", &colour, 0x000000L);
    green = colourInfo("colour", &colour, 0x00ff00L);
    yellow = colourInfo("colour", &colour, 0x00ffffL);
    blue = colourInfo("colour", &colour, 0xff0000L);
    monoWhite = colourInfo("mono", &mono, 0xffffffL);
    monoBlack = colourInfo("mono", &mono, 0x000000L);

    /* Each raster operation on a pixel of each row's start, the pen red and
     * then white. */
    _fmemset(colourBits, 0, sizeof(colourBits));

    for (i = 1; i <= 16; i++) {
        setPixel("colour", &colour, i % 16, 0, red, i);
        setPixel("colour", &colour, i % 16, 1, white, i);
    }

    setPixel("colour", &colour, 2, 2, yellow, R2_XORPEN);
    setPixel("colour", &colour, 2, 2, blue, R2_XORPEN);
    setPixel("colour", &colour, 3, 2, green, R2_MERGEPEN);
    setPixel("colour", &colour, 3, 2, red, R2_MERGEPEN);
    setPixel("colour", &colour, 16, 0, red, R2_COPYPEN);
    setPixel("colour", &colour, 0, 8, red, R2_COPYPEN);
    setPixel("colour", &colour, -1, 0, red, R2_COPYPEN);
    hex(probeResult, colourBits, colourSize);
    probe("bits", "colour", probeResult);

    getPixel("colour", &colour, 1, 0);
    getPixel("colour", &colour, 13, 0);
    getPixel("colour", &colour, 2, 2);
    getPixel("colour", &colour, 3, 2);
    getPixel("colour", &colour, 15, 7);
    getPixel("colour", &colour, 16, 0);

    _fmemset(monoBits, 0, sizeof(monoBits));

    for (i = 1; i <= 16; i++) {
        monoBits[2 * (i & 7)] = 0x5a;
        setPixel("mono", &mono, i, i & 7, monoWhite, i);
        setPixel("mono", &mono, 15 - (i & 7), i & 7, monoBlack, i);
    }

    hex(probeResult, monoBits, monoSize);
    probe("bits", "mono", probeResult);

    getPixel("mono", &mono, 1, 1);
    getPixel("mono", &mono, 6, 1);
    getPixel("mono", &mono, 14, 1);
    getPixel("mono", &mono, 16, 1);

    /* Rows to scan: in the colour bitmap a run of red from 4 to 10 on black
     * on row 4, and red to its end on row 5; in the monochrome one white
     * from 4 to 10 on row 4, and white to its end on row 5. */
    _fmemset(colourBits, 0, sizeof(colourBits));
    _fmemset(monoBits, 0, sizeof(monoBits));

    for (i = 4; i <= 10; i++) {
        setPixel("colour", &colour, i, 4, red, R2_COPYPEN);
        setPixel("mono", &mono, i, 4, monoWhite, R2_COPYPEN);
    }

    for (i = 4; i < WIDTH; i++) {
        setPixel("colour", &colour, i, 5, red, R2_COPYPEN);
        setPixel("mono", &mono, i, 5, monoWhite, R2_COPYPEN);
    }

    scans("colour", &colour, 4, red);
    scans("colour", &colour, 5, red);
    scans("colour", &colour, 6, black);
    scans("mono", &mono, 4, monoWhite);
    scans("mono", &mono, 5, monoWhite);
    scans("mono", &mono, 6, monoBlack);

    /* A bitmap 13 across whose rows hold 16: red from 4 to its 16th. */
    _fmemset(narrowBits, 0, sizeof(narrowBits));
    _fmemcpy(narrowBits, colourBits, sizeof(narrowBits));
    scans("narrow", &narrow, 5, red);
    scans("narrow", &narrow, 6, black);

    pens = MakeProcInstance((FARPROC)PenSeen, instance);
    brushes = MakeProcInstance((FARPROC)BrushSeen, instance);
    enumerated("pens colour", &colour, OBJ_PEN, pens, 0);
    enumerated("brushes colour", &colour, OBJ_BRUSH, brushes, 0);
    enumerated("pens mono", &mono, OBJ_PEN, pens, 0);
    enumerated("brushes mono", &mono, OBJ_BRUSH, brushes, 0);
    enumerated("pens", &colour, OBJ_PEN, pens, 3);
    enumerated("brushes", &colour, OBJ_BRUSH, brushes, 3);
    enumerated("other", &colour, 3, pens, 0);

    if (bitsPixel == 8) {
        begun("colour", &colour, colourBits, colourSize, 0x0000ffL);
        begun("mono", &mono, monoBits, monoSize, 0xffffffL);
    }

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
