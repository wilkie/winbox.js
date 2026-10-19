/*
 * A printer's driver of the probe's own, `PRDRVD`, which keeps a log of
 * every call GDI makes to it, for `prdrv.c` to read back: the probe copies
 * it to `PRDRVD.DRV`, since GDI loads a driver by its name and `.DRV`.
 *
 * Its entry points are the ordinals GDI asks for (`prdrv.dll.lnk`): 1
 * `BitBlt`, 2 `ColorInfo`, 3 `Control`, 4 `Disable`, 5 `Enable`, 6
 * `EnumDFonts`, 7 `EnumObj`, 8 `Output`, 9 `Pixel`, 10 `RealizeObject`, 11
 * `StrBlt`, 12 `ScanLR`, 13 `DeviceMode`, 14 `ExtTextOut`, 15
 * `GetCharWidth`, 21 `DIBToDevice`, 27 `StretchBlt` and 28 `StretchDIBits`.
 *
 * What it is depends on the device it is asked for, by its name's letters:
 *
 * * `B`: it bands (`RC_BANDING`), two bands of its page, top then bottom;
 * * `X`: it can `BitBlt` (`RC_BITBLT`); `S`: `StretchBlt` (`RC_STRETCHBLT`);
 *   `D`: `StretchDIBits` and `SetDIBitsToDevice` (`RC_STRETCHDIB`,
 *   `RC_DIBTODEV`);
 * * `M`: its contexts share a device, where the names match (`dpDCManage`
 *   nought); otherwise each has one of its own (1).
 *
 * Its page is 64 by 48 dots, 100 to the inch, one bit deep. It draws every
 * figure itself, and realizes every pen, brush and font: a font of 10 dots
 * by 6 named `Probe`.
 *
 * The log is a file, `C:\ORACLE\PRDRV.LOG`, a line appended as each call is
 * made, so that it outlives the driver. Where the fonts it realized are
 * asked about, each is the size of the block its `FONTINFO` is in, or
 * nought once GDI has freed it.
 */

#define BitBlt WindowsBitBlt
#define StretchBlt WindowsStretchBlt
#define StretchDIBits WindowsStretchDIBits
#define ExtTextOut WindowsExtTextOut
#define GetCharWidth WindowsGetCharWidth
#include <windows.h>
#undef BitBlt
#undef StretchBlt
#undef StretchDIBits
#undef ExtTextOut
#undef GetCharWidth
#include <string.h>

#define LOG "C:\\ORACLE\\PRDRV.LOG"

#define WIDTH 64
#define HEIGHT 48

typedef struct {
    WORD type;
    WORD caps;
    WORD band;
    WORD number;
} PDEV;

#define CAN_BAND 1
#define CAN_BLT 2
#define CAN_STRETCH 4
#define CAN_DIB 8
#define SHARES 16

static char text[400];
static int devices;

/* The selector of each FONTINFO it realized, to ask about later. */
static WORD fonts[16];
static int fontCount;

static void append(void)
{
    int file = _lopen(LOG, 2);

    if (file == -1) {
        file = _lcreat(LOG, 0);
    }

    if (file == -1) {
        return;
    }

    _llseek(file, 0L, 2);
    _lwrite(file, text, lstrlen(text));
    _lwrite(file, "\r\n", 2);
    _lclose(file);
}

/* Each font's block's size, or nought where it has been freed. */
static void fontsAlive(void)
{
    int i;

    for (i = 0; i < fontCount; i++) {
        DWORD handle = GlobalHandle(fonts[i]);

        wsprintf(text + lstrlen(text), " font%d=%ld", i,
                 LOWORD(handle) ? GlobalSize(LOWORD(handle)) : 0L);
    }
}

static WORD capsOf(LPSTR device)
{
    WORD caps = 0;

    if (device == NULL) {
        return 0;
    }

    for (; *device; device++) {
        switch (*device) {
        case 'B': caps |= CAN_BAND; break;
        case 'X': caps |= CAN_BLT; break;
        case 'S': caps |= CAN_STRETCH; break;
        case 'D': caps |= CAN_DIB; break;
        case 'M': caps |= SHARES; break;
        }
    }

    return caps;
}

static void put(LPWORD info, int at, int value)
{
    info[at / 2] = (WORD)value;
}

