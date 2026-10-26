/*
 * What a metafile's device context keeps of each GDI call made into it,
 * and what each call answers there.
 *
 * Each call is made into a memory metafile of its own: `CreateMetaFile(NULL)`,
 * the call (after any it needs first), `CloseMetaFile`, `GetMetaFileBits`.
 * Each is written as one record: the function is the call's name, the
 * arguments what it was given, and the result its answer, then, after a
 * `|`, the header's count of objects and largest record in words, the
 * block's `GlobalSize`, then the records between the header and the
 * ending one, in hexadecimal. A record of more than 240 bytes is written
 * on as `more` records, 240 bytes to each.
 *
 * Written as noughts, being whatever GDI's memory held or counted: a font
 * record's two bytes past its face name's end; a region record's third
 * word, GDI's stamp of the region; and, in a DIB that GDI made of a
 * bitmap, the bytes that pad each row to a doubleword.
 *
 * `SelectObject` and `SelectPalette` write the handle they answer by its
 * name after their arguments: `stock N`, `known N` (one this probe made),
 * 1, or 65535 for another.
 *
 * * `set`: the calls that set a mode, a colour, an origin or an extent,
 *   and their `Ex` forms, with what each wrote to its `POINT`/`SIZE`, which
 *   starts as 7777h.
 * * `draw`: the figures, lines, text, blits of a pattern, clip rectangles,
 *   `SaveDC` and `RestoreDC`, `Escape`, and the print calls.
 * * `object`: `SelectObject` of pens, brushes of every style, fonts, stock
 *   objects, a bitmap and a region; `DeleteObject` of one selected and one
 *   not; `SelectPalette`, `RealizePalette`, `SetPaletteEntries` and
 *   `ResizePalette` of a palette in a metafile.
 * * `region`: `FillRgn`, `FrameRgn`, `InvertRgn`, `PaintRgn` and
 *   `SelectClipRgn` of a rectangle and an ellipse; `PaintRgn` of an empty
 *   region, of two rectangles side by side, and of an L.
 * * `bitmap`: `BitBlt` and `StretchBlt` from a memory context, monochrome
 *   and colour, `SetDIBitsToDevice` and `StretchDIBits`.
 * * `ask`: the calls that ask the context: what each answers.
 * * `caps`: `GetDeviceCaps` of every index to 70h.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\METAREC.OUT"

static const char HEX[] = "0123456789abcdef";

typedef DWORD(FAR PASCAL *DWORDPROC1)(HDC);
typedef DWORD(FAR PASCAL *DWORDPROC2)(HDC, WORD);

/* `SetRelAbs` and `GetRelAbs`, which the SDK's headers do not declare. */
static DWORDPROC2 setRelAbs;
static DWORDPROC1 getRelAbs;

static HDC screen;
static HDC meta;
static HBITMAP mono;
static HBITMAP colour;
static HGLOBAL dib;

/* An 8 by 8 DIB of 4 bits to a pixel, its 16 colours the VGA's. */
static void makeDib(void)
{
    static const RGBQUAD colours[16] = {
        {0, 0, 0, 0},     {0, 0, 128, 0},   {0, 128, 0, 0},   {0, 128, 128, 0},
        {128, 0, 0, 0},   {128, 0, 128, 0}, {128, 128, 0, 0}, {192, 192, 192, 0},
        {128, 128, 128, 0}, {0, 0, 255, 0}, {0, 255, 0, 0},   {0, 255, 255, 0},
        {255, 0, 0, 0},   {255, 0, 255, 0}, {255, 255, 0, 0}, {255, 255, 255, 0},
    };
    LPBITMAPINFOHEADER info;
    BYTE FAR *bits;
    int i;

    dib = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, sizeof(BITMAPINFOHEADER) + sizeof colours + 32);
    info = (LPBITMAPINFOHEADER)GlobalLock(dib);
    info->biSize = sizeof(BITMAPINFOHEADER);
    info->biWidth = 8;
    info->biHeight = 8;
    info->biPlanes = 1;
    info->biBitCount = 4;
    info->biCompression = BI_RGB;
    info->biSizeImage = 32;
    _fmemcpy((BYTE FAR *)info + sizeof(BITMAPINFOHEADER), colours, sizeof colours);
    bits = (BYTE FAR *)info + sizeof(BITMAPINFOHEADER) + sizeof colours;

    for (i = 0; i < 32; i++) {
        bits[i] = (BYTE)((i * 0x37 + 0x12) & 0xff);
    }

    GlobalUnlock(dib);
}

