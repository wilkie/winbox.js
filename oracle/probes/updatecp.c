/*
 * TA_UPDATECP: text drawn at the current position, which moves.
 *
 * * `text`: after MoveTo(40,10) and TextOut or ExtTextOut at (99,99) of
 *   "Hi" with an alignment, the current position after, the text's width,
 *   and the ink's leftmost and rightmost columns and top and bottom rows,
 *   as `cp=x,y w=n ink=l-r,t-b`.
 * * `twice`: two TextOuts in a row, each's ink and the position after.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\UPDATECP.OUT"

static HDC memory;
static HBITMAP bitmap;

static void ink(LPSTR out)
{
    int left = 999, right = -1, top = 999, bottom = -1;
    int x;
    int y;

    for (y = 0; y < 48; y++) {
        for (x = 0; x < 128; x++) {
            if (GetPixel(memory, x, y) == RGB(0, 0, 0)) {
                if (x < left) left = x;
                if (x > right) right = x;
                if (y < top) top = y;
                if (y > bottom) bottom = y;
            }
        }
    }

    wsprintf(out, "ink=%d-%d,%d-%d", left, right, top, bottom);
}

static void text(LPCSTR what, UINT align, BOOL ext)
{
    DWORD cp;
    DWORD size;
    char where[40];

    PatBlt(memory, 0, 0, 128, 48, WHITENESS);
    SetTextAlign(memory, align);
    MoveTo(memory, 40, 10);

    if (ext) {
        ExtTextOut(memory, 99, 99, 0, NULL, "Hi", 2, NULL);
    } else {
        TextOut(memory, 99, 99, "Hi", 2);
    }

    cp = GetCurrentPosition(memory);
    size = GetTextExtent(memory, "Hi", 2);
    ink(where);
    wsprintf(probeResult, "cp=%d,%d w=%d %s", (int)LOWORD(cp), (int)HIWORD(cp), (int)LOWORD(size),
             (LPSTR)where);
    probe("text", what, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HDC screen;
    DWORD cp;
    char where[40];

    probeOpen(OUTPUT);

    screen = GetDC(NULL);
    memory = CreateCompatibleDC(screen);
    ReleaseDC(NULL, screen);
    bitmap = CreateBitmap(128, 48, 1, 1, NULL);
    SelectObject(memory, bitmap);

    text("left", TA_UPDATECP, FALSE);
    text("right", TA_UPDATECP | TA_RIGHT, FALSE);
    text("center", TA_UPDATECP | TA_CENTER, FALSE);
    text("left baseline", TA_UPDATECP | TA_BASELINE, FALSE);
    text("left bottom", TA_UPDATECP | TA_BOTTOM, FALSE);
    text("ext left", TA_UPDATECP, TRUE);
    text("ext right", TA_UPDATECP | TA_RIGHT, TRUE);
    text("no updatecp", TA_LEFT, FALSE);

    PatBlt(memory, 0, 0, 128, 48, WHITENESS);
    SetTextAlign(memory, TA_UPDATECP);
    MoveTo(memory, 5, 5);
    TextOut(memory, 0, 0, "A", 1);
    cp = GetCurrentPosition(memory);
    ink(where);
    wsprintf(probeResult, "cp=%d,%d %s", (int)LOWORD(cp), (int)HIWORD(cp), (LPSTR)where);
    probe("twice", "first", probeResult);
    PatBlt(memory, 0, 0, 128, 48, WHITENESS);
    TextOut(memory, 0, 0, "B", 1);
    cp = GetCurrentPosition(memory);
    ink(where);
    wsprintf(probeResult, "cp=%d,%d %s", (int)LOWORD(cp), (int)HIWORD(cp), (LPSTR)where);
    probe("twice", "second", probeResult);

    DeleteDC(memory);
    DeleteObject(bitmap);
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
