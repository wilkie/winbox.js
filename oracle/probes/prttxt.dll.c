/*
 * A printer's driver of the probe's own, `PRTTXTD`, whose fonts are all
 * GDI's TrueType ones, as `prtteng.dll.c`'s are, but which draws: asked to
 * draw a string of a TrueType font it realized, it hands it to
 * `EngineExtTextOut`, and GDI calls its `ExtTextOut` again with the font
 * GDI drew the glyphs into. That call it draws with GDI's `DMExtTextOut`
 * on a band of its own, a monochrome memory bitmap 128 by 64, and logs:
 * what it was handed, the font's header and each character's width and
 * glyph, and the band after. `prttxt.c` copies it to `PRTTXTD.DRV`.
 *
 * Any `StrBlt`, `Output`, `BitBlt` or `Pixel` GDI asks of it is logged.
 *
 * It keeps a log, `C:\ORACLE\PRTTXT.LOG`, a line appended as each thing is
 * asked, `function`, `arguments` and `result` apart by tabs, for the probe
 * to read back as records.
 */

#define BitBlt WindowsBitBlt
#define ExtTextOut WindowsExtTextOut
#define GetCharWidth WindowsGetCharWidth
#include <windows.h>
#undef BitBlt
#undef ExtTextOut
#undef GetCharWidth

#define LOG "C:\\ORACLE\\PRTTXT.LOG"

#define WIDTH 128
#define HEIGHT 64
#define BAND_BYTES (WIDTH / 8 * HEIGHT)

/* GDI's TrueType engine and drawing helpers, which no header declares. */
DWORD FAR PASCAL EngineRealizeFont(LPLOGFONT, LPVOID, LPVOID);
int FAR PASCAL EngineGetCharWidth(LPVOID, WORD, WORD, LPINT);
DWORD FAR PASCAL EngineExtTextOut(HDC, LPVOID, WORD, WORD, LPRECT, LPSTR, int, LPVOID, LPVOID,
                                  LPVOID, LPINT, LPRECT, WORD);

typedef DWORD(FAR PASCAL *DMEXTTEXTOUTPROC)(LPSTR, int, int, LPRECT, LPSTR, int, LPSTR, LPSTR,
                                            LPSTR, LPINT, LPRECT, WORD);
typedef DWORD(FAR PASCAL *DMCOLORINFOPROC)(LPSTR, DWORD, LPSTR);

typedef struct {
    WORD type;
    WORD number;
} PDEV;

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

static char text[1200];
static char args[200];
static char call[200];
static int devices;

/* The FONTINFOs the driver realized, the last one asked about. */
static LPBYTE lastFont;
static HDC context;

static DRVBITMAP band;
static BYTE bandBits[BAND_BYTES];
static WORD drawMode[24];

static void append(LPCSTR function, LPCSTR arguments, LPCSTR result)
{
    int file = _lopen(LOG, 2);

    if (file == -1) {
        file = _lcreat(LOG, 0);
    }

    if (file == -1) {
        return;
    }

    _llseek(file, 0L, 2);
    _lwrite(file, function, lstrlen(function));
    _lwrite(file, "\t", 1);
    _lwrite(file, arguments, lstrlen(arguments));
    _lwrite(file, "\t", 1);
    _lwrite(file, result, lstrlen(result));
    _lwrite(file, "\r\n", 2);
    _lclose(file);
}

static void put(LPWORD info, int at, int value)
{
    info[at / 2] = (WORD)value;
}

static FARPROC gdiProc(int ordinal)
{
    return GetProcAddress(GetModuleHandle("GDI"), MAKEINTRESOURCE(ordinal));
}

WORD FAR PASCAL _export Enable(LPVOID lpDevice, WORD style, LPSTR device, LPSTR output, LPVOID data)
{
    (void)device;
    (void)output;
    (void)data;

    if (style & 1) {
        LPWORD info = (LPWORD)lpDevice;
        int i;

        for (i = 0; i < 0x6e / 2; i++) {
            info[i] = 0;
        }

        put(info, 0x00, 0x30a);
        put(info, 0x02, 2);
        put(info, 0x04, 5);
        put(info, 0x06, 4);
        put(info, 0x08, WIDTH);
        put(info, 0x0a, HEIGHT);
        put(info, 0x0c, WIDTH);
        put(info, 0x0e, HEIGHT);
        put(info, 0x10, 1);
        put(info, 0x12, 1);
        put(info, 0x16, 1);
        put(info, 0x18, 2);
        put(info, 0x1a, sizeof(PDEV));
        put(info, 0x1c, 0x1ff);
        put(info, 0x1e, 0xfe);
        put(info, 0x20, 0xff);
        put(info, 0x22, 0);
        put(info, 0x24, 1);
        put(info, 0x26, 0x0010);
        put(info, 0x28, 100);
        put(info, 0x2a, 100);
        put(info, 0x2c, 141);
        put(info, 0x2e, 200);
        put(info, 0x30, 254); put(info, 0x32, 254); put(info, 0x34, 96); put(info, 0x36, -96);
        put(info, 0x38, 2540); put(info, 0x3a, 2540); put(info, 0x3c, 96); put(info, 0x3e, -96);
        put(info, 0x40, 100); put(info, 0x42, 100); put(info, 0x44, 96); put(info, 0x46, -96);
        put(info, 0x48, 1000); put(info, 0x4a, 1000); put(info, 0x4c, 96); put(info, 0x4e, -96);
        put(info, 0x50, 1440); put(info, 0x52, 1440); put(info, 0x54, 96); put(info, 0x56, -96);
        put(info, 0x58, 96);
        put(info, 0x5a, 96);
        put(info, 0x5c, 1);

        return 0x6e;
    } else {
        PDEV FAR *pdev = (PDEV FAR *)lpDevice;

        pdev->type = 0x5254;
        pdev->number = ++devices;

        return 1;
    }
}

