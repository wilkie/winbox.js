/*
 * Where GDI keeps a bitmap: what a program finds when it walks from a
 * bitmap's handle into GDI's data segment, as the engine Bubble Girl of the
 * corpus brings does, to draw into the bitmap's bits itself. Bitmaps
 * compatible with the screen, 20 by 3, 33 by 2, 320 by 220 and 16 by 1 to 4,
 * all but the first walked before they are selected into a device context
 * and after.
 *
 * * `handle`: the handle's low two bits; whether the type is found at the
 *   handle (`fixed`) or at the word the handle holds (`moveable`); and the
 *   two bytes after that word.
 * * `object`: the type word at +2, and the word at +0Ah as a global handle:
 *   its low three bits, whether `GlobalLock` gives its selector with the low
 *   bit set at offset nought, and the block's size.
 * * `header`: the block's words at 0, 2, 4 and 6, bytes at 8 and 9, the far
 *   pointer at 0Ah as `same:offset` when in the block (`null` when it is
 *   nought, as it is until the bitmap is selected), the double word at
 *   0Eh, and the words at 16h, 18h and 1Ah, in hex.
 * * `bits`: the 20-by-3 bitmap's pixel bytes, filled with SetPixel, the
 *   pixel at x, y the display's colour (x + 5y) mod 16; the bits of each row
 *   past its twentieth pixel as nought, whatever they held.
 * * `poke`: `GetPixel` of the first pixels after the first byte of the bits
 *   is written with FFh, as colour digits.
 */

#include "probe.h"

#include <toolhelp.h>

#define OUTPUT "C:\\ORACLE\\GDIOBJ.OUT"

static const COLORREF PALETTE[16] = {
    RGB(0, 0, 0),       RGB(128, 0, 0),     RGB(0, 128, 0),   RGB(128, 128, 0),
    RGB(0, 0, 128),     RGB(128, 0, 128),   RGB(0, 128, 128), RGB(192, 192, 192),
    RGB(128, 128, 128), RGB(255, 0, 0),     RGB(0, 255, 0),   RGB(255, 255, 0),
    RGB(0, 0, 255),     RGB(255, 0, 255),   RGB(0, 255, 255), RGB(255, 255, 255),
};

static const char HEX[] = "0123456789abcdef";

static HDC screen;
static WORD heap;

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

/* The bitmap's object in GDI's heap, found as the engine finds it. */
static WORD objectOf(LPCSTR name, HBITMAP bitmap)
{
    WORD object = (WORD)bitmap;
    LPCSTR form = "fixed";
    BYTE FAR *entry = (BYTE FAR *)MAKELP(heap, (WORD)bitmap);

    if ((*(WORD FAR *)MAKELP(heap, object + 2) & 0x5fff) != 5 &&
        *(WORD FAR *)MAKELP(heap, object + 2) != 0x4f4b) {
        object = *(WORD FAR *)entry;
        form = "moveable";
    }

    wsprintf(probeResult, "%d %s %02x %02x", (WORD)bitmap & 3, form, entry[2], entry[3]);
    probe("handle", name, probeResult);

    return object;
}

static BYTE FAR *walk(LPCSTR name, HBITMAP bitmap, WORD FAR *block)
{
    WORD object = objectOf(name, bitmap);
    WORD handle = *(WORD FAR *)MAKELP(heap, object + 10);
    BYTE FAR *header = (BYTE FAR *)GlobalLock((HGLOBAL)handle);
    DWORD pointer = *(DWORD FAR *)(header + 10);

    wsprintf(probeResult, "%04x %d %s %lx", *(WORD FAR *)MAKELP(heap, object + 2), handle & 7,
             (LPSTR)(HIWORD((DWORD)header) == (handle | 1) && !LOWORD((DWORD)header) ? "lock"
                                                                                    : "other"),
             GlobalSize((HGLOBAL)handle));
    probe("object", name, probeResult);

    wsprintf(probeResult, "%x %x %x %x %x %x %s:%x %lx %x %x %x", *(WORD FAR *)(header + 0),
             *(WORD FAR *)(header + 2), *(WORD FAR *)(header + 4), *(WORD FAR *)(header + 6),
             header[8], header[9],
             (LPSTR)(!pointer                                      ? "null"
                     : HIWORD(pointer) == HIWORD((DWORD)header) ? "same"
                                                                : "other"),
             LOWORD(pointer), *(DWORD FAR *)(header + 14), *(WORD FAR *)(header + 22),
             *(WORD FAR *)(header + 24), *(WORD FAR *)(header + 26));
    probe("header", name, probeResult);

    *block = handle;

    return (BYTE FAR *)pointer;
}

/* Walked before it is selected into a device context, and after. */
static void header(LPCSTR name, LPCSTR selected, HDC memory, int wide, int high)
{
    HBITMAP bitmap = CreateCompatibleBitmap(screen, wide, high);
    HBITMAP old;
    WORD block;

    walk(name, bitmap, &block);
    GlobalUnlock((HGLOBAL)block);

    old = SelectObject(memory, bitmap);
    walk(selected, bitmap, &block);
    GlobalUnlock((HGLOBAL)block);

    SelectObject(memory, old);
    DeleteObject(bitmap);
}

