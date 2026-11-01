/*
 * A printer's driver of the probe's own, `PRTTROTD`, whose fonts are all
 * GDI's TrueType ones: it realizes each through `EngineRealizeFont`, and
 * answers its widths with `EngineGetCharWidth` and its extents with
 * `EngineExtTextOut`, as a driver that prints TrueType does. `prttrot.c`
 * copies it to `PRTTROTD.DRV`, since GDI loads a driver by its name and
 * `.DRV`, and has it put the rest of the engine's exports to the font it
 * realized last (`GlyphAt`).
 *
 * Its entry points are the ordinals GDI asks for (`prttrot.dll.lnk`). Its
 * page is 64 by 48 dots at 300 to the inch, one bit deep; it draws
 * nothing.
 *
 * It keeps a log, `C:\ORACLE\PRTTROT.LOG`, a line appended as each thing
 * is asked, `function`, `arguments` and `result` apart by tabs, for the
 * probe to read back as records.
 */

#define BitBlt WindowsBitBlt
#define ExtTextOut WindowsExtTextOut
#define GetCharWidth WindowsGetCharWidth
#include <windows.h>
#undef BitBlt
#undef ExtTextOut
#undef GetCharWidth

#define LOG "C:\\ORACLE\\PRTTROT.LOG"

#define WIDTH 64
#define HEIGHT 48

/* GDI's TrueType engine, which no header declares. */
DWORD FAR PASCAL EngineRealizeFont(LPLOGFONT, LPVOID, LPVOID);
int FAR PASCAL EngineGetCharWidth(LPVOID, WORD, WORD, LPINT);
DWORD FAR PASCAL EngineSetFontContext(LPVOID, WORD);
DWORD FAR PASCAL EngineGetGlyphBmp(HDC, LPVOID, WORD, WORD, LPSTR, DWORD, LPVOID);
DWORD FAR PASCAL EngineExtTextOut(HDC, LPVOID, WORD, WORD, LPRECT, LPSTR, int, LPVOID, LPVOID,
                                  LPVOID, LPINT, LPRECT, WORD);
HANDLE FAR PASCAL GetPhysicalFontHandle(HDC);

typedef struct {
    WORD type;
    WORD number;
} PDEV;

static char text[600];
static char args[80];
static int devices;

/* The FONTINFO each font was realized into, the last one asked about. */
static LPBYTE lastFont;
static HDC context;

static unsigned char bits[4096];

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
        put(info, 0x0c, 1);
        put(info, 0x0e, 1);
        put(info, 0x10, 2);
        put(info, 0x12, 2);
        put(info, 0x16, 1);
        put(info, 0x18, 2);
        put(info, 0x1a, sizeof(PDEV));
        put(info, 0x1c, 0x1ff);
        put(info, 0x1e, 0xfe);
        put(info, 0x20, 0xff);
        put(info, 0x22, 0);
        put(info, 0x24, 1);
        put(info, 0x26, 0x0010);
        put(info, 0x28, 300);
        put(info, 0x2a, 300);
        put(info, 0x2c, 424);
        put(info, 0x2e, 200);
        put(info, 0x30, 254); put(info, 0x32, 254); put(info, 0x34, 300); put(info, 0x36, -300);
        put(info, 0x38, 2540); put(info, 0x3a, 2540); put(info, 0x3c, 300); put(info, 0x3e, -300);
        put(info, 0x40, 100); put(info, 0x42, 100); put(info, 0x44, 300); put(info, 0x46, -300);
        put(info, 0x48, 1000); put(info, 0x4a, 1000); put(info, 0x4c, 300); put(info, 0x4e, -300);
        put(info, 0x50, 1440); put(info, 0x52, 1440); put(info, 0x54, 300); put(info, 0x56, -300);
        put(info, 0x58, 300);
        put(info, 0x5a, 300);
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