static void makeBitmaps(void)
{
    static const WORD pattern[8] = {0x55, 0xaa, 0x55, 0xaa, 0x0f, 0xf0, 0x33, 0xcc};
    HDC memory = CreateCompatibleDC(screen);
    HBITMAP old;

    mono = CreateBitmap(8, 8, 1, 1, pattern);
    colour = CreateCompatibleBitmap(screen, 8, 8);
    old = SelectObject(memory, colour);
    PatBlt(memory, 0, 0, 8, 8, WHITENESS);
    SetPixel(memory, 1, 1, RGB(255, 0, 0));
    SetPixel(memory, 6, 2, RGB(0, 0, 255));
    SetPixel(memory, 3, 7, RGB(0, 255, 0));
    SelectObject(memory, old);
    DeleteDC(memory);
    makeDib();
}

static void begin(void)
{
    meta = CreateMetaFile(NULL);
}

/* Closes the metafile and writes what it holds. */
static void end(LPCSTR function, LPCSTR args, DWORD answer)
{
    HMETAFILE file = CloseMetaFile(meta);
    HGLOBAL bits = GetMetaFileBits(file);
    BYTE FAR *block = GlobalLock(bits);
    DWORD size = *(DWORD FAR *)(block + 6) * 2;
    DWORD record;
    DWORD at;
    LPSTR out;
    int line = 0;

    /* A font's record's two bytes past its face name's end: noughts. */
    for (record = 18; record + 6 <= size;) {
        DWORD words = *(DWORD FAR *)(block + record);

        if (!words) {
            break;
        }

        if (*(WORD FAR *)(block + record + 4) == 0x02fb) {
            DWORD name = record + 6 + 18;
            DWORD stop = record + words * 2;

            while (name < stop && block[name]) {
                name++;
            }

            while (name < stop) {
                block[name++] = 0;
            }
        }

        /* A region's stamp, GDI's count of the objects it has made. */
        if (*(WORD FAR *)(block + record + 4) == 0x06ff) {
            *(WORD FAR *)(block + record + 10) = 0;
        }

        /* A bitmap made a DIB: the bytes that pad each row to a
         * doubleword are whatever was in GDI's memory. */
        {
            WORD function = *(WORD FAR *)(block + record + 4);
            DWORD info = 0;

            if (function == 0x0940 && words > 12) {
                info = record + 6 + 16;
            } else if (function == 0x0b41) {
                info = record + 6 + 20;
            } else if (function == 0x0142 && *(WORD FAR *)(block + record + 6) == 3) {
                info = record + 6 + 4;
            }

            if (info) {
                LPBITMAPINFOHEADER header = (LPBITMAPINFOHEADER)(block + info);
                DWORD used = (header->biWidth * header->biBitCount + 7) / 8;
                DWORD stride = ((header->biWidth * header->biBitCount + 31) / 32) * 4;
                DWORD bits = info + header->biSize + (header->biBitCount <= 8 ? 4L << header->biBitCount : 0);
                DWORD row;
                DWORD at;

                for (row = 0; row < (DWORD)header->biHeight; row++) {
                    for (at = used; at < stride; at++) {
                        block[bits + row * stride + at] = 0;
                    }
                }
            }
        }

        record += words * 2;
    }

    out = probeResult;
    out += wsprintf(out, "%lx|%u %lu %lu ", answer, *(WORD FAR *)(block + 10),
                    *(DWORD FAR *)(block + 12), GlobalSize(bits));

    for (at = 18; at + 6 < size; at++) {
        *out++ = HEX[block[at] >> 4];
        *out++ = HEX[block[at] & 15];

        if (++line == 240 && at + 7 < size) {
            *out = '\0';
            probe(function, args, probeResult);
            function = "more";
            out = probeResult;
            line = 0;
        }
    }

    *out = '\0';
    probe(function, args, probeResult);
    GlobalUnlock(bits);
    DeleteMetaFile(SetMetaFileBits(bits));
}

