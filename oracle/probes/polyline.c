/*
 * Polyline: which pixels a chain of lines puts down, and what it does with
 * the current position.
 *
 * On a monochrome bitmap thirty-two square, with the stock black pen.
 *
 * * `cell`: the bitmap afterwards, as hex bytes, four a row.
 * * `answer`: what `Polyline` answered.
 * * `position`: the current position afterwards, as `x,y`, having been
 *   moved to 3,4 before.
 *
 * `R2_NOT` shows a pixel drawn twice as not drawn: whether the chain's
 * joins, and a closed chain's first point, are drawn once or twice.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\POLYLINE.OUT"

#define SIDE 32
#define ROW_BYTES 4
#define CELL_BYTES (ROW_BYTES * SIDE)

static HDC memory;
static HBITMAP canvas;
static char bits[CELL_BYTES];

static const char HEX[] = "0123456789abcdef";

static void cell(LPCSTR name)
{
    LPSTR at = probeResult;
    int index;

    GetBitmapBits(canvas, (LONG)CELL_BYTES, bits);

    for (index = 0; index < CELL_BYTES; index++) {
        *at++ = HEX[(bits[index] >> 4) & 0x0f];
        *at++ = HEX[bits[index] & 0x0f];
    }

    *at = '\0';
    probe("cell", name, probeResult);
}

static void draw(LPCSTR name, POINT FAR *points, int count, int rop)
{
    DWORD position;

    PatBlt(memory, 0, 0, SIDE, SIDE, WHITENESS);
    SetROP2(memory, rop);
    MoveTo(memory, 3, 4);

    wsprintf(probeResult, "%d", Polyline(memory, points, count));
    probe("answer", name, probeResult);

    position = GetCurrentPosition(memory);
    wsprintf(probeResult, "%d,%d", LOWORD(position), HIWORD(position));
    probe("position", name, probeResult);

    cell(name);
    SetROP2(memory, R2_COPYPEN);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static POINT open[4] = {{2, 2}, {20, 5}, {12, 25}, {28, 29}};
    static POINT square[5] = {{5, 5}, {25, 5}, {25, 25}, {5, 25}, {5, 5}};
    static POINT back[3] = {{4, 10}, {26, 10}, {10, 10}};
    static POINT one[1] = {{7, 7}};
    static POINT two[2] = {{7, 7}, {7, 7}};

    probeOpen(OUTPUT);

    memory = CreateCompatibleDC(NULL);
    canvas = CreateBitmap(SIDE, SIDE, 1, 1, NULL);
    SelectObject(memory, canvas);

    draw("open", open, 4, R2_COPYPEN);
    draw("open-not", open, 4, R2_NOT);
    draw("square", square, 5, R2_COPYPEN);
    draw("square-not", square, 5, R2_NOT);
    draw("back-not", back, 3, R2_NOT);
    draw("one", one, 1, R2_COPYPEN);
    draw("same", two, 2, R2_COPYPEN);
    draw("none", open, 0, R2_COPYPEN);

    /* Scaled two to one: the points are mapped as LineTo's are. */
    SetMapMode(memory, MM_ANISOTROPIC);
    SetWindowExt(memory, 2, 2);
    SetViewportExt(memory, 1, 1);
    draw("mapped", open, 4, R2_COPYPEN);
    SetMapMode(memory, MM_TEXT);

    DeleteDC(memory);
    DeleteObject(canvas);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
