/*
 * SetPolyFillMode and GetPolyFillMode, and GetTextExtentPoint beside
 * GetTextExtent.
 *
 * * `mode`: a new device context's fill mode, then what setting each of
 *   2, 0, 3 and 1 answers and leaves, as `answer,after`.
 * * `fill`: the pixels a five-pointed star's Polygon fills in the middle
 *   row of a 32-pixel monochrome bitmap, under each mode, as `#` and `.`
 *   -- the star's middle is inside only for WINDING.
 * * `extent`: for a string, GetTextExtent's width and height, then
 *   GetTextExtentPoint's answer and SIZE, in MM_TEXT and in MM_LOMETRIC.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\FILLEXT.OUT"

static void extent(HDC dc, LPCSTR name, LPCSTR text)
{
    DWORD both = GetTextExtent(dc, text, lstrlen(text));
    SIZE size;
    BOOL answer;

    size.cx = size.cy = -1;
    answer = GetTextExtentPoint(dc, text, lstrlen(text), &size);
    wsprintf(probeResult, "%u,%u %d %d,%d", LOWORD(both), HIWORD(both), answer, size.cx,
             size.cy);
    probe("extent", name, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static POINT star[5] = {{16, 2}, {26, 30}, {2, 12}, {30, 12}, {6, 30}};
    static const int modes[4] = {2, 0, 3, 1};
    HDC screen;
    HDC memory;
    HBITMAP canvas;
    char row[40];
    int i;
    int x;

    probeOpen(OUTPUT);

    screen = GetDC(NULL);
    memory = CreateCompatibleDC(screen);
    canvas = CreateBitmap(32, 32, 1, 1, NULL);
    SelectObject(memory, canvas);
    SelectObject(memory, GetStockObject(BLACK_BRUSH));
    SelectObject(memory, GetStockObject(NULL_PEN));

    wsprintf(probeResult, "%d", GetPolyFillMode(memory));
    probe("mode", "new", probeResult);

    for (i = 0; i < 4; i++) {
        int answer = SetPolyFillMode(memory, modes[i]);

        wsprintf(probeArgs, "set-%d", modes[i]);
        wsprintf(probeResult, "%d,%d", answer, GetPolyFillMode(memory));
        probe("mode", probeArgs, probeResult);
    }

    for (i = 1; i <= 2; i++) {
        SetPolyFillMode(memory, i);
        PatBlt(memory, 0, 0, 32, 32, WHITENESS);
        Polygon(memory, star, 5);

        for (x = 0; x < 32; x++) {
            row[x] = GetPixel(memory, x, 16) == RGB(0, 0, 0) ? '#' : '.';
        }
        row[32] = '\0';

        probe("fill", i == 1 ? "alternate" : "winding", row);
    }

    extent(screen, "hello", "Hello, world");
    extent(screen, "empty", "");
    extent(screen, "narrow-wide", "iiiWWW");

    SetMapMode(screen, MM_LOMETRIC);
    extent(screen, "lometric", "Hello, world");
    SetMapMode(screen, MM_TEXT);

    DeleteDC(memory);
    DeleteObject(canvas);
    ReleaseDC(NULL, screen);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
