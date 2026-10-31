/*
 * GDI's device-independent helpers for drivers that draw, called as a
 * printer's driver calls them when GDI hands it a memory bitmap: each found
 * in GDI by its number and given a `BITMAP` laid out in the probe's own
 * memory, of the display's own format ("colour": its planes and bits a
 * pixel) or of one plane ("mono"), 32 pixels by 8. Each record of bits is
 * the whole bitmap's bytes, rows first and a row's planes after each other,
 * and 8 bytes past its end, laid down as A5h, to show what was written
 * beyond it. Recorded on each display (`per-display.mjs`).
 *
 * * `colour`: the physical colours `DMColorInfo` makes of the colours used.
 * * `size`: `DMRealizeObject`'s answer with no object to fill, by style.
 * * `pen`, `brush`, `font`: `DMRealizeObject` of each: the answer and the
 *   object's bytes (laid down as EEh); a brush realized at an origin too.
 * * `blt`: `DMBitBlt` under a raster operation, of a source bitmap and a
 *   brush, onto a bitmap filled with a pattern: the answer and the bits.
 * * `output`: `DMOutput` of a polyline under a pen, of scanlines under a
 *   brush, each clipped, and of the other styles: the answer and the bits.
 * * `text`, `strblt`: `DMExtTextOut` and `DMStrBlt` of a raster font laid
 *   out by the probe (version 3.0, its `FONTINFO` at 42h of its segment as
 *   GDI loads a font): the answer and the bits; a negative count, the extent.
 * * `charwidth`: `DMGetCharWidth` of a range: the answer and the widths.
 * * `dibget`, `dibset`: `DMDibBits` getting and setting scans as a DIB of
 *   1, 4, 8 and 24 bits: the answer, the DIB's bits and colours, the bits.
 * * `dibtodev`: `DMSetDibToDev` of a DIB: the answer and the bits.
 */

#define PROBE_FLUSH
#include <string.h>
#include "probe.h"

#define OUTPUT "C:\\ORACLE\\GDIDMDRW.OUT"

typedef DWORD(FAR PASCAL *COLORINFOPROC)(LPSTR, DWORD, LPSTR);
typedef int(FAR PASCAL *REALIZEPROC)(LPSTR, int, LPSTR, LPSTR, LPSTR);
typedef int(FAR PASCAL *BITBLTPROC)(LPSTR, int, int, LPSTR, int, int, int, int, DWORD, LPSTR,
                                    LPSTR);
typedef int(FAR PASCAL *OUTPUTPROC)(LPSTR, int, int, LPPOINT, LPSTR, LPSTR, LPSTR, LPRECT);
typedef DWORD(FAR PASCAL *EXTTEXTOUTPROC)(LPSTR, int, int, LPRECT, LPSTR, int, LPSTR, LPSTR,
                                          LPSTR, LPINT, LPRECT, WORD);
typedef DWORD(FAR PASCAL *STRBLTPROC)(LPSTR, int, int, LPRECT, LPSTR, int, LPSTR, LPSTR, LPSTR);
typedef int(FAR PASCAL *CHARWIDTHPROC)(LPSTR, LPINT, WORD, WORD, LPSTR, LPSTR, LPSTR);
typedef int(FAR PASCAL *DIBBITSPROC)(LPSTR, WORD, WORD, WORD, LPSTR, LPSTR, LPSTR, LPSTR);
typedef int(FAR PASCAL *DIBTODEVPROC)(LPSTR, WORD, WORD, WORD, WORD, LPRECT, LPSTR, LPSTR, LPSTR,
                                      LPSTR);

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

/* A driver's `DRAWMODE`. */
typedef struct {
    short Rop2;
    short bkMode;
    DWORD bkColor;
    DWORD TextColor;
    short TBreakExtra;
    short BreakExtra;
    short BreakErr;
    short BreakRem;
    short BreakCount;
    short CharacterExtra;
    DWORD LbkColor;
    DWORD LTextColor;
} DRAWMODE;

/* A driver's `TEXTXFORM`. */
typedef struct {
    short ftHeight;
    short ftWidth;
    short ftEscapement;
    short ftOrientation;
    short ftWeight;
    BYTE ftItalic;
    BYTE ftUnderline;
    BYTE ftStrikeOut;
    BYTE ftOutPrecision;
    BYTE ftClipPrecision;
    WORD ftAccelerator;
    short ftOverhang;
} TEXTXFORM;

/* The objects and the styles of `Output`, as the DDK numbers them. */
#define OBJ_FONT 3
#define OS_SCANLINES 4
#define OS_POLYLINE 18

#define WIDTH 32
#define HEIGHT 8
#define GUARD 8
#define MAXBITS (WIDTH * HEIGHT + GUARD)

static COLORINFOPROC colorInfo;
static REALIZEPROC realize;
static BITBLTPROC bitBlt;
static OUTPUTPROC output;
static EXTTEXTOUTPROC extTextOut;
static STRBLTPROC strBlt;
static CHARWIDTHPROC charWidth;
static DIBBITSPROC dibBits;
static DIBTODEVPROC dibToDev;

static DRVBITMAP colour, mono, colourSource, monoSource, pattern8, monoPattern8;
static BYTE colourBits[MAXBITS], monoBits[MAXBITS], colourSourceBits[MAXBITS],
    monoSourceBits[MAXBITS], pattern8Bits[8 * 8 * 4], monoPattern8Bits[16];
static int colourSize, monoSize;
static DRAWMODE drawMode;
static TEXTXFORM xform;
static BYTE object[0x60];
static BYTE colourBrush[0x60], monoBrush[0x60], colourPen[0x20], monoPen[0x20];
static BYTE dib[512];
static BYTE info[sizeof(BITMAPINFOHEADER) + 256 * 4];
static LPSTR font;