#define ONE(name, args, call)                                                                      \
    do {                                                                                           \
        DWORD answer;                                                                              \
        begin();                                                                                   \
        answer = (DWORD)(call);                                                                    \
        end(name, args, answer);                                                                   \
    } while (0)

/* A call that writes a point or a size: its answer and what it wrote. */
static POINT point;
static SIZE size;

static void pointed(LPCSTR name, DWORD answer)
{
    wsprintf(probeArgs, "%d,%d", point.x, point.y);
    end(name, probeArgs, answer);
}

static void sets(void)
{
    probeNote("set");
    ONE("SetBkColor", "", SetBkColor(meta, RGB(0x12, 0x34, 0x56)));
    ONE("SetBkMode", "", SetBkMode(meta, TRANSPARENT));
    ONE("SetMapMode", "", SetMapMode(meta, MM_ANISOTROPIC));
    ONE("SetROP2", "", SetROP2(meta, R2_XORPEN));
    ONE("SetRelAbs", "", setRelAbs(meta, 2));
    ONE("SetPolyFillMode", "", SetPolyFillMode(meta, WINDING));
    ONE("SetStretchBltMode", "", SetStretchBltMode(meta, COLORONCOLOR));
    ONE("SetTextCharacterExtra", "", SetTextCharacterExtra(meta, 3));
    ONE("SetTextColor", "", SetTextColor(meta, RGB(0x65, 0x43, 0x21)));
    ONE("SetTextJustification", "", SetTextJustification(meta, 7, 2));
    ONE("SetWindowOrg", "", SetWindowOrg(meta, 11, 22));
    ONE("SetWindowExt", "", SetWindowExt(meta, 333, 444));
    ONE("SetViewportOrg", "", SetViewportOrg(meta, 5, 6));
    ONE("SetViewportExt", "", SetViewportExt(meta, 77, 88));
    ONE("OffsetWindowOrg", "", OffsetWindowOrg(meta, -3, 4));
    ONE("ScaleWindowExt", "", ScaleWindowExt(meta, 1, 2, 3, 4));
    ONE("OffsetViewportOrg", "", OffsetViewportOrg(meta, 9, -8));
    ONE("ScaleViewportExt", "", ScaleViewportExt(meta, 5, 6, 7, 8));
    ONE("SetTextAlign", "", SetTextAlign(meta, TA_BOTTOM | TA_RIGHT));
    ONE("SetMapperFlags", "", SetMapperFlags(meta, 0x12345678L));

    point.x = point.y = 0x7777;
    begin();
    pointed("SetWindowOrgEx", SetWindowOrgEx(meta, 12, 34, &point));
    point.x = point.y = 0x7777;
    begin();
    pointed("SetViewportOrgEx", SetViewportOrgEx(meta, 56, 78, &point));
    point.x = point.y = 0x7777;
    begin();
    pointed("OffsetWindowOrgEx", OffsetWindowOrgEx(meta, 1, -1, &point));
    point.x = point.y = 0x7777;
    begin();
    pointed("OffsetViewportOrgEx", OffsetViewportOrgEx(meta, -2, 2, &point));
    point.x = point.y = 0x7777;
    begin();
    pointed("MoveToEx", MoveToEx(meta, 21, 43, &point));

    size.cx = size.cy = 0x7777;
    begin();
    {
        DWORD answer = SetWindowExtEx(meta, 100, 200, &size);
        wsprintf(probeArgs, "%d,%d", size.cx, size.cy);
        end("SetWindowExtEx", probeArgs, answer);
    }
    size.cx = size.cy = 0x7777;
    begin();
    {
        DWORD answer = SetViewportExtEx(meta, 300, 400, &size);
        wsprintf(probeArgs, "%d,%d", size.cx, size.cy);
        end("SetViewportExtEx", probeArgs, answer);
    }
    size.cx = size.cy = 0x7777;
    begin();
    {
        DWORD answer = ScaleWindowExtEx(meta, 2, 3, 4, 5, &size);
        wsprintf(probeArgs, "%d,%d", size.cx, size.cy);
        end("ScaleWindowExtEx", probeArgs, answer);
    }
    size.cx = size.cy = 0x7777;
    begin();
    {
        DWORD answer = ScaleViewportExtEx(meta, 6, 7, 8, 9, &size);
        wsprintf(probeArgs, "%d,%d", size.cx, size.cy);
        end("ScaleViewportExtEx", probeArgs, answer);
    }
}

