/*
 * A printer's driver of the probe's own, `PRTTSLTD`, whose fonts are all
 * GDI's TrueType ones, as `prtteng.dll.c`'s are. Its `Glyphs` hands the
 * font it realized last to `EngineSetFontContext` upright and asks
 * `EngineGetGlyphBmp` for each character given: the answer, the record's
 * box, corner and advance, and the bitmap, a row of hex a line.
 *
 * It keeps a log, `C:\ORACLE\PRTTSLT.LOG`, a line appended as each thing is
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

#define LOG "C:\\ORACLE\\PRTTSLT.LOG"

#define WIDTH 128
#define HEIGHT 64

/* GDI's TrueType engine, which no header declares. */
DWORD FAR PASCAL EngineRealizeFont(LPLOGFONT, LPVOID, LPVOID);
int FAR PASCAL EngineGetCharWidth(LPVOID, WORD, WORD, LPINT);
DWORD FAR PASCAL EngineSetFontContext(LPVOID, WORD);
DWORD FAR PASCAL EngineGetGlyphBmp(HDC, LPVOID, WORD, WORD, LPSTR, DWORD, LPVOID);
DWORD FAR PASCAL EngineExtTextOut(HDC, LPVOID, WORD, WORD, LPRECT, LPSTR, int, LPVOID, LPVOID,
                                  LPVOID, LPINT, LPRECT, WORD);

typedef struct {
    WORD type;
    WORD number;
} PDEV;

static char text[600];
static unsigned char bits[4096];
static char args[200];
static int devices;

/* The PDEVICE last made and the FONTINFO realized last, for the engine. */
static LPVOID lastDevice;
static LPBYTE lastFont;
static HDC context;

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

/* The bytes' sum, sum * 31 + byte, of as many as there are. */
static WORD sumOf(DWORD count)
{
    WORD sum = 0;
    WORD at;

    for (at = 0; at < count && at < sizeof(bits); at++) {
        sum = (WORD)(sum * 31 + bits[at]);
    }

    return sum;
}

/* `EngineGetGlyphBmp` of a character upright: the answer, the record's six
 * doublewords and the bitmap's sum; then its rows, a doubleword's multiple
 * each, as hex. */
static void glyphOf(LPCSTR name, WORD character)
{
    DWORD metrics[8];
    DWORD answer;
    WORD stride;
    WORD row;
    WORD at;
    int i;

    for (i = 0; i < 8; i++) {
        metrics[i] = 0x55555555L;
    }

    for (i = 0; i < sizeof(bits); i++) {
        bits[i] = 0x55;
    }

    answer = EngineGetGlyphBmp(context, lastFont, character, 1, (LPSTR)bits, sizeof(bits),
                               metrics);
    wsprintf(args, "%s %d", name, character);
    wsprintf(text, "%ld box=%ld,%ld origin=%lX,%lX inc=%lX,%lX sum=%04X", answer, metrics[0],
             metrics[1], metrics[2], metrics[3], metrics[4], metrics[5],
             sumOf(answer == (DWORD)-1 ? 0 : (answer > sizeof(bits) ? sizeof(bits) : answer)));
    append("EngineGetGlyphBmp", args, text);

    if (answer == (DWORD)-1 || answer > sizeof(bits) || !metrics[1]) {
        return;
    }

    stride = (WORD)(((metrics[0] + 31) / 32) * 4);

    for (row = 0; row < (WORD)metrics[1]; row++) {
        for (at = 0; at < stride && at < 250; at++) {
            wsprintf(text + at * 2, "%02x", bits[row * stride + at]);
        }

        wsprintf(args, "%s %d %d", name, character, row);
        append("row", args, text);
    }
}

/* The engine's context set upright to the font realized last, and each
 * character of the string's glyph asked for. */
void FAR PASCAL _export Glyphs(HDC dc, LPSTR name, LPSTR characters)
{
    DWORD answer;

    context = dc;

    if (!lastFont) {
        append("glyphs", name, "no font");
        return;
    }

    answer = EngineSetFontContext(lastFont, 0);
    wsprintf(text, "%ld flags=%02X", answer, lastFont[0x33]);
    append("EngineSetFontContext", name, text);

    while (*characters) {
        glyphOf(name, (BYTE)*characters++);
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