static DWORD black, white, red, blue, green, yellow, grey, lightGrey;
static DWORD monoBlack, monoWhite;

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

/* The bitmap's bytes and its guard, after `prefix`. */
static void bitsOf(LPSTR out, DRVBITMAP *bitmap)
{
    int size = bitmap == &mono || bitmap == &monoSource ? monoSize : colourSize;

    hex(out, (BYTE FAR *)bitmap->bmBits, size + GUARD);
}

static int layOut(DRVBITMAP *bitmap, int planes, int bitsPixel, BYTE *bits, int width, int height)
{
    int widthBytes = ((width * bitsPixel + 15) / 16) * 2;

    bitmap->bmType = 0;
    bitmap->bmWidth = width;
    bitmap->bmHeight = height;
    bitmap->bmWidthBytes = widthBytes;
    bitmap->bmPlanes = (BYTE)planes;
    bitmap->bmBitsPixel = (BYTE)bitsPixel;
    bitmap->bmBits = (LPSTR)bits;
    bitmap->bmWidthPlanes = (DWORD)widthBytes * height;
    bitmap->bmlpPDevice = NULL;
    bitmap->bmSegmentIndex = 0;
    bitmap->bmScanSegment = height;
    bitmap->bmFillBytes = 0;
    return widthBytes * planes * height;
}

/* A bitmap filled with a pattern of its own, and its guard laid down. */
static void fill(DRVBITMAP *bitmap, int seed)
{
    int size = bitmap == &mono || bitmap == &monoSource ? monoSize : colourSize;
    BYTE FAR *bits = (BYTE FAR *)bitmap->bmBits;
    int i;

    for (i = 0; i < size; i++) {
        bits[i] = (BYTE)(i * seed + 7 + (i >> 3) * 13);
    }

    for (i = 0; i < GUARD; i++) {
        bits[size + i] = 0xa5;
    }
}

static DWORD physical(LPCSTR device, DRVBITMAP *bitmap, DWORD rgb)
{
    DWORD out = 0xeeeeeeeeL;
    DWORD answer = colorInfo((LPSTR)bitmap, rgb, (LPSTR)&out);

    wsprintf(probeArgs, "%s %08lx", device, rgb);
    wsprintf(probeResult, "%08lx %08lx", answer, out);
    probe("colour", probeArgs, probeResult);
    return out;
}

static void sizeOf(LPCSTR device, DRVBITMAP *bitmap, int style)
{
    static LOGPEN pen = {PS_SOLID, {1, 0}, 0x0000ffL};

    wsprintf(probeArgs, "%s %d", device, style);
    wsprintf(probeResult, "%d", realize((LPSTR)bitmap, style, (LPSTR)&pen, NULL, NULL));
    probe("size", probeArgs, probeResult);
}

static void pen(LPCSTR device, DRVBITMAP *bitmap, int style, int width, DWORD rgb, BYTE *keep)
{
    LOGPEN in;
    int answer;

    in.lopnStyle = style;
    in.lopnWidth.x = width;
    in.lopnWidth.y = 0;
    in.lopnColor = rgb;
    _fmemset(object, 0xee, sizeof(object));
    answer = realize((LPSTR)bitmap, OBJ_PEN, (LPSTR)&in, (LPSTR)object, NULL);
    wsprintf(probeArgs, "%s %d %d %08lx", device, style, width, rgb);
    wsprintf(probeResult, "%d ", answer);
    hex(probeResult + lstrlen(probeResult), object, 16);
    probe("pen", probeArgs, probeResult);

    if (keep) {
        _fmemcpy(keep, object, 0x20);
    }
}

/* The colour a hatched brush's background is realized in: GDI hands a
 * driver its logical brush with the context's background colour after it,
 * at 8, which the VGA's `RealizeObject` reads (seg1 `2ac4`). */
static DWORD brushBack = 0x00ffffffL;

/* A brush realized: `colourOrBits` is the colour, or for a pattern the
 * bitmap's far pointer; a hatched brush's background `brushBack`. */
static void brush(LPCSTR device, DRVBITMAP *bitmap, int style, DWORD colourOrBits, int hatch,
                  int x, int y, BYTE *keep)
{
    struct {
        WORD style;
        DWORD colour;
        short hatch;
        DWORD back;
    } in;
    int answer;

    in.style = style;
    in.colour = colourOrBits;
    in.hatch = hatch;
    in.back = brushBack;
    _fmemset(object, 0xee, sizeof(object));
    answer = realize((LPSTR)bitmap, OBJ_BRUSH, (LPSTR)&in, (LPSTR)object,
                     (LPSTR)MAKELONG(x, y));
    wsprintf(probeArgs, "%s %d %08lx %d at %d,%d on %08lx", device, style,
             style == BS_PATTERN ? 0L : colourOrBits, hatch, x, y, brushBack);
    wsprintf(probeResult, "%d ", answer);
    hex(probeResult + lstrlen(probeResult), object, 0x40);
    probe("brush", probeArgs, probeResult);

    if (keep) {
        _fmemcpy(keep, object, 0x60);
    }
}

static void modeOf(int rop2, int bkMode, DWORD bk, DWORD text)
{
    _fmemset(&drawMode, 0, sizeof(drawMode));
    drawMode.Rop2 = rop2;
    drawMode.bkMode = bkMode;
    drawMode.bkColor = bk;
    drawMode.TextColor = text;
}