WORD FAR PASCAL _export Enable(LPVOID lpDevice, WORD style, LPSTR device, LPSTR output, LPVOID data)
{
    WORD caps = capsOf(device);

    wsprintf(text, "Enable %d %s %s %d", style, device ? device : (LPSTR)"(none)",
             output ? output : (LPSTR)"(none)", data != NULL);
    append();

    if (style & 1) {
        LPWORD info = (LPWORD)lpDevice;
        WORD raster = 0x0010;
        int i;

        for (i = 0; i < 0x6e / 2; i++) {
            info[i] = 0;
        }

        if (caps & CAN_BAND) raster |= 0x0002;
        if (caps & CAN_BLT) raster |= 0x0001;
        if (caps & CAN_STRETCH) raster |= 0x0800;
        if (caps & CAN_DIB) raster |= 0x2200;

        put(info, 0x00, 0x30a);
        put(info, 0x02, 2);
        put(info, 0x04, 16);
        put(info, 0x06, 12);
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
        put(info, 0x26, raster);
        put(info, 0x28, 100);
        put(info, 0x2a, 100);
        put(info, 0x2c, 141);
        put(info, 0x2e, 200);
        put(info, 0x30, 254); put(info, 0x32, 254); put(info, 0x34, 100); put(info, 0x36, -100);
        put(info, 0x38, 2540); put(info, 0x3a, 2540); put(info, 0x3c, 100); put(info, 0x3e, -100);
        put(info, 0x40, 100); put(info, 0x42, 100); put(info, 0x44, 100); put(info, 0x46, -100);
        put(info, 0x48, 1000); put(info, 0x4a, 1000); put(info, 0x4c, 100); put(info, 0x4e, -100);
        put(info, 0x50, 1440); put(info, 0x52, 1440); put(info, 0x54, 100); put(info, 0x56, -100);
        put(info, 0x58, 100);
        put(info, 0x5a, 100);
        put(info, 0x5c, caps & SHARES ? 0 : 1);

        return 0x6e;
    } else {
        PDEV FAR *pdev = (PDEV FAR *)lpDevice;

        pdev->type = 0x5250;
        pdev->caps = caps;
        pdev->band = 0;
        pdev->number = ++devices;

        return 1;
    }
}

void FAR PASCAL _export Disable(PDEV FAR *pdev)
{
    wsprintf(text, "Disable %d", pdev->number);
    fontsAlive();
    append();
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
        wsprintf(text, "RealizeObject %d delete", style);
        append();
        return 1;
    }

    if (style == 1) {
        LPLOGPEN pen = (LPLOGPEN)in;

        wsprintf(text, "RealizeObject pen %d %d %06lX%s", pen->lopnStyle, pen->lopnWidth.x,
                 pen->lopnColor, out ? "" : " size");
        append();

        if (out) {
            _fmemcpy(out, in, sizeof(LOGPEN));
        }

        return sizeof(LOGPEN);
    }

    if (style == 2) {
        LPLOGBRUSH brush = (LPLOGBRUSH)in;

        wsprintf(text, "RealizeObject brush %d %06lX %d%s", brush->lbStyle, brush->lbColor,
                 brush->lbHatch, out ? "" : " size");
        append();

        if (out) {
            _fmemcpy(out, in, sizeof(LOGBRUSH));
        }

        return sizeof(LOGBRUSH);
    }

    if (style == 3) {
        LPLOGFONT font = (LPLOGFONT)in;

        wsprintf(text, "RealizeObject font %d %d %d \"%s\"%s", font->lfHeight, font->lfWidth,
                 font->lfWeight, (LPSTR)font->lfFaceName, out ? "" : " size");
        append();

        if (out) {
            LPBYTE info = (LPBYTE)out;
            int i;

            for (i = 0; i < 0x40; i++) {
                info[i] = 0;
            }

            /* dfType: a font of the device's. */
            *(LPWORD)(info + 0x00) = 0x0080;
            *(LPWORD)(info + 0x02) = 7;
            *(LPWORD)(info + 0x04) = 100;
            *(LPWORD)(info + 0x06) = 100;
            *(LPWORD)(info + 0x08) = 8;
            *(LPWORD)(info + 0x11) = 400;
            *(LPWORD)(info + 0x14) = 6;
            *(LPWORD)(info + 0x16) = 10;
            info[0x18] = FIXED_PITCH | FF_MODERN;
            *(LPWORD)(info + 0x19) = 6;
            *(LPWORD)(info + 0x1b) = 6;
            info[0x1d] = 32;
            info[0x1e] = 126;
            info[0x1f] = 63 - 32;
            info[0x20] = 0;
            *(LPDWORD)(info + 0x27) = 0x34;
            lstrcpy((LPSTR)info + 0x34, "Probe");

            if (xform) {
                LPWORD words = (LPWORD)xform;

                words[0] = 10;
                words[1] = 6;
                words[2] = 0;
                words[3] = 0;
                words[4] = 400;
                xform[0x0a] = 0;
                xform[0x0b] = 0;
                xform[0x0c] = 0;
                xform[0x0d] = 0;
                xform[0x0e] = 0;
                *(LPWORD)(xform + 0x0f) = 0;
                *(LPWORD)(xform + 0x11) = 0;
            }

            if (fontCount < 16) {
                fonts[fontCount++] = SELECTOROF(out);
            }
        }

        return 0x40;
    }

    wsprintf(text, "RealizeObject %d", style);
    append();
    return 0;
}