/* Fields of a FONTINFO the engine filled beyond its header. */
static void fontFields(LPBYTE info)
{
    wsprintf(text, "type=%d flags=%02X 3c=%d 3e=%d 40=%d,%d,%d,%d esc=%d stretch=%d em=%d 4e=%04X",
             info[0] & 3, info[0x33], *(LPINT)(info + 0x3c), *(LPINT)(info + 0x3e),
             *(LPINT)(info + 0x40), *(LPINT)(info + 0x42), *(LPINT)(info + 0x44),
             *(LPINT)(info + 0x46), *(LPINT)(info + 0x48), *(LPINT)(info + 0x4a),
             *(LPINT)(info + 0x4c), *(LPWORD)(info + 0x4e));
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
        wsprintf(args, "%d %d %s%s", font->lfHeight, font->lfEscapement,
                 (LPSTR)font->lfFaceName, (LPSTR)(out ? "" : " size"));
        wsprintf(text, "%ld", answer);
        append("realize", args, text);

        if (out && answer) {
            lastFont = (LPBYTE)out;
            fontFields(lastFont);
            append("fields", args, text);
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
    (void)style;
    (void)count;
    (void)points;
    (void)pen;
    (void)brush;
    (void)drawMode;
    (void)clip;
    return 1;
}

BOOL FAR PASCAL _export BitBlt(PDEV FAR *dest, WORD x, WORD y, LPVOID source, WORD sx, WORD sy,
                               WORD width, WORD height, DWORD rop, LPVOID brush, LPVOID drawMode)
{
    (void)dest;
    (void)x;
    (void)y;
    (void)source;
    (void)sx;
    (void)sy;
    (void)width;
    (void)height;
    (void)rop;
    (void)brush;
    (void)drawMode;
    return 1;
}

DWORD FAR PASCAL _export Pixel(PDEV FAR *pdev, WORD x, WORD y, DWORD color, LPVOID drawMode)
{
    (void)pdev;
    (void)x;
    (void)y;
    (void)drawMode;
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
    (void)x;
    (void)y;
    (void)clip;
    (void)string;
    (void)font;
    (void)drawMode;
    (void)xform;
    return MAKELONG(count < 0 ? -count : count, 1);
}

/* An extent the engine's; a string drawn, logged and left. */
DWORD FAR PASCAL _export ExtTextOut(PDEV FAR *pdev, WORD x, WORD y, LPRECT clip, LPSTR string,
                                    int count, LPVOID font, LPVOID drawMode, LPVOID xform,
                                    LPINT widths, LPRECT opaque, WORD options)
{
    DWORD answer;

    if (count >= 0) {
        wsprintf(args, "%d,%d %d", x, y, count);
        append("drawn", args, "");
        return 1;
    }

    answer = EngineExtTextOut(context, pdev, x, y, clip, string, count, font, drawMode, xform,
                              widths, opaque, options);
    wsprintf(args, "%d", count);
    wsprintf(text, "%u,%u", LOWORD(answer), HIWORD(answer));
    append("extent", args, text);
    return answer;
}

WORD FAR PASCAL _export GetCharWidth(PDEV FAR *pdev, LPINT widths, WORD first, WORD last,
                                     LPVOID font, LPVOID drawMode, LPVOID xform)
{
    int answer;

    (void)pdev;
    (void)drawMode;
    (void)xform;

    answer = EngineGetCharWidth(font, first, last, widths);
    wsprintf(args, "%d-%d", first, last);
    wsprintf(text, "%d %d", answer, widths[0]);
    append("charwidth", args, text);
    return answer;
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

/* EngineGetGlyphBmp of a character: the answer, the metrics record's six
 * doublewords, and the sum of the bitmap's bytes. */
static void glyphOf(LPCSTR name, WORD character, WORD format, DWORD size)
{
    DWORD metrics[8];
    DWORD answer;
    int i;

    for (i = 0; i < 8; i++) {
        metrics[i] = 0x55555555L;
    }

    for (i = 0; i < sizeof(bits); i++) {
        bits[i] = 0x55;
    }

    answer = EngineGetGlyphBmp(context, lastFont, character, format, size ? (LPSTR)bits : NULL,
                               size, metrics);
    wsprintf(args, "%s %d %d %ld", name, character, format, size);
    wsprintf(text, "%ld box=%ld,%ld origin=%lX,%lX inc=%lX,%lX after=%lX sum=%04X first=%02X",
             answer, metrics[0], metrics[1], metrics[2], metrics[3], metrics[4], metrics[5],
             metrics[6], sumOf(answer == (DWORD)-1 ? 0 : (answer > size ? size : answer)),
             bits[0]);
    append("EngineGetGlyphBmp", args, text);
}

static void contextOf(LPCSTR name, WORD angle)
{
    DWORD answer = EngineSetFontContext(lastFont, angle);

    wsprintf(args, "%s %d", name, angle);
    wsprintf(text, "%ld", answer);
    append("EngineSetFontContext", args, text);
}

/* The engine's context set for the font realized last at an angle, and
 * one character's glyph made with it: what `prttrot.c` reads the
 * scaler's memory after. */
void FAR PASCAL _export GlyphAt(LPSTR name, WORD angle, WORD character)
{
    if (!lastFont) {
        append("exercise", name, "no font");
        return;
    }

    contextOf(name, angle);
    glyphOf(name, character, 1, sizeof(bits));
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