void FAR PASCAL _export Disable(PDEV FAR *pdev)
{
    (void)pdev;
}

DWORD FAR PASCAL _export ColorInfo(PDEV FAR *pdev, DWORD color, LPDWORD physical)
{
    (void)pdev;

    if (physical) {
        *physical = color & 0xffffffL;
    }

    return color & 0xffffffL;
}

WORD FAR PASCAL _export RealizeObject(PDEV FAR *pdev, int style, LPSTR in, LPSTR out, LPSTR xform)
{
    (void)pdev;

    if (style < 0) {
        return 1;
    }

    if (style == 1) {
        if (out) {
            _fmemcpy(out, in, sizeof(LOGPEN));
        }

        return sizeof(LOGPEN);
    }

    if (style == 2) {
        if (out) {
            _fmemcpy(out, in, sizeof(LOGBRUSH));
        }

        return sizeof(LOGBRUSH);
    }

    if (style == 3) {
        LPLOGFONT font = (LPLOGFONT)in;
        DWORD answer;

        answer = EngineRealizeFont(font, out ? (LPVOID)xform : NULL, (LPVOID)out);

        if (out && answer) {
            lastFont = (LPBYTE)out;
        }

        return (WORD)answer;
    }

    return 0;
}

int FAR PASCAL _export Control(PDEV FAR *pdev, WORD function, LPSTR in, LPSTR out)
{
    (void)pdev;
    (void)out;

    if (function == 8 && in) {
        WORD asked = *(LPWORD)in;

        return asked == 1 || asked == 2 || asked == 8 || asked == 9 || asked == 10 || asked == 11;
    }

    return function == 1 || function == 2 || function == 9 || function == 10 || function == 11;
}

WORD FAR PASCAL _export Output(PDEV FAR *pdev, WORD style, WORD count, LPPOINT points, LPVOID pen,
                               LPVOID brush, LPVOID drawMode, LPRECT clip)
{
    (void)pdev;
    (void)pen;
    (void)brush;
    (void)drawMode;
    (void)clip;
    wsprintf(args, "%u %u", style, count);
    wsprintf(text, "%d,%d", count ? points[0].x : 0, count ? points[0].y : 0);
    append("output", args, text);
    return 1;
}

BOOL FAR PASCAL _export BitBlt(PDEV FAR *dest, WORD x, WORD y, LPVOID source, WORD sx, WORD sy,
                               WORD width, WORD height, DWORD rop, LPVOID brush, LPVOID drawMode)
{
    (void)dest;
    (void)source;
    (void)brush;
    (void)drawMode;
    wsprintf(args, "%d,%d %d,%d %dx%d %08lx", x, y, sx, sy, width, height, rop);
    append("bitblt", args, "");
    return 1;
}

DWORD FAR PASCAL _export Pixel(PDEV FAR *pdev, WORD x, WORD y, DWORD color, LPVOID drawMode)
{
    (void)pdev;
    (void)drawMode;
    wsprintf(args, "%d,%d", x, y);
    append("pixel", args, "");
    return color;
}

WORD FAR PASCAL _export ScanLR(PDEV FAR *pdev, WORD x, WORD y, DWORD color, WORD style)
{
    (void)pdev;
    (void)x;
    (void)y;
    (void)color;
    (void)style;
    return 0x8000;
}

DWORD FAR PASCAL _export StrBlt(PDEV FAR *pdev, WORD x, WORD y, LPRECT clip, LPSTR string,
                                int count, LPVOID font, LPVOID drawMode, LPVOID xform)
{
    (void)pdev;
    (void)clip;
    (void)string;
    (void)font;
    (void)drawMode;
    (void)xform;
    wsprintf(args, "%d,%d %d", x, y, count);
    append("strblt", args, "");
    return MAKELONG(count < 0 ? -count : count, 1);
}

