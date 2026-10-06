/*
 * DeleteObject of objects a program does not own alone: the stock objects,
 * which every program is given the same handle of, and objects still
 * selected into a device context. Two Notepads give their edit controls the
 * same stock font, and the first to exit deletes it. Recorded on each
 * display, for the stock fonts' `LOGFONT`s.
 *
 * * `stock`: for each stock object, DeleteObject's answer; then whether
 *   GetStockObject still answers the `same` handle; then GetObject's answer
 *   for it, how many bytes and those bytes, with room for 16 -- for a font
 *   50, a whole `LOGFONT` -- the buffer filled with EEh first; and
 *   SelectObject of it into a memory device
 *   context (a palette by SelectPalette): whether the answer is nought.
 * * `stockagain`: DeleteObject of the white brush a second time.
 * * `stockbitmap`: the bitmap a new memory device context has, which
 *   SelectObject gives back when another is selected: DeleteObject's answer
 *   and GetObject's after it.
 * * `reuse`: after the stock objects are deleted, a brush made: whether its
 *   handle is one of theirs.
 * * `selected`: a pen, a brush, a font and a bitmap made and selected into a
 *   memory device context, then deleted there: DeleteObject's answer;
 *   GetObject's answer after it; DeleteObject's answer a second time;
 *   SelectObject of it into a second memory device context; and, putting the
 *   first context's own object back, whether SelectObject answers the
 *   deleted object's handle.
 * * `twice`: a pen made, deleted, and deleted again; GetObject and
 *   SelectObject of it after.
 * * `null`: DeleteObject of nought.
 * * `room`: GetObject of a made bitmap, eight by eight, with room for 6,
 *   14 and 20 bytes; and of a font made with the face Helv and with none,
 *   with room for 50.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\STOCKDEL.OUT"

static const char HEX[] = "0123456789abcdef";

/* GetObject's answer with room for `room` bytes, and the bytes it wrote, as
 * "count;bytes". */
static void object(LPSTR out, HANDLE handle, int room)
{
    BYTE bytes[64];
    int count;
    int at;

    for (at = 0; at < 64; at++) {
        bytes[at] = 0xee;
    }

    count = GetObject(handle, room, bytes);
    out += wsprintf(out, "%d;", count);

    for (at = 0; at < room; at++) {
        *out++ = HEX[bytes[at] >> 4];
        *out++ = HEX[bytes[at] & 15];
    }

    *out = '\0';
}

static void answer(LPCSTR function, LPCSTR args, int value)
{
    wsprintf(probeResult, "%d", value);
    probe(function, args, probeResult);
}