static void draws(void)
{
    static POINT three[3] = {{24, 20}, {34, 30}, {44, 20}};
    static POINT many[7] = {{1, 2}, {3, 4}, {5, 6}, {10, 10}, {20, 10}, {20, 20}, {10, 20}};
    static int counts[2] = {3, 4};
    static int dx[3] = {5, 6, 7};
    RECT box;

    probeNote("draw");
    ONE("MoveTo", "", MoveTo(meta, 3, 4));
    ONE("LineTo", "", LineTo(meta, 30, 40));
    ONE("ExcludeClipRect", "", ExcludeClipRect(meta, 1, 2, 3, 4));
    ONE("IntersectClipRect", "", IntersectClipRect(meta, 5, 6, 7, 8));
    ONE("OffsetClipRgn", "", OffsetClipRgn(meta, 9, 10));
    ONE("Arc", "", Arc(meta, 1, 2, 3, 4, 5, 6, 7, 8));
    ONE("Chord", "", Chord(meta, 11, 12, 13, 14, 15, 16, 17, 18));
    ONE("Pie", "", Pie(meta, 21, 22, 23, 24, 25, 26, 27, 28));
    ONE("Ellipse", "", Ellipse(meta, 10, 11, 60, 41));
    ONE("Rectangle", "", Rectangle(meta, 2, 3, 20, 14));
    ONE("RoundRect", "", RoundRect(meta, 40, 2, 47, 12, 4, 5));
    ONE("SetPixel", "", SetPixel(meta, 1, 2, RGB(1, 2, 3)));
    ONE("FloodFill", "", FloodFill(meta, 5, 6, RGB(7, 8, 9)));
    ONE("ExtFloodFill", "border", ExtFloodFill(meta, 1, 2, RGB(3, 4, 5), FLOODFILLBORDER));
    ONE("ExtFloodFill", "surface", ExtFloodFill(meta, 6, 7, RGB(8, 9, 10), FLOODFILLSURFACE));
    ONE("PatBlt", "", PatBlt(meta, 30, 22, 8, 6, PATCOPY));
    ONE("BitBlt", "no source", BitBlt(meta, 1, 2, 3, 4, NULL, 0, 0, PATINVERT));
    ONE("StretchBlt", "no source", StretchBlt(meta, 1, 2, 3, 4, NULL, 0, 0, 5, 6, BLACKNESS));
    ONE("SaveDC", "", SaveDC(meta));
    ONE("RestoreDC", "", RestoreDC(meta, -1));
    ONE("TextOut", "odd", TextOut(meta, 2, 20, "Hi!", 3));
    ONE("TextOut", "even", TextOut(meta, 4, 21, "Ab", 2));
    ONE("ExtTextOut", "plain", ExtTextOut(meta, 1, 2, 0, NULL, "xyz", 3, NULL));
    SetRect(&box, 20, 24, 30, 30);
    ONE("ExtTextOut", "rect", ExtTextOut(meta, 3, 4, ETO_OPAQUE | ETO_CLIPPED, &box, "Ab", 2, NULL));
    ONE("ExtTextOut", "dx", ExtTextOut(meta, 5, 6, 0, NULL, "pqr", 3, dx));
    ONE("ExtTextOut", "rect dx", ExtTextOut(meta, 7, 8, ETO_OPAQUE, &box, "st", 2, dx));
    ONE("Polygon", "", Polygon(meta, three, 3));
    ONE("Polyline", "", Polyline(meta, three, 3));
    ONE("PolyPolygon", "", PolyPolygon(meta, many, counts, 2));
    ONE("Escape", "QUERYESCSUPPORT", Escape(meta, QUERYESCSUPPORT, 2, (LPCSTR)&counts[0], NULL));
    ONE("Escape", "3000", Escape(meta, 3000, 3, "abc", NULL));
    ONE("Escape", "NEWFRAME", Escape(meta, NEWFRAME, 0, NULL, NULL));
    ONE("StartPage", "", StartPage(meta));
    ONE("EndPage", "", EndPage(meta));
    ONE("EndDoc", "", EndDoc(meta));
    ONE("AbortDoc", "", AbortDoc(meta));
    {
        DOCINFO info;

        info.cbSize = sizeof info;
        info.lpszDocName = "Doc";
        info.lpszOutput = NULL;
        ONE("StartDoc", "", StartDoc(meta, &info));
    }
}