/*
 * A bitmap of more than 64 KiB, 704 by 480, as Bubble Girl's is: black but
 * for a dark red pixel -- colour 1, its first plane's bit alone -- at the
 * start of the rows either side of where its first and second segments end.
 * `bits-block` is the size of the block the bits are in. `huge` records,
 * for each such row, which segment its first plane's first
 * byte is in -- counted from the bits' pointer's selector, a segment the
 * `16h` word on from the last -- and at what offset: found by looking for
 * the byte 80h, which is only there, and taking it out once found; in the
 * rows each segment holds by the header, not the bytes left after them,
 * which are whatever the memory held.
 */
static void beyond64k(HDC memory)
{
    HBITMAP bitmap = CreateCompatibleBitmap(screen, 704, 480);
    HBITMAP old = SelectObject(memory, bitmap);
    BYTE FAR *bits;
    BYTE FAR *header;
    WORD block;
    WORD step;
    WORD lines;
    int rows[4];
    int i;

    PatBlt(memory, 0, 0, 704, 480, BLACKNESS);

    bits = walk("704x480", bitmap, &block);
    header = (BYTE FAR *)GlobalLock((HGLOBAL)block);
    step = *(WORD FAR *)(header + 22);
    lines = *(WORD FAR *)(header + 24);
    GlobalUnlock((HGLOBAL)block);

    wsprintf(probeResult, "%lx", GlobalSize((HGLOBAL)LOWORD(GlobalHandle(HIWORD((DWORD)bits)))));
    probe("bits-block", "704x480", probeResult);

    rows[0] = lines - 1;
    rows[1] = lines;
    rows[2] = 2 * lines - 1;
    rows[3] = 2 * lines;

    for (i = 0; i < 4; i++) {
        SetPixel(memory, 0, rows[i], RGB(128, 0, 0));
    }

    for (i = 0; i < 4; i++) {
        WORD selector = HIWORD((DWORD)bits);
        int segment;
        long offset;
        LPCSTR found = "none";

        for (segment = 0; segment < 3 && found[0] == 'n'; segment++) {
            BYTE FAR *base = (BYTE FAR *)MAKELP(selector + segment * step, 0);
            /* The rows a segment holds, as the header says: the bytes after
             * them are whatever the memory held. */
            DWORD limit = (DWORD)lines * 88 * 4 - 1;

            for (offset = 0; offset <= (long)limit; offset += 1) {
                if (base[(WORD)offset] == 0x80) {
                    wsprintf(probeArgs, "704x480 row %d", rows[i]);
                    wsprintf(probeResult, "%d:%lx", segment, offset);
                    probe("huge", probeArgs, probeResult);
                    base[(WORD)offset] = 0;
                    found = "yes";
                    break;
                }
            }
        }

        if (found[0] == 'n') {
            wsprintf(probeArgs, "704x480 row %d", rows[i]);
            probe("huge", probeArgs, "none");
        }
    }

    SelectObject(memory, old);
    DeleteObject(bitmap);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    SYSHEAPINFO info;
    HDC memory;
    HBITMAP bitmap;
    HBITMAP old;
    BYTE FAR *bits;
    WORD block;
    LPSTR out;
    int x;
    int y;

    probeOpen(OUTPUT);

    info.dwSize = sizeof(info);
    SystemHeapInfo(&info);
    heap = GlobalHandleToSel(info.hGDISegment);

    screen = GetDC(NULL);
    memory = CreateCompatibleDC(screen);
    bitmap = CreateCompatibleBitmap(screen, 20, 3);
    old = SelectObject(memory, bitmap);

    for (y = 0; y < 3; y++) {
        for (x = 0; x < 20; x++) {
            SetPixel(memory, x, y, PALETTE[(x + 5 * y) % 16]);
        }
    }

    bits = walk("20x3", bitmap, &block);

    /* Four bytes a plane's row, of which 20 bits are pixels: the rest is
     * whatever the memory held, and left out. */
    out = probeResult;
    for (x = 0; x < 48; x++) {
        BYTE value = bits[x];

        if (x % 4 == 2) {
            value &= 0xf0;
        } else if (x % 4 == 3) {
            value = 0;
        }

        *out++ = HEX[value >> 4];
        *out++ = HEX[value & 15];
    }
    *out = '\0';
    probe("bits", "20x3", probeResult);

    bits[0] = 0xff;

    out = probeResult;
    for (x = 0; x < 10; x++) {
        *out++ = digit(GetPixel(memory, x, 0));
    }
    *out = '\0';
    probe("poke", "20x3", probeResult);

    GlobalUnlock((HGLOBAL)block);
    SelectObject(memory, old);
    DeleteObject(bitmap);

    header("33x2", "33x2-selected", memory, 33, 2);
    header("320x220", "320x220-selected", memory, 320, 220);

    /* Bits of 8, 16, 24 and 32 bytes: how much more than the header and the
     * bits the block is given, rounded as it is. */
    header("16x1", "16x1-selected", memory, 16, 1);
    header("16x2", "16x2-selected", memory, 16, 2);
    header("16x3", "16x3-selected", memory, 16, 3);
    header("16x4", "16x4-selected", memory, 16, 4);

    beyond64k(memory);

    DeleteDC(memory);
    ReleaseDC(NULL, screen);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