static void blt(LPCSTR name, DRVBITMAP *dest, int x, int y, DRVBITMAP *source, int sx, int sy,
                int width, int height, DWORD rop, BYTE *pbrush)
{
    int answer;

    answer = bitBlt((LPSTR)dest, x, y, (LPSTR)source, sx, sy, width, height, rop, (LPSTR)pbrush,
                    (LPSTR)&drawMode);
    wsprintf(probeArgs, "%s %08lx", name, rop);
    wsprintf(probeResult, "%d ", answer);
    bitsOf(probeResult + lstrlen(probeResult), dest);
    probe("blt", probeArgs, probeResult);
}

static void out(LPCSTR name, DRVBITMAP *dest, int style, int count, POINT *points, BYTE *ppen,
                BYTE *pbrush, RECT *clip)
{
    int answer;

    answer = output((LPSTR)dest, style, count, (LPPOINT)points, (LPSTR)ppen, (LPSTR)pbrush,
                    (LPSTR)&drawMode, (LPRECT)clip);
    wsprintf(probeArgs, "%s %d", name, style);
    wsprintf(probeResult, "%d ", answer);
    bitsOf(probeResult + lstrlen(probeResult), dest);
    probe("output", probeArgs, probeResult);
}

static void text(LPCSTR name, DRVBITMAP *dest, int x, int y, RECT *clip, LPCSTR string,
                 int count, int *widths, RECT *opaque, WORD options)
{
    DWORD answer;

    answer = extTextOut((LPSTR)dest, x, y, (LPRECT)clip, (LPSTR)string, count, font,
                        (LPSTR)&drawMode, (LPSTR)&xform, (LPINT)widths, (LPRECT)opaque, options);
    wsprintf(probeArgs, "%s", name);
    wsprintf(probeResult, "%08lx ", answer);
    bitsOf(probeResult + lstrlen(probeResult), dest);
    probe("text", probeArgs, probeResult);
}

static void strblt(LPCSTR name, DRVBITMAP *dest, int x, int y, RECT *clip, LPCSTR string,
                   int count)
{
    DWORD answer;

    answer = strBlt((LPSTR)dest, x, y, (LPRECT)clip, (LPSTR)string, count, font,
                    (LPSTR)&drawMode, (LPSTR)&xform);
    wsprintf(probeArgs, "%s", name);
    wsprintf(probeResult, "%08lx ", answer);
    bitsOf(probeResult + lstrlen(probeResult), dest);
    probe("strblt", probeArgs, probeResult);
}

/*
 * A raster font of version 3.0 as GDI loads one, in a segment of its own:
 * the file's header at nought, its `FONTINFO` at 42h, its table of
 * characters at 94h, six bytes each, and the glyphs, a column of bytes for
 * each eight pixels across, after. Characters 40h to 45h, 8 high.
 */
static void makeFont(void)
{
    static int widths[] = {4, 5, 8, 10, 12, 3};
    BYTE FAR *f;
    HGLOBAL handle = GlobalAlloc(GMEM_FIXED | GMEM_ZEROINIT, 0x200);
    WORD bits = 0x94 + 7 * 6;
    int c, column, row;

    f = (BYTE FAR *)GlobalLock(handle);
    *(WORD FAR *)(f + 0x00) = 0x300;
    *(DWORD FAR *)(f + 0x02) = 0x200;
    *(WORD FAR *)(f + 0x42) = 0;     /* dfType: raster */
    *(WORD FAR *)(f + 0x44) = 10;    /* dfPoints */
    *(WORD FAR *)(f + 0x46) = 96;    /* dfVertRes */
    *(WORD FAR *)(f + 0x48) = 96;    /* dfHorizRes */
    *(WORD FAR *)(f + 0x4a) = 6;     /* dfAscent */
    *(WORD FAR *)(f + 0x4c) = 1;     /* dfInternalLeading */
    *(WORD FAR *)(f + 0x4e) = 0;     /* dfExternalLeading */
    *(WORD FAR *)(f + 0x53) = 400;   /* dfWeight */
    *(WORD FAR *)(f + 0x56) = 0;     /* dfPixWidth: variable */
    *(WORD FAR *)(f + 0x58) = 8;     /* dfPixHeight */
    f[0x5a] = 0x21;                  /* dfPitchAndFamily */
    *(WORD FAR *)(f + 0x5b) = 7;     /* dfAvgWidth */
    *(WORD FAR *)(f + 0x5d) = 12;    /* dfMaxWidth */
    f[0x5f] = 0x40;                  /* dfFirstChar */
    f[0x60] = 0x45;                  /* dfLastChar */
    f[0x61] = 4;                     /* dfDefaultChar: 'D' */
    f[0x62] = 0;                     /* dfBreakChar: '@' */
    *(DWORD FAR *)(f + 0x6d) = (DWORD)(LPSTR)f; /* dfBitsPointer */
    *(DWORD FAR *)(f + 0x71) = bits; /* dfBitsOffset */
    *(DWORD FAR *)(f + 0x76) = 2;    /* dfFlags: DFF_PROPORTIONAL */

    for (c = 0; c < 6; c++) {
        *(WORD FAR *)(f + 0x94 + c * 6) = widths[c];
        *(DWORD FAR *)(f + 0x94 + c * 6 + 2) = bits;

        for (column = 0; column < (widths[c] + 7) / 8; column++) {
            for (row = 0; row < 8; row++) {
                BYTE byte = (BYTE)((row * 37 + c * 53 + column * 11) ^ 0x5a);

                if (column == (widths[c] + 7) / 8 - 1 && widths[c] % 8) {
                    byte &= (BYTE)(0xff << (8 - widths[c] % 8));
                }

                f[bits++] = byte;
            }
        }
    }

    /* The sentinel past the last, as a font file has it. */
    *(WORD FAR *)(f + 0x94 + 6 * 6) = 0;
    *(DWORD FAR *)(f + 0x94 + 6 * 6 + 2) = bits;
    font = (LPSTR)(f + 0x42);
}