static void yes(LPCSTR function, LPCSTR args, BOOL value)
{
    probe(function, args, value ? "yes" : "no");
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static const char *NAMES[] = {"WHITE_BRUSH", "LTGRAY_BRUSH", "GRAY_BRUSH", "DKGRAY_BRUSH",
                                  "BLACK_BRUSH", "NULL_BRUSH",   "WHITE_PEN",  "BLACK_PEN",
                                  "NULL_PEN",    "9",            "OEM_FIXED_FONT", "ANSI_FIXED_FONT",
                                  "ANSI_VAR_FONT", "SYSTEM_FONT", "DEVICE_DEFAULT_FONT",
                                  "DEFAULT_PALETTE", "SYSTEM_FIXED_FONT"};
    HANDLE stock[17];
    HDC screen;
    HDC memory;
    HDC other;
    HANDLE made[4];
    HANDLE own[4];
    HANDLE got;
    HBITMAP bitmap;
    HBITMAP first;
    HPEN pen;
    int index;
    int kind;

    probeOpen(OUTPUT);

    screen = GetDC(NULL);
    memory = CreateCompatibleDC(screen);
    other = CreateCompatibleDC(screen);

    for (index = 0; index <= 16; index++) {
        stock[index] = GetStockObject(index);
        wsprintf(probeArgs, "%s,delete", (LPSTR)NAMES[index]);
        answer("stock", probeArgs, DeleteObject(stock[index]));
        wsprintf(probeArgs, "%s,same", (LPSTR)NAMES[index]);
        yes("stock", probeArgs, GetStockObject(index) == stock[index]);
        wsprintf(probeArgs, "%s,object", (LPSTR)NAMES[index]);
        object(probeResult, stock[index],
               index >= OEM_FIXED_FONT && index != DEFAULT_PALETTE ? 50 : 16);
        probe("stock", probeArgs, probeResult);

        if (index == DEFAULT_PALETTE) {
            got = SelectPalette(memory, stock[index], FALSE);
            SelectPalette(memory, got, FALSE);
        } else {
            got = SelectObject(memory, stock[index]);
            SelectObject(memory, got);
        }

        wsprintf(probeArgs, "%s,select", (LPSTR)NAMES[index]);
        yes("stock", probeArgs, got != NULL);
    }

    answer("stockagain", "WHITE_BRUSH", DeleteObject(stock[WHITE_BRUSH]));

    bitmap = CreateCompatibleBitmap(screen, 8, 8);
    first = SelectObject(memory, bitmap);
    answer("stockbitmap", "delete", DeleteObject(first));
    object(probeResult, first, 16);
    probe("stockbitmap", "object", probeResult);
    SelectObject(memory, first);
    DeleteObject(bitmap);

    got = CreateSolidBrush(RGB(1, 2, 3));

    for (index = 0; index <= 16; index++) {
        if (got == stock[index]) {
            break;
        }
    }

    yes("reuse", "stock", index <= 16);
    DeleteObject(got);

    made[0] = CreatePen(PS_SOLID, 1, RGB(255, 0, 0));
    made[1] = CreateSolidBrush(RGB(0, 255, 0));
    made[2] = CreateFont(12, 0, 0, 0, 400, 0, 0, 0, 0, 0, 0, 0, 0, "Helv");
    made[3] = CreateCompatibleBitmap(memory, 8, 8);

    for (kind = 0; kind < 4; kind++) {
        static const char *KINDS[] = {"pen", "brush", "font", "bitmap"};

        own[kind] = SelectObject(memory, made[kind]);
        wsprintf(probeArgs, "%s,delete", (LPSTR)KINDS[kind]);
        answer("selected", probeArgs, DeleteObject(made[kind]));
        wsprintf(probeArgs, "%s,object", (LPSTR)KINDS[kind]);
        object(probeResult, made[kind], 16);
        probe("selected", probeArgs, probeResult);
        wsprintf(probeArgs, "%s,again", (LPSTR)KINDS[kind]);
        answer("selected", probeArgs, DeleteObject(made[kind]));
        wsprintf(probeArgs, "%s,select", (LPSTR)KINDS[kind]);
        got = SelectObject(other, made[kind]);
        yes("selected", probeArgs, got != NULL);

        if (got != NULL) {
            SelectObject(other, got);
        }

        wsprintf(probeArgs, "%s,back", (LPSTR)KINDS[kind]);
        yes("selected", probeArgs, SelectObject(memory, own[kind]) == made[kind]);
    }

    pen = CreatePen(PS_DASH, 1, RGB(0, 0, 255));
    answer("twice", "first", DeleteObject(pen));
    answer("twice", "second", DeleteObject(pen));
    object(probeResult, pen, 16);
    probe("twice", "object", probeResult);
    yes("twice", "select", SelectObject(memory, pen) != NULL);

    answer("null", "delete", DeleteObject(NULL));

    bitmap = CreateBitmap(8, 8, 1, 1, NULL);
    object(probeResult, bitmap, 6);
    probe("room", "bitmap,6", probeResult);
    object(probeResult, bitmap, 14);
    probe("room", "bitmap,14", probeResult);
    object(probeResult, bitmap, 20);
    probe("room", "bitmap,20", probeResult);
    DeleteObject(bitmap);

    made[2] = CreateFont(12, 0, 0, 0, 400, 0, 0, 0, 0, 0, 0, 0, 0, "Helv");
    object(probeResult, made[2], 50);
    probe("room", "font Helv,50", probeResult);
    DeleteObject(made[2]);
    made[2] = CreateFont(12, 0, 0, 0, 400, 0, 0, 0, 0, 0, 0, 0, 0, "");
    object(probeResult, made[2], 50);
    probe("room", "font none,50", probeResult);
    DeleteObject(made[2]);

    DeleteDC(other);
    DeleteDC(memory);
    ReleaseDC(NULL, screen);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
