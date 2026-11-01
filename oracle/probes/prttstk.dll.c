/*
 * A printer's driver of the probe's own, its module named `MGXWMF` (in
 * `prttstk.dll.lnk`), whose fonts are all GDI's TrueType ones, as
 * `prttx2.dll.c`'s are. Asked to draw a string of a font it realized, it
 * hands it to `EngineExtTextOut`; GDI's own call back of its `ExtTextOut`
 * with the font GDI drew the glyphs into it logs -- the place, the count,
 * the options and the widths -- and draws nothing.
 *
 * Exports the probe calls hand the engine a string directly:
 *
 * * `DrawDirect`, as `prttx2.dll.c`'s: the string at a place.
 * * `DrawLimited`: the same with the task's stack limit, the word at 0Ah of
 *   the stack's segment, put the given number of bytes below the stack
 *   pointer for the call, and put back after (GDI seg1 `62a5`).
 * * `Emboldened`: the last font GDI handed back drawn with `DMExtTextOut`
 *   on a band of its own, through a `TEXTXFORM` asking for emboldening.
 *
 * It keeps a log, `C:\ORACLE\PRTTSTK.LOG`, a line appended as each thing is
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

#define LOG "C:\\ORACLE\\PRTTSTK.LOG"

#define WIDTH 128
#define HEIGHT 64

/* GDI's TrueType engine, which no header declares. */
DWORD FAR PASCAL EngineRealizeFont(LPLOGFONT, LPVOID, LPVOID);
int FAR PASCAL EngineGetCharWidth(LPVOID, WORD, WORD, LPINT);
DWORD FAR PASCAL EngineExtTextOut(HDC, LPVOID, WORD, WORD, LPRECT, LPSTR, int, LPVOID, LPVOID,
                                  LPVOID, LPINT, LPRECT, WORD);

WORD stackPointer(void);
#pragma aux stackPointer = "mov ax, sp" value[ax];
WORD stackSegment(void);
#pragma aux stackSegment = "mov ax, ss" value[ax];

typedef struct {
    WORD type;
    WORD number;
} PDEV;

static char text[600];
static char args[200];
static int devices;

/* The PDEVICE last made and the FONTINFO realized last, for the engine. */
static LPVOID lastDevice;
static LPBYTE lastFont;
static HDC context;

/* The font GDI handed back last, its glyphs drawn into its cache. */
static LPVOID lastCache;

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

#define BAND_BYTES (WIDTH / 8 * HEIGHT)

static DRVBITMAP band;
static BYTE bandBits[BAND_BYTES];

typedef DWORD(FAR PASCAL *DMEXTTEXTOUTPROC)(LPSTR, int, int, LPRECT, LPSTR, int, LPSTR, LPSTR,
                                            LPSTR, LPINT, LPRECT, WORD);
typedef DWORD(FAR PASCAL *DMCOLORINFOPROC)(LPSTR, DWORD, LPSTR);

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
        lastDevice = pdev;

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
    (void)points;
    (void)pen;
    (void)brush;
    (void)drawMode;
    (void)clip;
    wsprintf(args, "%u %u", style, count);
    append("output", args, "");
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

/*
 * A string of a font of its own handed to the engine; one of GDI's font
 * logged: the place, the count, the options and each width.
 */
