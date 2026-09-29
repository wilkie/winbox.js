/*
 * GDI's handles as numbers: which of them a program can count on. Where a
 * new object's handle falls depends on everything GDI's heap has held since
 * Windows started -- on the Hercules its free handles already had gaps
 * before the probe began, and a memory device context takes more of them on
 * the EGA than on the VGA -- so what is written here is only what held on
 * every display: the stock objects' handles, and which handle a new object
 * is given after others are deleted.
 *
 * * `stock`: GetStockObject's answer for each stock object, as it is;
 *   `stock9`, the same for the index nothing documents, and `stock9object`
 *   what GetObject answers for it, how many bytes, and those bytes.
 * * `reuse`: a pen, a brush, a pen and a font made, then the brush and then
 *   the font deleted; a brush made next, then a pen, and whose handle each
 *   has: the `font`'s, the `brush`'s, or `other`.
 * * `mixed`: a pen made and deleted, then a region made: whether it has the
 *   pen's handle.
 * * `memdc`: a memory device context made and deleted, then a pen made:
 *   whether it has the context's handle.
 * * `dc`: GetDC of the desktop released and asked for again: whether it is
 *   the `same`; and a second held with it: whether that is `other`.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\GDINUM.OUT"

static void whose(LPCSTR function, LPCSTR args, HANDLE got, HANDLE font, HANDLE brush)
{
    probe(function, args, got == font ? "font" : got == brush ? "brush" : "other");
}

static void same(LPCSTR function, LPCSTR args, BOOL yes)
{
    probe(function, args, yes ? "yes" : "no");
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static const char *NAMES[] = {"WHITE_BRUSH", "LTGRAY_BRUSH", "GRAY_BRUSH", "DKGRAY_BRUSH",
                                  "BLACK_BRUSH", "NULL_BRUSH",   "WHITE_PEN",  "BLACK_PEN",
                                  "NULL_PEN",    "9",            "OEM_FIXED_FONT", "ANSI_FIXED_FONT",
                                  "ANSI_VAR_FONT", "SYSTEM_FONT", "DEVICE_DEFAULT_FONT",
                                  "DEFAULT_PALETTE", "SYSTEM_FIXED_FONT"};
    HANDLE pen;
    HANDLE brush;
    HANDLE font;
    HANDLE pen2;
    HANDLE got;
    HDC screen;
    HDC memory;
    HDC one;
    HDC two;
    int index;

    probeOpen(OUTPUT);

    for (index = 0; index <= 16; index++) {
        wsprintf(probeResult, "%x", (UINT)GetStockObject(index));
        probe(index == 9 ? "stock9" : "stock", NAMES[index], probeResult);
    }

    {
        BYTE bytes[64];
        int count = GetObject(GetStockObject(9), sizeof(bytes), bytes);
        LPSTR at = probeResult;
        int index2;

        at += wsprintf(at, "%d:", count);

        for (index2 = 0; index2 < count && index2 < 50; index2++) {
            at += wsprintf(at, "%02x", bytes[index2]);
        }

        probe("stock9object", "9", probeResult);
    }

    screen = GetDC(NULL);

    pen = CreatePen(PS_SOLID, 1, RGB(255, 0, 0));
    brush = CreateSolidBrush(RGB(0, 255, 0));
    pen2 = CreatePen(PS_DASH, 1, RGB(0, 0, 255));
    font = CreateFont(12, 0, 0, 0, 400, 0, 0, 0, 0, 0, 0, 0, 0, "Arial");

    DeleteObject(brush);
    DeleteObject(font);

    got = CreateSolidBrush(RGB(0, 0, 128));
    whose("reuse", "brush", got, font, brush);
    got = CreatePen(PS_SOLID, 2, RGB(128, 0, 0));
    whose("reuse", "pen", got, font, brush);

    pen = CreatePen(PS_SOLID, 3, RGB(1, 2, 3));
    DeleteObject(pen);
    got = CreateRectRgn(0, 0, 10, 10);
    same("mixed", "region", got == pen);

    memory = CreateCompatibleDC(screen);
    DeleteDC(memory);
    got = CreatePen(PS_SOLID, 4, RGB(1, 2, 3));
    same("memdc", "pen", got == (HANDLE)memory);

    one = GetDC(NULL);
    ReleaseDC(NULL, one);
    two = GetDC(NULL);
    same("dc", "same", two == one);
    one = GetDC(NULL);
    same("dc", "other", one != two);
    ReleaseDC(NULL, one);
    ReleaseDC(NULL, two);
    ReleaseDC(NULL, screen);

    (void)pen2;
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