static void rectText(LPRECT rect)
{
    if (rect) {
        wsprintf(text + lstrlen(text), " clip %d,%d,%d,%d", rect->left, rect->top, rect->right,
                 rect->bottom);
    }
}

int FAR PASCAL _export Control(PDEV FAR *pdev, WORD function, LPSTR in, LPSTR out)
{
    wsprintf(text, "Control %d %d", pdev->number, function);

    if (function == 8 && in) {
        WORD asked = *(LPWORD)in;

        wsprintf(text + lstrlen(text), " %d", asked);
        append();

        return asked == 1 || asked == 2 || asked == 3 || asked == 8 || asked == 9 ||
               asked == 10 || asked == 11;
    }

    if (function == 3) {
        LPRECT band = (LPRECT)out;

        if (pdev->band == 0) {
            SetRect(band, 0, 0, WIDTH, HEIGHT / 2);
        } else if (pdev->band == 1) {
            SetRect(band, 0, HEIGHT / 2, WIDTH, HEIGHT);
        } else {
            SetRect(band, 0, 0, 0, 0);
        }

        pdev->band = pdev->band >= 2 ? 0 : pdev->band + 1;
        rectText(band);
        append();
        return 1;
    }

    append();
    return function == 1 || function == 2 || function == 9 || function == 10 || function == 11;
}

WORD FAR PASCAL _export Output(PDEV FAR *pdev, WORD style, WORD count, LPPOINT points, LPVOID pen,
                               LPVOID brush, LPVOID drawMode, LPRECT clip)
{
    WORD i;

    wsprintf(text, "Output %d %d %d", pdev->number, style, count);

    for (i = 0; i < count && i < 8; i++) {
        wsprintf(text + lstrlen(text), " %d,%d", points[i].x, points[i].y);
    }

    wsprintf(text + lstrlen(text), " pen %d brush %d mode %d", pen != NULL, brush != NULL,
             drawMode != NULL);
    rectText(clip);
    append();
    return 1;
}

static void deviceText(LPVOID device)
{
    LPWORD words = (LPWORD)device;

    if (!device) {
        lstrcat(text, " none");
    } else if (words[0] == 0x5250) {
        wsprintf(text + lstrlen(text), " device %d", ((PDEV FAR *)device)->number);
    } else {
        /* A bitmap: bmType, bmWidth, bmHeight, bmWidthBytes, bmPlanes and
         * bmBitsPixel. */
        LPBYTE bytes = (LPBYTE)device;

        wsprintf(text + lstrlen(text), " bitmap %d %d %d %d %d %d", words[0], words[1], words[2],
                 words[3], bytes[8], bytes[9]);
    }
}

BOOL FAR PASCAL _export BitBlt(PDEV FAR *dest, WORD x, WORD y, LPVOID source, WORD sx, WORD sy,
                               WORD width, WORD height, DWORD rop, LPVOID brush, LPVOID drawMode)
{
    wsprintf(text, "BitBlt %d %d,%d", dest->number, x, y);
    deviceText(source);

    /* Without a source, its corner is whatever GDI's stack held. */
    if (source) {
        wsprintf(text + lstrlen(text), " %d,%d", sx, sy);
    }

    wsprintf(text + lstrlen(text), " %dx%d %08lX brush %d mode %d", width, height, rop,
             brush != NULL, drawMode != NULL);
    append();
    return 1;
}

BOOL FAR PASCAL _export StretchBlt(PDEV FAR *dest, WORD x, WORD y, WORD width, WORD height,
                                   LPVOID source, WORD sx, WORD sy, WORD swidth, WORD sheight,
                                   DWORD rop, LPVOID brush, LPVOID drawMode, LPRECT clip)
{
    wsprintf(text, "StretchBlt %d %d,%d %dx%d", dest->number, x, y, width, height);
    deviceText(source);
    wsprintf(text + lstrlen(text), " %d,%d %dx%d %08lX brush %d mode %d", sx, sy, swidth, sheight,
             rop, brush != NULL, drawMode != NULL);
    rectText(clip);
    append();
    return 1;
}