/* Handles a probe knows by name, to write what `SelectObject` answers. */
static HGDIOBJ known[8];

static LPCSTR named(HGDIOBJ handle)
{
    static char name[24];
    int index;

    if (!handle) {
        return "0";
    }

    for (index = 0; index <= 16; index++) {
        if (handle == GetStockObject(index)) {
            wsprintf(name, "stock %d", index);
            return name;
        }
    }

    for (index = 0; index < 8; index++) {
        if (handle == known[index]) {
            wsprintf(name, "known %d", index);
            return name;
        }
    }

    wsprintf(name, "%u", (UINT)handle == 1 ? 1 : 0xffff);
    return name;
}

/* A call that answers a handle: the handle's name after its arguments. */
#define PICK(name, args, call)                                                                     \
    do {                                                                                           \
        HGDIOBJ answer;                                                                            \
        begin();                                                                                   \
        answer = (HGDIOBJ)(call);                                                                  \
        wsprintf(probeArgs, "%s:", (LPSTR)(args));                                                 \
        lstrcat(probeArgs, named(answer));                                                         \
        end(name, probeArgs, 0);                                                                   \
    } while (0)

static void objects(void)
{
    HPEN pen = CreatePen(PS_DASH, 1, RGB(0, 0, 255));
    HPEN wide = CreatePen(PS_SOLID, 3, RGB(1, 2, 3));
    HBRUSH solid = CreateSolidBrush(RGB(0, 255, 0));
    HBRUSH hatch = CreateHatchBrush(HS_CROSS, RGB(255, 0, 0));
    HBRUSH monoBrush = CreatePatternBrush(mono);
    HBRUSH colourBrush = CreatePatternBrush(colour);
    HBRUSH dibPattern = CreateDIBPatternBrush(dib, DIB_RGB_COLORS);
    HRGN rect = CreateRectRgn(1, 2, 30, 40);
    HFONT font;
    HFONT second;

    {
        static LOGFONT small;
        static LOGFONT arial;

        small.lfHeight = 8;
        small.lfWeight = 400;
        lstrcpy(small.lfFaceName, "Small Fonts");
        font = CreateFontIndirect(&small);
        arial.lfHeight = -13;
        arial.lfWidth = 5;
        arial.lfEscapement = 900;
        arial.lfWeight = 700;
        arial.lfItalic = 1;
        arial.lfCharSet = ANSI_CHARSET;
        arial.lfPitchAndFamily = VARIABLE_PITCH | FF_SWISS;
        lstrcpy(arial.lfFaceName, "Arial");
        second = CreateFontIndirect(&arial);
    }

    probeNote("object");
    known[0] = pen;
    known[1] = wide;
    known[2] = solid;
    known[3] = hatch;
    known[4] = font;
    known[5] = rect;
    PICK("SelectObject", "pen", SelectObject(meta, pen));
    PICK("SelectObject", "wide pen", SelectObject(meta, wide));
    PICK("SelectObject", "solid brush", SelectObject(meta, solid));
    PICK("SelectObject", "hatch brush", SelectObject(meta, hatch));
    PICK("SelectObject", "mono pattern brush", SelectObject(meta, monoBrush));
    PICK("SelectObject", "colour pattern brush", SelectObject(meta, colourBrush));
    PICK("SelectObject", "DIB pattern brush", SelectObject(meta, dibPattern));
    PICK("SelectObject", "font", SelectObject(meta, font));
    PICK("SelectObject", "second font", SelectObject(meta, second));
    PICK("SelectObject", "NULL_BRUSH", SelectObject(meta, GetStockObject(NULL_BRUSH)));
    PICK("SelectObject", "WHITE_PEN", SelectObject(meta, GetStockObject(WHITE_PEN)));
    PICK("SelectObject", "SYSTEM_FONT", SelectObject(meta, GetStockObject(SYSTEM_FONT)));
    PICK("SelectObject", "region", SelectObject(meta, rect));
    PICK("SelectObject", "bitmap", SelectObject(meta, mono));

    begin();
    SelectObject(meta, pen);
    SelectObject(meta, solid);
    SelectObject(meta, GetStockObject(BLACK_PEN));
    {
        HGDIOBJ answer = SelectObject(meta, pen);
        end("SelectObject", named(answer), 0);
    }

    begin();
    SelectObject(meta, pen);
    SelectObject(meta, font);
    {
        HGDIOBJ answer = SelectObject(meta, wide);
        HGDIOBJ again = SelectObject(meta, second);

        wsprintf(probeArgs, "%s,", named(answer));
        lstrcat(probeArgs, named(again));
        end("SelectObject", probeArgs, 0);
    }

    begin();
    SelectObject(meta, wide);
    SelectObject(meta, hatch);
    {
        HPEN other = CreatePen(PS_DOT, 1, RGB(9, 9, 9));
        DWORD deleted = DeleteObject(wide);
        DWORD answer = SelectObject(meta, other) != NULL;
        DWORD after = DeleteObject(other);

        wsprintf(probeArgs, "%lu,%lu", deleted, after);
        end("DeleteObject", probeArgs, answer);
    }

    begin();
    SelectObject(meta, solid);
    SelectObject(meta, GetStockObject(BLACK_BRUSH));
    end("DeleteObject", "deselected", DeleteObject(solid));

    {
        static struct {
            WORD version;
            WORD count;
            PALETTEENTRY entries[3];
        } logical = {0x300, 3, {{1, 2, 3, 0}, {4, 5, 6, PC_RESERVED}, {7, 8, 9, 0}}};
        static PALETTEENTRY changed[2] = {{11, 12, 13, 0}, {14, 15, 16, PC_RESERVED}};
        HPALETTE palette = CreatePalette((LOGPALETTE FAR *)&logical);

        known[6] = palette;
        PICK("SelectPalette", "", SelectPalette(meta, palette, FALSE));
        DeleteObject(palette);

        palette = CreatePalette((LOGPALETTE FAR *)&logical);
        begin();
        SelectPalette(meta, palette, FALSE);
        end("RealizePalette", "", RealizePalette(meta));
        DeleteObject(palette);

        palette = CreatePalette((LOGPALETTE FAR *)&logical);
        begin();
        SelectPalette(meta, palette, FALSE);
        end("SetPaletteEntries", "", SetPaletteEntries(palette, 0, 2, changed));
        DeleteObject(palette);

        palette = CreatePalette((LOGPALETTE FAR *)&logical);
        begin();
        SelectPalette(meta, palette, FALSE);
        end("ResizePalette", "", ResizePalette(palette, 5));
        DeleteObject(palette);
    }

    DeleteObject(pen);
    DeleteObject(solid);
    DeleteObject(hatch);
    DeleteObject(monoBrush);
    DeleteObject(colourBrush);
    DeleteObject(dibPattern);
    DeleteObject(rect);
    DeleteObject(font);
    DeleteObject(second);
}

