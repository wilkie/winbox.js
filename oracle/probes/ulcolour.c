/*
 * The colour GDI draws a font's underline and strikeout in, with a text
 * colour that is not black: Paintbrush draws its text into a monochrome
 * bitmap white on black, and its underline did not show.
 *
 * Three spaces are drawn at (2, 2), so that no glyph's ink is in the way of
 * the rules: in the System font and in Arial at 20 pixels, underlined and
 * struck out, into a colour bitmap -- red text on white, opaque and then
 * transparent, and blue on yellow -- and into a monochrome one, white on
 * black and black on white.
 *
 * Each record is a case and the rows of column 6 that are not the
 * background's colour after the draw, each as its row and the colour
 * `GetPixel` answers there, in hexadecimal.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\ULCOLOUR.OUT"

static void rows(LPCSTR name, HDC memory, COLORREF ground)
{
    LPSTR at = probeResult;
    int y;

    *at = '\0';

    for (y = 0; y < 40; y++) {
        COLORREF colour = GetPixel(memory, 6, y);

        if (colour != ground) {
            at += wsprintf(at, "%d=%lx ", y, colour);
        }
    }

    probe("rows", name, probeResult);
}

static void draw(LPCSTR name, HDC memory, LPCSTR face, int height, BOOL under, BOOL strike,
                 COLORREF text, COLORREF ground, int mode)
{
    HFONT font = CreateFont(height, 0, 0, 0, FW_NORMAL, 0, (BYTE)under, (BYTE)strike,
                            ANSI_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                            DEFAULT_QUALITY, DEFAULT_PITCH, face);
    HFONT previous = (HFONT)SelectObject(memory, font);
    HBRUSH brush = CreateSolidBrush(ground);
    RECT all;

    SetRect(&all, 0, 0, 64, 40);
    FillRect(memory, &all, brush);
    DeleteObject(brush);

    SetTextColor(memory, text);
    SetBkColor(memory, ground);
    SetBkMode(memory, mode);
    TextOut(memory, 2, 2, "   ", 3);

    rows(name, memory, GetPixel(memory, 60, 39));

    SelectObject(memory, previous);
    DeleteObject(font);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HDC screen;
    HDC memory;
    HBITMAP colour;
    HBITMAP mono;
    HBITMAP was;

    probeOpen(OUTPUT);

    screen = GetDC(NULL);
    memory = CreateCompatibleDC(screen);
    colour = CreateCompatibleBitmap(screen, 64, 40);
    mono = CreateBitmap(64, 40, 1, 1, NULL);
    ReleaseDC(NULL, screen);

    was = (HBITMAP)SelectObject(memory, colour);
    draw("system,under,red,opaque", memory, "System", 16, TRUE, FALSE, RGB(255, 0, 0),
         RGB(255, 255, 255), OPAQUE);
    draw("system,under,red,transparent", memory, "System", 16, TRUE, FALSE, RGB(255, 0, 0),
         RGB(255, 255, 255), TRANSPARENT);
    draw("system,strike,blue,yellow", memory, "System", 16, FALSE, TRUE, RGB(0, 0, 255),
         RGB(255, 255, 0), OPAQUE);
    draw("arial,under,red,opaque", memory, "Arial", 20, TRUE, FALSE, RGB(255, 0, 0),
         RGB(255, 255, 255), OPAQUE);
    draw("arial,strike,blue,yellow", memory, "Arial", 20, FALSE, TRUE, RGB(0, 0, 255),
         RGB(255, 255, 0), TRANSPARENT);

    SelectObject(memory, mono);
    draw("mono,system,under,white-on-black", memory, "System", 16, TRUE, FALSE,
         RGB(255, 255, 255), RGB(0, 0, 0), OPAQUE);
    draw("mono,system,under,black-on-white", memory, "System", 16, TRUE, FALSE, RGB(0, 0, 0),
         RGB(255, 255, 255), OPAQUE);
    draw("mono,arial,strike,white-on-black", memory, "Arial", 20, FALSE, TRUE,
         RGB(255, 255, 255), RGB(0, 0, 0), TRANSPARENT);

    SelectObject(memory, was);
    DeleteDC(memory);
    DeleteObject(colour);
    DeleteObject(mono);
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