static void charWidths(LPCSTR name, DRVBITMAP *dest, WORD first, WORD last)
{
    int widths[16];
    int answer;
    int i;

    for (i = 0; i < 16; i++) {
        widths[i] = -99;
    }

    answer = charWidth((LPSTR)dest, (LPINT)widths, first, last, font, (LPSTR)&drawMode,
                       (LPSTR)&xform);
    wsprintf(probeArgs, "%s %u-%u", name, first, last);
    wsprintf(probeResult, "%d", answer);

    for (i = 0; i < 12; i++) {
        wsprintf(probeResult + lstrlen(probeResult), " %d", widths[i]);
    }

    probe("charwidth", probeArgs, probeResult);
}

/* A DIB's header for 32 by 8 at `bits` bits a pixel, its colours laid down. */
static void dibInfo(int bits, int colours)
{
    BITMAPINFOHEADER FAR *header = (BITMAPINFOHEADER FAR *)info;
    RGBQUAD FAR *table = (RGBQUAD FAR *)(info + sizeof(BITMAPINFOHEADER));
    int i;

    _fmemset(info, 0xee, sizeof(info));
    header->biSize = sizeof(BITMAPINFOHEADER);
    header->biWidth = WIDTH;
    header->biHeight = HEIGHT;
    header->biPlanes = 1;
    header->biBitCount = bits;
    header->biCompression = 0;
    header->biSizeImage = 0;
    header->biXPelsPerMeter = 0;
    header->biYPelsPerMeter = 0;
    header->biClrUsed = 0;
    header->biClrImportant = 0;

    for (i = 0; i < colours; i++) {
        table[i].rgbBlue = (BYTE)(i * 85);
        table[i].rgbGreen = (BYTE)(i & 1 ? 0xff : i * 16);
        table[i].rgbRed = (BYTE)(i & 2 ? 0x80 : 255 - i * 16);
        table[i].rgbReserved = 0;
    }
}

static int dibBytes(int bits)
{
    return ((WIDTH * bits + 31) / 32) * 4 * HEIGHT;
}

static void dibGet(LPCSTR name, DRVBITMAP *dest, int bits, int start, int scans)
{
    int colours = bits <= 8 ? 1 << bits : 0;
    int answer;

    dibInfo(bits, 0);
    _fmemset(dib, 0xee, sizeof(dib));
    answer = dibBits((LPSTR)dest, 1, start, scans, (LPSTR)dib, (LPSTR)info, (LPSTR)&drawMode,
                     NULL);
    wsprintf(probeArgs, "%s %d %d %d", name, bits, start, scans);
    wsprintf(probeResult, "%d ", answer);
    hex(probeResult + lstrlen(probeResult), dib, dibBytes(bits) / HEIGHT * scans);
    lstrcat(probeResult, " colours ");
    hex(probeResult + lstrlen(probeResult), info + sizeof(BITMAPINFOHEADER),
        colours > 16 ? 64 : colours * 4);
    probe("dibget", probeArgs, probeResult);
}

static void dibPattern(int bits)
{
    int i;

    for (i = 0; i < sizeof(dib); i++) {
        dib[i] = (BYTE)(i * 23 + 5);
    }

    dibInfo(bits, bits <= 8 ? 1 << bits : 0);
}

static void dibSet(LPCSTR name, DRVBITMAP *dest, int bits, int start, int scans)
{
    int answer;

    dibPattern(bits);
    answer = dibBits((LPSTR)dest, 0, start, scans, (LPSTR)dib, (LPSTR)info, (LPSTR)&drawMode,
                     NULL);
    wsprintf(probeArgs, "%s %d %d %d", name, bits, start, scans);
    wsprintf(probeResult, "%d ", answer);
    bitsOf(probeResult + lstrlen(probeResult), dest);
    probe("dibset", probeArgs, probeResult);
}

static void dibDevice(LPCSTR name, DRVBITMAP *dest, int bits, int x, int y, int start, int scans,
                      RECT *clip)
{
    int answer;

    dibPattern(bits);
    answer = dibToDev((LPSTR)dest, x, y, start, scans, (LPRECT)clip, (LPSTR)&drawMode,
                      (LPSTR)dib, (LPSTR)info, NULL);
    wsprintf(probeArgs, "%s %d %d,%d %d %d", name, bits, x, y, start, scans);
    wsprintf(probeResult, "%d ", answer);
    bitsOf(probeResult + lstrlen(probeResult), dest);
    probe("dibtodev", probeArgs, probeResult);
}

/* The raster operations put to each blit: the named ones and two others. */
static DWORD rops[] = {SRCCOPY,   SRCPAINT,  SRCAND,    SRCINVERT, SRCERASE,
                       NOTSRCCOPY, NOTSRCERASE, MERGECOPY, MERGEPAINT, PATCOPY,
                       PATPAINT,  PATINVERT, DSTINVERT, BLACKNESS, WHITENESS,
                       0x00b8074aL, 0x006a01e9L};