static void regions(void)
{
    HRGN rect = CreateRectRgn(1, 2, 30, 40);
    HRGN round = CreateEllipticRgn(0, 0, 12, 9);
    HRGN empty = CreateRectRgn(0, 0, 0, 0);
    HBRUSH brush = CreateSolidBrush(RGB(0, 0, 128));
    HRGN two = CreateRectRgn(0, 0, 4, 4);
    HRGN ell = CreateRectRgn(0, 0, 3, 6);

    {
        HRGN other = CreateRectRgn(8, 0, 12, 4);

        CombineRgn(two, two, other, RGN_OR);
        SetRectRgn(other, 0, 4, 9, 6);
        CombineRgn(ell, ell, other, RGN_OR);
        DeleteObject(other);
    }

    probeNote("region");
    ONE("FillRgn", "rect", FillRgn(meta, rect, brush));
    ONE("FillRgn", "ellipse", FillRgn(meta, round, brush));
    ONE("FrameRgn", "rect", FrameRgn(meta, rect, brush, 2, 3));
    ONE("InvertRgn", "rect", InvertRgn(meta, rect));
    ONE("PaintRgn", "ellipse", PaintRgn(meta, round));
    ONE("PaintRgn", "empty", PaintRgn(meta, empty));
    ONE("PaintRgn", "two", PaintRgn(meta, two));
    ONE("PaintRgn", "L", PaintRgn(meta, ell));
    ONE("SelectClipRgn", "rect", SelectClipRgn(meta, rect));
    ONE("SelectClipRgn", "NULL", SelectClipRgn(meta, NULL));

    begin();
    FillRgn(meta, rect, brush);
    {
        DWORD answer = PaintRgn(meta, rect);
        end("PaintRgn", "after FillRgn", answer);
    }

    DeleteObject(rect);
    DeleteObject(round);
    DeleteObject(empty);
    DeleteObject(two);
    DeleteObject(ell);
    DeleteObject(brush);
}

