/*
 * What `GetTextExtent` says where GDI draws a bold or a slant itself.
 *
 * `GDI.EXE` seg1 `3cf3`-`3d08`: after a TrueType string's widths are summed,
 * `GetTextExtent` masks the text transform's effects with the device's
 * `TEXTCAPS` and, for what is left, adds `count + 1` for a double weight and
 * half the cell less one for a slant. Upright on a VGA the driver takes the
 * double weight and nothing is left; on a Hercules it is left, and turned it
 * is left on both. Nothing had asked.
 *
 * So: four faces at two cells, plain, smeared and slanted, upright and at
 * ninety degrees, over strings of one to four characters -- the extent and
 * nothing else. Only Symbol's slant is made up; the others have italic files
 * and stand as the control.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\SIMEXT.OUT"

static HDC memory;
static HBITMAP canvas;

static void probeExtent(LPCSTR face, int height, int weight, int italic, int escapement, LPCSTR text)
{
    HFONT font;
    HFONT previous;
    DWORD extent;
    int charset = lstrcmp(face, "Symbol") == 0 ? SYMBOL_CHARSET : ANSI_CHARSET;

    wsprintf(probeArgs, "\"%s\",h=%d,weight=%d,italic=%d,esc=%d,ori=%d,charset=%d,text=\"%s\"",
             (LPSTR)face, height, weight, italic, escapement, escapement, charset, (LPSTR)text);

    font = CreateFont(height, 0, escapement, escapement, weight, (BYTE)italic, 0, 0,
                      (BYTE)charset, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                      DEFAULT_QUALITY, DEFAULT_PITCH, face);

    if (font == NULL) {
        probe("sim extent", probeArgs, "no font");
        return;
    }

    previous = (HFONT)SelectObject(memory, font);
    extent = GetTextExtent(memory, text, lstrlen(text));
    wsprintf(probeResult, "width=%u,height=%u", LOWORD(extent), HIWORD(extent));
    probe("sim extent", probeArgs, probeResult);

    SelectObject(memory, previous);
    DeleteObject(font);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static LPCSTR FACES[] = { "Arial", "Times New Roman", "Courier New", "Symbol" };
    static LPCSTR TEXTS[] = { "A", "AB", "lll", "WAWA" };
    static const int ANGLES[] = { 0, 900 };
    HDC screen;
    int face;
    int size;
    int style;
    int angle;
    int text;

    probeOpen(OUTPUT);

    screen = GetDC(NULL);
    memory = CreateCompatibleDC(screen);
    canvas = CreateBitmap(8, 8, 1, 1, NULL);

    if (memory == NULL || canvas == NULL) {
        probe("setup", "8x8x1", "failed");
        probeFinish();
        return 0;
    }

    SelectObject(memory, canvas);

    probeNote("the extent where GDI draws a bold or a slant itself");

    for (face = 0; face < 4; face++) {
        for (size = 16; size <= 24; size += 8) {
            for (angle = 0; angle < 2; angle++) {
                for (text = 0; text < 4; text++) {
                    for (style = 0; style < 3; style++) {
                        int weight = style == 1 ? (face == 3 ? 700 : 600) : 400;
                        probeExtent(FACES[face], size, weight, style == 2, ANGLES[angle], TEXTS[text]);
                    }
                }
            }
        }
    }

    DeleteObject(canvas);
    DeleteDC(memory);
    ReleaseDC(NULL, screen);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