DWORD FAR PASCAL _export ExtTextOut(PDEV FAR *pdev, WORD x, WORD y, LPRECT clip, LPSTR string,
                                    int count, LPVOID font, LPVOID mode, LPVOID xform,
                                    LPINT widths, LPRECT opaque, WORD options)
{
    int i;

    (void)clip;
    (void)string;
    (void)mode;

    if ((LPBYTE)font == lastFont) {
        return EngineExtTextOut(context, pdev, x, y, clip, string, count, font, mode, xform,
                                widths, opaque, options);
    }

    wsprintf(args, "%d,%d %d %u", (int)x, (int)y, count, options);
    lstrcpy(text, widths ? "widths=" : "widths=none");

    if (widths) {
        for (i = 0; i < count && i < 16; i++) {
            wsprintf(text + lstrlen(text), "%s%d", (LPSTR)(i ? "," : ""), widths[i]);
        }
    }

    wsprintf(text + lstrlen(text), " opaque=%s", (LPSTR)(opaque ? "some" : "none"));
    append("drawn", args, text);
    lastCache = font;
    return 0;
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

/* The context the probe draws on, which `EngineExtTextOut` is given. */
void FAR PASCAL _export SetContext(HDC dc)
{
    context = dc;
}

static WORD mode[16];
static WORD xform[16];
static RECT page = {0, 0, WIDTH, HEIGHT};

/* A `DRAWMODE` of the driver's own, transparent, white behind black. */
static void modeMade(void)
{
    int i;

    for (i = 0; i < 16; i++) {
        mode[i] = 0;
        xform[i] = 0;
    }

    mode[0] = 13;
    mode[1] = TRANSPARENT;
    mode[2] = 0xffff;
    mode[3] = 0x00ff;
    mode[12] = 0xffff;
    mode[13] = 0x00ff;
}

/* The engine asked to draw a string of the font realized last on the
 * device made last, the whole page the clip. */
void FAR PASCAL _export DrawDirect(LPSTR name, int x, int y, LPSTR string, int count)
{
    DWORD answer;

    modeMade();
    answer = EngineExtTextOut(context, lastDevice, x, y, &page, string, count, lastFont, mode,
                              xform, NULL, NULL, 0);
    wsprintf(args, "%s %d,%d %d", name, x, y, count);
    append("direct", args, (LPSTR)(answer == (DWORD)lastDevice ? "pdevice" : "other"));
}

/*
 * The same, at 10,10, with the task's stack limit put `margin` bytes below
 * the stack pointer as it is read here, and put back after.
 */
void FAR PASCAL _export DrawLimited(WORD margin, LPSTR string, int count)
{
    WORD FAR *limit = (WORD FAR *)MAKELP(stackSegment(), 0x0a);
    WORD saved = *limit;
    DWORD answer;

    modeMade();
    *limit = (WORD)(stackPointer() - margin);
    answer = EngineExtTextOut(context, lastDevice, 10, 10, &page, string, count, lastFont, mode,
                              xform, NULL, NULL, 0);
    *limit = saved;
    wsprintf(args, "%04X %d", margin, count);
    append("limited", args, (LPSTR)(answer == (DWORD)lastDevice ? "pdevice" : "other"));
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

/*
 * `AW` of the font GDI handed back last drawn with GDI's `DMExtTextOut` on
 * a monochrome band of its own, 128 by 64, through a `TEXTXFORM` of the
 * weight and accelerator given: the band's set bits and sum logged, and the
 * `TEXTXFORM`'s weight, italic and accelerator after.
 */
void FAR PASCAL _export Emboldened(LPSTR name, WORD weight, WORD accelerator, BYTE italic)
{
    static WORD form[16];
    DMEXTTEXTOUTPROC dmExtTextOut =
        (DMEXTTEXTOUTPROC)GetProcAddress(GetModuleHandle("GDI"), MAKEINTRESOURCE(214));
    DMCOLORINFOPROC dmColorInfo =
        (DMCOLORINFOPROC)GetProcAddress(GetModuleHandle("GDI"), MAKEINTRESOURCE(202));
    LPBYTE bytes = (LPBYTE)form;
    DWORD physical;
    DWORD answer;
    int set = 0;
    int i;

    if (!lastCache) {
        append("emboldened", name, "no font");
        return;
    }

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

    modeMade();
    dmColorInfo((LPSTR)&band, 0x00ffffffL, (LPSTR)&physical);
    *(LPDWORD)(mode + 2) = physical;
    dmColorInfo((LPSTR)&band, 0L, (LPSTR)&physical);
    *(LPDWORD)(mode + 4) = physical;

    for (i = 0; i < 16; i++) {
        form[i] = 0;
    }

    form[0] = 27;
    *(LPWORD)(bytes + 8) = weight;
    bytes[0x0a] = italic;
    *(LPWORD)(bytes + 0x0f) = accelerator;

    answer = dmExtTextOut((LPSTR)&band, 10, 10, &page, "AW", 2, (LPSTR)lastCache, (LPSTR)mode,
                          (LPSTR)form, NULL, NULL, 0);

    for (i = 0; i < BAND_BYTES; i++) {
        BYTE b = bandBits[i];

        while (b) {
            set += b & 1;
            b >>= 1;
        }
    }

    wsprintf(text, "%lX set=%d sum=%04X after=%u,%u,%04X", answer, BAND_BYTES * 8 - set,
             sumOf(bandBits, BAND_BYTES), *(LPWORD)(bytes + 8), bytes[0x0a],
             *(LPWORD)(bytes + 0x0f));
    wsprintf(args, "%s %u %04X %u", name, weight, accelerator, italic);
    append("emboldened", args, text);
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