/* The bytes' sum, sum * 31 + byte. */
static WORD sumOf(BYTE FAR *bytes, int count)
{
    WORD sum = 0;
    int at;

    for (at = 0; at < count; at++) {
        sum = (WORD)(sum * 31 + bytes[at]);
    }

    return sum;
}

static void hexOf(LPSTR out, BYTE FAR *bytes, int count)
{
    int at;

    for (at = 0; at < count; at++) {
        wsprintf(out + at * 2, "%02x", bytes[at]);
    }

    out[count * 2] = '\0';
}

/*
 * A font GDI hands back: its header's fields, by their place in its
 * segment, and each character of the string: its width, its glyph's
 * offset in the segment, and the sum of its glyph's bytes.
 */
static void fontLogged(LPCSTR name, LPBYTE font, LPSTR string, int count)
{
    BYTE FAR *file = (BYTE FAR *)MAKELP(SELECTOROF(font), 0);
    int i;

    wsprintf(text,
             "at=%04X version=%04X type=%d points=%d res=%d,%d ascent=%d leading=%d,%d "
             "italic=%d weight=%d charset=%d pix=%d,%d pitch=%02X avg=%d max=%d chars=%d-%d "
             "default=%d break=%d widthbytes=%d flags=%08lX bitsoffset=%08lX",
             OFFSETOF(font), *(LPWORD)file, *(LPWORD)(font + 0x00), *(LPWORD)(font + 0x02),
             *(LPWORD)(font + 0x04), *(LPWORD)(font + 0x06), *(LPWORD)(font + 0x08),
             *(LPWORD)(font + 0x0a), *(LPWORD)(font + 0x0c), font[0x0e], *(LPWORD)(font + 0x11),
             font[0x13], *(LPWORD)(font + 0x14), *(LPWORD)(font + 0x16), font[0x18],
             *(LPWORD)(font + 0x19), *(LPWORD)(font + 0x1b), font[0x1d], font[0x1e],
             font[0x1f], font[0x20], *(LPWORD)(font + 0x21), *(LPDWORD)(font + 0x34),
             *(LPDWORD)(font + 0x2f));
    append("font", name, text);

    for (i = 0; i < count; i++) {
        BYTE c = (BYTE)string[i];
        int index = c - font[0x1d];
        BYTE FAR *entry = font + 0x52 + index * 6;
        WORD width = *(LPWORD)entry;
        WORD offset = LOWORD(*(LPDWORD)(entry + 2));
        int size = ((width + 7) / 8) * *(LPWORD)(font + 0x16);

        if (index < 0 || c > font[0x1e] || *(LPWORD)file < 0x300) {
            wsprintf(text, "outside");
        } else {
            wsprintf(text, "width=%u offset=%s sum=%04X", width, (LPSTR)(offset ? "some" : "none"),
                     offset ? sumOf(file + offset, size) : 0);
        }

        wsprintf(args, "%s %02X", name, c);
        append("glyph", args, text);
    }
}

static void bandLogged(LPCSTR name)
{
    int part;
    int set = 0;
    int i;

    for (i = 0; i < BAND_BYTES; i++) {
        BYTE b = bandBits[i];

        while (b) {
            set += b & 1;
            b >>= 1;
        }
    }

    wsprintf(text, "set=%d sum=%04X", set, sumOf(bandBits, BAND_BYTES));
    append("band", name, text);

    for (part = 0; part < 4; part++) {
        wsprintf(args, "%s %d", name, part);
        hexOf(text, bandBits + part * (BAND_BYTES / 4), BAND_BYTES / 4);
        append("bandrows", args, text);
    }
}

/*
 * A string of a font of its own handed to the engine; one of GDI's font
 * drawn on the band with `DMExtTextOut`, its colours made the band's.
 */