static void dibText(LPBITMAPINFO info, LPVOID bits, LPINT translate)
{
    if (info) {
        wsprintf(text + lstrlen(text), " dib %ld %ld %d %d", info->bmiHeader.biWidth,
                 info->bmiHeader.biHeight, info->bmiHeader.biPlanes, info->bmiHeader.biBitCount);
    }

    if (bits) {
        wsprintf(text + lstrlen(text), " bits %02X", *(LPBYTE)bits);
    }

    wsprintf(text + lstrlen(text), " translate %d", translate != NULL);
}

int FAR PASCAL _export StretchDIBits(PDEV FAR *dest, WORD get, WORD x, WORD y, WORD width,
                                     WORD height, WORD sx, WORD sy, WORD swidth, WORD sheight,
                                     LPVOID bits, LPBITMAPINFO info, LPINT translate, DWORD rop,
                                     LPVOID brush, LPVOID drawMode, LPRECT clip)
{
    wsprintf(text, "StretchDIBits %d %d %d,%d %dx%d %d,%d %dx%d %08lX", dest->number, get, x, y,
             width, height, sx, sy, swidth, sheight, rop);
    dibText(info, bits, translate);
    wsprintf(text + lstrlen(text), " brush %d mode %d", brush != NULL, drawMode != NULL);
    rectText(clip);
    append();
    return sheight;
}

int FAR PASCAL _export DIBToDevice(PDEV FAR *dest, WORD x, WORD y, WORD start, WORD count,
                                   LPRECT clip, LPVOID drawMode, LPVOID bits, LPBITMAPINFO info,
                                   LPINT translate)
{
    wsprintf(text, "DIBToDevice %d %d,%d %d %d", dest->number, x, y, start, count);
    dibText(info, bits, translate);
    wsprintf(text + lstrlen(text), " mode %d", drawMode != NULL);
    rectText(clip);
    append();
    return count;
}

DWORD FAR PASCAL _export Pixel(PDEV FAR *pdev, WORD x, WORD y, DWORD color, LPVOID drawMode)
{
    wsprintf(text, "Pixel %d %d,%d %06lX %d", pdev->number, x, y, color, drawMode != NULL);
    append();
    return color;
}

WORD FAR PASCAL _export ScanLR(PDEV FAR *pdev, WORD x, WORD y, DWORD color, WORD style)
{
    wsprintf(text, "ScanLR %d %d,%d %d", pdev->number, x, y, style);
    append();
    return 0x8000;
}

DWORD FAR PASCAL _export StrBlt(PDEV FAR *pdev, WORD x, WORD y, LPRECT clip, LPSTR string,
                                int count, LPVOID font, LPVOID drawMode, LPVOID xform)
{
    (void)string;
    (void)font;
    (void)drawMode;
    (void)xform;

    if (count < 0) {
        return MAKELONG(-count * 6, 10);
    }

    wsprintf(text, "StrBlt %d %d,%d %d", pdev->number, x, y, count);
    rectText(clip);
    append();
    return MAKELONG(count * 6, 10);
}

DWORD FAR PASCAL _export ExtTextOut(PDEV FAR *pdev, WORD x, WORD y, LPRECT clip, LPSTR string,
                                    int count, LPVOID font, LPVOID drawMode, LPVOID xform,
                                    LPINT widths, LPRECT opaque, WORD options)
{
    (void)string;
    (void)font;
    (void)drawMode;
    (void)xform;
    (void)widths;

    if (count < 0) {
        return MAKELONG(-count * 6, 10);
    }

    wsprintf(text, "ExtTextOut %d %d,%d %d %d", pdev->number, x, y, count, options);
    rectText(clip);

    if (opaque) {
        wsprintf(text + lstrlen(text), " opaque %d,%d,%d,%d", opaque->left, opaque->top,
                 opaque->right, opaque->bottom);
    }

    append();
    return MAKELONG(count * 6, 10);
}

WORD FAR PASCAL _export GetCharWidth(PDEV FAR *pdev, LPINT widths, WORD first, WORD last,
                                     LPVOID font, LPVOID drawMode, LPVOID xform)
{
    WORD c;

    (void)pdev;
    (void)font;
    (void)drawMode;
    (void)xform;

    for (c = first; c <= last; c++) {
        widths[c - first] = 6;
    }

    return 1;
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

/* For the probe to ask at any moment whether the fonts are still there. */
void FAR PASCAL _export Report(LPSTR when)
{
    wsprintf(text, "Report %s", when);
    fontsAlive();
    append();
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
    lstrcpy(text, "WEP");
    fontsAlive();
    append();
    return 1;
}
