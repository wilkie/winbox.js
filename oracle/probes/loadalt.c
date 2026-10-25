/*
 * COMMDLG's LoadAlterBitmap, called by ordinal: a bitmap of COMMDLG's own,
 * by its number, with the first entry of its colour table that is one
 * colour made another.
 *
 * * `bitmap`: for each, `null` where nothing was answered, else its width,
 *   height, planes and bits a pixel, how many of its pixels GetPixel
 *   answers as each of the colours given, and a sum of every pixel's
 *   colour, read through a memory device context.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\LOADALT.OUT"

typedef HBITMAP(FAR PASCAL *ALTERPROC)(UINT, COLORREF, COLORREF);

static ALTERPROC alter;

static void describe(LPCSTR what, UINT id, COLORREF replace, COLORREF instead)
{
    HBITMAP bitmap = alter(id, replace, instead);
    BITMAP info;
    HDC screen;
    HDC memory;
    HBITMAP old;
    int x, y;
    COLORREF pixel;
    DWORD sum = 0;
    int replaced = 0;
    int insteads = 0;

    if (!bitmap) {
        probe("bitmap", what, "null");
        return;
    }

    GetObject(bitmap, sizeof(info), &info);
    screen = GetDC(NULL);
    memory = CreateCompatibleDC(screen);
    old = SelectObject(memory, bitmap);

    for (y = 0; y < info.bmHeight; y++) {
        for (x = 0; x < info.bmWidth; x++) {
            pixel = GetPixel(memory, x, y);
            sum = sum * 31 + pixel;

            if (pixel == replace) {
                replaced++;
            }

            if (pixel == instead) {
                insteads++;
            }
        }
    }

    SelectObject(memory, old);
    DeleteDC(memory);
    ReleaseDC(NULL, screen);
    wsprintf(probeResult, "%dx%d %d %d, %d as replaced, %d as instead, sum %08lx", info.bmWidth,
             info.bmHeight, info.bmPlanes, info.bmBitsPixel, replaced, insteads, sum);
    probe("bitmap", what, probeResult);
    DeleteObject(bitmap);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HINSTANCE commdlg;

    probeOpen(OUTPUT);
    commdlg = LoadLibrary("COMMDLG.DLL");
    alter = (ALTERPROC)GetProcAddress(commdlg, MAKEINTRESOURCE(9));

    describe("576 blue to red", 576, RGB(0, 0, 255), RGB(255, 0, 0));
    describe("576 blue to green", 576, RGB(0, 0, 255), RGB(0, 255, 0));
    describe("38 blue to red", 38, RGB(0, 0, 255), RGB(255, 0, 0));
    describe("30 black to red", 30, RGB(0, 0, 0), RGB(255, 0, 0));
    describe("none 999", 999, RGB(0, 0, 255), RGB(255, 0, 0));

    FreeLibrary(commdlg);
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