DWORD FAR PASCAL _export ExtTextOut(PDEV FAR *pdev, WORD x, WORD y, LPRECT clip, LPSTR string,
                                    int count, LPVOID font, LPVOID mode, LPVOID xform,
                                    LPINT widths, LPRECT opaque, WORD options)
{
    DWORD answer;
    LPWORD given = (LPWORD)mode;
    LPINT form = (LPINT)xform;
    int i;

    if ((LPBYTE)font == lastFont) {
        answer = EngineExtTextOut(context, pdev, x, y, clip, string, count, font, mode, xform,
                                  widths, opaque, options);
        wsprintf(args, "%d,%d %d %u", x, y, count, options);

        /* GDI answers the context's device as it was: the `PDEVICE` it
         * handed the driver, whose selector is GDI's own. */
        if (answer == (DWORD)(LPVOID)pdev) {
            lstrcpy(text, "pdevice");
        } else {
            wsprintf(text, "%u,%u", LOWORD(answer), HIWORD(answer));
        }

        append("engine", args, text);
        return answer;
    }

    wsprintf(args, "%d,%d %d %u", x, y, count, options);
    wsprintf(text,
             "clip=%d,%d,%d,%d opaque=%s mode=%u,%u,%08lx,%08lx,%d,%d,%d,%d,%d,%d "
             "xform=%d,%d,%d,%d,%d,%d widths=%s",
             clip ? clip->left : 0, clip ? clip->top : 0, clip ? clip->right : 0,
             clip ? clip->bottom : 0, (LPSTR)(opaque ? "some" : "none"), given[0], given[1],
             *(LPDWORD)(given + 2), *(LPDWORD)(given + 4), given[6], given[7], given[8],
             given[9], given[10], given[11], form[0], form[1], form[2], form[3], form[4],
             form[5], (LPSTR)(widths ? "" : "none"));

    if (widths) {
        for (i = 0; i < count && i < 16; i++) {
            wsprintf(text + lstrlen(text), "%s%d", (LPSTR)(i ? "," : ""), widths[i]);
        }
    }

    if (opaque) {
        wsprintf(text + lstrlen(text), " opaquerect=%d,%d,%d,%d", opaque->left, opaque->top,
                 opaque->right, opaque->bottom);
    }

    append("drawn", args, text);
    lstrcpy(call, args);
    fontLogged(call, (LPBYTE)font, string, count < 0 ? -count : count);

    {
        DMEXTTEXTOUTPROC dmExtTextOut = (DMEXTTEXTOUTPROC)gdiProc(214);
        DMCOLORINFOPROC dmColorInfo = (DMCOLORINFOPROC)gdiProc(202);
        DWORD physical;

        _fmemcpy(drawMode, given, sizeof(drawMode));
        dmColorInfo((LPSTR)&band, *(LPDWORD)(given + 2), (LPSTR)&physical);
        *(LPDWORD)(drawMode + 2) = physical;
        dmColorInfo((LPSTR)&band, *(LPDWORD)(given + 4), (LPSTR)&physical);
        *(LPDWORD)(drawMode + 4) = physical;
        answer = dmExtTextOut((LPSTR)&band, x, y, clip, string, count, (LPSTR)font,
                              (LPSTR)drawMode, (LPSTR)xform, widths, opaque, options);
        wsprintf(text, "%u,%u", LOWORD(answer), HIWORD(answer));
        append("dmexttextout", call, text);
        bandLogged(call);
    }

    return answer;
}

WORD FAR PASCAL _export GetCharWidth(PDEV FAR *pdev, LPINT widths, WORD first, WORD last,
                                     LPVOID font, LPVOID drawMode, LPVOID xform)
{
    (void)pdev;
    (void)drawMode;
    (void)xform;

    return EngineGetCharWidth(font, first, last, widths);
}

WORD FAR PASCAL _export EnumDFonts(PDEV FAR *pdev, LPSTR face, FARPROC callback, LPVOID data)
{
    (void)pdev;
    (void)face;
    (void)callback;
    (void)data;
    return 1;
}

WORD FAR PASCAL _export EnumObj(PDEV FAR *pdev, WORD style, FARPROC callback, LPVOID data)
{
    (void)pdev;
    (void)style;
    (void)callback;
    (void)data;
    return 1;
}

int FAR PASCAL _export DeviceMode(HWND window, HANDLE module, LPSTR device, LPSTR output)
{
    (void)window;
    (void)module;
    (void)device;
    (void)output;
    return 1;
}

/* The context the probe draws on, which `EngineExtTextOut` is given; the
 * band cleared. */
void FAR PASCAL _export SetContext(HDC dc)
{
    context = dc;
}

void FAR PASCAL _export ClearBand(void)
{
    int i;

    band.bmType = 0;
    band.bmWidth = WIDTH;
    band.bmHeight = HEIGHT;
    band.bmWidthBytes = WIDTH / 8;
    band.bmPlanes = 1;
    band.bmBitsPixel = 1;
    band.bmBits = (LPSTR)bandBits;
    band.bmWidthPlanes = BAND_BYTES;
    band.bmlpPDevice = NULL;
    band.bmSegmentIndex = 0;
    band.bmScanSegment = HEIGHT;
    band.bmFillBytes = 0;

    for (i = 0; i < BAND_BYTES; i++) {
        bandBits[i] = 0xff;
    }
}

int FAR PASCAL LibMain(HANDLE instance, WORD data, WORD heap, LPSTR command)
{
    (void)instance;
    (void)data;
    (void)heap;
    (void)command;
    return 1;
}

int FAR PASCAL _export WEP(int exiting)
{
    (void)exiting;
    return 1;
}
