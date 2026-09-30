/*
 * Metafiles: GDI calls recorded into a memory metafile, its bytes, and the
 * metafile played back.
 *
 * `CreateMetaFile(NULL)`, then, into its device context, each with its
 * answer recorded as `call`:
 *   SetBkMode(TRANSPARENT), SetTextColor(red), SetPixel(1, 1, red),
 *   SelectObject of a blue solid pen of width 1, SelectObject of a green
 *   solid brush, Rectangle(2, 2, 20, 14), Ellipse(22, 2, 40, 14),
 *   MoveTo(2, 18), LineTo(40, 18), TextOut(2, 20, "Hi"),
 *   PatBlt(30, 22, 8, 6, PATCOPY), SelectObject of the stock black pen,
 *   DeleteObject of the blue pen; then SaveDC, IntersectClipRect(0, 0, 46,
 *   31), Polygon of (24, 20) (34, 30) (44, 20), Polyline of (2, 31)
 *   (10, 26) (18, 31), SelectObject of Small Fonts 8 high, ExtTextOut(20, 24,
 *   ETO_OPAQUE, (20, 24)-(30, 30), "Ab"), SelectObject of Arial 10 high and
 *   bold, RestoreDC(-1), SetROP2(R2_NOT),
 *   Arc(36, 22, 46, 30, 46, 26, 36, 26) and RoundRect(40, 2, 47, 12, 4, 4).
 * The fonts are made by `CreateFontIndirect` from `LOGFONT`s that start
 * zeroed, so what follows a face name's end is known.
 * `CloseMetaFile` makes it a metafile.
 *
 * * `bits`: `GetMetaFileBits`' block: the metafile's size in bytes, from its
 *   header, and whether the block holds that many -- it holds more, whose
 *   bytes are whatever was there -- then its bytes, 32 to a record, in
 *   hexadecimal, `at` the offset of each. A font's record holds two bytes
 *   past its face name's end that are whatever was in GDI's memory; they
 *   are printed as noughts.
 * * `play`: `SetMetaFileBits` of the block made a metafile again, played
 *   with `PlayMetaFile` into a cell 48 by 32 on the screen, over white, and
 *   the cell read back a row at a time, palette digits.
 * * `enum`: `EnumMetaFile` of it: each record's function and size in words,
 *   as its procedure was given them, and the handle table's size; the
 *   procedure plays each with `PlayMetaFileRecord` into a second cell,
 *   `replayed`, read back the same.
 * * `other`: `CopyMetaFile` to memory, `DeleteMetaFile`'s answers.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\METAFILE.OUT"

#define W 48
#define H 32

static const char HEX[] = "0123456789abcdef";

static const COLORREF PALETTE[16] = {
    RGB(0, 0, 0),       RGB(128, 0, 0),     RGB(0, 128, 0),   RGB(128, 128, 0),
    RGB(0, 0, 128),     RGB(128, 0, 128),   RGB(0, 128, 128), RGB(192, 192, 192),
    RGB(128, 128, 128), RGB(255, 0, 0),     RGB(0, 255, 0),   RGB(255, 255, 0),
    RGB(0, 0, 255),     RGB(255, 0, 255),   RGB(0, 255, 255), RGB(255, 255, 255),
};

static HDC screen;
static char listed[1024];
static LPSTR listAt;

static char digit(COLORREF colour)
{
    int index;

    for (index = 0; index < 16; index++) {
        if (PALETTE[index] == (colour & 0xffffffL)) {
            return HEX[index];
        }
    }

    return '?';
}

static void rows(LPCSTR name, int left)
{
    int x;
    int y;

    for (y = 0; y < H; y++) {
        for (x = 0; x < W; x++) {
            probeResult[x] = digit(GetPixel(screen, left + x, y));
        }

        probeResult[W] = '\0';
        wsprintf(probeArgs, "%s,y=%d", name, y);
        probe("rows", probeArgs, probeResult);
    }
}

static void call(LPCSTR name, DWORD answer)
{
    wsprintf(probeResult, "%lx", answer);
    probe("call", name, probeResult);
}

int FAR PASCAL _export Record(HDC hdc, HANDLETABLE FAR *table, METARECORD FAR *record, int objects,
                              LPARAM data)
{
    if (listAt - listed < (int)sizeof(listed) - 24) {
        listAt += wsprintf(listAt, "%s%x:%ld:%d", (LPSTR)(listAt == listed ? "" : " "),
                           record->rdFunction, record->rdSize, objects);
    }

    PlayMetaFileRecord(hdc, table, record, objects);
    (void)data;
    return 1;
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HDC meta;
    HPEN pen;
    HBRUSH brush;
    HMETAFILE file;
    HGLOBAL bits;
    FARPROC proc;
    HFONT font;
    HFONT second;

    probeOpen(OUTPUT);
    ShowCursor(FALSE);
    SetCursorPos(GetSystemMetrics(SM_CXSCREEN) - 1, GetSystemMetrics(SM_CYSCREEN) - 1);

    screen = GetDC(NULL);

    meta = CreateMetaFile(NULL);
    call("CreateMetaFile", meta != NULL);
    pen = CreatePen(PS_SOLID, 1, RGB(0, 0, 255));
    brush = CreateSolidBrush(RGB(0, 255, 0));
    {
        static LOGFONT small;
        static LOGFONT arial;

        small.lfHeight = 8;
        small.lfWeight = 400;
        lstrcpy(small.lfFaceName, "Small Fonts");
        font = CreateFontIndirect(&small);
        arial.lfHeight = 10;
        arial.lfWeight = 700;
        lstrcpy(arial.lfFaceName, "Arial");
        second = CreateFontIndirect(&arial);
    }

    call("SetBkMode", SetBkMode(meta, TRANSPARENT));
    call("SetTextColor", SetTextColor(meta, RGB(255, 0, 0)));
    call("SetPixel", SetPixel(meta, 1, 1, RGB(255, 0, 0)));
    call("SelectObject pen", SelectObject(meta, pen) != NULL);
    call("SelectObject brush", SelectObject(meta, brush) != NULL);
    call("Rectangle", Rectangle(meta, 2, 2, 20, 14));
    call("Ellipse", Ellipse(meta, 22, 2, 40, 14));
    call("MoveTo", MoveTo(meta, 2, 18));
    call("LineTo", LineTo(meta, 40, 18));
    call("TextOut", TextOut(meta, 2, 20, "Hi", 2));
    call("PatBlt", PatBlt(meta, 30, 22, 8, 6, PATCOPY));
    call("SelectObject stock", SelectObject(meta, GetStockObject(BLACK_PEN)) != NULL);
    call("DeleteObject", DeleteObject(pen));

    {
        static POINT three[3] = {{24, 20}, {34, 30}, {44, 20}};
        static POINT line[3] = {{2, 31}, {10, 26}, {18, 31}};
        RECT box;

        call("SaveDC", SaveDC(meta));
        call("IntersectClipRect", IntersectClipRect(meta, 0, 0, 46, 31));
        call("Polygon", Polygon(meta, three, 3));
        call("Polyline", Polyline(meta, line, 3));
        call("SelectObject font", SelectObject(meta, font) != NULL);
        SetRect(&box, 20, 24, 30, 30);
        call("ExtTextOut", ExtTextOut(meta, 20, 24, ETO_OPAQUE, &box, "Ab", 2, NULL));
        call("SelectObject second font", SelectObject(meta, second) != NULL);
        call("RestoreDC", RestoreDC(meta, -1));
        call("SetROP2", SetROP2(meta, R2_NOT));
        call("Arc", Arc(meta, 36, 22, 46, 30, 46, 26, 36, 26));
        call("RoundRect", RoundRect(meta, 40, 2, 47, 12, 4, 4));
    }

    file = CloseMetaFile(meta);
    call("CloseMetaFile", file != NULL);

    bits = GetMetaFileBits(file);

    {
        static BYTE copy[1024];
        BYTE FAR *block = GlobalLock(bits);
        BYTE FAR *at = copy;
        DWORD size = *(DWORD FAR *)(block + 6) * 2;
        DWORD offset;
        DWORD record;

        for (offset = 0; offset < size && offset < sizeof(copy); offset++) {
            copy[offset] = block[offset];
        }

        /* A font's record carries two bytes past its face name's end that
         * are whatever GDI's memory held; they are printed as noughts. */
        for (record = 18; record + 6 <= size;) {
            DWORD words = *(DWORD FAR *)(copy + record);

            if (!words) {
                break;
            }

            if (*(WORD FAR *)(copy + record + 4) == 0x02fb) {
                DWORD name = record + 6 + 18;
                DWORD end = record + words * 2;

                while (name < end && copy[name]) {
                    name++;
                }

                while (name < end) {
                    copy[name++] = 0;
                }
            }

            record += words * 2;
        }

        wsprintf(probeResult, "%lu;%d", size, GlobalSize(bits) >= size);
        probe("bits", "size", probeResult);

        for (offset = 0; offset < size; offset += 32) {
            LPSTR out = probeResult;
            DWORD index;

            for (index = offset; index < offset + 32 && index < size; index++) {
                *out++ = HEX[at[index] >> 4];
                *out++ = HEX[at[index] & 15];
            }

            *out = '\0';
            wsprintf(probeArgs, "at=%lu", offset);
            probe("bits", probeArgs, probeResult);
        }

        GlobalUnlock(bits);
    }

    file = SetMetaFileBits(bits);
    call("SetMetaFileBits", file != NULL);

    PatBlt(screen, 0, 0, W * 2, H, WHITENESS);
    call("PlayMetaFile", PlayMetaFile(screen, file));
    rows("play", 0);

    listAt = listed;
    *listAt = '\0';
    proc = MakeProcInstance((FARPROC)Record, instance);
    SetViewportOrg(screen, W, 0);
    call("EnumMetaFile", EnumMetaFile(screen, file, (MFENUMPROC)proc, 0));
    SetViewportOrg(screen, 0, 0);
    FreeProcInstance(proc);
    probe("enum", "records", listed);
    rows("replayed", W);

    {
        HMETAFILE copy = CopyMetaFile(file, NULL);

        call("CopyMetaFile", copy != NULL);
        call("DeleteMetaFile copy", DeleteMetaFile(copy));
    }

    call("DeleteMetaFile", DeleteMetaFile(file));
    DeleteObject(font);
    DeleteObject(second);
    DeleteObject(brush);

    ReleaseDC(NULL, screen);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