static void blits(LPCSTR device, DRVBITMAP *dest, DRVBITMAP *source, BYTE *pbrush)
{
    char name[64];
    int i;

    for (i = 0; i < sizeof(rops) / sizeof(rops[0]); i++) {
        fill(dest, 29);
        fill(source, 41);
        wsprintf(name, "%s", device);
        blt(name, dest, 3, 1, source, 1, 2, 22, 5, rops[i], pbrush);
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static POINT line[] = {{1, 1}, {30, 6}, {5, 7}, {2, 0}, {17, 3}};
    static POINT scans[] = {{3, 2}, {1, 10}, {15, 29}, {31, 31}};
    static POINT box[] = {{2, 1}, {20, 6}};
    static RECT all = {0, 0, WIDTH, HEIGHT};
    static RECT part = {4, 2, 20, 6};
    static RECT wide = {0, 0, WIDTH, HEIGHT};
    static RECT opaque = {2, 1, 30, 7};
    static int fixed[] = {6, 6, 6, 6, 6};
    static int styles[] = {1, 2, 3, 6, 7, 20, 22, 0x80 | 18};
    HDC screen;
    int planes, bitsPixel;
    int i;

    probeOpen(OUTPUT);

    colorInfo = (COLORINFOPROC)gdiProc(202);
    bitBlt = (BITBLTPROC)gdiProc(201);
    output = (OUTPUTPROC)gdiProc(208);
    realize = (REALIZEPROC)gdiProc(210);
    strBlt = (STRBLTPROC)gdiProc(211);
    extTextOut = (EXTTEXTOUTPROC)gdiProc(214);
    charWidth = (CHARWIDTHPROC)gdiProc(215);
    dibBits = (DIBBITSPROC)gdiProc(217);
    dibToDev = (DIBTODEVPROC)gdiProc(219);

    screen = GetDC(0);
    planes = GetDeviceCaps(screen, PLANES);
    bitsPixel = GetDeviceCaps(screen, BITSPIXEL);
    ReleaseDC(0, screen);

    wsprintf(probeResult, "%d %d", planes, bitsPixel);
    probe("display", "planes bits", probeResult);

    colourSize = layOut(&colour, planes, bitsPixel, colourBits, WIDTH, HEIGHT);
    layOut(&colourSource, planes, bitsPixel, colourSourceBits, WIDTH, HEIGHT);
    monoSize = layOut(&mono, 1, 1, monoBits, WIDTH, HEIGHT);
    layOut(&monoSource, 1, 1, monoSourceBits, WIDTH, HEIGHT);
    layOut(&pattern8, planes, bitsPixel, pattern8Bits, 8, 8);
    layOut(&monoPattern8, 1, 1, monoPattern8Bits, 8, 8);

    for (i = 0; i < sizeof(pattern8Bits); i++) {
        pattern8Bits[i] = (BYTE)(i * 59 + 3);
    }

    for (i = 0; i < sizeof(monoPattern8Bits); i++) {
        monoPattern8Bits[i] = (BYTE)(i * 0x35 + 0x81);
    }

    black = physical("colour", &colour, 0x000000L);
    white = physical("colour", &colour, 0xffffffL);
    red = physical("colour", &colour, 0x0000ffL);
    blue = physical("colour", &colour, 0xff0000L);
    green = physical("colour", &colour, 0x00ff00L);
    yellow = physical("colour", &colour, 0x00ffffL);
    grey = physical("colour", &colour, 0x808080L);
    lightGrey = physical("colour", &colour, 0xc0c0c0L);
    monoBlack = physical("mono", &mono, 0x000000L);
    monoWhite = physical("mono", &mono, 0xffffffL);

    /* Objects. */
    sizeOf("colour", &colour, OBJ_PEN);
    sizeOf("colour", &colour, OBJ_BRUSH);
    sizeOf("colour", &colour, OBJ_FONT);
    sizeOf("colour", &colour, 0);
    sizeOf("colour", &colour, 4);
    sizeOf("colour", &colour, 5);
    sizeOf("colour", &colour, -1);
    sizeOf("colour", &colour, -2);
    sizeOf("mono", &mono, OBJ_PEN);
    sizeOf("mono", &mono, OBJ_BRUSH);

    pen("colour", &colour, PS_SOLID, 0, 0x0000ffL, colourPen);
    pen("colour", &colour, PS_SOLID, 1, 0xff0000L, NULL);
    pen("colour", &colour, PS_DASH, 1, 0x00ff00L, NULL);
    pen("colour", &colour, PS_DOT, 0, 0x4080c0L, NULL);
    pen("colour", &colour, PS_SOLID, 3, 0x0000ffL, NULL);
    pen("colour", &colour, PS_DASHDOTDOT, 3, 0x0000ffL, NULL);
    pen("colour", &colour, PS_NULL, 0, 0x000000L, NULL);
    pen("colour", &colour, PS_INSIDEFRAME, 1, 0x0000ffL, NULL);
    pen("colour", &colour, PS_DASHDOTDOT, 0, 0xffffffL, NULL);
    pen("colour", &colour, 7, 0, 0xffffffL, NULL);
    pen("mono", &mono, PS_SOLID, 0, 0xffffffL, monoPen);
    pen("mono", &mono, PS_DASH, 0, 0x0000ffL, NULL);
    pen("mono", &mono, PS_SOLID, 0, 0x00ffffL, NULL);

    brush("colour", &colour, BS_SOLID, 0x0000ffL, 0, 0, 0, NULL);
    brush("colour", &colour, BS_SOLID, 0x808080L, 0, 0, 0, NULL);
    brush("colour", &colour, BS_SOLID, 0x4080c0L, 0, 0, 0, NULL);
    brush("colour", &colour, BS_SOLID, 0x40ff00L, 0, 0, 0, NULL);
    brush("colour", &colour, BS_SOLID, 0x4080c0L, 0, 3, 2, NULL);
    brush("colour", &colour, BS_SOLID, 0x4080c0L, 0, 9, 13, NULL);
    brush("colour", &colour, BS_HOLLOW, 0x0000ffL, 0, 0, 0, NULL);
    brush("colour", &colour, BS_HATCHED, 0x0000ffL, HS_HORIZONTAL, 0, 0, NULL);
    brush("colour", &colour, BS_HATCHED, 0xff0000L, HS_DIAGCROSS, 0, 0, colourBrush);
    brush("colour", &colour, BS_HATCHED, 0xff0000L, HS_DIAGCROSS, 1, 5, NULL);
    brush("colour", &colour, BS_HATCHED, 0x4080c0L, HS_BDIAGONAL, 0, 0, NULL);
    brush("colour", &colour, BS_HATCHED, 0x0000ffL, 6, 0, 0, NULL);
    brushBack = 0x00ffffL;
    brush("colour", &colour, BS_HATCHED, 0xff0000L, HS_CROSS, 0, 0, NULL);
    brush("colour", &colour, BS_HATCHED, 0x808080L, HS_FDIAGONAL, 3, 6, NULL);
    brushBack = 0x00ffffffL;
    brush("colour", &colour, BS_SOLID, 0x000000L, 0, 3, 2, NULL);
    brush("colour", &colour, BS_SOLID, 0xffffffL, 0, 3, 2, NULL);
    brush("colour", &colour, BS_SOLID, 0x10e0e0e0L, 0, 0, 0, NULL);
    brush("colour", &colour, BS_SOLID, 0x00c0c0c0L, 0, 0, 0, NULL);
    brush("colour", &colour, BS_SOLID, 0x00ff8040L, 0, 0, 0, NULL);
    brush("colour", &colour, BS_SOLID, 0x0020a0ffL, 0, 5, 7, NULL);
    brush("colour", &colour, BS_PATTERN, (DWORD)(LPSTR)&pattern8, 0, 0, 0, NULL);
    brush("colour", &colour, BS_PATTERN, (DWORD)(LPSTR)&monoPattern8, 0, 0, 0, NULL);
    brush("colour", &colour, BS_PATTERN, (DWORD)(LPSTR)&pattern8, 0, 2, 1, NULL);
    brush("colour", &colour, 7, 0x0000ffL, 0, 0, 0, NULL);
    brush("mono", &mono, BS_SOLID, 0x808080L, 0, 0, 0, NULL);
    brush("mono", &mono, BS_SOLID, 0x0000ffL, 0, 0, 0, NULL);
    brush("mono", &mono, BS_SOLID, 0xffffffL, 0, 0, 0, NULL);
    brush("mono", &mono, BS_HATCHED, 0x000000L, HS_CROSS, 0, 0, monoBrush);
    brush("mono", &mono, BS_PATTERN, (DWORD)(LPSTR)&monoPattern8, 0, 0, 0, NULL);

    {
        LOGFONT logical;
        int answer;

        _fmemset(&logical, 0, sizeof(logical));
        logical.lfHeight = 8;
        lstrcpy(logical.lfFaceName, "System");
        _fmemset(object, 0xee, sizeof(object));
        answer = realize((LPSTR)&colour, OBJ_FONT, (LPSTR)&logical, (LPSTR)object,
                         (LPSTR)&xform);
        wsprintf(probeResult, "%d ", answer);
        hex(probeResult + lstrlen(probeResult), object, 16);
        probe("font", "colour", probeResult);
    }

    /* Blits. */
    modeOf(R2_COPYPEN, OPAQUE, white, black);
    blits("colour", &colour, &colourSource, colourBrush);
    blits("mono", &mono, &monoSource, monoBrush);

    brush("colour", &colour, BS_SOLID, 0x4080c0L, 0, 0, 0, colourBrush);
    fill(&colour, 29);
    blt("colour dithered", &colour, 3, 1, NULL, 0, 0, 22, 5, PATCOPY, colourBrush);
    fill(&colour, 29);
    blt("colour dithered", &colour, 3, 1, NULL, 0, 0, 22, 5, PATINVERT, colourBrush);
    brush("colour", &colour, BS_PATTERN, (DWORD)(LPSTR)&monoPattern8, 0, 0, 0, colourBrush);
    modeOf(R2_COPYPEN, OPAQUE, blue, red);
    fill(&colour, 29);
    blt("colour monopattern", &colour, 3, 1, NULL, 0, 0, 22, 5, PATCOPY, colourBrush);
    brush("colour", &colour, BS_PATTERN, (DWORD)(LPSTR)&pattern8, 0, 0, 0, colourBrush);
    fill(&colour, 29);
    blt("colour pattern", &colour, 3, 1, NULL, 0, 0, 22, 5, PATCOPY, colourBrush);
    brush("colour", &colour, BS_HATCHED, 0xff0000L, HS_DIAGCROSS, 0, 0, colourBrush);
    fill(&colour, 29);
    blt("colour hatched", &colour, 3, 1, NULL, 0, 0, 22, 5, PATCOPY, colourBrush);
    modeOf(R2_COPYPEN, TRANSPARENT, blue, red);
    fill(&colour, 29);
    blt("colour hatched transparent", &colour, 3, 1, NULL, 0, 0, 22, 5, PATCOPY, colourBrush);

    modeOf(R2_COPYPEN, OPAQUE, blue, red);
    fill(&colour, 29);
    fill(&monoSource, 41);
    blt("colour from mono", &colour, 3, 1, &monoSource, 1, 2, 22, 5, SRCCOPY, colourBrush);
    fill(&colour, 29);
    blt("colour from mono", &colour, 3, 1, &monoSource, 1, 2, 22, 5, SRCINVERT, colourBrush);
    modeOf(R2_COPYPEN, OPAQUE, colourSourceBits[0] ? red : blue, white);
    fill(&mono, 29);
    fill(&colourSource, 41);
    modeOf(R2_COPYPEN, OPAQUE, red, white);
    blt("mono from colour bk red", &mono, 3, 1, &colourSource, 1, 2, 22, 5, SRCCOPY,
        monoBrush);
    modeOf(R2_COPYPEN, OPAQUE, black, white);
    fill(&mono, 29);
    blt("mono from colour bk black", &mono, 3, 1, &colourSource, 1, 2, 22, 5, SRCCOPY,
        monoBrush);

    modeOf(R2_COPYPEN, OPAQUE, white, black);
    fill(&colour, 29);
    blt("colour overlap right", &colour, 4, 2, &colour, 1, 1, 22, 5, SRCCOPY, colourBrush);
    fill(&colour, 29);
    blt("colour overlap left", &colour, 1, 1, &colour, 4, 2, 22, 5, SRCCOPY, colourBrush);
    fill(&mono, 29);
    blt("mono overlap right", &mono, 4, 2, &mono, 1, 1, 22, 5, SRCCOPY, monoBrush);
    fill(&colour, 29);
    blt("colour edge", &colour, 28, 6, &colourSource, 0, 0, 8, 4, SRCCOPY, colourBrush);
    fill(&colour, 29);
    blt("colour wide", &colour, 0, 0, &colourSource, 0, 0, 32, 8, NOTSRCCOPY, colourBrush);
    fill(&colour, 29);
    blt("colour narrow", &colour, 9, 3, &colourSource, 13, 0, 3, 2, SRCCOPY, colourBrush);

    /* Output. */
    modeOf(R2_COPYPEN, OPAQUE, white, black);
    pen("colour", &colour, PS_SOLID, 0, 0x0000ffL, colourPen);
    brush("colour", &colour, BS_SOLID, 0x4080c0L, 0, 0, 0, colourBrush);
    fill(&colour, 29);
    out("colour polyline", &colour, OS_POLYLINE, 5, line, colourPen, colourBrush, &all);
    fill(&colour, 29);
    out("colour polyline clipped", &colour, OS_POLYLINE, 5, line, colourPen, colourBrush, &part);
    modeOf(R2_XORPEN, OPAQUE, white, black);
    fill(&colour, 29);
    out("colour polyline xor", &colour, OS_POLYLINE, 5, line, colourPen, colourBrush, &all);
    modeOf(R2_NOT, OPAQUE, white, black);
    fill(&colour, 29);
    out("colour polyline not", &colour, OS_POLYLINE, 5, line, colourPen, colourBrush, &all);
    pen("colour", &colour, PS_DASH, 1, 0x00ff00L, colourPen);
    modeOf(R2_COPYPEN, OPAQUE, blue, black);
    fill(&colour, 29);
    out("colour polyline dash", &colour, OS_POLYLINE, 5, line, colourPen, colourBrush, &all);
    modeOf(R2_COPYPEN, TRANSPARENT, blue, black);
    fill(&colour, 29);
    out("colour polyline dash transparent", &colour, OS_POLYLINE, 5, line, colourPen,
        colourBrush, &all);
    pen("colour", &colour, PS_DOT, 0, 0x4080c0L, colourPen);
    modeOf(R2_COPYPEN, OPAQUE, white, black);
    fill(&colour, 29);
    out("colour polyline dot", &colour, OS_POLYLINE, 5, line, colourPen, colourBrush, &all);
    pen("colour", &colour, PS_SOLID, 0, 0x0000ffL, colourPen);
    fill(&colour, 29);
    out("colour scanlines", &colour, OS_SCANLINES, 4, scans, colourPen, colourBrush, &all);
    fill(&colour, 29);
    out("colour scanlines clipped", &colour, OS_SCANLINES, 4, scans, colourPen, colourBrush,
        &part);
    modeOf(R2_XORPEN, OPAQUE, white, black);
    fill(&colour, 29);
    out("colour scanlines xor", &colour, OS_SCANLINES, 4, scans, colourPen, colourBrush, &all);
    modeOf(R2_COPYPEN, OPAQUE, white, black);
    brush("colour", &colour, BS_HATCHED, 0xff0000L, HS_DIAGCROSS, 0, 0, colourBrush);
    fill(&colour, 29);
    out("colour scanlines hatched", &colour, OS_SCANLINES, 4, scans, colourPen, colourBrush,
        &all);
    modeOf(R2_COPYPEN, TRANSPARENT, white, black);
    fill(&colour, 29);
    out("colour scanlines hatched transparent", &colour, OS_SCANLINES, 4, scans, colourPen,
        colourBrush, &all);
    modeOf(R2_COPYPEN, OPAQUE, white, black);
    fill(&colour, 29);
    out("colour scanlines nobrush", &colour, OS_SCANLINES, 4, scans, colourPen, NULL, &all);

    modeOf(R2_COPYPEN, OPAQUE, monoBlack, monoWhite);
    fill(&mono, 29);
    out("mono polyline", &mono, OS_POLYLINE, 5, line, monoPen, monoBrush, &all);
    fill(&mono, 29);
    out("mono polyline clipped", &mono, OS_POLYLINE, 5, line, monoPen, monoBrush, &part);
    fill(&mono, 29);
    out("mono scanlines", &mono, OS_SCANLINES, 4, scans, monoPen, monoBrush, &all);

    brush("colour", &colour, BS_SOLID, 0x0000ffL, 0, 0, 0, colourBrush);

    for (i = 0; i < sizeof(styles) / sizeof(styles[0]); i++) {
        fill(&colour, 29);
        out("colour other", &colour, styles[i], 2, box, colourPen, colourBrush, &all);
    }

    /* Text. */
    makeFont();
    _fmemset(&xform, 0, sizeof(xform));
    xform.ftHeight = 8;
    xform.ftWeight = 400;

    modeOf(R2_COPYPEN, TRANSPARENT, blue, red);
    fill(&colour, 29);
    text("colour transparent", &colour, 1, 0, &all, "ABCD", 4, NULL, NULL, 0);
    modeOf(R2_COPYPEN, OPAQUE, blue, yellow);
    fill(&colour, 29);
    text("colour opaque", &colour, 3, 0, &all, "BCE", 3, NULL, NULL, 0);
    fill(&colour, 29);
    text("colour clipped", &colour, 1, 0, &part, "ABCD", 4, NULL, NULL, 0);
    fill(&colour, 29);
    text("colour eto opaque", &colour, 3, 0, &wide, "BC", 2, NULL, &opaque, ETO_OPAQUE);
    fill(&colour, 29);
    text("colour eto clipped", &colour, 3, 0, &wide, "BCDE", 4, NULL, &opaque, ETO_CLIPPED);
    fill(&colour, 29);
    text("colour eto both", &colour, 3, 0, &wide, "BCDE", 4, NULL, &opaque,
         ETO_OPAQUE | ETO_CLIPPED);
    fill(&colour, 29);
    text("colour widths", &colour, 0, 0, &all, "ABCDE", 5, fixed, NULL, 0);
    fill(&colour, 29);
    text("colour negative x", &colour, -3, 1, &all, "CD", 2, NULL, NULL, 0);
    fill(&colour, 29);
    text("colour default", &colour, 1, 0, &all, "AZ@", 3, NULL, NULL, 0);
    drawMode.CharacterExtra = 2;
    fill(&colour, 29);
    text("colour extra", &colour, 0, 0, &all, "A@B", 3, NULL, NULL, 0);
    drawMode.CharacterExtra = 0;
    drawMode.TBreakExtra = 5;
    drawMode.BreakExtra = 2;
    drawMode.BreakErr = 1;
    drawMode.BreakRem = 1;
    drawMode.BreakCount = 2;
    fill(&colour, 29);
    text("colour break", &colour, 0, 0, &all, "A@B@C", 5, NULL, NULL, 0);
    modeOf(R2_COPYPEN, OPAQUE, blue, yellow);
    xform.ftWeight = 700;
    fill(&colour, 29);
    text("colour bold", &colour, 1, 0, &all, "AB", 2, NULL, NULL, 0);
    xform.ftWeight = 400;
    fill(&colour, 29);
    text("colour extent", &colour, 1, 0, &all, "ABCD", -4, NULL, NULL, 0);
    drawMode.CharacterExtra = 3;
    text("colour extent extra", &colour, 1, 0, &all, "ABCD", -4, NULL, NULL, 0);
    drawMode.CharacterExtra = 0;
    modeOf(R2_COPYPEN, TRANSPARENT, monoBlack, monoWhite);
    fill(&mono, 29);
    text("mono transparent", &mono, 1, 0, &all, "ABCD", 4, NULL, NULL, 0);
    modeOf(R2_COPYPEN, OPAQUE, monoWhite, monoBlack);
    fill(&mono, 29);
    text("mono opaque", &mono, 3, 0, &part, "BCE", 3, NULL, NULL, 0);

    modeOf(R2_COPYPEN, OPAQUE, blue, yellow);
    fill(&colour, 29);
    strblt("colour", &colour, 2, 0, &all, "ABC", 3);
    fill(&colour, 29);
    strblt("colour extent", &colour, 2, 0, &all, "ABC", -3);

    charWidths("colour", &colour, 0x40, 0x45);
    charWidths("colour", &colour, 0x3e, 0x47);
    charWidths("colour", &colour, 0x43, 0x41);
    xform.ftWeight = 700;
    charWidths("colour bold", &colour, 0x40, 0x45);
    xform.ftWeight = 400;
    charWidths("mono", &mono, 0x40, 0x45);

    /* Device-independent bits. */
    modeOf(R2_COPYPEN, OPAQUE, white, black);
    fill(&colour, 29);
    dibGet("colour", &colour, 1, 0, 8);
    dibGet("colour", &colour, 4, 0, 8);
    dibGet("colour", &colour, 8, 2, 3);
    dibGet("colour", &colour, 24, 1, 2);
    dibGet("colour", &colour, 4, 6, 5);
    fill(&mono, 29);
    dibGet("mono", &mono, 1, 0, 8);
    dibGet("mono", &mono, 4, 0, 8);
    fill(&colour, 29);
    dibSet("colour", &colour, 1, 0, 8);
    fill(&colour, 29);
    dibSet("colour", &colour, 4, 0, 8);
    fill(&colour, 29);
    dibSet("colour", &colour, 8, 2, 3);
    fill(&colour, 29);
    dibSet("colour", &colour, 24, 1, 2);
    fill(&mono, 29);
    dibSet("mono", &mono, 1, 0, 8);
    fill(&mono, 29);
    dibSet("mono", &mono, 4, 0, 8);

    fill(&colour, 29);
    dibDevice("colour", &colour, 4, 2, 1, 0, 8, &all);
    fill(&colour, 29);
    dibDevice("colour clipped", &colour, 4, 2, 1, 0, 8, &part);
    fill(&mono, 29);
    dibDevice("mono", &mono, 1, 0, 0, 0, 8, &all);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