static void bitmaps(void)
{
    HDC memory = CreateCompatibleDC(screen);
    HBITMAP old = SelectObject(memory, mono);
    LPBITMAPINFO info;
    BYTE FAR *bits;

    probeNote("bitmap");
    ONE("BitBlt", "mono", BitBlt(meta, 1, 2, 8, 8, memory, 0, 0, SRCCOPY));
    ONE("StretchBlt", "mono", StretchBlt(meta, 1, 2, 16, 12, memory, 1, 1, 6, 5, SRCAND));
    SelectObject(memory, colour);
    ONE("BitBlt", "colour", BitBlt(meta, 3, 4, 5, 6, memory, 1, 2, SRCCOPY));
    ONE("StretchBlt", "colour", StretchBlt(meta, 3, 4, 10, 12, memory, 0, 0, 8, 8, SRCPAINT));
    SelectObject(memory, old);
    DeleteDC(memory);

    info = (LPBITMAPINFO)GlobalLock(dib);
    bits = (BYTE FAR *)info + sizeof(BITMAPINFOHEADER) + 16 * sizeof(RGBQUAD);
    ONE("SetDIBitsToDevice", "", SetDIBitsToDevice(meta, 1, 2, 8, 8, 0, 0, 0, 8, bits, info, DIB_RGB_COLORS));
    ONE("SetDIBitsToDevice", "part", SetDIBitsToDevice(meta, 3, 4, 5, 3, 1, 2, 2, 4, bits, info, DIB_RGB_COLORS));
    ONE("StretchDIBits", "", StretchDIBits(meta, 1, 2, 16, 16, 0, 0, 8, 8, bits, info, DIB_RGB_COLORS, SRCCOPY));
    GlobalUnlock(dib);
}

static void asks(void)
{
    char text[40];
    TEXTMETRIC metrics;
    RECT box;
    POINT points[2];
    int widths[2];
    DWORD answer;

    probeNote("ask");
    ONE("GetTextColor", "", GetTextColor(meta));
    ONE("GetBkColor", "", GetBkColor(meta));
    ONE("GetBkMode", "", GetBkMode(meta));
    ONE("GetMapMode", "", GetMapMode(meta));
    ONE("GetROP2", "", GetROP2(meta));
    ONE("GetTextAlign", "", GetTextAlign(meta));
    ONE("GetPolyFillMode", "", GetPolyFillMode(meta));
    ONE("GetStretchBltMode", "", GetStretchBltMode(meta));
    ONE("GetRelAbs", "", getRelAbs(meta));
    ONE("GetTextCharacterExtra", "", GetTextCharacterExtra(meta));
    ONE("GetCurrentPosition", "", GetCurrentPosition(meta));
    ONE("GetWindowOrg", "", GetWindowOrg(meta));
    ONE("GetWindowExt", "", GetWindowExt(meta));
    ONE("GetViewportOrg", "", GetViewportOrg(meta));
    ONE("GetViewportExt", "", GetViewportExt(meta));
    ONE("GetBrushOrg", "", GetBrushOrg(meta));
    ONE("GetDCOrg", "", GetDCOrg(meta));
    ONE("GetTextExtent", "", GetTextExtent(meta, "Hello", 5));
    ONE("GetPixel", "", GetPixel(meta, 1, 1));
    ONE("GetNearestColor", "", GetNearestColor(meta, RGB(1, 2, 3)));
    ONE("PtVisible", "", PtVisible(meta, 1, 1));
    ONE("SetBrushOrg", "", SetBrushOrg(meta, 3, 4));

    begin();
    lstrcpy(text, "unchanged");
    answer = GetTextFace(meta, sizeof text, text);
    end("GetTextFace", text, answer);

    begin();
    metrics.tmHeight = 0x7777;
    answer = GetTextMetrics(meta, &metrics);
    wsprintf(probeArgs, "%d", metrics.tmHeight);
    end("GetTextMetrics", probeArgs, answer);

    begin();
    SetRect(&box, 0x7777, 0x7777, 0x7777, 0x7777);
    answer = GetClipBox(meta, &box);
    wsprintf(probeArgs, "%d,%d,%d,%d", box.left, box.top, box.right, box.bottom);
    end("GetClipBox", probeArgs, answer);

    begin();
    SetRect(&box, 1, 2, 3, 4);
    end("RectVisible", "", RectVisible(meta, &box));

    begin();
    points[0].x = 10;
    points[0].y = 20;
    points[1].x = 30;
    points[1].y = 40;
    answer = LPtoDP(meta, points, 2);
    wsprintf(probeArgs, "%d,%d,%d,%d", points[0].x, points[0].y, points[1].x, points[1].y);
    end("LPtoDP", probeArgs, answer);

    begin();
    answer = DPtoLP(meta, points, 2);
    wsprintf(probeArgs, "%d,%d,%d,%d", points[0].x, points[0].y, points[1].x, points[1].y);
    end("DPtoLP", probeArgs, answer);

    begin();
    widths[0] = widths[1] = 0x7777;
    answer = GetCharWidth(meta, 'A', 'B', widths);
    wsprintf(probeArgs, "%d,%d", widths[0], widths[1]);
    end("GetCharWidth", probeArgs, answer);

    begin();
    point.x = point.y = 0x7777;
    answer = GetCurrentPositionEx(meta, &point);
    pointed("GetCurrentPositionEx", answer);

    begin();
    point.x = point.y = 0x7777;
    answer = GetWindowOrgEx(meta, &point);
    pointed("GetWindowOrgEx", answer);
}

static void caps(void)
{
    int index;
    LPSTR out;

    probeNote("caps");
    begin();
    out = probeResult;

    for (index = 0; index <= 0x70; index++) {
        out += wsprintf(out, "%s%x", (LPSTR)(index ? " " : ""), GetDeviceCaps(meta, index));
    }

    probe("GetDeviceCaps", "0-70", probeResult);
    end("GetDeviceCaps", "records", 0);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    probeOpen(OUTPUT);
    screen = GetDC(NULL);
    setRelAbs = (DWORDPROC2)GetProcAddress(GetModuleHandle("GDI"), MAKEINTRESOURCE(5));
    getRelAbs = (DWORDPROC1)GetProcAddress(GetModuleHandle("GDI"), MAKEINTRESOURCE(86));
    makeBitmaps();

    ONE("CreateMetaFile", "nothing", 0);
    sets();
    draws();
    objects();
    regions();
    bitmaps();
    asks();
    caps();

    DeleteObject(mono);
    DeleteObject(colour);
    GlobalFree(dib);
    ReleaseDC(NULL, screen);
    probeFinish();
    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
